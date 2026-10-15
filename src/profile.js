// Display metadata is optional and never serves as a login credential. Keep
// OpenID/session information out of both room messages and leaderboard records.
export function cleanProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.authorized === false || typeof value.nickName !== 'string') return null;
  const nickName = [...value.nickName.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim()].slice(0, 24).join('');
  if (!nickName) return null;
  const candidate = typeof value.avatarUrl === 'string' ? value.avatarUrl : '';
  // Do not accept credentials, arbitrary image hosts, HTTP, ports or backslash
  // URL variants. This works in the DOM-free mini-game without a URL parser.
  const avatarUrl = candidate.length <= 512 && /^https:\/\/(?:[a-z0-9-]+\.)*qlogo\.cn\/[^\s\\]*$/i.test(candidate)
    ? candidate : '';
  return { nickName, avatarUrl };
}
