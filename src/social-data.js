import { cleanProfile } from './profile.js';

export const GUEST_PROFILE = Object.freeze({ nickName: '游客', avatarUrl: '' });
export const SOCIAL_CHANNEL = 'shellbound-social-v1';
const MODES = ['solo', 'coop'];
const DIFFICULTIES = ['easy', 'normal', 'hard'];

export function leaderboardKey(mode, difficultyId) {
  return MODES.includes(mode) && DIFFICULTIES.includes(difficultyId)
    ? `shellbound.v1.${mode}.${difficultyId}` : null;
}

export function isResult(value) {
  return value && Number.isSafeInteger(value.score) && value.score >= 0
    && Number.isSafeInteger(value.wave) && value.wave >= 1;
}

export function compareResults(a, b) {
  return b.score - a.score || b.wave - a.wave;
}

// Keep the byte budget independent of DOM / TextEncoder in both WeChat domains.
export function utf8Bytes(value) {
  let count = 0;
  for (const char of String(value)) {
    const code = char.codePointAt(0);
    count += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return count;
}

export function publicProfile(value) {
  return value?.authorized === false ? { ...GUEST_PROFILE } : cleanProfile(value) || { ...GUEST_PROFILE };
}

export function makeRecord(value, selfProfile) {
  const key = leaderboardKey(value?.mode, value?.difficultyId);
  if (!key || !isResult(value)) return null;
  const players = [publicProfile(selfProfile)];
  if (value.mode === 'coop') players.push(publicProfile(value.partnerProfile));
  const record = { v: 1, score: value.score, wave: value.wave, players };
  // Only retain a short opaque run marker, never a login credential or OpenID.
  if (typeof value.resultId === 'string') record.id = value.resultId.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 64);
  let encoded = JSON.stringify(record);
  // Two maximum-length URLs can exceed WeChat's key+value 1024-byte budget.
  // Omit avatars together rather than truncating JSON or losing a teammate name.
  if (utf8Bytes(key) + utf8Bytes(encoded) > 1024) {
    for (const player of record.players) player.avatarUrl = '';
    encoded = JSON.stringify(record);
  }
  return utf8Bytes(key) + utf8Bytes(encoded) <= 1024 ? { key, record, value: encoded } : null;
}

export function parseRecord(value, mode) {
  try {
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    if (record?.v !== 1 || !isResult(record) || !Array.isArray(record.players)) return null;
    return {
      v: 1, score: record.score, wave: record.wave,
      players: Array.from({ length: mode === 'coop' ? 2 : 1 }, (_, i) => publicProfile(record.players[i])),
      id: typeof record.id === 'string' ? record.id.slice(0, 64) : '',
    };
  } catch { return null; }
}
