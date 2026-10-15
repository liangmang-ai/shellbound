import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const files = [
  'server/server.mjs', 'server/package.json', 'server/package-lock.json',
  'src/game.js', 'src/coop-game.js', 'src/profile.js',
];

export async function packageServer({ outputDir = resolve(root, 'artifacts/shellbound-coop-server'),
  zipPath = resolve(root, 'artifacts/shellbound-coop-server.zip') } = {}) {
  // Resolve every input before replacing a previous package. Never copy the
  // checkout, generated WeChat project, database credentials, or node_modules.
  const inputs = await Promise.all(files.map(async path => ({ path, data: await readFile(resolve(root, path)) })));
  const dockerfile = await readFile(resolve(root, 'Dockerfile'));
  await rm(outputDir, { recursive: true, force: true });
  for (const { path, data } of inputs) {
    const destination = resolve(outputDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
  await writeFile(resolve(outputDir, 'Dockerfile'), dockerfile);
  await writeFile(resolve(outputDir, 'package.json'), '{"private":true,"type":"module"}\n');
  await mkdir(dirname(zipPath), { recursive: true });
  await rm(zipPath, { force: true });
  await execute('zip', ['-qr', zipPath, '.'], { cwd: outputDir });
  const { size } = await stat(zipPath);
  if (size > 2 * 1024 * 1024) throw new Error('联机服务代码包超过微信云托管的 2 MiB 限制');
  return { outputDir, zipPath, bytes: size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await packageServer();
  console.log(`联机服务代码包已生成：${result.zipPath}（${result.bytes} 字节）`);
}
