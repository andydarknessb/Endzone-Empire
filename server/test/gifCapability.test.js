const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ENABLED,
  isGifMessagesEnabled,
  setGifMessagesEnabledForTests,
} = require('../modules/gifCapability');

afterEach(() => setGifMessagesEnabledForTests(null));

test('the GIF-message capability is DISABLED by default (AC9)', () => {
  assert.equal(DEFAULT_ENABLED, false);
  assert.equal(isGifMessagesEnabled(), false);
});

test('the test override can shadow the default and clears back to it', () => {
  setGifMessagesEnabledForTests(true);
  assert.equal(isGifMessagesEnabled(), true);
  setGifMessagesEnabledForTests(null);
  assert.equal(isGifMessagesEnabled(), false);
});

test('no environment variable can enable it (the switch is not on the deploy surface)', () => {
  const prev = process.env.GIF_MESSAGES_ENABLED;
  process.env.GIF_MESSAGES_ENABLED = 'true';
  try {
    assert.equal(isGifMessagesEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.GIF_MESSAGES_ENABLED;
    else process.env.GIF_MESSAGES_ENABLED = prev;
  }
});
