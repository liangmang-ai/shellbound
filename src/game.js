// Original, platform-independent game simulation. All coordinates are world pixels.
export const MAX_WAVES = 10;
export const BOSS_ATTACK = Object.freeze({ interval: 4, windup: 0.85, bulletSpeed: 310, damage: 18, radius: 7, life: 5, spread: 0.18 });
export const BARREL_RULES = Object.freeze({ hp: 44, radius: 19, blastRadius: 145, damage: 155, playerDamage: 45, respawnSeconds: 12 });
export const GRENADE_RULES = Object.freeze({ speed: 420, radius: 7, fuse: 1.05, defaultRange: 218.4, maxRange: 350, blastRadius: 135, damage: 190 });
export const FREE_REVIVES = 3;
export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ id: 'easy', label: '休闲', regularMultiplier: .60, tankMultiplier: .55,
    hpMultiplier: .72, speedMultiplier: .80, damageMultiplier: .65, spawnIntervalMultiplier: 1.35,
    bossInterval: 6, bossWindup: 1.10, bossBulletSpeedMultiplier: .80 }),
  normal: Object.freeze({ id: 'normal', label: '标准', regularMultiplier: 1, tankMultiplier: 1,
    hpMultiplier: 1, speedMultiplier: 1, damageMultiplier: 1, spawnIntervalMultiplier: 1,
    bossInterval: BOSS_ATTACK.interval, bossWindup: BOSS_ATTACK.windup, bossBulletSpeedMultiplier: 1 }),
  hard: Object.freeze({ id: 'hard', label: '挑战', regularMultiplier: 1.20, tankMultiplier: 1.25,
    hpMultiplier: 1.18, speedMultiplier: 1.10, damageMultiplier: 1.15, spawnIntervalMultiplier: .90,
    bossInterval: 3.5, bossWindup: .75, bossBulletSpeedMultiplier: 1.10 }),
});
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'lmg', 'sniper', 'shotgun'];
export const WEAPONS = Object.freeze({
  pistol: { label: '啵啵手枪', clipSize: 12, reserveMax: Infinity, damage: 22, fireInterval: 0.24, reloadTime: 0.85, bulletSpeed: 950, spread: 0.025, piercing: 1, color: '#ffe5ad' },
  smg: { label: '跳豆冲锋枪', clipSize: 30, reserveMax: 150, damage: 15, fireInterval: 0.075, reloadTime: 1.15, bulletSpeed: 900, spread: 0.11, piercing: 1, color: '#7ee8df' },
  rifle: { label: '薄荷步枪', clipSize: 24, reserveMax: 120, damage: 34, fireInterval: 0.16, reloadTime: 1.25, bulletSpeed: 1200, spread: 0.035, piercing: 1, color: '#a5ed8b' },
  lmg: { label: '爆米花机枪', clipSize: 70, reserveMax: 280, damage: 24, fireInterval: 0.09, reloadTime: 2.2, bulletSpeed: 1100, spread: 0.085, piercing: 1, color: '#ffbe76' },
  sniper: { label: '星光大狙', clipSize: 5, reserveMax: 30, damage: 140, fireInterval: 0.85, reloadTime: 1.7, bulletSpeed: 2200, spread: 0, piercing: 4, color: '#c9b5ff' },
  shotgun: { label: '脆壳霰弹枪', clipSize: 6, reserveMax: 36, damage: 16, fireInterval: 0.8, reloadTime: 1.6, bulletSpeed: 950, spread: 0.30, piercing: 1, pellets: 7, range: 300, falloffStart: 80, minDamageRatio: 0.4, color: '#ffad84' },
});

// Legacy saves and physics regressions can still load the old courtyard directly.
export const LEGACY_MAPS = [
  {
    id: 'courtyard', name: '薄荷庭院', theme: 'mint', width: 1280, height: 760,
    start: { x: 640, y: 380 },
    obstacles: [
      { x: 240, y: 160, w: 160, h: 80 }, { x: 880, y: 160, w: 160, h: 80 },
      { x: 240, y: 520, w: 160, h: 80 }, { x: 880, y: 520, w: 160, h: 80 },
      { x: 560, y: 120, w: 160, h: 80 }, { x: 560, y: 560, w: 160, h: 80 },
    ],
    spawnPoints: [{ x: 55, y: 95 }, { x: 1225, y: 95 }, { x: 55, y: 665 }, { x: 1225, y: 665 }, { x: 640, y: 45 }, { x: 640, y: 715 }],
  },
];
export const MAPS = [
  {
    id: 'greenhouse', name: '汽泡工坊', theme: 'factory', width: 1280, height: 760,
    start: { x: 640, y: 380 },
    obstacles: [
      { x: 320, y: 190, w: 100, h: 230 }, { x: 840, y: 370, w: 180, h: 100 },
      { x: 670, y: 125, w: 220, h: 80 }, { x: 160, y: 575, w: 230, h: 80 },
    ],
    spawnPoints: [{ x: 55, y: 380 }, { x: 1225, y: 380 }, { x: 300, y: 45 }, { x: 980, y: 45 }, { x: 300, y: 715 }, { x: 980, y: 715 }],
    speedZones: [
      { id: 'conveyor-west', x: 475, y: 280, w: 330, h: 70, multiplier: 1.45 },
      { id: 'conveyor-east', x: 1060, y: 310, w: 85, h: 270, multiplier: 1.45 },
    ],
    barrelStations: [
      { id: 'west-a', x: 520, y: 200 }, { id: 'west-b', x: 625, y: 240 },
      { id: 'south', x: 760, y: 555 }, { id: 'east', x: 1050, y: 230 },
    ],
  },
  {
    id: 'candyloop', name: '星糖回廊', theme: 'candy', width: 1280, height: 760,
    start: { x: 640, y: 620 },
    obstacles: [
      { x: 520, y: 280, w: 240, h: 180 },
      { x: 240, y: 140, w: 200, h: 60 }, { x: 240, y: 200, w: 60, h: 120 },
      { x: 840, y: 140, w: 200, h: 60 }, { x: 980, y: 200, w: 60, h: 120 },
      { x: 240, y: 440, w: 60, h: 120 }, { x: 240, y: 560, w: 200, h: 60 },
      { x: 980, y: 440, w: 60, h: 120 }, { x: 840, y: 560, w: 200, h: 60 },
    ],
    spawnPoints: [{ x: 55, y: 95 }, { x: 1225, y: 95 }, { x: 55, y: 665 },
      { x: 1225, y: 665 }, { x: 640, y: 55 }, { x: 640, y: 715 }],
    speedZones: [
      { id: 'starlane-west', x: 345, y: 330, w: 130, h: 100, multiplier: 1.45 },
      { id: 'starlane-east', x: 805, y: 330, w: 130, h: 100, multiplier: 1.45 },
    ],
  },
];

const ENEMY_TYPES = {
  grunt: { radius: 17, hp: 40, speed: 67, damage: 12, score: 10 },
  runner: { radius: 14, hp: 28, speed: 116, damage: 9, score: 15 },
  tank: { radius: 25, hp: 170, speed: 44, damage: 22, score: 35 },
};
const difficultyFor = id => Object.values(DIFFICULTIES).find(difficulty => difficulty.id === id) || DIFFICULTIES.normal;
export function getWaveComposition(wave, difficultyId = 'normal') {
  const level = clamp(Math.floor(finite(wave, 1)), 1, MAX_WAVES);
  const difficulty = difficultyFor(difficultyId);
  const regularCount = Math.max(1, Math.round((5 + level * 3) * difficulty.regularMultiplier));
  const baseTanks = Math.floor((level - 1) / 2);
  const tankCount = baseTanks === 0 ? 0 : Math.max(1, Math.round(baseTanks * difficulty.tankMultiplier));
  return { regularCount, tankCount, total: regularCount + tankCount };
}
const UNLOCKS = { 1: 'smg', 2: 'shotgun', 3: 'rifle', 5: 'lmg', 7: 'sniper' };
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const BODY_GAP = .001;
const TOUCH_MARGIN = .05;

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// First intersection of a segment and a rectangle, in segment fractions [0,1].
export function segmentRect(ax, ay, bx, by, rect, padding = 0) {
  const dx = bx - ax, dy = by - ay;
  let lo = 0, hi = 1;
  for (const [origin, direction, min, max] of [
    [ax, dx, rect.x - padding, rect.x + rect.w + padding],
    [ay, dy, rect.y - padding, rect.y + rect.h + padding],
  ]) {
    if (Math.abs(direction) < 1e-9) {
      if (origin < min || origin > max) return null;
    } else {
      let a = (min - origin) / direction, b = (max - origin) / direction;
      if (a > b) [a, b] = [b, a];
      lo = Math.max(lo, a); hi = Math.min(hi, b);
      if (lo > hi) return null;
    }
  }
  return lo;
}

function segmentCircle(ax, ay, bx, by, cx, cy, radius) {
  const dx = bx - ax, dy = by - ay, ox = ax - cx, oy = ay - cy;
  const a = dx * dx + dy * dy;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-9) return null;
  const b = 2 * (ox * dx + oy * dy), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

// Navigation tests the open interior so a body touching a wall can move away.
// A circle-expanded rectangle has rounded corners, matching isBodyFree exactly.
function segmentRectInterior(ax, ay, bx, by, rect) {
  let lo = 0, hi = 1;
  for (const [origin, direction, min, max] of [
    [ax, bx - ax, rect.x, rect.x + rect.w],
    [ay, by - ay, rect.y, rect.y + rect.h],
  ]) {
    if (Math.abs(direction) < 1e-9) {
      if (origin <= min || origin >= max) return null;
    } else {
      let a = (min - origin) / direction, b = (max - origin) / direction;
      if (a > b) [a, b] = [b, a];
      lo = Math.max(lo, a); hi = Math.min(hi, b);
      if (hi - lo <= 1e-9) return null;
    }
  }
  return lo;
}

function segmentCircleInterior(ax, ay, bx, by, cx, cy, radius) {
  const dx = bx - ax, dy = by - ay, ox = ax - cx, oy = ay - cy;
  const a = dx * dx + dy * dy;
  const c = ox * ox + oy * oy - radius * radius;
  if (a < 1e-9) return c < 0 ? 0 : null;
  const b = 2 * (ox * dx + oy * dy), discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return null;
  const root = Math.sqrt(discriminant);
  const lo = Math.max(0, (-b - root) / (2 * a));
  const hi = Math.min(1, (-b + root) / (2 * a));
  return hi - lo > 1e-9 ? lo : null;
}

export function segmentRoundedRect(ax, ay, bx, by, rect, radius) {
  if (radius <= 0) return segmentRectInterior(ax, ay, bx, by, rect);
  const fractions = [
    segmentRectInterior(ax, ay, bx, by, { x: rect.x - radius, y: rect.y, w: rect.w + radius * 2, h: rect.h }),
    segmentRectInterior(ax, ay, bx, by, { x: rect.x, y: rect.y - radius, w: rect.w, h: rect.h + radius * 2 }),
  ];
  for (const x of [rect.x, rect.x + rect.w]) for (const y of [rect.y, rect.y + rect.h]) {
    fractions.push(segmentCircleInterior(ax, ay, bx, by, x, y, radius));
  }
  const hits = fractions.filter(value => value !== null);
  return hits.length ? Math.min(...hits) : null;
}

export class Game {
  constructor({ seed = 1, mapId = 'courtyard', difficultyId = 'normal' } = {}) {
    this.map = [...MAPS, ...LEGACY_MAPS].find(map => map.id === mapId) || MAPS[0];
    this.difficulty = difficultyFor(difficultyId);
    this.random = seededRandom(seed);
    this.nextId = 1;
    this.player = {
      ...this.map.start, radius: 18, angle: -Math.PI / 2, hp: 100, maxHp: 100,
      shield: 35, maxShield: 100, grenades: 3, maxGrenades: 8, speed: 225,
      currentWeapon: 'pistol', weapons: { pistol: this.makeAmmo('pistol') },
      invulnerability: 0, reviveProtectionRemaining: 0, speedMultiplier: 1, speedZoneId: null,
    };
    // Fixed stations respawn independently; barrels never block navigation or add wave enemies.
    this.barrels = (this.map.barrelStations || []).map(station => ({
      id: this.nextId++, stationId: station.id, x: station.x, y: station.y,
      radius: BARREL_RULES.radius, hp: BARREL_RULES.hp, maxHp: BARREL_RULES.hp,
      active: true, respawnRemaining: 0,
    }));
    this.enemies = [];
    this.bullets = [];
    this.grenades = [];
    this.pickups = [];
    this.effects = [];
    this.events = [];
    this.wave = 0;
    this.maxWaves = MAX_WAVES;
    this.status = 'intermission';
    this.score = 0;
    this.kills = 0;
    this.revivesRemaining = FREE_REVIVES;
    this.time = 0;
    this.waveKills = 0;
    this.waveTotal = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.previousInput = {};
    this.flowFields = new Map();
    this.navigationTimer = 0;
    this.startNextWave();
  }

  makeAmmo(id) {
    const def = WEAPONS[id];
    return { clip: def.clipSize, reserve: def.reserveMax, reloadRemaining: 0, cooldown: 0 };
  }

  startNextWave() {
    if (this.status !== 'intermission' || this.wave >= MAX_WAVES) return false;
    this.wave += 1;
    this.waveKills = 0;
    const composition = getWaveComposition(this.wave, this.difficulty.id);
    this.waveTotal = composition.total;
    this.status = 'playing';
    this.spawnTimer = 0.25;
    this.spawnQueue = [];
    for (let i = 0; i < composition.regularCount; i++) {
      const roll = this.random();
      const type = this.wave >= 2 && roll < 0.35 + this.wave * 0.018 ? 'runner' : 'grunt';
      this.spawnQueue.push(type);
    }
    for (let i = 0; i < composition.tankCount; i++) this.spawnQueue.splice(i * 5, 0, 'tank');
    this.events.push({ type: 'wave', wave: this.wave });
    return true;
  }

  equipWeapon(id) {
    if (!this.player.weapons[id]) return false;
    this.player.currentWeapon = id;
    this.events.push({ type: 'equip', weaponId: id });
    return true;
  }

  tryReload() {
    const id = this.player.currentWeapon, ammo = this.player.weapons[id], def = WEAPONS[id];
    if (ammo.reloadRemaining > 0 || ammo.clip >= def.clipSize || ammo.reserve <= 0) return false;
    ammo.reloadRemaining = def.reloadTime;
    this.events.push({ type: 'reload', weaponId: id });
    return true;
  }

  resolveGrenadeTarget(target) {
    const p = this.player, rules = GRENADE_RULES;
    const specified = Number.isFinite(target?.x) && Number.isFinite(target?.y);
    const angle = finite(p.angle, -Math.PI / 2);
    const dx = specified ? target.x - p.x : Math.cos(angle) * rules.defaultRange;
    const dy = specified ? target.y - p.y : Math.sin(angle) * rules.defaultRange;
    const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
    if (magnitude <= 1e-9) return { x: p.x, y: p.y };
    // Normalize through the largest component so even huge finite targets stay finite.
    const unitLength = Math.hypot(dx / magnitude, dy / magnitude);
    const distance = Math.min(rules.maxRange, Math.hypot(dx, dy));
    const vx = dx / magnitude / unitLength * distance, vy = dy / magnitude / unitLength * distance;
    let fraction = 1;
    if (vx > 0) fraction = Math.min(fraction, (this.map.width - rules.radius - p.x) / vx);
    else if (vx < 0) fraction = Math.min(fraction, (rules.radius - p.x) / vx);
    if (vy > 0) fraction = Math.min(fraction, (this.map.height - rules.radius - p.y) / vy);
    else if (vy < 0) fraction = Math.min(fraction, (rules.radius - p.y) / vy);
    fraction = clamp(fraction, 0, 1);
    const nx = p.x + vx * fraction, ny = p.y + vy * fraction;
    const pathLength = Math.hypot(nx - p.x, ny - p.y);
    let wallFraction = 1;
    for (const rect of this.map.obstacles) {
      const hit = segmentRect(p.x, p.y, nx, ny, rect, rules.radius);
      if (hit !== null) wallFraction = Math.min(wallFraction, Math.max(0, hit - .001 / Math.max(.001, pathLength)));
    }
    return {
      x: clamp(p.x + (nx - p.x) * wallFraction, rules.radius, this.map.width - rules.radius),
      y: clamp(p.y + (ny - p.y) * wallFraction, rules.radius, this.map.height - rules.radius),
    };
  }

  throwGrenade(target) {
    if (this.status !== 'playing' || this.player.grenades <= 0) return false;
    const p = this.player, point = this.resolveGrenadeTarget(target), rules = GRENADE_RULES;
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    const angle = distance > 1e-9 ? Math.atan2(point.y - p.y, point.x - p.x) : finite(p.angle, -Math.PI / 2);
    p.grenades -= 1;
    this.grenades.push({ id: this.nextId++, x: p.x, y: p.y, radius: rules.radius,
      angle, vx: Math.cos(angle) * rules.speed, vy: Math.sin(angle) * rules.speed,
      targetX: point.x, targetY: point.y,
      fuse: rules.fuse, maxFuse: rules.fuse, travelRemaining: distance / rules.speed });
    this.events.push({ type: 'grenade' });
    return true;
  }

  revive() {
    if (this.status !== 'dead' || this.revivesRemaining <= 0) return false;
    this.events = [];
    const p = this.player;
    const base = this.findFreePoint(this.map.start.x, this.map.start.y, p.radius);
    const safe = point => this.isBodyFree(point.x, point.y, p.radius)
      && !this.enemies.some(enemy => enemy.hp > 0 && distanceSquared(point, enemy) < (enemy.radius + p.radius + 60) ** 2);
    let point = base;
    if (!safe(base)) {
      const candidates = [];
      for (let y = 40; y < this.map.height; y += 40) for (let x = 40; x < this.map.width; x += 40) {
        const candidate = { x, y };
        if (safe(candidate)) candidates.push(candidate);
      }
      candidates.sort((a, b) => distanceSquared(a, this.map.start) - distanceSquared(b, this.map.start));
      point = candidates[0] || base;
    }
    p.x = point.x; p.y = point.y;
    p.hp = p.maxHp; p.shield = 35;
    p.invulnerability = 3; p.reviveProtectionRemaining = 3;
    this.revivesRemaining -= 1;
    this.status = 'playing';
    this.bullets = this.bullets.filter(bullet => bullet.owner !== 'enemy');
    this.grenades = [];
    this.previousInput = {};
    this.aimTarget = null;
    this.flowFields.clear(); this.navigationTimer = 0;
    this.syncSpeedZone();
    this.events.push({ type: 'revive', x: p.x, y: p.y, remaining: this.revivesRemaining });
    return true;
  }

  update(dt, input = {}) {
    dt = clamp(finite(dt), 0, 0.1);
    this.events = [];
    if (dt <= 0 || this.status === 'dead' || this.status === 'won') return;
    this.time += dt;
    const p = this.player;
    this.updateMap(dt);
    p.invulnerability = Math.max(0, p.invulnerability - dt);
    p.reviveProtectionRemaining = Math.max(0, p.reviveProtectionRemaining - dt);
    for (const [id, ammo] of Object.entries(p.weapons)) {
      ammo.cooldown = Math.max(-dt, ammo.cooldown - dt);
      if (ammo.reloadRemaining > 0) {
        ammo.reloadRemaining = Math.max(0, ammo.reloadRemaining - dt);
        if (ammo.reloadRemaining === 0) {
          const fill = Math.min(WEAPONS[id].clipSize - ammo.clip, ammo.reserve);
          ammo.clip += fill;
          if (Number.isFinite(ammo.reserve)) ammo.reserve -= fill;
          this.events.push({ type: 'reloaded', weaponId: id });
        }
      }
    }
    let mx = clamp(finite(input.moveX), -1, 1), my = clamp(finite(input.moveY), -1, 1);
    const movementLength = Math.hypot(mx, my);
    if (movementLength > 1) { mx /= movementLength; my /= movementLength; }
    this.movePlayer(mx, my, dt);
    if (Number.isFinite(input.aimX) && Number.isFinite(input.aimY)) {
      const dx = input.aimX - p.x, dy = input.aimY - p.y;
      if (Math.hypot(dx, dy) > 0.5) p.angle = Math.atan2(dy, dx);
    }
    const pressed = key => Boolean(input[key]) && !this.previousInput[key];
    if (input.weaponSlot !== undefined && input.weaponSlot !== null) {
      const id = typeof input.weaponSlot === 'number' ? WEAPON_ORDER[input.weaponSlot] : input.weaponSlot;
      if (id !== p.currentWeapon) this.equipWeapon(id);
    }
    if (pressed('weaponNext')) {
      const owned = WEAPON_ORDER.filter(id => p.weapons[id]);
      this.equipWeapon(owned[(owned.indexOf(p.currentWeapon) + 1) % owned.length]);
    }
    if (pressed('reload')) this.tryReload();
    if (pressed('grenade')) this.throwGrenade(input.grenadeTarget);
    this.previousInput = { grenade: Boolean(input.grenade), reload: Boolean(input.reload), weaponNext: Boolean(input.weaponNext) };
    if (this.status === 'playing') {
      if (input.shoot) this.fire();
      this.updateSpawns(dt);
      // Resolve player attacks before a defeated boss can finish its wind-up.
      this.updateBullets(dt);
      this.updateGrenades(dt);
      this.updateEnemies(dt);
    }
    this.updatePickups(dt);
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter(effect => effect.life > 0);
    if (p.hp <= 0) {
      p.hp = 0;
      this.status = 'dead';
      this.events.push({ type: 'dead' });
    } else if (this.status === 'playing' && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.clearWave();
    }
  }

  fire() {
    const p = this.player, id = p.currentWeapon, def = WEAPONS[id], ammo = p.weapons[id];
    if (ammo.reloadRemaining > 0) return;
    if (ammo.clip <= 0) { this.tryReload(); return; }
    // Carry fractional cadence across frames, with a strict bound for stalled frames.
    let shots = 0;
    while (ammo.cooldown <= 0 && ammo.clip > 0 && shots < 3) {
      shots += 1;
      ammo.clip -= 1;
      ammo.cooldown += def.fireInterval;
      const pellets = def.pellets || 1;
      for (let pellet = 0; pellet < pellets; pellet++) {
        const spread = pellets === 1 ? (this.random() * 2 - 1) * def.spread
          : (pellet / (pellets - 1) * 2 - 1) * def.spread;
        const angle = p.angle + spread;
        const offset = p.radius + 9;
        const muzzleX = p.x + Math.cos(angle) * offset;
        const muzzleY = p.y + Math.sin(angle) * offset;
        // Keep the muzzle in the arena and prevent shooting through an adjacent wall.
        const muzzleBlocked = this.map.obstacles.some(rect => segmentRect(p.x, p.y, muzzleX, muzzleY, rect) !== null);
        const x = muzzleBlocked ? p.x : muzzleX, y = muzzleBlocked ? p.y : muzzleY;
        this.bullets.push({ id: this.nextId++, x, y, prevX: x, prevY: y, radius: 3,
          vx: Math.cos(angle) * def.bulletSpeed, vy: Math.sin(angle) * def.bulletSpeed,
          damage: def.damage, remainingHits: def.piercing, hitIds: new Set(),
          owner: 'player', weapon: id, distanceTravelled: 0, maxRange: def.range,
          life: def.range ? def.range / def.bulletSpeed : id === 'sniper' ? 1.1 : 0.95 });
        if (pellet === 0) {
          this.events.push({ type: 'shot', weaponId: id, x, y });
          this.addEffect('muzzle', x, y, 12, 0.075, def.color, { angle: p.angle, weaponId: id });
        }
      }
    }
    if (ammo.clip === 0) this.tryReload();
  }

  updateSpawns(dt) {
    this.spawnTimer -= dt;
    if (this.spawnQueue.length === 0 || this.spawnTimer > 0 || this.enemies.length >= 28) return;
    const type = this.spawnQueue[0], def = ENEMY_TYPES[type], difficulty = this.difficulty;
    const available = this.map.spawnPoints.filter(point => distanceSquared(point, this.player) > 220 ** 2);
    const points = available.length ? available : this.map.spawnPoints;
    const first = Math.floor(this.random() * points.length);
    let point = null;
    for (let offset = 0; offset < points.length && !point; offset++) {
      const station = points[(first + offset) % points.length];
      point = this.findFreeEntityPoint(station.x, station.y, def.radius);
    }
    if (!point) {
      // A crowded entrance retries later; never consume a queued enemy or stack bodies.
      this.spawnTimer = .1;
      return;
    }
    this.spawnQueue.shift();
    const hp = Math.round(def.hp * (1 + (this.wave - 1) * 0.045) * difficulty.hpMultiplier);
    const enemy = { id: this.nextId++, x: point.x, y: point.y, type, radius: def.radius,
      hp, maxHp: hp, speed: def.speed * (1 + (this.wave - 1) * 0.025) * difficulty.speedMultiplier,
      damage: def.damage * difficulty.damageMultiplier, angle: 0, hitFlash: 0 };
    if (type === 'tank') {
      enemy.rangedCooldown = difficulty.bossInterval - difficulty.bossWindup;
      enemy.rangedCharge = 0;
      enemy.rangedWindup = difficulty.bossWindup;
      enemy.attackAngle = 0;
      this.events.push({ type: 'bossSpawn', wave: this.wave });
    }
    this.enemies.push(enemy);
    this.spawnTimer += Math.max(0.24, 0.7 - this.wave * 0.036) * difficulty.spawnIntervalMultiplier;
  }

  isBodyFree(x, y, radius) {
    if (x < radius || y < radius || x > this.map.width - radius || y > this.map.height - radius) return false;
    return !this.map.obstacles.some(rect => {
      const nearX = clamp(x, rect.x, rect.x + rect.w), nearY = clamp(y, rect.y, rect.y + rect.h);
      return (x - nearX) ** 2 + (y - nearY) ** 2 < radius ** 2;
    });
  }

  bodyPeers(body) {
    const peers = this.enemies.filter(enemy => enemy !== body && enemy.hp > 0);
    if (body !== this.player && this.player.hp > 0) peers.push(this.player);
    return peers;
  }

  isEntityFree(x, y, radius, body = null) {
    return this.isBodyFree(x, y, radius) && this.bodyPeers(body)
      .every(other => (x - other.x) ** 2 + (y - other.y) ** 2 >= (radius + other.radius + BODY_GAP) ** 2);
  }

  findFreeEntityPoint(x, y, radius) {
    if (this.isEntityFree(x, y, radius)) return { x, y };
    // Search close to this entrance so a packed spawn does not teleport to the player.
    for (let ring = 36; ring <= 144; ring += 36) for (let index = 0; index < 16; index++) {
      const angle = index / 16 * TAU;
      const px = x + Math.cos(angle) * ring, py = y + Math.sin(angle) * ring;
      if (this.isEntityFree(px, py, radius)) return { x: px, y: py };
    }
    return null;
  }

  syncSpeedZone() {
    const p = this.player;
    const zone = (this.map.speedZones || []).find(area => p.x >= area.x && p.x < area.x + area.w
      && p.y >= area.y && p.y < area.y + area.h);
    const zoneId = zone?.id || null;
    p.speedMultiplier = zone?.multiplier || 1;
    if (p.speedZoneId !== zoneId) {
      p.speedZoneId = zoneId;
      this.events.push({ type: 'speedBoost', active: Boolean(zone), zoneId, multiplier: p.speedMultiplier });
    }
  }

  movePlayer(mx, my, dt) {
    const p = this.player;
    const maxBoost = Math.max(1, ...(this.map.speedZones || []).map(zone => zone.multiplier));
    // Small movement steps recheck zone edges and keep acceleration from leaking into open ground.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) * p.speed * maxBoost * dt / 6));
    for (let i = 0; i < steps; i++) {
      this.syncSpeedZone();
      this.moveBody(p, mx * p.speed * p.speedMultiplier * dt / steps, my * p.speed * p.speedMultiplier * dt / steps);
    }
    this.syncSpeedZone();
  }

  updateMap(dt) {
    for (const barrel of this.barrels) if (!barrel.active) {
      barrel.respawnRemaining = Math.max(0, barrel.respawnRemaining - dt);
      if (barrel.respawnRemaining <= 1e-7) {
        barrel.active = true;
        barrel.hp = barrel.maxHp;
        barrel.respawnRemaining = 0;
        this.addEffect('barrelRespawn', barrel.x, barrel.y, 30, 0.55, '#71e8e0');
        this.events.push({ type: 'barrelRespawn', barrelId: barrel.id, x: barrel.x, y: barrel.y });
      }
    }
  }

  environmentSnapshot() {
    return {
      barrels: this.barrels.map(({ id, stationId, x, y, radius, hp, maxHp, active, respawnRemaining }) =>
        ({ id, stationId, x, y, radius, hp, maxHp, active, respawnRemaining })),
      speedZones: (this.map.speedZones || []).map(zone => ({ ...zone })),
      speedMultiplier: this.player.speedMultiplier,
      speedZoneId: this.player.speedZoneId,
    };
  }

  moveBody(body, dx, dy) {
    // Bodies slide along walls and stop at other circles. Sweeps also cover fast frames.
    // Only the moving body changes position; crowds never push or teleport the player.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
    for (let i = 0; i < steps; i++) {
      this.moveBodyAxis(body, dx / steps, 0);
      this.moveBodyAxis(body, 0, dy / steps);
    }
  }

  moveBodyAxis(body, dx, dy) {
    const nx = clamp(body.x + dx, body.radius, this.map.width - body.radius);
    const ny = clamp(body.y + dy, body.radius, this.map.height - body.radius);
    const vx = nx - body.x, vy = ny - body.y, distance = Math.hypot(vx, vy);
    if (distance < 1e-9) return;
    let fraction = 1;
    for (const rect of this.map.obstacles) {
      const hit = segmentRoundedRect(body.x, body.y, nx, ny, rect, body.radius);
      if (hit !== null) fraction = Math.min(fraction, Math.max(0, hit - .00001 / distance));
    }
    for (const other of this.bodyPeers(body)) {
      const radius = body.radius + other.radius + BODY_GAP;
      const ox = body.x - other.x, oy = body.y - other.y;
      if (ox * ox + oy * oy < radius * radius) {
        // Legacy/manual overlap may leave in an outward direction, never penetrate further.
        if (ox * vx + oy * vy < -1e-9 || (nx - other.x) ** 2 + (ny - other.y) ** 2 < ox * ox + oy * oy) fraction = 0;
        continue;
      }
      const hit = segmentCircleInterior(body.x, body.y, nx, ny, other.x, other.y, radius);
      if (hit !== null) fraction = Math.min(fraction, Math.max(0, hit - .00001 / distance));
    }
    const x = body.x + vx * fraction, y = body.y + vy * fraction;
    if (this.isBodyFree(x, y, body.radius)) { body.x = x; body.y = y; }
  }

  clearPath(ax, ay, bx, by, radius) {
    return !this.map.obstacles.some(rect => segmentRoundedRect(ax, ay, bx, by, rect, radius) !== null);
  }

  buildFlowField(radius) {
    const cell = 40, cols = Math.ceil(this.map.width / cell), rows = Math.ceil(this.map.height / cell);
    const valid = new Uint8Array(cols * rows), distances = new Int16Array(cols * rows).fill(-1);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const px = x * cell + cell / 2;
      const py = y * cell + cell / 2;
      valid[y * cols + x] = Number(this.isBodyFree(px, py, radius + 1));
    }
    let goal = -1, best = Infinity;
    for (let i = 0; i < valid.length; i++) if (valid[i]) {
      const px = i % cols * cell + cell / 2, py = Math.floor(i / cols) * cell + cell / 2;
      const d = (px - this.player.x) ** 2 + (py - this.player.y) ** 2;
      if (d < best) { best = d; goal = i; }
    }
    const queue = goal >= 0 ? [goal] : [];
    if (goal >= 0) distances[goal] = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % cols, y = Math.floor(index / cols);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox, ny = y + oy, next = ny * cols + nx;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !valid[next] || distances[next] >= 0) continue;
        if (!this.clearPath(x * cell + cell / 2, y * cell + cell / 2, nx * cell + cell / 2, ny * cell + cell / 2, radius + 1)) continue;
        distances[next] = distances[index] + 1;
        queue.push(next);
      }
    }
    return { cell, cols, rows, valid, distances };
  }

  navigationTarget(enemy) {
    const radius = enemy.radius - 0.01;
    if (this.clearPath(enemy.x, enemy.y, this.player.x, this.player.y, radius)) return this.player;
    let field = this.flowFields.get(enemy.radius);
    if (!field) { field = this.buildFlowField(enemy.radius); this.flowFields.set(enemy.radius, field); }
    const cx = clamp(Math.floor(enemy.x / field.cell), 0, field.cols - 1);
    const cy = clamp(Math.floor(enemy.y / field.cell), 0, field.rows - 1);
    let best = null, bestCost = Infinity;
    // A nearby reachable grid center lets an enemy recover from a wall-adjacent cell.
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const x = cx + ox, y = cy + oy;
      if (x < 0 || y < 0 || x >= field.cols || y >= field.rows) continue;
      const index = y * field.cols + x;
      if (!field.valid[index] || field.distances[index] < 0) continue;
      const target = { x: x * field.cell + field.cell / 2, y: y * field.cell + field.cell / 2 };
      if (!this.clearPath(enemy.x, enemy.y, target.x, target.y, radius)) continue;
      // Slightly prefer progress along the field over staying on an equal-cost center.
      const cost = field.distances[index] * field.cell + Math.hypot(target.x - enemy.x, target.y - enemy.y) * 0.72;
      if (cost < bestCost) { best = target; bestCost = cost; }
    }
    return best || this.player;
  }

  updateEnemies(dt) {
    const touching = enemy => enemy.hp > 0
      && distanceSquared(enemy, this.player) <= (enemy.radius + this.player.radius + TOUCH_MARGIN) ** 2;
    // Remember existing contact before repairing legacy/manual overlaps.
    const priorContact = this.enemies.find(touching);
    this.navigationTimer -= dt;
    if (this.navigationTimer <= 0) { this.flowFields.clear(); this.navigationTimer = 0.4; }
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const charging = this.updateRangedAttack(enemy, dt);
      enemy.angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      if (charging) continue;
      const target = this.navigationTarget(enemy);
      let dx = target.x - enemy.x, dy = target.y - enemy.y;
      const length = Math.hypot(dx, dy);
      if (length > 1) { dx /= length; dy /= length; } else { dx = 0; dy = 0; }
      this.moveBody(enemy, dx * enemy.speed * dt, dy * enemy.speed * dt);
    }
    this.separateEnemyBodies();
    if (this.player.invulnerability <= 0) {
      // At most one touch hit per grace interval, independent of crowd size.
      const contact = priorContact || this.enemies.find(touching);
      if (contact) this.damagePlayer(contact.damage);
    }
  }

  separateEnemyBodies() {
    // Swept movement and free spawns prevent overlap during ordinary play. Repair older
    // states gently, with a four-pixel budget per enemy and no positional player push.
    const budgets = new Map(this.enemies.map(enemy => [enemy, 4]));
    const correct = (enemy, dx, dy) => {
      const distance = Math.hypot(dx, dy), budget = budgets.get(enemy);
      if (distance < 1e-9 || budget <= 0) return;
      const length = Math.min(distance, budget);
      const before = { x: enemy.x, y: enemy.y };
      this.moveBody(enemy, dx / distance * length, dy / distance * length);
      budgets.set(enemy, budget - Math.hypot(enemy.x - before.x, enemy.y - before.y));
    };
    const separate = (a, b, share) => {
      const minimum = a.radius + b.radius + BODY_GAP;
      let dx = a.x - b.x, dy = a.y - b.y, distance = Math.hypot(dx, dy);
      if (distance >= minimum) return;
      if (distance < 1e-9) {
        const angle = (a.id || 1) * 2.399963229728653;
        dx = Math.cos(angle); dy = Math.sin(angle); distance = 1;
      } else { dx /= distance; dy /= distance; }
      const correction = minimum - Math.hypot(a.x - b.x, a.y - b.y);
      correct(a, dx * correction * (share ? .5 : 1), dy * correction * (share ? .5 : 1));
      if (share) correct(b, -dx * correction * .5, -dy * correction * .5);
    };
    for (const enemy of this.enemies) if (enemy.hp > 0) separate(enemy, this.player, false);
    for (let i = 0; i < this.enemies.length; i++) for (let j = i + 1; j < this.enemies.length; j++) {
      const a = this.enemies[i], b = this.enemies[j];
      if (a.hp > 0 && b.hp > 0) separate(a, b, true);
    }
  }

  updateRangedAttack(enemy, dt) {
    if (enemy.type !== 'tank' || enemy.hp <= 0) return false;
    const difficulty = this.difficulty;
    if (enemy.rangedCharge > 0) {
      const remaining = enemy.rangedCharge - dt;
      enemy.rangedCharge = Math.max(0, remaining);
      if (remaining <= 0) {
        this.fireBossVolley(enemy);
        enemy.rangedCooldown = difficulty.bossInterval - difficulty.bossWindup + remaining;
      }
      return true;
    }
    enemy.rangedCooldown = finite(enemy.rangedCooldown, difficulty.bossInterval - difficulty.bossWindup) - dt;
    if (enemy.rangedCooldown <= 0) {
      enemy.attackAngle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      enemy.rangedWindup = difficulty.bossWindup;
      enemy.rangedCharge = difficulty.bossWindup + enemy.rangedCooldown;
      enemy.rangedCooldown = 0;
      this.events.push({ type: 'bossCharge', enemyId: enemy.id });
      return true;
    }
    return false;
  }

  fireBossVolley(enemy) {
    const difficulty = this.difficulty;
    const speed = BOSS_ATTACK.bulletSpeed * difficulty.bossBulletSpeedMultiplier;
    for (const spread of [-BOSS_ATTACK.spread, 0, BOSS_ATTACK.spread]) {
      const angle = enemy.attackAngle + spread;
      // Starting at the body center means a close wall cannot be bypassed by the muzzle.
      this.bullets.push({ id: this.nextId++, x: enemy.x, y: enemy.y, prevX: enemy.x, prevY: enemy.y,
        radius: BOSS_ATTACK.radius, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        damage: BOSS_ATTACK.damage * difficulty.damageMultiplier, remainingHits: 1, hitIds: new Set(), owner: 'enemy', weapon: 'bossOrb', life: BOSS_ATTACK.life });
    }
    this.events.push({ type: 'bossVolley', enemyId: enemy.id });
  }

  damagePlayer(amount) {
    amount = Math.max(0, finite(amount));
    const absorbed = Math.min(this.player.shield, amount);
    this.player.shield -= absorbed;
    this.player.hp = Math.max(0, this.player.hp - (amount - absorbed));
    this.player.invulnerability = 0.65;
    this.addEffect('damage', this.player.x, this.player.y, 34, 0.25, '#ff6b81');
    this.events.push({ type: 'damage', amount, absorbed });
  }

  updateBullets(dt) {
    for (const bullet of this.bullets) {
      bullet.prevX = bullet.x; bullet.prevY = bullet.y;
      const speed = Math.hypot(bullet.vx, bullet.vy);
      const travelled = finite(bullet.distanceTravelled);
      const rangeRemaining = Number.isFinite(bullet.maxRange) ? Math.max(0, bullet.maxRange - travelled) : Infinity;
      const travelDt = Math.min(dt, Math.max(0, bullet.life), speed > 0 ? rangeRemaining / speed : dt);
      if (travelDt <= 0) { bullet.life = 0; continue; }
      const nx = bullet.x + bullet.vx * travelDt, ny = bullet.y + bullet.vy * travelDt;
      const stepDistance = speed * travelDt;
      let wallT = 1;
      for (const rect of this.map.obstacles) {
        const t = segmentRect(bullet.x, bullet.y, nx, ny, rect, bullet.radius);
        if (t !== null) wallT = Math.min(wallT, t);
      }
      if (bullet.owner === 'enemy') {
        const p = this.player;
        const playerT = segmentCircle(bullet.x, bullet.y, nx, ny, p.x, p.y, p.radius + bullet.radius);
        let endT = wallT;
        if (playerT !== null && playerT < wallT) {
          if (p.hp > 0 && p.invulnerability <= 0) this.damagePlayer(bullet.damage);
          endT = playerT;
          bullet.life = 0;
        }
        bullet.x += (nx - bullet.x) * endT;
        bullet.y += (ny - bullet.y) * endT;
        bullet.distanceTravelled = travelled + stepDistance * endT;
        bullet.life -= dt;
        if (wallT < 1 || bullet.x < 0 || bullet.y < 0 || bullet.x > this.map.width || bullet.y > this.map.height) bullet.life = 0;
        continue;
      }
      const hits = [];
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0 || bullet.hitIds.has(enemy.id)) continue;
        const t = segmentCircle(bullet.x, bullet.y, nx, ny, enemy.x, enemy.y, enemy.radius + bullet.radius);
        if (t !== null && t < wallT) hits.push({ enemy, t });
      }
      for (const barrel of this.barrels) {
        if (!barrel.active || bullet.hitIds.has(barrel.id)) continue;
        const t = segmentCircle(bullet.x, bullet.y, nx, ny, barrel.x, barrel.y, barrel.radius + bullet.radius);
        if (t !== null && t < wallT) hits.push({ barrel, t });
      }
      hits.sort((a, b) => a.t - b.t);
      let endT = wallT;
      for (const { enemy, barrel, t } of hits) {
        // A preceding blast may already have defeated a later target in this sweep.
        if (enemy ? enemy.hp <= 0 : !barrel.active) continue;
        const def = WEAPONS[bullet.weapon];
        const hitDistance = travelled + stepDistance * t;
        const falloff = def?.falloffStart === undefined ? 1
          : clamp(1 - (hitDistance - def.falloffStart) / (def.range - def.falloffStart) * (1 - def.minDamageRatio), def.minDamageRatio, 1);
        if (enemy) this.damageEnemy(enemy, bullet.damage * falloff);
        else this.damageBarrel(barrel, bullet.damage * falloff);
        bullet.hitIds.add((enemy || barrel).id);
        bullet.remainingHits -= 1;
        if (bullet.remainingHits <= 0) { endT = t; bullet.life = 0; break; }
      }
      bullet.x += (nx - bullet.x) * endT;
      bullet.y += (ny - bullet.y) * endT;
      bullet.distanceTravelled = travelled + stepDistance * endT;
      bullet.life -= dt;
      if (Number.isFinite(bullet.maxRange) && bullet.distanceTravelled >= bullet.maxRange - 1e-7) bullet.life = 0;
      if (wallT < 1 || bullet.x < 0 || bullet.y < 0 || bullet.x > this.map.width || bullet.y > this.map.height) bullet.life = 0;
    }
    this.bullets = this.bullets.filter(bullet => bullet.life > 0);
    this.enemies = this.enemies.filter(enemy => enemy.hp > 0);
  }

  damageEnemy(enemy, damage) {
    damage = Math.max(0, finite(damage));
    if (enemy.hp <= 0 || damage <= 0) return;
    enemy.hp -= damage;
    enemy.hitFlash = 0.09;
    this.addEffect('hit', enemy.x, enemy.y, 12, 0.14, '#fff1c9');
    this.events.push({ type: 'hit', enemyType: enemy.type, x: enemy.x, y: enemy.y });
    if (enemy.hp <= 0) {
      this.kills += 1; this.waveKills += 1;
      this.score += ENEMY_TYPES[enemy.type]?.score || 10;
      this.events.push({ type: 'kill', enemyType: enemy.type, x: enemy.x, y: enemy.y });
      this.dropLoot(enemy.x, enemy.y);
    }
  }

  damageBarrel(barrel, damage) {
    damage = Math.max(0, finite(damage));
    if (!barrel.active || damage <= 0) return;
    barrel.hp = Math.max(0, barrel.hp - damage);
    this.addEffect('hit', barrel.x, barrel.y, 17, 0.14, '#ffdc91');
    if (barrel.hp <= 0) this.explodeBarrel(barrel);
  }

  damageBlast(x, y, radius, damage) {
    for (const enemy of this.enemies) {
      const distance = Math.hypot(enemy.x - x, enemy.y - y);
      if (distance <= radius + enemy.radius) this.damageEnemy(enemy, damage * Math.max(0.4, 1 - distance / (radius * 1.6)));
    }
  }

  explodeBarrel(first) {
    const queue = [first];
    let playerDamage = 0;
    for (let index = 0; index < queue.length; index++) {
      const barrel = queue[index];
      if (!barrel.active) continue;
      // Mark it consumed before damage and chained barrels: each station explodes once per refresh.
      barrel.active = false;
      barrel.hp = 0;
      barrel.respawnRemaining = BARREL_RULES.respawnSeconds;
      this.addEffect('barrelExplosion', barrel.x, barrel.y, BARREL_RULES.blastRadius, 0.55, '#ffae66');
      this.damageBlast(barrel.x, barrel.y, BARREL_RULES.blastRadius, BARREL_RULES.damage);
      const distance = Math.hypot(this.player.x - barrel.x, this.player.y - barrel.y);
      if (distance <= BARREL_RULES.blastRadius + this.player.radius) {
        playerDamage = Math.max(playerDamage, BARREL_RULES.playerDamage
          * Math.max(.4, 1 - distance / (BARREL_RULES.blastRadius * 1.6)));
      }
      this.events.push({ type: 'barrelExplosion', barrelId: barrel.id, x: barrel.x, y: barrel.y });
      for (const other of this.barrels) {
        if (other.active && distanceSquared(other, barrel) <= (BARREL_RULES.blastRadius + other.radius) ** 2) queue.push(other);
      }
    }
    // One chain is one player hit, even when several station blasts overlap.
    if (playerDamage > 0 && this.player.hp > 0 && this.player.invulnerability <= 0) this.damagePlayer(playerDamage);
  }

  updateGrenades(dt) {
    for (const grenade of this.grenades) {
      if (grenade.travelRemaining > 0) {
        const travel = Math.min(dt, grenade.travelRemaining);
        grenade.x += grenade.vx * travel; grenade.y += grenade.vy * travel;
        grenade.travelRemaining = Math.max(0, grenade.travelRemaining - travel);
        if (grenade.travelRemaining <= 1e-7) {
          grenade.x = grenade.targetX; grenade.y = grenade.targetY;
          grenade.travelRemaining = 0;
        }
      }
      grenade.fuse -= dt;
      if (grenade.fuse <= 0) {
        const blastRadius = GRENADE_RULES.blastRadius;
        this.addEffect('explosion', grenade.x, grenade.y, blastRadius, 0.5, '#ffcf78');
        this.damageBlast(grenade.x, grenade.y, blastRadius, GRENADE_RULES.damage);
        for (const barrel of this.barrels) {
          if (barrel.active && distanceSquared(barrel, grenade) <= (blastRadius + barrel.radius) ** 2) this.explodeBarrel(barrel);
        }
        this.events.push({ type: 'explosion', x: grenade.x, y: grenade.y });
      }
    }
    this.grenades = this.grenades.filter(grenade => grenade.fuse > 0);
    this.enemies = this.enemies.filter(enemy => enemy.hp > 0);
  }

  addEffect(type, x, y, radius, life, color, extra = {}) {
    this.effects.push({ id: this.nextId++, type, x, y, radius, life, maxLife: life, color, ...extra });
    if (this.effects.length > 160) this.effects.shift();
  }

  spawnPickup(type, x, y, extra = {}) {
    const point = this.findFreePoint(x, y, 12);
    const pickup = { id: this.nextId++, type, ...point, radius: 12, ttl: 28, ...extra };
    this.pickups.push(pickup);
    if (this.pickups.length > 70) this.pickups.shift();
    return pickup;
  }

  findFreePoint(x, y, radius) {
    x = clamp(x, radius + 3, this.map.width - radius - 3);
    y = clamp(y, radius + 3, this.map.height - radius - 3);
    if (this.isBodyFree(x, y, radius)) return { x, y };
    for (let ring = 24; ring <= 192; ring += 24) for (let i = 0; i < 16; i++) {
      const angle = i / 16 * TAU, px = clamp(x + Math.cos(angle) * ring, radius, this.map.width - radius);
      const py = clamp(y + Math.sin(angle) * ring, radius, this.map.height - radius);
      if (this.isBodyFree(px, py, radius)) return { x: px, y: py };
    }
    return { ...this.map.start };
  }

  dropLoot(x, y) {
    const roll = this.random();
    if (roll < 0.13) this.spawnPickup('ammo', x, y);
    else if (roll < 0.19) this.spawnPickup('shield', x, y);
    else if (roll < 0.235) this.spawnPickup('health', x, y);
    else if (roll < 0.28) this.spawnPickup('grenade', x, y);
    else if (roll < 0.32) {
      const available = WEAPON_ORDER.filter(id => id !== 'pistol' && this.player.weapons[id]);
      if (available.length) this.spawnPickup('weapon', x, y, { weaponId: available[Math.floor(this.random() * available.length)] });
      else this.spawnPickup('ammo', x, y);
    }
  }

  collectPickup(pickup) {
    const p = this.player;
    if (pickup.type === 'weapon') {
      const id = pickup.weaponId;
      if (!WEAPONS[id]) return;
      const unlocked = !p.weapons[id];
      p.weapons[id] = this.makeAmmo(id);
      this.events.push({ type: unlocked ? 'unlock' : 'ammo', weaponId: id });
    } else if (pickup.type === 'ammo') {
      for (const [id, ammo] of Object.entries(p.weapons)) {
        ammo.clip = WEAPONS[id].clipSize;
        ammo.reserve = WEAPONS[id].reserveMax;
        ammo.reloadRemaining = 0;
      }
    } else if (pickup.type === 'shield') p.shield = Math.min(p.maxShield, p.shield + 40);
    else if (pickup.type === 'health') p.hp = Math.min(p.maxHp, p.hp + 25);
    else if (pickup.type === 'grenade') p.grenades = Math.min(p.maxGrenades, p.grenades + 2);
    this.addEffect('pickup', pickup.x, pickup.y, 28, 0.35, '#b7ffd8');
    this.events.push({ type: 'pickup', pickupType: pickup.type, weaponId: pickup.weaponId });
  }

  updatePickups(dt) {
    for (const pickup of this.pickups) {
      pickup.ttl -= dt;
      if (this.player.hp > 0 && distanceSquared(pickup, this.player) <= (pickup.radius + this.player.radius + 9) ** 2) {
        this.collectPickup(pickup);
        pickup.ttl = 0;
      }
    }
    this.pickups = this.pickups.filter(pickup => pickup.ttl > 0);
  }

  clearWave() {
    if (this.status !== 'playing') return false;
    this.bullets = [];
    this.grenades = [];
    this.score += this.wave * 100;
    this.events.push({ type: 'waveClear', wave: this.wave });
    if (this.wave >= MAX_WAVES) {
      this.status = 'won';
      this.events.push({ type: 'won' });
      return;
    }
    this.status = 'intermission';
    const p = this.player;
    const drops = [['ammo', -55, 0], ['shield', 55, 0], ['grenade', 0, 55], ['health', 0, -55]];
    for (const [type, dx, dy] of drops) this.spawnPickup(type, p.x + dx, p.y + dy, { guaranteed: true });
    const unlock = UNLOCKS[this.wave];
    if (unlock) {
      // Permanent wave reward guarantees progression even if a player misses a drop.
      p.weapons[unlock] ||= this.makeAmmo(unlock);
      this.spawnPickup('weapon', p.x + 82, p.y + 55, { weaponId: unlock, guaranteed: true });
      this.events.push({ type: 'unlock', weaponId: unlock });
    }
    this.startNextWave();
  }
}
