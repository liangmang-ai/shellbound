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

function harness({ scheduler = 'canvas', legacySizing = false, storageFailure = false } = {}) {
  const events = {}, frames = new Map(), drawnText = [], storageReads = [];
  const values = new Map([['shellbound:shellbound.best.v1', '{"wave":7,"score":123}']]);
  let nextId = 1;
  const size = { windowWidth: 844, windowHeight: 390, screenWidth: 844, screenHeight: 390, pixelRatio: 3 };
  const requestFrame = (callback) => { const id = nextId++; frames.set(id, callback); return id; };
  const cancelFrame = (id) => frames.delete(id);
  const context2d = new Proxy({
    fillText(value) { drawnText.push(String(value)); },
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
  function startGame() {
    step(0);
    const button = app.getSnapshot().buttons.find(item => item.label.startsWith('开始突围'));
    assert.ok(button);
    touch('Start', 1, button.x + button.w / 2, button.y + button.h / 2);
    touch('End', 1, button.x + button.w / 2, button.y + button.h / 2);
    step(16);
    assert.equal(app.getSnapshot().screen, 'game');
  }
  return { app, config: environment.__observedConfig, canvas, size, events, frames, step, touch, startGame, drawnText, storageReads, values };
}

for (const scheduler of ['canvas', 'global', 'timeout']) {
  test(`WeChat bundle boots without DOM and keeps one ${scheduler} animation loop`, () => {
    const h = harness({ scheduler });
    assert.equal(h.config.platform, 'wechat');
    assert.equal(h.canvas.width, 1688, 'app caps the device pixel ratio at two');
    assert.equal(h.canvas.height, 780);
    h.step(0);
    assert.ok(h.drawnText.includes('蛋壳突围'), 'the actual menu renders');
    assert.equal(h.app.getSnapshot().best.score, 123);
    assert.deepEqual(h.storageReads, ['shellbound:shellbound.best.v1']);

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

test('WeChat touch coordinates drive movement/shooting and release or cancel clears them', () => {
  const h = harness();
  h.startGame();
  const startX = h.app.getSnapshot().game.player.x;
  h.touch('Start', 12, 100, 360);
  h.touch('Move', 12, 140, 360);
  h.step(32);
  const movingX = h.app.getSnapshot().game.player.x;
  assert.ok(movingX > startX, 'logical coordinates survive device scaling and letterboxing');
  h.touch('End', 12, 140, 360);
  h.step(48);
  assert.equal(h.app.getSnapshot().game.player.x, movingX);

  h.touch('Start', 13, 800, 360);
  h.touch('Move', 13, 840, 360);
  h.step(64);
  const remaining = h.app.getSnapshot().game.player.weapons.pistol.clip;
  assert.ok(remaining < 12, 'right-side touch aims and fires');
  h.touch('Cancel', 13, 840, 360);
  for (let timestamp = 80; timestamp <= 400; timestamp += 16) h.step(timestamp);
  assert.equal(h.app.getSnapshot().game.player.weapons.pistol.clip, remaining, 'cancel stops sustained shooting');
});

test('WeChat hide/show pauses active combat and resumes without simulating elapsed background time', () => {
  const h = harness();
  h.startGame();
  h.touch('Start', 20, 100, 360);
  h.touch('Move', 20, 140, 360);
  h.step(32);
  const before = h.app.getSnapshot().game;
  h.events.Hide();
  assert.equal(h.app.getSnapshot().paused, true);
  h.events.Show();
  h.step(100000);
  assert.equal(h.app.getSnapshot().game.time, before.time);
  h.app.handleKey('down', 'Escape');
  h.step(100016);
  h.step(100032);
  const after = h.app.getSnapshot().game;
  assert.ok(after.time - before.time < 0.1);
  assert.equal(after.player.x, before.player.x, 'hidden touch input is cleared');
});

test('WeChat legacy sizing, resizing and unavailable storage stay playable', () => {
  const h = harness({ legacySizing: true, storageFailure: true });
  assert.equal(h.config.width, 844);
  assert.equal(h.app.getSnapshot().best.score, 0);
  assert.equal(h.config.storage.getItem('missing'), null);
  assert.doesNotThrow(() => h.config.storage.setItem('score', '20'));
  h.startGame();
  Object.assign(h.size, { windowWidth: 1280, windowHeight: 720, pixelRatio: 1 });
  h.events.WindowResize();
  assert.equal(h.canvas.width, 1280);
  assert.equal(h.canvas.height, 720);
  h.step(32);
  assert.equal(h.app.getSnapshot().screen, 'game');
});
