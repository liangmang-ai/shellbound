import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { Game } from '../src/game.js';

function harness(t, platform = 'wechat', options = {}) {
  const context = new Proxy({
    measureText: value => ({ width: String(value).length * 8 }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  let game;
  const update = Game.prototype.update;
  Game.prototype.update = function (...args) {
    game = this;
    this.spawnTimer = 9999;
    return update.apply(this, args);
  };
  t.after(() => { Game.prototype.update = update; });
  const app = createApp({ canvas: { getContext: () => context }, width: 844, height: 390, platform, ...options });
  let timestamp = 0;
  function step(ms = 16) { timestamp += ms; app.frame(timestamp); }
  function point(x, y, extra = {}) {
    const { scale, ox, oy } = app.getSnapshot().layout;
    return { x: ox + x * scale, y: oy + y * scale, ...extra };
  }
  function touch(type, id, x, y) { app.handleTouch(type, [point(x, y, { id })]); }
  function button(label) {
    const value = app.getSnapshot().buttons.find(item => item.label.includes(label));
    assert.ok(value, `button ${label} is drawn`);
    return { ...value, cx: value.x + value.w / 2, cy: value.y + value.h / 2 };
  }
  function tap(label, id = 20) {
    const value = button(label);
    touch('start', id, value.cx, value.cy);
    touch('end', id, value.cx, value.cy);
  }
  app.frame(0);
  tap('开始突围');
  step();
  return { app, step, touch, button, point, tap, get game() { return game; } };
}

function near(actual, expected, tolerance = .025) {
  const distance = Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected));
  assert.ok(Math.abs(distance) < tolerance, `angle ${actual} faces ${expected}`);
}

test('movement joystick faces the direction of travel and retains it after release', t => {
  const h = harness(t);
  const y = h.app.getSnapshot().layout.h * .6;
  h.touch('start', 1, 80, y);
  for (const [dx, dy, angle] of [[44, 0, 0], [0, -44, -Math.PI / 2], [-44, 44, Math.PI * 3 / 4]]) {
    h.touch('move', 1, 80 + dx, y + dy);
    h.step();
    near(h.game.player.angle, angle);
  }
  const facing = h.game.player.angle, position = { x: h.game.player.x, y: h.game.player.y };
  h.touch('end', 1, 36, y + 44);
  h.step();
  near(h.game.player.angle, facing);
  assert.equal(h.game.player.x, position.x);
  assert.equal(h.game.player.y, position.y);
});

test('holding the fire button shoots immediately without aiming and end/cancel stop it', t => {
  const h = harness(t);
  const fire = h.button('开火');
  const facing = h.game.player.angle;
  h.touch('start', 2, fire.cx, fire.cy);
  h.step();
  assert.equal(h.game.player.weapons.pistol.clip, 11, 'a stationary press fires a bullet');
  near(h.game.player.angle, facing);
  h.touch('cancel', 2, fire.cx, fire.cy);
  for (let i = 0; i < 20; i++) h.step();
  assert.equal(h.game.player.weapons.pistol.clip, 11);
  h.touch('start', 3, fire.cx, fire.cy);
  h.step();
  assert.equal(h.game.player.weapons.pistol.clip, 10);
  h.touch('end', 3, fire.cx, fire.cy);
  for (let i = 0; i < 20; i++) h.step();
  assert.equal(h.game.player.weapons.pistol.clip, 10);
});

test('fire touch only begins inside the circle and empty battlefield touches do not shoot', t => {
  const h = harness(t), fire = h.button('开火');
  h.touch('start', 2, fire.x + 1, fire.y + 1);
  h.touch('move', 2, fire.cx, fire.cy);
  h.step();
  assert.equal(h.game.player.weapons.pistol.clip, 12, 'bounding-box corners do not activate a circle');
  h.touch('end', 2, fire.cx, fire.cy);
  h.touch('start', 3, h.app.getSnapshot().layout.w * .6, h.app.getSnapshot().layout.h * .5);
  h.step();
  assert.equal(h.game.player.weapons.pistol.clip, 12, 'there is no invisible right-half firing joystick');
  h.touch('cancel', 3, 0, 0);
  h.touch('start', 4, fire.cx, fire.cy);
  h.step();
  assert.equal(h.game.player.weapons.pistol.clip, 11);
});

test('movement determines shots, optional fire drag overrides facing while held', t => {
  const h = harness(t);
  const y = h.app.getSnapshot().layout.h * .6, fire = h.button('开火');
  h.touch('start', 1, 80, y);
  h.touch('move', 1, 124, y);
  h.touch('start', 2, fire.cx, fire.cy);
  h.step();
  near(h.game.player.angle, 0);
  assert.equal(h.game.player.weapons.pistol.clip, 11);
  h.touch('move', 2, fire.cx, fire.cy - 40);
  h.step();
  near(h.game.player.angle, -Math.PI / 2);
  h.touch('end', 2, fire.cx, fire.cy - 40);
  h.step();
  near(h.game.player.angle, 0);
});

test('grenade button throws along the last movement facing without firing or moving', t => {
  const h = harness(t);
  const y = h.app.getSnapshot().layout.h * .6;
  h.touch('start', 1, 80, y);
  h.touch('move', 1, 36, y);
  h.step();
  h.touch('end', 1, 36, y);
  const position = { x: h.game.player.x, y: h.game.player.y };
  h.tap('手雷');
  h.step();
  assert.equal(h.game.player.grenades, 2);
  assert.equal(h.game.grenades.length, 1);
  near(h.game.grenades[0].angle, Math.PI);
  assert.equal(h.game.player.weapons.pistol.clip, 12);
  assert.equal(h.game.player.x, position.x);
  assert.equal(h.game.player.y, position.y);
});

test('burst replaces reload at the same circle and works alongside held movement and fire', t => {
  const h = harness(t), { move, fire, boost } = h.app.getSnapshot().controls;
  assert.equal(h.app.getSnapshot().controls.reload, undefined);
  assert.equal(boost.x, h.app.getSnapshot().layout.w - 260);
  assert.equal(boost.y, h.app.getSnapshot().layout.h - 78);
  assert.equal(boost.r, 39);
  assert.equal(h.game.player.boostCharges, 1);
  h.touch('start', 1, move.x, move.y);
  h.touch('move', 1, move.x + 40, move.y);
  h.touch('start', 2, fire.x, fire.y); h.step();
  const before = { x: h.game.player.x, clip: h.game.player.weapons.pistol.clip };
  h.tap('爆发', 3); h.step();
  assert.equal(h.game.player.boostCharges, 0);
  assert.ok(h.game.player.boostRemaining > 7.9 && h.game.player.boostRemaining <= 8);
  assert.equal(h.game.player.weapons.pistol.reloadRemaining, 0, 'burst never manually reloads the current magazine');
  assert.ok(h.game.player.x > before.x, 'a third finger leaves movement held');
  for (let i = 0; i < 9; i++) h.step();
  assert.ok(h.game.player.weapons.pistol.clip < before.clip, 'a third finger leaves sustained fire held');
  h.touch('end', 1, move.x + 40, move.y); h.touch('end', 2, fire.x, fire.y);
});

test('burst ignores circle corners and empty inventory without interrupting held controls', t => {
  const h = harness(t), { move, fire, boost } = h.app.getSnapshot().controls;
  h.touch('start', 3, boost.x - boost.r + 1, boost.y - boost.r + 1);
  h.touch('end', 3, boost.x - boost.r + 1, boost.y - boost.r + 1); h.step();
  assert.equal(h.game.player.boostCharges, 1, 'bounding-box corners are outside the skill circle');
  assert.equal(h.game.player.boostRemaining, 0);
  h.game.player.boostCharges = 0;
  h.touch('start', 1, move.x, move.y); h.touch('move', 1, move.x + 40, move.y);
  h.touch('start', 2, fire.x, fire.y); h.step();
  const before = { x: h.game.player.x, clip: h.game.player.weapons.pistol.clip };
  h.tap('爆发', 4); h.step();
  assert.equal(h.game.player.boostCharges, 0);
  assert.equal(h.game.player.boostRemaining, 0);
  assert.ok(h.game.player.x > before.x);
  for (let i = 0; i < 16; i++) h.step();
  assert.ok(h.game.player.weapons.pistol.clip < before.clip, 'a depleted skill does not cancel fire');
});

test('separate burst taps consume separate charges even in one frame and pause freezes duration', t => {
  const h = harness(t);
  h.game.player.boostCharges = 3;
  h.tap('爆发', 3); h.tap('爆发', 4); h.step();
  assert.equal(h.game.player.boostCharges, 1);
  assert.ok(h.game.player.boostRemaining > 15.9 && h.game.player.boostRemaining <= 16, 'two deliberate taps each extend duration');
  h.app.pause(); h.step();
  const remaining = h.game.player.boostRemaining;
  for (let i = 0; i < 20; i++) h.step(50);
  assert.equal(h.game.player.boostRemaining, remaining);
  assert.equal(h.game.player.boostCharges, 1);
  h.tap('继续突围'); h.step(); h.step(50);
  assert.ok(h.game.player.boostRemaining < remaining, 'resuming starts the remaining combat timer');
});

test('R activates burst without reload and held keyboard repeats do not spend extra charges', t => {
  const h = harness(t, 'web');
  h.game.player.boostCharges = 3;
  h.game.player.weapons.pistol.clip = 7;
  h.app.handleKey('down', 'r'); h.step();
  assert.equal(h.game.player.boostCharges, 2);
  assert.equal(h.game.player.weapons.pistol.reloadRemaining, 0);
  h.app.handleKey('down', 'r'); h.step();
  h.app.handleKey('down', 'r'); h.step();
  assert.equal(h.game.player.boostCharges, 2, 'holding R never consumes a stored stack through auto-repeat');
  h.app.handleKey('up', 'r'); h.app.handleKey('down', 'r'); h.step();
  assert.equal(h.game.player.boostCharges, 1, 'a fresh key press uses the next charge');
  assert.ok(h.game.player.boostRemaining > 15.8);
});

test('touch facing ignores stale mouse aim and desktop pointer aim remains available', t => {
  const h = harness(t, 'web');
  const y = h.app.getSnapshot().layout.h * .6;
  h.app.handlePointer('move', h.point(h.app.getSnapshot().layout.w - 10, 100));
  h.touch('start', 1, 80, y);
  h.touch('move', 1, 36, y);
  h.step();
  near(h.game.player.angle, Math.PI);
  h.touch('end', 1, 36, y);
  h.app.handlePointer('move', h.point(h.app.getSnapshot().layout.w - 10, h.app.getSnapshot().layout.h / 2));
  h.step();
  assert.ok(Math.cos(h.game.player.angle) > .7, 'moving the mouse reclaims desktop aiming');
});

test('pause and resize clear held fire and movement touches', t => {
  const h = harness(t), fire = h.button('开火'), y = h.app.getSnapshot().layout.h * .6;
  h.touch('start', 1, 80, y);
  h.touch('move', 1, 124, y);
  h.touch('start', 2, fire.cx, fire.cy);
  h.step();
  h.app.pause();
  h.app.handleKey('down', 'Escape');
  h.step();
  const position = { x: h.game.player.x, y: h.game.player.y }, clip = h.game.player.weapons.pistol.clip;
  for (let i = 0; i < 20; i++) h.step();
  assert.equal(h.game.player.x, position.x);
  assert.equal(h.game.player.y, position.y);
  assert.equal(h.game.player.weapons.pistol.clip, clip);
  const nextFire = h.button('开火');
  h.touch('start', 3, nextFire.cx, nextFire.cy);
  h.app.resize({ width: 812, height: 375 });
  for (let i = 0; i < 20; i++) h.step();
  assert.equal(h.game.player.weapons.pistol.clip, clip);
});

test('held touch fire assists forward without accumulating assisted facing; dragging overrides', t => {
  const h = harness(t), { move, fire } = h.app.getSnapshot().controls;
  h.game.enemies.push({ id: 900, type: 'grunt', radius: 17, hp: 1000, maxHp: 1000, x: 830, y: 430, speed: 0, damage: 12, hitFlash: 0 });
  h.touch('start', 1, move.x, move.y);
  h.touch('move', 1, move.x + 50, move.y);
  h.touch('start', 2, fire.x, fire.y);
  for (let i = 0; i < 5; i++) h.step();
  assert.equal(h.app.getSnapshot().aim.targetId, 900);
  assert.ok(h.game.player.angle > .2 && h.game.player.angle < .4);
  near(h.app.getSnapshot().aim.facing, 0);
  h.touch('move', 2, fire.x + 14, fire.y);
  h.step();
  assert.equal(h.app.getSnapshot().aim.targetId, 900, 'a small thumb wobble keeps assistance active');
  h.touch('move', 2, fire.x, fire.y - 40);
  h.step();
  assert.equal(h.app.getSnapshot().aim.targetId, null);
  near(h.game.player.angle, -Math.PI / 2);
  h.touch('end', 2, fire.x, fire.y - 40);
  h.step(); near(h.game.player.angle, 0);
});

test('assist can be disabled and settings persist while combat remains frozen', t => {
  const saves = new Map();
  const h = harness(t, 'wechat', { storage: { getItem: key => saves.get(key), setItem: (key, value) => saves.set(key, value) } });
  h.app.pause(); h.step();
  const before = h.game.time;
  h.tap('辅助瞄准：开'); h.step();
  h.tap('音效：开'); h.step();
  assert.equal(h.game.time, before);
  assert.deepEqual(h.app.getSnapshot().settings, { aimAssist: false, muted: true, difficultyId: 'easy' });
  assert.deepEqual(JSON.parse(saves.get('shellbound.settings.v1')), { muted: true, aimAssist: false, difficultyId: 'easy' });
  h.tap('继续突围'); h.step();
  const { move, fire } = h.app.getSnapshot().controls;
  h.game.enemies.push({ id: 901, type: 'grunt', radius: 17, hp: 1000, maxHp: 1000, x: 830, y: 430, speed: 0, damage: 12, hitFlash: 0 });
  h.touch('start', 1, move.x, move.y); h.touch('move', 1, move.x + 50, move.y);
  h.touch('start', 2, fire.x, fire.y); h.step();
  assert.equal(h.app.getSnapshot().aim.targetId, null);
  near(h.game.player.angle, 0);
});

test('audio unlocks on gestures, receives real shot events and stops for pause/menu', t => {
  const calls = [];
  const h = harness(t, 'wechat', { audio: {
    unlock: () => calls.push('unlock'), pause: () => calls.push('pause'), setMuted: value => calls.push(`muted:${value}`),
    playEvents: events => calls.push(...events.map(event => event.type)), getSnapshot: () => ({ ready: true }),
  } });
  assert.ok(calls.includes('wave'));
  h.tap('开火'); // A tap ending before a frame deliberately does not shoot.
  const fire = h.button('开火');
  h.touch('start', 2, fire.cx, fire.cy); h.step();
  assert.ok(calls.includes('shot'));
  assert.ok(calls.includes('unlock'));
  h.app.pause(); h.step();
  assert.equal(calls.at(-1), 'pause');
  h.tap('返回战区'); h.step();
  assert.equal(h.app.getSnapshot().screen, 'menu');
  assert.equal(calls.at(-1), 'pause');
});

test('grenade drag previews a world landing and throws there only after release', t => {
  const h = harness(t), button = h.button('手雷'), target = { x: 740, y: 475 };
  const arena = h.app.getSnapshot().arena;
  const point = { x: (target.x - arena.camera.x) * arena.scale, y: (target.y - arena.camera.y) * arena.scale };
  const facing = h.game.player.angle;
  h.touch('start', 40, button.cx, button.cy); h.step();
  assert.equal(h.game.player.grenades, 3, 'hold does not consume inventory');
  h.touch('move', 40, point.x, point.y); h.step();
  const preview = h.app.getSnapshot().grenadeAim;
  assert.ok(Math.abs(preview.x - target.x) < 1e-6 && Math.abs(preview.y - target.y) < 1e-6);
  assert.equal(preview.range, 135);
  assert.equal(h.game.grenades.length, 0);
  near(h.game.player.angle, facing);
  h.touch('end', 40, point.x, point.y); h.step();
  assert.equal(h.game.player.grenades, 2);
  assert.equal(h.app.getSnapshot().grenadeAim, null);
  assert.ok(Math.abs(h.game.grenades[0].targetX - target.x) < 1e-6);
  assert.ok(Math.abs(h.game.grenades[0].targetY - target.y) < 1e-6);
});

test('dragging back, cancellation, resize and pause never throw a held grenade', t => {
  const h = harness(t), button = h.button('手雷');
  const begin = id => { h.touch('start', id, button.cx, button.cy); h.touch('move', id, button.cx - 180, button.cy - 80); h.step(); };
  begin(41); h.touch('move', 41, button.cx, button.cy); h.step();
  assert.equal(h.app.getSnapshot().grenadeAim, null);
  h.touch('end', 41, button.cx, button.cy); h.step();
  begin(42); h.touch('cancel', 42, button.cx - 180, button.cy - 80); h.step();
  begin(43); h.app.pause(); h.touch('end', 43, button.cx - 180, button.cy - 80); h.step();
  h.tap('继续突围'); h.step();
  begin(44); h.app.resize({ width: 812, height: 375 }); h.touch('end', 44, button.cx - 180, button.cy - 80); h.step();
  assert.equal(h.game.player.grenades, 3);
  assert.equal(h.game.grenades.length, 0);
});

test('mouse drag and cancellation use the same grenade selection as touch', t => {
  const h = harness(t, 'web'), button = h.button('手雷');
  h.app.handlePointer('down', h.point(button.cx, button.cy, { button: 0 }));
  h.app.handlePointer('move', h.point(button.cx - 180, button.cy - 80)); h.step();
  assert.ok(h.app.getSnapshot().grenadeAim);
  h.app.handlePointer('cancel', h.point(button.cx - 180, button.cy - 80)); h.step();
  assert.equal(h.game.player.grenades, 3);
  h.app.handlePointer('down', h.point(button.cx, button.cy, { button: 0 }));
  h.app.handlePointer('move', h.point(button.cx - 180, button.cy - 80)); h.step();
  const expected = h.app.getSnapshot().grenadeAim;
  h.app.handlePointer('up', h.point(button.cx - 180, button.cy - 80)); h.step();
  assert.equal(h.game.player.grenades, 2);
  assert.equal(h.game.player.weapons.pistol.clip, 12);
  assert.ok(Math.abs(h.game.grenades[0].targetX - expected.x) < 1e-6);
});

test('quick switch cycles unlocked guns and rapid taps while moving and firing stay responsive', t => {
  const h = harness(t), { move, fire } = h.app.getSnapshot().controls;
  h.game.player.weapons.smg = h.game.makeAmmo('smg');
  h.game.player.weapons.shotgun = h.game.makeAmmo('shotgun');
  h.touch('start', 1, move.x, move.y); h.touch('move', 1, move.x + 40, move.y);
  h.touch('start', 2, fire.x, fire.y);
  h.tap('切枪'); h.step();
  assert.equal(h.game.player.currentWeapon, 'smg');
  const x = h.game.player.x;
  h.tap('切枪'); h.step();
  assert.equal(h.game.player.currentWeapon, 'shotgun');
  assert.ok(h.game.player.x > x);
  assert.ok(h.game.player.weapons.shotgun.clip < 6, 'held fire uses the newly equipped gun');
  h.tap('切枪'); h.tap('切枪'); h.step();
  assert.equal(h.game.player.currentWeapon, 'smg', 'two taps within one frame still cycle twice');
  assert.equal(h.app.getSnapshot().weaponPicker, false);
});

for (const [name, choose] of [
  ['quick button', h => h.tap('切枪')],
  ['weapon picker', h => { h.tap('切换武器'); h.step(); h.tap('脆壳霰弹枪'); }],
  ['Q cycle', h => h.app.handleKey('down', 'q')],
  ['number slot', h => h.app.handleKey('down', '6')],
]) test(`held fire uses the new gun assist range on the ${name} switch frame`, t => {
  const h = harness(t), { move, fire } = h.app.getSnapshot().controls;
  h.game.map = { ...h.game.map, obstacles: [] };
  h.game.player.weapons.shotgun = h.game.makeAmmo('shotgun');
  const p = h.game.player;
  h.game.enemies.push({ id: 902, type: 'grunt', radius: 17, hp: 1000, maxHp: 1000,
    x: p.x + 320 * Math.cos(.25), y: p.y + 320 * Math.sin(.25), speed: 0, damage: 12, hitFlash: 0 });
  h.touch('start', 1, move.x, move.y); h.touch('move', 1, move.x + 40, move.y); h.step();
  h.touch('end', 1, move.x + 40, move.y);
  h.touch('start', 2, fire.x, fire.y); h.step();
  assert.equal(h.app.getSnapshot().aim.targetId, 902, 'the pistol can assist this distant target');
  choose(h); h.step();
  assert.equal(p.currentWeapon, 'shotgun');
  assert.equal(p.weapons.shotgun.clip, 5, 'the first shotgun shell fires on the switch frame');
  assert.equal(h.app.getSnapshot().aim.targetId, null, 'the new gun range applies before that shell fires');
  near(p.angle, 0);
  h.tap('切枪'); h.step();
  assert.equal(p.currentWeapon, 'pistol');
  assert.equal(h.app.getSnapshot().aim.targetId, 902, 'switching back immediately restores the pistol assist range');
});

test('revive button continues the same run three times and records later results again', t => {
  const saves = new Map();
  const h = harness(t, 'wechat', { storage: { getItem: key => saves.get(key), setItem: (key, value) => saves.set(key, value) } });
  h.game.player.weapons.rifle = h.game.makeAmmo('rifle'); h.game.equipWeapon('rifle');
  h.game.score = 70; h.game.wave = 4; h.game.status = 'dead'; h.game.player.hp = 0; h.step();
  const deadButton = h.button('免费复活');
  assert.ok(deadButton.y > 0 && deadButton.y + deadButton.h < h.app.getSnapshot().layout.h);
  h.tap('免费复活'); h.step();
  assert.equal(h.game.status, 'playing'); assert.equal(h.game.wave, 4); assert.equal(h.game.score, 70);
  assert.equal(h.game.player.currentWeapon, 'rifle'); assert.equal(h.game.player.hp, 100);
  assert.equal(h.app.getSnapshot().game.revivesRemaining, 2);
  assert.equal(h.app.getSnapshot().game.player.reviveProtectionRemaining, 3);
  h.game.score = 200; h.game.status = 'dead'; h.game.player.hp = 0; h.step();
  for (const remaining of [1, 0]) {
    h.tap('免费复活'); h.step();
    assert.equal(h.game.status, 'playing');
    assert.equal(h.game.revivesRemaining, remaining);
    assert.equal(h.game.player.currentWeapon, 'rifle');
    assert.equal(h.game.wave, 4);
    assert.equal(h.game.score, 200);
    h.game.status = 'dead'; h.game.player.hp = 0; h.step();
  }
  assert.equal(h.app.getSnapshot().buttons.some(button => button.label.includes('免费复活')), false);
  assert.equal(JSON.parse(saves.get('shellbound.best.v1')).score, 200);
  h.tap('再来一局'); h.step();
  assert.equal(h.game.revivesRemaining, 3);
});

test('boss warnings leave the expanded weapon library readable and its close button usable on narrow screens', t => {
  let path = [];
  const strokes = [];
  const context = new Proxy({
    measureText: value => ({ width: String(value).length * 8 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    quadraticCurveTo(cx, cy, x, y) { path.push([x, y]); },
    stroke() {
      if (!path.length) return;
      const xs = path.map(point => point[0]), ys = path.map(point => point[1]);
      strokes.push({ color: this.strokeStyle, x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const h = harness(t, 'wechat', { canvas: { getContext: () => context } });
  h.game.enemies.push({ id: 902, type: 'tank', x: 100, y: 100, radius: 25, speed: 0,
    hp: 170, maxHp: 170, damage: 22, hitFlash: 0, rangedCooldown: 99, rangedCharge: 0 });
  for (const [width, height] of [[667, 375], [800, 600]]) {
    h.app.resize({ width, height }); h.step();
    h.tap('切换武器'); h.step();
    const state = h.app.getSnapshot(), close = h.button('收起');
    const banner = strokes.findLast(item => item.color === '#aa8fbb');
    assert.ok(banner, 'the actual boss warning border is drawn');
    const libraryRight = Math.max(...state.buttons.filter(item => !item.role && (item.label.endsWith('枪') || item.label === '星光大狙')).map(item => item.x + item.w));
    assert.ok(banner.x > libraryRight && banner.x > close.x + close.w, 'warning stays to the right of the weapon choices and close button');
    assert.ok(banner.right <= state.layout.w, 'warning stays visible');
    h.tap('收起'); h.step();
    assert.equal(h.app.getSnapshot().weaponPicker, false, 'the visible close button collapses the library');
  }
});
