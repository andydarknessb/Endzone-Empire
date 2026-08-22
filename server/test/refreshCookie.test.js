const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COOKIE_NAME,
  clearRefreshCookie,
  getRefreshToken,
  parseCookieHeader,
  setRefreshCookie,
} = require('../modules/refreshCookie');

test('cookie parser handles encoded values and unrelated cookies', () => {
  assert.deepEqual(parseCookieHeader('theme=dark; endzone_refresh=abc%20123'), {
    theme: 'dark',
    endzone_refresh: 'abc 123',
  });
});

test('refresh token is read only from the cookie header', () => {
  const req = { get: (name) => name === 'cookie' ? `${COOKIE_NAME}=secret` : undefined };
  assert.equal(getRefreshToken(req), 'secret');
});

test('refresh cookie is HttpOnly and scoped to authentication routes', () => {
  const calls = [];
  const res = {
    cookie: (...args) => calls.push(['set', ...args]),
    clearCookie: (...args) => calls.push(['clear', ...args]),
  };
  setRefreshCookie(res, 'secret');
  clearRefreshCookie(res);
  assert.equal(calls[0][3].httpOnly, true);
  assert.equal(calls[0][3].sameSite, 'lax');
  assert.equal(calls[0][3].path, '/api/auth');
  assert.equal(calls[1][2].path, '/api/auth');
});
