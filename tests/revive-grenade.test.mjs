import assert from 'node:assert/strict';
import test from 'node:test';
import { Game, BARREL_RULES, GRENADE_RULES, FREE_REVIVES } from '../src/game.js';

function quiet(mapId = 'courtyard') {
  const game = new Game({ seed: 73, mapId });
  game.spawnTimer = 9999;
  return game;
}
function enemy(game, extra = {}) {
  const item = { id: game.nextId++, x: 800, y: 380, radius: 17, hp: 40, maxHp: 40,
    type: 'grunt', speed: 0, damage: 12, angle: 0, hitFlash: 0, ...extra };
  game.enemies.push(item);
  return item;
}
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ~= ${expected}`);

test('oil barrel self damage consumes shields first and a chain applies only its strongest nearby hit', () => {
  const game = quiet('greenhouse'), nearBarrel = game.barrels[1];
  game.player.x = nearBarrel.x; game.player.y = nearBarrel.y;
  game.player.shield = 35;
  game.explodeBarrel(game.barrels[0]);
  assert.equal(game.player.hp, 90, 'nearer chained barrel supplies 45 damage, not first weaker hit');
  assert.equal(game.player.shield, 0);
  assert.equal(game.events.filter(event => event.type === 'damage').length, 1);
  assert.equal(game.events.filter(event => event.type === 'barrelExplosion').length, 2);
  assert.equal(game.player.invulnerability, .65);
  game.explodeBarrel(nearBarrel);
  assert.equal(game.player.hp, 90, 'consumed station cannot repeat its explosion');
});

test('oil blast damage falls off to eighteen at its edge and rejects outside or protected players', () => {
  for (const [distance, expected] of [[0, 45], [BARREL_RULES.blastRadius, 18], [BARREL_RULES.blastRadius + 19, 0]]) {
    const game = quiet('greenhouse'), barrel = game.barrels[2];
    game.player.x = barrel.x + distance; game.player.y = barrel.y;
    game.player.shield = 0;
    game.explodeBarrel(barrel);
    near(game.player.hp, 100 - expected);
  }
  const game = quiet('greenhouse'), barrel = game.barrels[2];
  game.player.x = barrel.x; game.player.y = barrel.y; game.player.invulnerability = .4;
  game.explodeBarrel(barrel);
  assert.equal(game.player.hp, 100);
  assert.equal(game.player.shield, 35);
});

test('lethal oil blast wins over a same-frame last-enemy kill and health pickup', () => {
  const game = quiet('greenhouse'), barrel = game.barrels[2];
  game.spawnQueue = [];
  game.player.x = barrel.x; game.player.y = barrel.y;
  game.player.hp = 5; game.player.shield = 0;
  enemy(game, { x: barrel.x, y: barrel.y });
  game.spawnPickup('health', barrel.x, barrel.y);
  game.grenades.push({ id: game.nextId++, x: barrel.x, y: barrel.y, radius: 7, travelRemaining: 0, fuse: .001 });
  game.update(1 / 60);
  assert.equal(game.status, 'dead');
  assert.equal(game.player.hp, 0);
  assert.equal(game.wave, 1);
  assert.equal(game.kills, 1);
  assert.equal(game.events.some(event => event.type === 'waveClear'), false);
  assert.equal(game.events.some(event => event.type === 'pickup'), false);
});

test('three free revives restore health and protection while retaining the current run', () => {
  const game = quiet('greenhouse'), p = game.player;
  game.wave = 5; game.waveKills = 2; game.waveTotal = 21;
  game.score = 975; game.kills = 31; game.time = 56;
  p.weapons.rifle = game.makeAmmo('rifle'); p.currentWeapon = 'rifle';
  p.weapons.rifle.clip = 7; p.weapons.rifle.reserve = 48; p.weapons.rifle.reloadRemaining = .8;
  p.grenades = 1;
  game.explodeBarrel(game.barrels[2]);
  const environment = game.environmentSnapshot(), ammo = structuredClone(p.weapons);
  const walker = enemy(game), queue = [...game.spawnQueue];
  game.bullets.push({ owner: 'enemy', life: 4 }, { owner: 'player', life: 1 });
  game.grenades.push({ fuse: .1 });
  game.previousInput = { grenade: true, reload: true };
  p.hp = 0; p.shield = 0; game.status = 'dead';
  assert.equal(game.revive(), true);
  assert.equal(game.status, 'playing');
  assert.equal(game.revivesRemaining, 2);
  assert.equal(p.hp, 100); assert.equal(p.shield, 35);
  assert.equal(p.invulnerability, 3); assert.equal(p.reviveProtectionRemaining, 3);
  assert.equal(p.x, game.map.start.x); assert.equal(p.y, game.map.start.y);
  assert.deepEqual(p.weapons, ammo); assert.equal(p.currentWeapon, 'rifle'); assert.equal(p.grenades, 1);
  assert.deepEqual(game.environmentSnapshot().barrels, environment.barrels);
  assert.deepEqual(game.spawnQueue, queue); assert.equal(game.enemies[0], walker);
  assert.deepEqual([game.wave, game.waveKills, game.waveTotal, game.score, game.kills, game.time], [5, 2, 21, 975, 31, 56]);
  assert.equal(game.bullets.length, 1); assert.equal(game.bullets[0].owner, 'player');
  assert.equal(game.grenades.length, 0); assert.deepEqual(game.previousInput, {});
  assert.equal(game.events.at(-1).type, 'revive');
  for (const remaining of [1, 0]) {
    p.hp = 0; game.status = 'dead';
    assert.equal(game.revive(), true);
    assert.equal(game.revivesRemaining, remaining);
    assert.equal(p.hp, 100); assert.equal(p.shield, 35);
    assert.equal(p.reviveProtectionRemaining, 3);
  }
  p.hp = 0; game.status = 'dead';
  assert.equal(game.revive(), false, 'a fourth death cannot create another revive');
  assert.equal(game.status, 'dead');
  assert.equal(game.revivesRemaining, 0);
  const fresh = quiet(); assert.equal(fresh.revivesRemaining, FREE_REVIVES);
});

test('revive refuses living or won games and finds a free landing away from a crowded start', () => {
  const game = quiet();
  assert.equal(game.revive(), false);
  assert.equal(game.revivesRemaining, FREE_REVIVES);
  game.status = 'won'; assert.equal(game.revive(), false);
  const walker = enemy(game, { x: game.map.start.x, y: game.map.start.y });
  game.status = 'dead'; game.player.hp = 0;
  assert.equal(game.revive(), true);
  assert.ok(Math.hypot(game.player.x - walker.x, game.player.y - walker.y) >= walker.radius + game.player.radius + 60);
  assert.equal(game.isBodyFree(game.player.x, game.player.y, game.player.radius), true);
  assert.equal(game.enemies.length, 1, 'safety relocation never deletes wave enemies');
});

test('revive protection rejects contact, hostile bullets and oil explosions, then expires in gameplay time', () => {
  const game = quiet('greenhouse');
  game.player.hp = 0; game.status = 'dead'; game.revive();
  const p = game.player;
  const barrel = game.barrels[2]; p.x = barrel.x; p.y = barrel.y;
  enemy(game, { x: p.x, y: p.y, hp: 1000, maxHp: 1000 });
  game.bullets.push({ id: game.nextId++, x: p.x - 40, y: p.y, vx: 1000, vy: 0,
    radius: 7, life: 2, owner: 'enemy', damage: 18, hitIds: new Set(), remainingHits: 1 });
  game.explodeBarrel(barrel);
  game.update(.1);
  assert.equal(p.hp, 100); assert.equal(p.shield, 35);
  assert.equal(game.bullets.length, 0, 'hostile projectile actually intersects protected player and is consumed');
  near(p.reviveProtectionRemaining, 2.9);
  for (let frame = 0; frame < 31; frame++) game.update(.1);
  assert.equal(p.reviveProtectionRemaining, 0);
  p.x = game.enemies[0].x; p.y = game.enemies[0].y;
  game.update(.1);
  assert.equal(p.shield, 23, 'ordinary contact resumes after protection expires');
});

test('tap grenade retains the original distance, fuse, speed and enemy damage', () => {
  const game = quiet(); game.player.angle = 0;
  const point = game.resolveGrenadeTarget();
  near(point.x, game.player.x + GRENADE_RULES.defaultRange); near(point.y, game.player.y);
  assert.equal(game.throwGrenade(), true);
  const grenade = game.grenades[0];
  near(grenade.travelRemaining, .52); assert.equal(grenade.fuse, 1.05);
  near(Math.hypot(grenade.vx, grenade.vy), 420);
  const target = enemy(game, { x: point.x, y: point.y, hp: 190, maxHp: 190 });
  for (let frame = 0; frame < 11; frame++) game.update(.1);
  assert.ok(target.hp <= 0); assert.equal(game.grenades.length, 0);
});

test('targeted grenade lands precisely at short, zero and maximum range without overshooting', () => {
  for (const offset of [{ x: 10, y: 5 }, { x: 0, y: 0 }, { x: 1000, y: 0 }]) {
    const game = quiet();
    const point = game.resolveGrenadeTarget({ x: game.player.x + offset.x, y: game.player.y + offset.y });
    assert.ok(Math.hypot(point.x - game.player.x, point.y - game.player.y) <= 350 + 1e-7);
    game.throwGrenade({ x: game.player.x + offset.x, y: game.player.y + offset.y });
    const grenade = game.grenades[0];
    for (let frame = 0; frame < 9; frame++) game.updateGrenades(.1);
    near(grenade.x, point.x); near(grenade.y, point.y);
    assert.equal(grenade.travelRemaining, 0);
    assert.equal(game.isBodyFree(grenade.x, grenade.y, grenade.radius), true);
    game.updateGrenades(.1);
    near(grenade.x, point.x); near(grenade.y, point.y);
  }
});

test('grenade preview clips walls with body radius and cannot tunnel or slide past blocked targets', () => {
  const game = quiet(); game.player.x = 170; game.player.y = 200;
  const point = game.resolveGrenadeTarget({ x: 600, y: 200 });
  near(point.x, 240 - GRENADE_RULES.radius - .001); near(point.y, 200);
  game.throwGrenade({ x: 600, y: 200 });
  const grenade = game.grenades[0];
  game.updateGrenades(.5);
  near(grenade.x, point.x); near(grenade.y, point.y);
  assert.equal(game.isBodyFree(grenade.x, grenade.y, grenade.radius), true);
});

test('grenade preview clips arena boundaries along the requested ray and normalizes huge or invalid targets', () => {
  const game = quiet(); game.player.x = 1240; game.player.y = 300; game.player.angle = Math.PI;
  const boundary = game.resolveGrenadeTarget({ x: 2000, y: 500 });
  near(boundary.x, game.map.width - GRENADE_RULES.radius);
  near((boundary.y - game.player.y) / (boundary.x - game.player.x), 200 / 760);
  const huge = game.resolveGrenadeTarget({ x: 1e308, y: 1e308 });
  assert.ok(Number.isFinite(huge.x) && Number.isFinite(huge.y));
  assert.equal(game.isBodyFree(huge.x, huge.y, GRENADE_RULES.radius), true);
  const fallback = game.resolveGrenadeTarget();
  for (const target of [{ x: NaN, y: 100 }, { x: 500, y: Infinity }, {}, null]) {
    assert.deepEqual(game.resolveGrenadeTarget(target), fallback);
  }
});

test('preview endpoints and entire flight paths stay valid from map edges and around all obstacle layouts', () => {
  for (const mapId of ['courtyard', 'greenhouse']) {
    const game = quiet(mapId), p = game.player;
    const starts = [...game.map.spawnPoints, game.map.start];
    for (let y = 60; y < game.map.height; y += 160) for (let x = 60; x < game.map.width; x += 180) {
      if (game.isBodyFree(x, y, p.radius)) starts.push({ x, y });
    }
    for (const start of starts) for (let direction = 0; direction < 12; direction++) {
      p.x = start.x; p.y = start.y;
      const angle = direction * Math.PI / 6;
      const point = game.resolveGrenadeTarget({ x: p.x + Math.cos(angle) * 1000, y: p.y + Math.sin(angle) * 1000 });
      assert.ok(Math.hypot(point.x - p.x, point.y - p.y) <= GRENADE_RULES.maxRange + 1e-7);
      assert.equal(game.isBodyFree(point.x, point.y, GRENADE_RULES.radius), true);
      assert.equal(game.clearPath(p.x, p.y, point.x, point.y, GRENADE_RULES.radius), true);
    }
  }
});

test('grenade target input stays edge triggered and no-inventory or dead throws preserve resources', () => {
  const game = quiet(), target = { x: game.player.x + 25, y: game.player.y + 10 };
  game.update(1 / 60, { grenade: true, grenadeTarget: target });
  assert.equal(game.player.grenades, 2);
  near(game.grenades[0].targetX, target.x); near(game.grenades[0].targetY, target.y);
  for (let frame = 0; frame < 10; frame++) game.update(1 / 60, { grenade: true, grenadeTarget: target });
  assert.equal(game.player.grenades, 2);
  game.player.grenades = 0; assert.equal(game.throwGrenade(target), false);
  game.player.grenades = 2; game.status = 'dead'; assert.equal(game.throwGrenade(target), false);
  assert.equal(game.player.grenades, 2);
});
