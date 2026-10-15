import test from 'node:test';
import assert from 'node:assert/strict';
import { CoopGame } from '../src/coop-game.js';
import { BARREL_RULES, BOOST_RULES, FREE_REVIVES, WEAPONS } from '../src/game.js';

const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);
const arena = (options = {}) => {
  const game = new CoopGame({ seed: 21, ...options });
  game.map = { ...game.map, obstacles: [], speedZones: [] };
  game.spawnQueue = ['grunt'];
  game.spawnTimer = 9999;
  Object.assign(game.players.p1, { x: 400, y: 300 });
  Object.assign(game.players.p2, { x: 800, y: 300 });
  return game;
};
const enemy = (game, extra = {}) => {
  const body = { id: game.nextId++, type: 'grunt', x: 600, y: 300, radius: 17,
    hp: 1000, maxHp: 1000, speed: 100, damage: 12, angle: 0, hitFlash: 0, ...extra };
  game.enemies.push(body);
  return body;
};
const advance = (game, seconds, inputs = {}) => {
  for (let remaining = seconds; remaining > 1e-9;) {
    const dt = Math.min(1 / 60, remaining);
    game.update(dt, inputs);
    remaining -= dt;
  }
};

test('cooperative ticks apply both movement and shooting inputs while advancing the world once', () => {
  const game = arena();
  const far = enemy(game, { x: 600, y: 600, speed: 0, hitFlash: .5 });
  game.effects.push({ life: 1 });
  const startTimer = game.spawnTimer;
  game.update(.1, {
    p1: { moveX: 1, aimX: 1200, aimY: 300, shoot: true },
    p2: { moveY: 1, aimX: 800, aimY: 700, shoot: true },
  });
  close(game.time, .1);
  close(game.spawnTimer, startTimer - .1);
  close(far.hitFlash, .4);
  close(game.effects[0].life, .9);
  close(game.players.p1.x, 422.5);
  close(game.players.p2.y, 322.5);
  assert.equal(game.players.p1.weapons.pistol.clip, 11);
  assert.equal(game.players.p2.weapons.pistol.clip, 11);
  const shots = game.events.filter(event => event.type === 'shot');
  assert.deepEqual(shots.map(shot => shot.playerId), ['p1', 'p2']);
  assert.deepEqual(game.bullets.map(bullet => bullet.playerId), ['p1', 'p2']);
  for (const bullet of game.bullets) close(bullet.distanceTravelled, WEAPONS.pistol.bulletSpeed * .1);
});

test('players have separate weapons, edge-triggered actions, boosts, cooldowns, and grenade stock', () => {
  const game = arena();
  game.players.p2.weapons.smg = game.makeAmmo('smg');
  game.update(.05, { p2: { weaponSlot: 'smg', boost: true, grenade: true, grenadeTarget: { x: 800, y: 500 } } });
  assert.equal(game.players.p1.currentWeapon, 'pistol');
  assert.equal(game.players.p2.currentWeapon, 'smg');
  assert.equal(game.players.p1.boostCharges, 1);
  assert.equal(game.players.p2.boostCharges, 0);
  assert.equal(game.players.p1.grenades, 3);
  assert.equal(game.players.p2.grenades, 2);
  assert.equal(game.grenades[0].playerId, 'p2');
  game.update(.05, { p1: { grenade: true }, p2: { grenade: true, boost: true } });
  assert.equal(game.players.p1.grenades, 2);
  assert.equal(game.players.p2.grenades, 2, 'held p2 grenade does not retrigger');
  assert.equal(game.grenades.length, 2);
  close(game.players.p2.boostRemaining, BOOST_RULES.duration - .05);
});

test('both participants can kill enemies with real projectiles and share score and wave kills', () => {
  const game = arena();
  const first = enemy(game, { x: 500, y: 300, speed: 0, hp: 20 });
  const second = enemy(game, { x: 900, y: 300, speed: 0, hp: 20 });
  game.update(.1, { p1: { aimX: 1200, aimY: 300, shoot: true }, p2: { aimX: 1200, aimY: 300, shoot: true } });
  assert.ok(first.hp <= 0);
  assert.ok(second.hp <= 0);
  assert.equal(game.kills, 2);
  assert.equal(game.waveKills, 2);
  assert.equal(game.score, 20);
});

test('enemy movement and boss aim select the closest living player and ignore a fallen body', () => {
  const game = arena();
  const chaser = enemy(game, { x: 700 });
  game.update(.1);
  close(chaser.x, 710);
  game.players.p2.hp = 0;
  game.update(.1);
  close(chaser.x, 700, 1e-5);
  const boss = enemy(game, { type: 'tank', x: 900, y: 300, speed: 0, rangedCooldown: 0, rangedCharge: 0 });
  game.update(.01);
  close(Math.abs(boss.attackAngle), Math.PI);
  assert.equal(game.status, 'playing');
  assert.equal(game.snapshot('p2').status, 'dead');
  assert.equal(game.snapshot('p1').status, 'playing');
});

test('hostile projectiles sweep to a living teammate and pass through fallen players', () => {
  const game = arena();
  Object.assign(game.players.p1, { x: 400, hp: 0, shield: 0 });
  Object.assign(game.players.p2, { x: 480, shield: 0 });
  game.bullets.push({ id: game.nextId++, owner: 'enemy', x: 350, y: 300, vx: 2000, vy: 0,
    radius: 7, damage: 18, remainingHits: 1, hitIds: new Set(), life: 5 });
  game.update(.1);
  assert.equal(game.players.p1.hp, 0);
  assert.equal(game.players.p2.hp, 82);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.events.find(event => event.type === 'damage').playerId, 'p2');
});

test('contact damage and barrels affect both living players independently', () => {
  const game = arena({ mapId: 'greenhouse' });
  const first = game.players.p1, second = game.players.p2;
  first.shield = 0; second.shield = 0;
  enemy(game, { x: first.x - 35.001, y: first.y, speed: 0 });
  enemy(game, { x: second.x + 35.001, y: second.y, speed: 0 });
  game.update(.01);
  assert.equal(first.hp, 88);
  assert.equal(second.hp, 88);
  const barrel = game.barrels[0];
  Object.assign(first, { x: barrel.x - 45, y: barrel.y, invulnerability: 0 });
  Object.assign(second, { x: barrel.x + 45, y: barrel.y, invulnerability: 0 });
  game.explodeBarrel(barrel);
  close(first.hp, 88 - BARREL_RULES.playerDamage * (1 - 45 / (BARREL_RULES.blastRadius * 1.6)));
  assert.ok(second.hp < 88);
  assert.equal(game.events.filter(event => event.type === 'damage').at(-1).playerId, 'p2');
});

test('both players and enemies obey solid circle collisions without moving the other participant', () => {
  const game = arena();
  const first = game.players.p1, second = game.players.p2;
  Object.assign(first, { x: 400, y: 300 });
  Object.assign(second, { x: 450, y: 300 });
  advance(game, 1, { p1: { moveX: 1 } });
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) >= 36);
  close(second.x, 450);
  const chaser = enemy(game, { x: 500, y: 300, speed: 200 });
  advance(game, 1);
  assert.ok(Math.hypot(second.x - chaser.x, second.y - chaser.y) >= second.radius + chaser.radius);
  close(second.x, 450);
});

test('only the living collector receives physical pickups; each physical drop is consumed once', () => {
  const game = arena();
  const first = game.players.p1, second = game.players.p2;
  first.boostCharges = 0; second.boostCharges = 0;
  game.spawnPickup('boost', second.x, second.y);
  game.spawnPickup('weapon', second.x, second.y, { weaponId: 'rifle' });
  game.update(.01);
  assert.equal(first.boostCharges, 0);
  assert.equal(first.weapons.rifle, undefined);
  assert.equal(second.boostCharges, 1);
  assert.ok(second.weapons.rifle);
  assert.equal(game.pickups.length, 0);
  assert.ok(game.events.filter(event => ['pickup', 'unlock'].includes(event.type)).every(event => event.playerId === 'p2'));
  first.hp = 0;
  game.spawnPickup('health', first.x, first.y);
  game.update(.01);
  assert.equal(first.hp, 0);
  assert.equal(game.pickups.length, 1);
});

test('clearing a shared wave advances it once and guarantees both players the permanent weapon unlock', () => {
  const game = arena();
  game.players.p2.hp = 0;
  game.spawnQueue = [];
  game.update(.01);
  assert.equal(game.wave, 2);
  assert.equal(game.score, 100);
  assert.ok(game.players.p1.weapons.smg);
  assert.ok(game.players.p2.weapons.smg, 'downed teammate retains permanent progression');
  assert.equal(game.events.filter(event => event.type === 'waveClear').length, 1);
  assert.deepEqual(game.events.filter(event => event.type === 'unlock').map(event => event.playerId), ['p1', 'p2']);
});

test('reviving a fallen teammate preserves the survivor projectiles, grenades, ammo and held-input state', () => {
  const game = arena();
  game.update(.05, { p1: { shoot: true, grenade: true, boost: true, aimX: 1200, aimY: 300 } });
  game.players.p2.hp = 0;
  game.update(.01, { p1: { grenade: true } });
  const bullets = game.bullets, grenades = game.grenades;
  const clip = game.players.p1.weapons.pistol.clip, previous = game.previousInputs.p1;
  const boost = game.players.p1.boostRemaining, priorEvents = [...game.events];
  assert.equal(game.revive('p2'), true);
  assert.equal(game.bullets, bullets);
  assert.equal(game.grenades, grenades);
  assert.equal(game.previousInputs.p1, previous);
  assert.equal(game.players.p1.weapons.pistol.clip, clip);
  assert.equal(game.players.p1.boostRemaining, boost);
  assert.equal(game.players.p2.revivesRemaining, FREE_REVIVES - 1);
  assert.equal(game.players.p1.revivesRemaining, FREE_REVIVES);
  assert.equal(game.players.p2.hp, 100);
  assert.ok(game.players.p2.reviveProtectionRemaining > 0);
  assert.ok(game.events.length > priorEvents.length);
  assert.equal(game.events.find(event => event.type === 'revive').playerId, 'p2');
  const distance = Math.hypot(game.players.p1.x - game.players.p2.x, game.players.p1.y - game.players.p2.y);
  assert.ok(distance >= 36);
  const stock = game.players.p1.grenades;
  game.update(.01, { p1: { grenade: true } });
  assert.equal(game.players.p1.grenades, stock, 'surviving held button does not retrigger after teammate recovery');
});

test('each player has three recoveries, both fallen ends the team, and a valid recovery resumes the world', () => {
  const game = arena();
  for (let index = 0; index < FREE_REVIVES; index++) {
    game.players.p2.hp = 0;
    assert.equal(game.revive('p2'), true);
  }
  game.players.p1.hp = 0; game.players.p2.hp = 0;
  game.update(.05);
  assert.equal(game.status, 'dead');
  const time = game.time;
  game.update(.1);
  close(game.time, time);
  assert.equal(game.revive('p2'), false);
  assert.equal(game.revive('p1'), true);
  assert.equal(game.status, 'playing');
  assert.equal(game.players.p1.revivesRemaining, FREE_REVIVES - 1);
  game.update(.1);
  assert.ok(game.time > time);
});

test('explicit action queues can consume repeated boosts and sequential weapon actions in a single tick', () => {
  const game = arena();
  game.players.p2.boostCharges = 3;
  game.players.p2.weapons.smg = game.makeAmmo('smg');
  assert.equal(game.performAction('p2', 'boost'), true);
  assert.equal(game.performAction('p2', 'boost'), true);
  assert.equal(game.players.p2.boostRemaining, 16);
  assert.equal(game.players.p2.boostCharges, 1);
  assert.equal(game.performAction('p2', 'weapon', { weaponId: 'smg' }), true);
  assert.equal(game.players.p2.currentWeapon, 'smg');
  assert.ok(game.events.filter(event => event.type === 'boostActivation').every(event => event.playerId === 'p2'));
  game.players.p2.hp = 0;
  assert.equal(game.performAction('p2', 'grenade', { target: { x: 800, y: 500 } }), false);
  assert.equal(game.performAction('p2', 'boost'), false);
  assert.equal(game.performAction('p2', 'revive'), true);
  assert.equal(game.performAction('p2', 'missing'), false);
  assert.equal(game.performAction('p2', 'weapon', { weaponId: 'toString' }), false);
  assert.equal(game.performAction('p2', 'weapon', { weaponId: '__proto__' }), false);
  assert.equal(game.players.p2.currentWeapon, 'smg');
  assert.equal(game.performAction('p2', 'weapon', null), false);
  for (const playerId of ['missing', 'toString', '__proto__']) {
    assert.equal(game.performAction(playerId, 'boost'), false);
    assert.equal(game.revive(playerId), false);
    assert.throws(() => game.snapshot(playerId), /Unknown player/);
  }
});

test('snapshots isolate local HUD and return detached JSON data without expanding endless spawns', () => {
  const game = arena({ mapId: 'candyloop', difficultyId: 'easy' });
  game.status = 'intermission'; game.wave = 1_000_000;
  game.startNextWave();
  game.players.p2.shield = 10;
  game.players.p2.revivesRemaining = 1;
  game.players.p1.hp = 0;
  const view = game.snapshot('p2');
  assert.equal(view.mapId, 'candyloop');
  assert.equal(view.difficultyId, 'easy');
  assert.equal(view.player.id, 'p2');
  assert.equal(view.player.shield, 10);
  assert.equal(view.revivesRemaining, 1);
  assert.equal(view.player.weapons.pistol.reserve, null);
  assert.equal(view.players.length, 2);
  assert.equal(view.status, 'playing');
  assert.equal(view.teamStatus, 'playing');
  assert.equal('spawnQueue' in view, false);
  assert.ok(JSON.stringify(view).length < 20_000);
  view.player.hp = 15;
  view.players[0].hp = 25;
  assert.equal(game.players.p2.hp, 100);
  assert.equal(game.players.p1.hp, 0);
});
