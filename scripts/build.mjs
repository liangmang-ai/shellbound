import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webOutput = resolve(root, 'dist/web');
const wechatOutput = resolve(root, 'dist/wechat');

// These two directories are generated artifacts, never source directories.
await Promise.all([
  rm(webOutput, { recursive: true, force: true }),
  rm(wechatOutput, { recursive: true, force: true }),
]);
await Promise.all([
  mkdir(webOutput, { recursive: true }),
  mkdir(wechatOutput, { recursive: true }),
]);

await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ['src/browser.js'],
    bundle: true,
    format: 'iife',
    target: 'es2019',
    outfile: resolve(webOutput, 'app.js'),
    sourcemap: true,
    legalComments: 'none',
  }),
  build({
    absWorkingDir: root,
    entryPoints: ['wechat/game.js'],
    bundle: true,
    format: 'iife',
    target: 'es2019',
    outfile: resolve(wechatOutput, 'game.js'),
    legalComments: 'none',
  }),
  copyFile(resolve(root, 'web/index.html'), resolve(webOutput, 'index.html')),
  copyFile(resolve(root, 'wechat/game.json'), resolve(wechatOutput, 'game.json')),
  copyFile(resolve(root, 'wechat/project.config.json'), resolve(wechatOutput, 'project.config.json')),
]);

console.log('构建完成：dist/web、dist/wechat');
