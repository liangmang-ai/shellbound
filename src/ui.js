export const UI_COLORS = Object.freeze({
  bg: '#13242a',
  panel: '#20353a',
  line: 'rgba(190,224,213,.18)',
  ink: '#f8f2e4',
  muted: '#acc3c2',
  lime: '#d5efa3',
  teal: '#b2e2c9',
  coral: '#ffb196',
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const pressAmount = value => clamp(Number(value) || 0, 0, 1);

function surfacePath(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawSurface(ctx, x, y, w, h, {
  radius = 28,
  fill = UI_COLORS.panel,
  border = null,
  elevated = false,
} = {}) {
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;
  const r = clamp(Number(radius) || 0, 0, Math.min(w, h) / 2);
  ctx.save();
  if (elevated) {
    surfacePath(ctx, x, y + 4, w, h, r);
    ctx.fillStyle = 'rgba(0,0,0,.14)';
    ctx.fill();
  }
  surfacePath(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.25; ctx.stroke(); }
  if (elevated) {
    ctx.beginPath();
    ctx.moveTo(x + r, y + 1);
    ctx.lineTo(x + w - r, y + 1);
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawButtonSurface(ctx, x, y, w, h, {
  fill = UI_COLORS.panel,
  border = null,
  active = true,
  pressed = 0,
  radius = h / 2,
} = {}) {
  const offsetY = active ? pressAmount(pressed) * 2 : 0;
  ctx.save();
  if (!active) ctx.globalAlpha = (typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1) * .55;
  drawSurface(ctx, x, y + offsetY, w, h, { radius, fill, border, elevated: active && !offsetY });
  ctx.restore();
  return offsetY;
}

export function drawDifficultySegment(ctx, x, y, w, h, {
  selected = false,
  pressed = 0,
} = {}) {
  const amount = pressAmount(pressed);
  if (!selected && !amount) return;
  drawSurface(ctx, x, y + amount * 2, w, h, {
    radius: h / 2,
    fill: selected ? '#3a5748' : 'rgba(178,226,201,.08)',
    elevated: selected && !amount,
  });
}
