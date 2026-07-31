'use strict';

/**
 * Timestamp-free, machine-independent gzip for the Gate-3 publication chunks.
 *
 * The gzip container (RFC 1952) carries three fields this module pins rather
 * than trusts to whatever the platform's zlib defaults to:
 *
 *   - MTIME (bytes 4-7): a modification timestamp. Node's zlib already writes
 *     zero here on every platform this has been checked against, but that is
 *     an observed default, not a documented contract, and a future Node/zlib
 *     upgrade is free to change it. This module WRITES zero rather than
 *     trusting the default, so the guarantee does not rest on an
 *     implementation detail of a dependency this repo does not control.
 *   - OS (byte 9): the "operating system" the archive was produced on. This
 *     varies by PLATFORM (observed 0x0A on this Windows build, 0x03 - Unix -
 *     on a typical Linux CI runner), which means two otherwise-identical
 *     packaging runs on different machines would produce byte-different
 *     `.gz` files even though every compressed byte that matters is the
 *     same. Pinning it to `FIXED_OS_BYTE` (0xFF, "unknown", the standard
 *     reproducible-builds convention) is what makes the requirement "two
 *     runs on the same input must be byte-identical" hold ACROSS machines,
 *     not just within one.
 *   - FLG (byte 3): flags for optional header fields (FNAME, FCOMMENT,
 *     FEXTRA, FHCRC). This module never asks zlib for any of those, so the
 *     flag byte should always read 0; `gzipDeterministic` asserts that
 *     rather than silently accepting a header shape it did not intend to
 *     produce (a future Node version starting to embed a filename would
 *     otherwise leak nothing about its own source path, since none is ever
 *     passed - but it WOULD break byte-reproducibility silently).
 *
 * Nothing here touches a filename: `zlib.gzipSync` is never given one, so
 * there is no FNAME field to strip - only to verify absent.
 *
 * No fs, no server/services, no process.env: this module is `zlib` and
 * nothing else, matching every other file under `scripts/backtest/`.
 */

const zlib = require('zlib');

/** RFC 1952 fixed offsets. */
const HEADER_LENGTH = 10;
const FLG_OFFSET = 3;
const MTIME_OFFSET = 4;
const OS_OFFSET = 9;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/**
 * `0xFF` ("unknown"), the value reproducible-build tooling (e.g. Debian's
 * `strip-nondeterminism`, `pigz --no-name`) uses so a `.gz` file's identity
 * does not depend on which platform produced it.
 */
const FIXED_OS_BYTE = 0xff;

/** The gzip compression level used for every chunk. Any fixed level is
 * deterministic for a given input; DEFAULT_LEVEL just picks one and holds it
 * constant so the packager itself never becomes a second source of drift. */
const DEFAULT_LEVEL = 9;

/**
 * Deterministically gzip a buffer: same compression level every call, no
 * filename ever supplied to zlib, and the MTIME/OS header bytes forced to a
 * fixed value after compression rather than left to the platform.
 *
 * Refuses (rather than silently patches around) an unexpected FLG byte: that
 * would mean zlib embedded a header field this module never asked for, and
 * publishing it unnoticed is exactly the kind of driftable fact the gzip
 * chunks must not carry.
 *
 * `rawGzip` defaults to `zlib.gzipSync` and is the test seam for that
 * refusal: nothing this module ever asks zlib for can normally produce a
 * nonzero FLG byte, so the only way to prove the guard is load-bearing
 * (rather than dead code no real input ever reaches) is to inject a
 * producer that returns a header shaped the way a future zlib version
 * embedding an unrequested field would. Every real caller uses the default.
 */
function gzipDeterministic(buffer, { level = DEFAULT_LEVEL, rawGzip = zlib.gzipSync } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('gzipDeterministic requires a Buffer');
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new Error(`gzipDeterministic: level must be an integer 0-9, got ${JSON.stringify(level)}`);
  }
  const gzipped = rawGzip(buffer, { level });
  if (gzipped.length < HEADER_LENGTH || !gzipped.subarray(0, 2).equals(GZIP_MAGIC)) {
    throw new Error('gzipDeterministic: zlib did not produce a well-formed gzip header');
  }
  if (gzipped[FLG_OFFSET] !== 0) {
    throw new Error(
      `gzipDeterministic: unexpected gzip flag byte ${gzipped[FLG_OFFSET]} (expected 0 - no FNAME, ` +
      'FCOMMENT, FEXTRA or FHCRC field was ever requested, so one appearing means the zlib in this ' +
      'Node build no longer behaves the way this module assumes)'
    );
  }
  const pinned = Buffer.from(gzipped);
  pinned.writeUInt32LE(0, MTIME_OFFSET);
  pinned[OS_OFFSET] = FIXED_OS_BYTE;
  return pinned;
}

/**
 * Decompress a buffer produced by `gzipDeterministic` (or any well-formed
 * gzip stream - decompression does not depend on the header bytes this
 * module pins, only the compressed payload and trailer).
 */
function gunzipVerified(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('gunzipVerified requires a Buffer');
  return zlib.gunzipSync(buffer);
}

/**
 * Pure: read back the three header fields this module pins, for tests that
 * want to assert on them directly rather than re-deriving the offsets.
 */
function readPinnedHeaderFields(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_LENGTH) {
    throw new Error('readPinnedHeaderFields requires a buffer at least 10 bytes long');
  }
  return {
    flg: buffer[FLG_OFFSET],
    mtime: buffer.readUInt32LE(MTIME_OFFSET),
    os: buffer[OS_OFFSET],
  };
}

module.exports = {
  FIXED_OS_BYTE,
  DEFAULT_LEVEL,
  HEADER_LENGTH,
  FLG_OFFSET,
  MTIME_OFFSET,
  OS_OFFSET,
  gzipDeterministic,
  gunzipVerified,
  readPinnedHeaderFields,
};
