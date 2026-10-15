import { build } from 'esbuild';
import { constants } from 'node:fs';
import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildProject({ webOutput = resolve(root, 'dist/web'), wechatOutput = resolve(root, 'dist/wechat') } = {}) {

  // An imported WeChat output can also contain the user's Git repository and
  // developer-tool settings. Only refresh our generated files inside that folder.
  await rm(webOutput, { recursive: true, force: true });
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
    build({
      absWorkingDir: root,
      entryPoints: ['wechat/open-data/index.js'],
      bundle: true,
      format: 'iife',
      target: 'es2019',
      outfile: resolve(wechatOutput, 'open-data/index.js'),
      legalComments: 'none',
    }),
    copyFile(resolve(root, 'web/index.html'), resolve(webOutput, 'index.html')),
    copyFile(resolve(root, 'wechat/game.json'), resolve(wechatOutput, 'game.json')),
    copyFile(resolve(root, 'wechat/project.config.json'), resolve(wechatOutput, 'project.config.json'), constants.COPYFILE_EXCL)
      .catch(error => { if (error.code !== 'EEXIST') throw error; }),
    cp(resolve(root, 'assets/audio'), resolve(webOutput, 'assets/audio'), { recursive: true }),
    cp(resolve(root, 'assets/audio'), resolve(wechatOutput, 'assets/audio'), { recursive: true }),
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildProject();
  console.log('构建完成：dist/web、dist/wechat（保留微信本地 Git 与工程设置）');
}
