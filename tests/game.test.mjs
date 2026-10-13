import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MAPS, WEAPONS, MAX_WAVES, segmentRoundedRect } from '../src/game.js';

const tick = (game, seconds, input = {}) => {
  for (let time = 0; time < seconds; time += 1 / 60) game.update(1 / 60, input);
};
const enemy = (game, props = {}) => {
  const item = { id: game.nextId++, x: 740, y: 380, radius: 17, hp: 40, maxHp: 40,
    type: 'grunt', speed: 0, damage: 12, angle: 0, hitFlash: 0, ...props };
  game.enemies.push(item);
  return item;
};
const quiet = game => { game.spawnTimer = 9999; };

test('seeded waves and maps are repeatable and original arenas remain traversable', () => {
  const first = new Game({ seed: 37 }), second = new Game({ seed: 37 });
  assert.deepEqual(first.spawnQueue, second.spawnQueue);
  for (const map of MAPS) {
    const game = new Game({ mapId: map.id });
    assert.equal(game.isBodyFree(game.player.x, game.player.y, game.player.radius), true);
    for (const point of map.spawnPoints) assert.equal(game.isBodyFree(point.x, point.y, 25), true);
    const field = game.buildFlowField(25);
    for (const point of map.spawnPoints) {
      const index = Math.floor(point.y / field.cell) * field.cols + Math.floor(point.x / field.cell);
      assert.ok(field.distances[index] >= 0, `${map.id}: spawn connects to player`);
    }
  }
});

test('shield absorbs damage first and health only takes the remainder', () => {
  const game = new Game();
  game.player.shield = 20;
  game.damagePlayer(12);
  assert.equal(game.player.shield, 8);
  assert.equal(game.player.hp, 100);
  game.damagePlayer(18);
  assert.equal(game.player.shield, 0);
  assert.equal(game.player.hp, 90);
});

test('crowd damage uses one grace interval and enemies do not block player movement', () => {
  const game = new Game(); quiet(game);
  for (let i = 0; i < 8; i++) enemy(game, { x: game.player.x, y: game.player.y });
  game.update(1 / 60, { moveX: 1 });
  assert.equal(game.player.shield, 23);
  assert.ok(game.player.x > 640);
  game.update(1 / 60, { moveX: 1 });
  assert.equal(game.player.shield, 23);
});

test('empty pistol reloads automatically forever without exhausting reserve', () => {
  const game = new Game(); quiet(game);
  const ammo = game.player.weapons.pistol;
  ammo.clip = 0;
  game.update(1 / 60, { shoot: true, aimX: 1000, aimY: 380 });
  assert.ok(ammo.reloadRemaining > 0);
  tick(game, WEAPONS.pistol.reloadTime + 0.03);
  assert.equal(ammo.clip, WEAPONS.pistol.clipSize);
  assert.equal(ammo.reserve, Infinity);
  tick(game, 8, { shoot: true, aimX: 1000, aimY: 380 });
  assert.equal(ammo.reserve, Infinity);
  assert.ok(ammo.clip > 0 || ammo.reloadRemaining > 0);
});

test('finite ammo reload only transfers available rounds and hand pistol remains usable', () => {
  const game = new Game(); quiet(game);
  game.player.weapons.smg = game.makeAmmo('smg');
  game.equipWeapon('smg');
  const ammo = game.player.weapons.smg;
  ammo.clip = 0; ammo.reserve = 4;
  assert.equal(game.tryReload(), true);
  tick(game, WEAPONS.smg.reloadTime + 0.03);
  assert.equal(ammo.clip, 4); assert.equal(ammo.reserve, 0);
  ammo.clip = 0;
  assert.equal(game.tryReload(), false);
  assert.equal(game.equipWeapon('pistol'), true);
  game.update(1 / 60, { shoot: true, aimX: 900, aimY: 380 });
  assert.equal(game.player.weapons.pistol.clip, WEAPONS.pistol.clipSize - 1);
});

test('sniper uses swept collision and pierces enemies crossed within a single frame', () => {
  const game = new Game(); quiet(game);
  game.player.weapons.sniper = game.makeAmmo('sniper');
  game.equipWeapon('sniper');
  enemy(game, { x: 696, hp: 120 });
  enemy(game, { x: 770, hp: 120 });
  enemy(game, { x: 838, hp: 120 });
  game.update(0.1, { shoot: true, aimX: 1100, aimY: 380 });
  assert.equal(game.kills, 3);
  assert.equal(game.enemies.length, 0);
});

test('bullets are stopped by obstacles before reaching enemies behind them', () => {
  const game = new Game(); quiet(game);
  game.player.x = 170; game.player.y = 200;
  const target = enemy(game, { x: 440, y: 200 });
  game.update(0.1, { shoot: true, aimX: 600, aimY: 200 });
  tick(game, 0.4);
  assert.equal(target.hp, target.maxHp);
  assert.equal(game.kills, 0);
});

test('grenade button is edge triggered, consumes inventory, and explodes after fuse', () => {
  const game = new Game(); quiet(game);
  enemy(game, { x: 850, hp: 100 });
  game.update(1 / 60, { grenade: true, aimX: 1000, aimY: 380 });
  assert.equal(game.player.grenades, 2);
  tick(game, 0.8, { grenade: true });
  assert.equal(game.player.grenades, 2);
  assert.equal(game.kills, 0);
  tick(game, 0.3, { grenade: true });
  assert.equal(game.kills, 1);
  assert.equal(game.grenades.length, 0);
  assert.ok(game.effects.some(effect => effect.type === 'explosion'));
});

test('duplicate weapon drops fill the matching ammo without forcing a weapon change', () => {
  const game = new Game(); quiet(game);
  game.player.weapons.rifle = game.makeAmmo('rifle');
  game.player.weapons.rifle.clip = 0;
  game.player.weapons.rifle.reserve = 0;
  game.spawnPickup('weapon', game.player.x, game.player.y, { weaponId: 'rifle' });
  game.update(1 / 60);
  assert.equal(game.player.currentWeapon, 'pistol');
  assert.equal(game.player.weapons.rifle.clip, WEAPONS.rifle.clipSize);
  assert.equal(game.player.weapons.rifle.reserve, WEAPONS.rifle.reserveMax);
});

test('wave cleanup immediately starts the next wave, clears live attacks and grants supplies', () => {
  const game = new Game();
  for (let wave = 1; wave <= 7; wave++) {
    game.spawnQueue = [];
    game.enemies = [];
    game.bullets.push({ life: 1 });
    game.grenades.push({ fuse: 1 });
    game.clearWave();
    assert.equal(game.status, 'playing');
    assert.equal(game.wave, wave + 1);
    assert.ok(game.spawnQueue.length > 0);
    assert.equal(game.bullets.length, 0);
    assert.equal(game.grenades.length, 0);
    assert.ok(game.pickups.some(pickup => pickup.guaranteed && pickup.type === 'grenade'));
  }
  assert.equal(game.wave, 8);
  assert.deepEqual(Object.keys(game.player.weapons), ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper']);
});

test('killing the last enemy advances in the same update and preserves player state and input', () => {
  const game = new Game();
  game.spawnQueue = [];
  enemy(game, { x: 700, hp: 1 });
  game.update(1 / 60, { shoot: true, aimX: 740, aimY: 380 });
  assert.equal(game.kills, 1);
  assert.equal(game.wave, 2);
  assert.equal(game.status, 'playing');
  assert.equal(game.player.hp, 100);
  assert.equal(game.player.shield, 35);
  assert.equal(game.player.grenades, 3);
  assert.equal(game.player.currentWeapon, 'pistol');
  assert.equal(game.player.weapons.pistol.clip, 11);
  assert.ok(game.player.weapons.smg);
  assert.deepEqual(game.events.filter(event => ['waveClear', 'unlock', 'wave'].includes(event.type)), [
    { type: 'waveClear', wave: 1 },
    { type: 'unlock', weaponId: 'smg' },
    { type: 'wave', wave: 2 },
  ]);
  const x = game.player.x;
  game.update(1 / 60, { moveX: 1 });
  assert.ok(game.player.x > x);
  assert.equal(game.wave, 2, 'the new spawn queue prevents clearing another wave immediately');
});

test('ten cleared waves produce victory and terminal states do not advance', () => {
  const game = new Game();
  game.wave = MAX_WAVES;
  game.spawnQueue = []; game.enemies = [];
  game.update(1 / 60);
  assert.equal(game.status, 'won');
  assert.equal(game.wave, MAX_WAVES);
  assert.equal(game.spawnQueue.length, 0);
  const time = game.time;
  game.update(0.1, { moveX: 1, shoot: true });
  assert.equal(game.time, time);
  const dead = new Game(); dead.player.hp = 0;
  dead.update(1 / 60);
  assert.equal(dead.status, 'dead');
  const fresh = new Game();
  assert.equal(fresh.wave, 1); assert.equal(fresh.player.hp, 100);
});

test('dt is bounded and player slides along obstacles without crossing them', () => {
  const game = new Game(); quiet(game);
  game.player.x = 220; game.player.y = 200;
  game.update(200, { moveX: 1, moveY: 1 });
  assert.ok(game.time <= 0.1);
  assert.ok(game.player.x <= 222);
  assert.ok(game.player.y > 200);
  assert.equal(game.isBodyFree(game.player.x, game.player.y, game.player.radius), true);
});

test('enemy routes around a planter instead of remaining pinned against its wall', () => {
  for (const [startX, targetX] of [[160, 480], [480, 160]]) {
    const game = new Game(); quiet(game);
    game.player.x = targetX; game.player.y = 200;
    const walker = enemy(game, { x: startX, y: 200, speed: 90 });
    tick(game, 8);
    assert.ok(Math.hypot(walker.x - game.player.x, walker.y - game.player.y) < 65);
    assert.equal(game.isBodyFree(walker.x, walker.y, walker.radius), true);
  }
});

test('a health pickup cannot resurrect the player after lethal contact in the same frame', () => {
  const game = new Game(); quiet(game);
  game.player.hp = 1; game.player.shield = 0;
  enemy(game, { x: game.player.x, y: game.player.y });
  game.spawnPickup('health', game.player.x, game.player.y);
  game.update(1 / 60);
  assert.equal(game.status, 'dead');
  assert.equal(game.player.hp, 0);
});

test('rounded obstacle sweeps permit tangent egress while retaining solid cover', () => {
  const rect = { x: 560, y: 560, w: 160, h: 80 };
  assert.equal(segmentRoundedRect(736, 540, 780, 500, rect, 25), null);
  assert.equal(segmentRoundedRect(745, 600, 790, 600, rect, 25), null);
  assert.equal(segmentRoundedRect(745, 600, 700, 600, rect, 25), 0);
  assert.notEqual(segmentRoundedRect(520, 600, 760, 600, rect, 25), null);
  assert.equal(segmentRoundedRect(520, 535, 760, 535, rect, 25), null);
});

test('all enemy radii escape rounded planter corners and reach a stationary player', () => {
  const cases = [
    { cornerX: 720, cornerY: 560, sx: 1, sy: -1, targetX: 90, targetY: 670 },
    { cornerX: 560, cornerY: 560, sx: -1, sy: -1, targetX: 1190, targetY: 670 },
    { cornerX: 720, cornerY: 640, sx: 1, sy: 1, targetX: 90, targetY: 90 },
    { cornerX: 560, cornerY: 640, sx: -1, sy: 1, targetX: 1190, targetY: 90 },
  ];
  for (const radius of [14, 17, 25]) for (const setup of cases) {
    const game = new Game();
    game.spawnQueue = [];
    game.player.x = setup.targetX; game.player.y = setup.targetY; game.player.hp = 10000;
    // Radius-25 upper-right case reproduces the observed tank at (736, 540).
    const x = setup.cornerX + setup.sx * 16 * radius / 25;
    const y = setup.cornerY + setup.sy * 20 * radius / 25;
    const walker = enemy(game, { x, y, radius, speed: 44, type: radius === 25 ? 'tank' : radius === 14 ? 'runner' : 'grunt' });
    assert.equal(game.isBodyFree(x, y, radius), true);
    for (let i = 0; i < 1000; i++) game.update(0.1);
    assert.ok(Math.hypot(walker.x - game.player.x, walker.y - game.player.y) < 45,
      `radius ${radius}, corner (${setup.cornerX}, ${setup.cornerY}): walker at ${walker.x}, ${walker.y}`);
    assert.equal(game.isBodyFree(walker.x, walker.y, radius), true);
  }
});
