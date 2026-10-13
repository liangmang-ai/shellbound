import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { createAudio, soundForEvent } from '../src/audio.js';
import { AUDIO_SAMPLE_RATE, SOUND_DEFINITIONS, synthesizeSound, encodeWav } from '../src/audio-synthesis.js';
import { WEAPON_ORDER } from '../src/game.js';

function nativeHarness(options = {}) {
  let time = 1000;
  const nodes = [], factories = [];
  const wxApi = {
    createInnerAudioContext(config) {
      factories.push(config);
      const callbacks = {};
      const node = {
        playCount: 0, stopCount: 0, destroyCount: 0,
        play() { this.playCount += 1; }, stop() { this.stopCount += 1; }, destroy() { this.destroyCount += 1; },
        onEnded(fn) { callbacks.ended = fn; }, onError(fn) { callbacks.error = fn; },
        ended() { callbacks.ended(); }, error() { callbacks.error(); },
      };
      nodes.push(node);
      return node;
    },
  };
  const audio = createAudio({ platform: 'wechat', wxApi, now: () => time, ...options });
  return { audio, nodes, factories, advance(ms) { time += ms; } };
}

function browserHarness({ suspended = false, failedResume = false, maxVoices = 8 } = {}) {
  let time = 1000, completeResume;
  const sources = [], gains = [], pcm = [];
  const context = {
    state: suspended ? 'suspended' : 'running', destination: {}, resumeCount: 0, closeCount: 0,
    createGain() {
      const gain = { gain: { value: 0 }, connect() {}, disconnectCount: 0, disconnect() { this.disconnectCount += 1; } };
      gains.push(gain); return gain;
    },
    createBuffer(channels, length, rate) {
      assert.equal(channels, 1); assert.equal(rate, AUDIO_SAMPLE_RATE);
      const samples = new Float32Array(length); pcm.push(samples);
      return { getChannelData() { return samples; } };
    },
    createBufferSource() {
      const source = { startCount: 0, stopCount: 0, disconnectCount: 0, connect() {},
        start() { this.startCount += 1; }, stop() { this.stopCount += 1; }, disconnect() { this.disconnectCount += 1; } };
      sources.push(source); return source;
    },
    resume() {
      this.resumeCount += 1;
      if (failedResume) return Promise.reject(new Error('blocked'));
      return new Promise(resolvePromise => { completeResume = () => { this.state = 'running'; resolvePromise(); }; });
    },
    close() { this.closeCount += 1; return Promise.resolve(); },
  };
  let created = 0;
  const audio = createAudio({ contextFactory: () => { created += 1; return context; }, now: () => time, maxVoices });
  return { audio, context, sources, gains, pcm, get created() { return created; }, resume() { completeResume(); }, advance(ms) { time += ms; } };
}

test('every gun has a distinct original, finite, unclipped waveform and packaged PCM WAV', async () => {
  const encoded = new Set();
  for (const name of Object.keys(SOUND_DEFINITIONS)) {
    const samples = synthesizeSound(name);
    assert.ok(samples.some(sample => sample !== 0), `${name} is audible`);
    assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= .76), `${name} stays below full scale`);
    assert.equal(samples[0], 0, `${name} has a silent attack boundary`);
    assert.equal(samples.at(-1), 0, `${name} has a silent tail boundary`);
    assert.deepEqual(samples, synthesizeSound(name), `${name} generation is reproducible`);
    const wav = encodeWav(samples), view = new DataView(wav.buffer);
    assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), 'RIFF');
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), AUDIO_SAMPLE_RATE);
    assert.equal(view.getUint16(34, true), 16);
    assert.deepEqual(await readFile(resolve('assets/audio', `${name}.wav`)), Buffer.from(wav));
    if (WEAPON_ORDER.includes(name)) encoded.add(Buffer.from(wav).toString('base64'));
  }
  assert.equal(encoded.size, WEAPON_ORDER.length, 'six gun samples differ');
  assert.deepEqual((await readdir('assets/audio')).sort(), Object.keys(SOUND_DEFINITIONS).map(name => `${name}.wav`).sort());
});

test('game event mapping includes all guns, shields, impacts and map explosions', () => {
  for (const weaponId of WEAPON_ORDER) assert.equal(soundForEvent({ type: 'shot', weaponId }), weaponId);
  assert.equal(soundForEvent({ type: 'damage', absorbed: 10, amount: 10 }), 'shield');
  assert.equal(soundForEvent({ type: 'damage', absorbed: 5, amount: 10 }), 'hurt');
  assert.equal(soundForEvent({ type: 'hit' }), 'hit');
  assert.equal(soundForEvent({ type: 'barrelExplosion' }), 'explosion');
  assert.equal(soundForEvent({ type: 'speedBoost', active: true }), 'boost');
  assert.equal(soundForEvent({ type: 'speedBoost', active: false }), null);
  assert.equal(soundForEvent({ type: 'pickup', pickupType: 'shield' }), 'pickup');
  assert.equal(soundForEvent({ type: 'revive' }), 'revive');
  assert.equal(soundForEvent({ type: 'notAudio' }), null);
});

test('toy sounds remove noise and sharp edges while preserving soft body and six gun identities', () => {
  const identities = new Set();
  for (const [name, definition] of Object.entries(SOUND_DEFINITIONS)) {
    assert.equal(definition.noise, 0, `${name} has no noise layer`);
    const samples = synthesizeSound(name);
    let power = 0, edgePower = 0, peak = 0, largestStep = 0;
    for (let i = 0; i < samples.length; i++) {
      power += samples[i] ** 2;
      peak = Math.max(peak, Math.abs(samples[i]));
      if (i > 0) { const step = samples[i] - samples[i - 1]; edgePower += step ** 2; largestStep = Math.max(largestStep, Math.abs(step)); }
    }
    assert.ok(peak >= .35 && peak <= .72, `${name} has audible body without clipping`);
    assert.ok(largestStep < .20, `${name} never jumps sharply between adjacent samples`);
    assert.ok(edgePower / power < .1, `${name} keeps high frequency roughness low`);
    if (WEAPON_ORDER.includes(name)) {
      identities.add(`${definition.tone}:${definition.endTone}:${definition.duration}`);
      assert.ok(definition.duration <= .24, `${name} remains a short responsive shot`);
    }
  }
  assert.equal(identities.size, 6, 'gun pitches and envelopes remain distinct');
  assert.ok(SOUND_DEFINITIONS.explosion.tone <= 110 && SOUND_DEFINITIONS.explosion.endTone <= 50, 'explosion stays a soft low-frequency puff');
  assert.notDeepEqual(SOUND_DEFINITIONS.revive.notes, SOUND_DEFINITIONS.bossCharge.notes, 'revive chime differs from Boss warning');
});

test('native audio uses local files, bounded reusable voices and preserves system mute settings', () => {
  const h = nativeHarness({ maxVoices: 3 });
  h.audio.playEvents([{ type: 'shot', weaponId: 'pistol' }]);
  assert.equal(h.nodes.length, 0, 'no playback before user gesture');
  h.audio.unlock();
  for (let i = 0; i < 200; i++) { h.audio.playEvents([{ type: 'shot', weaponId: WEAPON_ORDER[i % 6] }]); h.advance(30); }
  assert.equal(h.nodes.length, 3);
  assert.ok(h.audio.getSnapshot().activeVoices <= 3);
  assert.ok(h.nodes.every(node => node.src.startsWith('assets/audio/') && node.src.endsWith('.wav')));
  assert.ok(h.factories.every(options => options.useWebAudioImplement === true));
  assert.ok(h.nodes.every(node => !('obeyMuteSwitch' in node)), 'OS silence is respected');
  assert.ok(h.nodes.reduce((sum, node) => sum + node.playCount, 0) > 100);
  h.audio.pause();
  const before = h.audio.getSnapshot().played;
  assert.equal(h.audio.getSnapshot().activeVoices, 0);
  h.audio.playEvents([{ type: 'explosion' }]);
  assert.equal(h.audio.getSnapshot().played, before);
  h.audio.unlock(); h.audio.playEvents([{ type: 'explosion' }]);
  assert.equal(h.audio.getSnapshot().played, before + 1);
  h.audio.destroy(); h.audio.destroy();
  assert.ok(h.nodes.every(node => node.destroyCount === 1));
});

test('priority preserves warning/explosion voices and mute drops pending effects', () => {
  const h = nativeHarness({ maxVoices: 1 }); h.audio.unlock();
  h.audio.playEvents([{ type: 'explosion' }]);
  h.advance(30); h.audio.playEvents([{ type: 'hit' }]);
  assert.equal(h.audio.getSnapshot().played, 1, 'a low priority impact cannot cut an explosion');
  h.audio.setMuted(true);
  assert.equal(h.audio.getSnapshot().activeVoices, 0);
  h.audio.playEvents([{ type: 'bossCharge' }]);
  assert.equal(h.audio.getSnapshot().played, 1);
  h.audio.setMuted(false); h.audio.playEvents([{ type: 'bossCharge' }]);
  assert.equal(h.audio.getSnapshot().played, 2);
  h.advance(SOUND_DEFINITIONS.bossCharge.duration * 1000); h.nodes[0].ended();
  assert.equal(h.audio.getSnapshot().activeVoices, 0);
});

test('hit bursts and unlock+pickup events are debounced, and native failures recover', () => {
  const h = nativeHarness(); h.audio.unlock();
  h.audio.playEvents(Array.from({ length: 100 }, () => ({ type: 'hit' })));
  assert.equal(h.audio.getSnapshot().played, 1);
  h.audio.playEvents([{ type: 'unlock' }, { type: 'pickup' }]);
  assert.equal(h.audio.getSnapshot().played, 2, 'one sound for paired pickup events');
  h.nodes[0].error();
  assert.equal(h.audio.getSnapshot().failures, 1);
  h.advance(200); h.audio.playEvents([{ type: 'shot', weaponId: 'rifle' }]);
  assert.equal(h.audio.getSnapshot().played, 3);
  const missing = createAudio({ platform: 'wechat', wxApi: {} });
  missing.unlock(); missing.playEvents([{ type: 'shot' }]); missing.pause(); missing.destroy();
  assert.equal(missing.getSnapshot().supported, false, 'missing audio support keeps the game playable');
});

test('browser starts on user gesture, caches PCM and releases every voice on pause', () => {
  const h = browserHarness();
  h.audio.playEvents([{ type: 'shot' }]); assert.equal(h.created, 0);
  h.audio.unlock(); h.audio.playEvents([{ type: 'shot', weaponId: 'pistol' }]);
  h.advance(250); h.audio.playEvents([{ type: 'shot', weaponId: 'pistol' }]);
  assert.equal(h.created, 1); assert.equal(h.pcm.length, 1, 'decoded/generated buffer reused');
  assert.ok(h.pcm[0].some(sample => sample !== 0));
  h.audio.pause();
  assert.equal(h.audio.getSnapshot().activeVoices, 0);
  assert.ok(h.sources.every(source => source.stopCount >= 1 && source.disconnectCount >= 1));
  h.audio.destroy(); assert.equal(h.context.closeCount, 1);
});

test('browser resume has bounded queue, and pause cannot replay sounds after async unlock', async () => {
  const h = browserHarness({ suspended: true, maxVoices: 2 });
  h.audio.unlock(); h.audio.unlock();
  assert.equal(h.context.resumeCount, 1);
  h.audio.playEvents([{ type: 'wave' }, { type: 'shot' }, { type: 'explosion' }]);
  assert.equal(h.sources.length, 0);
  h.audio.pause(); h.resume(); await Promise.resolve();
  assert.equal(h.sources.length, 0, 'pending sounds cleared when hidden or paused');
  h.audio.unlock(); h.audio.playEvents([{ type: 'wave' }]);
  assert.equal(h.sources.length, 1);
  const success = browserHarness({ suspended: true });
  success.audio.unlock(); success.audio.playEvents([{ type: 'wave' }]);
  success.resume(); await Promise.resolve();
  assert.equal(success.sources.length, 1, 'first wave retained while user-gesture resume resolves');
  const restart = browserHarness({ suspended: true });
  restart.audio.unlock(); restart.audio.playEvents([{ type: 'shot' }]);
  restart.audio.pause(); restart.audio.unlock(); restart.audio.playEvents([{ type: 'wave' }]);
  restart.resume(); await Promise.resolve();
  assert.equal(restart.sources.length, 1, 'a new game first wave survives an earlier pending resume');
  assert.equal(restart.sources[0].buffer.getChannelData(0).length, synthesizeSound('wave').length, 'old shot queue was discarded');
});

test('browser rejected resume and audio creation/play errors stay contained', async () => {
  const h = browserHarness({ suspended: true, failedResume: true });
  h.audio.unlock(); h.audio.playEvents([{ type: 'wave' }]); await Promise.resolve();
  assert.equal(h.audio.getSnapshot().failures, 1);
  assert.equal(h.sources.length, 0);
  const broken = createAudio({ contextFactory() { throw new Error('device unavailable'); } });
  assert.doesNotThrow(() => { broken.unlock(); broken.playEvents([{ type: 'shot' }]); broken.pause(); broken.destroy(); });
  assert.equal(broken.getSnapshot().failures, 1);
  const native = createAudio({ platform: 'wechat', wxApi: { createInnerAudioContext() { throw new Error('unavailable'); } } });
  assert.doesNotThrow(() => { native.unlock(); native.playEvents([{ type: 'shot' }]); native.destroy(); });
  assert.equal(native.getSnapshot().failures, 1);
});
