'use strict';

/**
 * Fixed-size, RAW BYTE chunking for the Gate-3 raw-source-CSV publication.
 *
 * This is the deliberate counterpart to `chunker.js`'s line-atomic NDJSON
 * chunking, not a variant of it. `chunker.js` is safe ONLY because it knows
 * its input is canonical NDJSON - one whole JSON record per line - and can
 * therefore treat a line as the atomic unit that must never be split. The ten
 * pinned raw source CSVs this module exists to chunk carry no such guarantee:
 * a direct byte-level inspection of the archived sources (comparing a raw
 * newline count against the row count a full RFC4180 parse produces) found
 * that `injuries_2024.csv` has fewer parsed records than raw `\n` bytes,
 * which means at least one field in that file is a quoted value spanning more
 * than one physical line. A chunker that assumed "one record per line" could
 * split the file at a byte offset landing inside such a field and still
 * appear to work, because nothing downstream of a naive line-chunker ever
 * tries to reassemble it BY LINES - the corruption would only show up if
 * something tried to re-parse the chunk as CSV on its own, which nothing here
 * does. The one correct fix is to never try to be line-aware, or CSV-aware,
 * or text-aware, at all: a raw source file is chunked as an undifferentiated
 * sequence of bytes, and reconstruction is a byte-for-byte concatenation in
 * order. That is what this module does, and ONLY what it does.
 *
 * Because chunking here is a plain fixed-size scan over a byte offset (never
 * "accumulate until the next record would overflow the budget"), there is no
 * "one record too big for the budget" exception the way `chunkNdjson` has for
 * an oversized line: every chunk this function produces is capped at exactly
 * `targetBytes`, with no exception, by construction.
 *
 * No fs, no server/services, no process.env - pure Buffer arithmetic, matching
 * every other file under `scripts/backtest/`. Byte values are never decoded as
 * text and never re-interpreted in any way; a Buffer in, a Buffer (sliced)
 * out.
 */

/** 8 MiB per chunk - the same numeric budget `chunker.js` uses for NDJSON, so
 * a human looking at the two side by side sees one consistent chunk size
 * policy for the whole publication, even though the two algorithms differ. */
const DEFAULT_TARGET_BYTES = 8 * 1024 * 1024;

/**
 * Split a Buffer into fixed-size byte slices.
 *
 * `buffer.subarray(...)` returns a VIEW onto the same underlying memory
 * (never a copy) - fine here because every caller either gzips a slice
 * immediately (which reads it once and discards the view) or hands it to a
 * test that never mutates it. If a future caller needs an independently
 * owned buffer, it must copy it explicitly; this function does not, to avoid
 * doubling memory for a bytes-only chunking pass over multi-megabyte files.
 *
 * An empty buffer still produces exactly ONE chunk (an empty one), matching
 * `chunkNdjson`'s convention for a zero-row dataset: every source the
 * publication manifest lists must appear exactly once in the chunk
 * inventory, never as a silent zero-chunk gap. (None of the ten pinned raw
 * sources are actually empty; this is defensive, not load-bearing today.)
 */
function chunkRawBytes(buffer, { targetBytes = DEFAULT_TARGET_BYTES } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('chunkRawBytes requires a Buffer');
  if (!Number.isInteger(targetBytes) || targetBytes <= 0) {
    throw new Error(`chunkRawBytes: targetBytes must be a positive integer, got ${JSON.stringify(targetBytes)}`);
  }
  if (buffer.length === 0) return [buffer.subarray(0, 0)];
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += targetBytes) {
    chunks.push(buffer.subarray(offset, Math.min(offset + targetBytes, buffer.length)));
  }
  return chunks;
}

/**
 * Pure: zero-pad a chunk index into the fixed on-disk filename shape. The
 * `.bin.gz` extension is deliberately DIFFERENT from `chunker.js`'s
 * `.ndjson.gz` - a human browsing the publication tree must never have to
 * guess, from the filename alone, whether a chunk is line-atomic NDJSON or an
 * opaque raw-byte slice of an original file; the extension says which
 * reconstruction algorithm applies.
 */
function rawChunkFileName(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`rawChunkFileName: index must be a non-negative integer, got ${JSON.stringify(index)}`);
  }
  if (index > 9999) throw new Error(`rawChunkFileName: index ${index} exceeds the 4-digit naming budget`);
  return `chunk-${String(index).padStart(4, '0')}.bin.gz`;
}

module.exports = {
  DEFAULT_TARGET_BYTES,
  chunkRawBytes,
  rawChunkFileName,
};
