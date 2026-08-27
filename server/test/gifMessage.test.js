const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEXT,
  GIF,
  GIF_CODES,
  GIF_DESCRIPTION_MAX,
  validateGifSend,
} = require('../modules/gifMessage');

const ok = {
  provider: 'fake',
  assetId: 'abc123_XY-9',
  description: 'a cat knocking a cup off a table',
  caption: 'this is me at 3pm',
};

test('kinds are the two content_kind discriminator values', () => {
  assert.equal(TEXT, 'text');
  assert.equal(GIF, 'gif');
});

test('a well-formed enabled GIF send is accepted and normalized (trimmed)', () => {
  const result = validateGifSend(
    { provider: ' fake ', assetId: ' abc123 ', description: '  a waving hand  ', caption: '  hi  ' },
    { enabled: true }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    provider: 'fake',
    assetId: 'abc123',
    description: 'a waving hand',
    caption: 'hi',
  });
});

test('an absent caption normalizes to null, not empty string (a GIF may have no caption, AC1)', () => {
  const result = validateGifSend({ ...ok, caption: undefined }, { enabled: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.caption, null);
  const blank = validateGifSend({ ...ok, caption: '   ' }, { enabled: true });
  assert.equal(blank.ok, true);
  assert.equal(blank.value.caption, null);
});

test('capability disabled refuses with GIF_PROVIDER_DISABLED (AC7 server-side, defense in depth)', () => {
  const result = validateGifSend(ok, { enabled: false });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'GIF_PROVIDER_DISABLED');
  assert.equal(result.code, GIF_CODES.DISABLED);
});

test('a missing or blank description blocks send with DESCRIPTION_REQUIRED (AC3)', () => {
  for (const description of [undefined, null, '', '   ']) {
    const result = validateGifSend({ ...ok, description }, { enabled: true });
    assert.equal(result.ok, false, `description=${JSON.stringify(description)} must be refused`);
    assert.equal(result.code, 'DESCRIPTION_REQUIRED');
  }
});

test('a description over the bound is refused with DESCRIPTION_TOO_LONG and a code-point length', () => {
  const description = 'x'.repeat(GIF_DESCRIPTION_MAX + 1);
  const result = validateGifSend({ ...ok, description }, { enabled: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DESCRIPTION_TOO_LONG');
  assert.equal(result.limit, GIF_DESCRIPTION_MAX);
  assert.equal(result.length, GIF_DESCRIPTION_MAX + 1);
});

test('an arbitrary embedded URL as the asset is rejected with MEDIA_NOT_ALLOWED (AC2)', () => {
  for (const assetId of [
    'https://media.giphy.com/x.gif',
    'http://example.com/a',
    '//evil.example/x',
    'data:image/gif;base64,R0lGOD',
    'blob:https://app/uuid',
    'ftp://host/file',
    '../../etc/passwd',
    'a b',
  ]) {
    const result = validateGifSend({ ...ok, assetId }, { enabled: true });
    assert.equal(result.ok, false, `assetId=${assetId} must be refused`);
    assert.equal(result.code, 'MEDIA_NOT_ALLOWED', `assetId=${assetId}`);
  }
});

test('a payload carrying a url/upload/bytes key is rejected outright with MEDIA_NOT_ALLOWED (AC2)', () => {
  for (const key of ['url', 'uri', 'dataUri', 'src', 'file', 'upload', 'bytes', 'blob']) {
    const result = validateGifSend({ ...ok, [key]: 'anything' }, { enabled: true });
    assert.equal(result.ok, false, `key ${key} must be refused`);
    assert.equal(result.code, 'MEDIA_NOT_ALLOWED', `key ${key}`);
  }
});

test('a malformed provider is rejected with MEDIA_NOT_ALLOWED', () => {
  for (const provider of ['', '  ', 'has space', 'http://x', 42, null]) {
    const result = validateGifSend({ ...ok, provider }, { enabled: true });
    assert.equal(result.ok, false, `provider=${JSON.stringify(provider)}`);
    assert.equal(result.code, 'MEDIA_NOT_ALLOWED');
  }
});
