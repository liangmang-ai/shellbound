import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { Game } from '../src/game.js';
import { CoopGame } from '../src/coop-game.js';

function harness(options = {}) {
  const texts = [], calls = [], saves = [], profiles = [];
  let profileChanged, callbacks, timestamp = 0;
  const context = new Proxy({
    measureText: value => ({ width: String(value).length * 9 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillText(value, x, y) { texts.push({ value: String(value), x, y, font: this.font }); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const social = {
    getProfile: () => ({ nickName: '小蛋', avatarUrl: '', authorized: true }),
    onProfileChange(callback) { profileChanged = callback; },
    showProfileButton(bounds) { calls.push(['showProfile', bounds]); },
    requestProfileAuthorization(bounds) { calls.push(['requestProfile', bounds]); },
    hideProfileButton() { calls.push(['hideProfile']); },
    openLeaderboard(value) { calls.push(['openLeaderboard', value]); },
    closeLeaderboard() { calls.push(['closeLeaderboard']); },
    changeLeaderboardPage(delta) { calls.push(['page', delta]); },
    drawLeaderboard() { return true; },
    saveResult(value) { saves.push(value); return Promise.resolve({ status: 'queued' }); },
    ...options.social,
  };
  const app = createApp({ canvas: { getContext: () => context }, width: 844, height: 390, platform: 'wechat', social,
    multiplayerFactory(value) {
      callbacks = value;
      return { create() {}, join() {}, close() {}, pause() {}, input() {}, action() {}, setProfile(value) { profiles.push(value); } };
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
  return { app, frame, tap, calls, saves, texts, profiles, changeProfile: value => profileChanged(value), get callbacks() { return callbacks; } };
}

for (const [width, height] of [[844, 390], [667, 375], [1024, 768]]) {
  test(`menu gives both modes equal prominent entries and readable difficulty at ${width}×${height}`, () => {
    const h = harness({ width, height }), state = h.app.getSnapshot();
    const solo = state.buttons.find(item => item.label === '开始突围'), coop = state.buttons.find(item => item.label === '双人合作');
    assert.equal(solo.w, coop.w); assert.equal(solo.h, coop.h);
    assert.ok(coop.h * state.layout.scale >= 44);
    for (const label of ['休闲', '标准', '挑战']) {
      const draw = h.texts.find(item => item.value === label);
      assert.match(draw.font, /^800 30px/);
      assert.ok(30 * state.layout.scale >= 20, 'physical difficulty text stays large');
    }
    for (const button of state.buttons) {
      assert.ok(button.x >= 0 && button.y >= 0 && button.x + button.w <= state.layout.w && button.y + button.h <= state.layout.h);
      const right = state.layout.ox + (button.x + button.w) * state.layout.scale;
      const top = state.layout.oy + button.y * state.layout.scale;
      assert.ok(top >= 60 || right < width - 118, `${button.label} avoids the native upper-right capsule`);
    }
  });
}

test('profile authorization has its own CSS bounds and changes reach the active room', () => {
  const h = harness({ pixelRatio: 2 });
  h.tap('双人合作');
  const state = h.app.getSnapshot(), shown = h.calls.findLast(item => item[0] === 'showProfile')[1];
  const button = state.buttons.find(item => item.label === '更新昵称头像');
  assert.equal(shown.left, state.layout.ox + button.x * state.layout.scale);
  assert.equal(shown.width, button.w * state.layout.scale, 'native bounds do not include canvas DPR');
  assert.ok(h.texts.some(item => item.value.includes('用于房间 / 好友榜 · 游客可玩')));
  assert.equal(h.calls.some(item => item[0] === 'requestProfile'), false, 'render never requests consent');
  h.tap('更新昵称头像');
  assert.ok(h.calls.some(item => item[0] === 'requestProfile'), 'only the explicit entry requests consent');
  const shownCount = h.calls.filter(item => item[0] === 'showProfile').length;
  h.app.resume(); h.frame();
  assert.equal(h.calls.filter(item => item[0] === 'showProfile').length, shownCount + 1, 'resume restores a native button hidden by the platform');
  h.tap('创建房间');
  assert.equal(h.callbacks.profile.nickName, '小蛋');
  const profile = { nickName: '新队友', avatarUrl: '', authorized: true };
  h.changeProfile(profile);
  assert.deepEqual(h.profiles, [profile]);
  h.tap('返回战区');
  assert.equal(h.calls.at(-1)[0], 'hideProfile');
});

test('cooperation room renders both identities without redundant connection instructions', () => {
  const h = harness(); h.tap('双人合作'); h.tap('创建房间');
  h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', mapId: 'greenhouse', difficultyId: 'easy',
    players: [{ id: 'p1', connected: true, profile: { nickName: '小蛋' } }, { id: 'p2', connected: true, profile: { nickName: '大蛋' } }] });
  h.frame();
  assert.ok(h.texts.some(item => item.value === '小蛋'));
  assert.ok(h.texts.some(item => item.value === '大蛋'));
  assert.equal(h.texts.some(item => /两台手机|把房间码告诉|离开或断线/.test(item.value)), false);
  assert.ok(h.app.getSnapshot().buttons.some(item => item.label === '开始双人突围'));
});

test('leaderboard scope controls request all six boards and browsers explain the WeChat boundary', () => {
  const h = harness({ platform: 'web' }); h.tap('好友榜');
  const modes = ['单人', '双人'], difficulties = ['休闲', '标准', '挑战'];
  for (const mode of modes) {
    h.tap(mode);
    for (const difficulty of difficulties) h.tap(difficulty);
  }
  const scopes = new Set(h.calls.filter(item => item[0] === 'openLeaderboard').map(item => `${item[1].mode}:${item[1].difficultyId}`));
  assert.equal(scopes.size, 6);
  assert.ok(h.texts.some(item => item.value === '请在微信小游戏内查看好友战绩'));
  h.tap('下一页'); h.tap('上一页');
  assert.deepEqual(h.calls.filter(item => item[0] === 'page'), [['page', 1], ['page', -1]]);
  h.tap('返回战区');
  assert.equal(h.app.getSnapshot().screen, 'menu');
  assert.ok(h.calls.some(item => item[0] === 'closeLeaderboard'));
});

test('single-player results submit once per score and wave, and a revive can improve the same run', t => {
  let game;
  const update = Game.prototype.update;
  Game.prototype.update = function (...args) { game = this; return update.apply(this, args); };
  t.after(() => { Game.prototype.update = update; });
  const h = harness(); h.tap('开始突围');
  game.score = 120; game.wave = 3; game.status = 'dead'; game.player.hp = 0;
  h.frame(); h.frame(); h.frame();
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0].mode, 'solo');
  h.tap('免费复活 · 剩余 3 次');
  game.score = 160; game.status = 'dead'; game.player.hp = 0; h.frame(); h.frame();
  assert.equal(h.saves.length, 2); assert.equal(h.saves[1].score, 160);
  assert.equal(h.saves[0].resultId, h.saves[1].resultId);
});

test('a local cooperative death waits for full team defeat and includes the other player', () => {
  const h = harness(); h.tap('双人合作'); h.tap('创建房间');
  h.callbacks.onRoom({ playerId: 'p1', hostId: 'p1', code: '123456', runId: 'aabbcc-room-run', phase: 'playing', mapId: 'greenhouse', difficultyId: 'easy',
    players: [{ id: 'p1', connected: true, profile: { nickName: '小蛋' } }, { id: 'p2', connected: true, profile: { nickName: '大蛋', avatarUrl: '' } }] });
  const authority = new CoopGame({ mapId: 'greenhouse', difficultyId: 'easy' });
  authority.players.p1.hp = 0;
  h.callbacks.onSnapshot(authority.snapshot('p1'), 1); h.frame();
  assert.equal(h.saves.length, 0);
  authority.score = 240; authority.players.p2.hp = 0; authority.status = 'dead';
  h.callbacks.onSnapshot(authority.snapshot('p1'), 2); h.frame(); h.frame();
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0].mode, 'coop');
  assert.equal(h.saves[0].resultId, 'coop-aabbcc-room-run');
  assert.equal(h.saves[0].partnerProfile.nickName, '大蛋');
  assert.equal(h.app.getSnapshot().best.score, 0, 'cooperation never changes the single-player local best');
  assert.ok(h.texts.some(item => item.value === '大蛋'), 'combat label uses the nickname');
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

test('a failed social write leaves revival available and shows a modest sync message', async t => {
  let game;
  const update = Game.prototype.update;
  Game.prototype.update = function (...args) { game = this; return update.apply(this, args); };
  t.after(() => { Game.prototype.update = update; });
  const h = harness({ social: { saveResult: () => Promise.reject(new Error('unavailable')) } });
  h.tap('开始突围'); game.status = 'dead'; game.player.hp = 0;
  h.frame(); await Promise.resolve(); await Promise.resolve(); h.frame();
  assert.ok(h.texts.some(item => item.value === '成绩暂未同步，可稍后查看好友榜'));
  h.tap('免费复活 · 剩余 3 次');
  assert.equal(game.status, 'playing'); assert.equal(game.revivesRemaining, 2);
});
