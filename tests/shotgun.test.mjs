import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, WEAPONS, WEAPON_ORDER } from '../src/game.js';

const arena = () => {
  const game = new Game({ seed: 29 });
  game.map = { ...game.map, obstacles: [] };
  game.player.x = 100;
  game.player.y = 380;
  game.player.angle = 0;
  game.spawnQueue = ['grunt'];
  game.spawnTimer = 9999;
  game.player.weapons.shotgun = game.makeAmmo('shotgun');
  game.equipWeapon('shotgun');
  return game;
};
const target = (game, props = {}) => {
  const enemy = { id: game.nextId++, x: 210, y: 380, radius: 17, hp: 1000, maxHp: 1000,
    type: 'grunt', speed: 0, damage: 12, angle: 0, hitFlash: 0, ...props };
  game.enemies.push(enemy);
  return enemy;
};
const advanceBullets = (game, ticks = 4) => {
  for (let i = 0; i < ticks; i++) game.updateBullets(0.1);
};
const centerPelletOnly = game => {
  game.fire();
  game.bullets = game.bullets.filter(bullet => Math.abs(bullet.vy) < 1e-8);
  assert.equal(game.bullets.length, 1);
};

test('shotgun is the sixth slot, fires seven evenly spaced pellets, and consumes one shell', () => {
  const game = arena();
  assert.deepEqual(WEAPON_ORDER, ['pistol', 'smg', 'rifle', 'lmg', 'sniper', 'shotgun']);
  game.fire();
  assert.equal(game.player.weapons.shotgun.clip, 5);
  assert.equal(game.player.weapons.shotgun.reserve, 36);
  assert.equal(game.bullets.length, 7);
  const angles = game.bullets.map(bullet => Math.atan2(bullet.vy, bullet.vx));
  for (let i = 0; i < angles.length; i++) {
    assert.ok(Math.abs(angles[i] - (-0.30 + i * 0.10)) < 1e-10);
    assert.equal(game.bullets[i].weapon, 'shotgun');
    assert.equal(game.bullets[i].remainingHits, 1);
  }
  assert.equal(game.events.filter(event => event.type === 'shot').length, 1);
  game.fire();
  assert.equal(game.player.weapons.shotgun.clip, 5, 'cadence blocks a second immediate trigger');
});

test('all pellets stop at precisely 300 pixels even when final frame would overshoot', () => {
  const game = arena();
  game.fire();
  const traces = game.bullets.map(bullet => ({ bullet, startX: bullet.x, startY: bullet.y }));
  advanceBullets(game);
  assert.equal(game.bullets.length, 0);
  for (const { bullet, startX, startY } of traces) {
    assert.ok(Math.abs(bullet.distanceTravelled - WEAPONS.shotgun.range) < 1e-8);
    assert.ok(Math.abs(Math.hypot(bullet.x - startX, bullet.y - startY) - 300) < 1e-8);
  }
});

test('pellets cannot hit an enemy whose swept entry lies just beyond maximum range', () => {
  const game = arena();
  centerPelletOnly(game);
  const pellet = game.bullets[0];
  const enemy = target(game, { x: pellet.x + WEAPONS.shotgun.range + 17 + pellet.radius + 1 });
  advanceBullets(game);
  assert.equal(enemy.hp, 1000);
  assert.equal(game.bullets.length, 0);
});

test('damage falloff uses distance at the actual swept intersection rather than frame end', () => {
  const near = arena(), far = arena();
  centerPelletOnly(near);
  centerPelletOnly(far);
  const nearEnemy = target(near, { x: 210 });
  const farEnemy = target(far, { x: 380 });
  advanceBullets(near);
  advanceBullets(far);
  const nearDamage = 1000 - nearEnemy.hp, farDamage = 1000 - farEnemy.hp;
  assert.equal(nearDamage, WEAPONS.shotgun.damage);
  const actualEntryDistance = 380 - (17 + 3) - (100 + 18 + 9);
  const expectedFarDamage = 16 * (1 - (actualEntryDistance - 80) / (300 - 80) * 0.6);
  assert.ok(Math.abs(farDamage - expectedFarDamage) < 1e-8);
  assert.ok(farDamage < nearDamage && farDamage >= 16 * 0.4);
});

test('close spread clears a grunt and deals substantially more boss damage than distant spread', () => {
  const gruntArena = arena();
  target(gruntArena, { x: 160, hp: 40, maxHp: 40 });
  gruntArena.fire();
  advanceBullets(gruntArena);
  assert.equal(gruntArena.kills, 1);
  assert.equal(gruntArena.enemies.length, 0);

  const closeArena = arena(), farArena = arena();
  const closeBoss = target(closeArena, { x: 160, type: 'tank', radius: 25, hp: 170, maxHp: 170 });
  const farBoss = target(farArena, { x: 380, type: 'tank', radius: 25, hp: 170, maxHp: 170 });
  closeArena.fire(); farArena.fire();
  advanceBullets(closeArena); advanceBullets(farArena);
  const closeDamage = 170 - closeBoss.hp, farDamage = 170 - farBoss.hp;
  assert.equal(closeDamage, WEAPONS.shotgun.damage * WEAPONS.shotgun.pellets);
  assert.ok(closeDamage > farDamage * 2);
  assert.ok(farDamage > 0);
});

test('shotgun reload respects finite reserve and duplicate pickup replenishes only its equipment', () => {
  const game = arena();
  const ammo = game.player.weapons.shotgun;
  ammo.clip = 0; ammo.reserve = 2;
  assert.equal(game.tryReload(), true);
  for (let i = 0; i < 17; i++) game.update(0.1);
  assert.equal(ammo.clip, 2);
  assert.equal(ammo.reserve, 0);
  game.player.weapons.pistol.clip = 3;
  game.equipWeapon('pistol');
  game.spawnPickup('weapon', game.player.x, game.player.y, { weaponId: 'shotgun' });
  game.update(0.1);
  assert.equal(game.player.currentWeapon, 'pistol');
  assert.equal(game.player.weapons.pistol.clip, 3);
  assert.equal(game.player.weapons.shotgun.clip, 6);
  assert.equal(game.player.weapons.shotgun.reserve, 36);
});

test('clearing wave two guarantees shotgun unlock and slot six can equip it', () => {
  const game = new Game();
  game.spawnQueue = [];
  game.clearWave();
  assert.equal(game.wave, 1);
  game.update(3);
  assert.equal(game.wave, 2);
  assert.equal(game.player.weapons.shotgun, undefined);
  game.spawnQueue = [];
  game.clearWave();
  assert.equal(game.wave, 2);
  game.update(3);
  assert.equal(game.wave, 3);
  assert.ok(game.player.weapons.shotgun);
  assert.ok(game.pickups.some(pickup => pickup.type === 'weapon' && pickup.weaponId === 'shotgun' && pickup.guaranteed));
  game.update(0.1, { weaponSlot: 5 });
  assert.equal(game.player.currentWeapon, 'shotgun');
});

test('original guns still emit one projectile per trigger and shortened lifetime prevents overshoot', () => {
  for (const id of ['pistol', 'smg', 'rifle', 'lmg', 'sniper']) {
    const game = arena();
    game.player.weapons[id] = game.makeAmmo(id);
    game.equipWeapon(id);
    game.fire();
    assert.equal(game.bullets.length, 1, id);
    assert.equal(game.player.weapons[id].clip, WEAPONS[id].clipSize - 1, id);
    const bullet = game.bullets[0], startX = bullet.x, startY = bullet.y;
    bullet.life = 0.01;
    const enemy = target(game, { x: bullet.x + WEAPONS[id].bulletSpeed * 0.01 + 21 });
    game.updateBullets(0.1);
    assert.equal(enemy.hp, 1000, `${id}: no hit after remaining lifetime`);
    assert.ok(Math.abs(Math.hypot(bullet.x - startX, bullet.y - startY) - WEAPONS[id].bulletSpeed * 0.01) < 1e-8);
    assert.equal(game.bullets.length, 0);
  }
});

test('obstacles stop every pellet before enemies behind cover', () => {
  const game = arena();
  game.map = { ...game.map, obstacles: [{ x: 170, y: 200, w: 80, h: 360 }] };
  const enemy = target(game, { x: 300, hp: 40, maxHp: 40 });
  game.fire();
  advanceBullets(game);
  assert.equal(enemy.hp, 40);
  assert.equal(game.bullets.length, 0);
});
