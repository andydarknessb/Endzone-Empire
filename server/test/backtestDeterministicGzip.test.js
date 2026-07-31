const test = require('node:test');
const assert = require('node:assert/strict');

const gz = require('../../scripts/backtest/lib/deterministicGzip');

test('gzipDeterministic round-trips arbitrary bytes through gunzipVerified', () => {
  const original = Buffer.from('the quick brown fox jumps over the lazy dog\n'.repeat(50), 'utf8');
  const compressed = gz.gzipDeterministic(original);
  const restored = gz.gunzipVerified(compressed);
  assert.ok(restored.equals(original));
});

test('gzipDeterministic pins mtime=0, the fixed OS byte, and flag byte 0 on every call', () => {
  const inputs = ['', 'a', 'hello world\n', 'x'.repeat(100000)];
  for (const text of inputs) {
    const header = gz.readPinnedHeaderFields(gz.gzipDeterministic(Buffer.from(text, 'utf8')));
    assert.equal(header.mtime, 0, `mtime for ${JSON.stringify(text.slice(0, 10))}`);
    assert.equal(header.os, gz.FIXED_OS_BYTE);
    assert.equal(header.flg, 0);
  }
  assert.equal(gz.FIXED_OS_BYTE, 0xff);
});

test('two gzipDeterministic calls on identical bytes are byte-for-byte identical', () => {
  const bytes = Buffer.from(JSON.stringify({ a: 1, b: [1, 2, 3], c: 'x'.repeat(9000) }));
  const first = gz.gzipDeterministic(bytes);
  const second = gz.gzipDeterministic(bytes);
  assert.ok(first.equals(second), 'identical input must produce identical gzip bytes');
});

test('gzipDeterministic on DIFFERENT bytes produces different output (not a constant)', () => {
  const a = gz.gzipDeterministic(Buffer.from('aaaa'));
  const b = gz.gzipDeterministic(Buffer.from('bbbb'));
  assert.ok(!a.equals(b));
});

test('gzipDeterministic refuses a non-Buffer and an out-of-range level', () => {
  assert.throws(() => gz.gzipDeterministic('not a buffer'), /requires a Buffer/);
  assert.throws(() => gz.gzipDeterministic(Buffer.from('x'), { level: 10 }), /level must be an integer 0-9/);
  assert.throws(() => gz.gzipDeterministic(Buffer.from('x'), { level: -1 }), /level must be an integer 0-9/);
  assert.throws(() => gz.gzipDeterministic(Buffer.from('x'), { level: 1.5 }), /level must be an integer 0-9/);
});

test('gunzipVerified refuses a non-Buffer', () => {
  assert.throws(() => gz.gunzipVerified('nope'), /requires a Buffer/);
});

test('readPinnedHeaderFields refuses a buffer shorter than the gzip header', () => {
  assert.throws(() => gz.readPinnedHeaderFields(Buffer.from([0x1f, 0x8b])), /at least 10 bytes/);
});

test('gzipDeterministic refuses a gzip stream whose flag byte is nonzero (a header field this module never asked for)', () => {
  // Real zlib.gzipSync, as called with the options this module ever passes,
  // never sets FLG - so the only way to prove the refusal is LOAD-BEARING
  // (not dead code no real input can reach) is to inject a raw-gzip
  // producer that returns a header shaped the way a future zlib version
  // embedding an unrequested field (FNAME, FEXTRA, ...) would. This drives
  // the ACTUAL function under test through its real code path, rather than
  // asserting the invariant in isolation.
  const zlib = require('zlib');
  const fakeRawGzip = (buffer, opts) => {
    const real = zlib.gzipSync(buffer, opts);
    const tampered = Buffer.from(real);
    tampered[gz.FLG_OFFSET] = 0x08; // FNAME flag bit
    return tampered;
  };
  assert.throws(
    () => gz.gzipDeterministic(Buffer.from('abc'), { rawGzip: fakeRawGzip }),
    /unexpected gzip flag byte 8/
  );
});

test('gzipDeterministic with the real (default) rawGzip never trips the FLG-byte refusal', () => {
  // The positive control for the test above: the default producer this
  // module actually ships with must never hit its own refusal.
  assert.doesNotThrow(() => gz.gzipDeterministic(Buffer.from('a perfectly ordinary NDJSON line\n')));
});

test('the gzip magic and fixed header offsets are the RFC 1952 values this module assumes', () => {
  assert.equal(gz.HEADER_LENGTH, 10);
  assert.equal(gz.FLG_OFFSET, 3);
  assert.equal(gz.MTIME_OFFSET, 4);
  assert.equal(gz.OS_OFFSET, 9);
});
