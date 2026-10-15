import { Game, MAPS, DIFFICULTIES, WEAPON_ORDER } from './game.js';
import { NETWORK_CONFIG, browserSocketURL } from './network-config.js';
import { NetworkPresentation } from './network-presentation.js';

// The client renders server snapshots. It never advances a local combat world.
export class NetworkGame {
  constructor(client, view, tick = 0) {
    this.client = client;
    this.online = true;
    this.previousInput = {};
    this.events = [];
    this.pendingEvents = [];
    this.lastTick = -1;
    this.inputElapsed = 1;
    this.presentation = new NetworkPresentation(this);
    this.applyView(view, tick);
  }
  applyView(view, tick) {
    if (!view?.player || !view?.map || !Number.isSafeInteger(tick) || tick <= this.lastTick) return false;
    const previous = { paused: this.paused, status: this.status, teamStatus: this.teamStatus, mapId: this.map?.id };
    const fields = ['player', 'players', 'enemies', 'bullets', 'grenades', 'pickups', 'barrels', 'effects', 'wave', 'waveTotal', 'waveKills', 'intermissionRemaining', 'score', 'kills', 'time', 'status', 'teamStatus', 'revivesRemaining', 'paused', 'pauseOwnerId', 'pauseOwnerIds'];
    for (const key of fields) if (Object.prototype.hasOwnProperty.call(view, key)) this[key] = view[key];
    this.map = MAPS.find(map => map.id === view.map.id) || view.map;
    this.difficulty = DIFFICULTIES[view.difficulty?.id] || DIFFICULTIES.easy;
    // JSON has no Infinity representation; only the starter pistol has an
    // unlimited reserve. Other weapons must retain a real finite reserve.
    for (const player of [this.player, ...(this.players || [])]) if (player.weapons?.pistol?.reserve === null) player.weapons.pistol.reserve = Infinity;
    if (this.player.currentWeapon === this.pendingWeaponId) this.pendingWeaponId = null;
    this.pendingEvents.push(...(Array.isArray(view.events) ? view.events : []));
    this.lastTick = tick;
    this.presentation.accept(previous);
    return true;
  }
  getRenderView() { return this.presentation.view; }
  update(dt, input = {}) {
    this.presentation.advance(dt);
    // One-shot actions use reliable ordered WebSocket messages immediately;
    // they must survive frames that fall between the 30 Hz continuous sends.
    if (input.grenade && !this.previousInput.grenade) this.client.action('grenade', { target: input.grenadeTarget });
    if (input.boost && !this.previousInput.boost) this.client.action('boost');
    const slot = typeof input.weaponSlot === 'number' ? WEAPON_ORDER[input.weaponSlot] : input.weaponSlot;
    if (slot && this.player.weapons[slot]) this.equip(slot);
    if (input.weaponNext && !this.previousInput.weaponNext) {
      const owned = WEAPON_ORDER.filter(id => this.player.weapons[id]);
      this.equip(owned[(owned.indexOf(this.pendingWeaponId || this.player.currentWeapon) + 1) % owned.length]);
    }
    this.inputElapsed += dt;
    if (this.inputElapsed >= 1 / 30) {
      this.inputElapsed %= 1 / 30;
      this.client.input({ moveX: input.moveX || 0, moveY: input.moveY || 0, aimX: input.aimX, aimY: input.aimY, shoot: !!input.shoot });
    }
    this.events = this.pendingEvents.splice(0);
    this.previousInput = input;
  }
  equip(weaponId) {
    if (!weaponId || !this.player.weapons[weaponId]) return false;
    this.pendingWeaponId = weaponId;
    return this.client.action('weapon', { weaponId });
  }
  activateBoost() {
    if (this.status !== 'playing' || this.player.boostCharges <= 0) return false;
    return this.client.action('boost');
  }
  revive() {
    if (this.status !== 'dead' || this.revivesRemaining <= 0) return false;
    return this.client.action('revive');
  }
  resolveGrenadeTarget(target) { return Game.prototype.resolveGrenadeTarget.call(this, target); }
  environmentSnapshot() { return Game.prototype.environmentSnapshot.call(this); }
}

export function createMultiplayerClient({ platform = 'web', wxApi = globalThis.wx, WebSocketImpl = globalThis.WebSocket,
  endpoint = browserSocketURL(), timeoutMs = 15000, retryDelayMs = 1200, now = () => globalThis.performance?.now?.() ?? Date.now(),
  onRoom = () => {}, onSnapshot = () => {}, onError = () => {}, onEnd = () => {} } = {}) {
  let socket = null, active = true, opened = false, connected = false, sequence = 0, timer = null;
  let intent = null, heartbeat = null;
  let attempt = 0, retryTimer = null, intentSent = false;
  let snapshotMap = null, snapshotDifficulty = null, snapshotTick = -1;
  let pingSentAt = null, snapshotReceivedAt = null;
  let metrics = { rttMs: null, snapshotIntervalMs: null, snapshotBytes: null, snapshotCount: 0 };
  const clearTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const closeTask = task => {
    try { if (platform === 'wechat') task?.close({ code: 1000, reason: 'leave' }); else task?.close(1000, 'leave'); } catch { /* Already closed. */ }
  };
  // Do not surface arbitrary SDK text: it may contain URLs or identity headers.
  // Preserve documented error codes and known gateway tokens for diagnosis.
  function errorCode(error) {
    if (Number.isInteger(error?.statusCode)) return `HTTP_${error.statusCode}`;
    // SocketTask.onError only guarantees errMsg. Handshake status may be
    // embedded there, even when the SDK also supplies a generic error code.
    const message = String(error?.errMsg || error?.message || '');
    const status = /\b(?:HTTP\/[12](?:\.\d)?|unexpected (?:server )?response(?: code)?|(?:response )?status\s*code)\s*[:=]?\s*([45]\d{2})\b/i.exec(message);
    if (status) return `HTTP_${status[1]}`;
    for (const value of [error?.errCode, error?.code]) {
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      if (typeof value === 'string' && /^(?:-?\d+|[A-Z][A-Z0-9_]{1,40})$/.test(value)) return value;
    }
    return ['SERVICE_NOT_READY', 'SERVICE_FORBIDDEN', 'INTERNAL_REQUEST_FAIL', 'SYS_ERR'].find(code => message.includes(code)) || 'UNKNOWN';
  }
  function connectionProblem(stage, error) {
    if (!active) return;
    const code = errorCode(error);
    // A room intent may have reached the authority even if its reply was lost.
    // Only retry a transient failure before sending create/join, at most once.
    if (platform === 'wechat' && !intentSent && attempt < 2 && stage !== '云初始化' &&
      ['102002', 'SERVICE_NOT_READY', 'TIMEOUT'].includes(code)) {
      clearTimer(); opened = false;
      const task = socket; socket = null; closeTask(task);
      retryTimer = setTimeout(() => { retryTimer = null; void openWeChatAttempt(); }, retryDelayMs);
      return;
    }
    const advice = ['HTTP_409', '409'].includes(code)
      ? '该微信已在其他地方联机；请退出另一端，双人需用不同微信账号'
      : ['-501000', '-601031', '-601034', 'HTTP_401', 'HTTP_403'].includes(code)
      ? '请检查云托管环境与身份权限'
      : code === 'SERVICE_NOT_READY' ? '服务仍在启动，请稍后重试'
        : ['102002', 'TIMEOUT'].includes(code) ? '等待超时，请稍后重试'
          : stage === '连接关闭' ? '本局已结束，请重新创建或加入房间' : '请检查网络后重试';
    const title = stage === '连接关闭' ? '连接已断开' : `${stage}失败`;
    fail(`${title}（${code}），${advice}`, { stage, code, attempts: attempt });
  }
  const armTimeout = stage => {
    clearTimer(); timer = setTimeout(() => connectionProblem(stage, { code: 'TIMEOUT' }), timeoutMs);
  };
  const rawSend = message => {
    if (!active || !opened || !socket) return false;
    const data = JSON.stringify(message);
    try { if (platform === 'wechat') socket.send({ data, fail: error => connectionProblem('消息发送', error) }); else socket.send(data); return true; }
    catch (error) { connectionProblem('消息发送', error); return false; }
  };
  function cleanup() {
    clearTimer(); if (heartbeat !== null) clearInterval(heartbeat); heartbeat = null;
    if (retryTimer !== null) clearTimeout(retryTimer); retryTimer = null;
    pingSentAt = null; snapshotReceivedAt = null;
    metrics = { rttMs: null, snapshotIntervalMs: null, snapshotBytes: null, snapshotCount: 0 };
    opened = false;
    const task = socket; socket = null;
    closeTask(task);
  }
  function fail(message, details) { if (!active) return; active = false; cleanup(); onError(message, details); }
  function receive(event) {
    if (!active) return;
    const raw = typeof event.data === 'string' ? event.data : String(event.data);
    let data; try { data = JSON.parse(raw); } catch { fail('联机服务返回了无法识别的数据'); return; }
    if (data.type === 'room') {
      const room = {};
      for (const key of ['type', 'protocol', 'code', 'playerId', 'hostId', 'phase', 'paused', 'pauseOwnerId', 'pauseOwnerIds', 'mapId', 'difficultyId']) {
        if (Object.prototype.hasOwnProperty.call(data, key)) room[key] = data[key];
      }
      // A server awaiting deployment may still include retired display metadata.
      room.players = Array.isArray(data.players) ? data.players.map(player => ({ id: player?.id, connected: player?.connected === true })) : [];
      connected = true; clearTimer(); onRoom(room);
    }
    else if (data.type === 'snapshot') {
      if (!connected) return;
      if (!Number.isSafeInteger(data.tick) || data.tick <= snapshotTick || !data.view) return;
      const view = { ...data.view };
      if (view.compact === true) {
        const map = view.map || (snapshotMap?.id === view.mapId ? snapshotMap : null);
        const difficulty = view.difficulty || (snapshotDifficulty?.id === view.difficultyId ? snapshotDifficulty : null);
        const player = Array.isArray(view.players) && view.players.find(candidate => candidate?.id === view.playerId);
        if (!map || map.id !== view.mapId || !difficulty || difficulty.id !== view.difficultyId || !player) {
          fail('联机服务返回了不完整的战场数据，请重新加入房间'); return;
        }
        view.map = map; view.difficulty = difficulty; view.player = player;
      }
      if (!view.player || !view.map || !view.difficulty) return;
      snapshotMap = view.map; snapshotDifficulty = view.difficulty; snapshotTick = data.tick;
      const receivedAt = now();
      metrics.snapshotIntervalMs = snapshotReceivedAt === null ? null : Math.max(0, receivedAt - snapshotReceivedAt);
      snapshotReceivedAt = receivedAt;
      // Count UTF-8 bytes without requiring TextEncoder in the mini-game host.
      let bytes = 0;
      for (const character of raw) { const point = character.codePointAt(0); bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4; }
      metrics.snapshotBytes = bytes; metrics.snapshotCount++;
      for (const key of ['paused', 'pauseOwnerId', 'pauseOwnerIds']) if (Object.prototype.hasOwnProperty.call(data, key)) view[key] = data[key];
      onSnapshot(view, data.tick);
    }
    else if (data.type === 'pong') { if (pingSentAt !== null) { metrics.rttMs = Math.max(0, now() - pingSentAt); pingSentAt = null; } }
    else if (data.type === 'error') { if (!connected) fail(data.message || '无法进入房间'); else onError(data.message || '操作未完成', { recoverable: true }); }
    else if (data.type === 'ended') { active = false; cleanup(); onEnd(data.message || '房间已结束'); }
  }
  function bind(task, attemptId) {
    if (!active || attemptId !== attempt) { closeTask(task); return; }
    if (!task) { connectionProblem('连接握手', { code: 'INVALID_SOCKET' }); return; }
    socket = task;
    const current = () => active && socket === task && attemptId === attempt;
    const onOpen = () => {
      if (!current() || opened) return;
      opened = true; intentSent = true;
      armTimeout('房间响应');
      if (!rawSend(intent) || !active) return;
      heartbeat = setInterval(() => {
        if (pingSentAt !== null) return;
        pingSentAt = now();
        if (!rawSend({ type: 'ping' })) pingSentAt = null;
      }, 15000);
    };
    const onClose = event => { if (current()) connectionProblem('连接关闭', event); };
    const onMessage = event => { if (current()) receive(event); };
    const onError = error => { if (current()) connectionProblem(opened ? '实时连接' : '连接握手', error); };
    if (platform === 'wechat') {
      // Register inbound/error listeners before onOpen can deliver the intent.
      // The official API requires onOpen; it does not document readyState.
      armTimeout('连接握手');
      task.onMessage(onMessage); task.onError(onError); task.onClose(onClose); task.onOpen(onOpen);
    } else {
      task.addEventListener('message', onMessage); task.addEventListener('error', onError);
      task.addEventListener('close', onClose); task.addEventListener('open', onOpen);
      if (task.readyState === 1) onOpen();
    }
  }
  async function openWeChatAttempt() {
    if (!active) return;
    const attemptId = ++attempt;
    armTimeout('云连接');
    try {
      const result = await wxApi.cloud.connectContainer({ config: { env: NETWORK_CONFIG.env }, service: NETWORK_CONFIG.service, path: '/ws' });
      const task = result?.socketTask || result;
      if (!active || attemptId !== attempt || retryTimer !== null) { closeTask(task); return; }
      bind(task, attemptId);
    } catch (error) {
      if (active && attemptId === attempt && retryTimer === null) connectionProblem('云连接', error);
    }
  }
  async function connect(message) {
    if (intent || !active) return;
    intent = message;
    try {
      if (platform === 'wechat') {
        if (typeof wxApi?.cloud?.connectContainer !== 'function' || typeof wxApi?.cloud?.init !== 'function') { fail('当前微信不支持云托管联机，请更新微信后重试'); return; }
        try { wxApi.cloud.init({ env: NETWORK_CONFIG.env, traceUser: true }); }
        catch (error) { connectionProblem('云初始化', error); return; }
        await openWeChatAttempt();
      } else {
        if (!endpoint) { fail('网页版联机仅在本地开发启用，请使用微信小游戏联机'); return; }
        if (typeof WebSocketImpl !== 'function') { fail('当前浏览器不支持实时联机'); return; }
        attempt++; armTimeout('连接握手'); bind(new WebSocketImpl(endpoint), attempt);
      }
    } catch (error) { connectionProblem('连接握手', error); }
  }
  return {
    create: (mapId, difficultyId) => connect({ type: 'create', mapId, difficultyId, compactSnapshots: true }),
    join: code => connect({ type: 'join', code, compactSnapshots: true }),
    start: () => rawSend({ type: 'start' }),
    input: input => rawSend({ type: 'input', seq: ++sequence, input }),
    action: (action, options = {}) => rawSend({ type: 'action', action, ...options }),
    pause: paused => rawSend({ type: 'pause', paused }),
    getMetrics: () => ({ ...metrics }),
    close() { if (!active) return; rawSend({ type: 'leave' }); active = false; cleanup(); },
  };
}
