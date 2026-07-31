'use strict';

/**
 * Fixed-size, line-atomic chunking of canonical NDJSON, for the Gate-3
 * publication packager.
 *
 * The user's binding requirement (Gate 3 review) is that the snapshot's
 * canonical NDJSON files must never be published unchanged: each dataset is
 * split into fixed-size pieces before it is gzipped. "Fixed-size" is
 * interpreted as a BYTE BUDGET per chunk (`DEFAULT_CHUNK_TARGET_BYTES`, 8 MiB
 * of uncompressed NDJSON - large enough that a 30 MB dataset like
 * `player_stats` becomes a small, reviewable number of chunks, small enough
 * that no single chunk is the whole 30 MB file), never a byte COUNT that
 * would let a chunk boundary fall inside a JSON record. A record (one NDJSON
 * line) is the atomic unit: `chunkNdjson` accumulates whole lines until the
 * next one would exceed the budget, then starts a new chunk. The one
 * intentional exception is a single line that is ITSELF larger than the
 * budget: it becomes a chunk of one rather than being split (splitting it
 * would corrupt the JSON), so the budget is a target, not a hard cap.
 *
 * Determinism follows from the algorithm being a pure, order-preserving scan
 * over the exact bytes handed to it: the same NDJSON text always produces the
 * same sequence of chunk texts, on any machine, on any run.
 *
 * No fs, no server/services, no process.env - pure string/buffer arithmetic,
 * matching every other file under `scripts/backtest/`.
 */

/** 8 MiB of uncompressed NDJSON per chunk. Documented default; see above. */
const DEFAULT_CHUNK_TARGET_BYTES = 8 * 1024 * 1024;

/**
 * Split canonical NDJSON text into an array of NDJSON chunk texts.
 *
 * `text` must be either `''` (a zero-row dataset) or end with a single
 * trailing `\n` - the same contract `snapshotStore.rowsToNdjson` produces and
 * `ndjsonToRows` requires, so this function can be pointed directly at bytes
 * already proven to be a valid dataset on disk.
 *
 * A zero-row dataset (`''`) still produces ONE chunk (of empty text), never
 * zero chunks: every dataset the snapshot manifest lists must appear exactly
 * once in the publication manifest's chunk inventory, and a dataset with no
 * chunks at all would be a silent gap in that inventory rather than a
 * recorded, hashable empty chunk.
 */
function chunkNdjson(text, { targetBytes = DEFAULT_CHUNK_TARGET_BYTES } = {}) {
  if (typeof text !== 'string') throw new Error('chunkNdjson requires NDJSON text as a string');
  if (!Number.isInteger(targetBytes) || targetBytes <= 0) {
    throw new Error(`chunkNdjson: targetBytes must be a positive integer, got ${JSON.stringify(targetBytes)}`);
  }
  if (text === '') return [''];
  if (!text.endsWith('\n')) {
    throw new Error('chunkNdjson: NDJSON text must end with a newline (or be empty)');
  }
  const lines = text.split('\n');
  lines.pop(); // the trailing '' after the final \n
  if (lines.length === 0) return [''];

  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const line of lines) {
    if (line === '') throw new Error('chunkNdjson: blank line in NDJSON text');
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1; // +1 for the '\n' this line owns
    if (current.length > 0 && currentBytes + lineBytes > targetBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(line);
    currentBytes += lineBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.map((chunkLines) => `${chunkLines.join('\n')}\n`);
}

/**
 * Pure: zero-pad a chunk index into the fixed on-disk filename shape,
 * `chunk-0000`, `chunk-0001`, ... Four digits supports 10,000 chunks per
 * dataset, far beyond anything a single dataset in this snapshot could ever
 * need at an 8 MiB budget.
 */
function chunkFileName(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`chunkFileName: index must be a non-negative integer, got ${JSON.stringify(index)}`);
  }
  if (index > 9999) throw new Error(`chunkFileName: index ${index} exceeds the 4-digit naming budget`);
  return `chunk-${String(index).padStart(4, '0')}.ndjson.gz`;
}

/** Pure: how many NDJSON records are in one chunk's text (0 for `''`). */
function countNdjsonLines(text) {
  if (typeof text !== 'string') throw new Error('countNdjsonLines requires a string');
  if (text === '') return 0;
  if (!text.endsWith('\n')) throw new Error('countNdjsonLines: text must end with a newline (or be empty)');
  return text.split('\n').length - 1;
}

module.exports = {
  DEFAULT_CHUNK_TARGET_BYTES,
  chunkNdjson,
  chunkFileName,
  countNdjsonLines,
};
