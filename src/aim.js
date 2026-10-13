import { segmentRect, WEAPONS } from './game.js';

// A narrow forward cone keeps movement in charge. The stored facing must not
// come from the assisted gun angle, or the cone would drift after each frame.
export function findAimTarget(game, facing, viewport, previousId = null) {
  const p = game.player, weapon = WEAPONS[p.currentWeapon];
  const range = Math.min(520, weapon.range || weapon.bulletSpeed * .9);
  const candidates = [];
  for (const enemy of game.enemies) {
    if (enemy.hp <= 0 || enemy.x < viewport.x || enemy.x > viewport.x + viewport.w || enemy.y < viewport.y || enemy.y > viewport.y + viewport.h) continue;
    const dx = enemy.x - p.x, dy = enemy.y - p.y, distance = Math.hypot(dx, dy);
    const offset = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - facing), Math.cos(Math.atan2(dy, dx) - facing)));
    if (distance > range || offset > Math.PI / 5 || distance < .5) continue;
    if (game.map.obstacles.some(rect => segmentRect(p.x, p.y, enemy.x, enemy.y, rect, 3) !== null)) continue;
    candidates.push({ enemy, score: offset * 220 + distance * .35 });
  }
  candidates.sort((a, b) => a.score - b.score || a.enemy.id - b.enemy.id);
  const best = candidates[0], previous = candidates.find(item => item.enemy.id === previousId);
  // Small changes in distance should not make the reticle jump between enemies.
  return previous && (!best || previous.score <= best.score + 35) ? previous.enemy : best?.enemy || null;
}
