import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_SAMPLE_RATE, SOUND_DEFINITIONS, synthesizeSound, encodeWav } from '../src/audio-synthesis.js';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/audio');
await mkdir(directory, { recursive: true });
await Promise.all(Object.keys(SOUND_DEFINITIONS).map(name => writeFile(resolve(directory, `${name}.wav`), encodeWav(synthesizeSound(name)))));
console.log(`生成 ${Object.keys(SOUND_DEFINITIONS).length} 个原创音效：assets/audio`);

if (process.argv.includes('--preview')) {
  // Ignored listening sample, kept out of the shipped assets directory.
  const shots = [
    ['pistol', 0], ['pistol', .28],
    ['smg', .8], ['smg', .875], ['smg', .95], ['smg', 1.025],
    ['rifle', 1.6], ['rifle', 1.88],
    ['lmg', 2.4], ['lmg', 2.49], ['lmg', 2.58], ['lmg', 2.67],
    ['sniper', 3.2], ['shotgun', 4], ['shotgun', 4.3],
    ['explosion', 5], ['pickup', 6], ['revive', 6.7],
  ];
  const preview = new Float32Array(AUDIO_SAMPLE_RATE * 8);
  for (const [name, start] of shots) {
    const samples = synthesizeSound(name), offset = Math.round(start * AUDIO_SAMPLE_RATE);
    for (let i = 0; i < samples.length; i++) preview[offset + i] += samples[i] * SOUND_DEFINITIONS[name].volume;
  }
  const artifacts = resolve(directory, '../../artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, 'q-sound-preview.wav'), encodeWav(preview));
  console.log('试听顺序：手枪、冲锋枪、步枪、机枪、大狙、霰弹枪、爆炸、补给、复活。artifacts/q-sound-preview.wav');
}
