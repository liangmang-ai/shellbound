import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game.js';
import { NetworkGame, createMultiplayerClient } from '../src/multiplayer.js';
import { browserSocketURL, NETWORK_CONFIG } from '../src/network-config.js';
import { createApp } from '../src/app.js';

class FakeSocket {
  constructor(url) { this.url = url; this.events = {}; this.sent = []; this.closed = false; FakeSocket.last = this; }
  addEventListener(event, callback) { this.events[event] = callback; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; this.events.close?.(); }
  emit(event, value = {}) { this.events[event]?.(value); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
}
const endpoint = 'ws://127.0.0.1:8787/ws';
const room = { type: 'room', code: '123456', playerId: 'p1', players: [{ id: 'p1', connected: true }, { id: 'p2', connected: true }], hostId: 'p1', mapId: 'greenhouse', difficultyId: 'easy', phase: 'playing', paused: false, pauseOwnerId: null };
function fixture(overrides = {}) {
  const single = new Game({ mapId: 'greenhouse', difficultyId: 'easy', seed: 1 });
  const player = { ...single.player, id: 'p1' };
  return { player, players: [player, { ...player, id: 'p2', x: player.x + 50 }], map: single.map, difficulty: single.difficulty,
    enemies: [], bullets: [], grenades: [], pickups: [], barrels: [], effects: [], wave: 1, waveTotal: 3, waveKills: 0, score: 0,
    kills: 0, time: 1, status: 'playing', teamStatus: 'playing', revivesRemaining: 3, paused: false, pauseOwnerId: null, events: [], ...overrides };
}

test('browser endpoints are fixed and only local pages enable the local relay', () => {
  assert.equal(browserSocketURL({ hostname: 'localhost', search: '?server=wss://attacker.example' }), endpoint);
  assert.equal(browserSocketURL({ hostname: '127.0.0.1' }), endpoint);
  assert.equal(browserSocketURL({ hostname: 'example.com' }), null);
});

test('browser connects with ordered room intent, actions, seq and closes without late callbacks', async t => {
  const rooms = [], snapshots = [], errors = [];
  const client = createMultiplayerClient({ endpoint, WebSocketImpl: FakeSocket, onRoom: value => rooms.push(value), onSnapshot: (...value) => snapshots.push(value), onError: value => errors.push(value) });
  t.after(() => client.close());
  await client.create('greenhouse', 'easy');
  const socket = FakeSocket.last;
  assert.deepEqual(socket.sent, []);
  socket.emit('open');
  assert.deepEqual(socket.sent[0], { type: 'create', mapId: 'greenhouse', difficultyId: 'easy' });
  socket.message(room);
  socket.message({ type: 'snapshot', tick: 2, paused: true, pauseOwnerId: 'p1', view: fixture() });
  assert.equal(rooms.length, 1);
  assert.equal(snapshots[0][0].paused, true);
  client.input({ moveX: 1 }); client.input({ moveX: 0 }); client.action('boost'); client.pause(true);
  assert.deepEqual(socket.sent.slice(1), [{ type: 'input', seq: 1, input: { moveX: 1 } }, { type: 'input', seq: 2, input: { moveX: 0 } }, { type: 'action', action: 'boost' }, { type: 'pause', paused: true }]);
  client.close();
  socket.message(room); socket.emit('error');
  assert.equal(rooms.length, 1); assert.deepEqual(errors, []); assert.equal(socket.closed, true);
});

test('WeChat connects through cloud identity and never falls back to a public WebSocket', async t => {
  const calls = [], handlers = {}, sent = [];
  const task = { onOpen: fn => { handlers.open = fn; }, onMessage: fn => { handlers.message = fn; }, onError: fn => { handlers.error = fn; }, onClose: fn => { handlers.close = fn; }, send: value => sent.push(JSON.parse(value.data)), close: () => calls.push('close') };
  const wxApi = { cloud: { init: config => calls.push(config), connectContainer: async config => { calls.push(config); return { socketTask: task }; } } };
  const client = createMultiplayerClient({ platform: 'wechat', wxApi, WebSocketImpl: class { constructor() { throw new Error('no fallback'); } } });
  t.after(() => client.close());
  await client.join('234567'); handlers.open();
  assert.deepEqual(calls[0], { env: NETWORK_CONFIG.env, traceUser: true });
  assert.deepEqual(calls[1], { config: { env: NETWORK_CONFIG.env }, service: NETWORK_CONFIG.service, path: '/ws' });
  assert.deepEqual(sent[0], { type: 'join', code: '234567' });
  client.close();
  assert.equal(calls.at(-1), 'close');
});

test('leaving before the async WeChat connection resolves closes the stale socket', async () => {
  let finish, closed = 0, notified = 0;
  const wxApi = { cloud: { init() {}, connectContainer: () => new Promise(resolve => { finish = resolve; }) } };
  const client = createMultiplayerClient({ platform: 'wechat', wxApi, onRoom: () => notified++ });
  const connecting = client.create('greenhouse', 'easy');
  client.close();
  finish({ socketTask: { close: () => closed++ } });
  await connecting;
  assert.equal(closed, 1); assert.equal(notified, 0);
});

test('handshake timeout and disconnect terminate the connection once', async () => {
  const errors = [];
  const client = createMultiplayerClient({ endpoint, WebSocketImpl: FakeSocket, timeoutMs: 5, onError: value => errors.push(value) });
  await client.join('123456');
  const socket = FakeSocket.last;
  await new Promise(resolve => setTimeout(resolve, 20));
  socket.emit('close'); socket.emit('error');
  assert.equal(errors.length, 1); assert.match(errors[0], /超时/); assert.equal(socket.closed, true);
});

test('NetworkGame renders authority, drains events once and sends one-shot actions between input ticks', () => {
  const inputs = [], actions = [], client = { input: value => inputs.push(value), action: (...value) => { actions.push(value); return true; } };
  const view = fixture({ events: [{ type: 'shot' }] });
  const game = new NetworkGame(client, view, 4), position = game.player.x;
  game.update(0, { moveX: 1, moveY: 0, shoot: true });
  assert.equal(game.player.x, position, 'no local simulation is performed');
  assert.deepEqual(game.events, [{ type: 'shot' }]);
  game.update(.001, { grenade: true, grenadeTarget: { x: 42, y: 70 }, weaponSlot: 'pistol' });
  assert.equal(inputs.length, 1, 'continuous inputs are throttled');
  assert.deepEqual(actions, [['grenade', { target: { x: 42, y: 70 } }], ['weapon', { weaponId: 'pistol' }]]);
  assert.deepEqual(game.events, []);
  assert.equal(game.applyView(fixture({ events: [{ type: 'shot' }] }), 4), false, 'duplicate and stale snapshots are ignored');
  assert.equal(game.applyView(fixture({ score: 50 }), 5), true);
  assert.equal(game.score, 50);
});

test('held one-shot inputs consume once, numeric slots include zero and rapid weapon cycles carry explicit IDs', () => {
  const actions = [], client = { input() {}, action: (...value) => { actions.push(value); return true; } };
  const view = fixture();
  view.player.weapons.pistol.reserve = null;
  view.player.weapons.smg = { clip: 30, reserve: 90 };
  view.player.weapons.rifle = { clip: 30, reserve: 90 };
  const game = new NetworkGame(client, view);
  assert.equal(game.player.weapons.pistol.reserve, Infinity);
  game.update(0, { grenade: true, weaponNext: true });
  game.update(.001, { grenade: true, weaponNext: true });
  assert.deepEqual(actions, [['grenade', { target: undefined }], ['weapon', { weaponId: 'smg' }]]);
  game.update(.001, {}); game.update(.001, { weaponNext: true });
  assert.deepEqual(actions.at(-1), ['weapon', { weaponId: 'rifle' }], 'cycles use the pending weapon while the next snapshot is in flight');
  game.update(.001, { weaponSlot: 0 });
  assert.deepEqual(actions.at(-1), ['weapon', { weaponId: 'pistol' }]);
});

function appHarness() {
  const context = new Proxy({ measureText: value => ({ width: String(value).length * 8 }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (object, key) => object[key] || (() => {}) });
  const calls = [], clients = [], stored = [];
  const app = createApp({ canvas: { getContext: () => context }, width: 844, height: 390,
    storage: { getItem: () => null, setItem: (...value) => stored.push(value) },
    multiplayerFactory(options) {
      const client = { options, create: (...value) => calls.push(['create', ...value]), join: code => calls.push(['join', code]), input: input => calls.push(['input', input]), action: (...value) => { calls.push(['action', ...value]); return true; }, pause: paused => calls.push(['pause', paused]), start: () => calls.push(['start']), close: () => calls.push(['close']) };
      clients.push(client); return client;
    } });
  let time = 0;
  const frame = () => app.frame(time += 16);
  const tap = label => {
    frame(); const value = app.getSnapshot().buttons.find(button => button.label === label);
    assert.ok(value, `visible ${label}`);
    const layout = app.getSnapshot().layout;
    app.handlePointer('down', { x: layout.ox + (value.x + value.w / 2) * layout.scale, y: layout.oy + (value.y + value.h / 2) * layout.scale, button: 0 });
    app.handlePointer('up', { x: 0, y: 0, button: 0 }); frame();
  };
  frame(); tap('双人合作');
  return { app, frame, tap, calls, clients, stored };
}

test('co-op menu creates rooms, waits for host start and can leave without stale re-entry', () => {
  const h = appHarness(); h.tap('创建房间');
  assert.deepEqual(h.calls[0], ['create', 'greenhouse', 'easy']);
  const client = h.clients[0]; client.options.onRoom({ ...room, phase: 'waiting' });
  h.tap('开始双人突围'); assert.ok(h.calls.some(call => call[0] === 'start'));
  h.tap('返回地图选择');
  client.options.onSnapshot(fixture(), 1); client.options.onRoom(room);
  assert.equal(h.app.getSnapshot().screen, 'menu'); assert.ok(h.calls.some(call => call[0] === 'close'));
});

test('six digit room keypad joins and keyboard backspace edits the same code', () => {
  const h = appHarness(); h.tap('输入房间码加入');
  for (const value of ['1', '2', '3', '4', '5', '6']) h.tap(value);
  h.app.handleKey('down', 'Backspace'); h.app.handleKey('down', '7'); h.tap('加入房间');
  assert.deepEqual(h.calls[0], ['join', '123457']);
});

test('network combat uses local HUD, synchronized pause and does not persist single-player scores', () => {
  const h = appHarness(); h.tap('创建房间'); const client = h.clients[0];
  client.options.onRoom(room); client.options.onSnapshot(fixture(), 1); h.frame();
  assert.equal(h.app.getSnapshot().game.online, true); assert.equal(h.app.getSnapshot().game.players.length, 2);
  h.app.pause(); assert.equal(h.app.getSnapshot().paused, true); assert.ok(h.calls.some(value => value[0] === 'pause' && value[1] === true));
  client.options.onRoom({ ...room, paused: true, phase: 'paused', pauseOwnerId: 'p2', pauseOwnerIds: ['p2'] }); h.frame();
  assert.equal(h.app.getSnapshot().paused, true);
  assert.equal(h.app.getSnapshot().buttons.some(value => value.label === '继续突围'), false, 'only the pausing teammate can continue');
  h.app.handleKey('down', 'Escape'); assert.equal(h.calls.filter(value => value[0] === 'pause' && value[1] === false).length, 0);
  client.options.onRoom({ ...room, paused: true, phase: 'paused', pauseOwnerId: 'p1', pauseOwnerIds: ['p1'] }); h.app.resume(); h.tap('继续突围');
  assert.ok(h.calls.some(value => value[0] === 'pause' && value[1] === false));
  client.options.onSnapshot(fixture({ status: 'dead', score: 99999 }), 2); h.frame();
  assert.deepEqual(h.stored, []); assert.equal(h.app.getSnapshot().best.score, 0);
});

test('portrait and application background pause the shared battle, foreground needs an explicit continue', () => {
  const h = appHarness(); h.tap('创建房间'); const client = h.clients[0];
  client.options.onRoom(room); client.options.onSnapshot(fixture(), 1); h.frame();
  h.app.resize({ width: 390, height: 844 });
  assert.equal(h.app.getSnapshot().paused, true);
  h.app.resize({ width: 844, height: 390 }); h.app.resume(); h.frame();
  assert.equal(h.app.getSnapshot().paused, true);
  assert.equal(h.calls.filter(value => value[0] === 'pause' && value[1] === false).length, 0);
  assert.ok(h.calls.filter(value => value[0] === 'input').at(-1)[1].shoot === false);
});

test('both players can release their own pause and the last outstanding pause still freezes the battle', () => {
  const h = appHarness(); h.tap('创建房间'); const client = h.clients[0];
  client.options.onRoom(room); client.options.onSnapshot(fixture(), 1); h.frame();
  client.options.onRoom({ ...room, paused: true, phase: 'paused', pauseOwnerId: 'p2', pauseOwnerIds: ['p2', 'p1'] });
  h.tap('继续突围');
  assert.equal(h.calls.filter(call => call[0] === 'pause' && call[1] === false).length, 1, 'local player may release their request even when another player paused first');
  client.options.onSnapshot(fixture({ paused: true, pauseOwnerId: 'p2', pauseOwnerIds: ['p2'] }), 2); h.frame();
  assert.equal(h.app.getSnapshot().paused, true, 'the teammate is still paused');
  assert.equal(h.app.getSnapshot().buttons.some(button => button.label === '继续突围'), false);
  h.app.handleKey('down', 'Escape');
  assert.equal(h.calls.filter(call => call[0] === 'pause' && call[1] === false).length, 1, 'local player cannot clear the teammate request');
  client.options.onSnapshot(fixture({ paused: false, pauseOwnerId: null, pauseOwnerIds: [] }), 3); h.frame();
  assert.equal(h.app.getSnapshot().paused, false, 'combat resumes only after all owners have continued');
});

for (const roomFirst of [true, false]) test(`hidden waiting player registers pause when combat arrives ${roomFirst ? 'through room announcement' : 'through the first snapshot'}`, () => {
  const h = appHarness(); h.tap('创建房间'); const client = h.clients[0];
  const guestRoom = { ...room, playerId: 'p2', phase: 'waiting', paused: false, pauseOwnerId: null, pauseOwnerIds: [] };
  client.options.onRoom(guestRoom);
  h.app.pause();
  assert.equal(h.app.getSnapshot().game, null);
  assert.equal(h.calls.filter(call => call[0] === 'pause').length, 0, 'the waiting room has no combat to pause yet');
  if (roomFirst) client.options.onRoom({ ...guestRoom, phase: 'playing' });
  client.options.onSnapshot(fixture(), 1); h.frame();
  assert.equal(h.app.getSnapshot().paused, true);
  assert.equal(h.calls.filter(call => call[0] === 'pause' && call[1] === true).length, 1, 'the newly started game gets this hidden player pause request once');
  client.options.onSnapshot(fixture({ paused: false, pauseOwnerIds: [] }), 2); h.frame();
  assert.equal(h.app.getSnapshot().paused, true, 'an older unpaused authority view cannot activate a hidden player');
  client.options.onRoom({ ...guestRoom, phase: 'paused', paused: true, pauseOwnerId: 'p2', pauseOwnerIds: ['p2'] });
  h.app.handleKey('down', 'Escape');
  assert.equal(h.calls.filter(call => call[0] === 'pause' && call[1] === false).length, 0, 'hidden clients cannot continue even with a pause acknowledgement');
  h.app.resume(); h.frame();
  assert.equal(h.app.getSnapshot().paused, true, 'foregrounding leaves the shared pause in place');
  h.tap('继续突围');
  assert.equal(h.calls.filter(call => call[0] === 'pause' && call[1] === false).length, 1);
  client.options.onSnapshot(fixture({ paused: false, pauseOwnerIds: [] }), 3); h.frame();
  assert.equal(h.app.getSnapshot().paused, false);
});

test('hiding after both players die registers a pause before a teammate revive can restart hidden participation', () => {
  const h = appHarness(); h.tap('创建房间'); const client = h.clients[0];
  client.options.onRoom(room);
  client.options.onSnapshot(fixture({ status: 'dead', teamStatus: 'dead' }), 1); h.frame();
  h.app.pause();
  assert.ok(h.calls.some(call => call[0] === 'pause' && call[1] === true), 'all-dead rooms still record a background pause');
  client.options.onSnapshot(fixture({ status: 'dead', teamStatus: 'playing' }), 2); h.frame();
  assert.equal(h.app.getSnapshot().paused, true, 'a teammate revive does not re-enter combat while this app is hidden');
  client.options.onRoom({ ...room, paused: true, phase: 'paused', pauseOwnerId: 'p1', pauseOwnerIds: ['p1'] });
  h.app.resume(); h.frame();
  assert.equal(h.app.getSnapshot().paused, true);
  assert.equal(h.calls.some(call => call[0] === 'pause' && call[1] === false), false);
  h.tap('继续突围');
  client.options.onSnapshot(fixture({ status: 'dead', teamStatus: 'playing', paused: false, pauseOwnerIds: [] }), 3); h.frame();
  assert.equal(h.app.getSnapshot().paused, false);
  assert.ok(h.app.getSnapshot().buttons.some(button => button.label.includes('免费复活')));
});

test('WeChat connect rejection explains identity deployment and iOS performance limitations without public fallback', async () => {
  const errors = [];
  let fallbacks = 0;
  const wxApi = { cloud: { init() {}, connectContainer: async () => { throw new Error('connection rejected'); } } };
  const client = createMultiplayerClient({ platform: 'wechat', wxApi, WebSocketImpl: class { constructor() { fallbacks++; } }, onError: value => errors.push(value) });
  await client.create('greenhouse', 'easy');
  assert.equal(fallbacks, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /部署与身份权限/);
  assert.match(errors[0], /iOS 高性能\+/);
});

test('foregrounding before the background pause acknowledgement stays frozen until an explicit continue', () => {
  const h = appHarness(); h.tap('创建房间'); const client = h.clients[0];
  client.options.onRoom(room); client.options.onSnapshot(fixture(), 1); h.frame();
  h.app.pause(); h.app.resume();
  client.options.onSnapshot(fixture({ paused: false, pauseOwnerIds: [] }), 2); h.frame();
  assert.equal(h.app.getSnapshot().paused, true, 'in-flight unpaused snapshot cannot clear the lifecycle pause latch');
  client.options.onRoom({ ...room, phase: 'paused', paused: true, pauseOwnerId: 'p1', pauseOwnerIds: ['p1'] });
  h.tap('继续突围');
  client.options.onSnapshot(fixture({ paused: false, pauseOwnerIds: [] }), 3); h.frame();
  assert.equal(h.app.getSnapshot().paused, false);
});
