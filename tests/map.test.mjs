import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MAPS, BARREL_RULES, MAX_WAVES, WEAPONS } from '../src/game.js';

const factory = () => {
  const game = new Game({ mapId: 'greenhouse', seed: 42 });
  game.spawnTimer = 9999;
  return game;
};
const enemy = (game, extra = {}) => {
  const target = { id: game.nextId++, x: 520, y: 200, radius: 17, hp: 40, maxHp: 40,
    type: 'grunt', speed: 0, damage: 12, angle: 0, hitFlash: 0, ...extra };
  game.enemies.push(target);
  return target;
};
const bullet = (game, extra = {}) => {
  const shot = { id: game.nextId++, x: 470, y: 200, prevX: 470, prevY: 200, radius: 3,
    vx: 1000, vy: 0, damage: 22, remainingHits: 1, hitIds: new Set(), owner: 'player',
    weapon: 'pistol', distanceTravelled: 0, life: 1, ...extra };
  game.bullets.push(shot);
  return shot;
};
const tick = (game, seconds, input = {}) => {
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame++) game.update(1 / 60, input);
};

test('factory has a distinct open layout and all stations, belts and spawns are reachable', () => {
  const game = factory(), courtyard = MAPS.find(map => map.id === 'courtyard');
  assert.equal(game.map.name, '汽泡工坊');
  assert.notDeepEqual(game.map.obstacles, courtyard.obstacles);
  assert.equal(game.barrels.length, 4);
  for (const radius of [14, 17, 25]) {
    const field = game.buildFlowField(radius);
    for (const point of [...game.map.spawnPoints, ...game.barrels,
      ...game.map.speedZones.map(zone => ({ x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 }))]) {
      assert.equal(game.isBodyFree(point.x, point.y, radius), true);
      const index = Math.floor(point.y / field.cell) * field.cols + Math.floor(point.x / field.cell);
      assert.ok(field.distances[index] >= 0, `radius ${radius}: ${point.x}, ${point.y} can reach player`);
    }
  }
});

test('two pistol hits explode a barrel and nearby stations chain exactly once without hurting player', () => {
  const game = factory(), barrel = game.barrels[0], nextBarrel = game.barrels[1];
  game.player.x = barrel.x; game.player.y = barrel.y;
  const target = enemy(game);
  bullet(game);
  game.updateBullets(0.1);
  assert.equal(barrel.hp, BARREL_RULES.hp - WEAPONS.pistol.damage);
  assert.equal(barrel.active, true);
  assert.equal(target.hp, 40, 'barrel absorbs the non-piercing shot in front of enemy');
  bullet(game);
  game.updateBullets(0.1);
  assert.equal(barrel.active, false);
  assert.equal(nextBarrel.active, false);
  assert.equal(game.kills, 1);
  assert.equal(game.player.hp, 100);
  assert.equal(game.player.shield, 35);
  const explosions = game.events.filter(event => event.type === 'barrelExplosion');
  assert.deepEqual(explosions.map(event => event.barrelId), [barrel.id, nextBarrel.id]);
  game.explodeBarrel(barrel);
  assert.equal(game.events.filter(event => event.type === 'barrelExplosion').length, 2);
  assert.equal(game.kills, 1);
});

test('swept barrel shots stop at walls and enemy projectiles never detonate barrels', () => {
  const game = factory(), barrel = game.barrels[0];
  bullet(game, { x: 250, y: 200, damage: 100 });
  game.updateBullets(0.5);
  assert.equal(barrel.hp, BARREL_RULES.hp);
  assert.equal(game.bullets.length, 0);
  bullet(game, { damage: 100, owner: 'enemy' });
  game.updateBullets(0.1);
  assert.equal(barrel.active, true);
  assert.equal(barrel.hp, BARREL_RULES.hp);
});

test('piercing counts surviving targets in order and ignores enemies or barrels already consumed by a chain', () => {
  const game = factory();
  game.map = { ...game.map, obstacles: [] };
  const nearby = enemy(game, { x: 600 });
  const distant = enemy(game, { x: 870, hp: 300, maxHp: 300 });
  const shot = bullet(game, { damage: 140, weapon: 'sniper', remainingHits: 4 });
  game.updateBullets(0.5);
  assert.ok(nearby.hp <= 0);
  assert.equal(distant.hp, 160);
  assert.equal(shot.remainingHits, 2, 'one live barrel and one distant enemy consume penetration');
  assert.equal(shot.hitIds.size, 2);
  assert.equal(game.events.filter(event => event.type === 'barrelExplosion').length, 2);
});

test('grenade detonates nearby barrel chains and prevents a defeated charging boss firing', () => {
  const game = factory();
  game.spawnQueue = [];
  const boss = enemy(game, { type: 'tank', radius: 25, hp: 250, maxHp: 250,
    rangedCharge: 0.01, rangedCooldown: 0, rangedWindup: 0.85, attackAngle: 0 });
  game.grenades.push({ id: game.nextId++, x: 520, y: 200, radius: 7,
    travelRemaining: 0, fuse: 0.01 });
  game.update(1 / 60);
  assert.ok(boss.hp <= 0);
  assert.equal(game.kills, 1);
  assert.equal(game.wave, 2, 'barrels do not hold the completed wave open');
  assert.equal(game.events.some(event => event.type === 'bossVolley'), false);
  assert.equal(game.events.filter(event => event.type === 'barrelExplosion').length, 2);
  assert.equal(game.barrels[0].active, false, 'wave advance preserves station cooldown');
});

test('oil stations refresh once after twelve active gameplay seconds with clean health and frozen terminal timers', () => {
  const game = factory(), barrel = game.barrels[2];
  game.explodeBarrel(barrel);
  const snapshot = game.environmentSnapshot();
  assert.equal(snapshot.barrels[2].respawnRemaining, BARREL_RULES.respawnSeconds);
  snapshot.barrels[2].hp = 999;
  assert.equal(barrel.hp, 0, 'snapshot is detached from simulation');
  tick(game, 11.9);
  assert.equal(barrel.active, false);
  tick(game, 0.1);
  assert.equal(barrel.active, true);
  assert.equal(barrel.hp, BARREL_RULES.hp);
  assert.equal(barrel.respawnRemaining, 0);
  assert.equal(game.events.filter(event => event.type === 'barrelRespawn').length, 1);
  game.update(1 / 60);
  assert.equal(game.events.filter(event => event.type === 'barrelRespawn').length, 0);
  game.explodeBarrel(barrel);
  game.status = 'won'; game.wave = MAX_WAVES;
  tick(game, 2);
  assert.equal(barrel.respawnRemaining, BARREL_RULES.respawnSeconds);
});

test('conveyor accelerates only the player inside its bounds and entering repeatedly does not stack', () => {
  const game = factory(), p = game.player, zone = game.map.speedZones[0];
  p.x = 540; p.y = 315;
  const walker = enemy(game, { x: 700, y: 315, speed: 60 });
  game.update(0.1, { moveX: 1 });
  assert.ok(Math.abs(p.x - (540 + p.speed * zone.multiplier * 0.1)) < 1e-7);
  assert.equal(p.speed, 225, 'base speed remains stable');
  assert.equal(p.speedMultiplier, 1.45);
  assert.equal(p.speedZoneId, zone.id);
  assert.ok(Math.abs(walker.x - 694) < 1e-7, 'enemy on same belt retains its normal speed');
  assert.deepEqual(game.events.filter(event => event.type === 'speedBoost'), [
    { type: 'speedBoost', active: true, zoneId: zone.id, multiplier: 1.45 },
  ]);
  p.x = zone.x + zone.w - 2;
  game.update(0.1, { moveX: 1 });
  assert.equal(p.speedMultiplier, 1);
  assert.equal(p.speedZoneId, null);
  const x = p.x;
  game.update(0.1, { moveX: 1 });
  assert.ok(Math.abs(p.x - x - p.speed * 0.1) < 1e-7);
  p.x = 540;
  game.update(0.1);
  assert.equal(p.speedMultiplier, 1.45);
  assert.equal(p.speed, 225);
});

test('overlapping belts never multiply and boosted movement remains inside arena walls', () => {
  const game = factory(), p = game.player;
  game.map = { ...game.map, speedZones: [
    { id: 'test-a', x: 1200, y: 330, w: 80, h: 100, multiplier: 1.45 },
    { id: 'test-b', x: 1200, y: 330, w: 80, h: 100, multiplier: 1.45 },
  ] };
  p.x = 1250; p.y = 380;
  game.update(0.1, { moveX: 1 });
  assert.equal(p.x, game.map.width - p.radius);
  assert.equal(p.speedMultiplier, 1.45);
  assert.equal(game.isBodyFree(p.x, p.y, p.radius), true);
});

test('courtyard remains free of factory systems and weapon feedback emits once per shot', () => {
  const game = new Game();
  game.spawnTimer = 9999;
  assert.deepEqual(game.environmentSnapshot(), { barrels: [], speedZones: [], speedMultiplier: 1, speedZoneId: null });
  game.player.weapons.shotgun = game.makeAmmo('shotgun');
  game.equipWeapon('shotgun');
  game.update(1 / 60, { shoot: true });
  assert.equal(game.bullets.length, 7);
  assert.equal(game.effects.filter(effect => effect.type === 'muzzle').length, 1);
  assert.equal(game.events.filter(event => event.type === 'shot').length, 1);
  const target = enemy(game, { x: 740, y: 380 });
  game.damageEnemy(target, 10);
  assert.equal(game.events.filter(event => event.type === 'hit').length, 1);
  game.damageEnemy(target, -100);
  assert.equal(target.hp, 30);
  assert.equal(game.events.filter(event => event.type === 'hit').length, 1);
});
