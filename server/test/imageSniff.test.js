const test = require('node:test');
const assert = require('node:assert/strict');
const { sniffImageType } = require('../modules/imageSniff');

// Whatever follows the magic bytes. Named so the signature under test stays
// visually separate from the payload without concatenating two literals,
// which is what the string is for and what `no-useless-concat` objects to.
const PAYLOAD = 'rest-of-file';

test('recognizes a PNG signature', () => {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  assert.deepEqual(sniffImageType(buffer), { ext: 'png', mimeType: 'image/png' });
});

test('recognizes a JPEG signature', () => {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.deepEqual(sniffImageType(buffer), { ext: 'jpg', mimeType: 'image/jpeg' });
});

test('recognizes a GIF87a signature', () => {
  const buffer = Buffer.from(`GIF87a${PAYLOAD}`, 'ascii');
  assert.deepEqual(sniffImageType(buffer), { ext: 'gif', mimeType: 'image/gif' });
});

test('recognizes a GIF89a signature (the common animated variant)', () => {
  const buffer = Buffer.from(`GIF89a${PAYLOAD}`, 'ascii');
  assert.deepEqual(sniffImageType(buffer), { ext: 'gif', mimeType: 'image/gif' });
});

test('recognizes a WEBP signature (RIFF....WEBP)', () => {
  const buffer = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // chunk size, irrelevant to sniffing
    Buffer.from('WEBP', 'ascii'),
    Buffer.from([0x00, 0x00]),
  ]);
  assert.deepEqual(sniffImageType(buffer), { ext: 'webp', mimeType: 'image/webp' });
});

test('rejects an SVG (text-based, would otherwise pass a naive check)', () => {
  const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  assert.equal(sniffImageType(buffer), null);
});

test('rejects a renamed text file with a misleading extension in mind', () => {
  const buffer = Buffer.from('just plain text pretending to be an image', 'utf8');
  assert.equal(sniffImageType(buffer), null);
});

test('rejects a RIFF file that is not WEBP (e.g. a WAV)', () => {
  const buffer = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WAVE', 'ascii'),
  ]);
  assert.equal(sniffImageType(buffer), null);
});

test('rejects a truncated buffer shorter than any signature', () => {
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50])), null);
});

test('rejects an empty buffer', () => {
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
});

test('rejects non-buffer input without throwing', () => {
  assert.equal(sniffImageType(null), null);
  assert.equal(sniffImageType(undefined), null);
  assert.equal(sniffImageType('not a buffer'), null);
});
