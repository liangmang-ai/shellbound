import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildProject } from '../scripts/build.mjs';

test('rebuilding an imported WeChat project preserves its repository and local settings', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shellbound-build-'));
  const webOutput = join(workspace, 'web'), wechatOutput = join(workspace, 'wechat');
  try {
    await mkdir(join(wechatOutput, '.git'), { recursive: true });
    const preserved = new Map([
      ['.git/HEAD', 'ref: refs/heads/user-game\n'],
      ['project.config.json', '{"appid":"user-game","setting":{"userChoice":true}}\n'],
      ['project.private.config.json', '{"setting":{"compileHotReLoad":true}}\n'],
      ['user-note.txt', 'A user-owned file in the imported checkout.\n'],
    ]);
    for (const [name, content] of preserved) await writeFile(join(wechatOutput, name), content);
    await writeFile(join(wechatOutput, 'game.js'), 'old generated bundle');
    await buildProject({ webOutput, wechatOutput });
    for (const [name, content] of preserved) assert.equal(await readFile(join(wechatOutput, name), 'utf8'), content, name);
    assert.ok((await readFile(join(wechatOutput, 'game.js'), 'utf8')).length > 1000, 'a complete generated bundle replaces the old file');
    assert.ok((await readFile(join(webOutput, 'app.js'), 'utf8')).length > 1000);
    const gameConfig = JSON.parse(await readFile(join(wechatOutput, 'game.json'), 'utf8'));
    assert.equal(gameConfig.openDataContext, 'open-data');
    const openDataBundle = await readFile(join(wechatOutput, gameConfig.openDataContext, 'index.js'), 'utf8');
    assert.ok(openDataBundle.length > 1000, 'the configured open-data domain has an independent generated entry');
    assert.equal(/require\(['"]\.\.\//.test(openDataBundle), false, 'the isolated domain does not rely on parent imports');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a fresh WeChat build creates the source-controlled project config', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shellbound-build-'));
  try {
    const wechatOutput = join(workspace, 'wechat');
    await buildProject({ webOutput: join(workspace, 'web'), wechatOutput });
    const config = JSON.parse(await readFile(join(wechatOutput, 'project.config.json'), 'utf8'));
    assert.equal(config.appid, 'wx1a1efb651d164fae');
    assert.equal(config.compileType, 'game');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
