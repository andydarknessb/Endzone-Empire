const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLine, shouldLog } = require('../modules/requestLog');

test('shouldLog is true for /api paths', () => {
  assert.equal(shouldLog('/api/auth/login'), true);
  assert.equal(shouldLog('/api'), true);
});

test('shouldLog is false for static asset / non-api paths', () => {
  assert.equal(shouldLog('/index.html'), false);
  assert.equal(shouldLog('/static/js/main.js'), false);
  assert.equal(shouldLog('/'), false);
});

test('shouldLog handles non-string input defensively', () => {
  assert.equal(shouldLog(undefined), false);
  assert.equal(shouldLog(null), false);
});

test('formatLine produces valid JSON with the expected fields', () => {
  const line = formatLine({ method: 'GET', path: '/api/league', userId: 42 }, 200, 12);
  const parsed = JSON.parse(line);
  assert.equal(parsed.method, 'GET');
  assert.equal(parsed.path, '/api/league');
  assert.equal(parsed.status, 200);
  assert.equal(parsed.ms, 12);
  assert.equal(parsed.userId, 42);
  assert.equal(typeof parsed.time, 'string');
  assert.ok(!Number.isNaN(Date.parse(parsed.time)), 'time should be a parseable timestamp');
});

test('formatLine defaults userId to null when absent (unauthenticated request)', () => {
  const line = formatLine({ method: 'POST', path: '/api/auth/login' }, 401, 5);
  const parsed = JSON.parse(line);
  assert.equal(parsed.userId, null);
});
