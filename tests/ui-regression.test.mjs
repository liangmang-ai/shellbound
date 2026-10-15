import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { Game } from '../src/game.js';
import { CoopGame } from '../src/coop-game.js';

function harness(options = {}) {
  const texts = [], calls = [], writes = [];
  let callbacks, timestamp = 0;
  const context = new Proxy({
    measureText: value => ({ width: String(value).length * 9 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillText(value, x, y) { texts.push({ value: String(value), x, y, font: this.font }); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  // A stale caller may still inject a social adapter. The app must never use it.
  const social = new Proxy({}, { get: (_target, key) => (...args) => { calls.push([key, ...args]); } });
  const app = createApp({ canvas: { getContext: () => context }, width: 844, height: 390, platform: 'wechat',
    storage: { getItem() { return null; }, setItem(key, value) { writes.push([key, JSON.parse(value)]); } },
    multiplayerFactory(value) {
      callbacks = value;
      return { create() {}, join() {}, close() {}, pause() {}, input() {}, action() {} };
    }, ...options, social });
  const frame = (ms = 16) => { timestamp += ms; texts.length = 0; app.frame(timestamp); };
  const tap = label => {
    const state = app.getSnapshot(), button = state.buttons.find(item => item.label === label);
    assert.ok(button, `${label} is available`);
    const point = { x: state.layout.ox + (button.x + button.w / 2) * state.layout.scale,
      y: state.layout.oy + (button.y + button.h / 2) * state.layout.scale, button: 0 };
    app.handlePointer('down', point); app.handlePointer('up', point); frame();
  };
  app.frame(0);
  return { app, frame, tap, calls, writes, texts, get callbacks() { return callbacks; } };
}

const menuViewports = [[640, 320], [740, 360], [844, 390], [932, 430], [1024, 768]];
const cssTextSize = (h, label) => {
  const draw = h.texts.find(item => item.value === label);
  assert.ok(draw, `${label} is visible`);
  return Number(/([\d.]+)px/.exec(draw.font)[1]) * h.app.getSnapshot().layout.scale;
};
const expectTextSize = (h, label, minimum, maximum) => {
  const size = cssTextSize(h, label);
  assert.ok(size >= minimum - .01 && size <= maximum + .01, `${label} has ${size.toFixed(2)} CSS px text, expected ${minimum}–${maximum}`);
};
const expectTouchSize = (state, label, minimum = 48) => {
  const button = state.buttons.find(item => item.label === label);
  assert.ok(button, `${label} has an active touch target`);
  assert.ok(button.w * state.layout.scale >= minimum - .01 && button.h * state.layout.scale >= minimum - .01,
    `${label} retains a ${minimum} CSS px touch target`);
};

for (const [width, height] of menuViewports) for (const pixelRatio of [1, 2, 3]) {
  test(`menu typography and touch targets use screen pixels at ${width}×${height}, DPR ${pixelRatio}`, () => {
    const h = harness({ width, height, pixelRatio }), state = h.app.getSnapshot();
    const solo = state.buttons.find(item => item.label === '开始突围'), coop = state.buttons.find(item => item.label === '双人合作');
    assert.equal(solo.w, coop.w); assert.equal(solo.h, coop.h);
    expectTextSize(h, '双人合作', 24, 28); expectTextSize(h, '开始突围', 24, 28);
    expectTouchSize(state, '双人合作'); expectTouchSize(state, '开始突围');
    for (const label of ['休闲', '标准', '挑战']) {
      const draw = h.texts.find(item => item.value === label);
      const [, weight] = /^(\d+) ([\d.]+)px/.exec(draw.font);
      assert.ok(Number(weight) <= 700, 'secondary choices do not use headline weight');
      expectTextSize(h, label, 18, 20); expectTouchSize(state, label, 44);
    }
    for (const label of ['操作指南', '音效：开']) expectTouchSize(state, label, 44);
    for (const button of state.buttons) {
      assert.ok(button.x >= 0 && button.y >= 0 && button.x + button.w <= state.layout.w && button.y + button.h <= state.layout.h);
      const right = state.layout.ox + (button.x + button.w) * state.layout.scale;
      const top = state.layout.oy + button.y * state.layout.scale;
      assert.ok(top >= 60 || right < width - 118, `${button.label} avoids the native upper-right capsule`);
    }
  });

  test(`cooperation entries, keypad and room remain readable at ${width}×${height}, DPR ${pixelRatio}`, () => {
    const h = harness({ width, height, pixelRatio });
    h.tap('双人合作');
    for (const label of ['创建房间', '输入房间码加入']) {
      expectTextSize(h, label, 24, 28); expectTouchSize(h.app.getSnapshot(), label);
    }
    expectTouchSize(h.app.getSnapshot(), '返回战区', 44);
    h.tap('输入房间码加入');
    for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '删除', '0']) {
      expectTouchSize(h.app.getSnapshot(), label);
    }
    for (const digit of '123456') h.tap(digit);
    expectTouchSize(h.app.getSnapshot(), '加入房间');
    h.tap('返回战区'); h.tap('双人合作');
    h.tap('创建房间');
    h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', mapId: 'greenhouse', difficultyId: 'easy',
      players: [{ id: 'p1', connected: true }] });
    h.frame();
    expectTextSize(h, '房间码', 20, 22);
    h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', mapId: 'greenhouse', difficultyId: 'easy',
      players: [{ id: 'p1', connected: true }, { id: 'p2', connected: true }] });
    h.frame();
    expectTextSize(h, '开始双人突围', 24, 28); expectTouchSize(h.app.getSnapshot(), '开始双人突围');
  });
}

for (const [width, height] of menuViewports) {
  test(`DPR changes backing resolution without changing UI size at ${width}×${height}`, () => {
    const physical = pixelRatio => {
      const h = harness({ width, height, pixelRatio });
      const capture = () => ({
        texts: h.texts.map(draw => ({ label: draw.value, size: cssTextSize(h, draw.value) })),
        buttons: h.app.getSnapshot().buttons.map(button => ({ label: button.label,
          width: button.w * h.app.getSnapshot().layout.scale, height: button.h * h.app.getSnapshot().layout.scale })),
      });
      const menu = capture(); h.tap('双人合作');
      const coop = capture(); h.tap('输入房间码加入');
      return { menu, coop, keypad: capture() };
    };
    const baseline = physical(1);
    assert.deepEqual(physical(2), baseline); assert.deepEqual(physical(3), baseline);
  });
}

test('menu and cooperation never expose or call removed social features', () => {
  const h = harness();
  for (const screen of ['menu', 'coop']) {
    if (screen === 'coop') h.tap('双人合作');
    assert.equal(h.app.getSnapshot().buttons.some(item => /好友榜|昵称|头像|授权/.test(item.label)), false);
    assert.equal(h.texts.some(item => /好友榜|昵称|头像|授权/.test(item.value)), false);
  }
  h.app.resume(); h.frame();
  h.tap('创建房间');
  assert.equal('profile' in h.callbacks, false, 'room connection receives no profile metadata');
  h.tap('返回战区');
  h.tap('操作指南'); h.tap('准备好了');
  assert.deepEqual(h.calls, [], 'even an injected legacy adapter is never accessed');
});

test('cooperation room ignores legacy profiles and renders numbered egg identities', () => {
  const h = harness(); h.tap('双人合作'); h.tap('创建房间');
  h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', mapId: 'greenhouse', difficultyId: 'easy',
    players: [{ id: 'p1', connected: true, profile: { nickName: '旧昵称一', avatarUrl: 'https://example.com/avatar-one' } },
      { id: 'p2', connected: true, profile: { nickName: '旧昵称二', avatarUrl: 'https://example.com/avatar-two' } }] });
  h.frame();
  for (const label of ['玩家 1', '玩家 2', '你 · 房主', '队友 · 已加入']) assert.ok(h.texts.some(item => item.value === label));
  assert.equal(h.texts.some(item => /旧昵称|两台手机|把房间码告诉|离开或断线/.test(item.value)), false);
  assert.equal(JSON.stringify(h.app.getSnapshot().coop.room).includes('profile'), false, 'legacy profile metadata is discarded');
  assert.ok(h.app.getSnapshot().buttons.some(item => item.label === '开始双人突围'));
  const authority = new CoopGame({ mapId: 'greenhouse', difficultyId: 'easy' });
  h.callbacks.onSnapshot(authority.snapshot('p1'), 1); h.frame();
  assert.ok(h.texts.some(item => item.value === '玩家 2'), 'combat uses the default numbered identity');
  assert.equal(h.texts.some(item => /旧昵称/.test(item.value)), false);
  assert.deepEqual(h.calls, []);
});

test('single-player results remain local and revival can improve the saved best', t => {
  let game;
  const update = Game.prototype.update;
  Game.prototype.update = function (...args) { game = this; return update.apply(this, args); };
  t.after(() => { Game.prototype.update = update; });
  const h = harness(); h.tap('开始突围');
  game.score = 120; game.wave = 3; game.status = 'dead'; game.player.hp = 0;
  h.frame(); h.frame(); h.frame();
  assert.deepEqual(h.writes, [['shellbound.best.v1', { score: 120, wave: 3 }]], 'one local write per death');
  h.tap('免费复活 · 剩余 3 次');
  assert.equal(game.status, 'playing'); assert.equal(game.revivesRemaining, 2);
  game.score = 160; game.status = 'dead'; game.player.hp = 0; h.frame(); h.frame();
  assert.deepEqual(h.writes.at(-1), ['shellbound.best.v1', { score: 160, wave: 3 }]);
  assert.deepEqual(h.calls, [], 'no friend-score upload or other social action on defeat');
});

test('cooperative defeat never uploads results or changes the single-player local best', () => {
  const h = harness(); h.tap('双人合作'); h.tap('创建房间');
  h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', phase: 'playing', mapId: 'greenhouse', difficultyId: 'easy',
    players: [{ id: 'p1', connected: true }, { id: 'p2', connected: true }] });
  const authority = new CoopGame({ mapId: 'greenhouse', difficultyId: 'easy' });
  authority.players.p1.hp = 0;
  h.callbacks.onSnapshot(authority.snapshot('p1'), 1); h.frame();
  authority.score = 240; authority.players.p2.hp = 0; authority.status = 'dead';
  h.callbacks.onSnapshot(authority.snapshot('p1'), 2); h.frame(); h.frame();
  assert.equal(h.app.getSnapshot().best.score, 0);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.calls, []);
});

test('single-player wave intermission uses wall time even when a frame takes a full second', t => {
  let game;
  const update = Game.prototype.update;
  Game.prototype.update = function (...args) { game = this; return update.apply(this, args); };
  t.after(() => { Game.prototype.update = update; });
  const h = harness(); h.tap('开始突围');
  game.clearWave(); h.frame(1000);
  assert.equal(game.intermissionRemaining, 2);
  assert.ok(h.texts.some(item => item.value === '下一波 · 2'));
  h.app.pause(); h.frame(1000);
  assert.equal(game.intermissionRemaining, 2);
});
