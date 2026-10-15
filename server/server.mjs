import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { MAPS, DIFFICULTIES, WEAPON_ORDER } from '../src/game.js';
import { CoopGame } from '../src/coop-game.js';

export const PROTOCOL_VERSION = 1;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FINISHED = new Set(['dead', 'won']);
const MAX_PENDING = 12;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const send = (socket, data) => {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(data, (_key, value) => value instanceof Set ? [...value] : value));
  return true;
};

export function cleanInput(value) {
  if (!plain(value)) return null;
  const out = {};
  for (const key of ['moveX', 'moveY']) {
    if (value[key] !== undefined && !finite(value[key])) return null;
    out[key] = Math.max(-1, Math.min(1, value[key] || 0));
  }
  for (const key of ['aimX', 'aimY']) {
    if (value[key] !== undefined && (!finite(value[key]) || Math.abs(value[key]) > 10000)) return null;
    if (value[key] !== undefined) out[key] = value[key];
  }
  out.shoot = value.shoot === true;
  return out;
}

// Production trusts WeChat-injected headers ONLY behind the native cloud gateway.
// The deployment must disable public network access; a public HTTP client can forge headers.
export function createCoopServer(options = {}) {
  const local = options.local ?? process.env.DEV_MODE === '1';
  const trustWechatHeaders = options.trustWechatHeaders ?? process.env.TRUST_WECHAT_HEADERS === '1';
  const appId = options.appId || process.env.WECHAT_APP_ID || 'wx1a1efb651d164fae';
  const maxRooms = options.maxRooms ?? Number(process.env.ROOMS_MAX || 20);
  if (!local && !trustWechatHeaders) throw new Error('生产服务须关闭公网访问，并设置 TRUST_WECHAT_HEADERS=1。');
  if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 100) throw new Error('ROOMS_MAX 必须为 1–100。');
  const now = options.now || Date.now;
  const rooms = new Map(), sessions = new Set(), identities = new Map();
  const roomAttempts = new Map();
  let shuttingDown = false;

  const server = createServer((request, response) => {
    if ((request.method === 'GET' || request.method === 'HEAD') && request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? '' : JSON.stringify({ ok: true, service: 'shellbound-coop', protocol: PROTOCOL_VERSION, rooms: rooms.size }));
    } else {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });

  function roomInfo(room, member) {
    return { type: 'room', protocol: PROTOCOL_VERSION, code: room.code, playerId: member.id,
      players: [...room.members.values()].map(m => ({ id: m.id, connected: m.socket.readyState === WebSocket.OPEN })),
      hostId: 'p1', phase: room.paused ? 'paused' : room.game ? room.game.status : 'waiting',
      paused: room.paused, pauseOwnerId: room.pauseOwnerId, pauseOwnerIds: [...room.pauseOwners], mapId: room.mapId, difficultyId: room.difficultyId };
  }
  function announce(room) { for (const member of room.members.values()) send(member.socket, roomInfo(room, member)); }
  function endRoom(room, message) {
    if (!rooms.delete(room.code)) return;
    for (const member of room.members.values()) {
      member.room = null;
      send(member.socket, { type: 'ended', message });
      member.socket.close(1000, 'Room ended');
    }
    room.members.clear(); room.game = null;
  }
  function reject(member, message) { send(member.socket, { type: 'error', message }); }
  function rejectUpgrade(socket, status) {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  server.on('upgrade', (request, socket, head) => {
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; } catch { return rejectUpgrade(socket, '400 Bad Request'); }
    if (path !== '/ws' || shuttingDown) return rejectUpgrade(socket, '404 Not Found');
    if (sessions.size >= maxRooms * 2 + 10) return rejectUpgrade(socket, '503 Service Unavailable');
    let identity;
    if (local) {
      if (!LOOPBACK.has(request.socket.remoteAddress)) return rejectUpgrade(socket, '403 Forbidden');
      const origin = request.headers.origin;
      if (origin) {
        try { if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) return rejectUpgrade(socket, '403 Forbidden'); }
        catch { return rejectUpgrade(socket, '403 Forbidden'); }
      }
      identity = `local-${randomInt(0, 0x7fffffff)}`;
    } else {
      const openId = request.headers['x-wx-openid'];
      if (request.headers['x-wx-appid'] !== appId || !request.headers['x-wx-source']
        || typeof openId !== 'string' || !/^[\w-]{10,128}$/.test(openId)) return rejectUpgrade(socket, '401 Unauthorized');
      identity = openId;
      if (identities.has(identity)) return rejectUpgrade(socket, '409 Conflict');
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, identity));
  });

  function allowRoomAttempt(member) {
    // Local tabs intentionally have separate identities; production is limited per OpenID.
    const time = now(), attempts = roomAttempts.get(member.identity) || { since: time, count: 0 };
    if (time - attempts.since >= 60000) { attempts.since = time; attempts.count = 0; }
    attempts.count++; roomAttempts.set(member.identity, attempts);
    if (attempts.count > 12) { reject(member, '操作太快，请稍后再试'); return false; }
    return true;
  }
  function handle(member, message) {
    if (!plain(message) || typeof message.type !== 'string') return reject(member, '请求格式不正确');
    const room = member.room;
    if (message.type === 'ping') return send(member.socket, { type: 'pong' });
    if (message.type === 'create' || message.type === 'join') {
      if (room) return reject(member, '已经在房间中');
      if (!allowRoomAttempt(member)) return;
      if (message.type === 'create') {
        if (rooms.size >= maxRooms) return reject(member, '房间已满，请稍后再试');
        if (typeof message.mapId !== 'string' || !MAPS.some(map => map.id === message.mapId)
          || typeof message.difficultyId !== 'string' || !Object.hasOwn(DIFFICULTIES, message.difficultyId)) return reject(member, '请选择有效地图和难度');
        let code;
        do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
        const created = { code, mapId: message.mapId, difficultyId: message.difficultyId,
          members: new Map(), game: null, createdAt: now(), paused: false, pauseOwners: new Set(), pauseOwnerId: null, pausedAt: null, tick: 0, snapshotSeq: 0, events: [] };
        member.id = 'p1'; member.room = created; member.compactSnapshots = message.compactSnapshots === true;
        created.members.set('p1', member); rooms.set(code, created); announce(created);
      } else {
        if (typeof message.code !== 'string' || !/^\d{6}$/.test(message.code)) return reject(member, '请输入 6 位房间码');
        const target = rooms.get(message.code);
        if (!target) return reject(member, '房间不存在或已结束');
        if (target.game || target.members.size >= 2) return reject(member, '房间已开始或人数已满');
        member.id = 'p2'; member.room = target; member.compactSnapshots = message.compactSnapshots === true;
        target.members.set('p2', member); announce(target);
      }
      return;
    }
    if (!room || !rooms.has(room.code)) return reject(member, '请先创建或加入房间');
    if (message.type === 'leave') return endRoom(room, member.id === 'p1' ? '房主已离开，房间已结束' : '队友已离开，房间已结束');
    if (message.type === 'start') {
      if (member.id !== 'p1') return reject(member, '请等待房主开始');
      if (room.game || room.members.size !== 2) return reject(member, '需要两名玩家到齐');
      room.game = new CoopGame({ seed: randomInt(1, 0x7fffffff), mapId: room.mapId, difficultyId: room.difficultyId });
      room.events.push(...room.game.events); room.game.events = [];
      for (const m of room.members.values()) { m.input = {}; m.actions = []; m.lastInputAt = now(); }
      announce(room); broadcast(room); return;
    }
    if (!room.game) return reject(member, '请等待房主开始');
    if (message.type === 'pause') {
      if (typeof message.paused !== 'boolean') return reject(member, '暂停参数不正确');
      if (message.paused) {
        if (!room.paused) room.pausedAt = now();
        room.pauseOwners.add(member.id);
      } else if (room.paused) {
        if (!room.pauseOwners.delete(member.id)) return reject(member, '请等待发起暂停的队友继续');
      }
      room.paused = room.pauseOwners.size > 0;
      room.pauseOwnerId = room.pauseOwners.values().next().value || null;
      if (!room.paused) room.pausedAt = null;
      for (const m of room.members.values()) { m.input = {}; m.actions = []; }
      announce(room); broadcast(room); return;
    }
    if (message.type === 'input') {
      if (!Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq <= member.seq) return;
      const input = cleanInput(message.input);
      if (!input) return reject(member, '操作数据不正确');
      member.seq = message.seq;
      if (!room.paused) { member.input = input; member.lastInputAt = now(); }
      return;
    }
    if (message.type === 'action') {
      if (room.paused) return;
      if (!['boost', 'revive', 'grenade', 'weapon'].includes(message.action)) return reject(member, '不支持的操作');
      const action = { action: message.action };
      if (message.action === 'weapon') {
        if (!WEAPON_ORDER.includes(message.weaponId)) return reject(member, '武器参数不正确');
        action.weaponId = message.weaponId;
      }
      if (message.action === 'grenade' && message.target !== undefined) {
        if (!plain(message.target) || !finite(message.target.x) || !finite(message.target.y)
          || Math.abs(message.target.x) > 10000 || Math.abs(message.target.y) > 10000) return reject(member, '手雷目标不正确');
        action.target = { x: message.target.x, y: message.target.y };
      }
      if (member.actions.length < MAX_PENDING) member.actions.push(action);
      return;
    }
    reject(member, '不支持的请求');
  }

  wss.on('connection', (socket, identity) => {
    const member = { socket, identity, room: null, id: null, input: {}, actions: [], seq: -1,
      compactSnapshots: false, snapshotMap: null, snapshotDifficulty: null,
      lastInputAt: now(), lastSeenAt: now(), connectedAt: now(), rateAt: now(), tokens: 120, alive: true };
    sessions.add(member); identities.set(identity, member);
    socket.on('pong', () => { member.alive = true; });
    socket.on('message', (raw, binary) => {
      member.lastSeenAt = now();
      member.tokens = Math.min(120, member.tokens + Math.max(0, now() - member.rateAt) / 1000 * 80); member.rateAt = now();
      if (--member.tokens < 0) return socket.close(1008, 'Rate limited');
      if (binary) return socket.close(1003, 'JSON required');
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return socket.close(1007, 'Invalid JSON'); }
      handle(member, message);
    });
    socket.on('error', () => { /* close removes the room; do not log request headers or credentials. */ });
    socket.on('close', () => {
      sessions.delete(member);
      if (identities.get(identity) === member) identities.delete(identity);
      if (member.room) endRoom(member.room, '连接已断开，房间已结束，请重新创建房间');
    });
    send(socket, { type: 'hello', protocol: PROTOCOL_VERSION });
  });

  function collect(room) {
    if (!room.game?.events) return;
    room.events.push(...room.game.events);
    if (room.events.length > 512) room.events = room.events.slice(-512);
    room.game.events = [];
  }
  function broadcast(room) {
    if (!room.game) return;
    const tick = ++room.snapshotSeq;
    for (const member of room.members.values()) {
      if (member.socket.bufferedAmount > 512 * 1024) { endRoom(room, '网络较慢，房间已结束，请检查网络后重试'); return; }
      // Static metadata is sent once per opt-in member, then reused by its client.
      // Legacy clients retain the complete view on every frame. Both paths encode
      // live projections synchronously once, without a stringify/parse clone.
      const includeMetadata = member.snapshotMap !== room.game.map || member.snapshotDifficulty !== room.game.difficulty;
      const view = room.game.networkSnapshot(member.id, { compact: member.compactSnapshots, includeMetadata });
      view.events = room.events.filter(event => !event.playerId || event.playerId === member.id || ['shot', 'grenade', 'revive'].includes(event.type));
      if (send(member.socket, { type: 'snapshot', tick, paused: room.paused, pauseOwnerId: room.pauseOwnerId, pauseOwnerIds: [...room.pauseOwners], view })) {
        member.snapshotMap = room.game.map; member.snapshotDifficulty = room.game.difficulty;
      }
    }
    room.events = [];
  }
  function step() {
    for (const room of rooms.values()) {
      if (!room.game || room.paused) continue;
      const inputs = {};
      for (const member of room.members.values()) {
        for (const action of member.actions.splice(0)) { room.game.performAction(member.id, action.action, action); collect(room); }
        inputs[member.id] = now() - member.lastInputAt <= 300 ? member.input : {};
      }
      if (!FINISHED.has(room.game.status)) room.game.update(1 / 30, inputs);
      collect(room); room.tick++;
    }
  }
  const simulation = setInterval(step, 1000 / 30);
  const snapshots = setInterval(() => { for (const room of rooms.values()) broadcast(room); }, 50);
  const cleanup = setInterval(() => {
    const time = now();
    for (const member of sessions) {
      if ((!member.room && time - member.connectedAt > 15000) || !member.alive) member.socket.terminate();
      else { member.alive = false; member.socket.ping(); }
    }
    for (const room of rooms.values()) {
      if (!room.game && time - room.createdAt > 5 * 60 * 1000) endRoom(room, '等待超时，请重新创建房间');
      else if (room.pausedAt && time - room.pausedAt > 10 * 60 * 1000) endRoom(room, '暂停超时，请重新创建房间');
    }
    for (const [identity, entry] of roomAttempts) if (time - entry.since > 60000 && !identities.has(identity)) roomAttempts.delete(identity);
  }, 10000);
  for (const timer of [simulation, snapshots, cleanup]) timer.unref();

  return { server, wss, rooms, step,
    async listen(port = Number(process.env.PORT || 8787)) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须为 0–65535 的整数');
      return new Promise((resolveListen, rejectListen) => {
        const fail = error => rejectListen(error);
        server.once('error', fail);
        server.listen(port, local ? '127.0.0.1' : '0.0.0.0', () => { server.removeListener('error', fail); resolveListen(server.address()); });
      });
    },
    async close() {
      shuttingDown = true;
      clearInterval(simulation); clearInterval(snapshots); clearInterval(cleanup);
      for (const room of [...rooms.values()]) endRoom(room, '服务正在重启，请稍后重新创建房间');
      for (const member of sessions) member.socket.terminate();
      await new Promise(resolveClose => wss.close(resolveClose));
      if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createCoopServer({ local: process.argv.includes('--local') || process.env.DEV_MODE === '1' });
  const address = await app.listen();
  console.log(`蛋壳突围联机服务已启动，端口 ${address.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
