'use strict';

/**
 * Hash-verified byte handling for the reconstructed historical backtest.
 *
 * This file exists so that "read a pinned file and prove it is still the bytes
 * the preregistration sealed" is importable WITHOUT importing a fetcher.
 *
 * Phase 1 (extraction) is required by the approved plan and by the sealed
 * preregistration (section 17) to accept ONLY archived, hash-verified Phase-0
 * paths and to import no fetch code at all, so that it is structurally
 * incapable of refetching an external source. If `readVerified` lived beside
 * `fetchWithContract` in `sourceFetch.js` — as it did when Phase 0 was the only
 * consumer — then every Phase-1 module that wanted to read a pinned CSV would
 * drag `https` and the whole redirect machinery into its require graph, and the
 * "structurally incapable" claim would be a promise rather than a property.
 *
 * The split is therefore along exactly one line: everything here is fs +
 * crypto and nothing else. `sourceFetch.js` re-exports all of it, so the
 * frozen fetcher contract described in the preregistration (section 1.1) is
 * still one module from a caller's point of view and every Phase-0 test keeps
 * asserting against the same names.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Pure: lowercase hex SHA-256 of a byte buffer. */
function sha256Hex(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('sha256Hex requires a Buffer');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Pure: git's blob SHA for a byte buffer - sha1("blob <len>\0" + bytes).
 * Matches server/scripts/generate-schedule-manifest.js, deliberately: the
 * games.csv pin is stated as a git commit + blob pair, and the blob SHA is the
 * only hash that can be checked against the repository the pin names.
 */
function gitBlobSha1(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('gitBlobSha1 requires a Buffer');
  return crypto.createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/** Fail loud unless the bytes hash to the pinned git blob SHA. */
function assertGitBlobSha(bytes, expected, { label = 'file' } = {}) {
  const actual = gitBlobSha1(bytes);
  if (actual !== expected) {
    throw new Error(
      `${label}: bytes do not match the pinned git blob SHA (hashes to ${actual}, pinned ${expected}) - ` +
      'refusing to accept bytes that are not the named revision'
    );
  }
  return actual;
}

/** Fail loud unless the bytes hash to the expected SHA-256. */
function assertSha256(bytes, expected, { label = 'file' } = {}) {
  const actual = sha256Hex(bytes);
  if (actual !== expected) {
    throw new Error(
      `${label}: bytes do not match the pinned SHA-256 (hashes to ${actual}, pinned ${expected})`
    );
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Fail loud unless every required column is present in the header. Extra
 * columns are fine and expected (nflverse adds columns between releases); a
 * MISSING one means a preregistered rule has lost its input.
 */
function assertColumns({ header, requiredColumns, label = 'file' }) {
  const present = new Set(header || []);
  const missing = (requiredColumns || []).filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `${label}: schema validation failed, missing column(s) ${missing.join(', ')} ` +
      `(header has ${present.size} columns)`
    );
  }
  const duplicates = [...(header || []).reduce((acc, name) => {
    acc.set(name, (acc.get(name) || 0) + 1);
    return acc;
  }, new Map())].filter(([, n]) => n > 1).map(([name]) => name);
  if (duplicates.length > 0) {
    throw new Error(`${label}: schema validation failed, duplicate column name(s) ${duplicates.join(', ')}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Write bytes and prove the file on disk hashes to what was written. Writing
 * then re-reading catches the whole class of "the bytes on disk are not the
 * bytes we verified" faults (a truncated write, a text-mode translation, an
 * antivirus rewrite) at the moment they happen instead of three phases later.
 */
function writeVerified(filePath, bytes, { label = path.basename(String(filePath)) } = {}) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`${label}: writeVerified requires a Buffer`);
  const expected = sha256Hex(bytes);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  const readBack = fs.readFileSync(filePath);
  const actual = sha256Hex(readBack);
  if (actual !== expected) {
    throw new Error(
      `${label}: file on disk hashes to ${actual} but the bytes written hash to ${expected}`
    );
  }
  return { sha256: expected, byteLength: bytes.length };
}

/** Read a pinned file and verify its bytes against the recorded SHA-256. */
function readVerified(filePath, expectedSha256, { label = path.basename(String(filePath)) } = {}) {
  if (!expectedSha256) {
    throw new Error(`${label}: refusing to read a pinned source without an expected SHA-256`);
  }
  const bytes = fs.readFileSync(filePath);
  assertSha256(bytes, expectedSha256, { label });
  return bytes;
}

// ---------------------------------------------------------------------------
// Provenance (read side only - writing provenance belongs to the fetcher)
// ---------------------------------------------------------------------------

/**
 * Read the Phase-0 provenance index as a Map keyed by source name.
 *
 * Fail-closed on purpose, unlike `fetch-sources.js`'s own tolerant loader: the
 * fetcher legitimately starts from "no provenance yet", while a Phase-1 read
 * that cannot find the provenance file has lost the only thing that makes its
 * inputs pinned bytes rather than whatever happens to be on disk.
 */
function readProvenanceRecords(provenancePath) {
  if (!fs.existsSync(provenancePath)) {
    throw new Error(
      `no Phase-0 provenance at ${provenancePath} - extraction accepts only archived, ` +
      'hash-verified sources and has no way to fetch one'
    );
  }
  const doc = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const records = (doc && doc.records) || [];
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`${provenancePath}: provenance carries no records`);
  }
  const byName = new Map();
  for (const record of records) {
    if (!record || !record.name) throw new Error(`${provenancePath}: a provenance record has no name`);
    if (!record.sha256) throw new Error(`${provenancePath}: ${record.name} has no recorded sha256`);
    if (byName.has(record.name)) {
      throw new Error(`${provenancePath}: duplicate provenance record for ${record.name}`);
    }
    byName.set(record.name, record);
  }
  return byName;
}

module.exports = {
  sha256Hex,
  gitBlobSha1,
  assertGitBlobSha,
  assertSha256,
  assertColumns,
  writeVerified,
  readVerified,
  readProvenanceRecords,
};
