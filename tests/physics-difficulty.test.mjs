import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MAPS, DIFFICULTIES, BOSS_ATTACK, BARREL_RULES, getWaveComposition } from '../src/game.js';

const quiet = (options = {}) => {
  const game = new Game({ seed: 27, ...options });
  game.spawnQueue = ['grunt']; game.spawnTimer = 9999;
  return game;
};
const enemy = (game, props = {}) => {
  const item = { id: game.nextId++, type: 'grunt', x: 740, y: 380,
    radius: 17, hp: 10000, maxHp: 10000, speed: 80, damage: 12, angle: 0, hitFlash: 0, ...props };
  game.enemies.push(item);
  return item;
};
const close = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);
};
function assertSolid(game) {
  const bodies = [game.player, ...game.enemies.filter(item => item.hp > 0)];
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    assert.equal(game.isBodyFree(a.x, a.y, a.radius), true, `body ${a.id || 'player'} fits the arena`);
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j], distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(distance >= a.radius + b.radius - 1e-6,
        `bodies ${a.id || 'player'} / ${b.id || 'player'} overlap by ${a.radius + b.radius - distance}`);
    }
  }
}

test('difficulty selection is explicit, defaults to standard, and unknown values stay standard', () => {
  assert.deepEqual(Object.values(DIFFICULTIES).map(item => [item.id, item.label]),
    [['easy', '休闲'], ['normal', '标准'], ['hard', '挑战']]);
  assert.equal(new Game().difficulty, DIFFICULTIES.normal);
  for (const id of ['missing', 'toString', '__proto__', null, undefined]) {
    assert.equal(new Game({ difficultyId: id }).difficulty, DIFFICULTIES.normal);
    assert.deepEqual(getWaveComposition(5, id), getWaveComposition(5));
  }
  assert.equal(new Game({ difficultyId: 'easy' }).difficulty, DIFFICULTIES.easy);
});

test('all difficulties increase wave pressure, with a visibly smaller casual crowd and fewer late bosses', () => {
  const previous = { easy: 0, normal: 0, hard: 0 };
  for (let wave = 1; wave <= 10; wave++) {
    const easy = getWaveComposition(wave, 'easy'), normal = getWaveComposition(wave), hard = getWaveComposition(wave, 'hard');
    assert.equal(normal.regularCount, 5 + wave * 3);
    assert.equal(normal.tankCount, Math.floor((wave - 1) / 2));
    assert.ok(easy.regularCount <= Math.ceil(normal.regularCount * .65));
    assert.ok(hard.regularCount > normal.regularCount);
    assert.ok(easy.tankCount <= normal.tankCount);
    assert.ok(hard.tankCount >= normal.tankCount);
    for (const id of ['easy', 'normal', 'hard']) {
      const game = new Game({ seed: 3, difficultyId: id });
      game.wave = wave - 1; game.status = 'intermission'; game.startNextWave();
      const composition = getWaveComposition(wave, id);
      assert.equal(game.spawnQueue.filter(type => type !== 'tank').length, composition.regularCount);
      assert.equal(game.spawnQueue.filter(type => type === 'tank').length, composition.tankCount);
      assert.equal(game.waveTotal, composition.total);
      assert.ok(composition.regularCount > previous[id]);
      previous[id] = composition.regularCount;
    }
  }
  assert.equal(getWaveComposition(10, 'easy').tankCount, 2);
  assert.equal(getWaveComposition(10, 'hard').tankCount, 5);
  assert.deepEqual(getWaveComposition(NaN), getWaveComposition(1));
  assert.deepEqual(getWaveComposition(999), getWaveComposition(10));
});

test('casual enemies are weaker and slower, have gentler attacks and take longer to enter', () => {
  const groups = {};
  for (const difficultyId of ['easy', 'normal', 'hard']) {
    const game = quiet({ difficultyId });
    game.wave = 4; game.spawnQueue = ['grunt']; game.spawnTimer = 0; game.updateSpawns(0);
    groups[difficultyId] = { game, target: game.enemies[0], interval: game.spawnTimer };
  }
  for (const property of ['maxHp', 'speed', 'damage']) {
    assert.ok(groups.easy.target[property] < groups.normal.target[property]);
    assert.ok(groups.hard.target[property] > groups.normal.target[property]);
  }
  close(groups.normal.target.maxHp, Math.round(40 * (1 + 3 * .045)));
  close(groups.normal.target.speed, 67 * (1 + 3 * .025));
  close(groups.normal.target.damage, 12);
  assert.ok(groups.easy.interval > groups.normal.interval);
  assert.ok(groups.hard.interval < groups.normal.interval);
  for (const { game, target } of Object.values(groups)) {
    target.x = game.player.x + target.radius + game.player.radius + .001; target.y = game.player.y;
    target.speed = 0; game.update(.01);
    close(game.player.shield, 35 - target.damage, 1e-6);
  }
});

test('casual boss attacks give longer warnings and slower, lighter volleys; standard keeps its cadence', () => {
  const firstVolley = {};
  for (const difficultyId of ['easy', 'normal', 'hard']) {
    const game = quiet({ difficultyId });
    game.spawnQueue = ['tank']; game.spawnTimer = 0; game.updateSpawns(0);
    const boss = game.enemies[0];
    Object.assign(boss, { x: 100, y: 380, speed: 0 });
    game.map = { ...game.map, obstacles: [] };
    game.spawnQueue = ['grunt']; game.spawnTimer = 9999;
    let chargeStarted = null;
    for (let frame = 0; frame < 800 && !game.events.some(event => event.type === 'bossVolley'); frame++) {
      game.events = [];
      game.updateEnemies(.01);
      if (game.events.some(event => event.type === 'bossCharge')) chargeStarted = frame * .01;
      if (game.events.some(event => event.type === 'bossVolley')) firstVolley[difficultyId] = (frame + 1) * .01;
    }
    assert.notEqual(chargeStarted, null);
    assert.equal(game.bullets.length, 3);
    const shot = game.bullets[1];
    close(Math.hypot(shot.vx, shot.vy), BOSS_ATTACK.bulletSpeed * game.difficulty.bossBulletSpeedMultiplier);
    close(shot.damage, BOSS_ATTACK.damage * game.difficulty.damageMultiplier);
    close(firstVolley[difficultyId], game.difficulty.bossInterval, .02);
    assert.ok(firstVolley[difficultyId] - chargeStarted >= game.difficulty.bossWindup - .01);
  }
  assert.ok(firstVolley.easy > firstVolley.normal && firstVolley.normal > firstVolley.hard);
});

test('difficulty never changes barrel self damage or free revive resources', () => {
  for (const difficultyId of ['easy', 'normal', 'hard']) {
    const game = quiet({ mapId: 'greenhouse', difficultyId }), barrel = game.barrels[2];
    game.player.x = barrel.x; game.player.y = barrel.y; game.player.shield = 0;
    game.explodeBarrel(barrel);
    assert.equal(game.player.hp, 100 - BARREL_RULES.playerDamage);
    assert.equal(game.revivesRemaining, 3);
  }
});

test('the player stops at a circular enemy, can leave contact, and a defeated enemy stops blocking immediately', () => {
  const game = quiet();
  game.player.hp = 10000;
  const target = enemy(game, { x: game.player.x + 80, speed: 0 });
  const startY = game.player.y;
  for (let frame = 0; frame < 100; frame++) game.update(999, { moveX: 1 });
  assertSolid(game);
  close(game.player.x, target.x - target.radius - game.player.radius, .002);
  assert.equal(game.player.y, startY);
  assert.ok(game.player.hp < 10000, 'solid contact keeps dealing damage instead of creating invincibility');
  const touchingX = game.player.x;
  game.player.hp = 100; game.player.invulnerability = 1;
  game.update(.1, { moveX: -1 });
  assert.ok(game.player.x < touchingX - 20, 'touching bodies may move apart freely');
  game.player.x = touchingX; target.hp = 0;
  game.update(.1, { moveX: 1 });
  assert.ok(game.player.x > touchingX + 20, 'the dead body is no longer a collider');
});

test('an advancing enemy cannot push a stationary player, including into a wall', () => {
  const game = quiet();
  game.player.x = 220; game.player.y = 200; game.player.hp = 10000;
  const target = enemy(game, { x: 70, y: 200, speed: 110 });
  const initial = { x: game.player.x, y: game.player.y };
  for (let frame = 0; frame < 120; frame++) game.update(.1);
  close(game.player.x, initial.x); close(game.player.y, initial.y);
  assertSolid(game);
  close(Math.hypot(game.player.x - target.x, game.player.y - target.y), game.player.radius + target.radius, .002);
  assert.ok(game.player.hp < 10000);
});

test('enemy circles block each other at full radius even in a fast head-on sweep', () => {
  const game = quiet(); game.player.x = 640; game.player.y = 700;
  const a = enemy(game, { x: 500, y: 380, radius: 25, speed: 0 });
  const b = enemy(game, { x: 800, y: 380, radius: 14, speed: 0 });
  game.moveBody(a, 400, 0);
  close(a.x, b.x - a.radius - b.radius, .002);
  assertSolid(game);
  game.moveBody(b, -400, 0);
  assertSolid(game);
  assert.ok(a.x < b.x, 'the bodies cannot cross each other in a high-distance move');
});

test('diagonal sidesteps slide around a circular blocker while retaining a solid boundary', () => {
  const game = quiet(); const start = { x: game.player.x, y: game.player.y };
  const target = enemy(game, { x: start.x + 35.001, speed: 0 });
  for (let frame = 0; frame < 20; frame++) {
    game.update(.05, { moveX: 1, moveY: 1 });
    assertSolid(game);
  }
  assert.ok(game.player.y > start.y + 100);
  assert.ok(game.player.x > target.x, 'the player can run around instead of being pinned to the circle');
});

test('legacy overlaps recover without moving the player or pushing enemies through cover', () => {
  const game = quiet(); game.player.x = 215; game.player.y = 200;
  game.player.hp = 10000;
  const a = enemy(game, { x: game.player.x, y: game.player.y, speed: 0 });
  const b = enemy(game, { x: 205, y: 210, radius: 14, speed: 0 });
  const initial = { x: game.player.x, y: game.player.y };
  for (let frame = 0; frame < 300; frame++) {
    game.update(.01);
    close(game.player.x, initial.x); close(game.player.y, initial.y);
    assert.equal(game.isBodyFree(a.x, a.y, a.radius), true);
    assert.equal(game.isBodyFree(b.x, b.y, b.radius), true);
  }
  assertSolid(game);
});

test('spawns search an occupied entrance and defer instead of losing a queued enemy if every local landing is blocked', () => {
  const game = quiet();
  game.map = { ...game.map, spawnPoints: [{ x: 55, y: 380 }] };
  enemy(game, { x: 55, y: 380, radius: 25, speed: 0 });
  let spawned = 0;
  for (let count = 0; count < 18; count++) {
    game.spawnQueue = ['tank']; game.spawnTimer = 0; game.updateSpawns(0);
    if (game.spawnQueue.length) {
      assert.deepEqual(game.spawnQueue, ['tank']);
      assert.ok(game.spawnTimer > 0);
      break;
    }
    spawned += 1;
    assertSolid(game);
  }
  assert.ok(spawned >= 8, 'nearby valid landings keep an occupied entrance productive');
  const blocked = quiet();
  blocked.map = { ...blocked.map, spawnPoints: [{ x: 5, y: 5 }],
    obstacles: [{ x: 0, y: 0, w: 240, h: 240 }] };
  blocked.spawnQueue = ['tank', 'grunt']; blocked.spawnTimer = 0;
  blocked.updateSpawns(0);
  assert.deepEqual(blocked.spawnQueue, ['tank', 'grunt']);
  assert.equal(blocked.enemies.length, 0);
  assert.ok(blocked.spawnTimer > 0);
});

test('all selectable maps preserve non-overlapping bodies and cover under sustained movement with maximum frame steps', () => {
  for (const map of MAPS) {
    const game = new Game({ mapId: map.id, difficultyId: 'hard', seed: 91 });
    game.player.hp = 100000;
    game.wave = 10; game.spawnQueue = ['tank', ...Array(20).fill('runner')]; game.spawnTimer = 0;
    for (let frame = 0; frame < 700; frame++) {
      const angle = frame * .015;
      game.update(999, { moveX: Math.cos(angle), moveY: Math.sin(angle) });
      assertSolid(game);
    }
    assert.ok(game.enemies.length >= 20, 'the collision pressure includes a real spawned crowd');
  }
});
