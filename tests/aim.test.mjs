import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game.js';
import { findAimTarget } from '../src/aim.js';

function fixture() {
  const game = new Game();
  game.map = { ...game.map, obstacles: [] };
  game.enemies = [];
  const add = (id, x, y, hp = 40) => {
    const enemy = { id, x, y, hp, radius: 17 };
    game.enemies.push(enemy); return enemy;
  };
  return { game, add, viewport: { x: 0, y: 0, w: 1280, h: 760 } };
}

test('assist selects a live forward target and rejects rear, distant, and offscreen enemies', () => {
  const h = fixture();
  h.add(1, 620, 380); h.add(2, 100, 380); h.add(3, 660, 430); h.add(4, 720, 380, 0);
  const expected = h.add(5, 820, 420);
  assert.equal(findAimTarget(h.game, 0, h.viewport), expected);
  assert.equal(findAimTarget(h.game, 0, { x: 0, y: 0, w: 700, h: 760 }), null);
  assert.equal(findAimTarget(h.game, Math.PI / 2, h.viewport)?.id, 3);
});

test('assist respects walls and shotgun range', () => {
  const h = fixture();
  h.add(1, 920, 380);
  h.game.map.obstacles = [{ x: 740, y: 350, w: 40, h: 60 }];
  assert.equal(findAimTarget(h.game, 0, h.viewport), null);
  h.game.map.obstacles = [];
  h.game.player.currentWeapon = 'shotgun';
  assert.equal(findAimTarget(h.game, 0, h.viewport)?.id, 1);
  h.game.enemies[0].x = 950;
  assert.equal(findAimTarget(h.game, 0, h.viewport), null);
});

test('target hysteresis prevents small distance changes from switching targets', () => {
  const h = fixture();
  h.add(1, 820, 390); const previous = h.add(2, 830, 392);
  assert.equal(findAimTarget(h.game, 0, h.viewport, 2), previous);
  previous.x = 1100;
  assert.equal(findAimTarget(h.game, 0, h.viewport, 2)?.id, 1);
  h.game.enemies[0].hp = 0;
  assert.equal(findAimTarget(h.game, 0, h.viewport, 1)?.id, 2);
});

test('forward cone uses wrapped angles across minus and plus pi', () => {
  const h = fixture(); const expected = h.add(1, 400, 370);
  assert.equal(findAimTarget(h.game, Math.PI - .03, h.viewport), expected);
  assert.equal(findAimTarget(h.game, -Math.PI + .03, h.viewport), expected);
});
