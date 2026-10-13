import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, BOSS_ATTACK, MAPS, MAX_WAVES } from '../src/game.js';

const advance = (game, seconds, input = {}) => {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(1 / 60, remaining);
    game.update(dt, input);
    remaining -= dt;
  }
};

const advanceEnemies = (game, seconds) => {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(1 / 60, remaining);
    game.updateEnemies(dt);
    remaining -= dt;
  }
};

const arena = ({ cover = false } = {}) => {
  const game = new Game({ seed: 13 });
  if (!cover) game.map = { ...game.map, obstacles: [] };
  // Keep the current wave active without introducing unrelated enemies.
  game.spawnQueue = ['grunt'];
  game.spawnTimer = 9999;
  return game;
};

const spawnBoss = (game, props = {}) => {
  game.spawnQueue = ['tank'];
  game.spawnTimer = 0;
  game.updateSpawns(0);
  const boss = game.enemies.at(-1);
  Object.assign(boss, { x: 300, y: 380, speed: 0 }, props);
  game.spawnQueue = ['grunt'];
  game.spawnTimer = 9999;
  return boss;
};

const hostileBullet = (game, props = {}) => {
  const bullet = {
    id: game.nextId++, owner: 'enemy', x: 600, y: 380, prevX: 600, prevY: 380,
    vx: 1000, vy: 0, radius: BOSS_ATTACK.radius, damage: BOSS_ATTACK.damage,
    remainingHits: 1, hitIds: new Set(), life: BOSS_ATTACK.life, ...props,
  };
  game.bullets.push(bullet);
  return bullet;
};

const beginCharge = (game, boss) => {
  boss.rangedCooldown = 0;
  game.updateEnemies(1 / 60);
  assert.ok(boss.rangedCharge > 0, 'boss enters its visible windup before shooting');
};

test('ordinary enemies increase each wave and purple bosses increase predictably every two waves', () => {
  for (const seed of [1, 13, 71]) {
    let previousRegular = 0, previousBosses = 0;
    for (let wave = 1; wave <= MAX_WAVES; wave++) {
      const game = new Game({ seed });
      game.wave = wave - 1;
      game.status = 'intermission';
      game.startNextWave();
      const bosses = game.spawnQueue.filter(type => type === 'tank').length;
      const regular = game.spawnQueue.filter(type => type === 'grunt' || type === 'runner').length;
      assert.equal(regular, 5 + wave * 3, `seed ${seed}, wave ${wave}: ordinary count`);
      assert.equal(bosses, Math.floor((wave - 1) / 2), `seed ${seed}, wave ${wave}: boss count`);
      assert.equal(game.spawnQueue.length, regular + bosses);
      assert.equal(game.waveTotal, regular + bosses);
      assert.ok(regular > previousRegular);
      assert.ok(bosses >= previousBosses);
      assert.equal(game.spawnQueue.includes('boss'), false, 'existing purple tanks remain the boss type');
      previousRegular = regular;
      previousBosses = bosses;
    }
  }
});

test('the existing purple boss retains its size and health and can navigate from every map spawn', () => {
  for (const map of MAPS) {
    const game = new Game({ mapId: map.id });
    const boss = spawnBoss(game);
    assert.equal(boss.type, 'tank');
    assert.equal(boss.radius, 25);
    assert.equal(boss.maxHp, 170);
    const field = game.buildFlowField(boss.radius);
    for (const point of map.spawnPoints) {
      assert.equal(game.isBodyFree(point.x, point.y, boss.radius), true,
        `${map.id}: boss fits spawn (${point.x}, ${point.y})`);
      const index = Math.floor(point.y / field.cell) * field.cols + Math.floor(point.x / field.cell);
      assert.ok(field.distances[index] >= 0,
        `${map.id}: boss can leave spawn (${point.x}, ${point.y})`);
    }
  }
});

test('boss emits a three-projectile volley periodically after a telegraphed windup', () => {
  const game = arena();
  const boss = spawnBoss(game);
  advanceEnemies(game, BOSS_ATTACK.interval - BOSS_ATTACK.windup - 0.02);
  assert.equal(game.bullets.length, 0);
  advanceEnemies(game, 0.04);
  assert.ok(boss.rangedCharge > 0);
  assert.equal(game.bullets.length, 0, 'charging does not immediately deal ranged damage');
  advanceEnemies(game, BOSS_ATTACK.windup + 0.02);
  assert.equal(game.bullets.length, 3);
  for (const bullet of game.bullets) {
    assert.equal(bullet.owner, 'enemy');
    assert.ok(Math.abs(Math.hypot(bullet.vx, bullet.vy) - BOSS_ATTACK.bulletSpeed) < 1e-8);
  }
  advanceEnemies(game, BOSS_ATTACK.interval - 0.1);
  assert.equal(game.bullets.length, 3, 'next volley waits for the next full attack cycle');
  advanceEnemies(game, 0.15);
  assert.equal(game.bullets.length, 6);
});

test('successive purple boss spawns retain separate attack timers instead of firing together', () => {
  const game = arena();
  game.spawnQueue = ['tank', 'tank'];
  game.spawnTimer = 0;
  game.updateSpawns(0);
  Object.assign(game.enemies[0], { x: 300, y: 250, speed: 0 });
  const spawnGap = game.spawnTimer;
  advance(game, spawnGap + 0.05);
  assert.equal(game.enemies.length, 2);
  Object.assign(game.enemies[1], { x: 300, y: 500, speed: 0 });
  game.spawnQueue = ['grunt'];
  game.spawnTimer = 9999;

  advanceEnemies(game, BOSS_ATTACK.interval - game.time + 0.05);
  assert.equal(game.bullets.length, 3, 'the older boss shoots before the newly spawned boss');
  advanceEnemies(game, spawnGap + 0.05);
  assert.equal(game.bullets.length, 6, 'the newer boss shoots after its own full attack cycle');
});

test('boss stops during windup, locks its aim, and a player can sidestep the volley', () => {
  const game = arena();
  game.player.x = 750;
  const boss = spawnBoss(game, { speed: 45 });
  beginCharge(game, boss);
  const start = { x: boss.x, y: boss.y };
  advance(game, BOSS_ATTACK.windup - 0.05, { moveY: 1 });
  assert.equal(boss.x, start.x);
  assert.equal(boss.y, start.y);
  advance(game, 0.1, { moveY: 1 });
  const shots = game.bullets.filter(bullet => bullet.owner === 'enemy');
  assert.equal(shots.length, 3);
  const straightShot = shots.find(bullet => Math.abs(bullet.vy) < 1e-8);
  assert.ok(straightShot, 'the center shot retains the pre-movement target direction');
  assert.ok(straightShot.vx > 0);
  advance(game, 2);
  assert.equal(game.player.hp, 100);
  assert.equal(game.player.shield, 35);
});

test('enemy projectiles sweep through the player, use shields, and share contact damage grace', () => {
  const game = arena();
  game.player.shield = 10;
  for (let i = 0; i < 3; i++) hostileBullet(game);
  game.update(0.1);
  assert.equal(game.player.shield, 0);
  assert.equal(game.player.hp, 100 - (BOSS_ATTACK.damage - 10));
  assert.equal(game.bullets.length, 0, 'every projectile disappears on contact during grace');

  hostileBullet(game);
  game.update(0.1);
  assert.equal(game.player.hp, 100 - (BOSS_ATTACK.damage - 10));
  assert.equal(game.bullets.length, 0);

  // A melee attacker cannot add damage during a projectile hit's grace interval.
  game.enemies.push({ id: game.nextId++, type: 'grunt', x: game.player.x, y: game.player.y,
    radius: 17, hp: 40, maxHp: 40, speed: 0, damage: 12, angle: 0, hitFlash: 0 });
  advance(game, 0.1);
  assert.equal(game.player.hp, 100 - (BOSS_ATTACK.damage - 10));
  game.enemies = [];
  advance(game, 0.6);
  hostileBullet(game);
  game.update(0.1);
  assert.equal(game.player.hp, 100 - (BOSS_ATTACK.damage - 10) - BOSS_ATTACK.damage);
});

test('cover stops enemy projectiles before players, including a muzzle adjacent to a wall', () => {
  const swept = arena({ cover: true });
  swept.player.x = 440; swept.player.y = 200;
  hostileBullet(swept, { x: 170, y: 200, vx: 4000 });
  swept.update(0.1);
  assert.equal(swept.player.shield, 35);
  assert.equal(swept.bullets.length, 0);

  const muzzle = arena({ cover: true });
  muzzle.player.x = 440; muzzle.player.y = 200;
  const boss = spawnBoss(muzzle, { x: 207, y: 200 });
  assert.equal(muzzle.isBodyFree(boss.x, boss.y, boss.radius), true);
  beginCharge(muzzle, boss);
  advance(muzzle, BOSS_ATTACK.windup + 1);
  assert.equal(muzzle.player.shield, 35);
  assert.equal(muzzle.player.hp, 100);
  assert.equal(muzzle.bullets.filter(bullet => bullet.owner === 'enemy').length, 0);
});

test('enemy projectiles pass other enemies without damaging them and hit a player before later cover', () => {
  const game = arena({ cover: true });
  game.player.x = 200; game.player.y = 200;
  const ally = { id: game.nextId++, type: 'grunt', x: 155, y: 200,
    radius: 17, hp: 40, maxHp: 40, speed: 0, damage: 12, angle: 0, hitFlash: 0 };
  game.enemies.push(ally);
  hostileBullet(game, { x: 100, y: 200, vx: 4000 });
  game.update(0.1);
  assert.equal(ally.hp, 40);
  assert.equal(game.player.shield, 35 - BOSS_ATTACK.damage);
  assert.equal(game.bullets.length, 0);
});

test('killing a charging boss with a bullet or grenade cancels its pending volley in that frame', () => {
  for (const method of ['bullet', 'grenade']) {
    const game = arena();
    const boss = spawnBoss(game, { x: 700, hp: 1 });
    beginCharge(game, boss);
    boss.rangedCharge = 0.01;
    if (method === 'grenade') {
      game.grenades.push({ id: game.nextId++, x: boss.x, y: boss.y, radius: 7,
        angle: 0, vx: 0, vy: 0, fuse: 0.01, maxFuse: 1.05, travelRemaining: 0 });
    }
    game.update(0.1, method === 'bullet' ? { shoot: true, aimX: boss.x, aimY: boss.y } : {});
    assert.equal(game.kills, 1, method);
    assert.equal(game.enemies.length, 0, method);
    assert.equal(game.bullets.filter(bullet => bullet.owner === 'enemy').length, 0, method);
  }
});

test('wave completion clears hostile projectiles and terminal states freeze pending attacks', () => {
  const cleared = arena();
  hostileBullet(cleared);
  cleared.spawnQueue = [];
  cleared.clearWave();
  assert.equal(cleared.status, 'intermission');
  assert.equal(cleared.bullets.length, 0);

  for (const status of ['dead', 'won']) {
    const game = arena();
    const boss = spawnBoss(game);
    beginCharge(game, boss);
    game.status = status;
    const charge = boss.rangedCharge;
    const time = game.time;
    advance(game, BOSS_ATTACK.interval * 2);
    assert.equal(boss.rangedCharge, charge, status);
    assert.equal(game.time, time, status);
    assert.equal(game.bullets.length, 0, status);
  }
});
