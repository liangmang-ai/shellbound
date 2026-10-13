import { Game, MAPS, WEAPONS, WEAPON_ORDER, GRENADE_RULES } from './game.js';
import { drawArena, drawEgg } from './render.js';
import { findAimTarget } from './aim.js';

const C = { bg: '#101e25', panel: '#1b2c33', line: '#31434a', ink: '#f4f1e5', muted: '#91a5aa', lime: '#c7ed83', teal: '#8dd4c2', coral: '#f6a38d' };
const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const weaponIds = WEAPON_ORDER;
const mapLabels = { courtyard: ['薄荷庭院', '开阔中央 · 灵活绕行', 'MINT COURTYARD'], greenhouse: ['汽泡工坊', '爆破油桶 · 加速穿行', 'BUBBLE WORKSHOP'] };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createApp({ canvas, width, height, pixelRatio = 1, storage, platform = 'web', audio }) {
  const ctx = canvas.getContext('2d');
  let size = { width, height, pixelRatio }, layout, game = null, screen = 'menu', selectedMap = MAPS[0].id;
  let paused = false, help = false, weaponPicker = false, lastTimestamp = null, clock = 0, pointer = null, shooting = false;
  let buttons = [], touches = new Map(), keys = new Set(), actions = {}, toast = '', toastUntil = 0, resultSaved = false;
  let grenadePointer = null;
  let best = { wave: 0, score: 0 };
  let muted = false, aimAssist = true, facing = -Math.PI / 2, aimManual = false;
  try { best = { ...best, ...JSON.parse(storage?.getItem('shellbound.best.v1') || '{}') }; } catch { /* A save is optional. */ }
  try { const settings = JSON.parse(storage?.getItem('shellbound.settings.v1') || '{}'); muted = settings.muted === true; aimAssist = settings.aimAssist !== false; } catch { /* Defaults work without storage. */ }
  audio?.setMuted(muted);
  function saveSettings() { try { storage?.setItem('shellbound.settings.v1', JSON.stringify({ muted, aimAssist })); } catch { /* Settings are optional. */ } }
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
    buttons = [];
    clearInput();
  }
  function logical(point) { return { x: (point.x - layout.ox) / layout.scale, y: (point.y - layout.oy) / layout.scale }; }
  function arenaBounds() {
    const area = { x: 0, y: 0, w: layout.w, h: layout.h };
    if (!game) return area;
    const scale = Math.max(area.w / game.map.width, area.h / game.map.height, layout.compact ? 1.35 : 1.12);
    const camera = {
      x: clamp(game.player.x - area.w / scale / 2, 0, Math.max(0, game.map.width - area.w / scale)),
      y: clamp(game.player.y - area.h / scale / 2, 0, Math.max(0, game.map.height - area.h / scale)),
    };
    return { ...area, scale, camera };
  }
  function world(point) { const arena = arenaBounds(); return { x: arena.camera.x + (point.x - arena.x) / arena.scale, y: arena.camera.y + (point.y - arena.y) / arena.scale }; }
  function controlBounds() {
    return {
      move: { x: 124, y: layout.h - 115, r: 62 },
      fire: { x: layout.w - 116, y: layout.h - 112, r: 64 },
      reload: { x: layout.w - 260, y: layout.h - 78, r: 39 },
      grenade: { x: layout.w - 223, y: layout.h - 215, r: 39 },
      weapon: { x: layout.w - 332, y: layout.h - 215, r: 36 },
    };
  }
  // Use a physical-pixel threshold so a small thumb wobble does not switch
  // from assisted fire to manual aim on a small landscape screen.
  function fireDragThreshold() { return Math.max(12, 14 / layout.scale); }
  function clearInput() { keys.clear(); touches.clear(); pointer = null; grenadePointer = null; shooting = false; actions = {}; weaponPicker = false; aimManual = false; if (game) game.aimTarget = null; }
  function cycleWeapon() {
    const owned = weaponIds.filter(id => game.player.weapons[id]);
    if (owned.length < 2) { toast = '清关或捡武器箱解锁新枪'; toastUntil = clock + 2; return; }
    const current = actions.weaponSlot || game.player.currentWeapon;
    actions.weaponSlot = owned[(owned.indexOf(current) + 1) % owned.length];
    weaponPicker = false;
  }
  function revive() {
    if (!game.revive()) return;
    resultSaved = false; paused = false; help = false; clearInput(); lastTimestamp = null;
    facing = game.player.angle;
    audio?.unlock(); audio?.playEvents([{ type: 'revive' }]);
    toast = '复活成功 · 3 秒保护 · 本局复活已用完'; toastUntil = clock + 3;
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
    game = new Game({ mapId: selectedMap, seed: Date.now() >>> 0 });
    facing = game.player.angle; audio?.pause(); audio?.unlock(); audio?.playEvents(game.events);
    screen = 'game'; paused = false; help = false; resultSaved = false; lastTimestamp = null;
    resize(size); toast = selectedMap === 'greenhouse' ? '打爆油桶清怪 · 踩箭头加速带' : aimAssist ? '移动转向 · 开火辅助瞄准 · 拖动手动瞄准' : '移动转向 · 按住开火 · 拖动手动瞄准'; toastUntil = clock + 3;
  }
  function menu() { audio?.pause(); screen = 'menu'; game = null; paused = false; help = false; resize(size); }
  function pause() { audio?.pause(); if (game && !['won', 'dead'].includes(game.status)) paused = true; clearInput(); lastTimestamp = null; }
  function resume() { clearInput(); lastTimestamp = null; }
  function togglePause() { if (game && !['won', 'dead'].includes(game.status)) { paused = !paused; if (paused) audio?.pause(); help = false; clearInput(); lastTimestamp = null; } }

  function rounded(x, y, w, h, radius = 14, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + w - radius, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius); ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function text(value, x, y, fontSize = 18, color = C.ink, weight = 500, align = 'left') {
    ctx.font = `${weight} ${fontSize}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(String(value), x, y);
  }
  function button(x, y, w, h, label, callback, { fill = C.panel, color = C.ink, border = C.line, fontSize = 19, active = true } = {}) {
    rounded(x, y, w, h, 12, fill, border); text(label, x + w / 2, y + h / 2, fontSize, color, 650, 'center');
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
    } else if (role === 'reload') {
      ctx.beginPath(); ctx.arc(x, cy, 13, -.7, Math.PI * 1.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 9, cy - 15); ctx.lineTo(x + 18, cy - 12); ctx.lineTo(x + 11, cy - 5); ctx.stroke();
    } else if (role === 'weapon') {
      ctx.beginPath(); ctx.moveTo(x - 16, cy - 7); ctx.lineTo(x + 16, cy - 7); ctx.lineTo(x + 10, cy - 13); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 16, cy + 7); ctx.lineTo(x - 16, cy + 7); ctx.lineTo(x - 10, cy + 13); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(x, cy + 3, 10, 13, -.3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 5, cy - 9); ctx.lineTo(x + 2, cy - 15); ctx.lineTo(x + 12, cy - 10); ctx.stroke();
    }
    text(role === 'grenade' ? `${label} ${value}` : label, x, y + (role === 'fire' ? 31 : 20), role === 'fire' ? 18 : 13, color, 750, 'center');
    if (progress > 0) { ctx.beginPath(); ctx.arc(x, y, r - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); ctx.strokeStyle = C.lime; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.restore();
    buttons.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, cx: x, cy: y, r, role, callback, label });
  }
  function line(x1, y1, x2, y2, color = C.line) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
  function mapPreview(map, x, y, w, h) {
    const greenhouse = map.id === 'greenhouse';
    rounded(x, y, w, h, 12, greenhouse ? '#65859a' : '#668f84');
    ctx.save(); ctx.translate(x + 8, y + 8); ctx.scale((w - 16) / map.width, (h - 16) / map.height);
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 2;
    for (let i = 0; i < map.width; i += 100) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, map.height); ctx.stroke(); }
    for (let i = 0; i < map.height; i += 100) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(map.width, i); ctx.stroke(); }
    for (const zone of map.speedZones || []) { ctx.fillStyle = '#65e4d2'; ctx.fillRect(zone.x, zone.y, zone.w, zone.h); }
    for (const obstacle of map.obstacles) { ctx.fillStyle = greenhouse ? '#d4b56b' : '#c1d4af'; ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h); }
    for (const station of map.barrelStations || []) { ctx.fillStyle = '#ff9c65'; ctx.beginPath(); ctx.arc(station.x, station.y, 23, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#f6f0cf'; ctx.beginPath(); ctx.arc(map.width / 2, map.height / 2, 30, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawLogo(x, y, small = false) {
    drawEgg(ctx, x + 20, y + 21, { scale: .72, angle: -.25, color: '#f4edce', time: clock * 1000 });
    text('蛋壳突围', x + 53, y + 13, small ? 19 : 24, C.ink, 800);
    text('S H E L L B O U N D', x + 54, y + 37, 10, C.muted, 650);
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
    button(w - 268, 30, 90, 40, muted ? '音效：关' : '音效：开', toggleSound, { fontSize: 14 });
    button(w - 166, 30, 126, 40, '操作指南', () => { audio?.pause(); help = true; }, { fontSize: 15 });
    if (!compact) {
      text('O P E R A T I O N   /   0 1', 64, 141, 12, C.teal, 700);
      text('守住最后', 60, 223, 76, C.ink, 800);
      text('一颗蛋。', 60, 311, 76, C.lime, 800);
      text('握紧武器，穿过包围。', 65, 397, 20, C.muted);
      text('选一张地图，迎接十波攻势。', 65, 430, 20, C.muted);
      drawPoster(311, 589, 1.24);
      text('6 种枪械', 64, 740, 15, C.ink, 650);
      text('盾牌防御', 195, 740, 15, C.ink, 650);
      text('手雷清场', 325, 740, 15, C.ink, 650);
      text('选择战区', 713, 143, 27, C.ink, 750);
      text('每张地图，都是一种新的走位。', 713, 178, 15, C.muted);
    } else {
      text('守住最后', 37, 132, 49, C.ink, 800); text('一颗蛋。', 37, 191, 49, C.lime, 800);
      text('原创角色 / 十波攻势 / 六种枪械', 40, 251, 16, C.muted);
      drawPoster(229, 375, .84);
      text('盾牌挡伤害 · 手雷破包围', 40, h - 32, 16, C.teal, 650);
    }
    const x = compact ? 500 : 710, top = compact ? 100 : 215, cardW = compact ? 420 : 500, cardH = compact ? 123 : 183, gap = compact ? 14 : 18;
    MAPS.forEach((map, i) => {
      const y = top + i * (cardH + gap), selected = selectedMap === map.id, label = mapLabels[map.id] || [map.name || map.id, '', ''];
      rounded(x, y, cardW, cardH, 18, selected ? '#243b38' : C.panel, selected ? C.lime : C.line);
      const mw = compact ? 135 : 159, mh = compact ? 89 : 135;
      mapPreview(map, x + 17, y + 17, mw, mh);
      const tx = x + mw + 37;
      text(`0${i + 1}  /  ${label[2]}`, tx, y + (compact ? 27 : 42), 10, selected ? C.lime : C.muted, 700);
      text(label[0], tx, y + (compact ? 56 : 80), compact ? 25 : 29, C.ink, 750);
      text(label[1], tx, y + (compact ? 87 : 117), compact ? 13 : 15, C.muted);
      if (!compact) text(selected ? '●  已选择' : '○  点击选择', tx, y + 149, 13, selected ? C.lime : C.muted, 650);
      buttons.push({ x, y, w: cardW, h: cardH, callback: () => { selectedMap = map.id; }, label: label[0] });
    });
    const startY = top + (cardH + gap) * 2 + (compact ? 7 : 16);
    button(x, startY, cardW, compact ? 58 : 64, '开始突围     →', start, { fill: C.lime, color: C.bg, border: C.lime, fontSize: compact ? 22 : 23 });
    text(best.score ? `最佳战绩  ${best.score} 分 · 第 ${best.wave} 波` : '手枪开局 · 拾取补给 · 清关推进', x + cardW / 2, startY + (compact ? 81 : 94), 14, C.muted, 500, 'center');
  }
  function bar(x, y, w, value, max, color) { rounded(x, y, w, 7, 3, '#34464a'); if (value > 0) rounded(x, y, Math.max(6, w * clamp(value / max, 0, 1)), 7, 3, color); }
  function drawHUD() {
    const { w } = layout, p = game.player, ammo = p.weapons[p.currentWeapon];
    rounded(24, 18, 290, 112, 16, 'rgba(16,30,37,.84)', 'rgba(244,241,229,.2)');
    text(`生命 ${Math.ceil(p.hp)}`, 40, 34, 13, C.ink, 700); bar(40, 47, 115, p.hp, p.maxHp, C.coral);
    text(`盾牌 ${Math.ceil(p.shield)}`, 179, 34, 13, C.teal, 700); bar(179, 47, 115, p.shield, p.maxShield, C.teal);
    text(WEAPONS[p.currentWeapon].label, 40, 77, 20, C.ink, 800);
    text(ammo.clip, 293, 74, 27, C.lime, 800, 'right');
    text(`备用 ${p.currentWeapon === 'pistol' ? '∞' : ammo.reserve}`, 293, 96, 12, C.muted, 600, 'right');
    text(weaponPicker ? '点击收起  ▴' : '点击换枪  ▾', 40, 112, 12, C.teal, 650);
    text(p.speedMultiplier > 1 ? '加速 ×1.45' : aimManual ? '手动瞄准' : aimAssist ? '辅助瞄准' : '移动瞄准', 293, 114, 12, p.speedMultiplier > 1 ? C.lime : C.teal, 650, 'right');
    buttons.push({ x: 24, y: 61, w: 290, h: 65, callback: () => { weaponPicker = !weaponPicker; }, label: '切换武器' });
    if (weaponPicker) {
      rounded(24, 142, 290, 186, 14, 'rgba(16,30,37,.94)', C.line);
      text('武器库', 38, 162, 16, C.ink, 750);
      button(242, 150, 59, 25, '收起', () => { weaponPicker = false; }, { fontSize: 12, border: C.panel });
      const labels = ['手枪', '冲锋枪', '步枪', '机枪', '大狙', '霰弹枪'];
      weaponIds.forEach((id, i) => {
        const owned = p.weapons[id], selected = p.currentWeapon === id, x = 36 + i % 3 * 91, y = 182 + Math.floor(i / 3) * 70;
        rounded(x, y, 82, 64, 9, selected ? '#445b38' : C.panel, selected ? C.lime : C.line);
        text(labels[i], x + 41, y + 22, 19, owned ? C.ink : '#839397', 750, 'center');
        text(owned ? `${owned.clip} / ${id === 'pistol' ? '∞' : owned.reserve}` : '未解锁', x + 41, y + 46, 13, selected ? C.lime : C.muted, 600, 'center');
        buttons.push({ x, y, w: 82, h: 64, callback: () => { if (owned) { actions.weaponSlot = id; weaponPicker = false; } else { toast = '清关或拾取武器箱，解锁更多枪械'; toastUntil = clock + 2; } }, label: WEAPONS[id].label });
      });
    }
    rounded(w / 2 - 110, 20, 220, 54, 13, 'rgba(16,30,37,.76)');
    text(`第 ${game.wave} / 10 波`, w / 2, 39, 21, C.lime, 800, 'center');
    text(`剩余 ${game.waveTotal - game.waveKills}   ·   ${game.score} 分`, w / 2, 61, 13, C.ink, 650, 'center');
    button(w - (platform === 'wechat' ? 263 : 98), 24, 74, 39, 'Ⅱ 暂停', togglePause, { fill: 'rgba(16,30,37,.8)', fontSize: 14 });
    skillButton('fire', '开火', () => {}, { color: C.lime, disabled: ammo.reloadRemaining > 0 });
    skillButton('reload', '换弹', () => { actions.reload = true; }, { color: C.teal, progress: ammo.reloadRemaining > 0 ? 1 - ammo.reloadRemaining / WEAPONS[p.currentWeapon].reloadTime : 0 });
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
    if (!touch) text('移动 / 转向', base.x, base.y + r + 22, 14, C.ink, 650, 'center');
  }
  function drawGame() {
    const arena = arenaBounds();
    const aimingGrenade = grenadeAim();
    drawArena(ctx, game, { time: clock * 1000, ...arena, grenadeAim: aimingGrenade });
    drawHUD();
    if (aimingGrenade) {
      rounded(layout.w / 2 - 175, layout.h - 107, 350, 32, 16, 'rgba(16,30,37,.88)');
      text('松手投掷 · 拖回手雷按钮取消', layout.w / 2, layout.h - 91, 14, '#f5cc92', 650, 'center');
    }
    const bosses = game.enemies.filter(enemy => enemy.type === 'tank' && enemy.hp > 0);
    const boss = bosses.find(enemy => enemy.rangedCharge > 0) || bosses[0];
    if (boss) {
      const bw = 330, bx = (layout.w - bw) / 2, by = 89;
      rounded(bx, by, bw, 45, 12, 'rgba(16,30,37,.88)', '#aa8fbb');
      text(boss.rangedCharge > 0 ? `BOSS ×${bosses.length} · 预警！侧移躲避` : `重甲 BOSS ×${bosses.length} · 留意远程预警`, layout.w / 2, by + 14, 13, boss.rangedCharge > 0 ? C.coral : '#d3b9ed', 750, 'center');
      bar(bx + 15, by + 30, bw - 30, bosses.reduce((sum, enemy) => sum + enemy.hp, 0), bosses.reduce((sum, enemy) => sum + enemy.maxHp, 0), '#cba3eb');
    }
    if (platform === 'wechat' || touches.size || layout.compact) drawStick();
    if (pointer && !paused && !help && screen === 'game') {
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 10, 0, Math.PI * 2); ctx.strokeStyle = C.lime; ctx.lineWidth = 1.5; ctx.stroke();
      line(pointer.x - 16, pointer.y, pointer.x - 7, pointer.y, C.lime); line(pointer.x + 7, pointer.y, pointer.x + 16, pointer.y, C.lime);
      line(pointer.x, pointer.y - 16, pointer.x, pointer.y - 7, C.lime); line(pointer.x, pointer.y + 7, pointer.x, pointer.y + 16, C.lime);
    }
    if (toastUntil > clock && !paused && !help && game.status === 'playing' && !boss) {
      const tw = Math.min(440, toast.length * 16 + 44), controls = controlBounds();
      const tx = clamp(layout.w / 2, controls.move.x + controls.move.r + 16 + tw / 2, controls.reload.x - controls.reload.r - 16 - tw / 2);
      rounded(tx - tw / 2, layout.h - 52, tw, 34, 17, 'rgba(16,30,37,.86)');
      text(toast, tx, layout.h - 35, 14, C.ink, 600, 'center');
    }
    if (paused && !help) drawPause();
    if (['dead', 'won'].includes(game.status)) drawResult();
  }
  function shade() { ctx.fillStyle = 'rgba(8,17,21,.79)'; ctx.fillRect(0, 0, layout.w, layout.h); buttons = []; }
  function drawPause() {
    shade(); const x = layout.w / 2 - 220, y = layout.h / 2 - 178;
    rounded(x, y, 440, 356, 22, C.panel, C.line);
    text('喘口气，再出发。', layout.w / 2, y + 49, 31, C.ink, 750, 'center');
    text('暂停期间，战场和倒计时都会停止。', layout.w / 2, y + 88, 15, C.muted, 500, 'center');
    button(x + 28, y + 123, 384, 48, '继续突围', () => { paused = false; lastTimestamp = null; clearInput(); }, { fill: C.lime, border: C.lime, color: C.bg });
    button(x + 28, y + 184, 184, 47, '重新开始', start, { fontSize: 17 }); button(x + 228, y + 184, 184, 47, '返回战区', menu, { fontSize: 17 });
    button(x + 28, y + 245, 184, 47, muted ? '音效：关' : '音效：开', toggleSound, { fontSize: 16 });
    button(x + 228, y + 245, 184, 47, aimAssist ? '辅助瞄准：开' : '辅助瞄准：关', toggleAim, { fontSize: 16 });
    text('Esc / P 继续', layout.w / 2, y + 326, 12, C.muted, 500, 'center');
  }
  function drawResult() {
    shade(); const won = game.status === 'won', boxH = won ? 354 : 418, x = layout.w / 2 - 248, y = layout.h / 2 - boxH / 2;
    rounded(x, y, 496, boxH, 22, C.panel, won ? C.lime : C.line);
    text(won ? '包围圈，突破了！' : '蛋壳裂了，勇气还在。', layout.w / 2, y + 48, 29, won ? C.lime : C.ink, 800, 'center');
    text(won ? '十波攻势全部完成' : '调整走位，再试一次', layout.w / 2, y + 86, 16, C.muted, 500, 'center');
    text(String(game.score), layout.w / 2, y + 143, 51, C.ink, 800, 'center'); text('本局得分', layout.w / 2, y + 181, 13, C.muted, 600, 'center');
    text(`第 ${game.wave} 波   /   ${game.kills} 次击败   /   ${Math.floor(game.time)} 秒`, layout.w / 2, y + 213, 16, C.teal, 600, 'center');
    if (!won) button(x + 28, y + 251, 440, 48, game.revivesRemaining ? '免费复活 · 本局 1 次' : '本局复活已用完', revive, { fill: game.revivesRemaining ? C.lime : C.panel, border: game.revivesRemaining ? C.lime : C.line, color: game.revivesRemaining ? C.bg : C.muted, active: game.revivesRemaining > 0 });
    button(x + 28, y + (won ? 251 : 312), 440, 48, '再来一局   →', start, { fill: won ? C.lime : C.panel, border: won ? C.lime : C.line, color: won ? C.bg : C.ink });
    button(x + 150, y + (won ? 312 : 373), 196, 28, '返回地图选择', menu, { fill: C.panel, border: C.panel, color: C.muted, fontSize: 14 });
  }
  function drawHelp() {
    shade(); const boxW = 650, boxH = layout.compact ? 426 : 490, x = (layout.w - boxW) / 2, y = (layout.h - boxH) / 2;
    rounded(x, y, boxW, boxH, 22, C.panel, C.line); text('突围指南', x + 30, y + 39, 29, C.ink, 750);
    const rows = [
      ['移动与射击', '电脑：WASD / 方向键移动，鼠标瞄准，左键射击'],
      ['手机操作', '移动转向；按住开火辅助瞄准，拖动开火钮手动瞄准'],
      ['武器管理', '右侧切枪钮顺序换枪；左上角武器库可直接选择'],
      ['盾牌与手雷', '手雷按钮拖到目标松手投掷，拖回按钮取消；G 快投'],
      ['补给与闯关', '捡新枪解锁，重复枪补弹；每波清关都有补给'],
      ['工坊机关', '油桶也伤自己，小心距离；踩箭头带加速，离开恢复'],
    ];
    rows.forEach(([title, detail], i) => { const ry = y + 88 + i * (layout.compact ? 44 : 51); text(title, x + 30, ry, 16, C.teal, 700); text(detail, x + 30, ry + 23, 14, C.ink); });
    button(x + 30, y + boxH - 68, boxW - 60, 44, '准备好了', () => { help = false; clearInput(); lastTimestamp = null; }, { fill: C.lime, border: C.lime, color: C.bg, fontSize: 17 });
  }
  function drawPortrait() {
    buttons = []; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size.width, size.height);
    text('↻', size.width / 2, size.height / 2 - 75, 66, C.lime, 500, 'center');
    text('横屏，才能放开手脚。', size.width / 2, size.height / 2, 23, C.ink, 750, 'center');
    text('请旋转手机后继续突围', size.width / 2, size.height / 2 + 42, 15, C.muted, 500, 'center');
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
    let aimWeapon = p.weapons[actions.weaponSlot] ? actions.weaponSlot : p.currentWeapon;
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
    if (button) { button.callback(); return true; } return false;
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
    if (k === 'Escape' || k === 'p') { if (help) { help = false; clearInput(); } else togglePause(); return; }
    if (screen === 'menu') { if (k === 'Enter' && !help) start(); return; }
    if (paused || help || !game || ['dead', 'won'].includes(game.status)) return;
    keys.add(k);
    if (k === 'r') actions.reload = true;
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
  function saveResult() {
    if (!game || resultSaved || !['won', 'dead'].includes(game.status)) return;
    resultSaved = true; best = { wave: Math.max(best.wave, game.wave), score: Math.max(best.score, game.score) };
    try { storage?.setItem('shellbound.best.v1', JSON.stringify(best)); } catch { /* Continue without persistence. */ }
    clearInput();
  }
  function frame(timestamp) {
    const dt = lastTimestamp === null ? 0 : clamp((timestamp - lastTimestamp) / 1000, 0, .05); lastTimestamp = timestamp;
    clock += dt;
    if (game && !paused && !help && !isPortrait()) {
      game.update(dt, collectInput()); saveResult();
      audio?.playEvents(game.events);
      for (const event of game.events || []) {
        if (event.type === 'unlock') { toast = `${WEAPONS[event.weaponId]?.label || '新武器'}已解锁，点击武器卡装备`; toastUntil = clock + 3; }
      }
    }
    ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size.width, size.height);
    buttons = [];
    if (isPortrait()) { audio?.pause(); drawPortrait(); clearInput(); return; }
    ctx.translate(layout.ox, layout.oy); ctx.scale(layout.scale, layout.scale);
    if (screen === 'menu') drawMenu(); else drawGame();
    if (help) drawHelp();
  }
  function getSnapshot() {
    return { grenadeAim: grenadeAim(), screen, paused, help, weaponPicker, selectedMap, best, settings: { muted, aimAssist }, audio: audio?.getSnapshot() || null, aim: { facing, manual: aimManual, targetId: game?.aimTarget?.id ?? null }, layout: { ...layout }, controls: controlBounds(), arena: game ? arenaBounds() : null, buttons: buttons.map(({ x, y, w, h, label, r, cx, cy, role }) => ({ x, y, w, h, label, r, cx, cy, role })), game: game ? { status: game.status, wave: game.wave, score: game.score, revivesRemaining: game.revivesRemaining, time: game.time, kills: game.kills, mapId: game.map.id, environment: game.environmentSnapshot?.() || null, enemyCount: game.enemies.length, bulletCount: game.bullets.length, enemyBulletCount: game.bullets.filter(b => b.owner === 'enemy').length, bosses: game.enemies.filter(e => e.type === 'tank').map(e => ({ hp: e.hp, maxHp: e.maxHp, rangedCharge: e.rangedCharge, rangedCooldown: e.rangedCooldown })), grenadeCount: game.grenades.length, player: { x: game.player.x, y: game.player.y, angle: game.player.angle, reviveProtectionRemaining: game.player.reviveProtectionRemaining, hp: game.player.hp, shield: game.player.shield, grenades: game.player.grenades, currentWeapon: game.player.currentWeapon, weapons: JSON.parse(JSON.stringify(game.player.weapons)) } } : null };
  }
  resize({ width, height, pixelRatio });
  return { frame, resize, handleTouch, handleKey, handlePointer, pause, resume, getSnapshot };
}
