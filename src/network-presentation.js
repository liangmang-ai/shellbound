import { segmentRect } from './game.js';

// A 75 ms presentation window covers the alternating 33/67 ms simulation gaps
// in 20 Hz snapshots of a 30 Hz world. It never runs
// combat, predicts a collision, or changes the state used to build inputs.
const MAX_DELAY = .075;
const GROUPS = ['players', 'enemies', 'bullets', 'grenades'];
const alive = entity => !Number.isFinite(entity.hp) || entity.hp > 0;
const finitePosition = entity => Number.isFinite(entity?.x) && Number.isFinite(entity?.y);

function safeSegment(from, to, interval, obstacles) {
  if (!finitePosition(from) || !finitePosition(to) || alive(from) !== alive(to) || !alive(to)) return false;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const speed = Math.max(Number.isFinite(to.speed) ? to.speed : 0, Math.hypot(to.vx || 0, to.vy || 0));
  if (distance > Math.max(96, speed * interval * 3)) return false;
  const radius = Number.isFinite(to.radius) ? Math.max(0, to.radius) : 0;
  // Conservatively snap at corners rather than draw a straight chord through a
  // wall. The expanded rectangle also protects the body's visible radius.
  return !obstacles.some(rect => segmentRect(from.x, from.y, to.x, to.y, rect, radius) !== null);
}

export class NetworkPresentation {
  constructor(authority) {
    this.authority = authority;
    this.view = Object.create(authority);
    this.snapshots = [];
    this.entries = [];
    this.time = 0;
  }

  accept(previous) {
    const authority = this.authority;
    const last = this.snapshots[this.snapshots.length - 1];
    const timestamp = Number.isFinite(authority.time) ? authority.time : (last?.time || 0) + MAX_DELAY;
    const reset = !last || authority.paused || previous.paused !== authority.paused
      || previous.mapId !== authority.map.id || previous.status !== authority.status
      || previous.teamStatus !== authority.teamStatus || timestamp <= last.time || timestamp - last.time > .2;
    const snapshot = { time: timestamp, groups: {} };
    const obstacles = authority.map.obstacles || [];
    this.entries = [];
    for (const group of GROUPS) {
      const entities = group === 'players'
        ? [authority.player, ...(authority.players || []).filter(player => player.id !== authority.player.id)]
        : authority[group] || [];
      const poses = new Map();
      const rendered = [];
      for (const entity of entities) {
        const prior = last?.groups[group].get(entity.id);
        const smooth = !reset && entity.id !== undefined && prior
          && safeSegment(prior.entity, entity, timestamp - last.time, obstacles);
        // Once a birth, revive or unsafe segment is shown immediately, this
        // entity must never sample an older pose while the shared clock catches
        // up. Carry that floor into following safe segments instead of briefly
        // showing the newest target and then rewinding into its history.
        const floorTime = smooth ? prior.floorTime : timestamp;
        poses.set(entity.id, { entity, smooth: Boolean(smooth), floorTime });
        const pose = { ...entity };
        rendered.push(pose);
        this.entries.push({ group, id: entity.id, pose, target: entity, smooth: Boolean(smooth), floorTime });
      }
      snapshot.groups[group] = poses;
      this.view[group] = rendered;
      if (group === 'players') this.view.player = rendered[0];
    }
    if (reset) { this.snapshots = [snapshot]; this.time = timestamp - (authority.paused ? 0 : MAX_DELAY); }
    else {
      this.snapshots.push(snapshot);
      this.time = Math.max(this.time, timestamp - MAX_DELAY);
      // Retain the sample immediately before presentation time to bracket it.
      while (this.snapshots.length > 2 && this.snapshots[1].time <= this.time) this.snapshots.shift();
    }
    this.sample();
  }

  advance(dt) {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return;
    this.time = Math.min(latest.time, this.time + Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.sample();
  }

  sample() {
    for (const entry of this.entries) {
      const time = Math.max(this.time, entry.floorTime);
      let left = this.snapshots[0], right = left;
      for (const snapshot of this.snapshots) {
        right = snapshot;
        if (snapshot.time > time) break;
        left = snapshot;
      }
      const fraction = right.time > left.time ? Math.max(0, Math.min(1, (time - left.time) / (right.time - left.time))) : 1;
      const from = left.groups[entry.group].get(entry.id);
      const to = right.groups[entry.group].get(entry.id);
      const { pose, target } = entry;
      if (!entry.smooth || !from || !to || (left !== right && !to.smooth)) {
        pose.x = target.x; pose.y = target.y; pose.angle = target.angle;
        continue;
      }
      pose.x = from.entity.x + (to.entity.x - from.entity.x) * fraction;
      pose.y = from.entity.y + (to.entity.y - from.entity.y) * fraction;
      if (Number.isFinite(from.entity.angle) && Number.isFinite(to.entity.angle)) {
        const difference = Math.atan2(Math.sin(to.entity.angle - from.entity.angle), Math.cos(to.entity.angle - from.entity.angle));
        pose.angle = from.entity.angle + difference * fraction;
      }
    }
  }
}
