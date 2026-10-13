// Original procedural artwork; no external game assets or copied map graphics.
const TAU = Math.PI * 2;
const ink = '#243c48';
const themes = {
  courtyard: { floor: '#a9d6cc', tile: '#9bcac0', edge: '#75a99f', cover: '#e7b67b', front: '#bb865b', detail: '#f5d6a8', moss: '#8ac1ab' },
  greenhouse: { floor: '#e7b3a5', tile: '#d9a498', edge: '#b9857b', cover: '#84b7a3', front: '#508875', detail: '#b7d9c3', moss: '#d69b8e' },
};
const colors = { grunt: '#a6d884', runner: '#ffb965', tank: '#bba0dc' };
const marks = { pistol: 'P', smg: 'S', rifle: 'R', lmg: 'M', sniper: 'N' };
const num = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

function roundRect(ctx, x, y, w, h, r = 8) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function circle(ctx, x, y, r, fill, stroke, width = 2) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function gun(ctx, weapon, color = ink) {
  const lengths = { pistol: 23, smg: 28, rifle: 35, lmg: 37, sniper: 43 };
  const length = lengths[weapon] || 24;
  ctx.fillStyle = '#d6a166'; roundRect(ctx, 9, -6, 12, 12, 4); ctx.fill();
  ctx.fillStyle = color; roundRect(ctx, 17, -5, length - 14, 10, 3); ctx.fill();
  ctx.fillStyle = '#48616a'; roundRect(ctx, 20, -5, Math.max(7, length - 23), 3, 1); ctx.fill();
  ctx.fillStyle = '#6d8388'; roundRect(ctx, length - 2, -3, 9, 6, 2); ctx.fill();
  if (weapon === 'sniper') { ctx.fillStyle = '#f8d475'; roundRect(ctx, 23, -8, 12, 4, 2); ctx.fill(); }
  if (weapon === 'lmg') { ctx.fillStyle = '#f8d475'; roundRect(ctx, 21, 5, 12, 5, 2); ctx.fill(); }
}

export function drawEgg(ctx, x, y, {
  angle = 0, color = '#fff0cc', scale = 1, shield = 0,
  enemyType = null, hurt = 0, weapon = 'pistol', time = 0,
} = {}) {
  const t = num(time) * 0.001, gait = Math.sin(t * (enemyType === 'runner' ? 15 : 9) + x * .08);
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = '#23424b25'; ctx.beginPath(); ctx.ellipse(1, 20, 23, 10, 0, 0, TAU); ctx.fill();
  if (shield > 0) {
    const pulse = 1 + .04 * Math.sin(t * 4);
    circle(ctx, 0, 0, 32 * pulse, '#b1f3ff26', '#efffffaa', 2);
    ctx.save(); ctx.rotate(t * .7); ctx.setLineDash([10, 11]);
    circle(ctx, 0, 0, 35 * pulse, null, '#63cddd', 3); ctx.restore();
  }
  ctx.fillStyle = enemyType ? '#4b6261' : ink;
  roundRect(ctx, -13, 15 + gait * 2, 10, 10, 4); ctx.fill();
  roundRect(ctx, 4, 15 - gait * 2, 10, 10, 4); ctx.fill();
  const body = hurt > 0 ? '#ffd9cb' : (colors[enemyType] || color);
  ctx.beginPath(); ctx.moveTo(0, -25);
  ctx.bezierCurveTo(14, -25, 23, -4, 22, 8); ctx.bezierCurveTo(21, 28, -21, 28, -22, 8);
  ctx.bezierCurveTo(-23, -4, -14, -25, 0, -25);
  ctx.fillStyle = body; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = enemyType ? '#446859' : '#826f50'; ctx.stroke();
  ctx.fillStyle = '#ffffff50'; ctx.beginPath(); ctx.ellipse(-8, -10, 5, 10, .35, 0, TAU); ctx.fill();
  if (enemyType === 'tank') {
    ctx.strokeStyle = '#8162a8'; ctx.lineWidth = 5; ctx.beginPath();
    ctx.moveTo(-16, -10); ctx.quadraticCurveTo(0, -22, 16, -10); ctx.stroke();
    circle(ctx, 0, -18, 4, '#7c5ea0');
  }
  if (enemyType === 'runner') {
    ctx.fillStyle = '#ee8056'; roundRect(ctx, -19, -12, 38, 6, 3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(19, -11); ctx.lineTo(31, -8); ctx.lineTo(20, -4); ctx.fill();
  }
  const lookX = Math.cos(angle) * 2.2, lookY = Math.sin(angle) * 1.5;
  circle(ctx, -7 + lookX, -3 + lookY, 2.8, ink);
  circle(ctx, 7 + lookX, -3 + lookY, 2.8, ink);
  ctx.strokeStyle = ink; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath();
  if (enemyType) {
    ctx.moveTo(-5, 9); ctx.quadraticCurveTo(0, 5, 5, 9);
    ctx.moveTo(-11, -9); ctx.lineTo(-5, -7); ctx.moveTo(5, -7); ctx.lineTo(11, -9);
  } else { ctx.moveTo(-4, 7); ctx.quadraticCurveTo(0, 11, 4, 7); }
  ctx.stroke();
  if (!enemyType) {
    circle(ctx, -13, 4, 3, '#efab8990'); circle(ctx, 13, 4, 3, '#efab8990');
    ctx.save(); ctx.rotate(angle); gun(ctx, weapon); circle(ctx, 16, 5, 4, '#fff0cc', '#826f50', 1.5); ctx.restore();
  }
  ctx.restore();
}

function obstacle(ctx, o, palette, index) {
  const x = num(o.x), y = num(o.y), w = num(o.w, num(o.width, 80)), h = num(o.h, num(o.height, 80));
  ctx.fillStyle = '#24424b24'; roundRect(ctx, x + 5, y + 8, w, h + 5, 9); ctx.fill();
  ctx.fillStyle = palette.front; roundRect(ctx, x, y, w, h + 8, 8); ctx.fill();
  ctx.fillStyle = palette.cover; roundRect(ctx, x, y - 6, w, h, 8); ctx.fill();
  ctx.strokeStyle = '#35534a45'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = palette.detail; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 10, y + 4); ctx.lineTo(x + w - 10, y + 4); ctx.stroke();
  ctx.strokeStyle = '#35534a25'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 12, y + h - 16); ctx.lineTo(x + w - 12, y + 10);
  ctx.moveTo(x + 12, y + 10); ctx.lineTo(x + w - 12, y + h - 16); ctx.stroke();
  if (w > 90) {
    ctx.fillStyle = '#fff4d933'; roundRect(ctx, x + w / 2 - 14, y + h / 2 - 14, 28, 18, 3); ctx.fill();
    ctx.fillStyle = '#35534a75'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(index + 1).padStart(2, '0'), x + w / 2, y + h / 2 - 2);
  }
}

function pickupIcon(ctx, type, weaponId) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
  if (type === 'weapon') {
    ctx.save(); ctx.rotate(-.45); ctx.scale(.6, .6); ctx.translate(-20, 0); gun(ctx, weaponId); ctx.restore();
  } else if (type === 'shield') {
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(10, -8); ctx.lineTo(8, 4); ctx.quadraticCurveTo(5, 10, 0, 13);
    ctx.quadraticCurveTo(-5, 10, -8, 4); ctx.lineTo(-10, -8); ctx.closePath(); ctx.fillStyle = '#7cd0e2'; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#fff8de'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.stroke();
  } else if (type === 'grenade') {
    circle(ctx, 0, 3, 9, '#819969', ink, 2); ctx.fillStyle = ink; roundRect(ctx, -4, -9, 8, 5, 1); ctx.fill();
    ctx.beginPath(); ctx.moveTo(3, -9); ctx.lineTo(9, -10); ctx.lineTo(12, -5); ctx.stroke();
    ctx.strokeStyle = '#afc493'; ctx.beginPath(); ctx.moveTo(-4, -1); ctx.lineTo(-4, 7); ctx.stroke();
  } else if (type === 'health') {
    ctx.fillStyle = '#fff2cf'; roundRect(ctx, -12, -10, 24, 20, 5); ctx.fill();
    ctx.fillStyle = '#eb7e72'; roundRect(ctx, -3, -7, 6, 14, 1); ctx.fill(); roundRect(ctx, -7, -3, 14, 6, 1); ctx.fill();
  } else {
    for (let i = -1; i <= 1; i++) { ctx.fillStyle = '#eec56a'; roundRect(ctx, i * 7 - 2.5, -5, 5, 13, 1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(i * 7 - 2.5, -5); ctx.lineTo(i * 7, -10); ctx.lineTo(i * 7 + 2.5, -5); ctx.fill(); }
  }
}

function pickup(ctx, p, t) {
  const pulse = Math.sin(t * 3.5 + num(p.x)), shade = { shield: '#8ee4f1', grenade: '#b7d892', health: '#ffb5a8', ammo: '#ffdd89', weapon: '#ffe8aa' }[p.type] || '#ffe8aa';
  const y = num(p.y) + pulse * 2;
  ctx.save(); ctx.translate(num(p.x), y);
  circle(ctx, 0, 0, 26 + pulse * 2, `${shade}35`);
  circle(ctx, 0, 0, 20, '#fff5df', shade, 3);
  pickupIcon(ctx, p.type, p.weaponId);
  if (p.type === 'weapon') {
    circle(ctx, 15, 16, 8, ink); ctx.fillStyle = '#fff1ca'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 9px sans-serif'; ctx.fillText(marks[p.weaponId] || 'W', 15, 16);
  }
  ctx.restore();
}

function effect(ctx, e) {
  const ratio = Math.max(0, Math.min(1, num(e.life, .1) / Math.max(.001, num(e.maxLife, .5))));
  const radius = num(e.radius, 20), progress = 1 - ratio;
  ctx.save(); ctx.globalAlpha = ratio;
  if (e.type === 'explosion') {
    circle(ctx, num(e.x), num(e.y), radius * (.25 + progress * .75), '#ffe5a55a', '#fff3cd', 6 * ratio + 1);
    circle(ctx, num(e.x), num(e.y), radius * (.15 + progress * .45), '#ffd57f65');
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12, dist = radius * (.4 + progress * .7);
      circle(ctx, num(e.x) + Math.cos(a) * dist, num(e.y) + Math.sin(a) * dist, 3 + ratio * 3, i % 2 ? '#fff0c0' : '#ee9163');
    }
  } else if (e.type === 'pickup') {
    circle(ctx, num(e.x), num(e.y), 18 + progress * 30, null, e.color || '#fff3ce', 3);
  } else {
    const color = e.color || (e.type === 'damage' ? '#fff0d9' : '#f9e69a');
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5 + num(e.x) * .1, dist = 5 + progress * Math.max(15, radius);
      circle(ctx, num(e.x) + Math.cos(a) * dist, num(e.y) + Math.sin(a) * dist, 2 + ratio * 2, color);
    }
  }
  ctx.restore();
}

export function drawArena(ctx, game, { time = 0 } = {}) {
  const map = game.map || {}, w = num(map.width, 1280), h = num(map.height, 760), t = num(time) * .001;
  const palette = themes[map.id] || themes[map.theme] || themes.courtyard;
  ctx.save();
  ctx.fillStyle = palette.edge; roundRect(ctx, -10, -10, w + 20, h + 24, 26); ctx.fill();
  ctx.fillStyle = palette.floor; roundRect(ctx, 0, 0, w, h, 20); ctx.fill();
  ctx.save(); roundRect(ctx, 0, 0, w, h, 20); ctx.clip();
  ctx.strokeStyle = palette.tile; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y < h; y += 80) { ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke();
  const light = ctx.createRadialGradient(w * .4, h * .3, 0, w * .5, h * .5, w * .7);
  light.addColorStop(0, '#ffffff15'); light.addColorStop(1, '#243c4815'); ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
  // Sparse floor decals communicate scale without obscuring bullets and drops.
  ctx.fillStyle = palette.moss;
  for (let i = 0; i < 24; i++) {
    const x = (i * 193 + 39) % w, y = (i * 127 + 53) % h;
    ctx.beginPath(); ctx.ellipse(x, y, 4 + i % 4, 2 + i % 2, i, 0, TAU); ctx.fill();
  }
  circle(ctx, w / 2, h / 2, 68, null, '#fff5d326', 3); circle(ctx, w / 2, h / 2, 50, null, '#fff5d326', 1.5);
  for (const point of map.spawnPoints || []) {
    ctx.save(); ctx.translate(num(point.x), num(point.y)); ctx.rotate(Math.atan2(h / 2 - num(point.y), w / 2 - num(point.x)));
    ctx.fillStyle = '#fff2cd38'; roundRect(ctx, -15, -29, 58, 58, 7); ctx.fill();
    ctx.strokeStyle = '#fff1cf8a'; ctx.lineWidth = 4; ctx.beginPath();
    ctx.moveTo(-3, -9); ctx.lineTo(7, 0); ctx.lineTo(-3, 9); ctx.moveTo(12, -9); ctx.lineTo(22, 0); ctx.lineTo(12, 9); ctx.stroke(); ctx.restore();
  }
  for (const p of game.pickups || []) pickup(ctx, p, t);
  for (const [i, o] of (map.obstacles || []).entries()) obstacle(ctx, o, palette, i);
  const player = game.player;
  const actors = [...(game.enemies || [])];
  if (player) actors.push(player);
  actors.sort((a, b) => num(a.y) - num(b.y));
  for (const actor of actors) {
    const enemy = actor !== player;
    drawEgg(ctx, num(actor.x), num(actor.y), { angle: num(actor.angle), scale: num(actor.radius, enemy ? 19 : 20) / 20,
      shield: enemy ? 0 : num(actor.shield), enemyType: enemy ? (actor.type || 'grunt') : null,
      hurt: enemy ? num(actor.hitFlash) : num(actor.invulnerability), weapon: actor.currentWeapon || 'pistol', time });
    if (enemy && actor.hp < actor.maxHp) {
      const ratio = Math.max(0, Math.min(1, num(actor.hp) / Math.max(1, num(actor.maxHp, 1)))), radius = num(actor.radius, 19);
      ctx.fillStyle = '#243c4859'; roundRect(ctx, num(actor.x) - 15, num(actor.y) - radius - 16, 30, 4, 2); ctx.fill();
      if (ratio > 0) { ctx.fillStyle = '#fff2cb'; roundRect(ctx, num(actor.x) - 15, num(actor.y) - radius - 16, 30 * ratio, 4, 2); ctx.fill(); }
    }
  }
  for (const b of game.bullets || []) {
    const x = num(b.x), y = num(b.y), a = Math.atan2(num(b.vy), num(b.vx));
    ctx.strokeStyle = b.owner === 'enemy' ? '#ed8669' : '#fff5c5'; ctx.lineWidth = b.weapon === 'sniper' ? 4 : 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 12, y - Math.sin(a) * 12); ctx.lineTo(x, y); ctx.stroke();
    circle(ctx, x, y, b.weapon === 'sniper' ? 3 : 2, '#fffbe7');
  }
  for (const g of game.grenades || []) {
    ctx.save(); ctx.translate(num(g.x), num(g.y));
    circle(ctx, 2, 7, 10, '#243c482c'); ctx.rotate(num(g.angle)); ctx.scale(.75, .75); pickupIcon(ctx, 'grenade'); ctx.restore();
    const ratio = Math.max(0, Math.min(1, num(g.fuse) / Math.max(.001, num(g.maxFuse, 1.2))));
    ctx.strokeStyle = '#fff0bd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(num(g.x), num(g.y), 14, -Math.PI / 2, -Math.PI / 2 + TAU * ratio); ctx.stroke();
  }
  for (const e of game.effects || []) effect(ctx, e);
  ctx.restore(); ctx.restore();
}
