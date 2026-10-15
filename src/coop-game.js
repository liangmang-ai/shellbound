import { Game, FREE_REVIVES } from './game.js';

const localEvents = new Set(['equip', 'reload', 'reloaded', 'boostActivation', 'grenade', 'shot',
  'revive', 'speedBoost', 'unlock', 'ammo', 'pickup']);
const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// The authoritative room runs one world, applying each participant's input before
// advancing enemies, projectiles, map timers, and waves exactly once per tick.
export class CoopGame extends Game {
  constructor(options = {}) {
    super(options);
    this.player.id = 'p1';
    this.player.revivesRemaining = FREE_REVIVES;
    const second = { ...this.player, id: 'p2', weapons: { pistol: this.makeAmmo('pistol') } };
    this.players = { p1: this.player, p2: second };
    const start = this.findFreeEntityPoint(this.player.x + 72, this.player.y, second.radius, second)
      || this.findFreeEntityPoint(this.player.x - 72, this.player.y, second.radius, second);
    if (!start) throw new Error('Map has no free cooperative spawn point');
    Object.assign(second, start);
    this.previousInputs = { p1: {}, p2: {} };
  }

  getPlayers() { return this.players ? Object.values(this.players) : super.getPlayers(); }

  get teamStatus() { return this.status; }

  playerFor(playerId) { return playerId === 'p1' || playerId === 'p2' ? this.players[playerId] : null; }

  withPlayer(playerId, action) {
    const selected = this.playerFor(playerId);
    if (!selected) throw new Error('Unknown player');
    const prior = this.player, previousInput = this.previousInput, revives = this.revivesRemaining;
    const firstEvent = this.events.length;
    this.player = selected;
    this.previousInput = this.previousInputs[playerId];
    this.revivesRemaining = selected.revivesRemaining;
    try { return action(selected); }
    finally {
      selected.revivesRemaining = this.revivesRemaining;
      this.previousInputs[playerId] = this.previousInput;
      for (const event of this.events.slice(firstEvent)) {
        if (!event.playerId && localEvents.has(event.type)) event.playerId = playerId;
      }
      this.player = prior;
      this.previousInput = previousInput;
      this.revivesRemaining = prior === selected ? selected.revivesRemaining : revives;
    }
  }

  performAction(playerId, action, payload = {}) {
    const player = this.playerFor(playerId);
    if (!player) return false;
    if (action === 'revive') return this.revive(playerId);
    if (this.status !== 'playing' || player.hp <= 0) return false;
    if (!payload || typeof payload !== 'object') payload = {};
    return this.withPlayer(playerId, () => {
      if (action === 'boost') return this.activateBoost();
      if (action === 'grenade') return this.throwGrenade(payload.target);
      if (action === 'weapon') return this.equipWeapon(payload.weaponId);
      return false;
    });
  }

  update(dt, inputs = {}) {
    dt = Math.min(.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.events = [];
    if (dt <= 0 || this.status === 'dead' || this.status === 'won') return;
    this.time += dt;
    this.updateMap(dt);
    for (const player of this.livingPlayers()) {
      this.withPlayer(player.id, () => this.updatePlayer(dt, inputs?.[player.id] || {}));
    }
    if (this.status === 'playing') {
      this.updateSpawns(dt);
      this.updateBullets(dt);
      this.updateGrenades(dt);
      this.updateEnemies(dt);
    }
    this.updatePickups(dt);
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter(effect => effect.life > 0);
    for (const player of this.getPlayers()) {
      if (player.hp <= 0) {
        player.hp = 0;
        if (!player.downed) this.events.push({ type: 'dead', playerId: player.id });
        player.downed = true;
      }
    }
    if (this.livingPlayers().length === 0) this.status = 'dead';
    else if (this.status === 'playing' && this.spawnQueue.length === 0 && this.enemies.length === 0) this.clearWave();
  }

  updatePickups(dt) {
    for (const pickup of this.pickups) {
      pickup.ttl -= dt;
      if (pickup.ttl <= 0) continue;
      const player = this.livingPlayers().find(candidate =>
        squaredDistance(pickup, candidate) <= (pickup.radius + candidate.radius + 9) ** 2);
      if (player) {
        this.withPlayer(player.id, () => this.collectPickup(pickup));
        pickup.ttl = 0;
      }
    }
    this.pickups = this.pickups.filter(pickup => pickup.ttl > 0);
  }

  clearWave() {
    const wave = this.wave;
    const firstEvent = this.events.length;
    const cleared = super.clearWave();
    if (!cleared) return false;
    // The base implementation awards p1 and advances the shared wave. Mirror only
    // permanent progression; the physical reward drops remain shared pickups.
    for (const event of this.events.slice(firstEvent)) if (event.type === 'unlock' && !event.playerId) {
      event.playerId = 'p1';
      const id = event.weaponId;
      this.players.p2.weapons[id] ||= this.makeAmmo(id);
      this.events.push({ type: 'unlock', weaponId: id, playerId: 'p2', wave });
    }
    return true;
  }

  revive(playerId = 'p1') {
    const selected = this.playerFor(playerId);
    if (!selected || selected.hp > 0 || selected.revivesRemaining <= 0) return false;
    const events = this.events, bullets = this.bullets, grenades = this.grenades;
    const priorStatus = this.status;
    let revived = false;
    this.withPlayer(playerId, player => {
      this.status = 'dead';
      revived = super.revive();
      if (revived) {
        player.downed = false;
        const point = this.findFreeEntityPoint(player.x, player.y, player.radius, player);
        if (point) Object.assign(player, point);
        for (const event of this.events) {
          if (localEvents.has(event.type)) event.playerId = playerId;
          if (event.type === 'revive') { event.x = player.x; event.y = player.y; }
        }
      }
    });
    // A teammate's recovery must not erase the survivor's attacks or the room's
    // queued sounds. Invulnerability protects only the player being revived.
    const revivalEvents = this.events;
    this.events = events.concat(revivalEvents);
    this.bullets = bullets;
    this.grenades = grenades;
    this.status = revived ? 'playing' : priorStatus;
    return revived;
  }

  snapshot(playerId = 'p1') {
    const player = this.playerFor(playerId);
    if (!player) throw new Error('Unknown player');
    const snapshot = {
      mapId: this.map.id, difficultyId: this.difficulty.id, map: this.map, difficulty: this.difficulty,
      player, players: this.getPlayers(), barrels: this.barrels,
      enemies: this.enemies, bullets: this.bullets, grenades: this.grenades,
      pickups: this.pickups, effects: this.effects, events: this.events,
      wave: this.wave, waveKills: this.waveKills, waveTotal: this.waveTotal,
      score: this.score, kills: this.kills, time: this.time,
      revivesRemaining: player.revivesRemaining,
      previousInput: {},
      status: player.hp <= 0 ? 'dead' : this.status, teamStatus: this.status,
      environment: { barrels: this.barrels, speedZones: this.map.speedZones || [],
        speedMultiplier: player.speedMultiplier, speedZoneId: player.speedZoneId },
    };
    // No simulation functions, RNG state, navigation fields, Sets or unbounded
    // spawn queue are exposed. Infinity ammunition intentionally serializes null.
    return JSON.parse(JSON.stringify(snapshot, (key, value) => value instanceof Set ? [...value] : value));
  }
}
