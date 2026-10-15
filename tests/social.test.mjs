import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocial } from '../src/social.js';
import { compareResults, leaderboardKey, makeRecord, parseRecord, SOCIAL_CHANNEL, utf8Bytes } from '../src/social-data.js';
import { createOpenDataController } from '../wechat/open-data/index.js';

const profile = { nickName: '蛋壳队长', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/avatar/132', authorized: true };
const result = (extra = {}) => ({ mode: 'solo', difficultyId: 'easy', score: 100, wave: 3, resultId: 'run-1', ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));

function canvasHarness() {
  const text = [], drawn = [];
  const ctx = new Proxy({ fillText: value => text.push(String(value)), drawImage: (...args) => drawn.push(args),
    measureText: value => ({ width: Array.from(String(value)).length * 8 }) }, {
    get(target, name) { return name in target ? target[name] : () => {}; },
  });
  return { canvas: { width: 1000, height: 650, getContext: () => ctx }, ctx, text, drawn };
}

test('six explicit boards compare score before wave and reject malformed client results', () => {
  assert.equal(new Set(['solo', 'coop'].flatMap(mode => ['easy', 'normal', 'hard'].map(level => leaderboardKey(mode, level)))).size, 6);
  assert.equal(leaderboardKey('duo', 'easy'), null);
  assert.equal(leaderboardKey('solo', '__proto__'), null);
  assert.ok(compareResults({ score: 200, wave: 1 }, { score: 100, wave: 99 }) < 0);
  assert.ok(compareResults({ score: 100, wave: 5 }, { score: 100, wave: 4 }) < 0);
  for (const extra of [{ score: -1 }, { score: NaN }, { wave: 0 }, { score: 1.5 }, { mode: 'any' }]) assert.equal(makeRecord(result(extra), profile), null);
  assert.equal(parseRecord('{bad-json', 'solo'), null);
  assert.equal(parseRecord('{"v":1,"score":0,"wave":0,"players":[]}', 'solo'), null);
});

test('cloud budget counts key plus UTF-8 JSON and retains both teammate names when avatars are omitted', () => {
  const avatarUrl = 'https://thirdwx.qlogo.cn/' + 'a'.repeat(470);
  const first = { nickName: '🥚'.repeat(24), avatarUrl }, second = { nickName: '队友'.repeat(12), avatarUrl };
  const value = makeRecord(result({ mode: 'coop', partnerProfile: second }), first);
  assert.ok(utf8Bytes(value.key) + utf8Bytes(value.value) <= 1024);
  assert.equal(value.record.players.length, 2);
  assert.equal(value.record.players[0].nickName, first.nickName);
  assert.equal(value.record.players[1].nickName, second.nickName);
  assert.deepEqual(value.record.players.map(player => player.avatarUrl), ['', '']);
  assert.equal(makeRecord(result(), { ...profile, authorized: false }).record.players[0].nickName, '游客');
  assert.equal(makeRecord(result({ mode: 'coop' }), null).record.players[1].nickName, '游客');
});

test('profile restore never reads denied scope or missing privacy consent and never prompts automatically', () => {
  for (const scenario of [{ scope: false, privacy: false }, { scope: true, privacy: true }]) {
    let reads = 0, prompts = 0;
    const social = createSocial({ platform: 'wechat', wxApi: {
      getSetting: ({ success }) => success({ authSetting: { 'scope.userInfo': scenario.scope } }),
      getPrivacySetting: ({ success }) => success({ needAuthorization: scenario.privacy }),
      getUserInfo: () => reads++, requirePrivacyAuthorize: () => prompts++,
    } });
    assert.equal(reads, 0); assert.equal(prompts, 0);
    assert.equal(social.getProfile().authorized, false);
  }
});

test('an existing explicit profile grant restores without credentials or unrelated fields', () => {
  let options;
  const social = createSocial({ platform: 'wechat', wxApi: {
    getSetting: ({ success }) => success({ authSetting: { 'scope.userInfo': true } }),
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getUserInfo(value) { options = value; value.success({ userInfo: { ...profile, openId: 'never-keep', gender: 1 } }); },
  } });
  assert.equal(options.withCredentials, false);
  assert.deepEqual(social.getProfile(), profile);
});

test('native profile button is visible, stable for repeated bounds, and denial keeps a guest playable', () => {
  let nativeOptions, tap, creates = 0, hides = 0, shows = 0, changes = 0, callback;
  const social = createSocial({ platform: 'wechat', wxApi: {
    createUserInfoButton(options) {
      creates++; nativeOptions = options;
      return { onTap(fn) { tap = fn; }, hide() { hides++; }, show() { shows++; }, destroy() {} };
    },
  } });
  const stop = social.onProfileChange(() => changes++);
  const bounds = { x: 50, y: 60, w: 150, h: 44 };
  social.showProfileButton(bounds, (...args) => { callback = args; });
  social.showProfileButton(bounds, (...args) => { callback = args; });
  assert.equal(creates, 1); assert.equal(nativeOptions.text, '授权微信头像昵称');
  assert.equal(nativeOptions.withCredentials, false);
  assert.equal(nativeOptions.style.left, 50); assert.equal(nativeOptions.style.lineHeight, 44);
  assert.notEqual(nativeOptions.style.backgroundColor, 'transparent');
  tap({ errMsg: 'getUserInfo:fail auth deny' });
  assert.equal(social.getProfile().authorized, false); assert.match(callback[1], /游客/);
  tap({ errMsg: 'getUserInfo:ok', userInfo: { ...profile, avatarUrl: 'https://attacker.example/a' } });
  assert.equal(social.getProfile().authorized, true); assert.equal(social.getProfile().avatarUrl, '');
  assert.equal(changes, 1); assert.equal(hides, 1);
  stop(); social.showProfileButton(bounds); assert.equal(shows, 2);
  social.hideProfileButton(); tap({ userInfo: { nickName: 'late result' } });
  assert.equal(social.getProfile().nickName, profile.nickName);
});

test('avatar images accept only safe HTTPS WeChat URLs, use fallback while loading, and cache failures', () => {
  const images = [];
  const social = createSocial({ imageFactory() { const image = {}; images.push(image); return image; } });
  for (const url of ['http://thirdwx.qlogo.cn/a', 'https://qlogo.cn.attacker.example/a', 'https://u:p@qlogo.cn/a', 'https://evil/a', 'data:image/svg+xml,test']) assert.equal(social.getAvatar(url), null);
  assert.equal(images.length, 0);
  assert.equal(social.getAvatar(profile.avatarUrl), null); assert.equal(images.length, 1);
  images[0].onload(); assert.equal(social.getAvatar(profile.avatarUrl), images[0]);
  images[0].onerror(); assert.equal(social.getAvatar(profile.avatarUrl), null); assert.equal(images.length, 1);
  for (let i = 0; i < 40; i++) social.getAvatar(`https://thirdwx.qlogo.cn/a${i}`);
  social.getAvatar(profile.avatarUrl); assert.equal(images.length, 42, 'the oldest entry is evicted from the bounded 32-image cache');
});

test('main domain posts only sanitized result records and suppresses repeat or lower results from one run', async () => {
  const messages = [];
  const social = createSocial({ platform: 'wechat', wxApi: { getOpenDataContext: () => ({ postMessage: value => messages.push(value) }),
    getUserCloudStorage() { assert.fail('read forbidden in main domain'); }, setUserCloudStorage() { assert.fail('write must follow open-domain read'); } } });
  assert.deepEqual(await social.saveResult(result()), { status: 'queued' });
  assert.deepEqual(await social.saveResult(result()), { status: 'duplicate' });
  assert.deepEqual(await social.saveResult(result({ score: 50, wave: 100 })), { status: 'duplicate' });
  assert.deepEqual(await social.saveResult(result({ score: 100, wave: 4 })), { status: 'queued' });
  assert.equal(messages.length, 2); assert.equal(messages[0].channel, SOCIAL_CHANNEL);
  assert.equal(messages[0].record.players[0].nickName, '游客');
  assert.deepEqual(await createSocial().saveResult(result()), { status: 'unsupported' });
  assert.deepEqual(await createSocial({ platform: 'wechat', wxApi: {} }).saveResult(result()), { status: 'unavailable' });
});

test('friend authorization is explicit, privacy-first, and stale permission callbacks cannot reopen a closed board', () => {
  const messages = [], requests = [], h = canvasHarness(); let privacy;
  const social = createSocial({ platform: 'wechat', wxApi: {
    getOpenDataContext: () => ({ canvas: h.canvas, postMessage: value => messages.push(value) }),
    requirePrivacyAuthorize(options) { requests.push('privacy'); privacy = options; },
    authorize(options) { requests.push(options.scope); options.fail(); },
  } });
  assert.deepEqual(requests, []);
  social.openLeaderboard({ mode: 'coop', difficultyId: 'hard', bounds: { x: 0, y: 0, w: 400, h: 200 } });
  assert.deepEqual(requests, ['privacy']); privacy.success();
  assert.deepEqual(requests, ['privacy', 'scope.WxFriendInteraction']);
  social.drawLeaderboard(h.ctx, { x: 0, y: 0, w: 400, h: 200 });
  assert.ok(h.text.some(value => value.includes('未开启好友互动')));
  social.closeLeaderboard(); const count = messages.length; privacy.success();
  assert.equal(messages.length, count);
});

test('first profile request waits for a real click and privacy approval before creating the native button or syncing scores', async () => {
  const messages = [], requests = []; let privacy, tap, nativeCreates = 0;
  const social = createSocial({ platform: 'wechat', wxApi: {
    getPrivacySetting: ({ success }) => success({ needAuthorization: true }),
    requirePrivacyAuthorize(options) { requests.push('privacy'); privacy = options; },
    getOpenDataContext: () => ({ postMessage: value => messages.push(value) }),
    createUserInfoButton() { nativeCreates++; return { onTap(fn) { tap = fn; }, show() {}, hide() {} }; },
  } });
  const bounds = { x: 20, y: 30, w: 180, h: 44 };
  assert.equal(social.showProfileButton(bounds), false);
  assert.deepEqual(await social.saveResult(result()), { status: 'pending-consent' });
  assert.deepEqual(await social.saveResult(result({ score: 200 })), { status: 'pending-consent' });
  assert.deepEqual(requests, []); assert.equal(nativeCreates, 0); assert.deepEqual(messages, []);
  social.requestProfileAuthorization(bounds); assert.equal(nativeCreates, 0); privacy.success();
  assert.equal(nativeCreates, 1); assert.deepEqual(messages, []);
  tap({ errMsg: 'getUserInfo:ok', userInfo: profile });
  assert.equal(messages.length, 1); assert.equal(messages[0].record.score, 200);
  assert.equal(messages[0].record.players[0].nickName, profile.nickName);
});

test('a late automatic restore cannot replace a newer profile selected on the native button', () => {
  let restore, tap;
  const social = createSocial({ platform: 'wechat', wxApi: {
    getSetting: ({ success }) => success({ authSetting: { 'scope.userInfo': true } }),
    getUserInfo(options) { restore = options; },
    createUserInfoButton() { return { onTap(fn) { tap = fn; }, show() {}, hide() {} }; },
  } });
  social.showProfileButton({ x: 0, y: 0, w: 180, h: 44 });
  tap({ userInfo: { nickName: '新昵称', avatarUrl: '' } });
  restore.success({ userInfo: { nickName: '过期昵称', avatarUrl: '' } });
  assert.equal(social.getProfile().nickName, '新昵称');
});

function openDomain({ stored = [], friends = [] } = {}) {
  const h = canvasHarness(), writes = [], reads = [], timers = new Map(); let timerId = 0;
  const wxApi = { onMessage() {}, getUserCloudStorage(options) { reads.push(options); options.success({ KVDataList: stored }); },
    setUserCloudStorage(options) { writes.push(options); options.success({}); },
    getFriendCloudStorage(options) { options.success({ data: friends }); },
  };
  const controller = createOpenDataController(wxApi, { canvas: h.canvas,
    setTimer(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimer(id) { timers.delete(id); } });
  const send = value => controller.receive({ channel: SOCIAL_CHANNEL, ...value });
  const save = (extra = {}, self = profile) => {
    const value = result(extra), payload = makeRecord(value, self);
    send({ type: 'save', mode: value.mode, difficultyId: value.difficultyId, record: payload.record });
  };
  return { ...h, wxApi, controller, send, save, writes, reads, timers };
}

test('open domain reads the previous best before writing and a lower result cannot replace it', async () => {
  const high = makeRecord(result({ score: 300, wave: 2 }), profile);
  const h = openDomain({ stored: [{ key: high.key, value: high.value }] });
  h.save(); await settle(); assert.equal(h.writes.length, 0);
  h.save({ score: 300, wave: 4 }); await settle();
  assert.equal(h.writes.length, 1); assert.equal(JSON.parse(h.writes[0].KVDataList[0].value).wave, 4);
});

test('read failure preserves cloud history and retries without writing unknown previous scores', async () => {
  const h = openDomain();
  h.wxApi.getUserCloudStorage = options => options.fail({ errMsg: 'offline' });
  h.save(); await settle(); assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 1);
  h.wxApi.getUserCloudStorage = options => options.success({ KVDataList: [makeRecord(result({ score: 999 }), profile)] });
  // A retry reads again and discovers the higher cloud result before any write.
  const retry = h.timers.values().next().value; h.timers.clear(); retry(); await settle();
  assert.equal(h.writes.length, 0);
});

test('malformed previous cloud data is preserved instead of being treated as a missing best', async () => {
  const key = leaderboardKey('solo', 'easy');
  const h = openDomain({ stored: [{ key, value: '{corrupted' }] });
  h.save(); await settle(); assert.equal(h.writes.length, 0);
});

test('open-domain writes are serialized when a newer same-board result arrives during the cloud read', async () => {
  const h = openDomain(); let firstRead;
  h.wxApi.getUserCloudStorage = options => { h.reads.push(options); if (!firstRead) firstRead = options; else options.success({ KVDataList: [] }); };
  h.save({ score: 100 }); h.save({ score: 200 });
  assert.equal(h.reads.length, 1); assert.equal(h.writes.length, 0);
  firstRead.success({ KVDataList: [] }); await settle();
  assert.deepEqual(h.writes.map(call => JSON.parse(call.KVDataList[0].value).score), [100, 200]);
  assert.equal(h.reads.length, 2);
});

test('friend rows sort score then wave and render only consented teammate profiles inside shared canvas', async () => {
  const makeFriend = (score, wave, name) => {
    const entry = makeRecord(result({ mode: 'coop', score, wave, resultId: `${score}-${wave}`, partnerProfile: { nickName: `${name}队友`, avatarUrl: '' } }), { nickName: name, avatarUrl: '' });
    return { nickName: 'DO NOT RENDER PLATFORM RAW NAME', avatarUrl: 'https://attacker.example/a', openId: 'DO NOT EXPORT OPENID', KVDataList: [{ key: entry.key, value: entry.value }] };
  };
  const h = openDomain({ friends: [makeFriend(50, 99, '第三名'), makeFriend(100, 3, '第二名'), makeFriend(100, 5, '第一名')] });
  h.send({ type: 'open', mode: 'coop', difficultyId: 'easy' }); await settle();
  const names = h.text.filter(value => /第[一二三]名/.test(value));
  assert.deepEqual(names, ['第一名', '第一名队友', '第二名', '第二名队友', '第三名', '第三名队友']);
  assert.equal(h.text.some(value => value.includes('DO NOT')), false);
});

test('compact friend board paginates every row, clamps boundaries, and combines two entries for one coop run', async () => {
  const friend = (score, id, first, second) => {
    const entry = makeRecord(result({ mode: 'coop', score, resultId: id, partnerProfile: { nickName: second, avatarUrl: '' } }), { nickName: first, avatarUrl: '' });
    return { KVDataList: [{ key: entry.key, value: entry.value }] };
  };
  const h = openDomain({ friends: [friend(300, 'team-a', '甲', '乙'), friend(300, 'team-a', '乙', '甲'),
    friend(200, 'team-b', '丙', '丁'), friend(100, 'team-c', '戊', '己')] });
  h.canvas.height = 320;
  h.send({ type: 'open', mode: 'coop', difficultyId: 'easy' }); await settle();
  assert.ok(h.text.includes('甲')); assert.ok(!h.text.includes('丙')); assert.ok(h.text.includes('第 1 / 3 页 · 微信同玩好友'));
  h.text.length = 0; h.send({ type: 'page', delta: 1 });
  assert.ok(h.text.includes('丙')); assert.ok(h.text.includes('丁')); assert.ok(h.text.includes('2'));
  h.text.length = 0; h.send({ type: 'page', delta: 1 });
  assert.ok(h.text.includes('戊')); assert.ok(h.text.includes('第 3 / 3 页 · 微信同玩好友'));
  h.text.length = 0; h.send({ type: 'page', delta: 1 });
  assert.ok(h.text.includes('第 3 / 3 页 · 微信同玩好友'));
  h.text.length = 0; h.send({ type: 'open', mode: 'coop', difficultyId: 'easy' }); await settle();
  assert.ok(h.text.includes('第 1 / 3 页 · 微信同玩好友'));
});

test('switching board while a native permission prompt is pending discards earlier friend responses', async () => {
  const h = openDomain(); let firstFriends;
  h.wxApi.getFriendCloudStorage = options => { firstFriends = options; };
  h.send({ type: 'open', mode: 'solo', difficultyId: 'easy' });
  h.send({ type: 'prepare', mode: 'coop', difficultyId: 'hard' });
  const previous = makeRecord(result(), { nickName: '旧难度好友', avatarUrl: '' });
  firstFriends.success({ data: [{ KVDataList: [{ key: previous.key, value: previous.value }] }] });
  await settle();
  assert.equal(h.text.includes('旧难度好友'), false);
});
