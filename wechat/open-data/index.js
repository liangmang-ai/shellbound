import { compareResults, GUEST_PROFILE, leaderboardKey, makeRecord, parseRecord, SOCIAL_CHANNEL } from '../../src/social-data.js';

// This entire module runs inside the isolated WeChat open-data domain. Neither
// friend data nor an OpenID is posted back to the main game or its game server.
export function createOpenDataController(wxApi, { canvas = wxApi.getSharedCanvas(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const ctx = canvas.getContext('2d'), pending = new Map(), images = new Map();
  let visible = false, mode = 'solo', difficultyId = 'easy', rows = [], own = null;
  let notice = '', saveNotice = '', generation = 0, writing = false, retryTimer = null, retryCount = 0, pageIndex = 0;

  function call(name, options) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (handler, value) => { if (settled) return; settled = true; clearTimer(timer); handler(value); };
      const timer = setTimer(() => done(reject, new Error('接口超时')), 8000);
      try {
        if (typeof wxApi[name] !== 'function') throw new Error('当前微信版本不支持');
        wxApi[name]({ ...options, success: value => done(resolve, value), fail: error => done(reject, error) });
      } catch (error) { done(reject, error); }
    });
  }

  function readFrom(response, key, boardMode) {
    if (!Array.isArray(response?.KVDataList)) throw new Error('成绩读取失败');
    const entry = response.KVDataList.find(item => item.key === key);
    if (!entry) return null;
    const record = parseRecord(entry.value, boardMode);
    if (!record) throw new Error('已有成绩异常，暂不覆盖');
    return record;
  }

  function avatar(profile, x, y, size) {
    const url = profile?.avatarUrl;
    let cached = url && images.get(url);
    if (url && !cached && typeof wxApi.createImage === 'function') {
      while (images.size >= 32) images.delete(images.keys().next().value);
      try {
        const image = wxApi.createImage();
        cached = { image, ready: false }; images.set(url, cached);
        image.onload = () => { cached.ready = true; render(); };
        image.onerror = () => { cached.ready = false; render(); };
        image.src = url;
      } catch { /* The egg below remains usable. */ }
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
    if (cached?.ready) { try { ctx.drawImage(cached.image, x, y, size, size); ctx.restore(); return; } catch { /* Broken native image. */ } }
    ctx.fillStyle = '#dfefdf'; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#fff9e8'; ctx.beginPath(); ctx.ellipse(x + size / 2, y + size * 0.53, size * 0.29, size * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#29534b'; ctx.beginPath(); ctx.arc(x + size * 0.43, y + size * 0.52, Math.max(1, size / 28), 0, Math.PI * 2); ctx.arc(x + size * 0.59, y + size * 0.52, Math.max(1, size / 28), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function shorten(text, width) {
    let value = text || GUEST_PROFILE.nickName;
    if (ctx.measureText(value).width <= width) return value;
    const points = Array.from(value);
    while (points.length && ctx.measureText(`${points.join('')}…`).width > width) points.pop();
    return `${points.join('')}…`;
  }

  function render() {
    if (!visible) return;
    const w = canvas.width / 2, h = canvas.height / 2;
    ctx.save(); ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2f8f0'; ctx.fillRect(0, 0, w, h);
    const font = Math.max(16, Math.min(18, w / 28)), pad = Math.max(10, w * 0.025);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = '#41685d'; ctx.font = `${font}px sans-serif`;
    if (notice) { ctx.fillText(notice, w / 2, h / 2, w - pad * 2); ctx.restore(); return; }
    if (!rows.length) {
      ctx.fillText('好友暂未上榜，完成一局留下成绩吧', w / 2, h / 2 - 12, w - pad * 2);
      ctx.font = `${font}px sans-serif`; ctx.fillText(shorten('游客可玩 · 授权后展示头像昵称', w - pad * 2), w / 2, h / 2 + 16);
    }
    const rowHeight = mode === 'coop' ? 70 : 52;
    const capacity = Math.max(1, Math.floor((h - 48) / rowHeight));
    const pages = Math.max(1, Math.ceil(rows.length / capacity));
    pageIndex = Math.max(0, Math.min(pages - 1, pageIndex));
    const offset = pageIndex * capacity, shown = rows.slice(offset, offset + capacity);
    for (let index = 0; index < shown.length; index++) {
      const row = shown[index], y = 8 + index * rowHeight;
      ctx.fillStyle = index % 2 ? '#e7f1e8' : '#ffffff'; ctx.fillRect(pad, y, w - pad * 2, rowHeight - 5);
      ctx.textAlign = 'left'; ctx.fillStyle = offset + index < 3 ? '#b97525' : '#527b6b'; ctx.font = `bold ${font}px sans-serif`;
      ctx.fillText(String(offset + index + 1), pad + 10, y + (rowHeight - 5) / 2);
      const people = mode === 'coop' ? row.players : [row.players[0]];
      const size = mode === 'coop' ? 25 : 33, startX = pad + 36;
      ctx.font = `${font}px sans-serif`;
      people.forEach((person, i) => {
        const personY = mode === 'coop' ? y + 5 + i * 29 : y + 7;
        avatar(person, startX, personY, size);
        ctx.fillStyle = '#244c40'; ctx.textAlign = 'left';
        ctx.fillText(shorten(person.nickName, Math.max(20, w - pad * 2 - 180)), startX + size + 8, personY + size / 2);
      });
      ctx.textAlign = 'right'; ctx.fillStyle = '#1b5d4d'; ctx.font = `bold ${font}px sans-serif`;
      ctx.fillText(`${row.score} 分`, w - pad - 12, y + rowHeight * 0.34);
      ctx.fillStyle = '#6c8170'; ctx.font = `${font}px sans-serif`;
      ctx.fillText(`第 ${row.wave} 波`, w - pad - 12, y + rowHeight * 0.7);
    }
    ctx.textAlign = 'center'; ctx.font = `${font}px sans-serif`; ctx.fillStyle = '#6c8170';
    const ownRank = own ? rows.findIndex(row => sameResult(row, own)) + 1 : 0;
    const footer = saveNotice || (own ? `我的最高 ${own.score} 分 · 第 ${own.wave} 波${ownRank ? ` · 第 ${ownRank} 名` : ''}` : '分数优先 · 同分比较最高波次');
    ctx.fillText(shorten(footer, w - pad * 2), w / 2, h - 29);
    ctx.fillText(`第 ${pageIndex + 1} / ${pages} 页 · 微信同玩好友`, w / 2, h - 10, w - pad * 2);
    ctx.restore();
  }

  function sameResult(a, b) {
    return a.id && b.id ? a.id === b.id
      : JSON.stringify(a) === JSON.stringify(b);
  }

  async function load() {
    const current = ++generation, boardMode = mode, key = leaderboardKey(mode, difficultyId);
    if (!key) return;
    notice = '正在读取微信同玩好友…'; render();
    try {
      const [friends, self] = await Promise.all([
        call('getFriendCloudStorage', { keyList: [key] }), call('getUserCloudStorage', { keyList: [key] }),
      ]);
      if (current !== generation || !visible) return;
      if (!Array.isArray(friends?.data)) throw new Error('好友榜数据读取失败');
      const next = [];
      for (const friend of friends.data) {
        const entry = Array.isArray(friend.KVDataList) && friend.KVDataList.find(item => item.key === key);
        const record = entry && parseRecord(entry.value, boardMode);
        // Use ONLY the consented profile saved with the result. The platform's
        // raw friend avatar/nickname/OpenID never enters our record or main domain.
        if (record) {
          const existing = boardMode === 'coop' ? next.findIndex(row => sameResult(row, record)) : -1;
          if (existing === -1) next.push(record);
          else if (compareResults(record, next[existing]) < 0) next[existing] = record;
        }
      }
      own = readFrom(self, key, boardMode);
      if (own) {
        const existing = next.findIndex(row => sameResult(row, own));
        if (existing === -1) next.push(own);
        else if (compareResults(own, next[existing]) < 0) next[existing] = own;
      }
      rows = next.sort(compareResults); notice = ''; render();
    } catch {
      if (current === generation && visible) { notice = '好友榜读取失败，请关闭后重试（可继续游玩）'; render(); }
    }
  }

  async function flush() {
    if (writing || !pending.size) return;
    writing = true;
    try {
      for (const [key, entry] of pending) {
        // Never overwrite on a failed read: the cloud may hold a higher result
        // from a previous device or launch. All six boards share this queue.
        const previous = readFrom(await call('getUserCloudStorage', { keyList: [key] }), key, entry.mode);
        if (!previous || compareResults(entry.record, previous) < 0) {
          await call('setUserCloudStorage', { KVDataList: [{ key, value: entry.value }] });
        }
        const current = pending.get(key);
        if (current && compareResults(current.record, entry.record) >= 0) pending.delete(key);
      }
      retryCount = 0; saveNotice = ''; writing = false;
      if (pending.size) void flush();
      else if (visible && !notice) void load();
    } catch {
      writing = false; saveNotice = '成绩同步失败，保留云端旧纪录；打开好友榜会重试'; render();
      if (retryCount++ < 2 && retryTimer === null) retryTimer = setTimer(() => { retryTimer = null; void flush(); }, 1500 * retryCount);
    }
  }

  function receive(message) {
    if (message?.channel !== SOCIAL_CHANNEL) return;
    if (message.type === 'save') {
      const raw = parseRecord(message.record, message.mode);
      if (!raw) return;
      const entry = makeRecord({ mode: message.mode, difficultyId: message.difficultyId, score: raw.score, wave: raw.wave,
        partnerProfile: raw.players[1], resultId: raw.id }, raw.players[0]);
      if (!entry) return;
      const old = pending.get(entry.key);
      if (!old || compareResults(entry.record, old.record) < 0) pending.set(entry.key, { ...entry, mode: message.mode });
      void flush();
    } else if (message.type === 'prepare' || message.type === 'open') {
      if (!leaderboardKey(message.mode, message.difficultyId)) return;
      generation++;
      visible = true; mode = message.mode; difficultyId = message.difficultyId; rows = []; own = null; pageIndex = 0;
      notice = '正在连接微信好友榜…'; render();
      if (message.type === 'open') { retryCount = 0; void flush(); void load(); }
    } else if (message.type === 'notice') {
      visible = true; generation++; notice = typeof message.message === 'string' ? message.message.slice(0, 64) : '好友榜暂不可用'; render();
    } else if (message.type === 'resize') {
      render();
    } else if (message.type === 'page' && visible && (message.delta === -1 || message.delta === 1)) {
      pageIndex += message.delta; render();
    } else if (message.type === 'close') {
      visible = false; generation++; ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  wxApi.onMessage(receive);
  return { receive, render, flush };
}

if (typeof wx !== 'undefined' && typeof wx.getSharedCanvas === 'function') createOpenDataController(wx);
