import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { Game } from '../src/game.js';

function harness(t, platform = 'wechat') {
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
  const app = createApp({ canvas: { getContext: () => context }, width: 844, height: 390, platform });
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
