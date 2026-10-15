import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Capture the actual app instance for observations; gameplay and rendering are
// bundled unchanged. No generated dist/ directory is required for these tests.
const output = await build({
  absWorkingDir: root,
  entryPoints: ['wechat/game.js'],
  bundle: true,
  format: 'iife',
  target: 'es2019',
  write: false,
  plugins: [{
    name: 'observe-wechat-app',
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/app\.js$/ }, () => ({ path: 'app', namespace: 'observe-app' }));
      builder.onLoad({ filter: /.*/, namespace: 'observe-app' }, () => ({
        contents: `import { createApp as realCreateApp } from ${JSON.stringify(resolve(root, 'src/app.js'))};
export function createApp(config) {
  const app = realCreateApp(config);
  globalThis.__observedApp = app;
  globalThis.__observedConfig = config;
  return app;
}`,
        loader: 'js',
        resolveDir: root,
      }));
    },
  }],
});
const bundle = output.outputFiles[0].text;

function rectanglesSeparate(a, b) {
  return a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
}

function rectangleOutsideCircle(rect, circle) {
  const x = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
  const y = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
  return Math.hypot(x - circle.x, y - circle.y) >= circle.r;
}

function checkPausePlacement(state, stats, wave) {
  const pause = state.buttons.find(button => button.label.includes('暂停'));
  assert.ok(pause, 'the pause control is present');
  assert.ok(rectanglesSeparate(pause, stats) && rectanglesSeparate(pause, wave), 'pause stays clear of stats and the wave counter');
  for (const [role, circle] of Object.entries(state.controls)) {
    assert.ok(rectangleOutsideCircle(pause, circle), `pause never blocks the ${role} circle`);
  }
  // Reserve a generous physical area for the native WeChat game icon/capsule.
  const capsule = { x: state.layout.w - 170 / state.layout.scale, y: 0, w: 170 / state.layout.scale, h: 72 / state.layout.scale };
  assert.ok(rectanglesSeparate(pause, capsule), 'pause stays outside the native upper-right icon/capsule area');
  for (const button of state.buttons.filter(button => button !== pause && !button.role)) {
    assert.ok(rectanglesSeparate(pause, button), `pause does not obstruct ${button.label}`);
  }
}

function harness({ scheduler = 'canvas', legacySizing = false, storageFailure = false, width = 844, height = 390, storedValues, wxExtras } = {}) {
  const events = {}, frames = new Map(), drawnText = [], textDraws = [], paintedPanels = [], storageReads = [];
  let pathPoints = [];
  const values = new Map(storedValues || [['shellbound:shellbound.best.v1', '{"wave":7,"score":123}']]);
  let nextId = 1;
  const size = { windowWidth: width, windowHeight: height, screenWidth: width, screenHeight: height, pixelRatio: 3 };
  const requestFrame = (callback) => { const id = nextId++; frames.set(id, callback); return id; };
  const cancelFrame = (id) => frames.delete(id);
  const context2d = new Proxy({
    fillText(value, x, y) {
      drawnText.push(String(value));
      textDraws.push({ value: String(value), x, y, font: this.font });
    },
    beginPath() { pathPoints = []; },
    moveTo(x, y) { pathPoints.push([x, y]); },
    lineTo(x, y) { pathPoints.push([x, y]); },
    quadraticCurveTo(cx, cy, x, y) { pathPoints.push([cx, cy], [x, y]); },
    fill() {
      if (!pathPoints.length) return;
      const xs = pathPoints.map(point => point[0]), ys = pathPoints.map(point => point[1]);
      paintedPanels.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), color: this.fillStyle });
    },
    createRadialGradient() { return { addColorStop() {} }; },
    measureText(value) { return { width: String(value).length * 8 }; },
  }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
  });
  const canvas = { getContext(type) { assert.equal(type, '2d'); return context2d; } };
  if (scheduler === 'canvas') Object.assign(canvas, { requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame });
  const wx = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => size,
    getStorageSync(key) {
      storageReads.push(key);
      if (storageFailure) throw new Error('Storage unavailable');
      return values.get(key) ?? '';
    },
    setStorageSync(key, value) {
      if (storageFailure) throw new Error('Storage unavailable');
      values.set(key, value);
    },
  };
  if (!legacySizing) wx.getWindowInfo = () => size;
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'WindowResize', 'Hide', 'Show']) {
    wx[`on${name}`] = (callback) => { events[name] = callback; };
  }
  Object.assign(wx, wxExtras);
  const environment = { wx, setTimeout: requestFrame, clearTimeout: cancelFrame };
  if (scheduler === 'global') Object.assign(environment, { requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame });
  // There is deliberately no browser window/document/localStorage in this VM.
  vm.runInNewContext(bundle, environment, { timeout: 1000 });
  const app = environment.__observedApp;
  function step(timestamp) {
    assert.equal(frames.size, 1, 'exactly one animation callback is queued');
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(timestamp);
    assert.equal(frames.size, 1, 'one callback is scheduled after drawing');
  }
  function touch(type, id, x, y) {
    const { scale, ox, oy } = app.getSnapshot().layout;
    events[`Touch${type}`]({ changedTouches: [{ identifier: id, clientX: x * scale + ox, clientY: y * scale + oy }] });
  }
  function tapLabel(label) {
    const button = app.getSnapshot().buttons.find(item => item.label === label || item.label.startsWith(label));
    assert.ok(button, `button ${label} is rendered`);
    touch('Start', 1, button.x + button.w / 2, button.y + button.h / 2);
    touch('End', 1, button.x + button.w / 2, button.y + button.h / 2);
  }
  function startGame(timestamp = 0) {
    step(timestamp);
    tapLabel('开始突围');
    step(timestamp + 16);
    assert.equal(app.getSnapshot().screen, 'game');
  }
  return { app, config: environment.__observedConfig, canvas, size, events, frames, step, touch, tapLabel, startGame, drawnText, textDraws, paintedPanels, storageReads, values };
}

test('WeChat entry never invokes withdrawn profile, privacy, friend or cloud-ranking APIs', () => {
  const calls = [];
  const names = ['getSetting', 'getUserInfo', 'getPrivacySetting', 'requirePrivacyAuthorize', 'createUserInfoButton',
    'getOpenDataContext', 'getFriendCloudStorage', 'getUserCloudStorage', 'setUserCloudStorage', 'authorize'];
  const h = harness({ wxExtras: Object.fromEntries(names.map(name => [name, () => { calls.push(name); throw new Error('Unexpected social API'); }])) });
  h.step(0);
  h.tapLabel('双人合作'); h.step(16);
  assert.equal(h.drawnText.some(value => /授权微信|好友榜|设置昵称/.test(value)), false);
  h.events.Hide(); h.events.Show(); h.step(32);
  h.tapLabel('返回地图选择'); h.step(48);
  h.tapLabel('开始突围'); h.step(64);
  h.events.Hide(); h.events.Show(); h.step(96);
  assert.deepEqual(calls, [], 'boot, room menu, combat and lifecycle use no social APIs');
  assert.equal(h.app.getSnapshot().screen, 'game');
});

for (const scheduler of ['canvas', 'global', 'timeout']) {
  test(`WeChat bundle boots without DOM and keeps one ${scheduler} animation loop`, () => {
    const h = harness({ scheduler });
    assert.equal(h.config.platform, 'wechat');
    assert.equal(h.canvas.width, 1688, 'app caps the device pixel ratio at two');
    assert.equal(h.canvas.height, 780);
    h.step(0);
    assert.ok(h.drawnText.includes('蛋壳突围'), 'the actual menu renders');
    assert.equal(h.app.getSnapshot().best.score, 123);
    assert.deepEqual(h.storageReads, ['shellbound:shellbound.best.v1', 'shellbound:shellbound.settings.v1']);

    const staleFrame = h.frames.values().next().value;
    h.events.Hide();
    assert.equal(h.frames.size, 0);
    staleFrame(16);
    assert.equal(h.frames.size, 0, 'a callback delivered while hidden cannot restart the loop');
    h.events.Show();
    h.events.Show();
    assert.equal(h.frames.size, 1, 'duplicate show events cannot add a second loop');
    h.step(32);
    h.events.Hide();
    assert.equal(h.frames.size, 0);
  });
}

test('WeChat difficulty selection survives relaunch and the creative map restarts with the selected mode', () => {
  const first = harness({ width: 667, height: 375 });
  first.step(0);
  const menu = first.app.getSnapshot();
  for (const label of ['音效：开', '操作指南']) {
    const control = menu.buttons.find(button => button.label === label);
    assert.ok(menu.layout.ox + (control.x + control.w) * menu.layout.scale < 667 - 200,
      'menu controls leave the native more-games button and capsule clear');
  }
  assert.equal(menu.selectedMap, 'greenhouse', 'the workshop is the first default map');
  assert.equal(menu.selectedDifficulty, 'easy', 'new players start in the accessible mode');
  const workshop = menu.buttons.find(button => button.label === '汽泡工坊');
  const corridor = menu.buttons.find(button => button.label === '星糖回廊');
  assert.ok(workshop && corridor && workshop.y < corridor.y, 'the new map follows the workshop');
  assert.equal(menu.buttons.some(button => button.label === '薄荷庭院'), false, 'the old courtyard is not offered');
  assert.equal(first.drawnText.some(text => /点击选择|已选择/.test(text)), false, 'map selection uses its visual state without redundant captions');
  assert.ok(menu.buttons.every(button => button.x >= 0 && button.y >= 0 && button.x + button.w <= menu.layout.w && button.y + button.h <= menu.layout.h), 'map and difficulty choices fit the smallest phone');
  first.tapLabel('挑战');
  first.step(16);
  assert.equal(first.app.getSnapshot().selectedDifficulty, 'hard');
  const persisted = JSON.parse(first.values.get('shellbound:shellbound.settings.v1'));
  assert.equal(persisted.difficultyId, 'hard');
  assert.equal(persisted.aimAssist, true);

  const relaunched = harness({ width: 667, height: 375, storedValues: first.values });
  relaunched.step(0);
  assert.equal(relaunched.app.getSnapshot().selectedDifficulty, 'hard', 'a new WeChat instance reads the saved difficulty');
  relaunched.tapLabel('星糖回廊');
  relaunched.step(16);
  relaunched.tapLabel('开始突围');
  relaunched.step(32);
  let state = relaunched.app.getSnapshot();
  assert.equal(state.game.mapId, 'candyloop');
  assert.equal(state.game.difficultyId, 'hard');
  assert.equal(state.game.revivesRemaining, 3);
  assert.equal(state.game.environment.speedZones.length, 2);
  relaunched.tapLabel('Ⅱ 暂停');
  relaunched.step(48);
  relaunched.tapLabel('重新开始');
  relaunched.step(64);
  state = relaunched.app.getSnapshot();
  assert.equal(state.game.mapId, 'candyloop', 'restart retains the chosen map');
  assert.equal(state.game.difficultyId, 'hard', 'restart retains the chosen difficulty');
  assert.equal(state.game.wave, 1);
  assert.equal(state.game.revivesRemaining, 3);

  relaunched.tapLabel('Ⅱ 暂停');
  relaunched.step(80);
  relaunched.tapLabel('返回战区');
  relaunched.step(96);
  relaunched.tapLabel('标准');
  relaunched.step(112);
  relaunched.tapLabel('汽泡工坊');
  relaunched.step(128);
  relaunched.tapLabel('开始突围');
  relaunched.step(144);
  state = relaunched.app.getSnapshot();
  assert.equal(state.game.difficultyId, 'normal', 'returning to map selection applies a newly chosen difficulty');
  assert.equal(state.game.mapId, 'greenhouse');
});

test('WeChat ignores invalid saved difficulty without losing sound or aim preferences', () => {
  const h = harness({ storedValues: [['shellbound:shellbound.settings.v1', JSON.stringify({ difficultyId: '__proto__', muted: true, aimAssist: false })]] });
  h.startGame();
  const state = h.app.getSnapshot();
  assert.equal(state.selectedDifficulty, 'easy');
  assert.equal(state.game.difficultyId, 'easy');
  assert.equal(state.settings.muted, true);
  assert.equal(state.settings.aimAssist, false);
});

test('WeChat movement sets aim and a stationary fire press shoots until release or cancel', () => {
  const h = harness();
  h.startGame();
  const { move, fire } = h.app.getSnapshot().controls;
  const startX = h.app.getSnapshot().game.player.x;
  h.touch('Start', 12, move.x, move.y);
  h.touch('Move', 12, move.x + move.r * .8, move.y);
  h.step(32);
  const movingX = h.app.getSnapshot().game.player.x;
  assert.ok(movingX > startX, 'logical coordinates survive device scaling');
  assert.ok(Math.abs(h.app.getSnapshot().game.player.angle) < .05, 'moving right aims right');
  h.touch('End', 12, move.x + move.r * .8, move.y);
  h.step(48);
  assert.equal(h.app.getSnapshot().game.player.x, movingX);

  h.touch('Start', 13, fire.x, fire.y);
  h.step(64);
  const remaining = h.app.getSnapshot().game.player.weapons.pistol.clip;
  assert.ok(remaining < 12, 'holding the circular fire button fires without dragging');
  assert.ok(Math.abs(h.app.getSnapshot().game.player.angle) < .05, 'stationary fire retains the last movement aim');
  h.touch('Cancel', 13, fire.x, fire.y);
  for (let timestamp = 80; timestamp <= 400; timestamp += 16) h.step(timestamp);
  assert.equal(h.app.getSnapshot().game.player.weapons.pistol.clip, remaining, 'cancel stops sustained shooting');
});

test('WeChat circular burst and grenade buttons isolate actions from held movement and fire', () => {
  const h = harness();
  h.startGame();
  const { move, fire, boost, grenade } = h.app.getSnapshot().controls;
  h.touch('Start', 31, move.x, move.y);
  h.touch('Move', 31, move.x + move.r * .7, move.y);
  h.touch('Start', 32, fire.x, fire.y);
  h.step(32);
  h.touch('End', 32, fire.x, fire.y);
  const before = h.app.getSnapshot().game.player;

  h.touch('Start', 33, boost.x - boost.r + 1, boost.y - boost.r + 1);
  h.touch('End', 33, boost.x - boost.r + 1, boost.y - boost.r + 1);
  h.step(48);
  assert.equal(h.app.getSnapshot().game.player.boostCharges, 1, 'a point outside the burst circle cannot spend a charge');
  assert.equal(h.app.getSnapshot().game.player.boostRemaining, 0);

  h.touch('Start', 34, grenade.x, grenade.y);
  h.touch('End', 34, grenade.x, grenade.y);
  h.step(64);
  let after = h.app.getSnapshot().game.player;
  assert.equal(after.grenades, before.grenades - 1, 'the grenade touch triggers its own action');
  assert.equal(after.weapons.pistol.clip, before.weapons.pistol.clip, 'grenade and burst-edge touches do not fire');
  assert.ok(after.x > before.x, 'action touches leave the independently held movement touch active');

  h.touch('Start', 35, boost.x, boost.y);
  h.touch('End', 35, boost.x, boost.y);
  h.step(80);
  after = h.app.getSnapshot().game.player;
  assert.equal(after.boostCharges, 0, 'the burst circle spends exactly one stored charge');
  assert.ok(after.boostRemaining > 7.9 && after.boostRemaining <= 8);
  assert.equal(after.weapons.pistol.reloadRemaining, 0, 'burst does not manually reload the magazine');
  assert.equal(after.weapons.pistol.clip, before.weapons.pistol.clip);
  assert.ok(after.x > before.x, 'spending a burst charge leaves movement active');
  h.touch('Cancel', 31, move.x, move.y);
});

for (const [width, height] of [[844, 390], [915, 412], [667, 375], [800, 600], [900, 675]]) {
  test(`WeChat combat fills ${width}×${height} and circular controls fit without overlap`, () => {
    const h = harness({ width, height });
    h.startGame();
    const { layout, arena, controls, buttons } = h.app.getSnapshot();
    assert.ok(Math.abs(layout.ox) < 1 && Math.abs(layout.oy) < 1, 'combat uses the whole landscape viewport');
    assert.ok(Math.abs(layout.w * layout.scale - width) < 1 && Math.abs(layout.h * layout.scale - height) < 1);
    assert.equal(arena.w, layout.w);
    assert.equal(arena.h, layout.h);
    assert.ok(arena.scale * layout.scale > .75, 'world objects remain enlarged on compact phones');
    const circles = ['move', 'fire', 'boost', 'grenade', 'weapon'].map(role => ({ role, ...controls[role] }));
    for (const control of circles) {
      assert.ok(control.x - control.r >= 0 && control.x + control.r <= layout.w, `${control.role} fits horizontally`);
      assert.ok(control.y - control.r >= 0 && control.y + control.r <= layout.h, `${control.role} fits vertically`);
      assert.ok(control.r * 2 * layout.scale >= 44, `${control.role} has at least a 44px touch diameter`);
    }
    for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
      assert.ok(Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y) >= circles[i].r + circles[j].r,
        `${circles[i].role} and ${circles[j].role} circles do not overlap`);
    }
    assert.ok(buttons.every(button => button.x >= 0 && button.y >= 0 && button.x + button.w <= layout.w && button.y + button.h <= layout.h), 'every HUD button remains inside the viewport');
    const entry = buttons.find(button => button.label === '切换武器');
    const stats = h.paintedPanels.findLast(panel => panel.x === entry.x && panel.w === entry.w && panel.y < entry.y && panel.y + panel.h >= entry.y + entry.h);
    const wave = h.paintedPanels.findLast(panel => panel.x + panel.w / 2 === layout.w / 2 && panel.y < 40 && panel.y + panel.h > 68);
    const pause = buttons.find(button => button.label.includes('暂停'));
    assert.ok(stats && wave && pause, 'the actual rendered stats, wave, and pause HUD are observable');
    assert.ok(rectanglesSeparate(stats, wave), 'stats and wave panels never overlap, including 4:3 tablets');
    checkPausePlacement(h.app.getSnapshot(), stats, wave);
    const waveLabel = h.textDraws.findLast(draw => draw.value.includes(' · 第 '));
    assert.match(waveLabel.value, /^休闲 · 第 \d+ 波$/, 'the endless counter omits a fixed last wave');
    assert.equal(h.textDraws.some(draw => /加速\s*[×x]/.test(draw.value)), false, 'terrain speed is communicated graphically');
    const smallHudText = h.textDraws.filter(draw => /^(生命 |盾牌 |备用 |打开武器库|辅助瞄准|剩余 )/.test(draw.value));
    assert.ok(smallHudText.length >= 4, 'actual health, shield, reserve, and wave labels render');
    assert.ok(smallHudText.every(draw => Number(/(\d+)px/.exec(draw.font)?.[1]) >= 18), 'HUD labels use enlarged readable fonts');
    assert.ok(entry.w * layout.scale >= 44 && entry.h * layout.scale >= 44, 'the collapsed weapon panel has a large touch entry');
    h.touch('Start', 50, entry.x + entry.w / 2, entry.y + entry.h / 2);
    h.touch('End', 50, entry.x + entry.w / 2, entry.y + entry.h / 2);
    h.step(32);
    const expanded = h.app.getSnapshot();
    assert.equal(expanded.weaponPicker, true);
    checkPausePlacement(expanded, stats, wave);
    const library = h.paintedPanels.findLast(panel => panel.x === 24 && panel.y === 156 && panel.w === 326);
    const expandedPause = expanded.buttons.find(button => button.label.includes('暂停'));
    assert.ok(library && rectanglesSeparate(expandedPause, library), 'expanded weapon library cannot cover the pause control');
    const labels = ['啵啵手枪', '跳豆冲锋枪', '薄荷步枪', '爆米花机枪', '星光大狙', '脆壳霰弹枪'];
    const cards = labels.map(label => expanded.buttons.find(button => button.label === label));
    assert.ok(cards.every(Boolean), 'all six weapon choices appear in the expanded picker');
    for (const card of cards) {
      assert.ok(card.w * layout.scale >= 44 && card.h * layout.scale >= 44, 'each weapon has a large touch target');
      assert.ok(card.x >= 0 && card.x + card.w <= layout.w && card.y >= 0 && card.y + card.h < controls.move.y - controls.move.r, 'weapon choices stay grouped above movement');
    }
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'weapon choices do not overlap');
    }
    const locked = cards[1];
    h.touch('Start', 51, locked.x + locked.w / 2, locked.y + locked.h / 2);
    h.touch('End', 51, locked.x + locked.w / 2, locked.y + locked.h / 2);
    h.step(48);
    assert.equal(h.app.getSnapshot().weaponPicker, true, 'choosing a locked weapon keeps the picker open');
    assert.equal(h.app.getSnapshot().game.player.currentWeapon, 'pistol');
    const owned = cards[0];
    h.touch('Start', 52, owned.x + owned.w / 2, owned.y + owned.h / 2);
    h.touch('End', 52, owned.x + owned.w / 2, owned.y + owned.h / 2);
    h.step(64);
    assert.equal(h.app.getSnapshot().weaponPicker, false, 'choosing an owned weapon collapses the picker');
  });
}

test('WeChat hide/show pauses active combat and resumes without simulating elapsed background time', () => {
  const h = harness();
  h.startGame();
  const { move, fire } = h.app.getSnapshot().controls;
  h.touch('Start', 20, move.x, move.y);
  h.touch('Move', 20, move.x + move.r * .7, move.y);
  h.touch('Start', 21, fire.x, fire.y);
  h.step(32);
  h.tapLabel('爆发'); h.step(48);
  const before = h.app.getSnapshot().game;
  assert.equal(before.player.boostCharges, 0);
  assert.ok(before.player.boostRemaining > 7.9);
  h.events.Hide();
  assert.equal(h.app.getSnapshot().paused, true);
  h.events.Show();
  h.step(100000);
  assert.equal(h.app.getSnapshot().game.time, before.time);
  assert.equal(h.app.getSnapshot().game.player.boostRemaining, before.player.boostRemaining, 'background time never consumes the burst timer');
  h.app.handleKey('down', 'Escape');
  h.step(100016);
  h.step(100032);
  const after = h.app.getSnapshot().game;
  assert.ok(after.time - before.time < 0.1);
  assert.equal(after.player.x, before.player.x, 'hidden touch input is cleared');
  assert.equal(after.player.weapons.pistol.clip, before.player.weapons.pistol.clip, 'hidden fire input is cleared');
  assert.equal(after.player.boostCharges, 0);
  assert.ok(Math.abs((before.player.boostRemaining - after.player.boostRemaining) - (after.time - before.time)) < 1e-9,
    'after resuming only foreground simulation time is spent from burst');
});

test('WeChat legacy sizing, resizing and unavailable storage stay playable', () => {
  const h = harness({ legacySizing: true, storageFailure: true });
  assert.equal(h.config.width, 844);
  assert.equal(h.app.getSnapshot().best.score, 0);
  assert.equal(h.config.storage.getItem('missing'), null);
  assert.doesNotThrow(() => h.config.storage.setItem('score', '20'));
  h.startGame();
  const { move, fire } = h.app.getSnapshot().controls;
  h.touch('Start', 40, move.x, move.y);
  h.touch('Move', 40, move.x + move.r * .8, move.y);
  h.touch('Start', 41, fire.x, fire.y);
  h.step(32);
  const beforeResize = h.app.getSnapshot().game.player;
  Object.assign(h.size, { windowWidth: 1280, windowHeight: 720, pixelRatio: 1 });
  h.events.WindowResize();
  assert.equal(h.canvas.width, 1280);
  assert.equal(h.canvas.height, 720);
  h.step(48);
  assert.equal(h.app.getSnapshot().screen, 'game');
  assert.equal(h.app.getSnapshot().game.player.x, beforeResize.x, 'resize clears held movement');
  for (let timestamp = 64; timestamp <= 400; timestamp += 16) h.step(timestamp);
  assert.equal(h.app.getSnapshot().game.player.weapons.pistol.clip, beforeResize.weapons.pistol.clip, 'resize clears held fire');
});
