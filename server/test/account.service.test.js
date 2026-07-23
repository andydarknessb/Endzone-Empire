const test = require('node:test');
const assert = require('node:assert/strict');
const { hashToken, resetPassword } = require('../services/account.service');

test('hashToken is a stable 64-char hex SHA-256', () => {
  const a = hashToken('some-token');
  assert.equal(a, hashToken('some-token'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('hashToken output differs per input and never echoes the raw token', () => {
  const token = 'super-secret-raw-token';
  const hash = hashToken(token);
  assert.notEqual(hash, hashToken('other-token'));
  assert.equal(hash.includes(token), false);
});

test('password reset rejects passwords outside the supported length boundary', async () => {
  await assert.rejects(
    resetPassword({ token: 'fixture', newPassword: 'short' }),
    /between 8 and 128/
  );
  await assert.rejects(
    resetPassword({ token: 'fixture', newPassword: 'x'.repeat(129) }),
    /between 8 and 128/
  );
});
