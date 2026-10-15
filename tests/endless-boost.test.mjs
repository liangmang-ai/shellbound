import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, BOOST_RULES, WEAPONS, getWaveComposition } from '../src/game.js';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);

function quiet() {
  const game = new Game({ seed: 47 });
  game.map = { ...game.map, width: 10000, height: 10000, obstacles: [] };
  game.player.x = 2000; game.player.y = 2000; game.player.angle = 0;
  game.spawnTimer = 9999;
  return game;
}

function advance(game, seconds, input = {}) {
  for (let remaining = seconds; remaining > 1e-9;) {
    const dt = Math.min(.01, remaining);
    game.update(dt, input);
    remaining -= dt;
  }
}

function target(game, hp = 1) {
  const enemy = { id: game.nextId++, type: 'grunt', x: 2200, y: 2000,
    radius: 17, hp, maxHp: hp, speed: 0, damage: 12, angle: 0, hitFlash: 0 };
  game.enemies.push(enemy);
  return enemy;
}

test('a boost spends stored inventory, extends duration and does not repeatedly accelerate one pending shot', () => {
  const game = quiet(), p = game.player, ammo = p.weapons.pistol;
  assert.equal(p.boostCharges, 1);
  ammo.cooldown = WEAPONS.pistol.fireInterval;
  assert.equal(game.activateBoost(), true);
  assert.equal(p.boostCharges, 0); assert.equal(p.boostRemaining, 8);
  near(ammo.cooldown, WEAPONS.pistol.fireInterval / 2);
  assert.equal(game.activateBoost(), false);
  assert.equal(p.boostRemaining, 8);
  advance(game, 2);
  near(p.boostRemaining, 6);
  game.spawnPickup('boost', p.x, p.y);
  game.update(.01);
  assert.equal(p.boostCharges, 1);
  ammo.cooldown = .1;
  assert.equal(game.activateBoost(), true);
  near(p.boostRemaining, 13.99);
  near(ammo.cooldown, .1);
  assert.deepEqual(game.events.at(-1), { type: 'boostActivation', remaining: p.boostRemaining, charges: 0 });
  p.boostCharges = BOOST_RULES.maxCharges;
  game.spawnPickup('boost', p.x, p.y); game.update(.01);
  assert.equal(p.boostCharges, BOOST_RULES.maxCharges);
});

test('holding boost consumes one charge and a released second press adds eight seconds', () => {
  const game = quiet(), p = game.player;
  p.boostCharges = 3;
  advance(game, 1, { boost: true });
  assert.equal(p.boostCharges, 2);
  near(p.boostRemaining, 7.01);
  game.update(.01);
  game.update(.01, { boost: true });
  assert.equal(p.boostCharges, 1);
  near(p.boostRemaining, 14.99);
  game.player.hp = 0; game.status = 'dead';
  const remaining = p.boostRemaining, charges = p.boostCharges;
  advance(game, 4, { boost: true });
  assert.equal(p.boostRemaining, remaining); assert.equal(p.boostCharges, charges);
  assert.equal(game.activateBoost(), false);
  assert.equal(game.revive(), true);
  assert.equal(p.boostRemaining, remaining); assert.equal(p.boostCharges, charges);
  game.update(.01, { boost: true });
  assert.equal(p.boostCharges, 0);
  near(p.boostRemaining, remaining + 7.99);
});

test('boost accelerates every equipped gun while keeping original damage, pellet count and travel range', () => {
  for (const [id, def] of Object.entries(WEAPONS)) {
    const game = quiet(), p = game.player;
    p.weapons[id] = game.makeAmmo(id); game.equipWeapon(id);
    game.fire();
    const normal = game.bullets[0];
    const normalSpeed = Math.hypot(normal.vx, normal.vy), originalLife = normal.life;
    p.weapons[id] = game.makeAmmo(id);
    game.activateBoost(); game.fire();
    const boosted = game.bullets.at(-1);
    near(Math.hypot(boosted.vx, boosted.vy), normalSpeed * 2);
    near(Math.hypot(normal.vx, normal.vy), normalSpeed);
    near(boosted.life, originalLife / 2);
    near(p.weapons[id].cooldown, def.fireInterval / 2);
    assert.equal(boosted.damage, normal.damage);
    assert.equal(game.bullets.length, (def.pellets || 1) * 2);
    for (let frame = 0; frame < 30; frame++) game.updateBullets(.1);
    const originalRange = def.range || def.bulletSpeed * (id === 'sniper' ? 1.1 : .95);
    near(normal.distanceTravelled, originalRange);
    near(boosted.distanceTravelled, originalRange);
  }
});

test('boost doubles sustained trigger cadence, survives gun switches and expires into ordinary fire', () => {
  const normal = quiet(), boosted = quiet();
  boosted.activateBoost();
  advance(normal, .9, { shoot: true }); advance(boosted, .9, { shoot: true });
  assert.equal(12 - normal.player.weapons.pistol.clip, 4);
  assert.equal(12 - boosted.player.weapons.pistol.clip, 8);
  boosted.player.weapons.smg = boosted.makeAmmo('smg'); boosted.equipWeapon('smg');
  boosted.fire();
  near(boosted.player.weapons.smg.cooldown, WEAPONS.smg.fireInterval / 2);
  advance(boosted, 7.1);
  near(boosted.player.boostRemaining, 0);
  const ammo = boosted.player.weapons.smg;
  ammo.cooldown = 0; boosted.fire();
  near(ammo.cooldown, WEAPONS.smg.fireInterval);
  near(Math.hypot(boosted.bullets.at(-1).vx, boosted.bullets.at(-1).vy), WEAPONS.smg.bulletSpeed);
  assert.equal(boosted.player.weapons.pistol.reserve, Infinity, 'automatic ammunition behavior remains available');
});

test('only a fresh kill rolls a boost drop and the separate roll preserves ordinary loot chances', () => {
  const game = quiet();
  let rolls = [.119999, .01]; game.random = () => rolls.shift() ?? .9;
  const victim = target(game);
  game.damageEnemy(victim, 1);
  assert.deepEqual(game.pickups.map(item => item.type), ['boost', 'ammo']);
  const count = game.pickups.length;
  game.damageEnemy(victim, 1);
  game.damageEnemy(target(game), 0);
  assert.equal(game.pickups.length, count, 'dead or undamaged targets do not duplicate drops');
  rolls = [.12, .01];
  game.damageEnemy(target(game), 1);
  assert.deepEqual(game.pickups.slice(count).map(item => item.type), ['ammo'], 'boost boundary leaves the ammo roll independent');
  const boostCount = game.pickups.filter(item => item.type === 'boost').length;
  game.clearWave();
  assert.equal(game.pickups.filter(item => item.type === 'boost').length, boostCount, 'wave rewards do not manufacture boost charges');
});

test('endless waves keep increasing both mobs and bosses and grant supplies after the old final wave', () => {
  for (const difficultyId of ['easy', 'normal', 'hard']) {
    let previous = getWaveComposition(10, difficultyId);
    for (const wave of [11, 20, 30, 100, 1000]) {
      const current = getWaveComposition(wave, difficultyId);
      assert.ok(current.regularCount > previous.regularCount);
      assert.ok(current.tankCount > previous.tankCount);
      previous = current;
      const game = new Game({ seed: 53, difficultyId });
      game.wave = wave; game.spawnQueue = []; game.enemies = [];
      game.update(.01);
      assert.equal(game.wave, wave); assert.equal(game.status, 'intermission');
      assert.equal(game.intermissionRemaining, 3);
      game.update(3);
      assert.equal(game.wave, wave + 1); assert.equal(game.status, 'playing');
      assert.equal(game.waveTotal, getWaveComposition(wave + 1, difficultyId).total);
      assert.ok(game.pickups.some(item => item.type === 'ammo' && item.guaranteed));
      assert.equal(game.events.some(item => item.type === 'won'), false);
    }
  }
});

test('lazy queues stay bounded for very late waves, deterministic peeks do not lose or repeat queued enemies', () => {
  const game = new Game({ seed: 101 });
  game.wave = 999999999; game.status = 'intermission'; game.startNextWave();
  assert.equal(game.wave, 1000000000);
  assert.equal(game.spawnQueue.length, getWaveComposition(game.wave).total);
  assert.equal(Array.isArray(game.spawnQueue), false);
  assert.ok(JSON.stringify(game.spawnQueue).length < 500, 'storage has constant size instead of billions of elements');
  const initial = game.spawnQueue.length;
  assert.equal(game.spawnQueue[0], 'tank'); assert.equal(game.spawnQueue[0], 'tank');
  assert.equal(game.spawnQueue.length, initial);
  assert.equal(game.spawnQueue.shift(), 'tank');
  assert.equal(game.spawnQueue.length, initial - 1);
  game.spawnQueue = [];
  game.clearWave();
  assert.equal(game.wave, 1000000000);
  game.update(3);
  assert.equal(game.wave, 1000000001, 'custom queue replacement has no hidden pending population');
  const small = new Game({ seed: 101 });
  small.wave = 9; small.status = 'intermission'; small.startNextWave();
  const planned = [...small.spawnQueue], queueLength = small.spawnQueue.length;
  assert.deepEqual([...small.spawnQueue], planned);
  assert.equal(small.spawnQueue.length, queueLength, 'iteration is a detached preview');
  const emitted = [];
  while (small.spawnQueue.length) emitted.push(small.spawnQueue.shift());
  assert.deepEqual(emitted, planned); assert.equal(small.spawnQueue[0], undefined);
  for (const wave of [NaN, Infinity, -1, 1e308]) {
    const composition = getWaveComposition(wave);
    assert.ok(Number.isSafeInteger(composition.total));
    assert.ok(composition.total > 0);
  }
});

test('late waves bound simultaneous bodies and enemy speeds while health still rises', () => {
  const game = new Game({ seed: 67, difficultyId: 'hard' });
  game.wave = 99; game.status = 'intermission'; game.startNextWave();
  for (let attempt = 0; attempt < 120; attempt++) {
    game.spawnTimer = 0; game.updateSpawns(0);
  }
  assert.equal(game.enemies.length, 36);
  assert.ok(game.enemies.filter(item => item.type === 'tank').length > 4);
  const pending = game.spawnQueue.length;
  game.spawnTimer = 0; game.updateSpawns(.1);
  assert.equal(game.spawnQueue.length, pending, 'a full battlefield preserves every waiting enemy');
  for (const enemy of game.enemies) assert.ok(enemy.speed < game.player.speed);
  for (const type of ['grunt', 'runner', 'tank']) {
    const stats = [];
    for (const wave of [10, 100]) {
      const sample = new Game({ difficultyId: 'hard' });
      sample.wave = wave; sample.spawnQueue = [type]; sample.spawnTimer = 0; sample.updateSpawns(0);
      stats.push(sample.enemies[0]);
      assert.ok(sample.enemies[0].speed <= 190);
      assert.ok(sample.spawnTimer > 0);
    }
    assert.ok(stats[1].maxHp > stats[0].maxHp, `${type} keeps gaining health after wave ten`);
  }
});
