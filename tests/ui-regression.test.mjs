import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { Game } from '../src/game.js';
import { CoopGame } from '../src/coop-game.js';

function harness(options = {}) {
  const texts = [], calls = [], writes = [], rejectedFonts = [];
  let callbacks, timestamp = 0;
  const target = {
    measureText: value => ({ width: String(value).length * 9 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillText(value, x, y) { texts.push({ value: String(value), x, y, font: this.font }); },
  };
  // Simulate a conservative native Canvas: an unsupported shorthand leaves the
  // previous font in place, rather than making Chrome's parser the only oracle.
  let font = 'normal 10px sans-serif';
  Object.defineProperty(target, 'font', { get: () => font, set(value) {
    if (/^(?:normal|bold) [\d.]+px sans-serif$/.test(value)) font = value;
    else rejectedFonts.push(value);
  } });
  const context = new Proxy(target, { get: (target, key) => key in target ? target[key] : () => {} });
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
    const state = app.getSnapshot(), button = state.buttons.find(item => item.label === label || item.label.startsWith(label));
    assert.ok(button, `${label} is available`);
    const point = { x: state.layout.ox + (button.x + button.w / 2) * state.layout.scale,
      y: state.layout.oy + (button.y + button.h / 2) * state.layout.scale, button: 0 };
    app.handlePointer('down', point); app.handlePointer('up', point); frame();
  };
  app.frame(0);
  return { app, frame, tap, calls, writes, texts, rejectedFonts, get callbacks() { return callbacks; } };
}

const menuViewports = [[640, 320], [740, 360], [844, 390], [932, 430], [1024, 768]];
const cssTextSize = (h, label) => {
  const draw = h.texts.find(item => item.value === label);
  assert.ok(draw, `${label} is visible`);
  return Number(/([\d.]+)px/.exec(draw.font)[1]) * h.app.getSnapshot().layout.scale;
};
const expectLogicalFont = (h, label, size) => {
  const draw = h.texts.find(item => item.value === label);
  assert.ok(draw, `${label} is visible`);
  assert.equal(Number(/([\d.]+)px/.exec(draw.font)[1]), size, `${label} retains the original Canvas font size`);
};
const expectBounds = (state, label, bounds) => {
  const button = state.buttons.find(item => item.label === label);
  assert.ok(button, `${label} has an active touch target`);
  assert.deepEqual(Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, button[key]])), bounds,
    `${label} retains the compact co-op layout`);
};

for (const [width, height] of menuViewports) for (const pixelRatio of [1, 2, 3]) {
  test(`compact menu uses a continuous difficulty bar and native-compatible fonts at ${width}×${height}, DPR ${pixelRatio}`, () => {
    const h = harness({ width, height, pixelRatio }), state = h.app.getSnapshot();
    const compact = state.layout.compact, x = compact ? 500 : 710, top = compact ? 90 : 210;
    const cardW = compact ? 420 : 500, cardH = compact ? 108 : 165, gap = compact ? 12 : 18;
    const difficultyY = top + (cardH + gap) * 2 + 5, difficultyW = cardW / 3, startY = difficultyY + 104;
    const soloW = Math.round(cardW * .64), startH = compact ? 58 : 64;
    expectBounds(state, '开始突围   →', { x, y: startY, w: soloW, h: startH });
    expectBounds(state, '双人合作', { x: x + soloW + 10, y: startY, w: cardW - soloW - 10, h: startH });
    for (const label of ['开始突围   →', '双人合作']) {
      expectLogicalFont(h, label, Math.max(28, 18 / state.layout.scale));
      assert.ok(cssTextSize(h, label) >= 17.99, 'main entries retain readable type on short screens');
    }
    for (const [index, label] of ['休闲', '标准', '挑战'].entries()) {
      expectLogicalFont(h, label, Math.max(23, 16 / state.layout.scale));
      expectBounds(state, label, { x: x + index * difficultyW, y: difficultyY, w: difficultyW, h: compact ? 64 : 54 });
    }
    assert.deepEqual(h.rejectedFonts, [], 'native Canvas accepts all requested menu fonts');
    assert.ok(h.texts.every(draw => /^(bold|normal) [\d.]+px sans-serif$/.test(draw.font)));
    expectBounds(state, '音效：开', { x: 320, y: 30, w: 100, h: 40 });
    expectBounds(state, '操作指南', { x: 432, y: 30, w: 126, h: 40 });
    for (const button of state.buttons) {
      assert.ok(button.x >= 0 && button.y >= 0 && button.x + button.w <= state.layout.w && button.y + button.h <= state.layout.h);
    }
  });

  test(`compact cooperation panel keeps readable actions and native-compatible fonts at ${width}×${height}, DPR ${pixelRatio}`, () => {
    const h = harness({ width, height, pixelRatio });
    h.tap('双人合作');
    const state = h.app.getSnapshot(), cx = state.layout.w / 2, panelX = cx - 260, panelY = (state.layout.h - 430) / 2 + 20;
    expectBounds(state, '创建房间', { x: panelX + 50, y: panelY + 205, w: 420, h: 60 });
    expectBounds(state, '输入房间码加入', { x: panelX + 50, y: panelY + 284, w: 420, h: 60 });
    for (const label of ['创建房间', '输入房间码加入']) expectLogicalFont(h, label, Math.max(28, 18 / state.layout.scale));
    expectBounds(state, '返回地图选择', { x: 38, y: state.layout.h - 67, w: 170, h: 46 });
    h.tap('输入房间码加入');
    for (const [index, label] of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '删除', '0'].entries()) {
      expectLogicalFont(h, label, label.length > 1 ? 23 : 27);
      expectBounds(h.app.getSnapshot(), label, { x: panelX + 30 + index % 3 * 155, y: panelY + 159 + Math.floor(index / 3) * 57, w: 145, h: 47 });
    }
    for (const digit of '123456') h.tap(digit);
    expectBounds(h.app.getSnapshot(), '加入房间', { x: panelX + 340, y: panelY + 330, w: 145, h: 47 });
    h.tap('返回地图选择'); h.tap('双人合作');
    h.tap('创建房间');
    h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', mapId: 'greenhouse', difficultyId: 'easy',
      players: [{ id: 'p1', connected: true }] });
    h.frame();
    expectLogicalFont(h, '123456', 52);
    h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', mapId: 'greenhouse', difficultyId: 'easy',
      players: [{ id: 'p1', connected: true }, { id: 'p2', connected: true }] });
    h.frame();
    expectLogicalFont(h, '开始双人突围', Math.max(28, 18 / state.layout.scale));
    expectBounds(h.app.getSnapshot(), '开始双人突围', { x: panelX + 50, y: panelY + 315, w: 420, h: 57 });
    assert.deepEqual(h.rejectedFonts, [], 'native Canvas accepts all requested room and keypad fonts');
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
    assert.equal(h.texts.some(item => /两台手机联机/.test(item.value)), false, 'the redundant cooperation footer remains removed');
  }
  h.app.resume(); h.frame();
  h.tap('创建房间');
  assert.equal('profile' in h.callbacks, false, 'room connection receives no profile metadata');
  h.tap('返回地图选择');
  h.tap('操作指南'); h.tap('准备好了');
  assert.deepEqual(h.calls, [], 'even an injected legacy adapter is never accessed');
});

test('cooperation room ignores legacy profiles and renders numbered egg identities', () => {
  const h = harness(); h.tap('双人合作'); h.tap('创建房间');
  h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', mapId: 'greenhouse', difficultyId: 'easy',
    players: [{ id: 'p1', connected: true, profile: { nickName: '旧昵称一', avatarUrl: 'https://example.com/avatar-one' } },
      { id: 'p2', connected: true, profile: { nickName: '旧昵称二', avatarUrl: 'https://example.com/avatar-two' } }] });
  h.frame();
  for (const label of ['1P 你 · 已加入', '2P 队友 · 已加入']) assert.ok(h.texts.some(item => item.value === label));
  assert.equal(h.texts.some(item => /旧昵称|授权微信|微信朋友关系/.test(item.value)), false);
  assert.equal(JSON.stringify(h.app.getSnapshot().coop.room).includes('profile'), false, 'legacy profile metadata is discarded');
  assert.ok(h.app.getSnapshot().buttons.some(item => item.label === '开始双人突围'));
  const authority = new CoopGame({ mapId: 'greenhouse', difficultyId: 'easy' });
  h.callbacks.onSnapshot(authority.snapshot('p1'), 1); h.frame();
  assert.ok(h.texts.some(item => item.value === '2P'), 'combat uses the original numbered identity');
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

test('wave break still waits three seconds with no countdown text and freezes when paused', t => {
  let game;
  const update = Game.prototype.update;
  Game.prototype.update = function (...args) { game = this; return update.apply(this, args); };
  t.after(() => { Game.prototype.update = update; });
  const h = harness(); h.tap('开始突围');
  game.clearWave(); h.frame(1000);
  assert.equal(game.intermissionRemaining, 2);
  assert.equal(h.texts.some(item => /下一波|休整.*秒/.test(item.value)), false, 'the waiting period has no countdown label');
  h.app.pause(); h.frame(1000);
  assert.equal(game.intermissionRemaining, 2);
  h.app.handleKey('down', 'Escape'); h.frame(); h.frame(2000);
  assert.equal(game.intermissionRemaining, 0); assert.equal(game.wave, 2, 'the next wave still starts after the remaining two seconds');
});

test('button press feedback never moves hit targets or survives a page transition', () => {
  const h = harness(), before = h.app.getSnapshot().buttons.find(button => button.label === '标准');
  const firstY = h.texts.find(draw => draw.value === '标准').y;
  h.tap('标准');
  const after = h.app.getSnapshot().buttons.find(button => button.label === '标准');
  for (const key of ['x', 'y', 'w', 'h']) assert.equal(after[key], before[key]);
  const pressedY = h.texts.find(draw => draw.value === '标准').y;
  assert.ok(pressedY > firstY && pressedY <= firstY + 2, 'the selected option gives a small visual press');
  h.frame();
  assert.ok(h.texts.find(draw => draw.value === '标准').y < pressedY, 'the press eases back without moving the touch target');
  for (let index = 0; index < 10; index++) h.frame();
  assert.equal(h.texts.find(draw => draw.value === '标准').y, firstY, 'the press finishes on the existing frame loop');
  h.tap('双人合作');
  assert.equal(h.texts.find(draw => draw.value === '双人合作').y, (h.app.getSnapshot().layout.h - 430) / 2 + 58,
    'opening a new page does not transfer the entry press to the matching page title');
  h.app.resize({ width: 740, height: 360 }); h.frame();
  assert.deepEqual(h.rejectedFonts, []);
});
