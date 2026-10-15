import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanProfile } from '../src/profile.js';

test('optional display profiles keep only bounded nicknames and approved image URLs', () => {
  const original = { nickName: '\u202e 蛋友\n🥚 \u200b', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/avatar/132', openId: 'never-send', sessionKey: 'never-send' };
  assert.deepEqual(cleanProfile(original), { nickName: '蛋友🥚', avatarUrl: original.avatarUrl });
  assert.equal([...cleanProfile({ nickName: '🥚'.repeat(100) }).nickName].length, 24);
  assert.equal(original.openId, 'never-send', 'sanitizing does not change caller data');
  for (const value of [null, [], 'name', {}, { nickName: 4 }, { nickName: ' \n\u202e ' }, { nickName: '未同意展示', authorized: false }]) assert.equal(cleanProfile(value), null);
});

test('display avatars cannot point to arbitrary, local or credential-bearing URLs', () => {
  for (const avatarUrl of ['http://thirdwx.qlogo.cn/a', 'https://qlogo.cn.attacker.test/a', 'https://attacker@qlogo.cn/a',
    'https://qlogo.cn:443/a', 'https://localhost/a', 'https://127.0.0.1/a', 'file:///tmp/a', 'data:image/png;base64,AAAA',
    'https://qlogo.cn\\@attacker.test/a', 'https://qlogo.cn/a\nnext', 'https://qlogo.cn/' + 'a'.repeat(512)]) {
    assert.deepEqual(cleanProfile({ nickName: '蛋友', avatarUrl }), { nickName: '蛋友', avatarUrl: '' });
  }
  for (const avatarUrl of ['https://wx.qlogo.cn/mmopen/a/132', 'https://qlogo.cn/a', 'https://thirdwx.qlogo.cn/mmopen/a?x=1']) {
    assert.equal(cleanProfile({ nickName: '蛋友', avatarUrl }).avatarUrl, avatarUrl);
  }
});
