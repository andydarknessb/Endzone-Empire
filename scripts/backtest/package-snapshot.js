/* eslint-disable no-console */
'use strict';

/**
 * Gate-3 publication packager: turns the frozen Gate-2 snapshot at
 * `backtest-data/snapshot/` (read-only input, never modified) into a
 * publication staging tree at `backtest-data/publish/` - deterministic,
 * timestamp-free gzip chunks, closed-schema and secret-scan verification,
 * a reconstruction proof, and an explicit staged-file list, with no `git`
 * command ever executed by this file.
 *
 * This packager ships TWO things, not one: the derived, chunked evaluation
 * datasets under `chunks/` (unchanged from the first Gate-3 review round),
 * AND, as of the second review round, byte-exact archival copies of the ten
 * pinned raw source CSVs under `sources/`. A second, independent review found
 * that the first publication could not reproduce the study from a genuinely
 * clean clone, because `cohort.js`/`asOfView.js` need those raw CSVs (the
 * weekly rosters, injury reports, player/team weekly stats, and the
 * gsis<->espn crosswalk) and only one of the ten (`games.csv`, and only as a
 * lossy derived NDJSON projection that drops both score columns) had any
 * representation in the publication at all. `sources/` closes that gap by
 * shipping the actual pinned bytes, chunked and reconstructible, alongside
 * `source-manifest.json` (the full sealed Gate-2 manifest) and
 * `sources-provenance.json` (the Phase-0 fetch provenance table), which
 * `scripts/backtest/rehydrate.js` uses to materialize a drop-in stand-in for
 * both `backtest-data/snapshot/` and `backtest-data/sources/` from the
 * publication tree alone, with no network access.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * Like every other file under `scripts/backtest/`, this module requires no
 * `server/modules/pool`, no `server/services/*`, and reads no
 * `process.env` (see `server/test/backtestSourceFetch.test.js`, "the
 * Phase-0 fetch tree never reaches a database" - that test walks this whole
 * directory and would fail if this file broke the rule). The real
 * `normalizeTeamKey` this module needs for the teamContradictions check is
 * INJECTED, exactly like `extract-snapshot.js` and `snapshot-checks.js`
 * already inject it; the wiring that supplies the real one lives in
 * `server/scripts/run-backtest-package.js`, the one file allowed to hold
 * both halves.
 *
 * WHY normalizeTeamKey AND readSource ARE MANDATORY HERE, NOT OPTIONAL
 *
 * `snapshot-checks.checkTeamContradictions` intentionally reports a passing
 * "skipped: no normalizeTeamKey injected" result when it is not given one -
 * that is correct FOR THAT FILE, whose CLI is also runnable in modes that do
 * not care about team contradictions. But a Gate-3 review found that this
 * left every REAL invocation of the checker silently skipping the
 * roster-vs-gameTeam comparison, because nothing wired the real
 * `normalizeTeamKey` in for an actual run - the check was correct and
 * tested, but nothing ever really called it. This packager closes that gap
 * the only way that cannot regress silently again: `packageSnapshot` REFUSES
 * to run at all without both `readSource` and `normalizeTeamKey`, and
 * additionally refuses if the check nonetheless reports "skipped" (which
 * would mean this file's own wiring broke, not the caller's). The same
 * "refuse rather than silently skip" discipline applies to `sourcesDir` and
 * `provenancePath`: sources are now a mandatory part of what Gate 3
 * publishes, so packaging that cannot find or verify them must abort, not
 * quietly publish `chunks/` alone again.
 *
 * WHAT "PACKAGING VERIFICATION" MEANS HERE
 *
 * Independent guards run over the loaded (already digest-verified) snapshot
 * rows, and separately over the raw source bytes, before anything is
 * written:
 *   1. closed-schema validation (`schemaGuard` + `publicationSchema`) -
 *      every key and value shape must be on the sealed per-dataset
 *      allowlist;
 *   2. the `external_id`-only-in-players ruling, checked directly against
 *      the actual rows, not only against the schema;
 *   3. the value-level secret/contact scan (`secretScan`), run over both the
 *      dataset rows AND the parsed rows of every raw source CSV;
 *   4. the real roster-vs-gameTeam team-contradiction count
 *      (`snapshot-checks.checkTeamContradictions`, for real);
 *   5. every raw source file's bytes hash to the pinned SHA-256 in
 *      `provenance.json` (and, for `games.csv` specifically, ALSO to the
 *      independently hardcoded `GAMES_CSV_SHA256` constant).
 * Any of 1, 2, 3, or 5 finding a problem ABORTS THE ENTIRE RUN before a
 * single chunk is written - fail closed, per the user's binding
 * requirement, and this now covers datasets and sources as ONE coherent
 * run, not two disconnected passes. The fourth is a REPORTED metric by
 * design (preregistration section 4.1: the roster file is authoritative, a
 * contradiction is never used to exclude), so a nonzero count does not abort
 * packaging - it is recorded in `verification.json` in full, precisely so a
 * human reviewing that file cannot miss it.
 *
 * Only after every dataset AND every source passes are chunks written, and
 * only after every chunk is written does the reconstruction proof run: every
 * chunk is independently re-read from disk, gunzipped, reassembled in order,
 * and byte-compared against the ORIGINAL bytes (also freshly re-read from
 * disk) - see `reconstructAndVerify` (datasets) and
 * `reconstructAndVerifySources` (raw sources).
 *
 * ATOMICITY: BUILD TO A TEMP DIRECTORY, THEN PROMOTE
 *
 * Everything above is built into a fresh temporary directory next to
 * `publishRoot`, and the full verification/reconstruction proof runs against
 * THAT temp tree. Only on complete success is it atomically renamed into
 * place as `publishRoot`. If `publishRoot` already exists at that point,
 * packaging refuses to silently delete or overwrite it - this is local
 * operator tooling, not a service that races with itself, so a human decides
 * what to do with a pre-existing publish directory, not this script - and
 * the refusal names the exact temp-directory path the fully-built,
 * fully-verified publication was left at, so a human does not have to guess
 * the `.tmp-package-*` naming convention and search for it. Each such
 * conflicting run leaves one more full publication tree on disk forever, so
 * `packageSnapshot` also scans for and warns (never aborts) about any
 * already-leaked `.tmp-package-*` siblings near the very start of a run,
 * before the expensive build work - see `warnAboutLeakedTempDirs`.
 */

const fs = require('fs');
const path = require('path');

const store = require('./lib/snapshotStore');
const { sha256Hex, writeVerified, readProvenanceRecords } = require('./lib/verifiedBytes');
const { chunkNdjson, chunkFileName, countNdjsonLines, DEFAULT_CHUNK_TARGET_BYTES } = require('./lib/chunker');
const {
  chunkRawBytes, rawChunkFileName, DEFAULT_TARGET_BYTES: DEFAULT_RAW_CHUNK_TARGET_BYTES,
} = require('./lib/rawByteChunker');
const { gzipDeterministic, gunzipVerified, FIXED_OS_BYTE, DEFAULT_LEVEL } = require('./lib/deterministicGzip');
const { assertNoSecrets, assertNoSecretsInText } = require('./lib/secretScan');
const { assertClosedSchema } = require('./lib/schemaGuard');
const {
  schemaForDataset,
  assertNoExternalIdOutsidePlayers,
} = require('./lib/publicationSchema');
const { parseCsvRecords } = require('./lib/csv');
const { SOURCES, assertSafeSourceFile, GAMES_CSV_SHA256 } = require('./lib/sources');
const {
  canonicalizeForCompare, normalizeForCompare, assertNotUncFormPath, isContainedIn, assertRootsDisjoint,
} = require('./lib/rootSafety');
const { buildSealedSourcesMap } = require('./lib/sealedManifest');
const checks = require('./snapshot-checks');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_DIR = path.join(REPO_ROOT, 'backtest-data', 'snapshot');
const DEFAULT_PUBLISH_DIR = path.join(REPO_ROOT, 'backtest-data', 'publish');
const DEFAULT_SOURCES_DIR = path.join(REPO_ROOT, 'backtest-data', 'sources');
const DEFAULT_PROVENANCE_PATH = path.join(DEFAULT_SOURCES_DIR, 'provenance.json');

/**
 * The filenames the full sealed snapshot manifest and the sources
 * provenance table are published under. Named constants (not inlined at
 * every call site) because `rehydrate.js` has to agree with this file on
 * exactly these two names, and a typo in one place with no shared constant
 * would silently break rehydration instead of failing to load.
 */
const SOURCE_MANIFEST_FILENAME = 'source-manifest.json';
const SOURCES_PROVENANCE_FILENAME = 'sources-provenance.json';

/**
 * The `fs.mkdtempSync` prefix every packaging build directory is created
 * under (see the `buildRoot` line in `packageSnapshot` below). Named once so
 * `warnAboutLeakedTempDirs` and the mkdtemp call itself cannot drift apart -
 * a hardcoded string in one place and a copy-pasted literal in the other
 * would silently stop matching if either ever changed.
 */
const TEMP_BUILD_DIR_PREFIX = '.tmp-package-';

/**
 * The sha256 of the Gate-2 snapshot manifest this packager was built to
 * publish, as recorded in the sealed Gate-2 handoff. `packageSnapshot`
 * refuses to run against ANY OTHER snapshot manifest unless a caller
 * explicitly overrides `expectedManifestSha256` (which every test fixture
 * below does, with the fixture's OWN real hash - the override exists for
 * legitimate non-production snapshots, never as a way to skip the check).
 */
const PINNED_SNAPSHOT_MANIFEST_SHA256 =
  '2896872ba583fffbd8bacc089b0615365feee30bb60ec06e78afd090b0eda855';

// ---------------------------------------------------------------------------
// Safe path construction (mirrors snapshotStore.datasetFile's containment
// proof - see that function's comment for why the nosemgrep pins are there)
// ---------------------------------------------------------------------------

/**
 * `canonicalizeForCompare`, `normalizeForCompare`, `assertNotUncFormPath`, and
 * the underlying pairwise-disjointness logic all now live in
 * `./lib/rootSafety.js` (round 4): `rehydrate.js` needed the EXACT same
 * collision-detection rigor this file already hardened twice
 * (case-alias-proof, UNC-alias-proof), for a THIRD root (its two outputs plus
 * its input `publishRoot`) rather than the two this file compares - sharing
 * one implementation is what makes it structurally impossible for the two
 * files to drift back out of sync, instead of `rehydrate.js` reinventing a
 * second, weaker copy (which is exactly what happened before this fix).
 *
 * `assertDisjointRoots` below is a thin two-argument wrapper preserving the
 * exact call shape and message ordering every existing caller/test already
 * depends on; `packageSnapshot` itself now calls the shared
 * `assertRootsDisjoint` directly with THREE named roots (`snapshotRoot`,
 * `publishRoot`, `sourcesDir` - round 4, MEDIUM finding 3: `sourcesDir` was
 * previously never checked against either of the other two roots at all).
 */
function assertDisjointRoots(snapshotRoot, publishRoot) {
  return assertRootsDisjoint([
    { name: 'snapshotRoot', path: snapshotRoot },
    { name: 'publishRoot', path: publishRoot },
  ]);
}

function chunkDir(publishRoot, dataset) {
  const safeName = store.assertDatasetName(dataset);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const dir = path.join(String(publishRoot), 'chunks', safeName);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolvedRoot = path.resolve(String(publishRoot));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  if (!path.resolve(dir).startsWith(resolvedRoot + path.sep)) {
    throw new Error(`refusing a publish path outside the publish root: ${dir}`);
  }
  return dir;
}

/** The chunk's path as recorded in the manifest: always forward-slashed,
 * relative to the publish root, regardless of host OS. */
function chunkManifestPath(dataset, fileName) {
  return `chunks/${dataset}/${fileName}`;
}

/**
 * The raw-source counterpart of `chunkDir`/`chunkManifestPath`: sources live
 * under `sources/<name>/` rather than `chunks/<dataset>/`, so the two trees
 * can never be confused for one another even by directory name alone.
 * Source names (`roster_weekly_2024`, `games`, `players`, ...) happen to
 * satisfy the exact same "bare lowercase identifier" shape `snapshotStore`
 * requires of a dataset name, so `store.assertDatasetName` is reused rather
 * than duplicating an identical regex for a second registry.
 */
function sourceChunkDir(publishRoot, sourceName) {
  const safeName = store.assertDatasetName(sourceName);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const dir = path.join(String(publishRoot), 'sources', safeName);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolvedRoot = path.resolve(String(publishRoot));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  if (!path.resolve(dir).startsWith(resolvedRoot + path.sep)) {
    throw new Error(`refusing a publish path outside the publish root: ${dir}`);
  }
  return dir;
}

function sourceChunkManifestPath(sourceName, fileName) {
  return `sources/${sourceName}/${fileName}`;
}

// ---------------------------------------------------------------------------
// Per-dataset verification (schema, external_id, secrets) - no writes
// ---------------------------------------------------------------------------

/**
 * Load every dataset the source manifest lists, verify its digest against
 * the manifest (via `store.loadDataset`), then run the three fail-closed
 * content guards. Returns the loaded rows (for the chunking pass) plus the
 * three guards' own result records (for `verification.json`).
 *
 * Fails on the FIRST violation of any guard - "abort the run", not "collect
 * every problem and decide later".
 */
function verifyDatasets({ snapshotRoot, manifest, log }) {
  const loadedByDataset = new Map();
  const schemaResults = [];
  const externalIdResults = [];
  const secretScanResults = [];
  for (const entry of manifest.datasets) {
    const { rows } = store.loadDataset({
      root: snapshotRoot,
      store: entry.store,
      path: entry.path,
      dataset: entry.dataset,
      expectedSha256: entry.sha256,
    });
    schemaResults.push(assertClosedSchema(rows, schemaForDataset(entry.dataset), entry.dataset));
    externalIdResults.push(assertNoExternalIdOutsidePlayers(entry.dataset, rows));
    secretScanResults.push(assertNoSecrets(rows, entry.dataset));
    loadedByDataset.set(entry.dataset, rows);
    log(`  verified ${entry.dataset}: schema ok, external_id rule ok, secret scan 0 hits`);
  }
  return { loadedByDataset, schemaResults, externalIdResults, secretScanResults };
}

/**
 * Run the REAL roster-vs-gameTeam contradiction check - never skipped. See
 * the module docblock for why this refuses outright rather than degrading.
 */
function runRealTeamContradictions({ readSource, normalizeTeamKey, manifest }) {
  if (typeof readSource !== 'function') {
    throw new Error(
      'packageSnapshot: readSource is required so the roster-vs-gameTeam contradiction check runs ' +
      'for real - packaging must never silently skip it'
    );
  }
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error(
      'packageSnapshot: normalizeTeamKey is required so the roster-vs-gameTeam contradiction check ' +
      'runs for real - packaging must never silently skip it'
    );
  }
  const seasons = (manifest.seasons || []).map(Number);
  const result = checks.checkTeamContradictions({ readSource, normalizeTeamKey, seasons });
  // Keyed off the structural `skipped` flag, not a substring match on
  // `detail` text - the wording is snapshot-checks.js's to change, and a
  // packager that only recognized one exact phrase would silently stop
  // catching this the next time that wording did.
  if (result.skipped) {
    throw new Error(
      `packageSnapshot: teamContradictions was not executed (${JSON.stringify(result.detail)}) even ` +
      'though both readSource and normalizeTeamKey were supplied - the real check did not run, which ' +
      'the packager refuses to certify'
    );
  }
  const totalContradictions = Object.values(result.counts || {})
    .reduce((sum, c) => sum + Number(c.contradictions || 0), 0);
  return { ...result, totalContradictions, hasFindings: totalContradictions > 0 };
}

// ---------------------------------------------------------------------------
// Raw-source verification (hash, secret scan) - no writes
// ---------------------------------------------------------------------------

/**
 * Pure-ish (fs read only): parse CSV text into ALL its columns, not a
 * projection. `lib/csv.js`'s `collectColumns` deliberately restricts a read
 * to a caller-named column list; the secret scan has to look at EVERY
 * column of every raw source row, including ones no cohort-reconstruction
 * code ever reads, so this builds the full row object instead. Embedded
 * newlines inside quoted fields are handled correctly here (unlike the
 * on-disk chunking, which is deliberately byte-oriented and CSV-blind) -
 * `parseCsvRecords` already supports them.
 */
function fullCsvRows(text, { label = 'csv' } = {}) {
  const records = parseCsvRecords(text);
  if (records.length === 0) throw new Error(`${label}: no header line`);
  const header = records[0];
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const fields = records[r];
    if (fields.length !== header.length) {
      throw new Error(
        `${label}: record ${r} has ${fields.length} fields, header has ${header.length} ` +
        '(refusing to guess which column is missing)'
      );
    }
    const row = {};
    header.forEach((name, i) => { row[name] = fields[i]; });
    rows.push(row);
  }
  return rows;
}

/**
 * Verify every one of the ten pinned raw sources BEFORE any chunk (dataset
 * or source) is written: bytes hash to the pinned provenance SHA-256 (and,
 * for `games.csv`, ALSO to the hardcoded `GAMES_CSV_SHA256` constant), and a
 * value-level secret/contact scan over every parsed row finds nothing.
 * Identifier and biographical columns that are EXPECTED in public NFL data
 * (`birth_date`, `gsis_id`, `espn_id`, `nfl_id`, `pfr_id`, `pff_id`,
 * `otc_id`, `esb_id`, `smart_id`, and similar) are not special-cased here on
 * purpose: `secretScan` matches on VALUE SHAPE (a credential, an email, a
 * phone number, a local filesystem path, a JWT), never on column name, so an
 * ordinary identifier or a date of birth never collides with any of those
 * shapes - there is nothing to allowlist. Returns the raw bytes read (so the
 * chunking pass never has to re-open the file) alongside each check's
 * result, for `verification.json`.
 */
function verifySources({ sourcesDir, provenancePath, sealedSources, expectedGamesCsvSha256, log }) {
  const provenanceRecords = readProvenanceRecords(provenancePath);
  const verified = [];
  for (const sourceEntry of SOURCES) {
    const file = assertSafeSourceFile(sourceEntry.file, { label: sourceEntry.name });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const fullPath = path.join(String(sourcesDir), file);
    const rawBytes = fs.readFileSync(fullPath);
    const rawSha256 = sha256Hex(rawBytes);
    const record = provenanceRecords.get(sourceEntry.name);
    if (!record) {
      throw new Error(
        `packageSnapshot: no provenance record for source ${sourceEntry.name} in ${provenancePath} - ` +
        'refusing to package an unverifiable raw source'
      );
    }
    if (rawSha256 !== record.sha256) {
      throw new Error(
        `packageSnapshot: source ${sourceEntry.name} on disk (${fullPath}) hashes to ${rawSha256}, ` +
        `provenance.json records ${record.sha256} - refusing to chunk bytes that do not match the ` +
        'pinned provenance'
      );
    }
    if (sourceEntry.name === 'games' && rawSha256 !== expectedGamesCsvSha256) {
      throw new Error(
        `packageSnapshot: games.csv hashes to ${rawSha256}, the pinned GAMES_CSV_SHA256 constant ` +
        `(scripts/backtest/lib/sources.js) expects ${expectedGamesCsvSha256} - refusing to package a ` +
        'games.csv that is not the pinned revision'
      );
    }
    // ROUND 6 FIX ("packager-side source substitution", reproduced by a
    // third-party review): sourcesDir and provenance.json are BOTH ordinary
    // local files an operator (or an attacker) fully controls, so the checks
    // above only ever prove internal self-consistency between two things
    // that could have been edited together. sealedSources - the sealed Gate-2
    // manifest's OWN sources array, itself independently pinned against
    // PINNED_SNAPSHOT_MANIFEST_SHA256 above - is the one anchor a change to
    // sourcesDir/provenance.json alone cannot also forge. Every source gets
    // this check, not only games.csv (which additionally keeps its own
    // stronger, hardcoded-constant check above).
    const sealedRecord = sealedSources.get(sourceEntry.name);
    if (rawSha256 !== sealedRecord.sha256) {
      throw new Error(
        `packageSnapshot: source ${sourceEntry.name} on disk (${fullPath}) hashes to ${rawSha256}, the ` +
        `SEALED snapshot manifest independently pins ${sealedRecord.sha256} for this source - the local ` +
        'sourcesDir and provenance.json may agree with EACH OTHER, but not with the sealed manifest they ' +
        'are supposed to be reproducing'
      );
    }
    if (rawBytes.length !== sealedRecord.byteLength) {
      throw new Error(
        `packageSnapshot: source ${sourceEntry.name} is ${rawBytes.length} byte(s) on disk, the SEALED ` +
        `snapshot manifest independently pins ${sealedRecord.byteLength} byte(s) for this source`
      );
    }
    const rows = fullCsvRows(rawBytes.toString('utf8'), { label: sourceEntry.name });
    const scan = assertNoSecrets(rows, sourceEntry.name);
    verified.push({ sourceEntry, rawBytes, rawSha256, provenanceSha256: record.sha256, scan });
    log(`  verified source ${sourceEntry.name}: provenance hash ok, sealed manifest hash ok, secret scan 0 hits`);
  }
  return verified;
}

// ---------------------------------------------------------------------------
// Chunking + gzip + write
// ---------------------------------------------------------------------------

/**
 * Chunk, gzip and write one dataset's ALREADY-VERIFIED bytes. Reads the raw
 * NDJSON bytes fresh from disk (rather than re-serializing the rows already
 * loaded in memory) so the chunked bytes are provably the exact bytes the
 * Gate-2 extraction wrote, not a re-encoding of them.
 */
function packageOneDataset({ snapshotRoot, publishRoot, entry, chunkTargetBytes }) {
  const originalFile = store.datasetFile(snapshotRoot, entry.store, entry.path, entry.dataset);
  const rawBytes = fs.readFileSync(originalFile);
  const rawSha256 = sha256Hex(rawBytes);
  if (rawSha256 !== entry.sha256) {
    throw new Error(
      `packageSnapshot: ${entry.dataset} on disk hashes to ${rawSha256}, the source manifest records ` +
      `${entry.sha256} - refusing to chunk bytes that do not match the sealed manifest`
    );
  }
  const text = rawBytes.toString('utf8');
  const chunkTexts = chunkNdjson(text, { targetBytes: chunkTargetBytes });

  const dir = chunkDir(publishRoot, entry.dataset);
  fs.mkdirSync(dir, { recursive: true });

  const chunks = chunkTexts.map((chunkText, index) => {
    const uncompressed = Buffer.from(chunkText, 'utf8');
    const uncompressedSha256 = sha256Hex(uncompressed);
    const compressed = gzipDeterministic(uncompressed);
    const compressedSha256 = sha256Hex(compressed);
    const fileName = chunkFileName(index);
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const outFile = path.join(dir, fileName);
    writeVerified(outFile, compressed, { label: `${entry.dataset} chunk ${index}` });
    return {
      dataset: entry.dataset,
      index,
      rowCount: countNdjsonLines(chunkText),
      uncompressedBytes: uncompressed.length,
      uncompressedSha256,
      compressedBytes: compressed.length,
      compressedSha256,
      file: chunkManifestPath(entry.dataset, fileName),
    };
  });

  return {
    dataset: entry.dataset,
    store: entry.store,
    path: entry.path,
    seasonScoped: entry.seasonScoped,
    rowCount: entry.rowCount,
    uncompressedBytes: rawBytes.length,
    uncompressedSha256: rawSha256,
    chunkCount: chunks.length,
    chunks,
  };
}

/**
 * Chunk, gzip and write one raw source's ALREADY-VERIFIED bytes
 * (`verifySources` above ran the hash and secret-scan checks before this is
 * ever called). Raw-BYTE chunking, never line- or CSV-aware - see
 * `lib/rawByteChunker.js`'s docblock for why that matters for these files
 * specifically.
 */
function packageOneSource({ publishRoot, verified, chunkTargetBytes }) {
  const { sourceEntry, rawBytes, rawSha256, provenanceSha256 } = verified;
  const dir = sourceChunkDir(publishRoot, sourceEntry.name);
  fs.mkdirSync(dir, { recursive: true });

  const rawChunks = chunkRawBytes(rawBytes, { targetBytes: chunkTargetBytes });
  const chunks = rawChunks.map((chunkBytes, index) => {
    const uncompressedSha256 = sha256Hex(chunkBytes);
    const compressed = gzipDeterministic(Buffer.from(chunkBytes));
    const compressedSha256 = sha256Hex(compressed);
    const fileName = rawChunkFileName(index);
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const outFile = path.join(dir, fileName);
    writeVerified(outFile, compressed, { label: `source ${sourceEntry.name} chunk ${index}` });
    return {
      source: sourceEntry.name,
      index,
      uncompressedBytes: chunkBytes.length,
      uncompressedSha256,
      compressedBytes: compressed.length,
      compressedSha256,
      file: sourceChunkManifestPath(sourceEntry.name, fileName),
    };
  });

  return {
    name: sourceEntry.name,
    file: sourceEntry.file,
    kind: sourceEntry.kind,
    season: sourceEntry.season,
    uncompressedBytes: rawBytes.length,
    uncompressedSha256: rawSha256,
    provenanceSha256,
    chunkCount: chunks.length,
    chunks,
  };
}

// ---------------------------------------------------------------------------
// Reconstruction proof
// ---------------------------------------------------------------------------

/**
 * Independently re-read every chunk THIS RUN JUST WROTE, from disk (never
 * from the buffers still in memory from writing them), gunzip each one,
 * reassemble in chunk order, and byte-compare the result against the
 * ORIGINAL snapshot dataset bytes (also freshly re-read from disk). A
 * packaging run that cannot prove this for every dataset throws rather than
 * returning a manifest.
 */
function reconstructAndVerify({ snapshotRoot, publishRoot, datasetEntries }) {
  const results = [];
  for (const ds of datasetEntries) {
    const originalFile = store.datasetFile(snapshotRoot, ds.store, ds.path, ds.dataset);
    const originalBytes = fs.readFileSync(originalFile);
    const pieces = [];
    for (const chunk of ds.chunks) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const chunkFile = path.join(publishRoot, ...chunk.file.split('/'));
      const compressedOnDisk = fs.readFileSync(chunkFile);
      if (sha256Hex(compressedOnDisk) !== chunk.compressedSha256) {
        throw new Error(`reconstruction: ${ds.dataset} chunk ${chunk.index} compressed bytes on disk drifted`);
      }
      const decompressed = gunzipVerified(compressedOnDisk);
      if (sha256Hex(decompressed) !== chunk.uncompressedSha256) {
        throw new Error(`reconstruction: ${ds.dataset} chunk ${chunk.index} decompressed to the wrong bytes`);
      }
      pieces.push(decompressed);
    }
    const reassembled = Buffer.concat(pieces);
    const matches = reassembled.equals(originalBytes);
    if (!matches) {
      throw new Error(
        `reconstruction proof FAILED for ${ds.dataset}: ${reassembled.length} reassembled bytes vs ` +
        `${originalBytes.length} original bytes - a packaging run that cannot prove reconstruction fails`
      );
    }
    results.push({ dataset: ds.dataset, ok: true, bytes: reassembled.length, chunks: ds.chunks.length });
  }
  return results;
}

/**
 * The raw-source counterpart of `reconstructAndVerify`: reassemble every
 * source's chunks from disk and byte-compare against BOTH the original file
 * on disk (in `sourcesDir`, freshly re-read) AND the pinned provenance
 * SHA-256 - a raw source has two independent things to reproduce (the file
 * that is actually there, and the hash the study was preregistered against),
 * and this proves both agree.
 */
function reconstructAndVerifySources({ sourcesDir, publishRoot, sourceEntries }) {
  const results = [];
  for (const s of sourceEntries) {
    const file = assertSafeSourceFile(s.file, { label: s.name });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const originalFile = path.join(String(sourcesDir), file);
    const originalBytes = fs.readFileSync(originalFile);
    const pieces = [];
    for (const chunk of s.chunks) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const chunkFile = path.join(publishRoot, ...chunk.file.split('/'));
      const compressedOnDisk = fs.readFileSync(chunkFile);
      if (sha256Hex(compressedOnDisk) !== chunk.compressedSha256) {
        throw new Error(`source reconstruction: ${s.name} chunk ${chunk.index} compressed bytes on disk drifted`);
      }
      const decompressed = gunzipVerified(compressedOnDisk);
      if (sha256Hex(decompressed) !== chunk.uncompressedSha256) {
        throw new Error(`source reconstruction: ${s.name} chunk ${chunk.index} decompressed to the wrong bytes`);
      }
      pieces.push(decompressed);
    }
    const reassembled = Buffer.concat(pieces);
    if (!reassembled.equals(originalBytes)) {
      throw new Error(
        `source reconstruction proof FAILED for ${s.name}: ${reassembled.length} reassembled bytes vs ` +
        `${originalBytes.length} original bytes on disk`
      );
    }
    const reassembledSha256 = sha256Hex(reassembled);
    if (reassembledSha256 !== s.provenanceSha256) {
      throw new Error(
        `source reconstruction proof FAILED for ${s.name}: reassembled bytes hash to ` +
        `${reassembledSha256}, the pinned provenance SHA-256 is ${s.provenanceSha256}`
      );
    }
    results.push({ source: s.name, ok: true, bytes: reassembled.length, chunks: s.chunks.length });
  }
  return results;
}

// ---------------------------------------------------------------------------
// NOTICE.md / .gitattributes / dry-run-receipt-note.md
// ---------------------------------------------------------------------------

const GITATTRIBUTES_TEXT = `# Scoped to backtest-data/publish/ only.
#
# This machine (and this repository's default Windows checkout) has
# core.autocrlf=true. Git normally rewrites LF to CRLF on checkout for
# anything it treats as text. A gzip stream is binary - every 0x0A byte
# inside a .gz chunk is compressed payload, not a line ending - so
# autocrlf's rewrite would silently corrupt every sealed chunk on checkout.
# The NDJSON/JSON sidecars are canonically serialized with a bare LF, and
# autocrlf rewriting that away would break their recorded byte lengths and
# hashes too. The rules below override autocrlf for this tree specifically,
# in both directions, so a Windows checkout of these exact bytes matches a
# Linux one.

* -text
*.json text eol=lf
# No bare .ndjson file is staged today - every dataset is chunked and gzipped
# (.ndjson.gz) before it ever reaches this tree. Kept for forward
# compatibility with an uncompressed or ungzipped chunk format, should one
# ever be added; harmless dead code until then.
*.ndjson text eol=lf
*.md text eol=lf
*.txt text eol=lf
*.gz binary
`;

const DRY_RUN_RECEIPT_NOTE_TEXT = `# About dry-run-receipt.json

This file is copied byte for byte from the Gate-2 extraction's own output
(\`backtest-data/snapshot/dry-run-receipt.json\`). It proves one thing only:
that the extraction's dry run and the apply that followed it were planned
under the identical configuration digest (\`planDigest\`) - the same pinned
sources, the same target seasons, the same SQL surface, the same oracle
settings, and the same database and role identity - before a single row was
written.

It does NOT prove that the dry run and the apply captured byte-identical
data. They are two separate transactions against a live database, so their
row counts may legitimately differ between the two; the receipt's
\`rowCounts\` and \`wouldWrite\` fields describe what the dry run observed,
not what this publication's chunks contain. That is \`manifest.json\`'s job,
both the sealed Gate-2 extraction manifest and this publication's own
chunk-level manifest.
`;

function buildNotice(sourceManifest) {
  const sourceByName = new Map((sourceManifest.sources || []).map((s) => [s.name, s]));
  const line = (name) => {
    const s = sourceByName.get(name);
    return s ? `- \`${s.file}\` (sha256 \`${s.sha256}\`)` : `- \`${name}\` (not recorded in this snapshot)`;
  };
  return `# Data sources and attribution

This publication is built from public, community-maintained NFL data, plus
this application's own captured schedule, stat and identifier rows. It is
Gate 3 of a rebuilt historical backtest, and it ships two things: the
derived, chunked evaluation datasets under \`chunks/\`, and byte-exact
archival copies of the ten pinned raw source CSVs under \`sources/\`, so the
study can be reproduced from a genuinely clean clone with no network
access - see "Raw source files" below and \`scripts/backtest/rehydrate.js\`.

Every pinned source below was fetched once and never re-fetched; the
SHA-256 values are the ones the Gate-2 extraction recorded, not values
recomputed at publication time.

## nflverse-data (github.com/nflverse/nflverse-data) - CC BY 4.0

The weekly roster, injury-report, player/team weekly-stats, and player
biographical (\`players.csv\`) release files are published by the nflverse
project under the Creative Commons Attribution 4.0 International license:
https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md

${['roster_weekly_2024', 'roster_weekly_2025', 'injuries_2024', 'injuries_2025',
  'stats_player_week_2024', 'stats_player_week_2025', 'stats_team_week_2024',
  'stats_team_week_2025', 'players'].map(line).join('\n')}

The only transformation ever performed on these files is chunking and gzip
compression for transport; no value in any row is altered, reformatted, or
re-derived. The byte-exact copies under \`sources/\` are the same bytes
named above, split into fixed-size pieces and reassembled unchanged on
rehydration.

## nflverse/nfldata (games.csv) - licensing status NOT established

${line('games')}

The schedule and score file, pinned at an exact git commit and blob SHA
(recorded in \`scripts/backtest/lib/sources.js\`), sourced from
github.com/nflverse/nfldata. Unlike nflverse-data above, redistribution
permission for this specific file, from this specific repository, has NOT
been established or confirmed. It is included here as a byte-exact archival
copy for reproducibility, with that licensing status flagged as unresolved,
not asserted to be fine; anyone redistributing this publication further
should treat games.csv's inclusion as pending a licensing check against
github.com/nflverse/nfldata, not as pre-cleared.

This file's own rows span 1999-2026; only the 2024 and 2025 regular-season
rows feed the evaluation store used for scoring, and the 2026 rows are
retained in the raw provenance chunk and the raw \`sources/games\` chunk
only - an untouched prospective holdout, never an evaluated row.

## Raw source files (sources/) and the two provenance copies

\`sources/<name>/chunk-NNNN.bin.gz\` holds the ten pinned raw CSVs listed
above, chunked as fixed-size raw BYTE slices of the original file - never
line-aware, never CSV-aware (see \`scripts/backtest/lib/rawByteChunker.js\`
for why: a direct inspection of these files found that \`injuries_2024.csv\`
carries a quoted field with an embedded newline, which makes a line-based
chunker unsafe for at least this file, and the fix applied to all ten is the
same either way). Reassembling a source's chunks in order, per the
\`sources\` array in \`manifest.json\`, reproduces the exact original bytes.
\`manifest.json\`'s \`sourceChunking\` block names this algorithm explicitly
so it is never confused with the line-atomic NDJSON algorithm \`chunks/\`
uses (\`chunking\`).

\`source-manifest.json\` is a byte-for-byte copy of the sealed Gate-2
extraction's own \`manifest.json\`: schema fingerprints, the SQL surface
digest, oracle settings, integrity-check results, and this snapshot's own
source provenance table - richer metadata than the derived \`chunks/\`
datasets alone carry. It is scanned as raw text for secrets before being
copied here, the same treatment every other file in this publication gets.

\`sources-provenance.json\` is a byte-for-byte copy of
\`backtest-data/sources/provenance.json\`, the record of exactly which
bytes were fetched, from where, and when. \`scripts/backtest/rehydrate.js\`
uses it, alongside \`manifest.json\`, to know which pinned SHA-256 each
rehydrated raw source file must verify against, and
\`scripts/backtest/snapshot-checks.js\`'s \`makeSourceReader\` can be pointed
directly at a rehydrated \`sources/\` directory carrying this same file.

## What this publication's captured chunks are actually built from

The \`players\`, \`player_stats\`, \`player_season_stats\`, and \`nfl_games_*\`
chunks are this application's own captured PostgreSQL rows, read under a
temporary read-only role scoped to exactly the tables and columns a formal
sanitization review approved: public sports statistics and schedule facts.
They are not generated by this repository from nothing - this app's own
data pipeline draws them from several upstream systems over time: Tank01
(the app's subscribed NFL data API) for live roster and stat sync, nflverse
for historical backfill, Sleeper for offense/kicker season-stat sourcing,
FantasyFootballCalculator for ADP (average draft position), and ESPN for
the \`external_id\` identifier space used to cross-reference players. This
notice does not trace every individual field to its exact origin API; it
names the real upstream systems this app's own pipeline draws from, rather
than describing the data as though this repository generated it itself.

The \`oracle_*\` chunks are this application's own projection-engine output,
captured for reproducibility testing rather than sourced from anywhere
external.

## Personal and biographical data, and what is NOT included

\`players.csv\` (and the app's own \`players\` chunk) carries real, public
NFL players' biographical fields, including \`birth_date\`, name, college,
and draft information - genuine personal data about public figures,
disclosed in the players' own public sports-data records, not by this
application. The specific categories present: injury-report fields
including \`report_status\`; the several stable identifier columns present
in \`players.csv\` (\`gsis_id\`, \`espn_id\`, \`nfl_id\`, \`pfr_id\`, \`pff_id\`,
\`otc_id\`, \`esb_id\`, \`smart_id\`); \`birth_date\`; and any URL-shaped field
such as \`headshot\`. This notice makes a narrower and more precise claim
than "no personal data of any kind": no Endzone USER, ACCOUNT, LEAGUE, CREDENTIAL, or AUTHENTICATION data of any kind is included. This
publication does not claim the broader thing.

See \`manifest.json\` for the exact chunk inventory (dataset or source name,
order, row or byte count, and both uncompressed and compressed byte counts
and hashes) and \`verification.json\` for the packaging-time verification
results: schema, secret scan over every dataset AND every raw source file,
reconstruction proofs for both \`chunks/\` and \`sources/\`, and the
roster-vs-gameTeam contradiction counts.
`;
}

// ---------------------------------------------------------------------------
// Staging paths (never a git command; see the module docblock)
// ---------------------------------------------------------------------------

/**
 * Pure: the exact, individually-named list of publication paths a future
 * Gate-3 commit would `git add`, repo-root relative, forward-slashed,
 * sorted. Never a directory glob and never `git add -A` - and nothing under
 * `backtest-data/snapshot/` can appear here, because every path is built
 * from `publishRoot` alone.
 */
function buildStagingPaths({ publishRoot, fixedFiles, chunkFiles }) {
  const relRoot = path.relative(REPO_ROOT, publishRoot).split(path.sep).join('/');
  const all = [...fixedFiles, ...chunkFiles].map((f) => `${relRoot}/${f}`);
  return [...new Set(all)].sort();
}

/**
 * Scan the parent directory of `publishRoot` for leftover `.tmp-package-*`
 * directories from a previous run that built and fully verified a
 * publication but never got promoted - most commonly because
 * `assertPublishRootAbsentForPromote` refused a conflicting promote and, by
 * design, left the built temp tree on disk rather than deleting it (see that
 * function's docblock). Every one of those directories is a complete,
 * chunked-and-gzipped publication tree (tens of MB in the real run) that
 * will accumulate FOREVER unless an operator notices and removes it by hand
 * - nothing else in this script ever revisits or cleans them up. This is a
 * WARNING via the `log` callback, not a thrown error: a pile of leaked temp
 * directories is not a reason to block a legitimate new packaging run, only
 * a reason to surface it so an operator can deal with the accumulation
 * before it becomes a real disk-space problem. Runs near the very start of
 * `packageSnapshot`, before any of the expensive verification/build work, so
 * the warning is not gated behind minutes of work that a `log()` consumer
 * might not read until the run already finished.
 */
function warnAboutLeakedTempDirs({ publishRoot, log }) {
  const parent = path.dirname(publishRoot);
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch (_err) {
    return; // the parent directory does not exist yet - nothing could have leaked into it
  }
  const leaked = entries
    .filter((e) => e.isDirectory() && e.name.startsWith(TEMP_BUILD_DIR_PREFIX))
    .map((e) => path.join(parent, e.name))
    .sort();
  if (leaked.length === 0) return;
  log(
    `WARNING: found ${leaked.length} leftover ${TEMP_BUILD_DIR_PREFIX}* director${leaked.length === 1 ? 'y' : 'ies'} ` +
    `next to publishRoot's parent (${parent}), left behind by a previous conflicting-promote run that was ` +
    'never cleaned up. Each one is a full, previously-built-and-verified publication tree (potentially tens ' +
    'of MB) that will accumulate indefinitely unless removed by hand - this run does not delete them. Found: ' +
    leaked.join(', ')
  );
}

// ---------------------------------------------------------------------------
// Promotion (atomicity)
// ---------------------------------------------------------------------------

/**
 * Refuse to promote a completed build over an already-existing `publishRoot`.
 * This is local, single-operator tooling, not a service racing itself, so a
 * pre-existing publish directory is a decision for a human, not something
 * this script silently deletes or overwrites. `buildRoot` is passed in (not
 * just `publishRoot`) so the thrown message can name EXACTLY where the
 * fully-built, fully-verified temp directory was left on disk - without it,
 * an operator has to guess the undocumented `.tmp-package-*` naming
 * convention and search the parent directory themselves.
 */
function assertPublishRootAbsentForPromote(publishRoot, buildRoot) {
  if (fs.existsSync(publishRoot)) {
    throw new Error(
      `packageSnapshot: publishRoot (${publishRoot}) already exists - refusing to silently delete or ` +
      'overwrite it at promotion time. Move or remove the existing directory yourself, then re-run ' +
      'packaging; the freshly built, fully verified publication is still intact and has NOT been deleted ' +
      `- it is sitting at ${buildRoot} until you do.`
    );
  }
}

// ---------------------------------------------------------------------------
// The packager
// ---------------------------------------------------------------------------

/**
 * Package the frozen Gate-2 snapshot at `snapshotRoot`, plus the ten pinned
 * raw sources at `sourcesDir`, into the publication staging tree at
 * `publishRoot`. Never modifies anything under `snapshotRoot` or
 * `sourcesDir` - every write happens under a fresh temporary directory that
 * is atomically renamed to `publishRoot` only on complete success.
 *
 * `readSource`, `normalizeTeamKey`, `sourcesDir` and `provenancePath` are all
 * MANDATORY (see the module docblock for why). `expectedManifestSha256` and
 * `expectedGamesCsvSha256` default to the pinned production hashes; pass a
 * fixture's own hashes in a test.
 */
function packageSnapshot({
  snapshotRoot = DEFAULT_SNAPSHOT_DIR,
  publishRoot = DEFAULT_PUBLISH_DIR,
  sourcesDir,
  provenancePath,
  readSource,
  normalizeTeamKey,
  expectedManifestSha256 = PINNED_SNAPSHOT_MANIFEST_SHA256,
  expectedGamesCsvSha256 = GAMES_CSV_SHA256,
  chunkTargetBytes = DEFAULT_CHUNK_TARGET_BYTES,
  sourceChunkTargetBytes = DEFAULT_RAW_CHUNK_TARGET_BYTES,
  acknowledgeContradictions = false,
  log = () => {},
}) {
  if (!sourcesDir) {
    throw new Error(
      'packageSnapshot: sourcesDir is required so the ten pinned raw sources can be packaged - ' +
      'sources are a mandatory part of this publication, and packaging must never silently skip them'
    );
  }
  if (!provenancePath) {
    throw new Error(
      'packageSnapshot: provenancePath is required to verify the pinned raw sources before chunking them'
    );
  }

  // --- the collision guard is FIRST, ahead of EVERYTHING else, including the
  //     leaked-temp-dir scan below (round 4, MEDIUM finding 1): that scan
  //     calls fs.readdirSync on publishRoot's parent - a real SMB
  //     directory-listing call if publishRoot is UNC-shaped - so it must never
  //     run before the UNC-rejection guard has had a chance to refuse the
  //     path outright. Now also covers `sourcesDir` (round 4, MEDIUM finding
  //     3): previously only snapshotRoot/publishRoot were ever checked against
  //     each other, and sourcesDir - the third real filesystem root this tool
  //     reads from - was never checked against either of them at all.
  assertRootsDisjoint([
    { name: 'snapshotRoot', path: snapshotRoot },
    { name: 'publishRoot', path: publishRoot },
    { name: 'sourcesDir', path: sourcesDir },
  ]);

  // --- surface any leaked temp build dirs from a prior conflicting-promote
  //     run, before any expensive work starts (MEDIUM finding: this never
  //     blocks the run, only warns) --------------------------------------
  warnAboutLeakedTempDirs({ publishRoot, log });

  // --- pin the source manifest bytes, before reading anything else --------
  const manifestFile = store.manifestFile(snapshotRoot);
  const manifestBytesBefore = fs.readFileSync(manifestFile);
  const manifestSha256Before = sha256Hex(manifestBytesBefore);
  if (expectedManifestSha256 && manifestSha256Before !== expectedManifestSha256) {
    throw new Error(
      `packageSnapshot: source manifest hashes to ${manifestSha256Before}, expected the pinned ` +
      `${expectedManifestSha256} - refusing to package a snapshot that is not the one this build was ` +
      'authorized against'
    );
  }
  const manifest = store.loadManifest(snapshotRoot);
  log(`packaging ${manifest.studyId}, source manifest sha256 ${manifestSha256Before}`);

  // --- bind the sealed manifest's OWN sources/datasets arrays, structurally
  //     validated against the frozen SOURCES registry, before reading any
  //     raw source or dataset content (round 6 fix, "packager-side source
  //     substitution" finding): previously, only games.csv had ANY check
  //     against something the local sourcesDir/provenance.json themselves
  //     could not both be edited to agree with - the other nine sources had
  //     no anchor beyond "does sourcesDir agree with its own provenance.json",
  //     which an attacker (or a stale/wrong local checkout) controlling both
  //     could always satisfy. sealedSources is now that anchor for all ten.
  const sealedSources = buildSealedSourcesMap(manifest.sources, { label: 'sealed snapshot manifest' });

  // --- verify every dataset AND every raw source before any write ----------
  const { loadedByDataset, schemaResults, externalIdResults, secretScanResults } =
    verifyDatasets({ snapshotRoot, manifest, log });

  const teamContradictions = runRealTeamContradictions({ readSource, normalizeTeamKey, manifest });
  log(`  teamContradictions (real, never skipped): ${JSON.stringify(teamContradictions.counts)}`);
  if (teamContradictions.hasFindings) {
    // The user's binding approval of "report, never abort" for a nonzero
    // teamContradictions count was conditional: ONLY with an explicit,
    // per-run, recorded acknowledgement that a human reviewed the counts
    // above - not a standing blank check. `acknowledgeContradictions`
    // defaults to false, so a run that finds a real contradiction and was
    // never told to acknowledge one refuses to silently proceed past it.
    if (acknowledgeContradictions !== true) {
      throw new Error(
        'packageSnapshot: real, nonzero roster-vs-gameTeam contradictions were found ' +
        `(${JSON.stringify(teamContradictions.counts)}) and acknowledgeContradictions was not explicitly ` +
        'set to true - packaging refuses to silently proceed past a real, nonzero contradiction count. ' +
        'Review the counts above, then re-run with acknowledgeContradictions: true (CLI: ' +
        '--acknowledge-contradictions) only once a human has actually done so.'
      );
    }
    log(
      '  ** FINDING: real, nonzero roster-vs-gameTeam contradictions were found. Per preregistration ' +
      '4.1 this is a REPORTED metric, not an exclusion rule, and acknowledgeContradictions was ' +
      'explicitly set - packaging continues, and the acknowledgement is recorded in verification.json. **'
    );
  }

  const verifiedSources = verifySources({ sourcesDir, provenancePath, sealedSources, expectedGamesCsvSha256, log });

  // --- build into a fresh temp directory; publishRoot is never touched
  //     directly until every check below has already passed -----------------
  fs.mkdirSync(path.dirname(publishRoot), { recursive: true });
  const buildRoot = fs.mkdtempSync(path.join(path.dirname(publishRoot), TEMP_BUILD_DIR_PREFIX));
  // Defense in depth: `buildRoot` is a sibling of `publishRoot`, which the
  // check above already proves cannot land inside `snapshotRoot` or
  // `sourcesDir` (a sibling of something disjoint from those two cannot
  // itself be nested inside either - see `assertRootsDisjoint`'s own proof) -
  // but the check is re-run directly against the ACTUAL buildRoot path
  // anyway, since the cost is negligible and this is exactly the invariant
  // Finding 2 was about. `sourcesDir` is included too (Finding 3).
  assertRootsDisjoint([
    { name: 'snapshotRoot', path: snapshotRoot },
    { name: 'buildRoot', path: buildRoot },
    { name: 'sourcesDir', path: sourcesDir },
  ]);

  // Hoisted so the promote step below (deliberately OUTSIDE the try/catch
  // that follows) can still return them after a successful build.
  let publicationManifest;
  let publicationManifestSha256;
  let verification;
  let stagingPaths;
  let totals;
  let sourceTotals;

  try {
    const datasetEntries = manifest.datasets.map((entry) => {
      const packaged = packageOneDataset({ snapshotRoot, publishRoot: buildRoot, entry, chunkTargetBytes });
      log(`  ${entry.dataset}: ${packaged.chunkCount} chunk(s), ${packaged.uncompressedBytes} uncompressed bytes`);
      return packaged;
    });

    const sourceEntries = verifiedSources.map((verified) => {
      const packaged = packageOneSource({ publishRoot: buildRoot, verified, chunkTargetBytes: sourceChunkTargetBytes });
      log(`  source ${packaged.name}: ${packaged.chunkCount} chunk(s), ${packaged.uncompressedBytes} uncompressed bytes`);
      return packaged;
    });

    // --- reconstruction proofs, independent of the write passes above ------
    const reconstruction = reconstructAndVerify({ snapshotRoot, publishRoot: buildRoot, datasetEntries });
    log(`  reconstruction proof: ${reconstruction.length} dataset(s) byte-identical to the source`);
    const sourceReconstruction = reconstructAndVerifySources({ sourcesDir, publishRoot: buildRoot, sourceEntries });
    log(`  source reconstruction proof: ${sourceReconstruction.length} source(s) byte-identical to the source`);

    // --- re-verify the source manifest was never mutated during packaging --
    const manifestBytesAfter = fs.readFileSync(manifestFile);
    const manifestSha256After = sha256Hex(manifestBytesAfter);
    if (manifestSha256After !== manifestSha256Before) {
      throw new Error(
        'packageSnapshot: the source manifest at ' + manifestFile + ' changed DURING packaging ' +
        `(before ${manifestSha256Before}, after ${manifestSha256After}) - aborting`
      );
    }

    // --- the dry-run receipt, scanned then copied verbatim, plus its note ---
    // Moved AHEAD of the publication manifest's own construction (round 4,
    // MEDIUM finding 2): `writeVerified`'s returned hash for each of these
    // THREE fixed, verbatim-copied files is what `manifest.json`'s new
    // `fixedFiles` section records, so `rehydrate.js` has a pinned hash to
    // check each one against before ever treating it as trustworthy input.
    const receiptSrc = store.receiptFile(snapshotRoot);
    const receiptBytes = fs.readFileSync(receiptSrc);
    // Scanned as raw TEXT before it is copied anywhere - this file is never
    // loaded as rows, so `assertNoSecrets` (which walks row objects) cannot
    // reach it; without this call nothing ever scans it at all. The RESULT is
    // captured (not just the throw-on-failure side effect) so
    // `verification.json` can record that this scan actually ran and passed.
    const receiptScan = assertNoSecretsInText(receiptBytes.toString('utf8'), 'dry-run-receipt.json');
    const receiptWrite = writeVerified(path.join(buildRoot, 'dry-run-receipt.json'), receiptBytes, { label: 'dry-run-receipt.json' });
    writeVerified(
      path.join(buildRoot, 'dry-run-receipt-note.md'), Buffer.from(DRY_RUN_RECEIPT_NOTE_TEXT, 'utf8'),
      { label: 'dry-run-receipt-note.md' }
    );

    // --- the full sealed snapshot manifest + the sources provenance table,
    //     scanned as raw text then copied verbatim ---------------------------
    const sourceManifestScanResult = assertNoSecretsInText(manifestBytesBefore.toString('utf8'), SOURCE_MANIFEST_FILENAME);
    const sourceManifestWrite = writeVerified(path.join(buildRoot, SOURCE_MANIFEST_FILENAME), manifestBytesBefore, { label: SOURCE_MANIFEST_FILENAME });

    const provenanceBytes = fs.readFileSync(provenancePath);
    const provenanceScanResult = assertNoSecretsInText(provenanceBytes.toString('utf8'), SOURCES_PROVENANCE_FILENAME);
    const provenanceWrite = writeVerified(path.join(buildRoot, SOURCES_PROVENANCE_FILENAME), provenanceBytes, { label: SOURCES_PROVENANCE_FILENAME });

    // --- the publication manifest -------------------------------------------
    totals = datasetEntries.reduce((acc, d) => ({
      datasets: acc.datasets + 1,
      chunks: acc.chunks + d.chunkCount,
      uncompressedBytes: acc.uncompressedBytes + d.uncompressedBytes,
      compressedBytes: acc.compressedBytes + d.chunks.reduce((s, c) => s + c.compressedBytes, 0),
    }), { datasets: 0, chunks: 0, uncompressedBytes: 0, compressedBytes: 0 });

    sourceTotals = sourceEntries.reduce((acc, s) => ({
      sources: acc.sources + 1,
      chunks: acc.chunks + s.chunkCount,
      uncompressedBytes: acc.uncompressedBytes + s.uncompressedBytes,
      compressedBytes: acc.compressedBytes + s.chunks.reduce((sum, c) => sum + c.compressedBytes, 0),
    }), { sources: 0, chunks: 0, uncompressedBytes: 0, compressedBytes: 0 });

    const chunkList = datasetEntries.flatMap((d) => d.chunks.map((c) => c.file));
    const sourceChunkList = sourceEntries.flatMap((s) => s.chunks.map((c) => c.file));

    // The three fixed, verbatim-copied provenance/receipt files `rehydrate.js`
    // treats as authoritative input, each recorded with the hash of the
    // ACTUAL bytes `writeVerified` just wrote and read back (round 4, MEDIUM
    // finding 2) - never re-hashed independently, so this can never drift
    // from what is really on disk.
    const fixedFiles = [
      { name: SOURCE_MANIFEST_FILENAME, sha256: sourceManifestWrite.sha256, byteLength: sourceManifestWrite.byteLength },
      { name: SOURCES_PROVENANCE_FILENAME, sha256: provenanceWrite.sha256, byteLength: provenanceWrite.byteLength },
      { name: 'dry-run-receipt.json', sha256: receiptWrite.sha256, byteLength: receiptWrite.byteLength },
    ];

    publicationManifest = {
      sourceSnapshot: {
        studyId: manifest.studyId,
        extractedAt: manifest.extractedAt,
        planDigest: manifest.planDigest,
        manifestSha256: manifestSha256Before,
      },
      // Recorded per a sign-off condition attached to approving the fixed
      // gzip OS byte (0xFF, see FIXED_OS_BYTE below): the exact gzip bytes
      // this publication ships depend on the zlib build that produced them
      // (compression tables, header encoding details), even with a pinned
      // level/OS-byte/mtime=0, so a later reproduction attempt needs to know
      // what it is being compared against.
      generator: {
        node: process.version,
        zlib: process.versions.zlib,
        note: 'The exact gzip bytes in this publication depend on the Node/zlib build that produced ' +
          'them, not only on the pinned level, OS byte, and mtime=0 recorded in chunking/sourceChunking ' +
          'below - recorded here so a later reproduction attempt knows what it is being compared against.',
      },
      chunking: {
        targetBytes: chunkTargetBytes,
        gzipLevel: DEFAULT_LEVEL,
        gzipOsByte: FIXED_OS_BYTE,
        algorithm: 'line-atomic cumulative-byte NDJSON chunking; gzip mtime=0, fixed OS byte, no filename field',
      },
      sourceChunking: {
        targetBytes: sourceChunkTargetBytes,
        gzipLevel: DEFAULT_LEVEL,
        gzipOsByte: FIXED_OS_BYTE,
        algorithm: 'fixed-size raw-byte chunking (NOT line-atomic; source files may contain embedded ' +
          'newlines inside quoted CSV fields) - literal byte slices of the original file, concatenated ' +
          'back together in order on reconstruction; gzip mtime=0, fixed OS byte, no filename field',
      },
      datasets: datasetEntries,
      sources: sourceEntries,
      fixedFiles,
      totals,
      sourceTotals,
      chunkList,
      sourceChunkList,
    };
    const publicationManifestText = `${store.canonicalJson(publicationManifest)}\n`;
    ({ sha256: publicationManifestSha256 } = writeVerified(
      path.join(buildRoot, 'manifest.json'), Buffer.from(publicationManifestText, 'utf8'),
      { label: 'manifest.json' }
    ));

    // --- NOTICE.md / .gitattributes -----------------------------------------
    writeVerified(path.join(buildRoot, 'NOTICE.md'), Buffer.from(buildNotice(manifest), 'utf8'), { label: 'NOTICE.md' });
    writeVerified(path.join(buildRoot, '.gitattributes'), Buffer.from(GITATTRIBUTES_TEXT, 'utf8'), { label: '.gitattributes' });

    // --- verification.json ---------------------------------------------------
    verification = {
      sourceManifest: {
        sha256: manifestSha256Before,
        pinnedExpected: expectedManifestSha256 || null,
        pinnedMatch: expectedManifestSha256 ? manifestSha256Before === expectedManifestSha256 : null,
      },
      schema: schemaResults,
      externalIdOnlyInPlayers: externalIdResults,
      secretScan: secretScanResults,
      sourceScan: verifiedSources.map((v) => ({ source: v.sourceEntry.name, hits: v.scan.hits })),
      teamContradictions: teamContradictions.hasFindings
        ? { ...teamContradictions, acknowledged: true }
        : teamContradictions,
      reconstruction,
      sourceReconstruction,
      receiptScan,
      sourceManifestScan: {
        sourceManifest: sourceManifestScanResult,
        provenance: provenanceScanResult,
      },
    };
    const verificationText = `${store.canonicalJson(verification)}\n`;
    writeVerified(path.join(buildRoot, 'verification.json'), Buffer.from(verificationText, 'utf8'), { label: 'verification.json' });

    // --- explicit staging paths, never a git command ------------------------
    // Computed against the FINAL `publishRoot`, not the temporary build
    // directory: STAGING_PATHS.txt must name where these files will live
    // once promoted, and the internal relative structure written under
    // `buildRoot` is identical to what will exist under `publishRoot` after
    // the rename below.
    stagingPaths = buildStagingPaths({
      publishRoot,
      fixedFiles: [
        'manifest.json', 'NOTICE.md', '.gitattributes', 'dry-run-receipt.json',
        'dry-run-receipt-note.md', 'verification.json', 'STAGING_PATHS.txt',
        SOURCE_MANIFEST_FILENAME, SOURCES_PROVENANCE_FILENAME,
      ],
      chunkFiles: [...chunkList, ...sourceChunkList],
    });
    writeVerified(
      path.join(buildRoot, 'STAGING_PATHS.txt'), Buffer.from(`${stagingPaths.join('\n')}\n`, 'utf8'),
      { label: 'STAGING_PATHS.txt' }
    );
  } catch (err) {
    // Best-effort cleanup of the temp build directory so a failed BUILD does
    // not leave a stray `.tmp-package-*` directory behind - an operator only
    // ever has to look at `publishRoot`, which a failed build never touches.
    // This only covers failures WHILE BUILDING; a failure to PROMOTE (below,
    // outside this try/catch) is handled differently on purpose.
    try { fs.rmSync(buildRoot, { recursive: true, force: true }); } catch (_cleanupErr) { /* ignore */ }
    throw err;
  }

  // --- promote: atomic rename, only now, only on complete success ----------
  // Deliberately OUTSIDE the try/catch above: if `publishRoot` already
  // exists, the fully built and independently verified temp directory is
  // left in place on disk (never deleted) so a human operator can inspect
  // it or move it into place themselves - only a failure DURING THE BUILD
  // itself (caught above) is treated as garbage to clean up.
  //
  // ROUND 6 FIX: re-run the disjointness check one last time, immediately
  // before promote, against the REAL snapshotRoot/publishRoot/sourcesDir -
  // the same TOCTOU-closing re-check rehydrate.js's own promote step already
  // had (round 5), which this file's promote step was missing despite a
  // comment elsewhere describing the pair as symmetric. Closes the narrow
  // window between the initial check (before the potentially long
  // verification/chunking work above) and the actual rename.
  assertRootsDisjoint([
    { name: 'snapshotRoot', path: snapshotRoot },
    { name: 'publishRoot', path: publishRoot },
    { name: 'sourcesDir', path: sourcesDir },
  ]);
  assertPublishRootAbsentForPromote(publishRoot, buildRoot);
  fs.renameSync(buildRoot, publishRoot);

  log(`packaging complete: ${totals.datasets} dataset(s), ${totals.chunks} dataset chunk(s), ` +
    `${sourceTotals.sources} source(s), ${sourceTotals.chunks} source chunk(s), ` +
    `publication manifest sha256 ${publicationManifestSha256}`);

  return {
    manifest: publicationManifest,
    manifestSha256: publicationManifestSha256,
    verification,
    stagingPaths,
    loadedByDataset,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * ROUND 6 FIX ("missing CLI values restore real defaults", reproduced by a
 * third-party review): a trailing `--snapshot` with nothing after it used to
 * set `args.snapshot = argv[++i]`, i.e. `undefined` - and `packageSnapshot`'s
 * own destructuring default (`snapshotRoot = DEFAULT_SNAPSHOT_DIR`) then
 * silently treated that `undefined` as "not passed", reverting a malformed
 * invocation to the REAL production snapshot/publish directories instead of
 * failing loudly. This also rejects a value that is itself another flag
 * (`--snapshot --publish`), which a plain `undefined` check would miss.
 * Mirrors `rehydrate.js`'s own `requireFlagValue`.
 */
function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
    throw new Error(
      `packageSnapshot: ${flagName} requires a value ` +
      `(got ${value === undefined ? 'nothing' : JSON.stringify(value)})`
    );
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    snapshot: DEFAULT_SNAPSHOT_DIR,
    publish: DEFAULT_PUBLISH_DIR,
    sourcesDir: DEFAULT_SOURCES_DIR,
    provenance: DEFAULT_PROVENANCE_PATH,
    acknowledgeContradictions: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--snapshot') { args.snapshot = requireFlagValue(argv, ++i, '--snapshot'); }
    else if (token === '--publish') { args.publish = requireFlagValue(argv, ++i, '--publish'); }
    else if (token === '--sources-dir') { args.sourcesDir = requireFlagValue(argv, ++i, '--sources-dir'); }
    else if (token === '--provenance') { args.provenance = requireFlagValue(argv, ++i, '--provenance'); }
    else if (token === '--acknowledge-contradictions') args.acknowledgeContradictions = true;
    else throw new Error(`unknown argument ${token}`);
  }
  return args;
}

/**
 * The CLI entry point. Like `extract-snapshot.js` and `snapshot-checks.js`,
 * this file cannot supply `normalizeTeamKey` itself (that would require
 * `server/services/*`, which this tree may never import) - the real run is
 * `server/scripts/run-backtest-package.js`.
 */
function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const log = deps.log || console.log;
  if (typeof deps.normalizeTeamKey !== 'function') {
    log('No normalizeTeamKey was injected, so nothing was packaged.');
    log('The real run is: node server/scripts/run-backtest-package.js');
    return 1;
  }
  const readSource = deps.readSource
    || checks.makeSourceReader({ sourcesDir: args.sourcesDir, provenancePath: args.provenance });
  packageSnapshot({
    snapshotRoot: args.snapshot,
    publishRoot: args.publish,
    sourcesDir: args.sourcesDir,
    provenancePath: args.provenance,
    readSource,
    normalizeTeamKey: deps.normalizeTeamKey,
    acknowledgeContradictions: args.acknowledgeContradictions,
    log,
  });
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
  PINNED_SNAPSHOT_MANIFEST_SHA256,
  DEFAULT_SNAPSHOT_DIR,
  DEFAULT_PUBLISH_DIR,
  DEFAULT_SOURCES_DIR,
  DEFAULT_PROVENANCE_PATH,
  SOURCE_MANIFEST_FILENAME,
  SOURCES_PROVENANCE_FILENAME,
  TEMP_BUILD_DIR_PREFIX,
  GITATTRIBUTES_TEXT,
  DRY_RUN_RECEIPT_NOTE_TEXT,
  canonicalizeForCompare,
  normalizeForCompare,
  assertNotUncFormPath,
  isContainedIn,
  assertRootsDisjoint,
  assertDisjointRoots,
  chunkDir,
  chunkManifestPath,
  sourceChunkDir,
  sourceChunkManifestPath,
  fullCsvRows,
  verifyDatasets,
  runRealTeamContradictions,
  verifySources,
  packageOneDataset,
  packageOneSource,
  reconstructAndVerify,
  reconstructAndVerifySources,
  warnAboutLeakedTempDirs,
  assertPublishRootAbsentForPromote,
  buildNotice,
  buildStagingPaths,
  requireFlagValue,
  packageSnapshot,
  parseArgs,
  main,
};
