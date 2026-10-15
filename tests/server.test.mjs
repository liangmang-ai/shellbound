import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createCoopServer, cleanInput, PROTOCOL_VERSION } from '../server/server.mjs';

const TIMEOUT = 3000;
const waiting = (description, subscribe) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), TIMEOUT);
  subscribe(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

class Peer {
  constructor(url, options = {}) {
    this.socket = new WebSocket(url, options);
    this.messages = [];
    this.waiters = [];
    this.closed = null;
    this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      const index = this.waiters.findIndex(waiter => waiter.match(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else this.messages.push(message);
    });
    this.socket.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; });
  }
  send(message) { this.socket.send(JSON.stringify(message)); }
  next(match) {
    if (typeof match === 'string') { const type = match; match = message => message.type === type; }
    const index = this.messages.findIndex(match);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeListener('close', fail);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };
      const waiter = { match, resolve: message => { cleanup(); resolve(message); } };
      this.waiters.push(waiter);
      const fail = () => { cleanup(); reject(new Error('WebSocket closed while awaiting message')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out: WebSocket message')); }, TIMEOUT);
      this.socket.once('close', fail);
    });
  }
  closeResult() {
    if (this.closed) return Promise.resolve(this.closed);
    return waiting('WebSocket close', resolve => this.socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }
  async barrier() { this.send({ type: 'ping' }); await this.next('pong'); }
}

async function setup(t, options = {}) {
  const app = createCoopServer({ local: true, ...options });
  const { port } = await app.listen(0);
  const url = `ws://127.0.0.1:${port}/ws`;
  t.after(() => app.close());
  const connect = async (peerOptions = {}) => {
    const peer = new Peer(url, peerOptions);
    await peer.next('hello');
    t.after(() => { if (peer.socket.readyState !== WebSocket.CLOSED) peer.socket.terminate(); });
    return peer;
  };
  return { app, port, url, connect };
}

async function roomPair(t, options, clientOptions = {}) {
  const context = await setup(t, options);
  const host = await context.connect(), guest = await context.connect();
  host.send({ type: 'create', mapId: 'greenhouse', difficultyId: 'easy', ...clientOptions.host });
  const created = await host.next('room');
  guest.send({ type: 'join', code: created.code, ...clientOptions.guest });
  await guest.next('room');
  await host.next(message => message.type === 'room' && message.players.length === 2);
  return { ...context, host, guest, code: created.code, room: context.app.rooms.get(created.code) };
}

async function startedPair(t, options) {
  const context = await roomPair(t, options);
  context.host.send({ type: 'start' });
  await Promise.all([context.host.next('snapshot'), context.guest.next('snapshot')]);
  for (const peer of [context.host, context.guest]) peer.messages = peer.messages.filter(message => message.type !== 'room');
  // Freeze automatic ticks while test cases apply controlled synchronous steps.
  context.room.paused = true;
  context.room.game.spawnQueue = ['grunt'];
  context.room.game.spawnTimer = 9999;
  return context;
}

test('room display profiles are bounded, optional and never expose gateway identity or session fields', async t => {
  let time = 10000;
  const profile = { nickName: '蛋友🥚', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/avatar/132', openId: 'private-openid', sessionKey: 'private-session' };
  const { host, guest, room } = await roomPair(t, { now: () => time }, { host: { profile } });
  guest.send({ type: 'profile', profile: { nickName: '队友', avatarUrl: 'https://attacker.test/private.png' } });
  const joined = await host.next(message => message.type === 'room' && message.players[1]?.profile?.nickName === '队友');
  assert.match(joined.runId, /^[a-f0-9]{24}$/, 'a shared opaque run marker distinguishes reused room codes');
  assert.equal(joined.runId, room.runId);
  const guestRoom = await guest.next(message => message.type === 'room' && message.players[1]?.profile?.nickName === '队友');
  assert.equal(guestRoom.runId, joined.runId, 'both teammates submit the same run marker');
  assert.deepEqual(joined.players[0].profile, { nickName: '蛋友🥚', avatarUrl: profile.avatarUrl });
  assert.deepEqual(joined.players[1].profile, { nickName: '队友', avatarUrl: '' });
  assert.equal(JSON.stringify(joined).includes('private-'), false);
  assert.deepEqual(Object.keys(joined.players[0]).sort(), ['connected', 'id', 'profile']);
  guest.send({ type: 'profile', profile: { nickName: '过快更改' } });
  assert.match((await guest.next('error')).message, /太快/);
  assert.equal([...room.members.values()][1].profile.nickName, '队友');
  guest.send({ type: 'profile', profile: null });
  const cleared = await host.next(message => message.type === 'room' && message.players[1]?.profile === null);
  assert.equal(cleared.players[1].profile, null, 'clearing consent is allowed immediately');
  time += 2001;
  guest.send({ type: 'profile', profile: { nickName: '新队友' } });
  const updated = await host.next(message => message.type === 'room' && message.players[1]?.profile?.nickName === '新队友');
  assert.equal(updated.players[0].profile.nickName, '蛋友🥚', 'a participant only edits their own display data');
});

test('server health is bounded JSON and unknown HTTP routes and upgrade paths are rejected', async t => {
  const { port, connect } = await setup(t);
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'shellbound-coop', protocol: PROTOCOL_VERSION, rooms: 0 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const head = await fetch(`http://127.0.0.1:${port}/healthz`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const missing = await fetch(`http://127.0.0.1:${port}/missing`);
  assert.equal(missing.status, 404);
  const peer = await connect({ origin: 'http://localhost:5173' });
  peer.send({ type: 'ping' });
  assert.equal((await peer.next('pong')).type, 'pong');
});

test('production refuses to start without explicit gateway trust and validates capacity', () => {
  assert.throws(() => createCoopServer({ local: false, trustWechatHeaders: false }), /TRUST_WECHAT_HEADERS/);
  for (const maxRooms of [0, 101, NaN, 1.5]) {
    assert.throws(() => createCoopServer({ local: true, maxRooms }), /ROOMS_MAX/);
  }
});

async function rejectedHandshake(url, options) {
  return waiting('rejected handshake', (resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.on('error', () => {});
    socket.on('open', () => { socket.terminate(); reject(new Error('Unauthorized handshake accepted')); });
    socket.once('unexpected-response', (request, response) => {
      response.resume(); request.destroy();
      resolve(response.statusCode);
    });
  });
}

test('local mode rejects external origins, malformed origins, and unsupported WebSocket paths', async t => {
  const { url, port } = await setup(t);
  assert.equal(await rejectedHandshake(url, { origin: 'https://evil.example' }), 403);
  assert.equal(await rejectedHandshake(url, { origin: 'not a URL' }), 403);
  assert.equal(await rejectedHandshake(`ws://127.0.0.1:${port}/unknown`, {}), 404);
});

test('production gateway mode rejects missing or wrong identities and duplicate connected OpenIDs', async t => {
  const { url, connect } = await setup(t, { local: false, trustWechatHeaders: true });
  assert.equal(await rejectedHandshake(url, {}), 401);
  assert.equal(await rejectedHandshake(url, { headers: { 'x-wx-appid': 'wrong', 'x-wx-source': 'test', 'x-wx-openid': 'test-openid-1234' } }), 401);
  const headers = { 'x-wx-appid': 'wx1a1efb651d164fae', 'x-wx-source': 'test', 'x-wx-openid': 'test-openid-1234' };
  await connect({ headers });
  assert.equal(await rejectedHandshake(url, { headers }), 409);
});

test('room creation validates map/difficulty, room codes, membership, and full capacity', async t => {
  const { app, connect } = await setup(t, { maxRooms: 1 });
  const host = await connect();
  host.send({ type: 'create', mapId: 'courtyard', difficultyId: 'easy' });
  assert.match((await host.next('error')).message, /地图/);
  host.send({ type: 'create', mapId: 'greenhouse', difficultyId: '__proto__' });
  assert.match((await host.next('error')).message, /地图/);
  assert.equal(app.rooms.size, 0);
  host.send({ type: 'create', mapId: 'candyloop', difficultyId: 'hard' });
  const created = await host.next('room');
  assert.match(created.code, /^\d{6}$/);
  assert.equal(created.playerId, 'p1');
  assert.equal(created.mapId, 'candyloop');
  assert.equal(created.difficultyId, 'hard');
  const guest = await connect(), third = await connect();
  third.send({ type: 'create', mapId: 'greenhouse', difficultyId: 'easy' });
  assert.match((await third.next('error')).message, /房间已满/);
  guest.send({ type: 'join', code: '123' });
  assert.match((await guest.next('error')).message, /6 位/);
  guest.send({ type: 'join', code: created.code });
  const joined = await guest.next('room');
  assert.equal(joined.playerId, 'p2');
  assert.equal(joined.players.length, 2);
  third.send({ type: 'join', code: created.code });
  assert.match((await third.next('error')).message, /人数已满/);
  guest.send({ type: 'create', mapId: 'greenhouse', difficultyId: 'easy' });
  assert.match((await guest.next('error')).message, /已经在房间/);
});

test('malformed map and difficulty JSON values are rejected without crashing or poisoning the connection', async t => {
  const { app, port, connect } = await setup(t);
  const values = [{ toString: null, valueOf: null }, {}, [], null, 123, true];
  for (const field of ['difficultyId', 'mapId']) {
    for (const value of values) {
      const peer = await connect();
      const label = `${field}: ${JSON.stringify(value)}`;
      peer.send({ type: 'create', mapId: 'greenhouse', difficultyId: 'easy', [field]: value });
      assert.match((await peer.next('error')).message, /地图和难度/, label);
      assert.equal(peer.socket.readyState, WebSocket.OPEN, `${label}: invalid input keeps the socket usable`);
      assert.equal(app.rooms.size, 0, `${label}: rejection creates no room`);
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      assert.equal(health.status, 200, `${label}: the HTTP service remains alive`);
      assert.equal((await health.json()).ok, true, label);
      peer.send({ type: 'create', mapId: 'greenhouse', difficultyId: 'easy' });
      const room = await peer.next('room');
      assert.match(room.code, /^\d{6}$/, `${label}: the same socket can create a valid room`);
      peer.send({ type: 'leave' });
      await peer.next('ended');
      await peer.closeResult();
      assert.equal(app.rooms.size, 0);
    }
  }
});

test('only a host with two participants starts and both clients receive one world with local HUD views', async t => {
  const { app, host, guest, room } = await roomPair(t);
  guest.send({ type: 'start' });
  assert.match((await guest.next('error')).message, /房主/);
  assert.equal(room.game, null);
  host.send({ type: 'start' });
  const [first, second] = await Promise.all([host.next('snapshot'), guest.next('snapshot')]);
  assert.equal(first.view.player.id, 'p1');
  assert.equal(second.view.player.id, 'p2');
  assert.equal(first.tick, second.tick);
  assert.deepEqual(first.view.enemies, second.view.enemies);
  assert.deepEqual(first.view.players, second.view.players);
  assert.equal(first.view.wave, second.view.wave);
  assert.equal(app.rooms.size, 1);
  assert.ok(room.game);
  host.send({ type: 'start' });
  assert.match((await host.next('error')).message, /需要两名/);
});

test('solo host cannot start and a nonexistent room does not create server state', async t => {
  const { app, connect } = await setup(t);
  const host = await connect();
  host.send({ type: 'join', code: '000000' });
  assert.match((await host.next('error')).message, /不存在/);
  assert.equal(app.rooms.size, 0);
  host.send({ type: 'create', mapId: 'greenhouse', difficultyId: 'easy' });
  const created = await host.next('room');
  host.send({ type: 'start' });
  assert.match((await host.next('error')).message, /两名/);
  assert.equal(app.rooms.get(created.code).game, null);
});

test('compact snapshots are negotiated independently while legacy clients retain full frames', async t => {
  const { host, guest, room } = await roomPair(t, undefined, { host: { compactSnapshots: true }, guest: { compactSnapshots: 'true' } });
  host.send({ type: 'start' });
  const [first, legacy] = await Promise.all([host.next('snapshot'), guest.next('snapshot')]);
  room.paused = true;
  assert.equal(first.view.compact, true);
  assert.equal(first.view.playerId, 'p1');
  assert.equal(first.view.map.id, 'greenhouse');
  assert.equal(first.view.difficulty.id, 'easy');
  assert.equal('player' in first.view, false);
  assert.equal('environment' in first.view, false);
  assert.equal('compact' in legacy.view, false);
  assert.equal(legacy.view.player.id, 'p2');
  assert.equal(legacy.view.player.weapons.pistol.reserve, null);
  assert.deepEqual(legacy.view.players, first.view.players);
  assert.deepEqual(legacy.view.environment.barrels, legacy.view.barrels);
  const [next, legacyNext] = await Promise.all([
    host.next(message => message.type === 'snapshot' && message.tick > first.tick),
    guest.next(message => message.type === 'snapshot' && message.tick > legacy.tick),
  ]);
  assert.equal('map' in next.view, false);
  assert.equal('difficulty' in next.view, false);
  assert.equal(next.view.mapId, 'greenhouse');
  assert.equal(next.view.difficultyId, 'easy');
  assert.equal(legacyNext.view.map.id, 'greenhouse');
  assert.equal(legacyNext.view.difficulty.id, 'easy');
  assert.equal(legacyNext.view.player.id, 'p2');
  assert.ok(Buffer.byteLength(JSON.stringify(next.view)) < Buffer.byteLength(JSON.stringify(legacyNext.view)) * .7);
});

test('both compact clients retain independent death, revival, pause, events, and refreshed metadata', async t => {
  const { host, guest, room } = await roomPair(t, undefined, { host: { compactSnapshots: true }, guest: { compactSnapshots: true } });
  host.send({ type: 'start' });
  const [first, second] = await Promise.all([host.next('snapshot'), guest.next('snapshot')]);
  room.paused = true;
  assert.equal(first.view.playerId, 'p1');
  assert.equal(second.view.playerId, 'p2');
  assert.equal(first.view.map.id, 'greenhouse');
  assert.equal(second.view.map.id, 'greenhouse');
  room.game.players.p1.shield = 7;
  room.game.players.p2.hp = 0;
  room.game.players.p2.revivesRemaining = 1;
  const [alive, dead] = await Promise.all([
    host.next(message => message.type === 'snapshot' && message.tick > first.tick && message.view.players[1].hp === 0),
    guest.next(message => message.type === 'snapshot' && message.tick > second.tick && message.view.players[1].hp === 0),
  ]);
  assert.deepEqual(alive.view.players, dead.view.players);
  assert.equal(alive.view.players[0].shield, 7);
  assert.equal(alive.view.status, 'playing');
  assert.equal(dead.view.status, 'dead');
  assert.equal(dead.view.teamStatus, 'playing');
  assert.equal(dead.view.revivesRemaining, 1);
  assert.equal(room.game.revive('p2'), true);
  room.events.push(...room.game.events); room.game.events = [];
  room.pauseOwners.add('p2'); room.pauseOwnerId = 'p2';
  // A changed metadata object is resent, even when its identifier stays the same.
  room.game.map = { ...room.game.map, name: 'Updated map' };
  const [revivedHost, revivedGuest] = await Promise.all([
    host.next(message => message.type === 'snapshot' && message.tick > alive.tick && message.view.players[1].hp > 0),
    guest.next(message => message.type === 'snapshot' && message.tick > dead.tick && message.view.players[1].hp > 0),
  ]);
  for (const frame of [revivedHost, revivedGuest]) {
    assert.equal(frame.paused, true);
    assert.deepEqual(frame.pauseOwnerIds, ['p2']);
    assert.equal(frame.pauseOwnerId, 'p2');
    assert.equal(frame.view.map.name, 'Updated map');
    assert.equal(frame.view.difficulty.id, 'easy');
    assert.equal(frame.view.status, 'playing');
    assert.deepEqual(frame.view.events.filter(event => event.type === 'revive').map(event => event.playerId), ['p2']);
  }
  assert.equal(revivedHost.view.revivesRemaining, 3);
  assert.equal(revivedGuest.view.revivesRemaining, 0);
});

test('input sequence validation applies independent motion and stale packets cannot reverse newer inputs', async t => {
  let clock = 1000;
  const { app, host, guest, room } = await startedPair(t, { now: () => clock });
  const first = room.game.players.p1, second = room.game.players.p2;
  const initial = { firstX: first.x, secondY: second.y, time: room.game.time };
  room.paused = false;
  host.send({ type: 'input', seq: 2, input: { moveX: 1, shoot: true, aimX: 1200, aimY: first.y } });
  host.send({ type: 'input', seq: 1, input: { moveX: -1 } });
  guest.send({ type: 'input', seq: 1, input: { moveY: 1 } });
  await Promise.all([host.barrier(), guest.barrier()]);
  room.paused = true;
  const current = { firstX: first.x, secondY: second.y, time: room.game.time };
  room.paused = false; app.step(); room.paused = true;
  assert.ok(first.x > current.firstX);
  assert.ok(second.y > current.secondY);
  assert.ok(Math.abs(room.game.time - current.time - 1 / 30) < 1e-7);
  assert.ok(first.x > initial.firstX);
  assert.ok(second.y > initial.secondY);
  assert.ok(first.weapons.pistol.clip < 12);
  assert.equal(second.weapons.pistol.clip, 12);
  clock += 301;
  const stopped = { x: first.x, y: second.y };
  room.paused = false; app.step(); room.paused = true;
  assert.equal(first.x, stopped.x);
  assert.equal(second.y, stopped.y);
});

test('queued actions spend one resource each, preserve local ownership, and do not repeat on later ticks', async t => {
  const { app, host, guest, room } = await startedPair(t);
  const first = room.game.players.p1, second = room.game.players.p2;
  second.boostCharges = 3;
  second.weapons.smg = room.game.makeAmmo('smg');
  room.paused = false;
  guest.send({ type: 'action', action: 'boost' });
  guest.send({ type: 'action', action: 'boost' });
  guest.send({ type: 'action', action: 'grenade', target: { x: 1000, y: 600 } });
  guest.send({ type: 'action', action: 'weapon', weaponId: 'smg' });
  await guest.barrier();
  room.paused = false; app.step(); room.paused = true;
  assert.equal(second.boostCharges, 1);
  assert.ok(second.boostRemaining > 15);
  assert.equal(first.boostCharges, 1);
  assert.equal(second.grenades, 2);
  assert.equal(first.grenades, 3);
  assert.equal(second.currentWeapon, 'smg');
  assert.equal(room.game.grenades[0].playerId, 'p2');
  room.paused = false; app.step(); room.paused = true;
  assert.equal(second.boostCharges, 1);
  assert.equal(second.grenades, 2);
  second.hp = 0;
  room.paused = false;
  guest.send({ type: 'action', action: 'revive' });
  await guest.barrier();
  app.step(); room.paused = true;
  assert.equal(second.hp, 100);
  assert.equal(second.revivesRemaining, 2);
  assert.equal(first.revivesRemaining, 3);
  room.paused = false;
  host.send({ type: 'action', action: 'weapon', weaponId: 'toString' });
  assert.match((await host.next('error')).message, /武器/);
  room.paused = true;
});

test('the real broadcast timer publishes identical shared state and routes local boost events only to their owner', async t => {
  const { app, host, guest, room } = await startedPair(t);
  room.paused = false;
  guest.send({ type: 'action', action: 'boost' });
  await guest.barrier();
  app.step(); room.paused = true;
  const tick = room.tick;
  const [first, second] = await Promise.all([
    host.next(message => message.type === 'snapshot' && message.tick >= tick),
    guest.next(message => message.type === 'snapshot' && message.tick >= tick),
  ]);
  assert.equal(first.tick, second.tick);
  assert.deepEqual(first.view.players, second.view.players);
  assert.deepEqual(first.view.enemies, second.view.enemies);
  assert.equal(first.view.player.id, 'p1');
  assert.equal(second.view.player.id, 'p2');
  assert.equal(first.view.player.boostCharges, 1);
  assert.equal(second.view.player.boostCharges, 0);
  assert.equal(first.view.events.some(event => event.type === 'boostActivation'), false);
  assert.equal(second.view.events.some(event => event.type === 'boostActivation' && event.playerId === 'p2'), true);
});

test('pause freezes shared simulation and only its initiator can resume the room', async t => {
  const { app, host, guest, room } = await startedPair(t);
  room.paused = false;
  guest.send({ type: 'pause', paused: true });
  const paused = await guest.next(message => message.type === 'room' && message.paused);
  assert.equal(paused.pauseOwnerId, 'p2');
  const time = room.game.time;
  app.step(); app.step();
  assert.equal(room.game.time, time);
  host.send({ type: 'pause', paused: false });
  assert.match((await host.next('error')).message, /发起暂停/);
  assert.equal(room.paused, true);
  guest.send({ type: 'pause', paused: false });
  await guest.next(message => message.type === 'room' && !message.paused);
  assert.equal(room.paused, false);
  assert.equal(room.pauseOwnerId, null);
  app.step();
  assert.ok(room.game.time > time);
});

test('simultaneous pause requests require both players to resume and outsiders cannot release a pause', async t => {
  const { app, host, guest, room, connect } = await startedPair(t);
  const outsider = await connect();
  room.paused = false;
  host.send({ type: 'pause', paused: true });
  guest.send({ type: 'pause', paused: true });
  const [first, second] = await Promise.all([
    host.next(message => message.type === 'room' && message.pauseOwnerIds?.length === 2),
    guest.next(message => message.type === 'room' && message.pauseOwnerIds?.length === 2),
  ]);
  assert.equal(room.paused, true);
  assert.deepEqual([...room.pauseOwners].sort(), ['p1', 'p2']);
  assert.deepEqual([...first.pauseOwnerIds].sort(), ['p1', 'p2']);
  assert.deepEqual(first.pauseOwnerIds, second.pauseOwnerIds);
  assert.equal(first.pauseOwnerId, first.pauseOwnerIds[0], 'legacy owner is the first active requester');
  const time = room.game.time;
  app.step();
  assert.equal(room.game.time, time);

  host.send({ type: 'pause', paused: false });
  const partlyResumed = await host.next(message => message.type === 'room'
    && message.paused && message.pauseOwnerIds?.length === 1 && message.pauseOwnerIds[0] === 'p2');
  assert.equal(partlyResumed.pauseOwnerId, 'p2');
  assert.equal(room.paused, true);
  assert.deepEqual([...room.pauseOwners], ['p2']);
  app.step();
  assert.equal(room.game.time, time, 'one participant resuming cannot advance the other participant backgrounded game');

  host.send({ type: 'pause', paused: false });
  assert.match((await host.next('error')).message, /发起暂停/);
  outsider.send({ type: 'pause', paused: false });
  assert.match((await outsider.next('error')).message, /创建或加入/);
  assert.equal(room.paused, true);
  assert.deepEqual([...room.pauseOwners], ['p2']);

  guest.send({ type: 'pause', paused: false });
  const resumed = await guest.next(message => message.type === 'room'
    && !message.paused && message.pauseOwnerIds?.length === 0);
  assert.equal(resumed.pauseOwnerId, null);
  assert.equal(room.paused, false);
  assert.equal(room.pauseOwners.size, 0);
  app.step();
  assert.ok(room.game.time > time, 'the shared world resumes after all requesters have confirmed');
});

test('a leave request ends both clients and releases the only room capacity', async t => {
  const { app, host, guest } = await startedPair(t, { maxRooms: 1 });
  guest.send({ type: 'leave' });
  const [first, second] = await Promise.all([host.next('ended'), guest.next('ended')]);
  assert.match(first.message, /离开/);
  assert.equal(first.message, second.message);
  await Promise.all([host.closeResult(), guest.closeResult()]);
  assert.equal(app.rooms.size, 0);
});

test('unexpected disconnection notifies the partner and removes stale room membership', async t => {
  const { app, host, guest } = await roomPair(t);
  guest.socket.terminate();
  assert.match((await host.next('ended')).message, /断开/);
  await host.closeResult();
  assert.equal(app.rooms.size, 0);
});

test('invalid JSON, binary frames, and oversized messages close clients with bounded protocol errors', async t => {
  const { app, connect } = await setup(t);
  const invalid = await connect();
  invalid.socket.send('{invalid JSON');
  assert.equal((await invalid.closeResult()).code, 1007);
  const binary = await connect();
  binary.socket.send(Buffer.from('{}'));
  assert.equal((await binary.closeResult()).code, 1003);
  const oversized = await connect();
  oversized.socket.send(JSON.stringify({ type: 'ping', data: 'x'.repeat(5000) }));
  assert.equal((await oversized.closeResult()).code, 1009);
  assert.equal(app.rooms.size, 0);
});

test('malformed input and grenade targets are rejected without corrupting the authoritative player', async t => {
  const { host, room } = await startedPair(t);
  host.send({ type: 'input', seq: 1, input: { moveX: 'fast' } });
  assert.match((await host.next('error')).message, /操作数据/);
  room.paused = false;
  host.send({ type: 'action', action: 'grenade', target: { x: 1e20, y: 0 } });
  assert.match((await host.next('error')).message, /手雷目标/);
  assert.equal(room.game.players.p1.grenades, 3);
  assert.deepEqual(cleanInput({ moveX: 10, moveY: -8, shoot: true }), { moveX: 1, moveY: -1, shoot: true });
  assert.equal(cleanInput({ moveX: Infinity }), null);
  assert.equal(cleanInput({ aimX: NaN }), null);
  assert.equal(cleanInput([]), null);
});
