'use strict';

/**
 * The frozen local snapshot store for the reconstructed historical backtest.
 *
 * Everything the sweep will ever read lands here as NDJSON, one canonically
 * serialized JSON object per line, with a SHA-256 digest that is checked on
 * EVERY read rather than only at write time. Four separations are load-bearing
 * and are enforced by this module rather than by convention:
 *
 * 1. **Raw vs evaluation.** The RAW store keeps pinned provenance exactly as it
 *    came, which for `games.csv` includes 2026 rows (the file spans 1999-2026
 *    and the pin is of the whole file's bytes). The EVALUATION store is what
 *    the sweep computes on, and it may contain NOTHING at or after
 *    `QUARANTINE_FROM_SEASON`. 2026 is an untouched prospective holdout
 *    (preregistration section 17); a single 2026 row reaching an evaluated
 *    metric would silently spend it.
 *
 * 2. **Feature vs outcome.** A dataset is written into the feature path or the
 *    outcome path and can only be read back through the matching one. The
 *    oracle projection outputs for week W are outcomes; loading them into a
 *    feature path for week W is precisely the poisoning this harness exists to
 *    eliminate, so `loadForFeaturePath` refuses an outcome dataset by kind, not
 *    by name.
 *
 * 3. **Target-week cutoff.** A feature dataset may declare the target week it
 *    was cut for. When it does, both save and load prove every row is STRICTLY
 *    before it - the same inequality `projectionFeatures.assertNoFutureRows`
 *    enforces in production, applied to bytes on disk.
 *
 * 4. **Season-scoped vs not.** A dataset declares whether its rows carry a
 *    season. A season-scoped dataset's rows must each carry an integer season
 *    (a missing one throws rather than skipping the quarantine check), and a
 *    non-season-scoped dataset's rows must carry no season at all (so a
 *    season-bearing row cannot slip into a dataset whose quarantine check does
 *    not look).
 *
 * No network, no database, no environment: this module is fs, crypto and JSON.
 */

const fs = require('fs');
const path = require('path');

const { sha256Hex } = require('./verifiedBytes');

/**
 * The holdout boundary. Nothing at or after this season may enter the
 * evaluation store, be loaded from it, or be persisted as an evaluation row.
 * Preregistration section 17; plan rev 11 "2026 quarantine".
 */
const QUARANTINE_FROM_SEASON = 2026;

/** The two stores. `raw` keeps provenance; `evaluation` is what the sweep sees. */
const STORES = Object.freeze({ RAW: 'raw', EVALUATION: 'evaluation' });
const STORE_NAMES = Object.freeze([STORES.RAW, STORES.EVALUATION]);

/**
 * The three paths within a store.
 *
 * `feature` is the only one a model may ever read from. `outcome` holds
 * results (the oracle projections). `provenance` holds pinned source bytes
 * kept for audit, and is the one place a 2026 row is allowed to exist, so it
 * MUST be unreachable from a feature loader: `games.csv` spans 1999-2026, and
 * a caller who loaded it into a feature path without remembering to pass a
 * target would walk the holdout straight into the sweep. Separating it by path
 * kind makes that structural rather than a thing to remember.
 */
const PATHS = Object.freeze({ FEATURE: 'feature', OUTCOME: 'outcome', PROVENANCE: 'provenance' });
const PATH_NAMES = Object.freeze([PATHS.FEATURE, PATHS.OUTCOME, PATHS.PROVENANCE]);

/** On-disk directory for each path kind. */
const PATH_DIRS = Object.freeze({
  feature: 'features', outcome: 'outcomes', provenance: 'provenance',
});

/**
 * A dataset name is a bare lowercase identifier. No separator, no dot, no
 * traversal segment; see `datasetFile` for why this is checked rather than
 * assumed.
 */
const SAFE_DATASET_NAME = /^[a-z][a-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Pure: JSON with object keys sorted at every depth, so two runs that produce
 * the same rows produce the same bytes and therefore the same digest. Key
 * insertion order is a property of how a row was built (which columns a driver
 * happened to return first); it is not data, and letting it into the hash would
 * make the freeze manifest depend on it.
 *
 * `undefined` is refused rather than dropped: a row with an undefined field is
 * a row whose shape nobody decided, and silently omitting the key would make
 * two different rows hash the same.
 */
function canonicalJson(value) {
  if (value === undefined) throw new Error('canonicalJson: undefined is not serializable');
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalJson: ${String(value)} is not serializable as JSON`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      if (value[key] === undefined) {
        throw new Error(`canonicalJson: key ${JSON.stringify(key)} is undefined`);
      }
      parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new Error(`canonicalJson: cannot serialize ${typeof value}`);
}

/** Pure: rows -> NDJSON text (LF, trailing newline, empty text for no rows). */
function rowsToNdjson(rows) {
  if (!Array.isArray(rows)) throw new Error('rowsToNdjson requires an array of rows');
  if (rows.length === 0) return '';
  return `${rows.map(canonicalJson).join('\n')}\n`;
}

/** Pure: NDJSON text -> rows. A blank line is an error, never a skipped row. */
function ndjsonToRows(text, { label = 'ndjson' } = {}) {
  const src = String(text == null ? '' : text);
  if (src === '') return [];
  const lines = src.split('\n');
  if (lines[lines.length - 1] !== '') {
    throw new Error(`${label}: NDJSON must end with a newline`);
  }
  lines.pop();
  return lines.map((line, i) => {
    if (line === '') throw new Error(`${label}: blank line at record ${i + 1}`);
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`${label}: record ${i + 1} is not JSON (${err.message})`);
    }
  });
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function assertDatasetName(dataset) {
  const name = String(dataset == null ? '' : dataset);
  if (!SAFE_DATASET_NAME.test(name)) {
    throw new Error(
      `dataset name ${JSON.stringify(name)} is not a bare lowercase identifier ` +
      `(required shape ${SAFE_DATASET_NAME})`
    );
  }
  return name;
}

function assertStore(store) {
  if (!STORE_NAMES.includes(store)) {
    throw new Error(`unknown store ${JSON.stringify(store)} - expected one of ${STORE_NAMES.join(', ')}`);
  }
  return store;
}

function assertPathKind(pathKind) {
  if (!PATH_NAMES.includes(pathKind)) {
    throw new Error(`unknown path ${JSON.stringify(pathKind)} - expected one of ${PATH_NAMES.join(', ')}`);
  }
  return pathKind;
}

/**
 * The ONE place a dataset becomes a path on disk.
 *
 * Store, path kind and dataset name are each validated against a closed set or
 * a strict allowlist pattern first, so none of the three joined segments can
 * carry a separator, a traversal segment, or an absolute path; the result is
 * then re-proved to sit inside `root`, which catches a widened pattern as well
 * as a bad value. Do not relax `assertDatasetName` without revisiting this.
 */
function datasetFile(root, store, pathKind, dataset) {
  const safeStore = assertStore(store);
  const safePath = PATH_DIRS[assertPathKind(pathKind)];
  const safeName = assertDatasetName(dataset);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const file = path.join(String(root), safeStore, safePath, `${safeName}.ndjson`);
  // The next two lines ARE the containment check - the thing that proves the
  // join above could not escape `root`. Semgrep's taint model flags the
  // validator itself, so no amount of further validation can clear them; there
  // is nothing left to check that these lines are not already checking.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolvedRoot = path.resolve(String(root));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  if (!path.resolve(file).startsWith(resolvedRoot + path.sep)) {
    throw new Error(`refusing a snapshot path outside the store root: ${file}`);
  }
  return file;
}

function metaFile(root, store, pathKind, dataset) {
  return `${datasetFile(root, store, pathKind, dataset)}.meta.json`;
}

function manifestFile(root) {
  // Joins a CONSTANT literal filename onto the store root the caller named.
  // There is no caller-supplied component in the joined segment at all, so
  // there is nothing here to validate; semgrep treats the root as tainted
  // regardless of what it is.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return path.join(String(root), 'manifest.json');
}

/**
 * The dry-run receipt: proof that this exact run was planned and checked before
 * it was allowed to write. See `extract-snapshot.assertDryRunReceipt`.
 */
function receiptFile(root) {
  // Joins a CONSTANT literal filename onto the store root - same reasoning as
  // manifestFile above.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return path.join(String(root), 'dry-run-receipt.json');
}

// ---------------------------------------------------------------------------
// Quarantine + cutoff guards
// ---------------------------------------------------------------------------

/**
 * Pure: a row's season as an integer, or null when the row carries none.
 * `''`, `null` and a non-numeric string all read as "no season"; a numeric
 * string reads as its number, because a driver that returns bigint columns as
 * text must not be able to walk a 2026 row past the quarantine.
 */
function seasonOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(row, 'season')) return null;
  const raw = row.season;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fail loud on any row the quarantine forbids in this store.
 *
 * Season-scoped datasets must carry a season on every row: a row that lost its
 * season is a row the quarantine cannot check, and "cannot check" is a failure
 * here, not a pass. Non-season-scoped datasets must carry no season at all, so
 * a season-bearing row cannot hide in a dataset nobody screens.
 */
function assertQuarantine(rows, { store, dataset, seasonScoped }) {
  const label = `${store}/${dataset}`;
  for (let i = 0; i < rows.length; i++) {
    const season = seasonOf(rows[i]);
    if (!seasonScoped) {
      if (season !== null) {
        throw new Error(
          `${label}: row ${i + 1} carries season ${season} but the dataset is declared not ` +
          'season-scoped - refusing to store a season-bearing row where the quarantine does not look'
        );
      }
      continue;
    }
    if (season === null) {
      throw new Error(
        `${label}: row ${i + 1} has no usable season and the dataset is season-scoped - ` +
        'the 2026 quarantine cannot be checked on it'
      );
    }
    if (!Number.isInteger(season)) {
      throw new Error(`${label}: row ${i + 1} has a non-integer season ${season}`);
    }
    if (store === STORES.EVALUATION && season >= QUARANTINE_FROM_SEASON) {
      throw new Error(
        `${label}: row ${i + 1} is season ${season}, at or after the quarantine boundary ` +
        `${QUARANTINE_FROM_SEASON}. 2026 is an untouched prospective holdout and may exist only ` +
        'in the raw provenance store'
      );
    }
  }
  return true;
}

/**
 * Fail loud unless every row is STRICTLY before the target season-week - the
 * same inequality production spells in SQL and re-checks in
 * `projectionFeatures.assertNoFutureRows`. A row AT the target week is the
 * poisoning case, not an edge case, so `>=` is deliberate.
 */
function assertBeforeTarget(rows, target, { label = 'feature dataset' } = {}) {
  const season = Number(target && target.season);
  const week = Number(target && target.week);
  if (!Number.isInteger(season) || !Number.isInteger(week)) {
    throw new Error(`${label}: a feature-path cutoff needs an integer target season and week`);
  }
  for (let i = 0; i < rows.length; i++) {
    const rowSeason = seasonOf(rows[i]);
    if (rowSeason === null) continue; // not season-scoped; nothing to cut
    const rowWeek = rows[i].week === null || rows[i].week === undefined ? null : Number(rows[i].week);
    const atOrAfter = rowSeason > season
      || (rowSeason === season && (rowWeek === null || !Number.isFinite(rowWeek) || rowWeek >= week));
    if (atOrAfter) {
      throw new Error(
        `${label}: row ${i + 1} is season ${rowSeason} week ${rows[i].week}, which is not strictly ` +
        `before the target ${season} week ${week} - a target-week row in the feature path is poisoning`
      );
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------

/**
 * Write one dataset plus its sidecar metadata, and return the record the
 * manifest should pin.
 *
 * The sidecar exists so a load can verify itself without a manifest (the
 * snapshot is checked long before the freeze manifest is written). It is NOT a
 * substitute for the manifest: an attacker or a bad merge that rewrites both
 * the NDJSON and its sidecar is caught by `snapshot-checks.js` comparing the
 * sidecar against the manifest's independently recorded digest.
 */
function saveDataset({ root, store, path: pathKind, dataset, rows, seasonScoped, target = null }) {
  assertStore(store);
  assertPathKind(pathKind);
  assertDatasetName(dataset);
  if (!Array.isArray(rows)) throw new Error(`${dataset}: saveDataset requires an array of rows`);
  if (typeof seasonScoped !== 'boolean') {
    throw new Error(`${dataset}: seasonScoped must be declared explicitly (true or false)`);
  }
  if (target && pathKind !== PATHS.FEATURE) {
    throw new Error(
      `${dataset}: only a feature-path dataset carries a target-week cutoff ` +
      '(an outcome IS about its week)'
    );
  }
  assertQuarantine(rows, { store, dataset, seasonScoped });
  if (target) assertBeforeTarget(rows, target, { label: `${store}/${dataset}` });

  const text = rowsToNdjson(rows);
  const bytes = Buffer.from(text, 'utf8');
  const digest = sha256Hex(bytes);
  const meta = {
    dataset,
    store,
    path: pathKind,
    seasonScoped,
    rowCount: rows.length,
    sha256: digest,
    byteLength: bytes.length,
  };
  if (target) meta.target = { season: Number(target.season), week: Number(target.week) };

  const file = datasetFile(root, store, pathKind, dataset);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const readBack = fs.readFileSync(file);
  if (sha256Hex(readBack) !== digest) {
    throw new Error(`${store}/${dataset}: file on disk does not hash to the bytes written`);
  }
  fs.writeFileSync(metaFile(root, store, pathKind, dataset), `${canonicalJson(meta)}\n`);
  return meta;
}

function readMeta(root, store, pathKind, dataset) {
  const file = metaFile(root, store, pathKind, dataset);
  if (!fs.existsSync(file)) {
    throw new Error(`${store}/${dataset}: no sidecar metadata at ${file}`);
  }
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (meta.dataset !== dataset || meta.store !== store || meta.path !== pathKind) {
    throw new Error(
      `${store}/${dataset}: sidecar describes ${meta.store}/${meta.dataset} on the ${meta.path} path`
    );
  }
  return meta;
}

/**
 * Load one dataset, verifying its digest, its row count, the quarantine, and
 * (when the dataset declares one) its target-week cutoff. `expectedSha256`
 * additionally pins the load to a manifest-recorded digest.
 */
function loadDataset({ root, store, path: pathKind, dataset, expectedSha256 = null }) {
  assertStore(store);
  assertPathKind(pathKind);
  assertDatasetName(dataset);
  const meta = readMeta(root, store, pathKind, dataset);
  const file = datasetFile(root, store, pathKind, dataset);
  if (!fs.existsSync(file)) throw new Error(`${store}/${dataset}: no dataset at ${file}`);
  const bytes = fs.readFileSync(file);
  const digest = sha256Hex(bytes);
  if (digest !== meta.sha256) {
    throw new Error(
      `${store}/${dataset}: digest mismatch - bytes on disk hash to ${digest}, the sidecar records ` +
      `${meta.sha256}. A snapshot that no longer hashes to what was extracted is not the snapshot.`
    );
  }
  if (expectedSha256 && digest !== expectedSha256) {
    throw new Error(
      `${store}/${dataset}: digest ${digest} does not match the pinned ${expectedSha256}`
    );
  }
  const rows = ndjsonToRows(bytes.toString('utf8'), { label: `${store}/${dataset}` });
  if (rows.length !== meta.rowCount) {
    throw new Error(
      `${store}/${dataset}: ${rows.length} rows on disk, sidecar records ${meta.rowCount}`
    );
  }
  // Re-checked on READ, not only on write: the quarantine has to hold against a
  // store that was edited, merged, or restored from somewhere else.
  assertQuarantine(rows, { store, dataset, seasonScoped: meta.seasonScoped });
  if (meta.target) assertBeforeTarget(rows, meta.target, { label: `${store}/${dataset}` });
  return { rows, meta };
}

/**
 * Load a dataset INTO A FEATURE PATH for a specific target week.
 *
 * Three refusals, all structural:
 *   - an OUTCOME dataset can never be read here, whatever it is called. The
 *     oracle outputs for week W live in the outcome path precisely so that
 *     loading them as week-W features is impossible rather than merely unwise;
 *   - a PROVENANCE dataset can never be read here either. `games_csv` retains
 *     2026 rows by design, and it is the one dataset in the snapshot that does;
 *     a caller who reached it from a feature loader and forgot to pass a target
 *     would spend the prospective holdout silently. The refusal does not depend
 *     on that caller remembering anything;
 *   - when a target IS supplied, every row must be strictly before it.
 *
 * The wrong-path cases are named explicitly rather than left to surface as a
 * missing-file error, because "no sidecar metadata" would send an operator
 * looking for a corrupt snapshot instead of a mis-routed read.
 */
function loadForFeaturePath({ root, store, dataset, target = null, expectedSha256 = null }) {
  for (const [wrongPath, article, why] of [
    [PATHS.OUTCOME, 'an',
      'An outcome for week W read as a week-W feature is the poisoning case itself.'],
    [PATHS.PROVENANCE, 'a',
      'Provenance retains rows at or after the quarantine boundary on purpose; reading it as a '
      + 'feature is how a prospective holdout gets spent.'],
  ]) {
    if (datasetExists({ root, store, path: wrongPath, dataset })) {
      throw new Error(
        `${store}/${dataset} is ${article} ${wrongPath} dataset and may never be read into the ` +
        `feature path. ${why}`
      );
    }
  }
  const loaded = loadDataset({ root, store, path: PATHS.FEATURE, dataset, expectedSha256 });
  if (target) assertBeforeTarget(loaded.rows, target, { label: `${store}/${dataset}` });
  return loaded;
}

/** Does a dataset exist in the store? (No digest work; for inventory only.) */
function datasetExists({ root, store, path: pathKind, dataset }) {
  return fs.existsSync(datasetFile(root, store, pathKind, dataset))
    && fs.existsSync(metaFile(root, store, pathKind, dataset));
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** Write the extraction manifest canonically (sorted keys, LF, one newline). */
function saveManifest(root, manifest) {
  const file = manifestFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${canonicalJson(manifest)}\n`;
  fs.writeFileSync(file, text, 'utf8');
  return { path: file, sha256: sha256Hex(Buffer.from(text, 'utf8')), byteLength: text.length };
}

function loadManifest(root) {
  const file = manifestFile(root);
  if (!fs.existsSync(file)) throw new Error(`no snapshot manifest at ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Number(manifest.quarantineFromSeason) !== QUARANTINE_FROM_SEASON) {
    throw new Error(
      `manifest declares quarantineFromSeason ${manifest.quarantineFromSeason}, this build enforces ` +
      `${QUARANTINE_FROM_SEASON} - refusing to read a snapshot cut under a different holdout boundary`
    );
  }
  return manifest;
}

module.exports = {
  QUARANTINE_FROM_SEASON,
  STORES,
  STORE_NAMES,
  PATHS,
  PATH_NAMES,
  PATH_DIRS,
  SAFE_DATASET_NAME,
  canonicalJson,
  rowsToNdjson,
  ndjsonToRows,
  seasonOf,
  assertQuarantine,
  assertBeforeTarget,
  assertDatasetName,
  datasetFile,
  metaFile,
  manifestFile,
  receiptFile,
  saveDataset,
  loadDataset,
  loadForFeaturePath,
  datasetExists,
  readMeta,
  saveManifest,
  loadManifest,
};
