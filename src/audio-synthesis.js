// Original arcade sounds. Both packaged WAVs and browser PCM use these recipes;
// no recordings, samples, or third-party sound assets are included.
export const AUDIO_SAMPLE_RATE = 22050;
export const SOUND_DEFINITIONS = Object.freeze({
  pistol: { duration: .15, tone: 210, endTone: 65, noise: .75, decay: 23, volume: .42 },
  smg: { duration: .10, tone: 320, endTone: 95, noise: .8, decay: 35, volume: .34 },
  rifle: { duration: .18, tone: 170, endTone: 45, noise: .85, decay: 23, volume: .44 },
  lmg: { duration: .15, tone: 130, endTone: 50, noise: .9, decay: 29, volume: .36 },
  sniper: { duration: .34, tone: 120, endTone: 28, noise: .9, decay: 14, volume: .50 },
  shotgun: { duration: .26, tone: 155, endTone: 38, noise: 1, decay: 17, volume: .50 },
  hit: { duration: .09, tone: 780, endTone: 240, noise: .28, decay: 45, volume: .26 },
  reload: { duration: .32, tone: 850, endTone: 650, noise: .6, pulses: [0, .12, .25], decay: 55, volume: .34 },
  reloaded: { duration: .13, tone: 980, endTone: 1200, noise: .2, decay: 28, volume: .32 },
  pickup: { duration: .24, notes: [660, 880, 1100], noise: 0, volume: .34 },
  grenade: { duration: .18, tone: 700, endTone: 120, noise: .3, decay: 20, volume: .32 },
  explosion: { duration: .60, tone: 90, endTone: 24, noise: 1, decay: 7, volume: .50 },
  shield: { duration: .20, tone: 1100, endTone: 470, noise: .1, decay: 15, volume: .32 },
  hurt: { duration: .22, tone: 260, endTone: 80, noise: .4, decay: 14, volume: .36 },
  bossCharge: { duration: .38, tone: 190, endTone: 780, noise: .08, volume: .34 },
  bossVolley: { duration: .23, tone: 720, endTone: 160, noise: .22, decay: 16, volume: .38 },
  wave: { duration: .42, notes: [330, 440, 660], noise: 0, volume: .32 },
  waveClear: { duration: .36, notes: [520, 660, 780], noise: 0, volume: .30 },
  won: { duration: .84, notes: [440, 554, 660, 880], noise: 0, volume: .34 },
  dead: { duration: .64, notes: [440, 330, 220, 110], noise: 0, volume: .32 },
  equip: { duration: .10, tone: 650, endTone: 1000, noise: .32, decay: 32, volume: .28 },
  boost: { duration: .25, tone: 350, endTone: 1050, noise: .12, volume: .26 },
});

export function synthesizeSound(name, sampleRate = AUDIO_SAMPLE_RATE) {
  const definition = SOUND_DEFINITIONS[name];
  if (!definition) throw new Error(`Unknown sound: ${name}`);
  const output = new Float32Array(Math.ceil(definition.duration * sampleRate));
  let seed = 2166136261;
  for (const character of name) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  let phase = 0, filteredNoise = 0;
  for (let i = 0; i < output.length; i++) {
    const t = i / sampleRate, progress = t / definition.duration;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    filteredNoise += (noise - filteredNoise) * .46;
    let envelope, frequency;
    if (definition.notes) {
      const noteDuration = definition.duration / definition.notes.length;
      const index = Math.min(definition.notes.length - 1, Math.floor(t / noteDuration));
      const noteTime = t - index * noteDuration;
      frequency = definition.notes[index];
      envelope = Math.min(1, noteTime / .005) * Math.max(0, 1 - noteTime / noteDuration);
    } else {
      frequency = definition.tone + (definition.endTone - definition.tone) * progress;
      const pulseTime = definition.pulses
        ? Math.min(...definition.pulses.filter(start => start <= t).map(start => t - start))
        : t;
      envelope = definition.decay ? Math.exp(-pulseTime * definition.decay) : Math.sin(Math.PI * progress);
      envelope *= Math.min(1, pulseTime / .002);
    }
    phase += Math.PI * 2 * frequency / sampleRate;
    const tonal = Math.sin(phase) * .65 + Math.sin(phase * 2.02) * .12;
    const mixture = tonal * (1 - definition.noise * .55) + filteredNoise * definition.noise;
    // Fade every tail to zero, preventing clicks when a short sample finishes.
    const tail = Math.min(1, (definition.duration - t) / .015);
    output[i] = Math.tanh(mixture * 1.8) * envelope * tail * .76;
  }
  return output;
}

export function encodeWav(samples, sampleRate = AUDIO_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(buffer);
}
