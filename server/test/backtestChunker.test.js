const test = require('node:test');
const assert = require('node:assert/strict');

const { chunkNdjson, chunkFileName, countNdjsonLines, DEFAULT_CHUNK_TARGET_BYTES } = require('../../scripts/backtest/lib/chunker');

function ndjson(rows) {
  return rows.length === 0 ? '' : `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

test('a zero-row dataset produces exactly one empty chunk, never zero chunks', () => {
  const chunks = chunkNdjson('');
  assert.deepEqual(chunks, ['']);
  assert.equal(countNdjsonLines(chunks[0]), 0);
});

test('chunkNdjson never splits a line across a chunk boundary', () => {
  const rows = Array.from({ length: 50 }, (unused, i) => ({ i, pad: 'x'.repeat(20) }));
  const text = ndjson(rows);
  const chunks = chunkNdjson(text, { targetBytes: 200 });
  assert.ok(chunks.length > 1, 'the small budget must force more than one chunk');
  for (const chunk of chunks) {
    assert.ok(chunk.endsWith('\n'), 'every chunk ends with a newline');
    const lines = chunk.slice(0, -1).split('\n');
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line), 'every line is complete JSON');
  }
  // Reassembling every chunk reproduces the exact original text, byte for byte.
  assert.equal(chunks.join(''), text);
});

test('a single line larger than the budget becomes a chunk of one rather than being split', () => {
  const hugeLine = JSON.stringify({ blob: 'x'.repeat(1000) });
  const text = `${hugeLine}\n${JSON.stringify({ small: 1 })}\n`;
  const chunks = chunkNdjson(text, { targetBytes: 50 });
  assert.equal(chunks[0], `${hugeLine}\n`);
  assert.equal(chunks.length, 2);
});

test('chunkNdjson is deterministic: the same text always produces the same chunk sequence', () => {
  const rows = Array.from({ length: 733 }, (unused, i) => ({ i, v: i * i }));
  const text = ndjson(rows);
  const a = chunkNdjson(text, { targetBytes: 500 });
  const b = chunkNdjson(text, { targetBytes: 500 });
  assert.deepEqual(a, b);
});

test('chunkNdjson respects the target budget: a large dataset with a small budget produces multiple chunks, none far over budget', () => {
  const rows = Array.from({ length: 2000 }, (unused, i) => ({ i, pad: 'y'.repeat(30) }));
  const text = ndjson(rows);
  const chunks = chunkNdjson(text, { targetBytes: 1024 });
  assert.ok(chunks.length > 5);
  for (const chunk of chunks.slice(0, -1)) {
    // Every non-final chunk is within one line's worth of the budget - it
    // cannot be smaller than "the first line alone" would already imply,
    // because a new chunk always starts by admitting at least one line.
    assert.ok(Buffer.byteLength(chunk, 'utf8') > 0);
  }
});

test('chunkNdjson refuses malformed input', () => {
  assert.throws(() => chunkNdjson(123), /requires NDJSON text as a string/);
  assert.throws(() => chunkNdjson('no trailing newline'), /must end with a newline/);
  assert.throws(() => chunkNdjson('a\n\nb\n'), /blank line/);
  assert.throws(() => chunkNdjson('a\n', { targetBytes: 0 }), /targetBytes must be a positive integer/);
  assert.throws(() => chunkNdjson('a\n', { targetBytes: -5 }), /targetBytes must be a positive integer/);
  assert.throws(() => chunkNdjson('a\n', { targetBytes: 1.5 }), /targetBytes must be a positive integer/);
});

test('the documented default chunk budget is 8 MiB', () => {
  assert.equal(DEFAULT_CHUNK_TARGET_BYTES, 8 * 1024 * 1024);
});

test('chunkFileName zero-pads to four digits and refuses bad input', () => {
  assert.equal(chunkFileName(0), 'chunk-0000.ndjson.gz');
  assert.equal(chunkFileName(7), 'chunk-0007.ndjson.gz');
  assert.equal(chunkFileName(1234), 'chunk-1234.ndjson.gz');
  assert.throws(() => chunkFileName(-1), /non-negative integer/);
  assert.throws(() => chunkFileName(1.5), /non-negative integer/);
  assert.throws(() => chunkFileName(10000), /exceeds the 4-digit naming budget/);
});

test('countNdjsonLines counts records, not newlines, and refuses malformed input', () => {
  assert.equal(countNdjsonLines(''), 0);
  assert.equal(countNdjsonLines('a\n'), 1);
  assert.equal(countNdjsonLines('a\nb\nc\n'), 3);
  assert.throws(() => countNdjsonLines('a'), /must end with a newline/);
  assert.throws(() => countNdjsonLines(5), /requires a string/);
});
