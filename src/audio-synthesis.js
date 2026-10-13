// Original bubble/wooden-toy sounds. Both packaged WAVs and browser PCM use these recipes;
// no recordings, samples, or third-party sound assets are included.
export const AUDIO_SAMPLE_RATE = 22050;
export const SOUND_DEFINITIONS = Object.freeze({
  pistol: { duration: .13, tone: 720, endTone: 240, glide: .028, attack: .005, noise: 0, harmonic: .06, decay: 18, volume: .42 },
  smg: { duration: .085, tone: 920, endTone: 340, glide: .019, attack: .004, noise: 0, harmonic: .025, decay: 29, volume: .34 },
  rifle: { duration: .17, tone: 570, endTone: 190, glide: .034, attack: .006, noise: 0, harmonic: .07, decay: 14, volume: .44 },
  lmg: { duration: .11, tone: 400, endTone: 140, glide: .025, attack: .005, noise: 0, harmonic: .12, decay: 22, volume: .36 },
  sniper: { duration: .24, tone: 1060, endTone: 210, glide: .037, attack: .008, noise: 0, harmonic: .035, decay: 11, volume: .46 },
  shotgun: { duration: .18, tone: 360, endTone: 90, glide: .034, attack: .008, noise: 0, harmonic: .08, decay: 13, volume: .46 },
  hit: { duration: .075, tone: 510, endTone: 280, glide: .018, attack: .004, noise: 0, harmonic: .03, decay: 30, volume: .24 },
  reload: { duration: .26, notes: [260, 360, 300], attack: .006, noise: 0, harmonic: .10, decay: 18, volume: .30 },
  reloaded: { duration: .14, notes: [660, 880], attack: .006, noise: 0, harmonic: .035, decay: 16, volume: .30 },
  pickup: { duration: .27, notes: [660, 880, 990], attack: .007, noise: 0, harmonic: .035, decay: 12, volume: .32 },
  grenade: { duration: .15, tone: 480, endTone: 170, glide: .04, attack: .007, noise: 0, harmonic: .04, decay: 17, volume: .30 },
  explosion: { duration: .45, tone: 110, endTone: 42, glide: .10, attack: .018, noise: 0, harmonic: .04, decay: 7, volume: .46 },
  shield: { duration: .22, notes: [780, 520], attack: .008, noise: 0, harmonic: .035, decay: 12, volume: .30 },
  hurt: { duration: .18, tone: 300, endTone: 145, glide: .05, attack: .009, noise: 0, harmonic: .045, decay: 13, volume: .32 },
  bossCharge: { duration: .44, notes: [220, 330, 440], attack: .009, noise: 0, harmonic: .07, decay: 9, volume: .34 },
  bossVolley: { duration: .20, tone: 570, endTone: 190, glide: .05, attack: .008, noise: 0, harmonic: .08, decay: 12, volume: .34 },
  wave: { duration: .42, notes: [330, 440, 660], attack: .008, noise: 0, harmonic: .04, decay: 10, volume: .30 },
  waveClear: { duration: .36, notes: [520, 660, 780], attack: .008, noise: 0, harmonic: .035, decay: 10, volume: .28 },
  won: { duration: .84, notes: [440, 554, 660, 880], attack: .010, noise: 0, harmonic: .03, decay: 7, volume: .32 },
  dead: { duration: .56, notes: [440, 330, 220, 147], attack: .010, noise: 0, harmonic: .035, decay: 8, volume: .30 },
  equip: { duration: .10, notes: [392, 523], attack: .005, noise: 0, harmonic: .07, decay: 20, volume: .26 },
  boost: { duration: .22, tone: 390, endTone: 880, glide: .065, attack: .008, noise: 0, harmonic: .025, decay: 10, volume: .26 },
  revive: { duration: .64, notes: [392, 494, 587, 784], attack: .010, noise: 0, harmonic: .03, decay: 8, volume: .34 },
});

export function synthesizeSound(name, sampleRate = AUDIO_SAMPLE_RATE) {
  const definition = SOUND_DEFINITIONS[name];
  if (!definition) throw new Error(`Unknown sound: ${name}`);
  const output = new Float32Array(Math.ceil(definition.duration * sampleRate));
  let phase = 0;
  const fadeIn = elapsed => Math.sin(Math.min(1, Math.max(0, elapsed) / definition.attack) * Math.PI / 2) ** 2;
  const fadeOut = remaining => Math.sin(Math.min(1, Math.max(0, remaining) / .024) * Math.PI / 2) ** 2;
  for (let i = 0; i < output.length; i++) {
    const t = i / sampleRate;
    let envelope, frequency;
    if (definition.notes) {
      const noteDuration = definition.duration / definition.notes.length;
      const index = Math.min(definition.notes.length - 1, Math.floor(t / noteDuration));
      const noteTime = t - index * noteDuration;
      frequency = definition.notes[index];
      envelope = fadeIn(noteTime) * Math.exp(-definition.decay * noteTime) * fadeOut(noteDuration - noteTime);
    } else {
      frequency = definition.endTone + (definition.tone - definition.endTone) * Math.exp(-t / definition.glide);
      envelope = fadeIn(t) * Math.exp(-definition.decay * t);
    }
    phase += Math.PI * 2 * frequency / sampleRate;
    // Light low harmonics add a wooden-toy body without noise or saturation.
    const harmonic = definition.harmonic;
    const tonal = (Math.sin(phase) + Math.sin(phase * 2) * harmonic + Math.sin(phase * 3) * harmonic * .2) / (1 + harmonic * 1.2);
    // Raised-cosine edges start and end at zero; every note also gets its own
    // fade so the soft marimba melodies never click at a pitch transition.
    const tail = fadeOut((output.length - 1 - i) / sampleRate);
    output[i] = tonal * envelope * tail * .72;
  }
  output[0] = 0; output[output.length - 1] = 0;
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
