// Original procedural artwork; no external game assets or copied map graphics.
import { BOSS_ATTACK, WEAPONS, segmentRect } from './game.js';

const TAU = Math.PI * 2;
const ink = '#243c48';
const themes = {
  courtyard: { floor: '#a9d6cc', tile: '#9bcac0', edge: '#75a99f', cover: '#e7b67b', front: '#bb865b', detail: '#f5d6a8', moss: '#8ac1ab' },
  greenhouse: { floor: '#cedddf', tile: '#bdced1', edge: '#75939e', cover: '#769baa', front: '#4c6f80', detail: '#cde7e8', moss: '#b5c9cc' },
  candyloop: { floor: '#e6d7ed', tile: '#d4bde0', edge: '#b38bc5', cover: '#ffdbb4', front: '#c885a4', detail: '#fff7dc', moss: '#ceaad8' },
};
const colors = { grunt: '#a6d884', runner: '#ffb965', tank: '#bba0dc' };
const marks = { pistol: 'P', smg: 'S', shotgun: 'B', rifle: 'R', lmg: 'M', sniper: 'N' };
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
  const lengths = { pistol: 23, smg: 28, shotgun: 28, rifle: 35, lmg: 37, sniper: 43 };
  const length = lengths[weapon] || 24;
  ctx.fillStyle = '#d6a166'; roundRect(ctx, 9, -6, 12, 12, 4); ctx.fill();
  if (weapon === 'shotgun') {
    ctx.fillStyle = color; roundRect(ctx, 17, -8, 15, 16, 3); ctx.fill();
    ctx.fillStyle = '#b77955'; roundRect(ctx, 19, -7, 8, 14, 2); ctx.fill();
    ctx.fillStyle = '#617e85';
    roundRect(ctx, 26, -8, length - 19, 6, 2); ctx.fill();
    roundRect(ctx, 26, 2, length - 19, 6, 2); ctx.fill();
    ctx.fillStyle = '#243c48'; roundRect(ctx, length + 4, -7, 3, 4, 1); ctx.fill();
    roundRect(ctx, length + 4, 3, 3, 4, 1); ctx.fill();
    return;
  }
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

function star(ctx, x, y, radius, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? radius * .45 : radius;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function obstacle(ctx, o, palette, index, factory = false, candy = false) {
  const x = num(o.x), y = num(o.y), w = num(o.w, num(o.width, 80)), h = num(o.h, num(o.height, 80));
  ctx.fillStyle = '#24424b24'; roundRect(ctx, x + 5, y + 8, w, h + 5, 9); ctx.fill();
  ctx.fillStyle = palette.front; roundRect(ctx, x, y, w, h + 8, 8); ctx.fill();
  ctx.fillStyle = palette.cover; roundRect(ctx, x, y - 6, w, h, 8); ctx.fill();
  ctx.strokeStyle = '#35534a45'; ctx.lineWidth = 2; ctx.stroke();
  if (candy) {
    ctx.save(); roundRect(ctx, x + 6, y, w - 12, h - 12, 6); ctx.clip();
    ctx.strokeStyle = '#efa6b3'; ctx.lineWidth = 10;
    ctx.beginPath();
    for (let p = -h; p < w + h; p += 42) { ctx.moveTo(x + p, y); ctx.lineTo(x + p + h, y + h); }
    ctx.stroke(); ctx.restore();
    ctx.strokeStyle = '#fff6e2'; ctx.lineWidth = 4;
    roundRect(ctx, x + 7, y + 1, w - 14, h - 16, 5); ctx.stroke();
    if (w > 150 && h > 120) {
      ctx.fillStyle = '#b782bc'; roundRect(ctx, x + w / 2 - 57, y + h / 2 - 52, 114, 96, 22); ctx.fill();
      ctx.fillStyle = '#fff1cb'; roundRect(ctx, x + w / 2 - 53, y + h / 2 - 58, 106, 90, 22); ctx.fill();
      star(ctx, x + w / 2, y + h / 2 - 18, 28, '#f4b978', '#bc789c');
      circle(ctx, x + w / 2 - 17, y + h / 2 + 19, 4, '#eba3b3');
      circle(ctx, x + w / 2, y + h / 2 + 19, 4, '#d4abde');
      circle(ctx, x + w / 2 + 17, y + h / 2 + 19, 4, '#eba3b3');
    }
    return;
  }
  if (factory) {
    ctx.save();
    ctx.fillStyle = '#e7f2e9'; roundRect(ctx, x + 8, y + 2, w - 16, 10, 3); ctx.fill();
    ctx.fillStyle = '#3e6474';
    for (let i = 0; i < 3; i++) { roundRect(ctx, x + 13 + i * 10, y + h - 22, 5, 11, 2); ctx.fill(); }
    circle(ctx, x + w - 17, y + 25, 6, '#a3e9c6', '#426775', 2);
    circle(ctx, x + w - 17, y + 25, 2, '#edfff0');
    if (w > 100 && h > 50) {
      ctx.fillStyle = '#335866'; roundRect(ctx, x + w / 2 - 27, y + h / 2 - 17, 54, 28, 5); ctx.fill();
      for (let j = 0; j < 3; j++) circle(ctx, x + w / 2 + (j - 1) * 13, y + h / 2 - 3, j === 1 ? 5 : 3.5, '#b5efcb');
    }
    ctx.restore(); return;
  }
  ctx.strokeStyle = palette.detail; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 10, y + 4); ctx.lineTo(x + w - 10, y + 4); ctx.stroke();
  ctx.strokeStyle = '#35534a25'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 12, y + h - 16); ctx.lineTo(x + w - 12, y + 10);
  ctx.moveTo(x + 12, y + 10); ctx.lineTo(x + w - 12, y + h - 16); ctx.stroke();
}

function candyFloor(ctx, map, t) {
  const w = num(map.width, 1280), h = num(map.height, 760);
  ctx.save();
  // Painted rings and floor stars are flat decorations; only the striped
  // raised islands collide. The inner loop has two routes around the island.
  ctx.strokeStyle = '#f6ecfa'; ctx.lineWidth = 68; ctx.lineJoin = 'round';
  roundRect(ctx, 118, 76, w - 236, h - 152, 80); ctx.stroke();
  roundRect(ctx, 440, 230, 400, 280, 58); ctx.stroke();
  ctx.strokeStyle = '#cda9d7'; ctx.lineWidth = 3; ctx.setLineDash([8, 18]);
  roundRect(ctx, 118, 76, w - 236, h - 152, 80); ctx.stroke();
  roundRect(ctx, 440, 230, 400, 280, 58); ctx.stroke(); ctx.setLineDash([]);
  for (const point of map.spawnPoints || []) {
    circle(ctx, point.x, point.y, 35, '#d3b4df', '#a875bd', 3);
    star(ctx, point.x, point.y, 20, '#fff0be', '#b688ad');
  }
  for (const [x, y] of [[380, 80], [900, 80], [150, 380], [1130, 380], [380, 680], [900, 680], [640, 230], [640, 510]]) {
    star(ctx, x, y, 10, '#d0afd9');
  }
  for (const zone of map.speedZones || []) speedZone(ctx, zone, t, true);
  ctx.restore();
}

function workshopFloor(ctx, map, t) {
  const w = num(map.width, 1280), h = num(map.height, 760);
  ctx.save();
  // Painted utility pipes and perimeter markings distinguish this factory from
  // the garden, while leaving the central floor clear for combat readability.
  ctx.strokeStyle = '#8babb1'; ctx.lineWidth = 12; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(26, 48); ctx.lineTo(w - 26, 48); ctx.lineTo(w - 26, h - 48); ctx.stroke();
  ctx.strokeStyle = '#e9f4ee'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#597b87';
  for (let x = 95; x < w - 60; x += 170) { roundRect(ctx, x, 35, 10, 26, 3); ctx.fill(); }
  for (let y = 82; y < h - 80; y += 145) { roundRect(ctx, w - 39, y, 26, 10, 3); ctx.fill(); }
  ctx.save(); ctx.strokeStyle = '#819da570'; ctx.lineWidth = 5; ctx.setLineDash([14, 14]);
  roundRect(ctx, 20, 20, w - 40, h - 40, 13); ctx.stroke(); ctx.restore();
  for (const point of map.spawnPoints || []) {
    circle(ctx, num(point.x), num(point.y), 39, '#afc5c9', '#93aeb5', 3);
    circle(ctx, num(point.x), num(point.y), 29, null, '#ecf4e8', 3);
    for (let j = -1; j <= 1; j++) {
      ctx.strokeStyle = '#86a4ad'; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(num(point.x) - 15, num(point.y) + j * 8); ctx.lineTo(num(point.x) + 15, num(point.y) + j * 8); ctx.stroke();
    }
  }
  for (const zone of map.speedZones || []) speedZone(ctx, zone, t);
  ctx.restore();
}

function speedZone(ctx, zone, t, candy = false) {
  const x = num(zone.x), y = num(zone.y), w = num(zone.w), h = num(zone.h), vertical = h > w;
  ctx.save(); roundRect(ctx, x, y, w, h, 12); ctx.clip();
  ctx.fillStyle = candy ? '#b690d1' : '#53b8b2'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = candy ? '#8054a480' : '#256f7980'; ctx.lineWidth = 3;
  const length = vertical ? h : w, offset = (t * 48) % 34;
  ctx.beginPath();
  for (let p = -34 + offset; p < length + 34; p += 34) {
    if (vertical) { ctx.moveTo(x, y + p); ctx.lineTo(x + w, y + p); }
    else { ctx.moveTo(x + p, y); ctx.lineTo(x + p, y + h); }
  }
  ctx.stroke();
  ctx.fillStyle = candy ? '#ffe8bd25' : '#b6f3d135'; ctx.fillRect(x + 7, y + 7, w - 14, h - 14);
  ctx.strokeStyle = candy ? '#fff0bc' : '#e6fff0'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  ctx.beginPath();
  const count = Math.floor((length - 45) / 48);
  for (let i = 0; i < count; i++) {
    const p = 51 + i * 48;
    if (vertical) { ctx.moveTo(x + w / 2 - 11, y + p - 6); ctx.lineTo(x + w / 2, y + p + 5); ctx.lineTo(x + w / 2 + 11, y + p - 6); }
    else { ctx.moveTo(x + p - 5, y + h / 2 + 2); ctx.lineTo(x + p + 6, y + h / 2 + 13); ctx.lineTo(x + p - 5, y + h / 2 + 24); }
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = candy ? '#fff0c0' : '#e8f6d5'; ctx.lineWidth = 3; roundRect(ctx, x, y, w, h, 12); ctx.stroke();
}

function barrelPad(ctx, barrel, t) {
  const x = num(barrel.x), y = num(barrel.y), active = barrel.active !== false;
  ctx.save();
  circle(ctx, x, y + 2, 29, active ? '#f1d79b65' : '#9bb1b85a', active ? '#d19c54' : '#7899a4', 2);
  ctx.save(); ctx.strokeStyle = active ? '#fff2c3' : '#cde0de'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
  circle(ctx, x, y + 2, 24, null, ctx.strokeStyle, 2); ctx.restore();
  if (!active) {
    const remaining = Math.max(0, Math.ceil(num(barrel.respawnRemaining)));
    circle(ctx, x, y + 2, 19 + Math.sin(t * 2) * .6, '#e2eee6');
    ctx.fillStyle = '#294957'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${remaining}s`, x, y + 2);
  }
  ctx.restore();
}

function barrel(ctx, b) {
  const x = num(b.x), y = num(b.y);
  ctx.save(); ctx.translate(x, y);
  circle(ctx, 3, 15, 20, '#31536325');
  ctx.fillStyle = b.hitFlash > 0 ? '#ffe4ba' : '#dc9052'; roundRect(ctx, -16, -21, 32, 42, 7); ctx.fill();
  ctx.strokeStyle = '#835637'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#ffca7c'; ctx.beginPath(); ctx.ellipse(0, -20, 15, 5, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff0b7'; roundRect(ctx, -17, -12, 34, 6, 2); ctx.fill(); roundRect(ctx, -17, 9, 34, 6, 2); ctx.fill();
  // A bold flame symbol makes shootable barrels legible without a text label.
  ctx.fillStyle = '#734f36'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(8, -1, 6, 6);
  ctx.quadraticCurveTo(0, 12, -6, 6); ctx.quadraticCurveTo(-8, 1, -3, -3); ctx.lineTo(-2, 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffde96'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(5, 5, 2, 7); ctx.quadraticCurveTo(-3, 9, -3, 5); ctx.closePath(); ctx.fill();
  circle(ctx, 5, -20, 2, '#835637');
  if (num(b.hp) < num(b.maxHp, 44)) {
    const ratio = Math.max(0, Math.min(1, num(b.hp) / Math.max(1, num(b.maxHp, 44))));
    ctx.fillStyle = '#3b555d'; roundRect(ctx, -17, -32, 34, 4, 2); ctx.fill();
    if (ratio > 0) { ctx.fillStyle = '#ffca78'; roundRect(ctx, -17, -32, ratio * 34, 4, 2); ctx.fill(); }
  }
  ctx.restore();
}

function pickupIcon(ctx, type, weaponId) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
  if (type === 'weapon') {
    ctx.save(); ctx.rotate(-.45); ctx.scale(.6, .6); ctx.translate(-20, 0); gun(ctx, weaponId); ctx.restore();
  } else if (type === 'shield') {
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(10, -8); ctx.lineTo(8, 4); ctx.quadraticCurveTo(5, 10, 0, 13);
    ctx.quadraticCurveTo(-5, 10, -8, 4); ctx.lineTo(-10, -8); ctx.closePath(); ctx.fillStyle = '#7cd0e2'; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#fff8de'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.stroke();
  } else if (type === 'boost') {
    // A single bolt is legible at pickup size and matches the boost button.
    ctx.beginPath(); ctx.moveTo(1, -14); ctx.lineTo(-10, 2); ctx.lineTo(-2, 2);
    ctx.lineTo(-4, 14); ctx.lineTo(11, -4); ctx.lineTo(3, -4); ctx.lineTo(6, -14); ctx.closePath();
    ctx.fillStyle = '#ffbe58'; ctx.fill(); ctx.strokeStyle = '#8b6238'; ctx.lineWidth = 2; ctx.stroke();
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
  const pulse = Math.sin(t * 3.5 + num(p.x)), shade = { shield: '#8ee4f1', grenade: '#b7d892', health: '#ffb5a8', ammo: '#ffdd89', weapon: '#ffe8aa', boost: '#ffbd61' }[p.type] || '#ffe8aa';
  const y = num(p.y) + pulse * 2;
  ctx.save(); ctx.translate(num(p.x), y);
  circle(ctx, 0, 0, 26 + pulse * 2, `${shade}35`);
  circle(ctx, 0, 0, 20, '#fff5df', shade, 3);
  pickupIcon(ctx, p.type, p.weaponId);
  if (p.type === 'weapon') {
    circle(ctx, 17, 18, 12, ink); ctx.fillStyle = '#fff1ca'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px sans-serif'; ctx.fillText(marks[p.weaponId] || 'W', 17, 18);
  }
  ctx.restore();
}

function effect(ctx, e) {
  const ratio = Math.max(0, Math.min(1, num(e.life, .1) / Math.max(.001, num(e.maxLife, .5))));
  const radius = num(e.radius, 20), progress = 1 - ratio;
  ctx.save(); ctx.globalAlpha = ratio;
  if (e.type === 'muzzle') {
    const heavy = e.weaponId === 'shotgun' || e.weaponId === 'sniper', length = heavy ? 25 : 19;
    ctx.translate(num(e.x), num(e.y)); ctx.rotate(num(e.angle));
    ctx.fillStyle = '#ffbb70'; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(7, -8); ctx.lineTo(11, -3);
    ctx.lineTo(length, 0); ctx.lineTo(11, 3); ctx.lineTo(7, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff8dc'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(7, -4); ctx.lineTo(length * .75, 0); ctx.lineTo(7, 4); ctx.closePath(); ctx.fill();
  } else if (e.type === 'explosion' || e.type === 'barrelExplosion') {
    const oil = e.type === 'barrelExplosion';
    circle(ctx, num(e.x), num(e.y), radius * (.25 + progress * .75), oil ? '#ffbf715a' : '#ffe5a55a', oil ? '#ffe2a8' : '#fff3cd', 6 * ratio + 1);
    circle(ctx, num(e.x), num(e.y), radius * (.15 + progress * .45), oil ? '#ef8b4365' : '#ffd57f65');
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12, dist = radius * (.4 + progress * .7);
      circle(ctx, num(e.x) + Math.cos(a) * dist, num(e.y) + Math.sin(a) * dist, 3 + ratio * 3, i % 2 ? '#fff0c0' : '#ee9163');
    }
  } else if (e.type === 'pickup' || e.type === 'barrelRespawn') {
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

function aimIndicator(ctx, game, t) {
  const id = typeof game.aimTarget === 'object' ? game.aimTarget?.id : game.aimTarget;
  if (id == null) return;
  const target = (game.enemies || []).find(enemy => enemy.id === id && enemy.hp > 0);
  if (!target) return;
  const radius = num(target.radius, 19) + 7, pulse = .85 + .15 * Math.sin(t * 9);
  ctx.save(); ctx.translate(num(target.x), num(target.y));
  ctx.globalAlpha = pulse; ctx.strokeStyle = '#ffe4a0'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    ctx.beginPath(); ctx.arc(0, 0, radius, a - .16, a + .16); ctx.stroke();
  }
  ctx.restore();
}

function speedIndicator(ctx, player, t) {
  if (num(player.speedMultiplier, 1) <= 1) return;
  const x = num(player.x), y = num(player.y), angle = num(player.angle), pulse = .65 + .35 * Math.sin(t * 12);
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = pulse;
  ctx.strokeStyle = '#e5fff3'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-40, -13); ctx.lineTo(-26, -13); ctx.moveTo(-45, 0); ctx.lineTo(-29, 0);
  ctx.moveTo(-40, 13); ctx.lineTo(-26, 13); ctx.stroke(); ctx.restore();
}

function boostIndicator(ctx, player, t) {
  if (num(player.boostRemaining) <= 0) return;
  const pulse = Math.sin(t * 7) * 1.5;
  ctx.save(); ctx.translate(num(player.x), num(player.y) + 20);
  // Keep the warm energy ring at the feet, away from bullets and the blue
  // shield/revive outlines. Its moving sparks also remain clear without text.
  ctx.beginPath(); ctx.ellipse(0, 0, 34 + pulse, 12 + pulse * .25, 0, 0, TAU);
  ctx.fillStyle = '#ffb84b25'; ctx.fill(); ctx.strokeStyle = '#ffe1a0'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.setLineDash([8, 7]); ctx.lineDashOffset = -t * 26;
  ctx.beginPath(); ctx.ellipse(0, 0, 39 + pulse, 15 + pulse * .25, 0, 0, TAU);
  ctx.strokeStyle = '#f0a744b0'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  for (let i = 0; i < 2; i++) {
    const angle = t * 3 + i * Math.PI;
    circle(ctx, Math.cos(angle) * 38, Math.sin(angle) * 14, 2.8, '#fff0bc', '#e6a348', 1.5);
  }
  ctx.restore();
}

// Stop the warning at the same cover that blocks a shot. The ray starts at the
// enemy center, so a charge beside cover never suggests that a shot passes it.
function warningLength(enemy, map, angle) {
  const x = num(enemy.x), y = num(enemy.y), dx = Math.cos(angle), dy = Math.sin(angle);
  let length = Math.min(650, Math.hypot(num(map.width, 1280), num(map.height, 760)));
  for (const rect of map.obstacles || []) {
    const cover = { x: num(rect.x), y: num(rect.y), w: num(rect.w, num(rect.width, 80)), h: num(rect.h, num(rect.height, 80)) };
    const hit = segmentRect(x, y, x + dx * length, y + dy * length, cover, BOSS_ATTACK.radius);
    if (hit !== null) length *= hit;
  }
  return length;
}

function rangedWarning(ctx, enemy, map, t) {
  const charge = num(enemy.rangedCharge);
  if (charge <= 0) return;
  const progress = Math.max(0, Math.min(1, 1 - charge / Math.max(.001, num(enemy.rangedWindup, BOSS_ATTACK.windup))));
  const angle = num(enemy.attackAngle, num(enemy.angle)), radius = Math.max(1, num(enemy.radius, 25));
  const pulse = .5 + .5 * Math.sin(t * 19);
  ctx.save(); ctx.translate(num(enemy.x), num(enemy.y));
  circle(ctx, 0, 0, radius + 9 + progress * 8, '#ff805128', '#fff1d3', 2.5);
  for (const spread of [-BOSS_ATTACK.spread, 0, BOSS_ATTACK.spread]) {
    const direction = angle + spread, length = warningLength(enemy, map, direction);
    if (length <= radius + 3) continue;
    ctx.save(); ctx.rotate(direction);
    ctx.strokeStyle = `rgba(236, 91, 62, ${.10 + progress * .13})`; ctx.lineWidth = BOSS_ATTACK.radius * 2;
    ctx.beginPath(); ctx.moveTo(radius + 3, 0); ctx.lineTo(length, 0); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 238, 204, ${.65 + pulse * .3})`; ctx.lineWidth = 4; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.moveTo(radius + 3, 0); ctx.lineTo(length, 0); ctx.stroke();
    ctx.strokeStyle = '#e95946'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = '#f0644b'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath();
  ctx.arc(0, 0, radius + 9 + progress * 8, -Math.PI / 2, -Math.PI / 2 + TAU * progress); ctx.stroke();
  ctx.restore();
}

function reloadIndicator(ctx, player, map) {
  const weapon = WEAPONS[player.currentWeapon], ammo = player.weapons?.[player.currentWeapon];
  if (!weapon || !ammo || ammo.reloadRemaining <= 0) return;
  const progress = Math.max(0, Math.min(1, 1 - ammo.reloadRemaining / weapon.reloadTime));
  const x = Math.max(46, Math.min(num(map.width, 1280) - 46, num(player.x)));
  const y = Math.max(20, num(player.y) - num(player.radius, 20) - 36);
  ctx.save();
  ctx.fillStyle = '#243c48'; roundRect(ctx, x - 28, y - 14, 56, 28, 14); ctx.fill();
  ctx.strokeStyle = '#fff0cd75'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#fff1ca'; roundRect(ctx, x - 18, y - 7, 11, 14, 2); ctx.fill();
  ctx.strokeStyle = '#63817d'; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(x - 15, y - 3); ctx.lineTo(x - 10, y - 3);
  ctx.moveTo(x - 15, y + 1); ctx.lineTo(x - 10, y + 1); ctx.stroke();
  circle(ctx, x + 11, y, 8, null, '#90a39f', 2);
  ctx.strokeStyle = '#f8df8e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x + 11, y, 8, -Math.PI / 2, -Math.PI / 2 + TAU * progress); ctx.stroke();
  ctx.restore();
}

function grenadePreview(ctx, player, aim, t) {
  if (!player || !aim || !Number.isFinite(aim.x) || !Number.isFinite(aim.y)) return;
  const x = aim.x, y = aim.y, radius = Math.max(1, num(aim.range, 135));
  ctx.save();
  circle(ctx, x, y, radius, '#ffbb681c', '#f2bd7ab0', 2);
  ctx.strokeStyle = '#fff1c6'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.setLineDash([9, 8]); ctx.lineDashOffset = -t * 30;
  ctx.beginPath(); ctx.moveTo(num(player.x), num(player.y));
  const path = (aim.path || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (path.length) for (const point of path) ctx.lineTo(point.x, point.y);
  ctx.lineTo(x, y); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  circle(ctx, x, y, 20, '#243c48df', '#ffd99c', 2.5);
  ctx.translate(x, y); ctx.scale(.85, .85); pickupIcon(ctx, 'grenade');
  ctx.restore();
  ctx.save(); ctx.strokeStyle = '#fff2c9'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * 26, y + dy * 26); ctx.lineTo(x + dx * 35, y + dy * 35);
  }
  ctx.stroke(); ctx.restore();
}

function reviveProtection(ctx, player, map, t, foreground = false) {
  const remaining = num(player.reviveProtectionRemaining);
  if (remaining <= 0) return;
  const x = num(player.x), y = num(player.y), radius = num(player.radius, 18) + 17;
  ctx.save();
  if (!foreground) {
    const pulse = 1 + .035 * Math.sin(t * 9);
    circle(ctx, x, y, radius * pulse + 9, '#d8f9ff24');
    circle(ctx, x, y, radius * pulse, '#8edbf91f', '#e9fdffbd', 3);
    ctx.strokeStyle = '#83dcec'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, radius * pulse + 4, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, remaining / 3)); ctx.stroke();
  } else {
    const bx = Math.max(65, Math.min(num(map.width, 1280) - 65, x));
    const ammo = player.weapons?.[player.currentWeapon];
    const reloadY = Math.max(20, y - num(player.radius, 18) - 36);
    const by = ammo?.reloadRemaining > 0 ? (reloadY >= 58 ? reloadY - 38 : reloadY + 38) : reloadY;
    ctx.fillStyle = '#244b5d'; roundRect(ctx, bx - 63, by - 16, 126, 32, 16); ctx.fill();
    ctx.strokeStyle = '#b7f2f4'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#e8ffff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`复活保护 ${Math.ceil(remaining)}s`, bx, by);
  }
  ctx.restore();
}

// Optional screen bounds supply a camera measured in world coordinates. Callers
// without a camera keep the original world-space rendering behavior.
export function drawArena(ctx, game, bounds = {}) {
  const { time = 0, camera, grenadeAim } = bounds;
  const map = game.map || {}, w = num(map.width, 1280), h = num(map.height, 760), t = num(time) * .001;
  const palette = themes[map.id] || themes[map.theme] || themes.courtyard;
  const factory = map.id === 'greenhouse' || map.theme === 'factory';
  const candy = map.id === 'candyloop' || map.theme === 'candy';
  ctx.save();
  if (camera) {
    const scale = Math.max(.001, num(bounds.scale, 1)), x = num(bounds.x), y = num(bounds.y);
    ctx.beginPath(); ctx.rect(x, y, Math.max(1, num(bounds.w, w * scale)), Math.max(1, num(bounds.h, h * scale))); ctx.clip();
    ctx.translate(x, y); ctx.scale(scale, scale); ctx.translate(-num(camera.x), -num(camera.y));
  }
  ctx.fillStyle = palette.edge; roundRect(ctx, -10, -10, w + 20, h + 24, 26); ctx.fill();
  ctx.fillStyle = palette.floor; roundRect(ctx, 0, 0, w, h, 20); ctx.fill();
  ctx.save(); roundRect(ctx, 0, 0, w, h, 20); ctx.clip();
  ctx.strokeStyle = palette.tile; ctx.lineWidth = 1;
  ctx.beginPath();
  if (!candy) {
    for (let x = 0; x < w; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y < h; y += 80) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  }
  ctx.stroke();
  const light = ctx.createRadialGradient(w * .4, h * .3, 0, w * .5, h * .5, w * .7);
  light.addColorStop(0, '#ffffff15'); light.addColorStop(1, '#243c4815'); ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
  if (factory) workshopFloor(ctx, map, t);
  else if (candy) candyFloor(ctx, map, t);
  else {
    // Sparse garden floor decals communicate scale without obscuring bullets.
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
  }
  for (const b of game.barrels || []) barrelPad(ctx, b, t);
  for (const p of game.pickups || []) pickup(ctx, p, t);
  for (const enemy of game.enemies || []) rangedWarning(ctx, enemy, map, t);
  for (const [i, o] of (map.obstacles || []).entries()) obstacle(ctx, o, palette, i, factory, candy);
  const player = game.player;
  if (player) speedIndicator(ctx, player, t);
  if (player) boostIndicator(ctx, player, t);
  if (player) reviveProtection(ctx, player, map, t);
  grenadePreview(ctx, player, grenadeAim, t);
  const activeBarrels = (game.barrels || []).filter(b => b.active !== false);
  const actors = [...(game.enemies || []), ...activeBarrels];
  if (player) actors.push(player);
  actors.sort((a, b) => num(a.y) - num(b.y));
  for (const actor of actors) {
    if (activeBarrels.includes(actor)) { barrel(ctx, actor); continue; }
    const enemy = actor !== player;
    drawEgg(ctx, num(actor.x), num(actor.y), { angle: enemy && actor.rangedCharge > 0 ? num(actor.attackAngle, num(actor.angle)) : num(actor.angle), scale: num(actor.radius, enemy ? 19 : 20) / 20,
      shield: enemy ? 0 : num(actor.shield), enemyType: enemy ? (actor.type || 'grunt') : null,
      hurt: enemy ? num(actor.hitFlash) : num(actor.reviveProtectionRemaining) > 0 ? 0 : num(actor.invulnerability), weapon: actor.currentWeapon || 'pistol', time });
    if (enemy && (actor.type === 'tank' || actor.hp < actor.maxHp)) {
      const ratio = Math.max(0, Math.min(1, num(actor.hp) / Math.max(1, num(actor.maxHp, 1)))), radius = num(actor.radius, 19);
      const boss = actor.type === 'tank', width = boss ? 58 : 30, height = boss ? 6 : 4, top = num(actor.y) - radius - (boss ? 20 : 16);
      ctx.fillStyle = '#243c487a'; roundRect(ctx, num(actor.x) - width / 2, top, width, height, 2); ctx.fill();
      if (ratio > 0) { ctx.fillStyle = boss ? '#ffaf83' : '#fff2cb'; roundRect(ctx, num(actor.x) - width / 2, top, width * ratio, height, 2); ctx.fill(); }
      if (boss) {
        ctx.fillStyle = '#fff0d9'; roundRect(ctx, num(actor.x) - 49, top - 31, 98, 24, 8); ctx.fill();
        ctx.fillStyle = '#513451'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('重甲 BOSS', num(actor.x), top - 19);
      }
    }
  }
  aimIndicator(ctx, game, t);
  for (const b of game.bullets || []) {
    const x = num(b.x), y = num(b.y), a = Math.atan2(num(b.vy), num(b.vx));
    if (b.owner === 'enemy') {
      const radius = Math.max(1, num(b.radius, 7));
      ctx.strokeStyle = '#f06a4990'; ctx.lineWidth = radius * 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 18, y - Math.sin(a) * 18); ctx.lineTo(x, y); ctx.stroke();
      circle(ctx, x, y, radius + 3, '#f05d432b');
      circle(ctx, x, y, radius, '#ffad69', '#ba443d', 2);
      circle(ctx, x - 1.5, y - 1.5, radius * .38, '#fff1c7');
      continue;
    }
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
  if (player) reloadIndicator(ctx, player, map);
  if (player) reviveProtection(ctx, player, map, t, true);
  ctx.restore(); ctx.restore();
}
