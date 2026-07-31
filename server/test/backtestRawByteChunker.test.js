const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TARGET_BYTES,
  chunkRawBytes,
  rawChunkFileName,
} = require('../../scripts/backtest/lib/rawByteChunker');

// ---------------------------------------------------------------------------
// Basic shape: exact multiples, non-multiples, single byte, empty buffer
// ---------------------------------------------------------------------------

test('chunkRawBytes splits an exact multiple of targetBytes into equal-size chunks with none left over', () => {
  const buf = Buffer.alloc(30);
  for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
  const chunks = chunkRawBytes(buf, { targetBytes: 10 });
  assert.equal(chunks.length, 3);
  for (const c of chunks) assert.equal(c.length, 10);
  assert.ok(Buffer.concat(chunks).equals(buf));
});

test('chunkRawBytes splits a non-multiple into full chunks plus one shorter remainder chunk', () => {
  const buf = Buffer.alloc(25);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 7) % 256;
  const chunks = chunkRawBytes(buf, { targetBytes: 10 });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 10);
  assert.equal(chunks[1].length, 10);
  assert.equal(chunks[2].length, 5);
  assert.ok(Buffer.concat(chunks).equals(buf));
});

test('chunkRawBytes on a buffer smaller than targetBytes produces exactly one chunk holding everything', () => {
  const buf = Buffer.from('short');
  const chunks = chunkRawBytes(buf, { targetBytes: 8 * 1024 * 1024 });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].equals(buf));
});

test('chunkRawBytes on a single byte produces one one-byte chunk', () => {
  const buf = Buffer.from([0x42]);
  const chunks = chunkRawBytes(buf, { targetBytes: 10 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 1);
  assert.equal(chunks[0][0], 0x42);
});

test('chunkRawBytes on an empty buffer produces exactly one EMPTY chunk, never zero chunks', () => {
  const chunks = chunkRawBytes(Buffer.alloc(0), { targetBytes: 10 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 0);
});

test('every slice is capped at exactly targetBytes with no "one record too big" exception, unlike the NDJSON chunker', () => {
  // A single "record" (here, an arbitrary run of identical bytes with no
  // delimiter at all) far larger than targetBytes must still be split into
  // targetBytes-sized pieces - there is no such thing as an atomic unit here.
  const buf = Buffer.alloc(1000, 0x41);
  const chunks = chunkRawBytes(buf, { targetBytes: 64 });
  for (const c of chunks.slice(0, -1)) assert.equal(c.length, 64);
  assert.ok(chunks[chunks.length - 1].length <= 64);
  assert.ok(Buffer.concat(chunks).equals(buf));
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('chunkRawBytes is deterministic: the same input produces byte-identical chunk arrays across repeated calls', () => {
  const buf = Buffer.alloc(12345);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) % 256;
  const a = chunkRawBytes(buf, { targetBytes: 777 });
  const b = chunkRawBytes(buf, { targetBytes: 777 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(a[i].equals(b[i]), `chunk ${i} differs across calls`);
});

// ---------------------------------------------------------------------------
// The load-bearing case: a fixture with \r\n line endings AND an
// embedded-newline-inside-quotes CSV pattern, proving the chunker genuinely
// does not care - it is not merely "safe by accident" because it happens
// never to be tested against that shape.
// ---------------------------------------------------------------------------

test('chunkRawBytes is indifferent to CRLF and embedded-newline-inside-quoted-CSV-field content: it still reassembles exactly', () => {
  const csvText =
    'gsis_id,full_name,report_status\r\n' +
    '00-0000001,"Smith, John",Questionable\r\n' +
    // An embedded newline INSIDE a quoted field - the exact shape that makes
    // a line-atomic chunker unsafe for these sources. This chunker must not
    // even notice it is there.
    '00-0000002,"Multi\nLine\r\nName",Out\r\n' +
    '00-0000003,"Trailing quote at end""",Doubtful\r\n';
  const buf = Buffer.from(csvText, 'utf8');

  // Pick a tiny target so a chunk boundary is FORCED to land inside the
  // embedded-newline field - if the chunker were line-aware in any way, this
  // is exactly where that would show up.
  const targetBytes = 20;
  const chunks = chunkRawBytes(buf, { targetBytes });

  assert.ok(chunks.length > 1, 'the tiny budget must force more than one chunk');
  for (const c of chunks.slice(0, -1)) assert.equal(c.length, targetBytes);
  const reassembled = Buffer.concat(chunks);
  assert.ok(reassembled.equals(buf), 'concatenating the raw-byte chunks in order reproduces the exact original bytes');
  assert.equal(reassembled.toString('utf8'), csvText);
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test('chunkRawBytes refuses a non-Buffer and a non-positive-integer targetBytes', () => {
  assert.throws(() => chunkRawBytes('not a buffer'), /requires a Buffer/);
  assert.throws(() => chunkRawBytes(Buffer.from('x'), { targetBytes: 0 }), /positive integer/);
  assert.throws(() => chunkRawBytes(Buffer.from('x'), { targetBytes: -5 }), /positive integer/);
  assert.throws(() => chunkRawBytes(Buffer.from('x'), { targetBytes: 1.5 }), /positive integer/);
});

test('chunkRawBytes defaults targetBytes to 8 MiB', () => {
  assert.equal(DEFAULT_TARGET_BYTES, 8 * 1024 * 1024);
  const buf = Buffer.alloc(DEFAULT_TARGET_BYTES + 1);
  assert.equal(chunkRawBytes(buf).length, 2);
});

// ---------------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------------

test('rawChunkFileName zero-pads to 4 digits and uses .bin.gz, never .ndjson.gz', () => {
  assert.equal(rawChunkFileName(0), 'chunk-0000.bin.gz');
  assert.equal(rawChunkFileName(7), 'chunk-0007.bin.gz');
  assert.equal(rawChunkFileName(9999), 'chunk-9999.bin.gz');
});

test('rawChunkFileName refuses a negative, non-integer, or over-budget index', () => {
  assert.throws(() => rawChunkFileName(-1), /non-negative integer/);
  assert.throws(() => rawChunkFileName(1.5), /non-negative integer/);
  assert.throws(() => rawChunkFileName(10000), /exceeds the 4-digit naming budget/);
});
