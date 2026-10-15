import { Game, MAPS, WEAPONS, WEAPON_ORDER, GRENADE_RULES, DIFFICULTIES, BOOST_RULES } from './game.js';
import { drawArena, drawEgg } from './render.js';
import { findAimTarget } from './aim.js';
import { createMultiplayerClient, NetworkGame } from './multiplayer.js';

const C = { bg: '#13242a', panel: '#21363b', line: '#526b68', ink: '#fff6e7', muted: '#b5c9c6', lime: '#d3efa3', teal: '#b2e3ca', coral: '#ffb196' };
const FONT = 'sans-serif';
const weaponIds = WEAPON_ORDER;
const mapLabels = { greenhouse: ['汽泡工坊', '爆破油桶 · 加速穿行'], candyloop: ['星糖回廊', '中心岛 · 双环绕行'] };
const difficultyHints = { easy: '怪物更少更慢，适合轻松突围', normal: '熟悉走位，迎接无尽攻势', hard: '更多怪物，更紧凑的攻势' };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createApp({ canvas, width, height, pixelRatio = 1, storage, platform = 'web', audio, multiplayerFactory = createMultiplayerClient, wxApi }) {
  const ctx = canvas.getContext('2d');
  let size = { width, height, pixelRatio }, layout, game = null, screen = 'menu', selectedMap = MAPS[0].id;
  let paused = false, help = false, weaponPicker = false, lastTimestamp = null, clock = 0, pointer = null, shooting = false;
  let buttons = [], touches = new Map(), keys = new Set(), actions = {}, toast = '', toastUntil = 0, resultSaved = false;
  let pressFeedback = null;
  let grenadePointer = null;
  let network = null, connectionId = 0;
  let backgrounded = false, backgroundPauseRequested = false;
  let coop = { view: 'select', code: '', room: null, message: '' };
  let best = { wave: 0, score: 0 };
  const frameStats = { fps: null, frameMs: null, elapsed: 0, frames: 0 };
  let muted = false, aimAssist = true, selectedDifficulty = 'easy', facing = -Math.PI / 2, aimManual = false;
  try { best = { ...best, ...JSON.parse(storage?.getItem('shellbound.best.v1') || '{}') }; } catch { /* A save is optional. */ }
  try { const settings = JSON.parse(storage?.getItem('shellbound.settings.v1') || '{}'); muted = settings.muted === true; aimAssist = settings.aimAssist !== false; if (Object.prototype.hasOwnProperty.call(DIFFICULTIES, settings.difficultyId)) selectedDifficulty = settings.difficultyId; } catch { /* Defaults work without storage. */ }
  audio?.setMuted(muted);
  function saveSettings() { try { storage?.setItem('shellbound.settings.v1', JSON.stringify({ muted, aimAssist, difficultyId: selectedDifficulty })); } catch { /* Settings are optional. */ } }
  function toggleSound() { muted = !muted; audio?.setMuted(muted); saveSettings(); }
  function toggleAim() { aimAssist = !aimAssist; if (game) game.aimTarget = null; saveSettings(); }

  function resize(next) {
    size = { ...size, ...next };
    size.pixelRatio = clamp(size.pixelRatio || 1, 1, 2);
    canvas.width = Math.round(size.width * size.pixelRatio);
    canvas.height = Math.round(size.height * size.pixelRatio);
    const compact = size.height < 620 || size.width < 1000;
    const baseHeight = compact ? 540 : 800;
    const scale = screen === 'game' ? Math.min(size.height / baseHeight, size.width / 960) : Math.min(size.width / (compact ? 960 : 1280), size.height / baseHeight);
    const w = screen === 'game' ? size.width / scale : compact ? 960 : 1280;
    const h = screen === 'game' ? size.height / scale : baseHeight;
    layout = { w, h, compact, scale, ox: (size.width - w * scale) / 2, oy: (size.height - h * scale) / 2 };
    buttons = []; pressFeedback = null;
    clearInput();
    if (game?.online && isPortrait() && !paused) pause(false);
  }
  function logical(point) { return { x: (point.x - layout.ox) / layout.scale, y: (point.y - layout.oy) / layout.scale }; }
  function arenaBounds(view = game?.getRenderView?.() || game) {
    const area = { x: 0, y: 0, w: layout.w, h: layout.h };
    if (!view) return area;
    const scale = Math.max(area.w / view.map.width, area.h / view.map.height, layout.compact ? 1.35 : 1.12);
    const camera = {
      x: clamp(view.player.x - area.w / scale / 2, 0, Math.max(0, view.map.width - area.w / scale)),
      y: clamp(view.player.y - area.h / scale / 2, 0, Math.max(0, view.map.height - area.h / scale)),
    };
    return { ...area, scale, camera };
  }
  function world(point) { const arena = arenaBounds(); return { x: arena.camera.x + (point.x - arena.x) / arena.scale, y: arena.camera.y + (point.y - arena.y) / arena.scale }; }
  function controlBounds() {
    return {
      move: { x: 124, y: layout.h - 115, r: 62 },
      fire: { x: layout.w - 116, y: layout.h - 112, r: 64 },
      boost: { x: layout.w - 260, y: layout.h - 78, r: 39 },
      grenade: { x: layout.w - 223, y: layout.h - 215, r: 39 },
      weapon: { x: layout.w - 332, y: layout.h - 215, r: 36 },
    };
  }
  function pauseBounds() {
    return weaponPicker ? { x: 228, y: 366, w: 122, h: 56 } : { x: 52, y: 156, w: 112, h: 64 };
  }
  // Use a physical-pixel threshold so a small thumb wobble does not switch
  // from assisted fire to manual aim on a small landscape screen.
  function fireDragThreshold() { return Math.max(12, 14 / layout.scale); }
  function clearInput() { keys.clear(); touches.clear(); pointer = null; grenadePointer = null; shooting = false; actions = {}; weaponPicker = false; aimManual = false; if (game) game.aimTarget = null; if (game?.online) network?.input({ moveX: 0, moveY: 0, shoot: false }); }
  function cycleWeapon() {
    const owned = weaponIds.filter(id => game.player.weapons[id]);
    if (owned.length < 2) { toast = '清关或捡武器箱解锁新枪'; toastUntil = clock + 2; return; }
    const current = actions.weaponSlot || game.pendingWeaponId || game.player.currentWeapon;
    actions.weaponSlot = owned[(owned.indexOf(current) + 1) % owned.length];
    weaponPicker = false;
  }
  function revive() {
    if (!game.revive()) return;
    if (game.online) { clearInput(); return; }
    resultSaved = false; paused = false; help = false; clearInput(); lastTimestamp = null;
    facing = game.player.angle;
    audio?.unlock(); audio?.playEvents([{ type: 'revive' }]);
    toast = `复活成功 · 3 秒保护 · 剩余 ${game.revivesRemaining} 次`; toastUntil = clock + 3;
  }
  function activateBoost() {
    if (paused || help || !game || game.status !== 'playing') return;
    if (game.activateBoost()) { if (!game.online) audio?.playEvents([{ type: 'boostActivation' }]); }
    else { toast = '击败怪物，拾取闪电补充爆发'; toastUntil = clock + 2; }
  }
  function grenadeDrag(touch, point) {
    Object.assign(touch, point);
    if (Math.hypot(touch.x - touch.base.x, touch.y - touch.base.y) > fireDragThreshold()) touch.dragged = true;
  }
  function grenadeAim() {
    if (!game || paused || help || game.status !== 'playing') return null;
    const touch = grenadePointer || [...touches.values()].find(item => item.role === 'grenade');
    if (!touch) return null;
    const button = controlBounds().grenade;
    if (touch.dragged && Math.hypot(touch.x - button.x, touch.y - button.y) <= button.r) return null;
    const target = game.resolveGrenadeTarget(touch.dragged ? world(touch) : undefined);
    return { ...target, range: GRENADE_RULES.blastRadius };
  }
  function releaseGrenade(touch, point) {
    if (!game || paused || help || game.status !== 'playing') return;
    grenadeDrag(touch, point);
    const button = controlBounds().grenade;
    if (touch.dragged && Math.hypot(point.x - button.x, point.y - button.y) <= button.r) return;
    if (point.x < 0 || point.y < 0 || point.x > layout.w || point.y > layout.h) return;
    actions.grenade = true;
    actions.grenadeTarget = touch.dragged ? world(point) : undefined;
  }
  function start() {
    disconnect();
    game = new Game({ mapId: selectedMap, difficultyId: selectedDifficulty, seed: Date.now() >>> 0 });
    facing = game.player.angle; audio?.pause(); audio?.unlock(); audio?.playEvents(game.events);
    screen = 'game'; paused = false; help = false; resultSaved = false; lastTimestamp = null;
    resize(size); toast = selectedMap === 'greenhouse' ? '打爆油桶清怪 · 踩箭头加速带' : '绕中心岛突围 · 走加速通道'; toastUntil = clock + 3;
  }
  function disconnect() { connectionId += 1; backgroundPauseRequested = false; const client = network; network = null; client?.close(); }
  function menu() { disconnect(); audio?.pause(); screen = 'menu'; game = null; paused = false; help = false; resize(size); }
  function ensureBackgroundPause() {
    if (!backgrounded || !network) return;
    // A room can begin while this app is hidden and before its first combat
    // snapshot. Dead games also need protection against a teammate's revive.
    if (!game?.online && (!coop.room || coop.room.phase === 'waiting')) return;
    if (localOwnsPause()) { backgroundPauseRequested = true; return; }
    if (backgroundPauseRequested) return;
    backgroundPauseRequested = true;
    network.pause(true);
  }
  function pause(fromBackground = true) {
    if (fromBackground) backgrounded = true;
    audio?.pause();
    if (game?.online) { paused = true; if (fromBackground) ensureBackgroundPause(); else network?.pause(true); }
    else if (game && !['won', 'dead'].includes(game.status)) paused = true;
    if (fromBackground) ensureBackgroundPause();
    clearInput(); lastTimestamp = null;
  }
  function resume() { backgrounded = false; clearInput(); lastTimestamp = null; }
  function localOwnsPause() {
    const room = coop.room;
    const owners = room?.pauseOwnerIds || (room?.pauseOwnerId ? [room.pauseOwnerId] : []);
    return owners.includes(room?.playerId);
  }
  function continueGame() {
    if (game?.online) {
      if (backgrounded || !localOwnsPause()) return;
      backgroundPauseRequested = false;
      network?.pause(false);
    } else paused = false;
    clearInput(); lastTimestamp = null;
  }
  function togglePause() { if (game?.online) { if (paused) continueGame(); else pause(false); help = false; return; } if (game && !['won', 'dead'].includes(game.status)) { paused = !paused; if (paused) audio?.pause(); help = false; clearInput(); lastTimestamp = null; } }

  function openCoop() {
    disconnect(); game = null; screen = 'coop'; paused = false; help = false;
    coop = { view: 'select', code: '', room: null, message: '' }; resize(size);
  }
  function connectCoop(join = false) {
    if (coop.view === 'connecting' || join && !/^\d{6}$/.test(coop.code)) return;
    disconnect(); const id = connectionId;
    coop.view = 'connecting'; coop.message = '';
    const current = () => id === connectionId;
    network = multiplayerFactory({ platform, wxApi,
      onRoom(room) {
        if (!current()) return;
        coop.room = { ...room, players: room.players?.map(({ id, connected }) => ({ id, connected })) };
        coop.view = 'room'; coop.message = '';
        if (game?.online) {
          const wasPaused = paused; paused = room.paused === true || room.phase === 'paused' || backgrounded || backgroundPauseRequested;
          if (paused && !wasPaused) { audio?.pause(); clearInput(); }
          if (wasPaused !== paused) lastTimestamp = null;
        }
        ensureBackgroundPause();
      },
      onSnapshot(view, tick) {
        if (!current() || !view?.player || !view?.map) return;
        if (!game?.online) {
          game = new NetworkGame(network, view, tick); screen = 'game';
          facing = game.player.angle; resultSaved = false; lastTimestamp = null; audio?.unlock(); resize(size);
        } else if (!game.applyView(view, tick)) return;
        const wasPaused = paused;
        paused = view.paused === true || backgrounded || backgroundPauseRequested;
        if (coop.room) Object.assign(coop.room, { paused: view.paused === true, pauseOwnerId: view.pauseOwnerId ?? null,
          pauseOwnerIds: view.pauseOwnerIds || (view.pauseOwnerId ? [view.pauseOwnerId] : []) });
        if (paused && !wasPaused) { audio?.pause(); clearInput(); }
        if (paused !== wasPaused) lastTimestamp = null;
        ensureBackgroundPause();
        if (isPortrait() && !paused) pause(false);
      },
      onError(message, options = {}) {
        if (!current()) return;
        if (options.recoverable) { coop.message = message; if (game?.online) { toast = message; toastUntil = clock + 3; } return; }
        disconnect(); audio?.pause(); game = null; screen = 'coop'; paused = false;
        coop.view = 'error'; coop.message = message; resize(size);
      },
      onEnd(message) {
        if (!current()) return;
        disconnect(); audio?.pause(); game = null; screen = 'coop'; paused = false;
        coop.view = 'error'; coop.message = message; resize(size);
      },
    });
    if (join) network.join(coop.code); else network.create(selectedMap, selectedDifficulty);
  }

  function rounded(x, y, w, h, radius = 14, fill, stroke) {
    radius = Math.min(radius, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + w - radius, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius); ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function text(value, x, y, fontSize = 18, color = C.ink, weight = 650, align = 'left') {
    // Use basic font shorthand instead of variable-font weights such as 650.
    ctx.font = `${weight >= 700 ? 'bold' : 'normal'} ${fontSize}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(String(value), x, y);
  }
  const menuFont = (fontSize, minimum = 18) => Math.max(fontSize, minimum / layout.scale);
  function pressOffset(label, x, y, w, h) {
    if (!pressFeedback || pressFeedback.until <= clock || pressFeedback.screen !== screen || pressFeedback.view !== coop.view
      || pressFeedback.label !== label || pressFeedback.x !== x || pressFeedback.y !== y || pressFeedback.w !== w || pressFeedback.h !== h) return 0;
    return 2 * ((pressFeedback.until - clock) / .14) ** 2;
  }
  function button(x, y, w, h, label, callback, { fill = C.panel, color = C.ink, border = C.line, fontSize = 19, active = true } = {}) {
    const offset = active ? pressOffset(label, x, y, w, h) : 0, radius = Math.min(24, h / 2);
    if (active && h >= 44) rounded(x, y + 3, w, h, radius, 'rgba(4,17,20,.32)');
    rounded(x, y + offset, w, h, radius, fill, border === C.line ? 'rgba(179,213,199,.18)' : border);
    text(label, x + w / 2, y + h / 2 + offset, fontSize, color, 700, 'center');
    if (active) buttons.push({ x, y, w, h, callback, label });
  }
  function skillButton(role, label, callback, { color = C.ink, value = '', disabled = false, progress = 0 } = {}) {
    const { x, y, r } = controlBounds()[role];
    const held = [...touches.values()].some(touch => touch.role === role) || role === 'grenade' && grenadePointer;
    ctx.save(); ctx.globalAlpha = disabled ? .55 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = held ? 'rgba(83,112,72,.92)' : 'rgba(16,30,37,.78)'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = role === 'fire' ? 3 : 2; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const cy = y - (role === 'fire' ? 6 : 7);
    if (role === 'fire') {
      ctx.beginPath(); ctx.arc(x, cy, 18, 0, Math.PI * 2); ctx.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.beginPath(); ctx.moveTo(x + dx * 11, cy + dy * 11); ctx.lineTo(x + dx * 25, cy + dy * 25); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, cy, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      const touch = [...touches.values()].find(item => item.role === 'fire');
      if (touch && aimManual) {
        const dx = touch.x - touch.base.x, dy = touch.y - touch.base.y, dist = Math.hypot(dx, dy);
        if (dist > 0) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx / dist * (r - 12), y + dy / dist * (r - 12)); ctx.stroke();
          ctx.beginPath(); ctx.arc(x + dx / dist * (r - 12), y + dy / dist * (r - 12), 7, 0, Math.PI * 2); ctx.fill(); }
      }
    } else if (role === 'boost') {
      ctx.beginPath(); ctx.moveTo(x + 3, cy - 17); ctx.lineTo(x - 12, cy + 3);
      ctx.lineTo(x - 1, cy + 3); ctx.lineTo(x - 4, cy + 16);
      ctx.lineTo(x + 13, cy - 5); ctx.lineTo(x + 2, cy - 5); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    } else if (role === 'weapon') {
      ctx.beginPath(); ctx.moveTo(x - 16, cy - 7); ctx.lineTo(x + 16, cy - 7); ctx.lineTo(x + 10, cy - 13); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 16, cy + 7); ctx.lineTo(x - 16, cy + 7); ctx.lineTo(x - 10, cy + 13); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(x, cy + 3, 10, 13, -.3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 5, cy - 9); ctx.lineTo(x + 2, cy - 15); ctx.lineTo(x + 12, cy - 10); ctx.stroke();
    }
    text(role === 'grenade' || role === 'boost' ? `${label} ${value}` : label, x, y + (role === 'fire' ? 31 : 20), role === 'fire' ? 20 : 18, color, 750, 'center');
    if (progress > 0) { ctx.beginPath(); ctx.arc(x, y, r - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.restore();
    buttons.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, cx: x, cy: y, r, role, callback, label });
  }
  function line(x1, y1, x2, y2, color = C.line) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
  function mapPreview(map, x, y, w, h) {
    const greenhouse = map.id === 'greenhouse';
    rounded(x, y, w, h, 12, greenhouse ? '#65859a' : '#84789e');
    ctx.save(); ctx.translate(x + 8, y + 8); ctx.scale((w - 16) / map.width, (h - 16) / map.height);
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 2;
    for (let i = 0; i < map.width; i += 100) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, map.height); ctx.stroke(); }
    for (let i = 0; i < map.height; i += 100) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(map.width, i); ctx.stroke(); }
    for (const zone of map.speedZones || []) { ctx.fillStyle = '#65e4d2'; ctx.fillRect(zone.x, zone.y, zone.w, zone.h); }
    for (const obstacle of map.obstacles) { ctx.fillStyle = greenhouse ? '#d4b56b' : '#f2bdcd'; ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h); }
    for (const station of map.barrelStations || []) { ctx.fillStyle = '#ff9c65'; ctx.beginPath(); ctx.arc(station.x, station.y, 23, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#f6f0cf'; ctx.beginPath(); ctx.arc(map.start.x, map.start.y, 30, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawLogo(x, y, small = false) {
    drawEgg(ctx, x + 20, y + 21, { scale: .72, angle: -.25, color: '#f4edce', time: clock * 1000 });
    text('蛋壳突围', x + 53, y + 13, small ? 19 : 24, C.ink, 800);
    text('SHELLBOUND', x + 54, y + 37, 16, C.muted, 700);
  }
  function drawPoster(x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.ellipse(0, 18, 210, 85, -.12, 0, Math.PI * 2); ctx.fillStyle = '#28423f'; ctx.fill();
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, 15, 125 + i * 39, 46 + i * 20, -.12, 0, Math.PI * 2); ctx.strokeStyle = '#416559'; ctx.lineWidth = 1; ctx.stroke(); }
    drawEgg(ctx, -145, -15, { scale: 1.45, color: '#9edac2', enemyType: 'grunt', angle: .2, time: clock * 1000 });
    drawEgg(ctx, 135, 48, { scale: 1.8, color: '#baafe2', enemyType: 'tank', angle: 3.4, time: clock * 1000 });
    drawEgg(ctx, 85, -68, { scale: 1.25, color: '#efbd8e', enemyType: 'runner', angle: 2.8, time: clock * 1000 });
    ctx.beginPath(); ctx.arc(-12, -8, 76, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(141,212,194,.38)'; ctx.lineWidth = 2; ctx.stroke();
    drawEgg(ctx, -12, -8, { scale: 2.9, color: '#f5ebcc', angle: -.3, shield: 70, weapon: 'rifle', time: clock * 1000 });
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(84 + i * 20, -33 - i * 5, 3.5, 0, Math.PI * 2); ctx.fillStyle = C.lime; ctx.fill(); }
    ctx.restore();
  }
  function drawMenu() {
    const { compact, w, h } = layout;
    drawLogo(38, 27, compact);
    button(platform === 'wechat' ? 320 : w - 278, 30, 100, 40, muted ? '音效：关' : '音效：开', toggleSound, { fontSize: 18 });
    button(platform === 'wechat' ? 432 : w - 166, 30, 126, 40, '操作指南', () => { audio?.pause(); help = true; }, { fontSize: 18 });
    if (!compact) {
      text('无尽突围 / 并肩作战', 64, 141, 18, C.teal, 700);
      text('守住最后', 60, 223, 76, C.ink, 800);
      text('一颗蛋。', 60, 311, 76, C.lime, 800);
      text('握紧武器，穿过包围。', 65, 397, 20, C.muted);
      text('选一张地图，迎接无尽攻势。', 65, 430, 20, C.muted);
      drawPoster(311, 589, 1.24);
      text('6 种枪械', 64, 740, 20, C.ink, 700);
      text('盾牌防御', 195, 740, 20, C.ink, 700);
      text('手雷清场', 325, 740, 20, C.ink, 700);
      text('选择战区', 713, 143, 27, C.ink, 750);
      text('每张地图，都是一种新的走位。', 713, 178, 18, C.muted);
    } else {
      text('守住最后', 37, 132, 49, C.ink, 800); text('一颗蛋。', 37, 191, 49, C.lime, 800);
      text('原创角色 / 无尽攻势 / 六种枪械', 40, 251, 20, C.muted);
      drawPoster(229, 375, .84);
      text('盾牌挡伤害 · 手雷破包围', 40, h - 32, 20, C.teal, 700);
    }
    const x = compact ? 500 : 710, top = compact ? 90 : 210, cardW = compact ? 420 : 500, cardH = compact ? 108 : 165, gap = compact ? 12 : 18;
    MAPS.forEach((map, i) => {
      const y = top + i * (cardH + gap), selected = selectedMap === map.id, label = mapLabels[map.id] || [map.name || map.id, '', ''];
      rounded(x, y, cardW, cardH, 26, selected ? '#2e493f' : C.panel, selected ? '#8fb59a' : undefined);
      const mw = compact ? 116 : 159, mh = compact ? 78 : 131;
      mapPreview(map, x + 15, y + 15, mw, mh);
      const tx = x + mw + 31;
      text(`0${i + 1}${selected ? '  ✓' : ''}`, tx, y + (compact ? 23 : 34), 18, selected ? C.lime : C.muted, 700);
      text(label[0], tx, y + (compact ? 53 : 76), compact ? 26 : 30, C.ink, 800);
      text(label[1], tx, y + (compact ? 83 : 116), compact ? 18 : 20, C.muted);
      buttons.push({ x, y, w: cardW, h: cardH, callback: () => { selectedMap = map.id; }, label: label[0] });
    });
    const difficultyY = top + (cardH + gap) * 2 + 5;
    const difficultyW = cardW / 3, difficultyH = compact ? 64 : 54;
    rounded(x, difficultyY, cardW, difficultyH, difficultyH / 2, '#152a2e');
    Object.values(DIFFICULTIES).forEach((difficulty, i) => {
      const selected = selectedDifficulty === difficulty.id, dx = x + i * difficultyW;
      const offset = pressOffset(difficulty.label, dx, difficultyY, difficultyW, difficultyH);
      if (selected) rounded(dx + 5, difficultyY + 5 + offset, difficultyW - 10, difficultyH - 10, (difficultyH - 10) / 2, '#3e5c48');
      text(difficulty.label, dx + difficultyW / 2, difficultyY + difficultyH / 2 + offset, menuFont(23, 16), selected ? C.lime : C.muted, selected ? 700 : 400, 'center');
      buttons.push({ x: dx, y: difficultyY, w: difficultyW, h: difficultyH, label: difficulty.label,
        callback: () => { selectedDifficulty = difficulty.id; saveSettings(); } });
    });
    text(difficultyHints[selectedDifficulty], x + cardW / 2, difficultyY + (compact ? 82 : 74), 18, C.teal, 700, 'center');
    const startY = difficultyY + 104;
    const soloW = Math.round(cardW * .64);
    button(x, startY, soloW, compact ? 58 : 64, '开始突围   →', start, { fill: C.lime, color: C.bg, border: C.lime, fontSize: menuFont(28) });
    button(x + soloW + 10, startY, cardW - soloW - 10, compact ? 58 : 64, '双人合作', openCoop, { fill: '#2d4842', border: '#688a77', color: C.teal, fontSize: menuFont(28) });
    text(best.score ? `最佳战绩  ${best.score} 分 · 第 ${best.wave} 波` : '每局 3 次复活 · 清关自动推进', x + cardW / 2, startY + (compact ? 78 : 94), 18, C.muted, 650, 'center');
  }
  function drawCoop() {
    drawLogo(38, 27, layout.compact);
    const cx = layout.w / 2, panelX = cx - 260, panelY = (layout.h - 430) / 2 + 20;
    button(38, layout.h - 67, 170, 46, '返回地图选择', menu, { fontSize: 19 });
    rounded(panelX, panelY + 4, 520, 430, 32, 'rgba(4,17,20,.25)');
    rounded(panelX, panelY, 520, 430, 32, C.panel, 'rgba(179,213,199,.18)');
    text('双人合作', cx, panelY + 38, 30, C.ink, 800, 'center');
    if (coop.view === 'join') {
      text(coop.code.padEnd(6, '·').split('').join('  '), cx, panelY + 88, 35, C.lime, 800, 'center');
      text('输入朋友的 6 位房间码', cx, panelY + 124, 18, C.muted, 650, 'center');
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '删除', '0', '加入房间'].forEach((value, index) => {
        const x = panelX + 30 + index % 3 * 155, y = panelY + 159 + Math.floor(index / 3) * 57;
        const join = value === '加入房间';
        button(x, y, 145, 47, value, () => {
          if (join) connectCoop(true);
          else if (value === '删除') coop.code = coop.code.slice(0, -1);
          else if (coop.code.length < 6) coop.code += value;
        }, { fontSize: value.length > 1 ? 23 : 27, fill: join && coop.code.length === 6 ? C.lime : '#182c31', color: join && coop.code.length === 6 ? C.bg : C.ink, active: !join || coop.code.length === 6 });
      });
      return;
    }
    if (coop.view === 'connecting') {
      text('正在连接联机服务…', cx, panelY + 175, 25, C.teal, 700, 'center');
      text('首次启动云端服务可能需要片刻', cx, panelY + 224, 18, C.muted, 650, 'center');
      button(panelX + 50, panelY + 328, 420, 54, '取消连接', openCoop, { fontSize: menuFont(26) });
      return;
    }
    if (coop.view === 'error') {
      text('房间连接已结束', cx, panelY + 110, 24, C.coral, 750, 'center');
      const lines = String(coop.message).match(/.{1,23}/gu) || [];
      lines.slice(0, 3).forEach((value, index) => text(value, cx, panelY + 163 + index * 31, 20, C.ink, 650, 'center'));
      button(panelX + 50, panelY + 328, 420, 54, '重新创建或加入', openCoop, { fill: C.lime, color: C.bg, border: C.lime, fontSize: menuFont(26) });
      return;
    }
    if (coop.view === 'room' && coop.room) {
      const room = coop.room, host = room.playerId === room.hostId;
      const ready = room.players?.filter(player => player.connected !== false).length === 2;
      text('把房间码告诉朋友', cx, panelY + 84, menuFont(22, 16), C.muted, 400, 'center');
      text(room.code, cx, panelY + 136, 52, C.lime, 800, 'center');
      text(`${mapLabels[room.mapId]?.[0] || room.mapId} · ${DIFFICULTIES[room.difficultyId]?.label || ''}`, cx, panelY + 189, 21, C.teal, 750, 'center');
      for (const [index, id] of ['p1', 'p2'].entries()) {
        const connected = room.players?.some(player => player.id === id && player.connected !== false);
        text(`${index + 1}P ${id === room.playerId ? '你' : '队友'} · ${connected ? '已加入' : '等待加入'}`, cx - 120 + index * 240, panelY + 253, 21, index ? '#a9dbff' : C.ink, 750, 'center');
      }
      button(panelX + 50, panelY + 315, 420, 57, host ? ready ? '开始双人突围' : '等待队友加入' : '等待房主开始', () => network?.start(),
        { active: host && ready, fill: host && ready ? C.lime : C.bg, color: host && ready ? C.bg : C.muted, border: host && ready ? C.lime : C.line, fontSize: menuFont(28) });
      text(coop.message || '离开或断线会结束本房间', cx, panelY + 398, 18, coop.message ? C.coral : C.muted, 650, 'center');
      return;
    }
    text('和朋友一起守住战场', cx, panelY + 94, 23, C.teal, 750, 'center');
    text(`${mapLabels[selectedMap]?.[0]} · ${DIFFICULTIES[selectedDifficulty].label}`, cx, panelY + 144, 21, C.muted, 650, 'center');
    button(panelX + 50, panelY + 205, 420, 60, '创建房间', () => connectCoop(), { fill: C.lime, color: C.bg, border: C.lime, fontSize: menuFont(28) });
    button(panelX + 50, panelY + 284, 420, 60, '输入房间码加入', () => { coop.view = 'join'; coop.code = ''; }, { fill: '#2d4842', border: '#688a77', color: C.teal, fontSize: menuFont(28) });
  }
  function bar(x, y, w, value, max, color) { rounded(x, y, w, 7, 3, '#34464a'); if (value > 0) rounded(x, y, Math.max(6, w * clamp(value / max, 0, 1)), 7, 3, color); }
  function drawHUD() {
    const { w } = layout, p = game.player, ammo = p.weapons[p.currentWeapon];
    rounded(24, 18, 326, 108, 16, 'rgba(16,30,37,.9)', 'rgba(244,241,229,.3)');
    text(`生命 ${Math.ceil(p.hp)}`, 40, 37, 18, C.ink, 750); bar(40, 53, 136, p.hp, p.maxHp, C.coral);
    text(`盾牌 ${Math.ceil(p.shield)}`, 196, 37, 18, C.teal, 750); bar(196, 53, 136, p.shield, p.maxShield, C.teal);
    text(WEAPONS[p.currentWeapon].label, 40, 83, 22, C.ink, 800);
    text(ammo.clip, 333, 79, 30, C.lime, 800, 'right');
    text(`备用 ${p.currentWeapon === 'pistol' ? '∞' : ammo.reserve}`, 333, 103, 18, C.muted, 700, 'right');
    text(weaponPicker ? '▴' : '▾', 203, 83, 20, C.teal, 750, 'center');
    buttons.push({ x: 24, y: 61, w: 326, h: 64, callback: () => { weaponPicker = !weaponPicker; }, label: '切换武器' });
    if (weaponPicker) {
      rounded(24, 156, 326, 196, 14, 'rgba(16,30,37,.96)', C.line);
      text('武器库', 38, 177, 20, C.ink, 750);
      button(265, 162, 70, 30, '收起', () => { weaponPicker = false; }, { fontSize: 18, border: C.panel });
      const labels = ['手枪', '冲锋枪', '步枪', '机枪', '大狙', '霰弹枪'];
      weaponIds.forEach((id, i) => {
        const owned = p.weapons[id], selected = p.currentWeapon === id, x = 36 + i % 3 * 101, y = 200 + Math.floor(i / 3) * 74;
        rounded(x, y, 94, 68, 9, selected ? '#445b38' : C.panel, selected ? C.lime : C.line);
        text(labels[i], x + 47, y + 22, 20, owned ? C.ink : C.muted, 750, 'center');
        text(owned ? `${owned.clip} / ${id === 'pistol' ? '∞' : owned.reserve}` : '未解锁', x + 47, y + 49, 18, selected ? C.lime : C.muted, 700, 'center');
        buttons.push({ x, y, w: 94, h: 68, callback: () => { if (owned) { actions.weaponSlot = id; weaponPicker = false; } else { toast = '清关或拾取武器箱，解锁更多枪械'; toastUntil = clock + 2; } }, label: WEAPONS[id].label });
      });
    }
    rounded(w / 2 - 124, 20, 248, 65, 13, 'rgba(16,30,37,.86)');
    text(`${game.difficulty.label} · 第 ${game.wave} 波`, w / 2, 40, 22, C.lime, 800, 'center');
    text(`剩余 ${game.waveTotal - game.waveKills}   ·   ${game.score} 分`, w / 2, 68, 18, C.ink, 700, 'center');
    const pause = pauseBounds();
    button(pause.x, pause.y, pause.w, pause.h, 'Ⅱ 暂停', togglePause, { fill: 'rgba(16,30,37,.9)', fontSize: 18 });
    skillButton('fire', '开火', () => {}, { color: C.lime, disabled: ammo.reloadRemaining > 0 });
    skillButton('boost', '爆发', activateBoost, { color: '#ffdd83', value: p.boostCharges, disabled: p.boostCharges <= 0 && p.boostRemaining <= 0, progress: Math.min(1, p.boostRemaining / BOOST_RULES.duration) });
    skillButton('grenade', '手雷', () => {}, { color: '#f5cc92', value: p.grenades, disabled: p.grenades <= 0 });
    skillButton('weapon', '切枪', cycleWeapon, { color: '#ddc8f4', disabled: Object.keys(p.weapons).length < 2 });
  }
  function drawStick() {
    const { x, y, r } = controlBounds().move;
    const touch = [...touches.values()].find(t => t.role === 'move'), base = touch?.base || { x, y };
    ctx.beginPath(); ctx.arc(base.x, base.y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(16,30,37,.34)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,241,229,.38)'; ctx.lineWidth = 1.5; ctx.stroke();
    let dx = touch ? touch.x - base.x : 0, dy = touch ? touch.y - base.y : 0;
    const dist = Math.hypot(dx, dy); if (dist > r) { dx *= r / dist; dy *= r / dist; }
    ctx.beginPath(); ctx.arc(base.x + dx, base.y + dy, 25, 0, Math.PI * 2); ctx.fillStyle = 'rgba(244,241,229,.8)'; ctx.fill();
    if (!touch) {
      rounded(base.x - 72, base.y + r + 7, 144, 30, 15, 'rgba(16,30,37,.88)');
      text('移动 / 转向', base.x, base.y + r + 22, 18, C.ink, 750, 'center');
    }
  }
  function drawGame() {
    const view = game.getRenderView?.() || game;
    const arena = arenaBounds(view);
    const aimingGrenade = grenadeAim();
    drawArena(ctx, view, { time: clock * 1000, ...arena, grenadeAim: aimingGrenade });
    drawHUD();
    if (aimingGrenade) {
      rounded(layout.w / 2 - 175, layout.h - 107, 350, 32, 16, 'rgba(16,30,37,.88)');
      text('松手投掷 · 拖回手雷钮取消', layout.w / 2, layout.h - 91, 18, '#ffe0a7', 750, 'center');
    }
    const bosses = game.enemies.filter(enemy => enemy.type === 'tank' && enemy.hp > 0);
    const boss = bosses.find(enemy => enemy.rangedCharge > 0) || bosses[0];
    if (boss) {
      const bw = 380, bx = Math.max((layout.w - bw) / 2, weaponPicker ? 366 : 0), by = 156;
      rounded(bx, by, bw, 45, 12, 'rgba(16,30,37,.88)', '#aa8fbb');
      text(boss.rangedCharge > 0 ? `BOSS ×${bosses.length} · 侧移躲避！` : `重甲 BOSS ×${bosses.length} · 留意预警`, bx + bw / 2, by + 14, 18, boss.rangedCharge > 0 ? C.coral : '#e7cbff', 750, 'center');
      bar(bx + 15, by + 30, bw - 30, bosses.reduce((sum, enemy) => sum + enemy.hp, 0), bosses.reduce((sum, enemy) => sum + enemy.maxHp, 0), '#cba3eb');
    }
    if (platform === 'wechat' || touches.size || layout.compact) drawStick();
    if (pointer && !paused && !help && screen === 'game') {
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 10, 0, Math.PI * 2); ctx.strokeStyle = C.lime; ctx.lineWidth = 1.5; ctx.stroke();
      line(pointer.x - 16, pointer.y, pointer.x - 7, pointer.y, C.lime); line(pointer.x + 7, pointer.y, pointer.x + 16, pointer.y, C.lime);
      line(pointer.x, pointer.y - 16, pointer.x, pointer.y - 7, C.lime); line(pointer.x, pointer.y + 7, pointer.x, pointer.y + 16, C.lime);
    }
    if (toastUntil > clock && !paused && !help && game.status === 'playing' && !boss) {
      ctx.font = `bold 18px ${FONT}`;
      const tw = Math.min(440, ctx.measureText(toast).width + 44), controls = controlBounds();
      const tx = clamp(layout.w / 2, controls.move.x + controls.move.r + 16 + tw / 2, controls.boost.x - controls.boost.r - 16 - tw / 2);
      rounded(tx - tw / 2, layout.h - 52, tw, 34, 17, 'rgba(16,30,37,.86)');
      text(toast, tx, layout.h - 35, 18, C.ink, 700, 'center');
    }
    if (paused && !help) drawPause();
    if (game.status === 'dead' && !paused) drawResult();
  }
  function shade() { ctx.fillStyle = 'rgba(8,17,21,.79)'; ctx.fillRect(0, 0, layout.w, layout.h); buttons = []; }
  function drawPause() {
    shade(); const x = layout.w / 2 - 220, y = layout.h / 2 - 178;
    rounded(x, y, 440, 356, 22, C.panel, C.line);
    const teammatePaused = game.online && !localOwnsPause();
    text(teammatePaused ? '队友暂停了战斗' : '喘口气，再出发。', layout.w / 2, y + 49, 31, C.ink, 750, 'center');
    text(`当前${game.difficulty.label}难度 · 战场与倒计时已暂停`, layout.w / 2, y + 88, 18, C.muted, 650, 'center');
    button(x + 28, y + 123, 384, 48, teammatePaused ? '等待队友继续' : '继续突围', continueGame, { fill: C.lime, border: C.lime, color: C.bg, active: !teammatePaused });
    button(x + 28, y + 184, 184, 47, game.online ? '离开房间' : '重新开始', game.online ? menu : start, { fontSize: 20 }); button(x + 228, y + 184, 184, 47, '返回战区', menu, { fontSize: 20 });
    button(x + 28, y + 245, 184, 47, muted ? '音效：关' : '音效：开', toggleSound, { fontSize: 18 });
    button(x + 228, y + 245, 184, 47, aimAssist ? '辅助瞄准：开' : '辅助瞄准：关', toggleAim, { fontSize: 18 });
    text(game.online ? '全队已暂停 · 每位暂停玩家需点击继续' : '返回战区可调整难度 · Esc / P 继续', layout.w / 2, y + 326, 18, C.muted, 650, 'center');
  }
  function drawResult() {
    shade(); const boxH = 418, x = layout.w / 2 - 248, y = layout.h / 2 - boxH / 2;
    rounded(x, y, 496, boxH, 22, C.panel, C.line);
    text(game.online && game.teamStatus !== 'dead' ? '队友还在战斗，复活支援！' : '蛋壳裂了，勇气还在。', layout.w / 2, y + 48, 29, C.ink, 800, 'center');
    text(`${game.difficulty.label}难度 · ${game.online ? '合作战绩' : '调整走位，再试一次'}`, layout.w / 2, y + 86, 18, C.muted, 650, 'center');
    text(String(game.score), layout.w / 2, y + 143, 51, C.ink, 800, 'center'); text('本局得分', layout.w / 2, y + 181, 18, C.muted, 700, 'center');
    text(`第 ${game.wave} 波   /   ${game.kills} 次击败   /   ${Math.floor(game.time)} 秒`, layout.w / 2, y + 213, 18, C.teal, 700, 'center');
    button(x + 28, y + 251, 440, 48, game.revivesRemaining ? `免费复活 · 剩余 ${game.revivesRemaining} 次` : '本局复活已用完', revive, { fill: game.revivesRemaining ? C.lime : C.panel, border: game.revivesRemaining ? C.lime : C.line, color: game.revivesRemaining ? C.bg : C.muted, active: game.revivesRemaining > 0 });
    button(x + 28, y + 312, 440, 48, game.online ? '离开房间' : '再来一局   →', game.online ? menu : start, { fill: C.panel, border: C.line, color: C.ink });
    button(x + 150, y + 373, 196, 28, '返回地图选择', menu, { fill: C.panel, border: C.panel, color: C.muted, fontSize: 18 });
  }
  function drawHelp() {
    shade(); const boxW = 780, boxH = layout.compact ? 426 : 490, x = (layout.w - boxW) / 2, y = (layout.h - boxH) / 2;
    rounded(x, y, boxW, boxH, 22, C.panel, C.line); text('突围指南', x + 30, y + 39, 29, C.ink, 750);
    const rows = [
      ['移动与射击', '电脑：WASD / 方向键移动，鼠标瞄准，左键射击'],
      ['手机操作', '移动转向；按住开火辅助瞄准，拖动开火钮手动瞄准'],
      ['武器管理', '右侧切枪钮顺序换枪；左上角武器库可直接选择'],
      ['爆发与换弹', '爆发 / R 消耗闪电，射速弹速翻倍 8 秒；空弹匣自动换弹'],
      ['盾牌与手雷', '拖动手雷选落点，松手投掷；G 快投，护盾吸收伤害'],
      ['难度与复活', '首页选择休闲 / 标准 / 挑战；每局可复活 3 次'],
    ];
    rows.forEach(([title, detail], i) => { const ry = y + 88 + i * (layout.compact ? 44 : 51); text(title, x + 30, ry, 20, C.teal, 750); text(detail, x + 30, ry + 23, 18, C.ink, 650); });
    button(x + 30, y + boxH - 68, boxW - 60, 44, '准备好了', () => { help = false; clearInput(); lastTimestamp = null; }, { fill: C.lime, border: C.lime, color: C.bg, fontSize: 20 });
  }
  function drawPortrait() {
    buttons = []; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size.width, size.height);
    text('↻', size.width / 2, size.height / 2 - 75, 66, C.lime, 500, 'center');
    text('横屏，才能放开手脚。', size.width / 2, size.height / 2, 23, C.ink, 750, 'center');
    text('请旋转手机后继续突围', size.width / 2, size.height / 2 + 42, 18, C.muted, 650, 'center');
  }
  function isPortrait() { return size.width < 700 && size.height > size.width * 1.15; }
  function collectInput() {
    let moveX = Number(keys.has('d') || keys.has('ArrowRight')) - Number(keys.has('a') || keys.has('ArrowLeft'));
    let moveY = Number(keys.has('s') || keys.has('ArrowDown')) - Number(keys.has('w') || keys.has('ArrowUp'));
    let fire = shooting, aimedTouch = null, touchFire = false;
    for (const touch of touches.values()) {
      const dx = touch.x - touch.base.x, dy = touch.y - touch.base.y, dist = Math.hypot(dx, dy);
      if (touch.role === 'move' && dist > 6) {
        moveX += clamp(dx / controlBounds().move.r, -1, 1);
        moveY += clamp(dy / controlBounds().move.r, -1, 1);
      } else if (touch.role === 'fire') {
        fire = true; touchFire = true;
        if (dist > fireDragThreshold()) aimedTouch = { x: dx / dist, y: dy / dist };
      }
    }
    moveX = clamp(moveX, -1, 1); moveY = clamp(moveY, -1, 1);
    const p = game.player, movementLength = Math.hypot(moveX, moveY);
    if (movementLength > 0) facing = Math.atan2(moveY, moveX);
    if (aimedTouch) facing = Math.atan2(aimedTouch.y, aimedTouch.x);
    const direction = { x: Math.cos(facing), y: Math.sin(facing) };
    let target = pointer ? world(pointer) : { x: p.x + direction.x * 500, y: p.y + direction.y * 500 };
    if (aimedTouch) target = { x: p.x + aimedTouch.x * 500, y: p.y + aimedTouch.y * 500 };
    aimManual = Boolean(aimedTouch || pointer);
    const arena = arenaBounds();
    // Game.update equips before firing; assistance must use that same weapon
    // on the switch frame, including a slot followed by a Q/Tab cycle.
    let aimWeapon = p.weapons[actions.weaponSlot] ? actions.weaponSlot : game.pendingWeaponId || p.currentWeapon;
    if (actions.weaponNext && !game.previousInput.weaponNext) {
      const owned = weaponIds.filter(id => p.weapons[id]);
      aimWeapon = owned[(owned.indexOf(aimWeapon) + 1) % owned.length];
    }
    const assisted = aimAssist && touchFire && !aimManual ? findAimTarget(game, facing, { x: arena.camera.x, y: arena.camera.y, w: arena.w / arena.scale, h: arena.h / arena.scale }, game.aimTarget?.id, aimWeapon) : null;
    game.aimTarget = assisted ? { id: assisted.id, x: assisted.x, y: assisted.y } : null;
    if (assisted) target = { x: assisted.x, y: assisted.y };
    const input = { moveX, moveY, aimX: target.x, aimY: target.y, shoot: fire, ...actions };
    actions = {}; return input;
  }
  function buttonAt(point) {
    return [...buttons].reverse().find(b => b.r
      ? Math.hypot(point.x - b.cx, point.y - b.cy) <= b.r
      : point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h);
  }
  function activate(point) {
    const button = buttonAt(point);
    if (button) {
      pressFeedback = { label: button.label, x: button.x, y: button.y, w: button.w, h: button.h, screen, view: coop.view, until: clock + .14 };
      button.callback(); return true;
    } return false;
  }
  function handlePointer(type, point) {
    const p = logical(point);
    if (type === 'up' || type === 'cancel') {
      if (grenadePointer && type === 'up') releaseGrenade(grenadePointer, p);
      grenadePointer = null; shooting = false; return;
    }
    if (grenadePointer && type === 'move') { grenadeDrag(grenadePointer, p); return; }
    if (type === 'down' && point.button === 0) {
      audio?.unlock();
      if (buttonAt(p)?.role === 'grenade' && game && !paused && !help && game.status === 'playing') {
        if (game.player.grenades > 0) grenadePointer = { ...p, base: { ...p }, dragged: false };
        shooting = false; pointer = null; return;
      }
      if (buttonAt(p)?.role === 'fire' && game && !paused && !help && game.status === 'playing') { shooting = true; return; }
      if (activate(p)) return;
      if (game && !paused && !help && game.status === 'playing') shooting = true;
    }
    pointer = p;
  }
  function handleKey(type, key) {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (type === 'up') { keys.delete(k); return; }
    audio?.unlock();
    if (screen === 'coop') {
      if (k === 'Escape') { if (coop.view === 'join') coop.view = 'select'; else menu(); }
      else if (coop.view === 'join') {
        if (/^\d$/.test(k) && coop.code.length < 6) coop.code += k;
        if (k === 'Backspace') coop.code = coop.code.slice(0, -1);
        if (k === 'Enter') connectCoop(true);
      }
      return;
    }
    if (k === 'Escape' || k === 'p') { if (help) { help = false; clearInput(); } else togglePause(); return; }
    if (screen === 'menu') { if (k === 'Enter' && !help) start(); return; }
    if (paused || help || !game || ['dead', 'won'].includes(game.status)) return;
    if (k === 'r') { if (!keys.has(k)) activateBoost(); keys.add(k); return; }
    keys.add(k);
    if (k === 'g') actions.grenade = true;
    if (k === 'q' || k === 'Tab') actions.weaponNext = true;
    if (/^[1-6]$/.test(k)) actions.weaponSlot = weaponIds[Number(k) - 1];
  }
  function handleTouch(type, changedTouches) {
    for (const touch of changedTouches) {
      const p = logical(touch);
      if (type === 'end' || type === 'cancel') {
        const activeTouch = touches.get(touch.id);
        if (activeTouch?.role === 'grenade' && type === 'end') releaseGrenade(activeTouch, p);
        touches.delete(touch.id); continue;
      }
      if (type === 'start') {
        audio?.unlock();
        pointer = null;
        const playing = screen === 'game' && !paused && !help && game && !['dead', 'won'].includes(game.status);
        if (playing && buttonAt(p)?.role === 'grenade') {
          if (game.player.grenades > 0 && ![...touches.values()].some(t => t.role === 'grenade')) touches.set(touch.id, { ...p, base: { ...p }, role: 'grenade', dragged: false });
          continue;
        }
        if (playing && buttonAt(p)?.role === 'fire') {
          if (![...touches.values()].some(t => t.role === 'fire')) touches.set(touch.id, { ...p, base: { ...p }, role: 'fire' });
          continue;
        }
        if (activate(p) || !playing || p.x >= layout.w / 2) continue;
        if ([...touches.values()].some(t => t.role === 'move')) continue;
        touches.set(touch.id, { ...p, base: { ...p }, role: 'move' });
      } else if (touches.has(touch.id)) {
        const activeTouch = touches.get(touch.id);
        if (activeTouch.role === 'grenade') grenadeDrag(activeTouch, p); else Object.assign(activeTouch, p);
      }
    }
  }
  function saveLocalBest() {
    if (!game) return;
    if (!game.online && !resultSaved && game.status === 'dead') {
      resultSaved = true; best = { wave: Math.max(best.wave, game.wave), score: Math.max(best.score, game.score) };
      try { storage?.setItem('shellbound.best.v1', JSON.stringify(best)); } catch { /* Continue without persistence. */ }
      clearInput();
    }
  }
  function frame(timestamp) {
    const elapsed = lastTimestamp === null ? 0 : Math.max(0, (timestamp - lastTimestamp) / 1000);
    const dt = clamp(elapsed, 0, .05); lastTimestamp = timestamp;
    if (elapsed > 0) {
      frameStats.elapsed += elapsed; frameStats.frames++;
      if (frameStats.elapsed >= 1) {
        frameStats.fps = Math.round(frameStats.frames / frameStats.elapsed * 10) / 10;
        frameStats.frameMs = Math.round(frameStats.elapsed / frameStats.frames * 10000) / 10;
        frameStats.elapsed = 0; frameStats.frames = 0;
      }
    }
    clock += dt;
    if (game && !paused && !help && !isPortrait() && !(game.online && backgrounded)) {
      game.update(game.online ? dt : elapsed, collectInput()); saveLocalBest();
      audio?.playEvents(game.events);
      for (const event of game.events || []) {
        if (event.type === 'unlock') { toast = `${WEAPONS[event.weaponId]?.label || '新武器'}已解锁 · 点切枪装备`; toastUntil = clock + 3; }
      }
    }
    ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size.width, size.height);
    buttons = [];
    if (isPortrait()) { if (game?.online && !paused) pause(false); audio?.pause(); drawPortrait(); clearInput(); return; }
    ctx.translate(layout.ox, layout.oy); ctx.scale(layout.scale, layout.scale);
    if (screen === 'menu') drawMenu(); else if (screen === 'coop') drawCoop(); else drawGame();
    if (help) drawHelp();
    if (screen !== 'game' && toastUntil > clock && !help) {
      rounded(layout.w / 2 - 265, layout.h - 48, 530, 35, 15, '#101e25ee', C.line);
      text(toast, layout.w / 2, layout.h - 30, 20, C.ink, 700, 'center');
    }
  }
  function getSnapshot() {
    const rendered = game?.getRenderView?.();
    return { performance: { fps: frameStats.fps, frameMs: frameStats.frameMs, network: network?.getMetrics?.() || null }, renderPlayer: rendered ? { id: rendered.player.id, x: rendered.player.x, y: rendered.player.y, angle: rendered.player.angle } : null, grenadeAim: grenadeAim(), screen, paused, help, weaponPicker, selectedMap, selectedDifficulty, best, coop: { ...coop, room: coop.room ? { ...coop.room } : null }, settings: { muted, aimAssist, difficultyId: selectedDifficulty }, audio: audio?.getSnapshot() || null, aim: { facing, manual: aimManual, targetId: game?.aimTarget?.id ?? null }, layout: { ...layout }, controls: controlBounds(), pauseControl: pauseBounds(), arena: game ? arenaBounds() : null, buttons: buttons.map(({ x, y, w, h, label, r, cx, cy, role }) => ({ x, y, w, h, label, r, cx, cy, role })), game: game ? { online: game.online === true, players: (game.players || []).map(player => ({ id: player.id, x: player.x, y: player.y, hp: player.hp, currentWeapon: player.currentWeapon })), status: game.status, teamStatus: game.teamStatus, wave: game.wave, intermissionRemaining: game.intermissionRemaining, score: game.score, revivesRemaining: game.revivesRemaining, time: game.time, kills: game.kills, mapId: game.map.id, difficultyId: game.difficulty.id, environment: game.environmentSnapshot?.() || null, enemyCount: game.enemies.length, bulletCount: game.bullets.length, enemyBulletCount: game.bullets.filter(b => b.owner === 'enemy').length, bosses: game.enemies.filter(e => e.type === 'tank').map(e => ({ hp: e.hp, maxHp: e.maxHp, rangedCharge: e.rangedCharge, rangedCooldown: e.rangedCooldown })), grenadeCount: game.grenades.length, player: { x: game.player.x, y: game.player.y, angle: game.player.angle, reviveProtectionRemaining: game.player.reviveProtectionRemaining, hp: game.player.hp, shield: game.player.shield, grenades: game.player.grenades, boostCharges: game.player.boostCharges, boostRemaining: game.player.boostRemaining, currentWeapon: game.player.currentWeapon, weapons: JSON.parse(JSON.stringify(game.player.weapons)) } } : null };
  }
  resize({ width, height, pixelRatio });
  return { frame, resize, handleTouch, handleKey, handlePointer, pause, resume, getSnapshot };
}
