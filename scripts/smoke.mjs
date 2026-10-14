import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = Number(process.env.SMOKE_PORT || 5198);
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
// Observe actual Canvas font metrics without changing app input or simulation.
const observeText = async page => page.addInitScript(() => {
  const original = CanvasRenderingContext2D.prototype.fillText;
  window.__shellboundTextDraws = [];
  CanvasRenderingContext2D.prototype.fillText = function(value, x, y, maxWidth) {
    if (this.font.includes('PingFang SC')) {
      const metric = this.measureText(String(value)), matrix = this.getTransform(), rect = this.canvas.getBoundingClientRect();
      const corners = [[x - metric.actualBoundingBoxLeft, y - metric.actualBoundingBoxAscent],
        [x + metric.actualBoundingBoxRight, y + metric.actualBoundingBoxDescent]];
      const points = corners.map(([px, py]) => ({
        x: rect.x + (matrix.a * px + matrix.c * py + matrix.e) * rect.width / this.canvas.width,
        y: rect.y + (matrix.b * px + matrix.d * py + matrix.f) * rect.height / this.canvas.height,
      }));
      window.__shellboundTextDraws.push({ value: String(value), font: this.font,
        left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)),
        top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)) });
      if (window.__shellboundTextDraws.length > 500) window.__shellboundTextDraws.shift();
    }
    return original.call(this, value, x, y, ...(maxWidth === undefined ? [] : [maxWidth]));
  };
});
const checkVisibleText = async (page, state, { menu = false } = {}) => {
  const viewport = page.viewportSize();
  const draws = await page.evaluate(() => window.__shellboundTextDraws);
  const isHudText = value => /^(生命 |盾牌 |备用 |剩余 )/.test(value) || / · 第 /.test(value)
    || ['Ⅱ 暂停', '开火', '爆发', '切枪'].includes(value)
    || /^手雷 \d+$/.test(value);
  const unique = [...new Map(draws.filter(draw => menu ? /[\u4e00-\u9fff]/.test(draw.value)
    : isHudText(draw.value))
    .map(draw => [`${draw.value}:${draw.left}:${draw.top}`, draw])).values()];
  assert.ok(unique.length > 0, 'actual Chinese Canvas text was observed');
  for (const draw of unique) {
    assert.ok(draw.left >= -1 && draw.right <= viewport.width + 1 && draw.top >= -1 && draw.bottom <= viewport.height + 1,
      `Canvas text remains visible at ${viewport.width}×${viewport.height}: ${draw.value}`);
  }
  if (menu) {
    assert.equal(unique.some(draw => /点击选择|已选择/.test(draw.value)), false, 'map selection omits redundant instructions');
    for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i], b = unique[j];
      assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
        `Menu text does not overlap at ${viewport.width}×${viewport.height}: ${a.value} / ${b.value}`);
    }
    for (const label of ['休闲', '标准', '挑战']) {
      const difficulty = state.buttons.find(button => button.label === label);
      assert.ok(difficulty && difficulty.w * state.layout.scale >= 44 && difficulty.h * state.layout.scale >= 44,
        `${label} difficulty has a usable touch target`);
    }
  }
  if (!menu) assert.equal(draws.some(draw => /加速\s*[×x]/.test(draw.value)), false, 'speed terrain does not add redundant HUD text');
  if (state.weaponPicker) {
    const names = ['手枪', '冲锋枪', '步枪', '机枪', '大狙', '霰弹枪'];
    const labels = ['啵啵手枪', '跳豆冲锋枪', '薄荷步枪', '爆米花机枪', '星光大狙', '脆壳霰弹枪'];
    for (let i = 0; i < names.length; i++) {
      const draw = draws.findLast(item => item.value === names[i]);
      const card = state.buttons.find(button => button.label === labels[i]);
      const { ox, oy, scale } = state.layout;
      assert.ok(draw && draw.left >= ox + card.x * scale && draw.right <= ox + (card.x + card.w) * scale
        && draw.top >= oy + card.y * scale && draw.bottom <= oy + (card.y + card.h) * scale,
      `Actual weapon caption fits its card: ${names[i]}`);
    }
  }
};
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview server startup timeout')), 5000);
    server.stdout.on('data', () => { clearTimeout(timeout); resolve(); });
    server.stderr.on('data', data => { clearTimeout(timeout); reject(new Error(String(data))); });
    server.once('error', reject);
    server.once('exit', code => { if (code) reject(new Error(`Server exited ${code}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 880 }, deviceScaleFactor: 1 });
  await observeText(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__shellbound?.getSnapshot().buttons.length > 0);
  const snapshot = () => page.evaluate(() => window.__shellbound.getSnapshot());
  const gunLabels = ['啵啵手枪', '跳豆冲锋枪', '薄荷步枪', '爆米花机枪', '星光大狙', '脆壳霰弹枪'];
  const separateRectangles = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  const checkPausePlacement = state => {
    const pause = state.buttons.find(button => button.label.includes('暂停'));
    assert.ok(pause, 'The relocated pause control is present');
    const stats = { x: 24, y: 18, w: 326, h: 126 }, wave = { x: state.layout.w / 2 - 124, y: 20, w: 248, h: 65 };
    assert.ok(separateRectangles(stats, wave) && separateRectangles(stats, pause) && separateRectangles(wave, pause), 'Stats, wave counter, and pause remain separated');
    const capsule = { x: state.layout.w - 170 / state.layout.scale, y: 0, w: 170 / state.layout.scale, h: 72 / state.layout.scale };
    assert.ok(separateRectangles(pause, capsule), 'Pause stays outside the WeChat upper-right icon/capsule region');
    for (const [role, circle] of Object.entries(state.controls)) {
      const x = Math.max(pause.x, Math.min(circle.x, pause.x + pause.w));
      const y = Math.max(pause.y, Math.min(circle.y, pause.y + pause.h));
      assert.ok(Math.hypot(x - circle.x, y - circle.y) >= circle.r, `Pause never blocks the ${role} circle`);
    }
    for (const button of state.buttons.filter(button => button !== pause && !button.role)) {
      assert.ok(separateRectangles(pause, button), `Pause never blocks ${button.label}`);
    }
    if (state.weaponPicker) assert.ok(separateRectangles(pause, { x: 24, y: 156, w: 326, h: 196 }), 'Expanded weapon library leaves pause unobstructed');
  };
  const checkCombatLayout = state => {
    const picker = state.buttons.find(button => button.label === '切换武器');
    assert.ok(picker, 'The compact weapon HUD has one large picker entry');
    assert.ok(picker.w * state.layout.scale >= 44 && picker.h * state.layout.scale >= 44, 'Weapon picker has a usable touch area');
    assert.equal(state.weaponPicker, false, 'Weapon choices stay collapsed during combat');
    checkPausePlacement(state);
    assert.equal(state.controls.reload, undefined, 'The manual reload control has been replaced');
    const circles = ['move', 'fire', 'boost', 'grenade', 'weapon'].map(role => ({ role, ...state.controls[role] }));
    for (const circle of circles) {
      assert.ok(circle.x - circle.r >= 0 && circle.y - circle.r >= 0 && circle.x + circle.r <= state.layout.w && circle.y + circle.r <= state.layout.h,
        `${circle.role} must remain inside combat bounds`);
      assert.ok(circle.r * 2 * state.layout.scale >= 44, `${circle.role} needs a usable touch diameter`);
    }
    for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
      assert.ok(Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y) >= circles[i].r + circles[j].r,
        'Circular combat controls must not overlap');
    }
  };
  const checkWeaponPicker = state => {
    assert.equal(state.weaponPicker, true);
    checkPausePlacement(state);
    const cards = gunLabels.map(label => state.buttons.find(button => button.label === label));
    assert.ok(cards.every(Boolean), 'Opening the picker offers all six weapon choices');
    for (const card of cards) {
      assert.ok(card.w * state.layout.scale >= 44 && card.h * state.layout.scale >= 44, 'Each weapon choice has a usable touch area');
      assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.w <= state.layout.w && card.y + card.h <= state.layout.h, 'Weapon choices remain on screen');
      assert.ok(card.y + card.h < state.controls.move.y - state.controls.move.r, 'Weapon choices remain grouped above the movement control');
    }
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'Weapon choices must not overlap');
    }
  };
  const clickLabel = async (label) => {
    await page.waitForFunction(label => window.__shellbound.getSnapshot().buttons.some(button => button.label.includes(label)), label);
    const state = await snapshot();
    const button = state.buttons.find(button => button.label.includes(label));
    assert.ok(button, `Missing button ${label}`);
    const { scale, ox, oy } = state.layout;
    await page.mouse.click(ox + (button.x + button.w / 2) * scale, oy + (button.y + button.h / 2) * scale);
    await page.waitForTimeout(80);
  };
  await mkdir('artifacts', { recursive: true });
  let state = await snapshot();
  assert.equal(state.selectedMap, 'greenhouse', 'The workshop is the default first map');
  assert.equal(state.selectedDifficulty, 'easy', 'The first run defaults to accessible difficulty');
  const workshopChoice = state.buttons.find(button => button.label === '汽泡工坊');
  const corridorChoice = state.buttons.find(button => button.label === '星糖回廊');
  assert.ok(workshopChoice.y < corridorChoice.y, 'The creative map follows the workshop');
  assert.equal(state.buttons.some(button => button.label === '薄荷庭院'), false);
  await checkVisibleText(page, state, { menu: true });
  await clickLabel('挑战');
  assert.equal((await snapshot()).selectedDifficulty, 'hard');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__shellbound?.getSnapshot().buttons.length > 0);
  assert.equal((await snapshot()).selectedDifficulty, 'hard', 'Difficulty selection survives a browser reload');
  await clickLabel('休闲');
  await page.screenshot({ path: 'artifacts/menu.png' });
  await clickLabel('操作指南'); assert.equal((await snapshot()).help, true);
  await clickLabel('准备好了');
  await clickLabel('汽泡工坊'); assert.equal((await snapshot()).selectedMap, 'greenhouse');
  await clickLabel('开始突围');
  state = await snapshot(); assert.equal(state.screen, 'game'); assert.equal(state.game.mapId, 'greenhouse');
  assert.equal(state.game.difficultyId, 'easy');
  assert.equal(state.game.revivesRemaining, 3);
  assert.equal(state.game.environment.barrels.length, 4);
  assert.equal(state.game.environment.speedZones.length, 2);
  assert.equal(state.settings.aimAssist, true);
  checkCombatLayout(state);
  await checkVisibleText(page, state);
  await clickLabel('切换武器');
  checkWeaponPicker(await snapshot());
  await checkVisibleText(page, await snapshot());
  await clickLabel('收起');
  checkCombatLayout(await snapshot());
  const initialX = state.game.player.x;
  await page.keyboard.down('d'); await page.waitForFunction(x => window.__shellbound.getSnapshot().game.player.x > x + 30, initialX); await page.keyboard.up('d');
  state = await snapshot(); assert.ok(state.game.player.x > initialX + 20, `Keyboard movement must move player: ${JSON.stringify({initialX,game:state.game,paused:state.paused,help:state.help})}`);
  await page.mouse.move(920, 400); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
  state = await snapshot(); assert.ok(state.game.player.weapons.pistol.clip < 12, 'Firing must consume a clip');
  assert.equal(state.audio.supported, true);
  assert.ok(state.audio.played > 0, 'Chrome starts actual Web Audio voices after a gesture');
  assert.equal(state.audio.failures, 0);
  const grenadeCount = state.game.player.grenades;
  await page.keyboard.press('g'); await page.waitForTimeout(100);
  state = await snapshot(); assert.equal(state.game.player.grenades, grenadeCount - 1); assert.ok(state.game.grenadeCount > 0);
  const clipBeforeBurst = state.game.player.weapons.pistol.clip;
  assert.equal(state.game.player.boostCharges, 1);
  await page.keyboard.press('r'); await page.waitForTimeout(100);
  state = await snapshot();
  assert.equal(state.game.player.boostCharges, 0, 'R consumes one burst charge');
  assert.ok(state.game.player.boostRemaining > 7.7);
  assert.equal(state.game.player.weapons.pistol.reloadRemaining, 0, 'R no longer manually reloads');
  assert.equal(state.game.player.weapons.pistol.clip, clipBeforeBurst);
  await page.keyboard.press('Escape'); state = await snapshot(); assert.equal(state.paused, true);
  assert.equal(state.audio.activeVoices, 0, 'Pause stops all audible combat voices');
  await clickLabel('音效：开');
  assert.equal((await snapshot()).settings.muted, true);
  await clickLabel('音效：关');
  const frozenTime = state.game.time;
  const frozenBurst = state.game.player.boostRemaining;
  await page.waitForTimeout(300); assert.equal((await snapshot()).game.time, frozenTime, 'Pause must stop simulation');
  assert.equal((await snapshot()).game.player.boostRemaining, frozenBurst, 'Pause preserves burst time');
  await clickLabel('继续突围'); await page.waitForTimeout(1100);
  assert.equal((await snapshot()).game.player.weapons.pistol.clip, clipBeforeBurst, 'Burst preserves the magazine when no shot is held');
  await page.screenshot({ path: 'artifacts/arena.png' });
  await page.keyboard.press('Escape'); await clickLabel('重新开始');
  state = await snapshot(); assert.equal(state.game.wave, 1); assert.equal(state.game.player.grenades, 3); assert.equal(state.game.player.shield, 35);
  const barrel = state.game.environment.barrels[1], { arena, layout } = state;
  const barrelScreen = { x: layout.ox + (barrel.x - arena.camera.x) * arena.scale * layout.scale,
    y: layout.oy + (barrel.y - arena.camera.y) * arena.scale * layout.scale };
  await page.mouse.move(barrelScreen.x, barrelScreen.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__shellbound.getSnapshot().game.environment.barrels.filter(barrel => !barrel.active).length >= 2);
  await page.mouse.up();
  state = await snapshot();
  assert.ok(state.game.environment.barrels[0].respawnRemaining > 0);
  await page.screenshot({ path: 'artifacts/workshop-barrels.png' });
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__shellbound.getSnapshot().game.environment.speedMultiplier > 1);
  await page.keyboard.up('w');
  assert.equal((await snapshot()).game.environment.speedMultiplier, 1.45);
  await page.screenshot({ path: 'artifacts/workshop-speed.png' });
  await page.keyboard.press('Escape'); await clickLabel('返回战区'); assert.equal((await snapshot()).screen, 'menu');
  await clickLabel('星糖回廊');
  await clickLabel('标准');
  await clickLabel('开始突围');
  state = await snapshot();
  assert.equal(state.game.mapId, 'candyloop');
  assert.equal(state.game.difficultyId, 'normal');
  assert.equal(state.game.environment.speedZones.length, 2);
  await page.screenshot({ path: 'artifacts/candy-corridor.png' });
  await page.keyboard.press('Escape'); await clickLabel('重新开始');
  state = await snapshot();
  assert.equal(state.game.mapId, 'candyloop', 'Restart keeps the creative map');
  assert.equal(state.game.difficultyId, 'normal', 'Restart keeps the selected difficulty');
  assert.equal(state.game.wave, 1);
  assert.equal(state.game.revivesRemaining, 3);
  await page.keyboard.press('Escape'); await clickLabel('返回战区');

  for (const [width, height] of [[844, 390], [915, 412], [667, 375], [800, 600], [900, 675]]) {
    const mobile = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
    await observeText(mobile);
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await mobile.waitForFunction(() => window.__shellbound?.getSnapshot().buttons.length > 0);
    const mobileSnapshot = () => mobile.evaluate(() => window.__shellbound.getSnapshot());
    const canvasRect = await mobile.locator('canvas').boundingBox();
    assert.ok(canvasRect.height <= height && canvasRect.width <= width, 'Mobile canvas must fit the visible viewport');
    const menuState = await mobileSnapshot();
    await checkVisibleText(mobile, menuState, { menu: true });
    assert.equal(menuState.selectedDifficulty, 'easy');
    if (width === 844) await mobile.screenshot({ path: 'artifacts/mobile-menu.png' });
    await mobile.screenshot({ path: `artifacts/mobile-${width}x${height}-menu.png` });
    const start = menuState.buttons.find(button => button.label.includes('开始突围'));
    await mobile.touchscreen.tap(menuState.layout.ox + (start.x + start.w / 2) * menuState.layout.scale,
      menuState.layout.oy + (start.y + start.h / 2) * menuState.layout.scale);
    await mobile.waitForFunction(() => {
      const state = window.__shellbound.getSnapshot();
      return state.screen === 'game' && state.buttons.some(button => button.label === '开火');
    });
    let ms = await mobileSnapshot();
    checkCombatLayout(ms);
    await checkVisibleText(mobile, ms);
    const tapMobileLabel = async label => {
      const state = await mobileSnapshot();
      const button = state.buttons.find(item => item.label === label);
      assert.ok(button, `Missing mobile button ${label}`);
      await mobile.touchscreen.tap(state.layout.ox + (button.x + button.w / 2) * state.layout.scale,
        state.layout.oy + (button.y + button.h / 2) * state.layout.scale);
      await mobile.waitForTimeout(80);
    };
    await tapMobileLabel('切换武器');
    checkWeaponPicker(await mobileSnapshot());
    await checkVisibleText(mobile, await mobileSnapshot());
    await mobile.screenshot({ path: `artifacts/mobile-${width}x${height}-weapons.png` });
    await tapMobileLabel('收起');
    ms = await mobileSnapshot();
    checkCombatLayout(ms);
    assert.ok(Math.abs(ms.layout.ox) < 1 && Math.abs(ms.layout.oy) < 1, 'Mobile combat has no letterboxing');
    assert.ok(Math.abs(ms.arena.w * ms.layout.scale - width) < 1 && Math.abs(ms.arena.h * ms.layout.scale - height) < 1,
      'Mobile arena fills the entire screen');
    const { move, fire, boost, grenade } = ms.controls;
    const mobileX = ms.game.player.x;
    const { ox, oy, scale } = ms.layout;
    const cdp = await mobile.context().newCDPSession(mobile);
    const t = (x, y, id) => ({ x: ox + x * scale, y: oy + y * scale, id });
    const moved = t(move.x + move.r * .8, move.y, 1), heldFire = t(fire.x, fire.y, 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [t(move.x, move.y, 1), heldFire] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved, heldFire] });
    await mobile.waitForTimeout(450);
    ms = await mobileSnapshot();
    assert.ok(ms.game.player.x > mobileX + 25, 'Left touch stick must move player');
    assert.ok(Math.abs(ms.game.player.angle) < .05, 'Movement right aims right while holding fire');
    assert.ok(ms.game.player.weapons.pistol.clip < 12, 'A stationary held fire button must shoot');
    const grenades = ms.game.player.grenades;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [moved, heldFire, t(grenade.x, grenade.y, 3)] });
    await mobile.waitForTimeout(80);
    assert.equal((await mobileSnapshot()).game.player.grenades, grenades, 'holding grenade previews before consuming inventory');
    const aimedGrenade = t(ms.layout.w / 2 + 130, ms.layout.h / 2 - 40, 3);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved, heldFire, aimedGrenade] });
    await mobile.waitForTimeout(80);
    ms = await mobileSnapshot();
    assert.ok(ms.grenadeAim && ms.grenadeAim.y < ms.game.player.y, 'dragging chooses a visible world landing above the player');
    assert.equal(ms.grenadeAim.range, 135);
    const beforeBurstX = ms.game.player.x, beforeBurstAmmo = ms.game.player.weapons.pistol.clip;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [moved, heldFire, aimedGrenade, t(boost.x, boost.y, 4)] });
    await mobile.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [t(boost.x, boost.y, 4)] });
    ms = await mobileSnapshot();
    assert.equal(ms.game.player.boostCharges, 0, 'A fourth finger spends the stored burst charge');
    assert.ok(ms.game.player.boostRemaining > 7.7 && ms.grenadeAim, 'Burst leaves the grenade landing preview active');
    assert.ok(ms.game.player.x > beforeBurstX, 'Burst leaves movement held');
    await mobile.waitForTimeout(150);
    assert.ok((await mobileSnapshot()).game.player.weapons.pistol.clip < beforeBurstAmmo, 'Burst leaves fire held');
    await mobile.screenshot({ path: `artifacts/mobile-${width}x${height}-grenade-aim.png` });
    // CDP touchEnd names the contacts being lifted, rather than the survivors.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [aimedGrenade] });
    await mobile.waitForTimeout(100);
    assert.equal((await mobileSnapshot()).game.player.grenades, grenades - 1, 'A third touch throws a grenade while moving and firing');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const ammoAfterRelease = (await mobileSnapshot()).game.player.weapons.pistol.clip;
    await mobile.waitForTimeout(300);
    assert.equal((await mobileSnapshot()).game.player.weapons.pistol.clip, ammoAfterRelease, 'Releasing all touches stops fire');
    await tapMobileLabel('Ⅱ 暂停');
    const pausedBurst = (await mobileSnapshot()).game.player.boostRemaining;
    await mobile.waitForTimeout(180);
    assert.equal((await mobileSnapshot()).game.player.boostRemaining, pausedBurst, 'Relocated pause freezes burst duration');
    await tapMobileLabel('继续突围');
    await mobile.touchscreen.tap(ox + boost.x * scale, oy + boost.y * scale);
    await mobile.waitForTimeout(100);
    ms = await mobileSnapshot();
    assert.equal(ms.game.player.boostCharges, 0, 'An empty burst control never spends additional inventory');
    assert.equal(ms.game.player.weapons.pistol.clip, ammoAfterRelease, 'Empty burst use does not reload or fire');
    await mobile.screenshot({ path: `artifacts/mobile-${width}x${height}-burst.png` });
    await mobile.screenshot({ path: width === 844 ? 'artifacts/mobile.png' : `artifacts/mobile-${width}x${height}.png` });
    ms = await mobileSnapshot();
    assert.ok(ms.buttons.every(button => ms.layout.oy + (button.y + button.h) * ms.layout.scale <= height
      && ms.layout.ox + (button.x + button.w) * ms.layout.scale <= width), 'Every touch button must remain on screen');
    await mobile.setViewportSize({ width: height, height: width });
    await mobile.waitForTimeout(80);
    const portraitTime = (await mobileSnapshot()).game.time;
    await mobile.waitForTimeout(180);
    assert.equal((await mobileSnapshot()).game.time, portraitTime, 'Portrait rotation must freeze game');
    await mobile.setViewportSize({ width, height });
    await mobile.waitForTimeout(100);
    const returned = await mobileSnapshot();
    assert.equal(returned.game.player.weapons.pistol.clip, ammoAfterRelease, 'Rotation does not leave fire held');
    await mobile.close();
  }
  assert.deepEqual(errors, [], 'Browser must not raise runtime errors');
  console.log('浏览器检查通过：工坊默认/回廊地图、难度持久化/重开、真实字体边界、武器库、四指移动+开火+投雷+爆发、暂停位置/冻结爆发、三种手机/两种平板横屏尺寸、横竖屏。');
  console.log('截图：artifacts/menu.png、artifacts/arena.png、artifacts/candy-corridor.png、artifacts/mobile.png、artifacts/mobile-*-grenade-aim.png、artifacts/mobile-*-burst.png、artifacts/mobile-*-weapons.png');
} finally {
  await browser?.close();
  server.kill();
}
