import { createApp } from './app.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('game');
const storage = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch { /* Private mode is playable. */ } },
};
const size = () => {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height, pixelRatio: Math.min(devicePixelRatio || 1, 2) };
};
const audio = createAudio();
const app = createApp({ canvas, ...size(), storage, platform: 'web', audio });
const point = (event) => {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, button: event.button };
};
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch') {
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    app.handlePointer('down', point(event));
  }
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'touch') app.handlePointer('move', point(event));
});
canvas.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'touch') app.handlePointer('up', point(event));
});
canvas.addEventListener('pointercancel', () => app.handlePointer('cancel', { x: 0, y: 0, button: 0 }));
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
for (const type of ['start', 'move', 'end', 'cancel']) {
  canvas.addEventListener(`touch${type}`, (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touches = Array.from(event.changedTouches, (touch) => ({ id: touch.identifier, x: touch.clientX - rect.left, y: touch.clientY - rect.top }));
    app.handleTouch(type, touches);
  }, { passive: false });
}
for (const type of ['down', 'up']) {
  window.addEventListener(`key${type}`, (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(event.key)) event.preventDefault();
    if (!event.repeat || type === 'up') app.handleKey(type, event.key);
  });
}
window.addEventListener('resize', () => app.resize(size()));
window.addEventListener('blur', () => app.pause());
document.addEventListener('visibilitychange', () => { if (document.hidden) app.pause(); });
window.addEventListener('pagehide', () => { app.pause(); audio.pause(); });
function frame(timestamp) { app.frame(timestamp); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
// Read-only diagnostics for local QA and embedding; gameplay stays in the app.
window.__shellbound = { getSnapshot: app.getSnapshot };
