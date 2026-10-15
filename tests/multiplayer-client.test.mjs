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
  assert.deepEqual(socket.sent[0], { type: 'create', mapId: 'greenhouse', difficultyId: 'easy', compactSnapshots: true });
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
  assert.deepEqual(sent[0], { type: 'join', code: '234567', compactSnapshots: true });
  client.close();
  assert.equal(calls.at(-1), 'close');
});

test('optional display profile is sanitized in room intent and changes use the same authenticated socket', async t => {
  const client = createMultiplayerClient({ endpoint, WebSocketImpl: FakeSocket,
    profile: { nickName: '蛋友', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/a/132', openId: 'do-not-send' } });
  t.after(() => client.close());
  await client.create('greenhouse', 'easy');
  client.setProfile({ nickName: '等待时改名', avatarUrl: 'https://attacker.test/a', sessionKey: 'do-not-send' });
  const socket = FakeSocket.last; socket.emit('open');
  assert.deepEqual(socket.sent[0].profile, { nickName: '等待时改名', avatarUrl: '' });
  assert.equal(JSON.stringify(socket.sent).includes('do-not-send'), false);
  client.setProfile({ nickName: '已授权蛋友', avatarUrl: 'https://wx.qlogo.cn/mmopen/a/132' });
  assert.deepEqual(socket.sent[1], { type: 'profile', profile: { nickName: '已授权蛋友', avatarUrl: 'https://wx.qlogo.cn/mmopen/a/132' } });
  client.setProfile({ nickName: '已授权蛋友', avatarUrl: 'https://wx.qlogo.cn/mmopen/a/132' });
  assert.equal(socket.sent.length, 2, 'unchanged metadata does not generate repeated room broadcasts');
  client.setProfile(null);
  assert.deepEqual(socket.sent[2], { type: 'profile', profile: null });
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

function movingView(time, overrides = {}) {
  const view = fixture({ time, map: { id: 'presentation-test', width: 1280, height: 760, obstacles: [] } });
  const x = 100 + time * 180;
  view.player = { ...view.player, x, y: 100, angle: 0 };
  view.players = [view.player, { ...view.player, id: 'p2', y: 160 }];
  view.enemies = [{ id: 10, x, y: 220, angle: 0, hp: 40, radius: 17, speed: 180 }];
  view.bullets = [{ id: 11, x, y: 280, angle: 0, vx: 180, vy: 0, radius: 3 }];
  view.grenades = [{ id: 12, x, y: 340, angle: 0, vx: 180, vy: 0, radius: 7 }];
  return Object.assign(view, overrides);
}
const quietClient = () => ({ input() {}, action() { return true; } });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);

test('20 Hz authority renders movement on every 60 Hz frame without changing inputs or combat state', () => {
  const inputs = [];
  const game = new NetworkGame({ ...quietClient(), input: value => inputs.push(value) }, movingView(0), 0);
  const rendered = game.getRenderView();
  let priorX = rendered.player.x, frameCount = 0, soundCount = 0;
  for (let tick = 1; tick <= 8; tick++) {
    const view = movingView(tick * .05, { events: [{ type: 'shot' }] });
    view.player.hp = 100 - tick;
    game.applyView(view, tick);
    assert.equal(game.player, view.player, 'input and combat consumers retain authority');
    assert.equal(rendered.player.hp, view.player.hp, 'damage is immediate, never interpolated');
    const playerPose = rendered.player;
    for (let frame = 0; frame < 3; frame++) {
      game.update(1 / 60, { moveX: 1, aimX: 700, aimY: 800, shoot: true });
      frameCount++;
      if (tick > 1) near(rendered.player.x - priorX, 3, 'each display frame advances after the initial buffer fills');
      for (const entity of [rendered.players[1], rendered.enemies[0], rendered.bullets[0], rendered.grenades[0]]) near(entity.x, rendered.player.x, 'all moving groups share the time axis');
      assert.equal(rendered.player, playerPose, 'frames reuse the presentation entity');
      assert.equal(game.player.x, view.player.x, 'display movement cannot mutate authority');
      soundCount += game.events.length;
      priorX = rendered.player.x;
    }
  }
  assert.equal(frameCount, 24); assert.equal(soundCount, 8, 'each snapshot sound drains once');
  assert.deepEqual(inputs.at(-1), { moveX: 1, moveY: 0, aimX: 700, aimY: 800, shoot: true });
  game.aimTarget = { id: 10, x: 150, y: 220 };
  assert.equal(rendered.aimTarget, game.aimTarget, 'late aim-assist changes reach rendering');
  game.update(.2, { moveX: 1 });
  near(rendered.player.x, game.player.x, 'packet loss stops at authority instead of predicting');
});

test('presentation uses the short angular arc, removes entities immediately and rejects stale poses and sounds', () => {
  const first = movingView(0); first.player.angle = Math.PI - .1;
  const game = new NetworkGame(quietClient(), first, 1);
  const second = movingView(.05, { events: [{ type: 'shot' }] }); second.player.angle = -Math.PI + .1;
  second.enemies.push({ id: 99, x: 500, y: 500, hp: 40 }); second.bullets = [];
  game.applyView(second, 2); game.update(.05);
  near(Math.abs(game.getRenderView().player.angle), Math.PI, 'angle crosses the wrap boundary');
  assert.equal(game.getRenderView().enemies.find(enemy => enemy.id === 99).x, 500, 'new entities appear at authority');
  assert.equal(game.getRenderView().bullets.length, 0, 'removed projectiles disappear immediately');
  const position = game.getRenderView().player.x;
  assert.equal(game.applyView(movingView(10, { events: [{ type: 'grenade' }] }), 1), false);
  assert.equal(game.getRenderView().player.x, position);
  assert.deepEqual(game.events, [{ type: 'shot' }]);
  game.update(.025); assert.deepEqual(game.events, []);
});

test('pause, death, revive and teleport discontinuities snap instead of blending stale positions', () => {
  const game = new NetworkGame(quietClient(), movingView(0), 0);
  game.applyView(movingView(.05), 1); game.update(.01);
  const paused = movingView(.1, { paused: true }); game.applyView(paused, 2);
  near(game.getRenderView().player.x, paused.player.x, 'pause settles presentation');
  game.update(.2); near(game.getRenderView().player.x, paused.player.x, 'paused view stays settled');
  const resumed = movingView(.15); game.applyView(resumed, 3);
  near(game.getRenderView().player.x, resumed.player.x, 'resume drops old interpolation');
  const dead = movingView(.2, { status: 'dead' }); dead.player.hp = 0; game.applyView(dead, 4);
  near(game.getRenderView().player.x, dead.player.x, 'death is immediate');
  const survivor = movingView(.25, { status: 'dead' }); survivor.player.hp = 0; game.applyView(survivor, 5); game.update(.05);
  near(game.getRenderView().player.x, survivor.player.x, 'dead local body stays authoritative');
  near(game.getRenderView().players[1].x, (dead.players[1].x + survivor.players[1].x) / 2, 'living teammate still interpolates');
  const revived = movingView(.3); revived.player.x = 700; game.applyView(revived, 6);
  near(game.getRenderView().player.x, 700, 'revive appears at the new spawn');
  const teleported = movingView(.35); teleported.player.x = 100; game.applyView(teleported, 7); game.update(.01);
  near(game.getRenderView().player.x, 100, 'large jumps never sweep across the arena');
});

test('interpolation never draws a body or projectile through an obstacle and bounds jitter delay', () => {
  const map = { id: 'presentation-test', width: 1280, height: 760, obstacles: [{ x: 103, y: 90, w: 3, h: 20 }, { x: 103, y: 270, w: 3, h: 20 }] };
  const game = new NetworkGame(quietClient(), movingView(0, { map }), 0);
  const latest = movingView(.05, { map }); game.applyView(latest, 1); game.update(.01);
  near(game.getRenderView().player.x, latest.player.x, 'wall crossing snaps to valid authority');
  near(game.getRenderView().bullets[0].x, latest.bullets[0].x, 'projectiles cannot draw a chord through walls');
  const jittered = movingView(.18, { map }); game.applyView(jittered, 2);
  assert.ok(game.presentation.time >= .105 - 1e-7, 'jitter cannot accumulate more than 75 ms of presentation delay');
  game.update(.075); near(game.getRenderView().player.x, jittered.player.x, 'a stopped stream settles within 75 ms');
});

test('30 Hz simulation sampled at 20 Hz keeps steady 60 Hz visual speed across alternating 33/67 ms gaps', () => {
  const game = new NetworkGame(quietClient(), movingView(0), 0);
  let prior = null, checked = 0;
  for (let frame = 1; frame <= 90; frame++) {
    if (frame % 3 === 0) {
      const tick = frame / 3;
      game.applyView(movingView(Math.floor(tick * 1.5) / 30), tick);
    }
    game.update(1 / 60);
    const x = game.getRenderView().player.x;
    if (frame > 12) { near(x - prior, 3, 'alternating simulation gaps do not freeze or jump'); checked++; }
    prior = x;
  }
  assert.equal(checked, 78);
});

for (const group of ['players', 'enemies', 'bullets', 'grenades']) {
  for (const discontinuity of ['birth', 'teleport', 'wall corner']) {
    test(`${group} never rewind after ${discontinuity} when later safe snapshots arrive`, () => {
      const id = group === 'players' ? 'p2' : 101;
      const map = { id: 'presentation-test', width: 1280, height: 760,
        obstacles: discontinuity === 'wall corner' ? [{ x: 100, y: 150, w: 10, h: 10 }] : [] };
      const makeView = (time, position, hp = 100) => {
        const view = movingView(time, { map });
        const entity = position && { id, ...position, hp, radius: 3, angle: 0, vx: 900, vy: 0 };
        view[group] = group === 'players' ? [view.player, ...(entity ? [entity] : [])] : entity ? [entity] : [];
        return view;
      };
      const initial = discontinuity === 'birth' ? null : discontinuity === 'teleport' ? { x: 100, y: 170 } : { x: 90, y: 140 };
      const first = discontinuity === 'birth' ? { x: 100, y: 170 } : discontinuity === 'teleport' ? { x: 500, y: 170 } : { x: 120, y: 170 };
      const step = discontinuity === 'wall corner' ? 15 : 45;
      const game = new NetworkGame(quietClient(), makeView(0, initial), 0);
      const entity = () => game.getRenderView()[group].find(candidate => candidate.id === id);
      const positions = [];
      for (let tick = 1; tick <= 3; tick++) {
        const current = { ...first, x: first.x + (tick - 1) * step };
        game.applyView(makeView(tick * .05, current, 100 - tick), tick);
        assert.equal(entity().hp, 100 - tick, 'combat state updates before the display catches up');
        assert.ok(game.presentation.time >= tick * .05 - .075 - 1e-7, 'lifecycle floors do not increase the shared buffer');
        positions.push(entity().x);
        for (let frame = 0; frame < 3; frame++) {
          game.update(1 / 60); positions.push(entity().x);
          assert.ok(entity().x <= current.x + 1e-7, 'presentation never extrapolates');
        }
      }
      near(positions[0], first.x, 'births and unsafe segments appear immediately');
      near(positions[4], first.x, 'the next safe snapshot starts at the already visible pose');
      for (let index = 1; index < positions.length; index++) {
        assert.ok(positions[index] >= positions[index - 1] - 1e-7, `display cannot rewind: ${positions.join(', ')}`);
      }
      assert.ok(positions[positions.length - 1] > first.x, 'movement resumes after the shared clock reaches the lifecycle floor');
      game.applyView(makeView(.2, null), 4);
      assert.equal(entity(), undefined, 'removed entities disappear immediately');
    });
  }
}

test('compact snapshots hydrate local player and cached metadata before reaching the app', async t => {
  const snapshots = [], errors = [];
  const client = createMultiplayerClient({ endpoint, WebSocketImpl: FakeSocket, onSnapshot: view => snapshots.push(view), onError: value => errors.push(value) });
  t.after(() => client.close());
  await client.create('greenhouse', 'easy'); const socket = FakeSocket.last; socket.emit('open'); socket.message(room);
  const full = fixture();
  const compact = { ...full, compact: true, playerId: 'p2', mapId: full.map.id, difficultyId: full.difficulty.id };
  delete compact.player;
  socket.message({ type: 'snapshot', tick: 1, view: compact });
  const subsequent = { ...compact }; delete subsequent.map; delete subsequent.difficulty;
  subsequent.players = compact.players.map(player => ({ ...player, x: player.x + 10 }));
  socket.message({ type: 'snapshot', tick: 2, view: subsequent });
  assert.equal(snapshots.length, 2); assert.deepEqual(errors, []);
  assert.equal(snapshots[1].player.id, 'p2'); assert.equal(snapshots[1].player, snapshots[1].players[1]);
  assert.equal(snapshots[1].map, snapshots[0].map); assert.equal(snapshots[1].difficulty, snapshots[0].difficulty);
  socket.message({ type: 'snapshot', tick: 1, view: { ...compact, mapId: 'wrong' } });
  socket.message({ type: 'snapshot', tick: 3, view: subsequent });
  assert.equal(snapshots.length, 3, 'stale metadata cannot poison the cache');
  socket.message({ type: 'snapshot', tick: 4, view: full });
  assert.equal(snapshots[3].player.id, 'p1', 'old servers remain compatible');
});

for (const missing of ['map', 'difficulty', 'player']) test(`compact snapshots reject missing ${missing} rather than render an incomplete world`, async t => {
  const snapshots = [], errors = [];
  const client = createMultiplayerClient({ endpoint, WebSocketImpl: FakeSocket, onSnapshot: view => snapshots.push(view), onError: value => errors.push(value) });
  t.after(() => client.close());
  await client.join('123456'); const socket = FakeSocket.last; socket.emit('open'); socket.message(room);
  const full = fixture();
  const compact = { ...full, compact: true, playerId: 'p1', mapId: full.map.id, difficultyId: full.difficulty.id };
  delete compact.player;
  if (missing === 'player') compact.playerId = 'p9'; else delete compact[missing];
  socket.message({ type: 'snapshot', tick: 1, view: compact });
  assert.equal(snapshots.length, 0); assert.equal(errors.length, 1); assert.equal(socket.closed, true);
});

test('network metrics measure accepted snapshot bytes, intervals and paired heartbeat RTT, then clear on close', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0;
  const client = createMultiplayerClient({ endpoint, WebSocketImpl: FakeSocket, now: () => time });
  t.after(() => client.close());
  await client.create('greenhouse', 'easy'); const socket = FakeSocket.last; socket.emit('open'); socket.message(room);
  const first = { type: 'snapshot', tick: 1, view: fixture() };
  time = 100; socket.message(first);
  assert.deepEqual(client.getMetrics(), { rttMs: null, snapshotIntervalMs: null, snapshotBytes: Buffer.byteLength(JSON.stringify(first)), snapshotCount: 1 });
  time = 151; socket.message({ ...first, tick: 2 });
  assert.equal(client.getMetrics().snapshotIntervalMs, 51);
  socket.message(first); assert.equal(client.getMetrics().snapshotCount, 2, 'stale snapshots do not update diagnostics');
  const detached = client.getMetrics(); detached.snapshotCount = 999;
  assert.equal(client.getMetrics().snapshotCount, 2, 'callers cannot mutate diagnostics');
  socket.message({ type: 'pong' }); assert.equal(client.getMetrics().rttMs, null, 'unsolicited pong is not an RTT sample');
  time = 15000; t.mock.timers.tick(15000); assert.equal(socket.sent.at(-1).type, 'ping');
  time = 15227; socket.message({ type: 'pong' }); assert.equal(client.getMetrics().rttMs, 227);
  time = 15300; socket.message({ type: 'pong' }); assert.equal(client.getMetrics().rttMs, 227, 'one ping has only one measurement');
  client.close();
  assert.deepEqual(client.getMetrics(), { rttMs: null, snapshotIntervalMs: null, snapshotBytes: null, snapshotCount: 0 });
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
  h.tap('返回战区');
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
