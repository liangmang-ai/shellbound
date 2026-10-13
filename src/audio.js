import { AUDIO_SAMPLE_RATE, SOUND_DEFINITIONS, synthesizeSound } from './audio-synthesis.js';

const PRIORITY = { hit: 1, pistol: 2, smg: 2, rifle: 2, lmg: 2, sniper: 2, shotgun: 2, explosion: 4, hurt: 3, shield: 3, bossCharge: 3, bossVolley: 3, wave: 3, waveClear: 3, won: 4, dead: 4, revive: 4 };
const COOLDOWN = { hit: 65, pickup: 100, explosion: 65, bossVolley: 100, bossCharge: 180, shield: 120, hurt: 120 };
const catchPromise = value => { if (value && typeof value.catch === 'function') value.catch(() => {}); };

export function soundForEvent(event) {
  if (!event) return null;
  if (event.type === 'shot') return SOUND_DEFINITIONS[event.weaponId] ? event.weaponId : 'pistol';
  if (event.type === 'damage') return event.absorbed >= event.amount ? 'shield' : 'hurt';
  if (event.type === 'kill') return 'hit';
  if (event.type === 'unlock' || event.type === 'ammo') return 'pickup';
  if (event.type === 'barrelExplosion') return 'explosion';
  if (event.type === 'speedBoost') return event.active ? 'boost' : null;
  return SOUND_DEFINITIONS[event.type] ? event.type : null;
}

// Platform APIs are injected so this module stays usable without DOM or wx.
export function createAudio({ platform = 'web', wxApi, contextFactory, now = () => Date.now(), maxVoices = 8 } = {}) {
  const capacity = Math.max(1, Math.min(12, Math.floor(maxVoices) || 8));
  const slots = [], buffers = new Map(), lastPlayed = new Map();
  let context = null, master = null, pendingResume = null, pending = [];
  let unlocked = false, paused = true, muted = false, destroyed = false, epoch = 0;
  let played = 0, dropped = 0, failures = 0;
  const supported = platform === 'wechat'
    ? typeof wxApi?.createInnerAudioContext === 'function'
    : Boolean(contextFactory || globalThis.AudioContext || globalThis.webkitAudioContext);

  function release(slot) {
    slot.busy = false;
    if (platform === 'wechat') {
      try { slot.node.stop(); } catch { /* A missing device must not break play. */ }
    } else {
      try { slot.node.stop(); } catch { /* It may already have ended. */ }
      try { slot.node.disconnect(); slot.gain.disconnect(); } catch { /* Already detached. */ }
    }
  }

  function stopAll() {
    epoch += 1;
    pending = [];
    for (const slot of slots) if (slot.busy) release(slot);
    lastPlayed.clear();
  }

  function makeNativeSlot() {
    let node;
    try {
      node = wxApi.createInnerAudioContext({ useWebAudioImplement: true });
      node.autoplay = false; node.loop = false; node.startTime = 0;
      const slot = { node, busy: false, startedAt: 0, until: 0, priority: 0 };
      node.onEnded(() => {
        // A stop event from a replaced voice must not finish its replacement.
        if (now() >= slot.until - 75) slot.busy = false;
      });
      node.onError(() => { failures += 1; slot.busy = false; });
      slots.push(slot);
      return slot;
    } catch {
      failures += 1;
      try { node?.destroy(); } catch { /* Partial creation. */ }
      return null;
    }
  }

  function selectSlot(priority, timestamp) {
    for (const slot of slots) {
      if (slot.busy && timestamp >= slot.until) release(slot);
      if (!slot.busy) return slot;
    }
    if (slots.length < capacity) {
      if (platform === 'wechat') return makeNativeSlot();
      const slot = { busy: false }; slots.push(slot); return slot;
    }
    const candidate = slots.filter(slot => slot.priority <= priority)
      .sort((a, b) => a.priority - b.priority || a.startedAt - b.startedAt)[0];
    if (candidate) release(candidate);
    return candidate;
  }

  function play(name) {
    if (!supported || destroyed || !unlocked || paused || muted || !SOUND_DEFINITIONS[name]) return;
    if (platform !== 'wechat' && context?.state !== 'running') {
      if (pendingResume && pending.length < capacity) pending.push(name);
      else dropped += 1;
      return;
    }
    const timestamp = now(), cooldown = COOLDOWN[name] ?? 25;
    if (timestamp - (lastPlayed.get(name) ?? -Infinity) < cooldown) { dropped += 1; return; }
    const slot = selectSlot(PRIORITY[name] ?? 2, timestamp);
    if (!slot) { dropped += 1; return; }
    const definition = SOUND_DEFINITIONS[name];
    slot.startedAt = timestamp; slot.until = timestamp + definition.duration * 1000 + 45;
    slot.priority = PRIORITY[name] ?? 2; slot.busy = true;
    try {
      if (platform === 'wechat') {
        // Reset reused contexts even after natural end: replaying the same src
        // should always start at the beginning rather than its last position.
        slot.node.stop();
        slot.node.volume = definition.volume;
        slot.node.src = `assets/audio/${name}.wav`;
        slot.node.play();
      } else {
        let buffer = buffers.get(name);
        if (!buffer) {
          const samples = synthesizeSound(name);
          buffer = context.createBuffer(1, samples.length, AUDIO_SAMPLE_RATE);
          buffer.getChannelData(0).set(samples);
          buffers.set(name, buffer);
        }
        const node = context.createBufferSource(), gain = context.createGain();
        slot.node = node; slot.gain = gain;
        const generation = epoch;
        node.buffer = buffer; gain.gain.value = definition.volume;
        node.connect(gain); gain.connect(master);
        node.onended = () => {
          try { node.disconnect(); gain.disconnect(); } catch { /* Ended voice. */ }
          if (slot.node === node && generation === epoch) slot.busy = false;
        };
        node.start();
      }
      played += 1; lastPlayed.set(name, timestamp);
    } catch {
      failures += 1;
      release(slot);
    }
  }

  function unlock() {
    if (destroyed || !supported) return;
    unlocked = true; paused = false;
    if (muted || platform === 'wechat') return;
    try {
      if (!context) {
        const Factory = globalThis.AudioContext || globalThis.webkitAudioContext;
        context = contextFactory ? contextFactory() : new Factory();
        master = context.createGain(); master.gain.value = .6; master.connect(context.destination);
      }
      if (context.state !== 'running' && !pendingResume) {
        pendingResume = Promise.resolve(context.resume());
        pendingResume.then(() => {
          pendingResume = null;
          // stopAll already cleared the old queue. A new game may have queued
          // its first wave while this same user-gesture resume was in flight.
          if (paused || muted || destroyed) { pending = []; return; }
          const queued = pending; pending = [];
          for (const name of queued) play(name);
        }, () => { failures += 1; pendingResume = null; pending = []; });
      }
    } catch { failures += 1; }
  }

  return {
    unlock,
    playEvents(events = []) {
      for (const event of events) {
        // A pickup often includes an unlock/ammo event; debounce covers the pair.
        const name = soundForEvent(event);
        if (name) play(name);
      }
    },
    pause() { paused = true; stopAll(); },
    setMuted(value) { muted = Boolean(value); if (muted) stopAll(); },
    getSnapshot() {
      return { supported, muted, unlocked, paused, activeVoices: slots.filter(slot => slot.busy && now() < slot.until).length, voiceLimit: capacity, played, dropped, failures };
    },
    destroy() {
      if (destroyed) return;
      stopAll(); destroyed = true; paused = true;
      if (platform === 'wechat') for (const slot of slots) { try { slot.node.destroy(); } catch { /* Closed audio. */ } }
      else if (context) { try { catchPromise(context.close()); } catch { /* Closed context. */ } }
      buffers.clear();
    },
  };
}
