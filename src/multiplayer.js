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
    const fields = ['player', 'players', 'enemies', 'bullets', 'grenades', 'pickups', 'barrels', 'effects', 'wave', 'waveTotal', 'waveKills', 'score', 'kills', 'time', 'status', 'teamStatus', 'revivesRemaining', 'paused', 'pauseOwnerId', 'pauseOwnerIds'];
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
  endpoint = browserSocketURL(), timeoutMs = 15000, now = () => globalThis.performance?.now?.() ?? Date.now(),
  onRoom = () => {}, onSnapshot = () => {}, onError = () => {}, onEnd = () => {} } = {}) {
  let socket = null, active = true, opened = false, connected = false, sequence = 0, timer = null;
  let intent = null, heartbeat = null;
  let snapshotMap = null, snapshotDifficulty = null, snapshotTick = -1;
  let pingSentAt = null, snapshotReceivedAt = null;
  let metrics = { rttMs: null, snapshotIntervalMs: null, snapshotBytes: null, snapshotCount: 0 };
  const connectionFailure = platform === 'wechat'
    ? '无法连接联机服务，请检查部署与身份权限；iOS 高性能+ 暂不支持'
    : '无法连接联机服务，请检查网络或云端部署';
  const clearTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const rawSend = message => {
    if (!active || !opened || !socket) return false;
    const data = JSON.stringify(message);
    try { if (platform === 'wechat') socket.send({ data, fail: () => fail('网络发送失败，请重新创建或加入房间') }); else socket.send(data); return true; }
    catch { fail('网络发送失败，请重新创建或加入房间'); return false; }
  };
  function cleanup() {
    clearTimer(); if (heartbeat !== null) clearInterval(heartbeat); heartbeat = null;
    pingSentAt = null; snapshotReceivedAt = null;
    metrics = { rttMs: null, snapshotIntervalMs: null, snapshotBytes: null, snapshotCount: 0 };
    opened = false;
    const task = socket; socket = null;
    try { if (platform === 'wechat') task?.close({ code: 1000, reason: 'leave' }); else task?.close(1000, 'leave'); } catch { /* Already closed. */ }
  }
  function fail(message) { if (!active) return; active = false; cleanup(); onError(message); }
  function receive(event) {
    if (!active) return;
    const raw = typeof event.data === 'string' ? event.data : String(event.data);
    let data; try { data = JSON.parse(raw); } catch { fail('联机服务返回了无法识别的数据'); return; }
    if (data.type === 'room') { connected = true; clearTimer(); onRoom(data); }
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
  function bind(task) {
    if (!active) { try { task?.close(platform === 'wechat' ? {} : undefined); } catch { /* Stale async connection. */ } return; }
    if (!task) { fail('联机连接创建失败'); return; }
    socket = task;
    const onOpen = () => {
      if (!active || opened) return;
      opened = true; rawSend(intent);
      heartbeat = setInterval(() => {
        if (pingSentAt !== null) return;
        pingSentAt = now();
        if (!rawSend({ type: 'ping' })) pingSentAt = null;
      }, 15000);
    };
    const onClose = () => { if (!active) return; fail('连接已断开，本局结束，请重新创建或加入房间'); };
    if (platform === 'wechat') {
      task.onOpen(onOpen); task.onMessage(receive); task.onError(() => fail(connectionFailure)); task.onClose(onClose);
    } else {
      task.addEventListener('open', onOpen); task.addEventListener('message', receive);
      task.addEventListener('error', () => fail(connectionFailure)); task.addEventListener('close', onClose);
      if (task.readyState === 1) onOpen();
    }
  }
  async function connect(message) {
    if (intent || !active) return;
    intent = message;
    timer = setTimeout(() => fail('连接超时，请检查联机服务后重试'), timeoutMs);
    try {
      if (platform === 'wechat') {
        if (typeof wxApi?.cloud?.connectContainer !== 'function') { fail('当前微信不支持云托管联机，请更新微信后重试'); return; }
        wxApi.cloud.init({ env: NETWORK_CONFIG.env, traceUser: true });
        const result = await wxApi.cloud.connectContainer({ config: { env: NETWORK_CONFIG.env }, service: NETWORK_CONFIG.service, path: '/ws' });
        bind(result?.socketTask || result);
      } else {
        if (!endpoint) { fail('网页版联机仅在本地开发启用，请使用微信小游戏联机'); return; }
        if (typeof WebSocketImpl !== 'function') { fail('当前浏览器不支持实时联机'); return; }
        bind(new WebSocketImpl(endpoint));
      }
    } catch { fail(connectionFailure); }
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
