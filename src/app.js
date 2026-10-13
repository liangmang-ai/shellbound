import { Game, MAPS, WEAPONS, WEAPON_ORDER } from './game.js';
import { drawArena, drawEgg } from './render.js';

const C = { bg: '#101e25', panel: '#1b2c33', line: '#31434a', ink: '#f4f1e5', muted: '#91a5aa', lime: '#c7ed83', teal: '#8dd4c2', coral: '#f6a38d' };
const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const weaponIds = WEAPON_ORDER;
const mapLabels = { courtyard: ['薄荷庭院', '开阔中央 · 灵活绕行', 'MINT COURTYARD'], greenhouse: ['落日温室', '交错掩体 · 守住通道', 'SUNSET GREENHOUSE'] };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createApp({ canvas, width, height, pixelRatio = 1, storage, platform = 'web' }) {
  const ctx = canvas.getContext('2d');
  let size = { width, height, pixelRatio }, layout, game = null, screen = 'menu', selectedMap = MAPS[0].id;
  let paused = false, help = false, lastTimestamp = null, clock = 0, pointer = null, shooting = false;
  let buttons = [], touches = new Map(), keys = new Set(), actions = {}, toast = '', toastUntil = 0, resultSaved = false;
  let best = { wave: 0, score: 0 };
  try { best = { ...best, ...JSON.parse(storage?.getItem('shellbound.best.v1') || '{}') }; } catch { /* A save is optional. */ }

  function resize(next) {
    size = { ...size, ...next };
    size.pixelRatio = clamp(size.pixelRatio || 1, 1, 2);
    canvas.width = Math.round(size.width * size.pixelRatio);
    canvas.height = Math.round(size.height * size.pixelRatio);
    const compact = size.height < 620 || size.width < 1000;
    const w = compact ? 960 : 1280, h = compact ? 540 : 800;
    const scale = Math.min(size.width / w, size.height / h);
    layout = { w, h, compact, scale, ox: (size.width - w * scale) / 2, oy: (size.height - h * scale) / 2 };
    clearInput();
  }
  function logical(point) { return { x: (point.x - layout.ox) / layout.scale, y: (point.y - layout.oy) / layout.scale }; }
  function arenaBounds() {
    const area = { x: 32, y: layout.compact ? 78 : 100, w: layout.w - 64, h: layout.h - (layout.compact ? 164 : 230) };
    if (!game) return area;
    const scale = Math.min(area.w / game.map.width, area.h / game.map.height);
    return { x: area.x + (area.w - game.map.width * scale) / 2, y: area.y + (area.h - game.map.height * scale) / 2, w: game.map.width * scale, h: game.map.height * scale, scale };
  }
  function world(point) { const arena = arenaBounds(); return { x: (point.x - arena.x) / arena.scale, y: (point.y - arena.y) / arena.scale }; }
  function clearInput() { keys.clear(); touches.clear(); shooting = false; actions = {}; }
  function start() {
    game = new Game({ mapId: selectedMap, seed: Date.now() >>> 0 });
    screen = 'game'; paused = false; help = false; resultSaved = false; lastTimestamp = null;
    pointer = null; clearInput(); toast = '第一波来了，保持移动！'; toastUntil = clock + 3;
  }
  function menu() { screen = 'menu'; game = null; paused = false; help = false; clearInput(); }
  function pause() { if (game && !['won', 'dead'].includes(game.status)) paused = true; clearInput(); lastTimestamp = null; }
  function resume() { clearInput(); lastTimestamp = null; }
  function togglePause() { if (game && !['won', 'dead'].includes(game.status)) { paused = !paused; help = false; clearInput(); lastTimestamp = null; } }

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
  function line(x1, y1, x2, y2, color = C.line) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
  function mapPreview(map, x, y, w, h) {
    const greenhouse = map.id === 'greenhouse';
    rounded(x, y, w, h, 12, greenhouse ? '#9b7e66' : '#668f84');
    ctx.save(); ctx.translate(x + 8, y + 8); ctx.scale((w - 16) / map.width, (h - 16) / map.height);
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 2;
    for (let i = 0; i < map.width; i += 100) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, map.height); ctx.stroke(); }
    for (let i = 0; i < map.height; i += 100) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(map.width, i); ctx.stroke(); }
    for (const obstacle of map.obstacles) { ctx.fillStyle = greenhouse ? '#d6b294' : '#c1d4af'; ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h); }
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
    button(w - 166, 30, 126, 40, '操作指南', () => { help = true; }, { fontSize: 15 });
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
    const { w, h, compact } = layout, p = game.player;
    drawLogo(30, compact ? 14 : 24, true);
    const sx = compact ? 250 : 290, sy = compact ? 27 : 34;
    text(`生命  ${Math.ceil(p.hp)}`, sx, sy, 15, C.ink, 650); bar(sx, sy + 16, compact ? 104 : 135, p.hp, 100, C.coral);
    text(`盾牌  ${Math.ceil(p.shield)}`, sx + (compact ? 127 : 166), sy, 15, C.teal, 650); bar(sx + (compact ? 127 : 166), sy + 16, compact ? 104 : 135, p.shield, 100, C.teal);
    text(`第 ${String(game.wave).padStart(2, '0')} / 10 波`, w - (compact ? 355 : 400), sy + 2, compact ? 18 : 21, C.lime, 750);
    text(`${game.score} 分`, w - 175, sy + 2, 18, C.ink, 650, 'right');
    button(w - 143, compact ? 20 : 27, 110, 38, 'Ⅱ  暂停', togglePause, { fontSize: 15 });
    const bottom = h - (compact ? 74 : 112), margin = 33, weaponW = compact ? 96 : 132, weaponGap = compact ? 5 : 8;
    weaponIds.forEach((id, i) => {
      const owned = p.weapons[id], selected = p.currentWeapon === id, x = margin + i * (weaponW + weaponGap);
      rounded(x, bottom, weaponW, compact ? 56 : 65, 10, selected ? '#314538' : C.panel, selected ? C.lime : C.line);
      text(`${i + 1}  ${WEAPONS[id].label}`, x + 9, bottom + 17, compact ? 12 : 14, owned ? C.ink : '#637a80', 650);
      let label = '等待补给';
      if (owned) label = owned.reloadRemaining > 0 ? '换弹中…' : `${owned.clip} / ${id === 'pistol' ? '∞' : owned.reserve}`;
      text(label, x + 11, bottom + (compact ? 39 : 45), 13, selected ? C.lime : owned ? C.muted : '#637a80', 600);
      buttons.push({ x, y: bottom, w: weaponW, h: compact ? 56 : 65, callback: () => { if (owned) actions.weaponSlot = id; else { toast = '清关或拾取武器箱，可以解锁这把枪'; toastUntil = clock + 2; } }, label: WEAPONS[id].label });
    });
    const bx = w - (compact ? 309 : 381), bh = compact ? 56 : 65;
    button(bx, bottom, compact ? 101 : 112, bh, 'R  换弹', () => { actions.reload = true; }, { fontSize: 15 });
    button(bx + (compact ? 111 : 124), bottom, compact ? 165 : 224, bh, `G  手雷  ×${p.grenades}`, () => { actions.grenade = true; }, { fill: '#3b3930', border: '#70624b', color: '#efcc92', fontSize: compact ? 17 : 19 });
    if (!compact) { text('WASD 移动    鼠标瞄准 / 左键射击    1–6 换枪    Q 轮换', 34, h - 24, 12, C.muted); text('盾牌自动抵挡伤害', w - 36, h - 24, 12, C.teal, 500, 'right'); }
  }
  function drawStick(role, x, y) {
    const touch = [...touches.values()].find(t => t.role === role), base = touch?.base || { x, y }, r = 46;
    ctx.beginPath(); ctx.arc(base.x, base.y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(16,30,37,.34)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,241,229,.38)'; ctx.lineWidth = 1.5; ctx.stroke();
    let dx = touch ? touch.x - base.x : 0, dy = touch ? touch.y - base.y : 0;
    const dist = Math.hypot(dx, dy); if (dist > r) { dx *= r / dist; dy *= r / dist; }
    ctx.beginPath(); ctx.arc(base.x + dx, base.y + dy, 19, 0, Math.PI * 2); ctx.fillStyle = role === 'aim' ? 'rgba(199,237,131,.75)' : 'rgba(244,241,229,.65)'; ctx.fill();
    if (!touch) text(role === 'move' ? '移动' : '瞄准 / 开火', base.x, base.y + 67, 13, C.ink, 650, 'center');
  }
  function drawGame() {
    const arena = arenaBounds();
    rounded(arena.x - 7, arena.y - 7, arena.w + 14, arena.h + 14, 16, '#20353a', C.line);
    ctx.save(); ctx.translate(arena.x, arena.y); ctx.scale(arena.scale, arena.scale); drawArena(ctx, game, { time: clock * 1000 }); ctx.restore();
    drawHUD();
    const bosses = game.enemies.filter(enemy => enemy.type === 'tank' && enemy.hp > 0);
    const boss = bosses.find(enemy => enemy.rangedCharge > 0) || bosses[0];
    if (boss) {
      const bw = layout.compact ? 270 : 340, bx = (layout.w - bw) / 2, by = arena.y + 14;
      rounded(bx, by, bw, 45, 12, 'rgba(16,30,37,.88)', '#aa8fbb');
      text(boss.rangedCharge > 0 ? `BOSS ×${bosses.length} · 预警！侧移躲避` : `重甲 BOSS ×${bosses.length} · 留意远程预警`, layout.w / 2, by + 14, 13, boss.rangedCharge > 0 ? C.coral : '#d3b9ed', 750, 'center');
      bar(bx + 15, by + 30, bw - 30, bosses.reduce((sum, enemy) => sum + enemy.hp, 0), bosses.reduce((sum, enemy) => sum + enemy.maxHp, 0), '#cba3eb');
    }
    if (platform === 'wechat' || touches.size || layout.compact) { drawStick('move', 109, layout.h - 173); drawStick('aim', layout.w - 109, layout.h - 173); }
    if (pointer && !paused && !help && screen === 'game') {
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 10, 0, Math.PI * 2); ctx.strokeStyle = C.lime; ctx.lineWidth = 1.5; ctx.stroke();
      line(pointer.x - 16, pointer.y, pointer.x - 7, pointer.y, C.lime); line(pointer.x + 7, pointer.y, pointer.x + 16, pointer.y, C.lime);
      line(pointer.x, pointer.y - 16, pointer.x, pointer.y - 7, C.lime); line(pointer.x, pointer.y + 7, pointer.x, pointer.y + 16, C.lime);
    }
    if (toastUntil > clock && !paused && !help && game.status === 'playing' && !boss) {
      const tw = Math.min(490, toast.length * 16 + 44); rounded(layout.w / 2 - tw / 2, arena.y + 15, tw, 38, 19, 'rgba(16,30,37,.86)');
      text(toast, layout.w / 2, arena.y + 34, 15, C.ink, 600, 'center');
    }
    if (game.status === 'intermission' && !paused && !help) {
      const boxW = 440, boxH = 134, x = (layout.w - boxW) / 2, y = arena.y + arena.h / 2 - boxH / 2;
      rounded(x, y, boxW, boxH, 18, 'rgba(16,30,37,.93)', C.teal);
      text(`第 ${game.wave} 波清理完成`, layout.w / 2, y + 34, 26, C.lime, 750, 'center');
      text('补给已掉落，靠近拾取后准备下一波', layout.w / 2, y + 68, 17, C.ink, 500, 'center');
      text(`${Math.max(1, Math.ceil(game.intermissionRemaining))} 秒后继续`, layout.w / 2, y + 105, 16, C.muted, 600, 'center');
    }
    if (paused && !help) drawPause();
    if (['dead', 'won'].includes(game.status)) drawResult();
  }
  function shade() { ctx.fillStyle = 'rgba(8,17,21,.79)'; ctx.fillRect(0, 0, layout.w, layout.h); buttons = []; }
  function drawPause() {
    shade(); const x = layout.w / 2 - 220, y = layout.h / 2 - 145;
    rounded(x, y, 440, 290, 22, C.panel, C.line);
    text('喘口气，再出发。', layout.w / 2, y + 49, 31, C.ink, 750, 'center');
    text('暂停期间，战场和倒计时都会停止。', layout.w / 2, y + 88, 15, C.muted, 500, 'center');
    button(x + 28, y + 123, 384, 48, '继续突围', () => { paused = false; lastTimestamp = null; clearInput(); }, { fill: C.lime, border: C.lime, color: C.bg });
    button(x + 28, y + 184, 184, 47, '重新开始', start, { fontSize: 17 }); button(x + 228, y + 184, 184, 47, '返回战区', menu, { fontSize: 17 });
    text('Esc / P 继续', layout.w / 2, y + 261, 12, C.muted, 500, 'center');
  }
  function drawResult() {
    shade(); const won = game.status === 'won', x = layout.w / 2 - 248, y = layout.h / 2 - 177;
    rounded(x, y, 496, 354, 22, C.panel, won ? C.lime : C.line);
    text(won ? '包围圈，突破了！' : '蛋壳裂了，勇气还在。', layout.w / 2, y + 48, 29, won ? C.lime : C.ink, 800, 'center');
    text(won ? '十波攻势全部完成' : '调整走位，再试一次', layout.w / 2, y + 86, 16, C.muted, 500, 'center');
    text(String(game.score), layout.w / 2, y + 143, 51, C.ink, 800, 'center'); text('本局得分', layout.w / 2, y + 181, 13, C.muted, 600, 'center');
    text(`第 ${game.wave} 波   /   ${game.kills} 次击败   /   ${Math.floor(game.time)} 秒`, layout.w / 2, y + 213, 16, C.teal, 600, 'center');
    button(x + 28, y + 251, 440, 48, '再来一局   →', start, { fill: C.lime, border: C.lime, color: C.bg });
    button(x + 150, y + 312, 196, 28, '返回地图选择', menu, { fill: C.panel, border: C.panel, color: C.muted, fontSize: 14 });
  }
  function drawHelp() {
    shade(); const boxW = 650, boxH = layout.compact ? 426 : 490, x = (layout.w - boxW) / 2, y = (layout.h - boxH) / 2;
    rounded(x, y, boxW, boxH, 22, C.panel, C.line); text('突围指南', x + 30, y + 39, 29, C.ink, 750);
    const rows = [
      ['移动与射击', '电脑：WASD / 方向键移动，鼠标瞄准，左键射击'],
      ['手机操作', '左摇杆移动；拖动右摇杆，瞄准并持续开火'],
      ['武器管理', '1–6 换枪 / Q 轮换 / R 换弹，也可点击下方武器卡'],
      ['盾牌与手雷', '盾牌先吸收伤害；G 扔手雷，也可点击手雷按钮'],
      ['补给与闯关', '捡新枪解锁，重复枪补弹；每波清关都有补给'],
      ['最后的保障', '手枪备用弹药无限，但弹匣用完仍需换弹'],
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
    let target = pointer ? world(pointer) : { x: game.player.x + Math.cos(game.player.angle || 0) * 200, y: game.player.y + Math.sin(game.player.angle || 0) * 200 };
    let fire = shooting;
    for (const touch of touches.values()) {
      if (touch.role === 'ui') continue;
      const dx = touch.x - touch.base.x, dy = touch.y - touch.base.y, dist = Math.hypot(dx, dy);
      if (touch.role === 'move') { moveX += clamp(dx / 46, -1, 1); moveY += clamp(dy / 46, -1, 1); }
      else if (touch.role === 'aim' && dist > 8) { target = { x: game.player.x + dx / dist * 500, y: game.player.y + dy / dist * 500 }; fire = true; }
    }
    const input = { moveX, moveY, aimX: target.x, aimY: target.y, shoot: fire, ...actions };
    actions = {}; return input;
  }
  function activate(point) {
    const button = [...buttons].reverse().find(b => point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h);
    if (button) { button.callback(); return true; } return false;
  }
  function handlePointer(type, point) {
    const p = logical(point); pointer = p;
    if (type === 'down' && point.button === 0) {
      if (activate(p)) return;
      if (game && !paused && !help && ['playing', 'intermission'].includes(game.status)) shooting = true;
    }
    if (type === 'up') shooting = false;
  }
  function handleKey(type, key) {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (type === 'up') { keys.delete(k); return; }
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
      if (type === 'end' || type === 'cancel') { touches.delete(touch.id); continue; }
      if (type === 'start') {
        if (activate(p) || screen !== 'game' || paused || help || !game || ['dead', 'won'].includes(game.status)) continue;
        const role = p.x < layout.w / 2 ? 'move' : 'aim';
        if ([...touches.values()].some(t => t.role === role)) continue;
        touches.set(touch.id, { ...p, base: { ...p }, role });
      } else if (touches.has(touch.id)) Object.assign(touches.get(touch.id), p);
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
      for (const event of game.events || []) {
        if (event.type === 'unlock') { toast = `${WEAPONS[event.weaponId]?.label || '新武器'}已解锁，点击武器卡装备`; toastUntil = clock + 3; }
      }
    }
    ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size.width, size.height);
    buttons = [];
    if (isPortrait()) { drawPortrait(); clearInput(); return; }
    ctx.translate(layout.ox, layout.oy); ctx.scale(layout.scale, layout.scale);
    if (screen === 'menu') drawMenu(); else drawGame();
    if (help) drawHelp();
  }
  function getSnapshot() {
    return { screen, paused, help, selectedMap, best, layout: { ...layout }, buttons: buttons.map(({ x, y, w, h, label }) => ({ x, y, w, h, label })), game: game ? { status: game.status, wave: game.wave, score: game.score, time: game.time, kills: game.kills, mapId: game.map.id, enemyCount: game.enemies.length, bulletCount: game.bullets.length, enemyBulletCount: game.bullets.filter(b => b.owner === 'enemy').length, bosses: game.enemies.filter(e => e.type === 'tank').map(e => ({ hp: e.hp, maxHp: e.maxHp, rangedCharge: e.rangedCharge, rangedCooldown: e.rangedCooldown })), grenadeCount: game.grenades.length, player: { x: game.player.x, y: game.player.y, hp: game.player.hp, shield: game.player.shield, grenades: game.player.grenades, currentWeapon: game.player.currentWeapon, weapons: JSON.parse(JSON.stringify(game.player.weapons)) } } : null };
  }
  resize({ width, height, pixelRatio });
  return { frame, resize, handleTouch, handleKey, handlePointer, pause, resume, getSnapshot };
}
