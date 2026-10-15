import { cleanProfile } from './profile.js';
import { compareResults, GUEST_PROFILE, leaderboardKey, makeRecord, SOCIAL_CHANNEL } from './social-data.js';

function rect(value) {
  const bounds = { left: value?.left ?? value?.x, top: value?.top ?? value?.y,
    width: value?.width ?? value?.w, height: value?.height ?? value?.h };
  return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

export function createSocial({ platform = 'web', wxApi = globalThis.wx, imageFactory } = {}) {
  const native = platform === 'wechat' && !!wxApi;
  let profile = { ...GUEST_PROFILE, authorized: false };
  let profileButton = null, buttonBounds = '', profileCallback = null, buttonVisible = false;
  let profileRequestGeneration = 0;
  let openData = null, leaderboard = null, leaderboardGeneration = 0;
  let privacyGranted = native && typeof wxApi.getPrivacySetting !== 'function';
  const subscribers = new Set(), avatars = new Map(), submitted = new Map(), waitingResults = new Map();

  function flushWaitingResults() {
    if (!privacyGranted) return;
    for (const [key, entry] of waitingResults) {
      if (post({ type: 'save', mode: entry.mode, difficultyId: entry.difficultyId, record: entry.payload.record })) {
        submitted.set(entry.token, entry.payload.record); waitingResults.delete(key);
      }
    }
    while (submitted.size > 64) submitted.delete(submitted.keys().next().value);
  }

  if (native && typeof wxApi.getPrivacySetting === 'function') {
    try { wxApi.getPrivacySetting({ success(result) {
      if (result?.needAuthorization === false) { privacyGranted = true; flushWaitingResults(); }
    }, fail() {} }); } catch { /* Scores remain pending without confirmed consent. */ }
  }

  function changeProfile(value) {
    const valid = cleanProfile(value);
    if (!valid) return false;
    profile = { ...valid, authorized: true };
    for (const entry of waitingResults.values()) {
      const record = entry.payload.record;
      entry.payload = makeRecord({ mode: entry.mode, difficultyId: entry.difficultyId, score: record.score, wave: record.wave,
        partnerProfile: record.players[1], resultId: record.id }, profile) || entry.payload;
    }
    privacyGranted = true; flushWaitingResults();
    for (const callback of subscribers) { try { callback({ ...profile }); } catch { /* A view cannot block authorization. */ } }
    return true;
  }

  // Restore only a permission which the platform says is already granted.
  // A denied / missing privacy grant never causes an automatic privacy prompt.
  if (native && typeof wxApi.getSetting === 'function' && typeof wxApi.getUserInfo === 'function') {
    try {
      wxApi.getSetting({ success(result) {
        if (result?.authSetting?.['scope.userInfo'] !== true || profile.authorized) return;
        const read = () => {
          if (profile.authorized) return;
          try { wxApi.getUserInfo({ withCredentials: false, lang: 'zh_CN',
            success: result => { if (!profile.authorized) changeProfile(result?.userInfo); }, fail() {} }); } catch { /* Guest fallback. */ }
        };
        if (typeof wxApi.getPrivacySetting === 'function') {
          try { wxApi.getPrivacySetting({ success: result => { if (result?.needAuthorization === false) read(); }, fail() {} }); } catch { /* No implicit authorization. */ }
        } else read();
      }, fail() {} });
    } catch { /* Native account APIs are optional for playing. */ }
  }

  function getOpenData() {
    if (!native || typeof wxApi.getOpenDataContext !== 'function') return null;
    try { openData ||= wxApi.getOpenDataContext(); return openData; } catch { return null; }
  }

  function post(message) {
    try {
      const context = getOpenData();
      if (typeof context?.postMessage !== 'function') return false;
      context.postMessage({ channel: SOCIAL_CHANNEL, ...message });
      return true;
    } catch { return false; }
  }

  function hideProfileButton() {
    profileRequestGeneration++;
    buttonVisible = false;
    try { profileButton?.hide(); } catch { /* Already gone. */ }
  }

  function showProfileButton(bounds, callback) {
    profileCallback = typeof callback === 'function' ? callback : null;
    const area = rect(bounds);
    if (!area) { hideProfileButton(); return false; }
    if (!native || typeof wxApi.createUserInfoButton !== 'function') return false;
    // Creating the native control is itself a privacy API. Render passes must
    // wait for consent, rather than bringing up a dialog when a menu is drawn.
    if (!privacyGranted) return false;
    const signature = JSON.stringify(area);
    if (profileButton && buttonBounds === signature) {
      if (!buttonVisible) { try { profileButton.show(); } catch { return false; } }
      buttonVisible = true;
      return true;
    }
    try { profileButton?.destroy(); } catch { /* Size changed. */ }
    profileButton = null;
    try {
      const button = wxApi.createUserInfoButton({ type: 'text', text: '授权微信头像昵称',
        withCredentials: false, lang: 'zh_CN',
        style: { ...area, lineHeight: area.height, backgroundColor: '#1f7968', color: '#ffffff',
          textAlign: 'center', fontSize: Math.max(12, Math.min(18, area.height * 0.43)), borderRadius: 10 } });
      button.onTap(result => {
        if (profileButton !== button || !buttonVisible) return;
        const ok = (!result?.errMsg || result.errMsg.includes(':ok')) && changeProfile(result?.userInfo);
        if (ok) hideProfileButton();
        else flushWaitingResults();
        try { profileCallback?.({ ...profile }, ok ? null : '未授权，仍可用游客身份游玩'); } catch { /* UI callbacks are isolated. */ }
      });
      profileButton = button; buttonBounds = signature; buttonVisible = true;
      button.show?.();
      return true;
    } catch { profileButton = null; return false; }
  }

  function requestProfileAuthorization(bounds, callback) {
    if (!native || !rect(bounds)) return false;
    const generation = ++profileRequestGeneration;
    const ready = () => {
      if (generation !== profileRequestGeneration) return;
      // Wait for the profile choice before flushing guest results so accepting
      // the visible native button can attach the newly consented display name.
      privacyGranted = true; showProfileButton(bounds, callback);
    };
    if (privacyGranted || typeof wxApi.requirePrivacyAuthorize !== 'function') { ready(); return true; }
    try {
      wxApi.requirePrivacyAuthorize({ success: ready, fail() {
        if (generation === profileRequestGeneration && typeof callback === 'function') {
          callback({ ...profile }, '未授权，仍可用游客身份游玩');
        }
      } });
      return true;
    } catch { return false; }
  }

  function getAvatar(url) {
    const safeUrl = cleanProfile({ nickName: '头像', avatarUrl: url })?.avatarUrl;
    if (!safeUrl) return null;
    const cached = avatars.get(safeUrl);
    if (cached) return cached.loaded ? cached.image : null;
    while (avatars.size >= 32) avatars.delete(avatars.keys().next().value);
    try {
      const image = imageFactory ? imageFactory() : native && typeof wxApi.createImage === 'function'
        ? wxApi.createImage() : typeof globalThis.Image === 'function' ? new globalThis.Image() : null;
      if (!image) return null;
      const entry = { image, loaded: false };
      avatars.set(safeUrl, entry);
      image.onload = () => { entry.loaded = true; };
      image.onerror = () => { entry.loaded = false; };
      image.src = safeUrl;
      return entry.loaded ? image : null;
    } catch { return null; }
  }

  function resizeLeaderboard(bounds) {
    const area = rect(bounds);
    const context = getOpenData();
    if (!context) return false;
    try {
      if (!context.canvas) return false;
      if (!area) return true;
      const width = Math.max(1, Math.min(2048, Math.round(area.width * 2)));
      const height = Math.max(1, Math.min(2048, Math.round(area.height * 2)));
      if (context.canvas.width !== width || context.canvas.height !== height) {
        // Canvas dimensions can only be changed from the main domain.
        context.canvas.width = width; context.canvas.height = height;
        post({ type: 'resize' });
      }
      return true;
    } catch { return false; }
  }

  function openLeaderboard({ mode = 'solo', difficultyId = 'easy', bounds } = {}) {
    const key = leaderboardKey(mode, difficultyId);
    if (!key) return false;
    // A renderer can supply updated CSS bounds after the click established the
    // consent request. Resizing never starts another permission flow.
    if (leaderboard?.mode === mode && leaderboard.difficultyId === difficultyId) return resizeLeaderboard(bounds);
    const generation = ++leaderboardGeneration;
    leaderboard = { mode, difficultyId, message: native ? '正在连接微信好友榜…' : '微信好友榜请在微信小游戏内查看' };
    hideProfileButton();
    if (!resizeLeaderboard(bounds || { x: 0, y: 0, width: 680, height: 360 })) {
      if (native) leaderboard.message = '当前微信版本暂不支持好友榜'; return false;
    }
    const active = () => leaderboard && generation === leaderboardGeneration;
    post({ type: 'prepare', mode, difficultyId });
    const denied = () => { if (active()) { leaderboard.message = '未开启好友互动权限，仍可继续游玩'; post({ type: 'notice', message: leaderboard.message }); } };
    const load = () => { if (active()) { leaderboard.message = ''; if (!post({ type: 'open', mode, difficultyId })) leaderboard.message = '好友榜暂不可用，请稍后再试'; } };
    const authorizeFriends = () => {
      if (!active()) return;
      privacyGranted = true; flushWaitingResults();
      if (typeof wxApi.authorize !== 'function') { load(); return; }
      try { wxApi.authorize({ scope: 'scope.WxFriendInteraction', success: load, fail: denied }); } catch { denied(); }
    };
    // This is called only from the explicit “好友榜” control. The platform owns
    // the privacy dialog; no custom acceptance or automatic launch prompt.
    if (typeof wxApi.requirePrivacyAuthorize === 'function') {
      try { wxApi.requirePrivacyAuthorize({ success: authorizeFriends, fail: denied }); } catch { denied(); }
    } else authorizeFriends();
    return true;
  }

  function closeLeaderboard() {
    leaderboard = null; leaderboardGeneration++;
    post({ type: 'close' });
  }

  function changeLeaderboardPage(delta) {
    return !!leaderboard && (delta === -1 || delta === 1) && post({ type: 'page', delta });
  }

  function drawLeaderboard(ctx, bounds) {
    const area = rect(bounds);
    if (!leaderboard || !ctx || !area) return false;
    try {
      ctx.save();
      if (leaderboard.message) {
        ctx.fillStyle = '#c8e9d2'; ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(leaderboard.message, area.left + area.width / 2, area.top + area.height / 2);
      } else if (openData?.canvas) ctx.drawImage(openData.canvas, area.left, area.top, area.width, area.height);
      ctx.restore();
      return true;
    } catch { try { ctx.restore(); } catch { /* A missing canvas keeps the modal usable. */ } return false; }
  }

  async function saveResult(result) {
    const payload = makeRecord(result, profile.authorized ? profile : null);
    if (!payload) return { status: 'invalid' };
    if (!native) return { status: 'unsupported' };
    const resultId = typeof result.resultId === 'string' ? result.resultId : '';
    const token = `${payload.key}:${resultId || payload.value}`;
    const previous = submitted.get(token);
    if (previous && compareResults(previous, payload.record) <= 0) return { status: 'duplicate' };
    // getUserCloudStorage is deliberately NOT called in this domain. The open
    // domain serializes read/compare/write and renders failures in its canvas.
    const waiting = waitingResults.get(payload.key);
    if (!waiting || compareResults(payload.record, waiting.payload.record) < 0) {
      waitingResults.set(payload.key, { payload, token, mode: result.mode, difficultyId: result.difficultyId });
    }
    // Cloud storage is itself a privacy API. Keep the best of each of the six
    // boards in memory until consent, without prompting at a solo game-over.
    if (!privacyGranted) return { status: 'pending-consent' };
    flushWaitingResults();
    return { status: submitted.has(token) ? 'queued' : 'unavailable' };
  }

  return { getProfile: () => ({ ...profile }),
    onProfileChange(callback) { if (typeof callback !== 'function') return () => {}; subscribers.add(callback); return () => subscribers.delete(callback); },
    showProfileButton, requestProfileAuthorization, hideProfileButton, getAvatar, openLeaderboard, closeLeaderboard, changeLeaderboardPage, drawLeaderboard, saveResult };
}
