/* eslint-disable no-console */
'use strict';

/**
 * The network-free REHYDRATOR: turns a Gate-3 publication tree (`--publish`,
 * default `backtest-data/publish/`) back into a drop-in stand-in for BOTH
 * `backtest-data/snapshot/` (the sealed Gate-2 output) and
 * `backtest-data/sources/` (the ten pinned raw source CSVs), reading nothing
 * but chunks already on disk under `--publish`. No network, no database, no
 * `process.env` - this is the tool that proves the publication tree ALONE is
 * sufficient to reproduce the study, which is the actual point of packaging
 * `sources/` in the first place (see `package-snapshot.js`'s module
 * docblock for the full "why").
 *
 * Every reassembled byte is verified against the recorded hash before it is
 * ever written to disk, and this module THROWS (never warns-and-continues)
 * on any mismatch anywhere: it exists to be a reproducibility PROOF, not a
 * best-effort restore tool. A caller that wants to know whether rehydration
 * succeeded gets exactly one signal - it either returns a full result or it
 * throws.
 *
 * Isolation, matching every other file under `scripts/backtest/`: no
 * `server/modules/pool`, no `server/services/*`, no `process.env` (see
 * `server/test/backtestSourceFetch.test.js`, which walks this whole
 * directory and would fail if this file broke that rule).
 *
 * ROUND 4 REVIEW: THIS FILE COULD DESTROY ITS OWN INPUT (BLOCKER, FIXED)
 *
 * Before this fix, `rehydrate()` only checked `outSnapshotRoot` against
 * `outSourcesDir` for exact equality - a single, much weaker reinvention of
 * the exact collision-detection problem `package-snapshot.js`'s
 * `assertDisjointRoots` was hardened against TWICE already (a Windows
 * case-only alias, a UNC admin-share alias). It never checked either output
 * against `publishRoot` (the INPUT) at all, never checked nesting in either
 * direction, and never checked a case/junction/UNC alias of any pair. A
 * caller who pointed `outSnapshotRoot` (or `outSourcesDir`) at the same
 * directory as `publishRoot` would have this file overwrite the publication's
 * own `manifest.json` with rehydrated snapshot-manifest bytes - silent
 * corruption of the exact reproducibility artifact this tool exists to
 * prove trustworthy. Fixed by importing the SAME hardened, shared
 * `assertRootsDisjoint` from `./lib/rootSafety.js` that `package-snapshot.js`
 * uses (not a second copy), checked against all THREE roots
 * (`publishRoot`, `outSnapshotRoot`, `outSourcesDir`), pairwise, before any
 * filesystem read or write.
 *
 * This file also now mirrors `package-snapshot.js`'s own build-to-temp-then-
 * promote pattern: both outputs are built into fresh temporary sibling
 * directories first, fully verified there, and only renamed into place on
 * complete success. A build-phase failure (a tampered or missing chunk, a
 * corrupted fixed file) cleans up both temp directories, so neither
 * `outSnapshotRoot` nor `outSourcesDir` is ever touched at all; a promote-time
 * conflict (either destination already exists and is non-empty) leaves both
 * fully-built temp directories on disk, named in the thrown error, exactly as
 * `package-snapshot.js`'s `assertPublishRootAbsentForPromote` already does
 * for its own single output root.
 *
 * PROMOTING TWO OUTPUTS IS NOT ONE ATOMIC OPERATION (round 6, fourth review
 * round). `outSnapshotRoot` and `outSourcesDir` are promoted via two
 * SEPARATE `fs.renameSync` calls, which can never be atomic together the way
 * `package-snapshot.js`'s single `publishRoot` rename is. If the second
 * rename fails, the first is rolled back (best-effort, via a THIRD rename
 * back to its pre-promote temp path) - this is a COMPENSATING ACTION, not
 * true atomicity, and its own failure mode is real: if that rollback rename
 * ALSO fails, `outSnapshotRoot` is left promoted while `outSourcesDir` is
 * not, and the thrown error says so explicitly rather than claiming
 * otherwise. See the promote step's own comments for the exact two outcomes.
 */

const fs = require('fs');
const path = require('path');

const store = require('./lib/snapshotStore');
const { sha256Hex, writeVerified } = require('./lib/verifiedBytes');
const { gunzipVerified } = require('./lib/deterministicGzip');
const { assertSafeSourceFile } = require('./lib/sources');
const { assertRootsDisjoint, isContainedIn, normalizeForCompare } = require('./lib/rootSafety');
const { buildSealedSourcesMap, buildSealedDatasetsMap, assertExactNameSets } = require('./lib/sealedManifest');
const { chunkFileName } = require('./lib/chunker');
const { rawChunkFileName } = require('./lib/rawByteChunker');
const {
  DEFAULT_PUBLISH_DIR,
  SOURCE_MANIFEST_FILENAME,
  SOURCES_PROVENANCE_FILENAME,
  PINNED_SNAPSHOT_MANIFEST_SHA256,
  chunkManifestPath,
  sourceChunkManifestPath,
} = require('./package-snapshot');

/**
 * The `fs.mkdtempSync` prefixes rehydration's two temporary build
 * directories are created under - named constants for the same reason
 * `package-snapshot.js`'s `TEMP_BUILD_DIR_PREFIX` is: so a leaked build
 * directory is unambiguously recognizable by name, and so the prefix used at
 * creation time and any code that might one day scan for leaked siblings can
 * never silently drift apart.
 */
const TEMP_REHYDRATE_SNAPSHOT_PREFIX = '.tmp-rehydrate-snapshot-';
const TEMP_REHYDRATE_SOURCES_PREFIX = '.tmp-rehydrate-sources-';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function readPublicationManifest(publishRoot) {
  // publishRoot is the caller's own root argument (CLI --publish / a direct call, already disjointness-
  // checked elsewhere in rehydrate()), joined only with a hardcoded literal filename - never a
  // manifest-supplied or otherwise externally-controlled path segment.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const file = path.join(String(publishRoot), 'manifest.json');
  if (!fs.existsSync(file)) {
    throw new Error(`rehydrate: no publication manifest at ${file} - is --publish pointed at a real publication tree?`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// Chunk reassembly (shared by datasets and sources - both carry the same
// { index, compressedSha256, uncompressedSha256, file } chunk record shape)
// ---------------------------------------------------------------------------

/**
 * ROUND 6 FIX (path traversal, reproduced by a third-party review): resolve a
 * manifest-recorded, forward-slashed relative chunk path against
 * `publishRoot`, and refuse to return it unless it is still contained inside
 * `publishRoot` AFTER following every symlink/junction/reparse point on the
 * way there.
 *
 * `path.join` already collapses a `..` segment inside `relativePath` before
 * this function ever runs, so a crafted `chunk.file` like `../outside.gz`
 * resolves to a perfectly ordinary-looking absolute path outside
 * `publishRoot` - it will not itself contain `..`. The real-path containment
 * check below is what actually catches that (and additionally catches an
 * intermediate directory segment that was replaced by a reparse point
 * pointing outside `publishRoot`, which a purely string-level check could
 * never see). It reuses `isContainedIn` from `./lib/rootSafety` rather than a
 * hand-rolled `startsWith(root + path.sep)` - the exact class of bug a
 * separate finding this same review round found in that file's own drive-root
 * handling.
 *
 * In practice `relativePath` reaching this function is already fully
 * constrained (see `rehydrateChunkSet` below: it is DERIVED from a validated
 * dataset/source identity and a small validated integer index, never taken
 * from `chunk.file` as a free-form string), so this is defense in depth, not
 * the only thing standing between an attacker and a path outside
 * `publishRoot`.
 */
function resolveWithinPublishRoot({ publishRoot, relativePath, label }) {
  const segments = String(relativePath).split('/');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const joined = path.join(String(publishRoot), ...segments);
  if (!fs.existsSync(joined)) {
    throw new Error(`rehydrate: ${label} is missing from disk (expected ${joined})`);
  }
  const realFile = normalizeForCompare(fs.realpathSync.native(joined));
  // publishRoot is the caller's own root argument, resolved here purely for a real-path CONTAINMENT
  // comparison (see isContainedIn below) - not used to construct a path for reading or writing a file.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const realRoot = normalizeForCompare(fs.realpathSync.native(path.resolve(String(publishRoot))));
  if (realFile !== realRoot && !isContainedIn(realRoot, realFile)) {
    throw new Error(
      `rehydrate: ${label} resolves outside publishRoot once symlinks/junctions/reparse points are ` +
      `followed (real path ${realFile} is not inside publishRoot's real path ${realRoot}) - refusing to read it`
    );
  }
  return joined;
}

/**
 * Re-read every chunk in order from disk, verify its COMPRESSED bytes
 * against the recorded hash, gunzip it, verify the DECOMPRESSED bytes
 * against the recorded hash, and concatenate. Throws on the first mismatch
 * anywhere - a rehydration that cannot prove every chunk is exactly what the
 * manifest says it is has proven nothing.
 *
 * `expectedRelativePathFor(index)` derives the ONLY path this function will
 * ever read for a given chunk index, from the chunk set's own already-
 * validated identity (a dataset or source name, checked against
 * `store.assertDatasetName`'s bare-identifier allowlist by the caller) - never
 * from `chunk.file` as a free-form manifest-supplied string (round 6 fix). A
 * manifest whose `chunk.file` disagrees with the derived path is rejected: it
 * is either corrupt or has been tampered with, and trusting whichever of the
 * two an attacker chose to make consistent would defeat the point of deriving
 * the path independently in the first place.
 */
function rehydrateChunkSet({ publishRoot, chunks, label, expectedRelativePathFor }) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error(`rehydrate: ${label} has no chunks recorded in the manifest`);
  }
  const pieces = [];
  chunks.forEach((chunk, i) => {
    if (chunk.index !== i) {
      throw new Error(`rehydrate: ${label} chunk list is out of order at position ${i} (chunk.index=${chunk.index})`);
    }
    const expectedFile = expectedRelativePathFor(i);
    if (String(chunk.file) !== expectedFile) {
      throw new Error(
        `rehydrate: ${label} chunk ${i} records file ${JSON.stringify(chunk.file)} in the manifest, but ` +
        `its identity and index derive ${JSON.stringify(expectedFile)} - refusing to trust an arbitrary ` +
        "manifest-supplied path over the one this chunk set's own identity dictates"
      );
    }
    const chunkFile = resolveWithinPublishRoot({ publishRoot, relativePath: expectedFile, label: `${label} chunk ${i}` });
    const compressed = fs.readFileSync(chunkFile);
    if (sha256Hex(compressed) !== chunk.compressedSha256) {
      throw new Error(`rehydrate: ${label} chunk ${i} compressed bytes on disk do not match the manifest`);
    }
    const decompressed = gunzipVerified(compressed);
    if (sha256Hex(decompressed) !== chunk.uncompressedSha256) {
      throw new Error(`rehydrate: ${label} chunk ${i} decompressed to bytes that do not match the manifest`);
    }
    pieces.push(decompressed);
  });
  return Buffer.concat(pieces);
}

// ---------------------------------------------------------------------------
// Fixed, verbatim-copied provenance/receipt files (round 4, MEDIUM finding 2)
// ---------------------------------------------------------------------------

/**
 * Find `name`'s record in the publication manifest's `fixedFiles` array.
 * `package-snapshot.js` records `{ name, sha256, byteLength }` for exactly
 * the three files this module treats as authoritative, verbatim-copied
 * input (`source-manifest.json`, `sources-provenance.json`,
 * `dry-run-receipt.json`); a manifest missing this section entirely (an
 * older publication built before this fix) cannot be trusted to have had
 * these files integrity-checked at all, so this throws rather than silently
 * skipping the check.
 */
function findFixedFileRecord(manifest, name) {
  const record = (manifest.fixedFiles || []).find((f) => f.name === name);
  if (!record) {
    throw new Error(
      `rehydrate: no fixedFiles record for ${name} in the publication manifest - refusing to treat it as ` +
      'verified input. This publication may predate the fixedFiles hash-pinning fix; repackage it.'
    );
  }
  return record;
}

/**
 * Read one of the three fixed files from `publishRoot` and verify its bytes
 * against the manifest's `fixedFiles` entry BEFORE returning them - i.e.
 * before the caller ever writes anything derived from them anywhere. Same
 * fail-closed rigor as `rehydrateChunkSet` above: a mismatch throws, it is
 * never logged-and-continued.
 */
function readAndVerifyFixedFile({ publishRoot, manifest, name }) {
  const record = findFixedFileRecord(manifest, name);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const src = path.join(String(publishRoot), name);
  if (!fs.existsSync(src)) {
    throw new Error(`rehydrate: no ${name} in the publication tree at ${publishRoot}`);
  }
  const bytes = fs.readFileSync(src);
  const actualSha256 = sha256Hex(bytes);
  if (actualSha256 !== record.sha256) {
    throw new Error(
      `rehydrate: ${name} on disk (${src}) hashes to ${actualSha256}, the publication manifest's ` +
      `fixedFiles entry records ${record.sha256} - refusing to treat these bytes as the verified, ` +
      'pinned file, and refusing to write anything derived from them'
    );
  }
  if (bytes.length !== record.byteLength) {
    throw new Error(
      `rehydrate: ${name} is ${bytes.length} byte(s) on disk, the publication manifest's fixedFiles ` +
      `entry records ${record.byteLength} - refusing to treat these bytes as verified`
    );
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Datasets -> a drop-in stand-in for backtest-data/snapshot/
// ---------------------------------------------------------------------------

/**
 * Rehydrate every dataset the publication manifest lists into
 * `outSnapshotRoot`, using `snapshotStore.datasetFile`'s exact layout - so
 * anything that reads a snapshot through that module (loadDataset,
 * loadManifest, snapshot-checks.js, ...) treats the rehydrated directory
 * exactly like `backtest-data/snapshot/`.
 *
 * Writes the raw bytes directly (never re-serializing rows through
 * `canonicalJson`) so "rehydrated" means the literal original bytes, proven
 * byte-identical by hash, not merely "a JSON round-trip that SHOULD produce
 * the same bytes".
 */
function rehydrateDatasets({ publishRoot, manifest, outSnapshotRoot, sealedDatasets }) {
  const results = [];
  for (const entry of manifest.datasets || []) {
    // Validated BEFORE it is ever used to derive a chunk path (round 6 fix):
    // `store.assertDatasetName` enforces a bare lowercase identifier, so a
    // manifest-supplied `entry.dataset` can never itself carry a traversal
    // segment or path separator once it reaches `chunkManifestPath` below.
    const safeDataset = store.assertDatasetName(entry.dataset);
    const label = `dataset ${safeDataset}`;
    const bytes = rehydrateChunkSet({
      publishRoot,
      chunks: entry.chunks,
      label,
      expectedRelativePathFor: (i) => chunkManifestPath(safeDataset, chunkFileName(i)),
    });
    if (sha256Hex(bytes) !== entry.uncompressedSha256) {
      throw new Error(`rehydrate: ${label} reassembled bytes do not match the manifest's recorded uncompressedSha256`);
    }
    // ROUND 6 FIX (fourth review round), extended ROUND 6.5 RE-REVIEW (fifth
    // review round, seasonScoped): bind every rehydrated dataset's
    // identity/store/path/rowCount/byteLength/hash/seasonScoped to the SEALED
    // manifest's OWN datasets array (see `assertExactNameSets` in
    // `rehydrate()` for the companion "no dataset is silently
    // missing/extra/duplicated" check).
    // `assertExactNameSets` already guarantees a record exists for every
    // name this loop iterates, so `sealedDatasets.get(safeDataset)` is never
    // undefined here.
    const sealedRecord = sealedDatasets.get(safeDataset);
    if (entry.store !== sealedRecord.store) {
      throw new Error(`rehydrate: ${label} records store ${JSON.stringify(entry.store)}, the SEALED manifest pins ${JSON.stringify(sealedRecord.store)}`);
    }
    if (entry.path !== sealedRecord.path) {
      throw new Error(`rehydrate: ${label} records path ${JSON.stringify(entry.path)}, the SEALED manifest pins ${JSON.stringify(sealedRecord.path)}`);
    }
    if (Number(entry.rowCount) !== sealedRecord.rowCount) {
      throw new Error(`rehydrate: ${label} records rowCount ${entry.rowCount}, the SEALED manifest pins ${sealedRecord.rowCount}`);
    }
    // ROUND 6.5 RE-REVIEW FIX (fifth review round): seasonScoped was the one
    // dataset field written straight from the mutable publication manifest
    // into the rehydrated meta sidecar with no sealed check at all - a
    // flipped value rehydrated "successfully" and was only ever caught later,
    // downstream, by assertQuarantine/checkDatasets. Bound here so it fails
    // at the same boundary as every other dataset field, not later.
    if (Boolean(entry.seasonScoped) !== sealedRecord.seasonScoped) {
      throw new Error(`rehydrate: ${label} records seasonScoped ${JSON.stringify(Boolean(entry.seasonScoped))}, the SEALED manifest pins ${JSON.stringify(sealedRecord.seasonScoped)}`);
    }
    if (bytes.length !== sealedRecord.byteLength) {
      throw new Error(`rehydrate: ${label} is ${bytes.length} byte(s), the SEALED manifest pins ${sealedRecord.byteLength} byte(s)`);
    }
    if (sha256Hex(bytes) !== sealedRecord.sha256) {
      throw new Error(
        `rehydrate: ${label} reassembled bytes hash to ${sha256Hex(bytes)}, but the SEALED manifest ` +
        `independently pins ${sealedRecord.sha256} - the publication manifest.json may be internally ` +
        'self-consistent, but it does not match the sealed manifest it claims to reproduce'
      );
    }
    const file = store.datasetFile(outSnapshotRoot, entry.store, entry.path, entry.dataset);
    writeVerified(file, bytes, { label });
    const meta = {
      dataset: entry.dataset,
      store: entry.store,
      path: entry.path,
      seasonScoped: entry.seasonScoped,
      rowCount: entry.rowCount,
      sha256: entry.uncompressedSha256,
      byteLength: bytes.length,
    };
    fs.writeFileSync(
      store.metaFile(outSnapshotRoot, entry.store, entry.path, entry.dataset),
      `${store.canonicalJson(meta)}\n`,
      'utf8'
    );
    results.push({ dataset: entry.dataset, ok: true, rows: entry.rowCount, bytes: bytes.length });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Raw sources -> a drop-in stand-in for backtest-data/sources/
// ---------------------------------------------------------------------------

/**
 * Rehydrate every raw source the publication manifest lists into
 * `outSourcesDir`, named exactly as the original file (`roster_weekly_2024
 * .csv`, `games.csv`, ...) - so `snapshot-checks.js`'s `makeSourceReader`
 * can be pointed at `outSourcesDir` with no other setup, once
 * `provenance.json` is copied alongside it (see `rehydrate` below).
 *
 * `sealedSources` is the sealed Gate-2 `source-manifest.json`'s OWN `sources`
 * array (name -> { sha256, byteLength }), indexed by name - round 6 fix for
 * the "pinned-manifest trust bypass" finding. Before this fix, a rehydrated
 * source's bytes were only cross-checked against the PUBLICATION tree's own
 * `manifest.json` (`entry.uncompressedSha256`) and `sources-provenance.json`
 * (`entry.provenanceSha256`) - both of which an attacker who controls the
 * whole publish tree can edit consistently alongside a tampered chunk. Every
 * rehydrated source's bytes are now ALSO checked against `sealedSources`,
 * which comes from `source-manifest.json` - a file whose own bytes are
 * independently re-verified against the hardcoded `PINNED_SNAPSHOT_MANIFEST_
 * SHA256` constant (see `readAndParseSealedSourceManifest`) before this
 * function ever runs. An attacker can edit the mutable publish-tree files all
 * they like; they cannot also forge `source-manifest.json`'s pinned hash to
 * match fabricated content, because that hash does not live anywhere in the
 * tree they control.
 */
function rehydrateSources({ publishRoot, manifest, outSourcesDir, sealedSources }) {
  const results = [];
  for (const entry of manifest.sources || []) {
    const safeName = store.assertDatasetName(entry.name);
    const label = `source ${safeName}`;
    const bytes = rehydrateChunkSet({
      publishRoot,
      chunks: entry.chunks,
      label,
      expectedRelativePathFor: (i) => sourceChunkManifestPath(safeName, rawChunkFileName(i)),
    });
    if (sha256Hex(bytes) !== entry.uncompressedSha256) {
      throw new Error(`rehydrate: ${label} reassembled bytes do not match the manifest's recorded uncompressedSha256`);
    }
    if (sha256Hex(bytes) !== entry.provenanceSha256) {
      throw new Error(`rehydrate: ${label} reassembled bytes do not match the pinned provenance SHA-256`);
    }
    const sealedRecord = sealedSources.get(safeName);
    if (!sealedRecord) {
      throw new Error(
        `rehydrate: ${label}: the SEALED Gate-2 source-manifest.json has no record for this source - ` +
        'refusing to trust a source the sealed manifest never independently pinned'
      );
    }
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== sealedRecord.sha256) {
      throw new Error(
        `rehydrate: ${label} reassembled bytes hash to ${actualSha256}, but the SEALED Gate-2 ` +
        `source-manifest.json independently pins ${sealedRecord.sha256} for this source - the ` +
        "publication tree's own manifest.json and sources-provenance.json may have been tampered " +
        'with consistently, but they cannot forge this sealed, independently-verified record'
      );
    }
    if (bytes.length !== sealedRecord.byteLength) {
      throw new Error(
        `rehydrate: ${label} is ${bytes.length} byte(s), but the SEALED Gate-2 source-manifest.json ` +
        `independently pins ${sealedRecord.byteLength} byte(s) for this source`
      );
    }
    // ROUND 6 FIX (fourth review round, "changing the source filename ...
    // succeeds and omits the expected filename"): the FILENAME a source is
    // written under was never bound to anything sealed either - only its
    // bytes were. A publication manifest that renamed `entry.file` to
    // something else (still a safe, well-formed basename by
    // assertSafeSourceFile's own rules, just the WRONG one) would silently
    // write the rehydrated bytes under the wrong name.
    if (entry.file !== sealedRecord.file) {
      throw new Error(
        `rehydrate: ${label} records filename ${JSON.stringify(entry.file)} in the publication manifest, ` +
        `but the SEALED Gate-2 source-manifest.json independently pins ${JSON.stringify(sealedRecord.file)} ` +
        'for this source'
      );
    }
    const file = assertSafeSourceFile(entry.file, { label: entry.name });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const outFile = path.join(String(outSourcesDir), file);
    writeVerified(outFile, bytes, { label });
    results.push({ name: entry.name, ok: true, bytes: bytes.length });
  }
  return results;
}

/** Copy `sources-provenance.json` from the publication tree into the
 * rehydrated sources directory, named `provenance.json` - the same name and
 * shape `readProvenanceRecords`/`makeSourceReader` expect of
 * `backtest-data/sources/provenance.json`. Verified against the manifest's
 * `fixedFiles` entry before it is copied anywhere (round 4, MEDIUM finding 2). */
/**
 * ROUND 6 FIX (fourth review round, "changing a provenance record and its
 * mutable fixedFiles hash succeeds and copies bad provenance"): the fixedFile
 * hash check on `sources-provenance.json` only proves the file matches its
 * OWN recorded hash in the publication manifest - both of which live in the
 * same mutable, attacker-controlled tree and can be edited together. Nothing
 * previously inspected the CONTENT of the parsed records against anything
 * sealed. This does: every record's sha256/byteLength must agree with the
 * SEALED source-manifest.json's own sources array for that name.
 */
function verifyProvenanceAgainstSealedSources({ bytes, sealedSources }) {
  const doc = JSON.parse(bytes.toString('utf8'));
  const records = (doc && doc.records) || [];
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('rehydrate: sources-provenance.json carries no records - cannot verify it against the sealed manifest');
  }
  for (const record of records) {
    const name = String(record.name);
    const sealedRecord = sealedSources.get(name);
    if (!sealedRecord) continue; // a provenance record for a source outside the pinned SOURCES registry is not this check's concern
    if (String(record.sha256) !== sealedRecord.sha256) {
      throw new Error(
        `rehydrate: sources-provenance.json's record for ${name} has sha256 ${record.sha256}, but the ` +
        `SEALED source-manifest.json independently pins ${sealedRecord.sha256} for this source - the ` +
        'provenance record and its own fixedFiles hash may have been edited together, but neither can ' +
        'forge the sealed record'
      );
    }
    if (Number(record.byteLength) !== sealedRecord.byteLength) {
      throw new Error(
        `rehydrate: sources-provenance.json's record for ${name} has byteLength ${record.byteLength}, ` +
        `but the SEALED source-manifest.json independently pins ${sealedRecord.byteLength} byte(s)`
      );
    }
  }
}

function copyProvenanceIntoSources({ publishRoot, outSourcesDir, manifest, sealedSources }) {
  const bytes = readAndVerifyFixedFile({ publishRoot, manifest, name: SOURCES_PROVENANCE_FILENAME });
  verifyProvenanceAgainstSealedSources({ bytes, sealedSources });
  // outSourcesDir is rehydrate()'s own build-temp output root (disjointness-checked, created by this
  // process), joined only with a hardcoded literal filename - never externally-controlled.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  writeVerified(path.join(String(outSourcesDir), 'provenance.json'), bytes, { label: 'provenance.json (rehydrated)' });
}

/**
 * Read, verify, and PARSE `source-manifest.json` (the byte-exact sealed
 * snapshot manifest) - the round 6 fix moves this out of the try/build block
 * and up to before any temp/output directory exists, per the review's
 * required sequencing ("parse the pinned source manifest before creating
 * temporary/output directories"), and returns the parsed `sources` array as a
 * `name -> { sha256, byteLength }` map so `rehydrateSources` can bind every
 * rehydrated raw source to it (see that function's docblock).
 *
 * Verified against the manifest's `fixedFiles` entry, AND (round 4, MEDIUM
 * finding 2) independently re-verified against `expectedSourceManifestSha256`
 * - a SECOND, independent check that does not rely solely on the publication
 * manifest's own internal self-consistency for this one file, since it is
 * the one file with a real, externally pinned hash to check against
 * (`PINNED_SNAPSHOT_MANIFEST_SHA256` for a real production publication; a
 * fixture's own hash when a test legitimately overrides it, mirroring
 * exactly how `package-snapshot.js`'s own `expectedManifestSha256` works).
 */
function readAndParseSealedSourceManifest({ publishRoot, manifest, expectedSourceManifestSha256 }) {
  const bytes = readAndVerifyFixedFile({ publishRoot, manifest, name: SOURCE_MANIFEST_FILENAME });
  if (expectedSourceManifestSha256) {
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== expectedSourceManifestSha256) {
      throw new Error(
        `rehydrate: ${SOURCE_MANIFEST_FILENAME} hashes to ${actualSha256}, the independently pinned ` +
        `expectedSourceManifestSha256 (${expectedSourceManifestSha256}) does not match - refusing to ` +
        'treat these bytes as the sealed Gate-2 manifest they claim to be'
      );
    }
  }
  const parsed = JSON.parse(bytes.toString('utf8'));
  // sealedSources/sealedDatasets are built (and structurally validated - see
  // lib/sealedManifest.js) from the SEALED manifest's own arrays, never from
  // anything in the mutable publication manifest.json - the one anchor an
  // attacker who only controls the publish tree cannot forge.
  const sealedSources = buildSealedSourcesMap(parsed.sources, { label: `sealed ${SOURCE_MANIFEST_FILENAME}` });
  const sealedDatasets = buildSealedDatasetsMap(parsed.datasets, { label: `sealed ${SOURCE_MANIFEST_FILENAME}` });
  return { bytes, parsed, sealedSources, sealedDatasets };
}

/** Write the already-verified `source-manifest.json` bytes (see
 * `readAndParseSealedSourceManifest`) into the rehydrated snapshot directory
 * as `manifest.json` - `store.loadManifest` expects that exact filename at
 * the store root. Takes already-verified bytes rather than re-reading and
 * re-verifying, so the verification and the write can never drift apart. */
function writeSealedSourceManifestIntoSnapshot({ outSnapshotRoot, bytes }) {
  writeVerified(store.manifestFile(outSnapshotRoot), bytes, { label: 'manifest.json (rehydrated)' });
}

/** Copy `dry-run-receipt.json` into the rehydrated snapshot directory, since
 * `store.receiptFile` looks for it at the store root (not every reader needs
 * it, but nothing here should be missing a file the real snapshot carries).
 * Verified against the manifest's `fixedFiles` entry before it is copied
 * anywhere (round 4, MEDIUM finding 2). */
function copyReceiptIntoSnapshot({ publishRoot, outSnapshotRoot, manifest }) {
  const bytes = readAndVerifyFixedFile({ publishRoot, manifest, name: 'dry-run-receipt.json' });
  writeVerified(store.receiptFile(outSnapshotRoot), bytes, { label: 'dry-run-receipt.json (rehydrated)' });
}

// ---------------------------------------------------------------------------
// Atomicity: build to temp, then promote (round 4 BLOCKER fix) - mirrors
// package-snapshot.js's own assertPublishRootAbsentForPromote, generalized
// for two output roots instead of one.
// ---------------------------------------------------------------------------

/**
 * Refuse to promote a completed build over an already-existing, NON-EMPTY
 * output directory. An EMPTY pre-existing directory is tolerated (and
 * silently removed immediately before the rename) rather than rejected - a
 * caller creating an empty placeholder directory ahead of time (every
 * existing test in this tree's suite does exactly this via a `tmpDir()`
 * helper) has nothing in it to clobber, unlike a directory that already
 * holds real content.
 *
 * DELIBERATE, PERMANENT DIVERGENCE from `package-snapshot.js`'s own
 * `assertPublishRootAbsentForPromote`, which refuses ANY pre-existing
 * `publishRoot` regardless of emptiness. That stricter rule exists because
 * `publishRoot` is the eventual GIT-STAGED artifact - an operator's own
 * leftover empty directory there is still worth surfacing rather than
 * silently absorbing. `outSnapshotRoot`/`outSourcesDir` here are throwaway
 * reproducibility-proof targets (a temp dir, a test fixture, a scratch
 * directory a caller mkdir'd moments before calling this function) with no
 * git/publication significance, and the initial `assertRootsDisjoint` call
 * at the top of `rehydrate()` already ran against this exact path before any
 * expensive work started - an empty directory has nothing in it a later
 * write could destroy. Reviewed and confirmed not exploitable (round 5
 * adversarial review, live-tested); kept intentionally rather than tightened
 * to match `package-snapshot.js`, to avoid forcing every caller (test or
 * real) to pass a path that must not yet exist at all.
 */
function assertOutputRootAbsentForPromote(dir, label, buildDir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir);
  if (entries.length > 0) {
    throw new Error(
      `rehydrate: ${label} (${dir}) already exists and is not empty - refusing to silently delete or ` +
      'overwrite it at promotion time. Move or remove the existing directory yourself, then re-run ' +
      'rehydration; the freshly built, fully verified output is still intact and has NOT been deleted ' +
      `- it is sitting at ${buildDir} until you do.`
    );
  }
}

// ---------------------------------------------------------------------------
// The rehydrator
// ---------------------------------------------------------------------------

/**
 * Rehydrate a Gate-3 publication tree into a fresh snapshot directory and a
 * fresh sources directory. `outSnapshotRoot` and `outSourcesDir` are
 * mandatory (never defaulted onto the real `backtest-data/snapshot/` or
 * `backtest-data/sources/` - this is a materialization tool, and writing its
 * output over the sealed originals would be exactly the mistake
 * `package-snapshot.js`'s `assertDisjointRoots` exists to prevent on the
 * OTHER side of this same pipeline).
 *
 * Both outputs are built into fresh temporary sibling directories first (of
 * `outSnapshotRoot`/`outSourcesDir` respectively), fully verified there, and
 * only renamed (`fs.renameSync`) into place on complete success - see the
 * module docblock's "ROUND 4 REVIEW" section. A build-phase failure cleans
 * up both temp directories, so the real `outSnapshotRoot`/`outSourcesDir`
 * are NEVER written to at all unless every check has already passed; a
 * promote-time conflict (either destination already non-empty) leaves both
 * fully-built temp directories on disk, named in the thrown error. The two
 * promoting renames themselves are NOT one atomic operation - see the module
 * docblock's "PROMOTING TWO OUTPUTS IS NOT ONE ATOMIC OPERATION" section for
 * the compensating-rollback mechanism that stands in for that, and its own
 * limit.
 *
 * `expectedSourceManifestSha256` defaults to the real, pinned production
 * constant (`PINNED_SNAPSHOT_MANIFEST_SHA256`); pass a fixture's own hash in
 * a test, exactly mirroring how `package-snapshot.js`'s own
 * `expectedManifestSha256` parameter works.
 *
 * Returns `{ manifest, datasetResults, sourceResults }`. Throws on any hash
 * mismatch, missing chunk, root collision, or missing top-level publication
 * file.
 */
function rehydrate({
  publishRoot = DEFAULT_PUBLISH_DIR,
  outSnapshotRoot,
  outSourcesDir,
  expectedSourceManifestSha256 = PINNED_SNAPSHOT_MANIFEST_SHA256,
  log = () => {},
}) {
  if (!outSnapshotRoot) throw new Error('rehydrate: outSnapshotRoot is required');
  if (!outSourcesDir) throw new Error('rehydrate: outSourcesDir is required');

  // --- the collision guard is FIRST: before any read (including the
  //     manifest read below) and before any write. Covers all THREE roots -
  //     the input publishRoot, and BOTH outputs - pairwise, using the exact
  //     same hardened, shared logic package-snapshot.js uses for its own
  //     two roots (round 4 BLOCKER fix; see the module docblock).
  assertRootsDisjoint([
    { name: 'publishRoot', path: publishRoot },
    { name: 'outSnapshotRoot', path: outSnapshotRoot },
    { name: 'outSourcesDir', path: outSourcesDir },
  ]);

  const manifest = readPublicationManifest(publishRoot);
  log(`rehydrating publication for ${manifest.sourceSnapshot && manifest.sourceSnapshot.studyId}`);

  // --- parse the sealed Gate-2 source-manifest.json BEFORE any temp/output
  //     directory exists (round 6 fix, per the review's required sequencing).
  //     Its bytes are independently verified (against manifest.fixedFiles AND
  //     the hardcoded PINNED_SNAPSHOT_MANIFEST_SHA256 constant) here, and its
  //     `sources` array is what `rehydrateSources` below binds every raw
  //     source's hash to - see readAndParseSealedSourceManifest's docblock.
  const sealedSourceManifest = readAndParseSealedSourceManifest({ publishRoot, manifest, expectedSourceManifestSha256 });

  // --- exact-set equality, BEFORE creating any temp/output directory (round
  //     6 fix, fourth review round): per-entry binding (below, in
  //     rehydrateDatasets/rehydrateSources) only checks entries that are
  //     ACTUALLY LISTED in the publication manifest.json. A manifest.json
  //     that simply OMITS a dataset or source entry entirely is never
  //     iterated by either loop, so nothing previously noticed the omission -
  //     rehydration would "succeed" having silently reproduced fewer than the
  //     sealed manifest's real set. Checked here, against the in-memory name
  //     lists alone, before either loop ever runs.
  assertExactNameSets({
    sealedNames: [...sealedSourceManifest.sealedDatasets.keys()],
    candidateNames: (manifest.datasets || []).map((d) => d.dataset),
    kind: 'dataset',
    label: 'rehydrate',
  });
  assertExactNameSets({
    sealedNames: [...sealedSourceManifest.sealedSources.keys()],
    candidateNames: (manifest.sources || []).map((s) => s.name),
    kind: 'source',
    label: 'rehydrate',
  });

  // --- build BOTH outputs into fresh temp sibling directories first --------
  fs.mkdirSync(path.dirname(outSnapshotRoot), { recursive: true });
  fs.mkdirSync(path.dirname(outSourcesDir), { recursive: true });
  // outSnapshotRoot/outSourcesDir are the caller's own output arguments (already disjointness-checked
  // above); each dirname is joined only with a hardcoded literal prefix constant, then handed to
  // mkdtempSync, which appends its own random suffix - never an externally-controlled path segment.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const buildSnapshotRoot = fs.mkdtempSync(path.join(path.dirname(outSnapshotRoot), TEMP_REHYDRATE_SNAPSHOT_PREFIX));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const buildSourcesDir = fs.mkdtempSync(path.join(path.dirname(outSourcesDir), TEMP_REHYDRATE_SOURCES_PREFIX));
  // Defense in depth, re-run directly against the ACTUAL temp paths (the
  // same reasoning package-snapshot.js applies to its own buildRoot re-check):
  // a sibling of something already proven disjoint from publishRoot cannot
  // itself collide with it, but the cost of re-checking is negligible.
  assertRootsDisjoint([
    { name: 'publishRoot', path: publishRoot },
    { name: 'buildSnapshotRoot', path: buildSnapshotRoot },
    { name: 'buildSourcesDir', path: buildSourcesDir },
  ]);

  let datasetResults;
  let sourceResults;
  try {
    datasetResults = rehydrateDatasets({
      publishRoot, manifest, outSnapshotRoot: buildSnapshotRoot, sealedDatasets: sealedSourceManifest.sealedDatasets,
    });
    log(`  rehydrated ${datasetResults.length} dataset(s)`);
    writeSealedSourceManifestIntoSnapshot({ outSnapshotRoot: buildSnapshotRoot, bytes: sealedSourceManifest.bytes });
    copyReceiptIntoSnapshot({ publishRoot, outSnapshotRoot: buildSnapshotRoot, manifest });

    sourceResults = rehydrateSources({
      publishRoot, manifest, outSourcesDir: buildSourcesDir, sealedSources: sealedSourceManifest.sealedSources,
    });
    log(`  rehydrated ${sourceResults.length} source(s)`);
    copyProvenanceIntoSources({
      publishRoot, outSourcesDir: buildSourcesDir, manifest, sealedSources: sealedSourceManifest.sealedSources,
    });
  } catch (err) {
    // A build-phase failure never touches the real outputs at all - only
    // clean up the temp directories so neither is left behind, mirroring
    // package-snapshot.js's own build-failure cleanup exactly.
    try { fs.rmSync(buildSnapshotRoot, { recursive: true, force: true }); } catch (_cleanupErr) { /* ignore */ }
    try { fs.rmSync(buildSourcesDir, { recursive: true, force: true }); } catch (_cleanupErr) { /* ignore */ }
    throw err;
  }

  // --- promote: only now, only on complete success --------------------------
  // Both destinations are checked BEFORE either is renamed, so a PRE-EXISTING-
  // directory conflict on the second destination can never leave the
  // operation half-promoted (the first output already renamed into place,
  // the second still pending) - see `assertOutputRootAbsentForPromote` above.
  // The two renames THEMSELVES are not one atomic operation (see the
  // "ROUND 6 FIX" comment below for exactly what compensates for that, and
  // its own limit).
  //
  // Re-run the disjointness check one last time, immediately before promote,
  // against the REAL output roots (not just the temp build dirs, which were
  // already re-checked when they were created above) - closing the narrow
  // TOCTOU window a round-5 adversarial review flagged between the initial
  // check (before the potentially long dataset/source rehydration work) and
  // the actual renames. No exploit was found (this tool has no concurrent
  // writers in its own single-operator, no-network threat model), but the
  // re-check is nearly free and removes the gap rather than documenting it.
  assertRootsDisjoint([
    { name: 'publishRoot', path: publishRoot },
    { name: 'outSnapshotRoot', path: outSnapshotRoot },
    { name: 'outSourcesDir', path: outSourcesDir },
  ]);
  assertOutputRootAbsentForPromote(outSnapshotRoot, 'outSnapshotRoot', buildSnapshotRoot);
  assertOutputRootAbsentForPromote(outSourcesDir, 'outSourcesDir', buildSourcesDir);
  // An empty pre-existing directory is tolerated (see
  // assertOutputRootAbsentForPromote) but fs.renameSync onto an existing
  // directory is not portable across platforms, so both empty placeholders
  // are removed BEFORE either rename - neither removal can destroy anything
  // (assertOutputRootAbsentForPromote already proved both are empty), and
  // doing both up front means the two renames below are the only remaining
  // steps that can fail.
  if (fs.existsSync(outSnapshotRoot)) fs.rmdirSync(outSnapshotRoot);
  if (fs.existsSync(outSourcesDir)) fs.rmdirSync(outSourcesDir);

  // ROUND 6 FIX (promotion is not atomic, reproduced by a third-party review):
  // two independent fs.renameSync calls can never be one atomic operation
  // across two unrelated destination paths, and this does NOT make them one -
  // it is a BEST-EFFORT COMPENSATING ROLLBACK, not true atomicity. A failure
  // of the SECOND rename triggers an attempt to rename the FIRST output back
  // to its pre-promote temp path. Two outcomes follow, and only one of them
  // is "nothing left half-promoted":
  //   - the rollback rename SUCCEEDS: outSnapshotRoot is back at its
  //     pre-promote temp path, outSourcesDir was never promoted, and nothing
  //     is left half-promoted;
  //   - the rollback rename ALSO FAILS (e.g. the same underlying condition
  //     that failed the second rename - disk full, a revoked permission -
  //     just as easily fails the rollback): outSnapshotRoot is LEFT PROMOTED
  //     while outSourcesDir is not, and the thrown error says so explicitly,
  //     naming exactly what a human needs to clean up by hand. This branch is
  //     a real, reachable outcome, not a defensive-programming formality -
  //     do not describe this mechanism as guaranteeing "nothing is ever left
  //     half-promoted" without that caveat.
  fs.renameSync(buildSnapshotRoot, outSnapshotRoot);
  try {
    fs.renameSync(buildSourcesDir, outSourcesDir);
  } catch (err) {
    try {
      fs.renameSync(outSnapshotRoot, buildSnapshotRoot);
    } catch (rollbackErr) {
      throw new Error(
        `rehydrate: promoting outSourcesDir failed (${err.message}), and rolling back the already-` +
        `promoted outSnapshotRoot failed too (${rollbackErr.message}) - manual cleanup required: ` +
        `outSnapshotRoot (${outSnapshotRoot}) now holds the rehydrated snapshot, but outSourcesDir was ` +
        `never promoted and the fully-built sources tree is still sitting at ${buildSourcesDir}.`
      );
    }
    throw new Error(
      `rehydrate: promoting outSourcesDir failed (${err.message}) - outSnapshotRoot was successfully ` +
      `rolled back to its pre-promote state (back at ${buildSnapshotRoot}) in THIS instance, so nothing ` +
      'was left half-promoted this time. Retry once the underlying issue (permissions, disk space, a ' +
      'cross-device rename, ...) is resolved.'
    );
  }

  return { manifest, datasetResults, sourceResults };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * ROUND 6 FIX ("missing CLI values restore real defaults", reproduced by a
 * third-party review): a trailing `--publish` with nothing after it used to
 * set `args.publish = argv[++i]`, i.e. `undefined` - and `undefined` silently
 * satisfies destructuring defaults downstream (`publishRoot = DEFAULT_PUBLISH
 * _DIR` in `rehydrate()`), so a malformed invocation silently fell back to
 * acting on the REAL, default publication tree instead of failing loudly.
 * This also rejects a value that is itself another flag (`--publish
 * --out-snapshot`), which a plain `undefined` check would miss.
 */
function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
    throw new Error(
      `rehydrate: ${flagName} requires a value ` +
      `(got ${value === undefined ? 'nothing' : JSON.stringify(value)})`
    );
  }
  return value;
}

function parseArgs(argv) {
  const args = { publish: DEFAULT_PUBLISH_DIR, outSnapshot: null, outSources: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--publish') { args.publish = requireFlagValue(argv, ++i, '--publish'); }
    else if (token === '--out-snapshot') { args.outSnapshot = requireFlagValue(argv, ++i, '--out-snapshot'); }
    else if (token === '--out-sources') { args.outSources = requireFlagValue(argv, ++i, '--out-sources'); }
    else throw new Error(`unknown argument ${token}`);
  }
  if (!args.outSnapshot || !args.outSources) {
    throw new Error('rehydrate: --out-snapshot and --out-sources are both required');
  }
  return args;
}

/**
 * `deps.expectedSourceManifestSha256` is an optional test-only override
 * (mirrors `package-snapshot.js`'s own CLI-level `main(argv, deps)`, whose
 * tests inject `deps.normalizeTeamKey`/`deps.readSource` the same way): the
 * real `if (require.main === module)` invocation below never supplies one, so
 * a real run always independently re-checks `source-manifest.json` against
 * the real pinned production constant.
 */
function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const log = deps.log || console.log;
  const result = rehydrate({
    publishRoot: args.publish,
    outSnapshotRoot: args.outSnapshot,
    outSourcesDir: args.outSources,
    ...(deps.expectedSourceManifestSha256 ? { expectedSourceManifestSha256: deps.expectedSourceManifestSha256 } : {}),
    log,
  });
  log(`rehydration complete: ${result.datasetResults.length} dataset(s), ${result.sourceResults.length} source(s)`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  TEMP_REHYDRATE_SNAPSHOT_PREFIX,
  TEMP_REHYDRATE_SOURCES_PREFIX,
  readPublicationManifest,
  resolveWithinPublishRoot,
  rehydrateChunkSet,
  findFixedFileRecord,
  readAndVerifyFixedFile,
  rehydrateDatasets,
  rehydrateSources,
  verifyProvenanceAgainstSealedSources,
  copyProvenanceIntoSources,
  readAndParseSealedSourceManifest,
  writeSealedSourceManifestIntoSnapshot,
  copyReceiptIntoSnapshot,
  assertOutputRootAbsentForPromote,
  requireFlagValue,
  rehydrate,
  parseArgs,
  main,
};
