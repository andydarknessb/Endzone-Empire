const test = require('node:test');
const assert = require('node:assert/strict');
const { getClientOrigins, getCorsOptions } = require('../modules/clientOrigins');

test('CLIENT_ORIGINS is parsed, trimmed, and deduplicated', () => {
  const env = {
    CLIENT_ORIGINS: 'https://endzoneempire.gg, https://www.endzoneempire.gg,https://endzoneempire.gg',
  };

  assert.deepEqual(getClientOrigins(env), [
    'https://endzoneempire.gg',
    'https://www.endzoneempire.gg',
  ]);
  assert.deepEqual(getCorsOptions(env), {
    origin: ['https://endzoneempire.gg', 'https://www.endzoneempire.gg'],
  });
});

test('APP_ORIGIN remains the single-origin fallback', () => {
  assert.deepEqual(getClientOrigins({ APP_ORIGIN: 'https://endzoneempire.gg' }), [
    'https://endzoneempire.gg',
  ]);
});

test('cross-origin access is disabled when no client origin is configured', () => {
  assert.deepEqual(getCorsOptions({}), { origin: false });
});
