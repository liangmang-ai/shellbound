import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { CoopGame } from '../src/coop-game.js';

function harness() {
  const context = new Proxy({
    measureText: value => ({ width: String(value).length * 8 }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const inputs = [];
  let callbacks;
  const app = createApp({ canvas: { getContext: () => context }, width: 844, height: 390,
    multiplayerFactory: options => {
      callbacks = options;
      return { create() {}, input: input => inputs.push(input), action() {}, close() {},
        getMetrics: () => ({ rttMs: 80, snapshotIntervalMs: 50, snapshotBytes: 4096, snapshotCount: 2 }) };
    } });
  let timestamp = 0;
  const frame = (ms = 1000 / 60) => { timestamp += ms; app.frame(timestamp); };
  const point = (x, y) => {
    const { scale, ox, oy } = app.getSnapshot().layout;
    return { x: ox + x * scale, y: oy + y * scale, button: 0 };
  };
  const tap = label => {
    frame();
    const button = app.getSnapshot().buttons.find(item => item.label === label);
    assert.ok(button, `${label} is available`);
    const position = point(button.x + button.w / 2, button.y + button.h / 2);
    app.handlePointer('down', position); app.handlePointer('up', position);
  };
  app.frame(0); tap('双人合作'); tap('创建房间');
  const authority = new CoopGame({ mapId: 'greenhouse', difficultyId: 'easy' });
  const view = time => { const snapshot = authority.snapshot('p1'); snapshot.time = time; return snapshot; };
  callbacks.onRoom({ playerId: 'p1', phase: 'playing', paused: false });
  callbacks.onSnapshot(view(0), 1); frame();
  return { app, authority, callbacks, inputs, frame, point, view };
}

test('the combat camera and pointer coordinates follow the displayed pose while inputs keep authority', () => {
  const h = harness();
  const initial = h.app.getSnapshot();
  h.authority.players.p1.x += 18;
  h.callbacks.onSnapshot(h.view(.05), 2);
  const before = h.app.getSnapshot();
  assert.equal(before.game.player.x, initial.game.player.x + 18, 'HP and positions in diagnostics remain authoritative');
  assert.ok(before.renderPlayer.x < before.game.player.x, 'presentation has a separate pose');
  const area = before.arena;
  const expectedCameraX = Math.max(0, Math.min(h.authority.map.width - area.w / area.scale,
    before.renderPlayer.x - area.w / area.scale / 2));
  assert.equal(area.camera.x, expectedCameraX, 'camera tracks presentation instead of jumping to the latest snapshot');
  const pointer = { x: area.w * .62, y: area.h * .45 };
  h.app.handlePointer('move', h.point(pointer.x, pointer.y));
  h.frame(40);
  const sent = h.inputs.at(-1);
  assert.equal(sent.aimX, area.camera.x + pointer.x / area.scale);
  assert.equal(sent.aimY, area.camera.y + pointer.y / area.scale);
  assert.equal(h.app.getSnapshot().game.player.x, before.game.player.x, 'presentation never advances the authoritative player');
});

test('read-only diagnostics distinguish frame cadence from network snapshot cadence', () => {
  const h = harness();
  for (let n = 0; n < 70; n++) h.frame();
  const metrics = h.app.getSnapshot().performance;
  assert.ok(metrics.fps > 59 && metrics.fps < 61);
  assert.ok(metrics.frameMs > 16 && metrics.frameMs < 17);
  assert.deepEqual(metrics.network, { rttMs: 80, snapshotIntervalMs: 50, snapshotBytes: 4096, snapshotCount: 2 });
});
