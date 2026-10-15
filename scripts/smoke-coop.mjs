import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createCoopServer } from '../server/server.mjs';

// Use real Canvas controls and two independent browsers over the actual room
// protocol. Only death fixtures below are injected into the authority for QA.
const port = Number(process.env.COOP_SMOKE_PORT || 5197);
const preview = spawn(process.execPath, ['scripts/serve.mjs'], {
  env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
const backend = createCoopServer({ local: true });
const browsers = [], errors = [];
const snapshot = page => page.evaluate(() => window.__shellbound.getSnapshot());
async function click(page, label) {
  await page.waitForFunction(label => window.__shellbound?.getSnapshot().buttons.some(button => button.label === label), label);
  const state = await snapshot(page), button = state.buttons.find(button => button.label === label);
  assert.ok(button, `button ${label} exists`);
  await page.mouse.click(state.layout.ox + (button.x + button.w / 2) * state.layout.scale,
    state.layout.oy + (button.y + button.h / 2) * state.layout.scale);
}
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
    preview.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    preview.stderr.once('data', data => { clearTimeout(timeout); reject(new Error(String(data))); });
    preview.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  await backend.listen(8787);
  for (let index = 0; index < 2; index++) browsers.push(await chromium.launch({ channel: 'chrome', headless: true }));
  const pages = await Promise.all(browsers.map(browser => browser.newPage({ viewport: { width: 844, height: 390 } })));
  const [host, guest] = pages;
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await click(page, '双人合作');
  }
  await click(host, '创建房间');
  await host.waitForFunction(() => window.__shellbound.getSnapshot().coop.room?.code);
  const code = (await snapshot(host)).coop.room.code;
  assert.match(code, /^\d{6}$/);
  await mkdir('artifacts', { recursive: true });
  await host.screenshot({ path: 'artifacts/coop-room.png' });
  await click(guest, '输入房间码加入');
  for (const digit of code) await click(guest, digit);
  await click(guest, '加入房间');
  await click(host, '开始双人突围');
  for (const page of pages) await page.waitForFunction(() => window.__shellbound.getSnapshot().game?.online);
  let h = await snapshot(host), g = await snapshot(guest);
  assert.equal(h.game.players.length, 2); assert.equal(g.game.players.length, 2);
  assert.equal(h.coop.room.playerId, 'p1'); assert.equal(g.coop.room.playerId, 'p2');
  assert.equal(h.game.mapId, g.game.mapId); assert.equal(h.game.wave, g.game.wave);
  assert.notEqual(h.game.player.x, g.game.player.x);
  const initialX = h.game.player.x, initialY = g.game.player.y;
  await host.keyboard.down('d'); await guest.keyboard.down('s');
  await host.waitForFunction(x => window.__shellbound.getSnapshot().game.player.x > x + 25, initialX);
  await guest.waitForFunction(y => window.__shellbound.getSnapshot().game.player.y > y + 25, initialY);
  await host.keyboard.up('d'); await guest.keyboard.up('s');
  await click(host, '爆发');
  await host.waitForFunction(() => window.__shellbound.getSnapshot().game.player.boostCharges === 0);
  assert.equal((await snapshot(guest)).game.player.boostCharges, 1, 'a boost belongs to the triggering player');
  await guest.keyboard.press('g');
  await guest.waitForFunction(() => window.__shellbound.getSnapshot().game.player.grenades === 2);
  assert.equal((await snapshot(host)).game.player.grenades, 3);
  const hostClip = (await snapshot(host)).game.player.weapons.pistol.clip;
  const guestClip = (await snapshot(guest)).game.player.weapons.pistol.clip;
  for (const page of pages) {
    const state = await snapshot(page), fire = state.controls.fire;
    await page.mouse.move(state.layout.ox + fire.x * state.layout.scale, state.layout.oy + fire.y * state.layout.scale);
    await page.mouse.down();
  }
  await host.waitForFunction(clip => window.__shellbound.getSnapshot().game.player.weapons.pistol.clip < clip, hostClip);
  await guest.waitForFunction(clip => window.__shellbound.getSnapshot().game.player.weapons.pistol.clip < clip, guestClip);
  await Promise.all(pages.map(page => page.mouse.up()));
  await click(host, 'Ⅱ 暂停');
  await guest.waitForFunction(() => window.__shellbound.getSnapshot().paused);
  await host.waitForFunction(() => window.__shellbound.getSnapshot().paused);
  // The initiator pauses its UI before the round trip completes. Wait for both
  // clients to display the authority's final tick instead of comparing an old
  // local frame with the teammate's already-acknowledged frame.
  const authority = backend.rooms.get(code);
  const pausedTime = authority.game.time;
  for (const page of pages) await page.waitForFunction(time => window.__shellbound.getSnapshot().game.time === time, pausedTime);
  await host.waitForTimeout(150);
  assert.equal((await snapshot(host)).game.time, pausedTime);
  assert.equal((await snapshot(guest)).game.time, pausedTime);
  await click(host, '继续突围');
  await guest.waitForFunction(() => !window.__shellbound.getSnapshot().paused);
  // The authority fixture models a downed guest; the live UI must recover that
  // player without restarting the host or resetting the shared world.
  authority.game.players.p2.hp = 0; authority.game.players.p2.shield = 0;
  await guest.waitForFunction(() => window.__shellbound.getSnapshot().game.status === 'dead');
  assert.equal((await snapshot(host)).game.status, 'playing');
  await click(guest, '免费复活 · 剩余 3 次');
  await guest.waitForFunction(() => window.__shellbound.getSnapshot().game.status === 'playing'
    && window.__shellbound.getSnapshot().game.revivesRemaining === 2);
  assert.equal((await snapshot(host)).game.revivesRemaining, 3);
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `artifacts/coop-player-${index + 1}.png` });
  // Rotation pauses both players and foreground return does not silently resume.
  await guest.setViewportSize({ width: 390, height: 844 });
  await host.waitForFunction(() => window.__shellbound.getSnapshot().paused);
  await guest.setViewportSize({ width: 844, height: 390 });
  await click(guest, '继续突围');
  await host.waitForFunction(() => !window.__shellbound.getSnapshot().paused);
  await guest.close();
  await host.waitForFunction(() => window.__shellbound.getSnapshot().screen === 'coop'
    && window.__shellbound.getSnapshot().coop.view === 'error');
  assert.equal(backend.rooms.size, 0, 'disconnect removes the whole room');
  assert.deepEqual(errors, []);
  console.log('双浏览器联机通过：建房/数字码加入、双角色移动开火、个人道具、同步暂停、独立复活、旋转和断线清理。');
  console.log('截图：artifacts/coop-room.png、coop-player-1.png、coop-player-2.png');
} finally {
  await Promise.allSettled(browsers.map(browser => browser.close()));
  await backend.close(); preview.kill('SIGTERM');
}
