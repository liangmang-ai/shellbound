import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_DEFINITIONS, synthesizeSound, encodeWav } from '../src/audio-synthesis.js';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/audio');
await mkdir(directory, { recursive: true });
await Promise.all(Object.keys(SOUND_DEFINITIONS).map(name => writeFile(resolve(directory, `${name}.wav`), encodeWav(synthesizeSound(name)))));
console.log(`生成 ${Object.keys(SOUND_DEFINITIONS).length} 个原创音效：assets/audio`);
