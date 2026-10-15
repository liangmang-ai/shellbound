import { createApp } from '../src/app.js';
import { createAudio } from '../src/audio.js';

const canvas = wx.createCanvas();
const getSize = () => {
  const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return {
    width: info.windowWidth || info.screenWidth,
    height: info.windowHeight || info.screenHeight,
    pixelRatio: info.pixelRatio || 1,
  };
};
const storage = {
  getItem(key) {
    try {
      const value = wx.getStorageSync(`shellbound:${key}`);
      return value === '' || value === undefined ? null : String(value);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      wx.setStorageSync(`shellbound:${key}`, String(value));
    } catch {
      // Storage failure must not prevent a local game from running.
    }
  },
};
const audio = createAudio({ platform: 'wechat', wxApi: wx });
const app = createApp({ canvas, ...getSize(), storage, platform: 'wechat', audio, wxApi: wx });
const convertTouches = (event) => (event.changedTouches || event.touches || []).map((touch) => ({
  id: touch.identifier,
  x: touch.clientX ?? touch.pageX,
  y: touch.clientY ?? touch.pageY,
}));

wx.onTouchStart((event) => app.handleTouch('start', convertTouches(event)));
wx.onTouchMove((event) => app.handleTouch('move', convertTouches(event)));
wx.onTouchEnd((event) => app.handleTouch('end', convertTouches(event)));
wx.onTouchCancel((event) => app.handleTouch('cancel', convertTouches(event)));
if (typeof wx.onWindowResize === 'function') {
  wx.onWindowResize(() => app.resize(getSize()));
}

const requestFrame = typeof canvas.requestAnimationFrame === 'function'
  ? canvas.requestAnimationFrame.bind(canvas)
  : typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(() => callback(Date.now()), 16);
const cancelFrame = typeof canvas.cancelAnimationFrame === 'function'
  ? canvas.cancelAnimationFrame.bind(canvas)
  : typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : clearTimeout;
let active = true;
let frameId = null;
const tick = (timestamp) => {
  frameId = null;
  if (!active) return;
  app.frame(timestamp);
  frameId = requestFrame(tick);
};
const start = () => {
  if (frameId === null) frameId = requestFrame(tick);
};

wx.onHide(() => {
  active = false;
  app.pause();
  if (frameId !== null) cancelFrame(frameId);
  frameId = null;
});
if (typeof wx.onAudioInterruptionBegin === 'function') wx.onAudioInterruptionBegin(() => app.pause(false));
wx.onShow(() => {
  active = true;
  app.resize(getSize());
  app.resume();
  start();
});
start();
