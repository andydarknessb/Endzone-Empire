const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../../scripts/backtest/lib/snapshotStore');
const {
  sha256Hex,
  readProvenanceRecords,
} = require('../../scripts/backtest/lib/verifiedBytes');

/**
 * Every test here is pure: a temporary directory, canned rows, no database, no
 * network, no environment. The store is the last line of defence for the 2026
 * quarantine and for feature-path poisoning, so the guards get mutation-style
 * attention: for each one there is a test that fails if the inequality or the
 * store/path comparison is loosened.
 */

function tmpRoot(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ez-snap-${label}-`));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// --- canonical serialization ------------------------------------------------

test('canonicalJson sorts keys at every depth so equal rows hash equally', () => {
  const a = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
  const b = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 };
  assert.equal(store.canonicalJson(a), store.canonicalJson(b));
  assert.equal(store.canonicalJson(a), '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
});

test('canonicalJson refuses what JSON cannot round-trip, instead of dropping it', () => {
  assert.throws(() => store.canonicalJson(undefined), /not serializable/);
  assert.throws(() => store.canonicalJson({ a: undefined }), /is undefined/);
  assert.throws(() => store.canonicalJson(Number.NaN), /not serializable/);
  assert.throws(() => store.canonicalJson(Infinity), /not serializable/);
  // A dropped undefined would make two different rows hash the same, which is
  // exactly the silent collision the freeze manifest cannot tolerate.
  assert.notEqual(store.canonicalJson({ a: 1, b: null }), store.canonicalJson({ a: 1 }));
});

test('NDJSON round-trips, and a blank line is an error rather than a skipped row', () => {
  const rows = [{ season: 2024, week: 3 }, { season: 2025, week: 1 }];
  const text = store.rowsToNdjson(rows);
  assert.equal(text, '{"season":2024,"week":3}\n{"season":2025,"week":1}\n');
  assert.deepEqual(store.ndjsonToRows(text), rows);
  assert.deepEqual(store.rowsToNdjson([]), '');
  assert.deepEqual(store.ndjsonToRows(''), []);
  assert.throws(() => store.ndjsonToRows('{"a":1}\n\n{"a":2}\n'), /blank line at record 2/);
  assert.throws(() => store.ndjsonToRows('{"a":1}'), /must end with a newline/);
  assert.throws(() => store.ndjsonToRows('not json\n'), /is not JSON/);
});

// --- the quarantine ---------------------------------------------------------

test('QUARANTINE_FROM_SEASON is 2026, the preregistered holdout boundary', () => {
  assert.equal(store.QUARANTINE_FROM_SEASON, 2026);
});

test('the evaluation store refuses a 2026 row on save AND on load', () => {
  const root = tmpRoot('quarantine');
  const good = [{ season: 2025, week: 18, v: 1 }];
  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'games', rows: good, seasonScoped: true,
  });
  assert.equal(store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'games',
  }).rows.length, 1);

  assert.throws(() => store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'poisoned', rows: [{ season: 2026, week: 1 }], seasonScoped: true,
  }), /at or after the quarantine boundary 2026/);
  assert.equal(
    fs.existsSync(store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'poisoned')),
    false,
    'a refused save writes nothing'
  );

  // MUTATION: the load-time check is independent of the save-time one. Write a
  // 2026 row through the raw store (where it is legal), then move the bytes and
  // sidecar into the evaluation store and prove the LOAD still refuses it.
  store.saveDataset({
    root, store: store.STORES.RAW, path: store.PATHS.FEATURE,
    dataset: 'smuggled', rows: [{ season: 2026, week: 1 }], seasonScoped: true,
  });
  const from = store.datasetFile(root, store.STORES.RAW, store.PATHS.FEATURE, 'smuggled');
  const to = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'smuggled');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const meta = JSON.parse(fs.readFileSync(`${from}.meta.json`, 'utf8'));
  meta.store = store.STORES.EVALUATION;
  fs.writeFileSync(`${to}.meta.json`, `${store.canonicalJson(meta)}\n`);
  assert.throws(() => store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'smuggled',
  }), /at or after the quarantine boundary 2026/);
});

test('the raw provenance store accepts games.csv 2026 rows, which is the whole point of it', () => {
  const root = tmpRoot('raw2026');
  const rows = [
    { game_id: '2025_01_x', season: 2025, week: 1 },
    { game_id: '2026_01_y', season: 2026, week: 1 },
  ];
  const meta = store.saveDataset({
    root, store: store.STORES.RAW, path: store.PATHS.FEATURE,
    dataset: 'games_csv', rows, seasonScoped: true,
  });
  assert.equal(meta.rowCount, 2);
  const loaded = store.loadDataset({
    root, store: store.STORES.RAW, path: store.PATHS.FEATURE, dataset: 'games_csv',
  });
  assert.deepEqual(loaded.rows.map((r) => r.season), [2025, 2026]);
});

test('a season-scoped row with no usable season fails closed rather than skipping the check', () => {
  const root = tmpRoot('noseason');
  for (const rows of [[{ week: 1 }], [{ season: null, week: 1 }], [{ season: '', week: 1 }],
    [{ season: 'twenty-six', week: 1 }]]) {
    assert.throws(() => store.saveDataset({
      root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
      dataset: 'x', rows, seasonScoped: true,
    }), /no usable season/);
  }
  assert.throws(() => store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'x', rows: [{ season: 2025.5 }], seasonScoped: true,
  }), /non-integer season/);
});

test('a non-season-scoped dataset refuses a season-bearing row, so nothing hides where nobody looks', () => {
  const root = tmpRoot('unscoped');
  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'players', rows: [{ id: 1, name: 'A' }], seasonScoped: false,
  });
  assert.throws(() => store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'players2', rows: [{ id: 1, season: 2026 }], seasonScoped: false,
  }), /declared not season-scoped/);
});

test('a numeric-string season cannot walk past the quarantine', () => {
  const root = tmpRoot('strseason');
  assert.throws(() => store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'x', rows: [{ season: '2026', week: 1 }], seasonScoped: true,
  }), /at or after the quarantine boundary 2026/);
});

// --- the feature-path poisoning guard ---------------------------------------

test('assertBeforeTarget refuses a row AT the target week, not only after it', () => {
  const target = { season: 2025, week: 9 };
  store.assertBeforeTarget([{ season: 2025, week: 8 }, { season: 2024, week: 18 }], target);
  // MUTATION: `>=` relaxed to `>` in the week comparison would let this pass.
  assert.throws(
    () => store.assertBeforeTarget([{ season: 2025, week: 9 }], target),
    /not strictly before the target 2025 week 9/
  );
  assert.throws(
    () => store.assertBeforeTarget([{ season: 2025, week: 10 }], target),
    /not strictly before/
  );
  assert.throws(
    () => store.assertBeforeTarget([{ season: 2026, week: 1 }], target),
    /not strictly before/
  );
  // A season-scoped row with no week cannot be proved to be before the cutoff.
  assert.throws(
    () => store.assertBeforeTarget([{ season: 2025 }], target),
    /not strictly before/
  );
  assert.throws(() => store.assertBeforeTarget([], {}), /needs an integer target season and week/);
});

test('a feature dataset that declares a target enforces the cutoff on save and on load', () => {
  const root = tmpRoot('cutoff');
  const target = { season: 2025, week: 5 };
  assert.throws(() => store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'cut', rows: [{ season: 2025, week: 5 }], seasonScoped: true, target,
  }), /a target-week row in the feature path is poisoning/);

  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'cut', rows: [{ season: 2025, week: 4 }], seasonScoped: true, target,
  });
  // Append a target-week row and re-point the sidecar's digest and count at it:
  // the sidecar now agrees with the bytes, so ONLY the cutoff check can catch it.
  const file = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'cut');
  const tampered = `${fs.readFileSync(file, 'utf8')}{"season":2025,"week":5}\n`;
  fs.writeFileSync(file, tampered);
  const metaPath = `${file}.meta.json`;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.sha256 = sha256Hex(Buffer.from(tampered, 'utf8'));
  meta.rowCount = 2;
  meta.byteLength = Buffer.byteLength(tampered, 'utf8');
  fs.writeFileSync(metaPath, `${store.canonicalJson(meta)}\n`);
  assert.throws(() => store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'cut',
  }), /a target-week row in the feature path is poisoning/);
});

test('an outcome dataset may not declare a target-week cutoff (an outcome IS about its week)', () => {
  const root = tmpRoot('outcometarget');
  assert.throws(() => store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.OUTCOME,
    dataset: 'oracle_2025_w9', rows: [{ season: 2025, week: 9 }], seasonScoped: true,
    target: { season: 2025, week: 9 },
  }), /only a feature-path dataset carries a target-week cutoff/);
});

test('loadForFeaturePath refuses an outcome dataset by kind, whatever it is called', () => {
  const root = tmpRoot('featurepath');
  const rows = [{ season: 2025, week: 9, player_id: 1, projection: { median: 12.5 } }];
  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.OUTCOME,
    dataset: 'oracle_2025_w9', rows, seasonScoped: true,
  });
  // The oracle output for week 9 exists on disk and loads fine as an OUTCOME.
  assert.equal(store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.OUTCOME, dataset: 'oracle_2025_w9',
  }).rows.length, 1);
  // Reading the same dataset into a feature path for week 9 is the poisoning
  // case, and it is refused by KIND with an error that says so - not left to
  // surface as a confusing missing-file error.
  assert.throws(() => store.loadForFeaturePath({
    root, store: store.STORES.EVALUATION, dataset: 'oracle_2025_w9',
    target: { season: 2025, week: 9 },
  }), /is an outcome dataset and may never be read into the feature path/);

  // And when a feature dataset genuinely holds a target-week row, the cutoff
  // supplied at read time catches it.
  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'stats', rows: [{ season: 2025, week: 9, v: 1 }], seasonScoped: true,
  });
  assert.throws(() => store.loadForFeaturePath({
    root, store: store.STORES.EVALUATION, dataset: 'stats', target: { season: 2025, week: 9 },
  }), /a target-week row in the feature path is poisoning/);
  assert.equal(store.loadForFeaturePath({
    root, store: store.STORES.EVALUATION, dataset: 'stats', target: { season: 2025, week: 10 },
  }).rows.length, 1);
});

test('a provenance dataset can never be read into a feature path, target or no target', () => {
  const root = tmpRoot('provpath');
  // games.csv provenance: the ONE dataset in the snapshot that legitimately
  // holds a 2026 row.
  store.saveDataset({
    root, store: store.STORES.RAW, path: store.PATHS.PROVENANCE, dataset: 'games_csv',
    rows: [{ season: 2025, week: 1, game_id: 'a' }, { season: 2026, week: 1, game_id: 'b' }],
    seasonScoped: true,
  });
  assert.equal(store.loadDataset({
    root, store: store.STORES.RAW, path: store.PATHS.PROVENANCE, dataset: 'games_csv',
  }).rows.length, 2, 'it loads fine as provenance');

  // The dangerous call is the one that FORGETS the target - if the refusal
  // depended on passing one, this is exactly the call that would spend the
  // holdout. It is refused by path kind instead, so forgetting cannot happen.
  assert.throws(() => store.loadForFeaturePath({
    root, store: store.STORES.RAW, dataset: 'games_csv',
  }), /is a provenance dataset and may never be read into the feature path/);
  assert.throws(() => store.loadForFeaturePath({
    root, store: store.STORES.RAW, dataset: 'games_csv', target: { season: 2025, week: 18 },
  }), /is a provenance dataset and may never be read into the feature path/);
  // And the message says WHY, so nobody "fixes" it by moving the file.
  assert.throws(() => store.loadForFeaturePath({
    root, store: store.STORES.RAW, dataset: 'games_csv',
  }), /prospective holdout gets spent/);

  // The three path kinds are a closed set with distinct directories.
  assert.deepEqual([...store.PATH_NAMES].sort(), ['feature', 'outcome', 'provenance']);
  assert.deepEqual(
    store.PATH_NAMES.map((p) => store.PATH_DIRS[p]).sort(),
    ['features', 'outcomes', 'provenance']
  );
});

// --- digest verification ----------------------------------------------------

test('a tampered NDJSON file refuses to load', () => {
  const root = tmpRoot('digest');
  const rows = [{ season: 2024, week: 1, points: 10 }];
  const meta = store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'stats', rows, seasonScoped: true,
  });
  const file = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'stats');
  fs.writeFileSync(file, '{"season":2024,"week":1,"points":99}\n');
  assert.throws(() => store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'stats',
  }), /digest mismatch/);

  // Restoring the bytes restores the load, and the manifest pin is a second,
  // independent gate on top of the sidecar.
  fs.writeFileSync(file, store.rowsToNdjson(rows));
  assert.equal(store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'stats',
    expectedSha256: meta.sha256,
  }).rows[0].points, 10);
  assert.throws(() => store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'stats',
    expectedSha256: 'f'.repeat(64),
  }), /does not match the pinned/);
});

test('a sidecar rewritten to match tampered bytes is still caught by the row count', () => {
  const root = tmpRoot('sidecar');
  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'stats', rows: [{ season: 2024, week: 1 }], seasonScoped: true,
  });
  const file = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'stats');
  const text = '{"season":2024,"week":1}\n{"season":2024,"week":2}\n';
  fs.writeFileSync(file, text);
  const metaPath = `${file}.meta.json`;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.sha256 = sha256Hex(Buffer.from(text, 'utf8')); // digest now agrees
  fs.writeFileSync(metaPath, `${store.canonicalJson(meta)}\n`);
  assert.throws(() => store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'stats',
  }), /2 rows on disk, sidecar records 1/);
});

test('a sidecar describing a different dataset, store or path is refused', () => {
  const root = tmpRoot('sidecarid');
  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'stats', rows: [], seasonScoped: true,
  });
  const metaPath = `${store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'stats')}.meta.json`;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.store = store.STORES.RAW;
  fs.writeFileSync(metaPath, `${store.canonicalJson(meta)}\n`);
  assert.throws(() => store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'stats',
  }), /sidecar describes raw\/stats/);
});

test('a missing sidecar or missing dataset is an error, not an empty read', () => {
  const root = tmpRoot('missing');
  assert.throws(() => store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'nope',
  }), /no sidecar metadata/);
});

// --- names, stores, paths ---------------------------------------------------

test('dataset names, stores and paths are closed sets, so no path can escape the root', () => {
  const root = tmpRoot('names');
  for (const bad of ['../escape', 'a/b', 'a\\b', '..', 'Upper', '1leading', 'has.dot', '']) {
    assert.throws(() => store.assertDatasetName(bad), /bare lowercase identifier/, `rejects ${bad}`);
  }
  assert.equal(store.assertDatasetName('nfl_games_2024'), 'nfl_games_2024');
  assert.throws(() => store.datasetFile(root, 'production', store.PATHS.FEATURE, 'x'), /unknown store/);
  assert.throws(() => store.datasetFile(root, store.STORES.RAW, 'sideways', 'x'), /unknown path/);
  const file = store.datasetFile(root, store.STORES.RAW, store.PATHS.OUTCOME, 'x');
  assert.ok(path.resolve(file).startsWith(path.resolve(root) + path.sep));
  assert.ok(file.endsWith(`${path.sep}raw${path.sep}outcomes${path.sep}x.ndjson`));
});

test('seasonScoped must be declared explicitly, never inferred', () => {
  const root = tmpRoot('declare');
  assert.throws(() => store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'x', rows: [],
  }), /seasonScoped must be declared explicitly/);
});

// --- the manifest -----------------------------------------------------------

test('the manifest round-trips canonically and refuses a different quarantine boundary', () => {
  const root = tmpRoot('manifest');
  const manifest = { studyId: 'pit-sweep-2024-2025', quarantineFromSeason: 2026, b: 1, a: 2 };
  const written = store.saveManifest(root, manifest);
  assert.equal(written.sha256, sha256Hex(fs.readFileSync(store.manifestFile(root))));
  const text = fs.readFileSync(store.manifestFile(root), 'utf8');
  assert.ok(text.startsWith('{"a":2,"b":1,'), 'keys are sorted');
  assert.ok(text.endsWith('\n'));
  assert.equal(store.loadManifest(root).studyId, 'pit-sweep-2024-2025');

  fs.writeFileSync(store.manifestFile(root),
    `${store.canonicalJson({ ...manifest, quarantineFromSeason: 2027 })}\n`);
  assert.throws(() => store.loadManifest(root), /refusing to read a snapshot cut under a different holdout/);
});

// --- the split that keeps Phase 1 unable to fetch ---------------------------

test('verifiedBytes requires no transport, so a hash-verified read cannot pull in a fetcher', () => {
  const file = path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'verifiedBytes.js');
  const text = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const requires = [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(requires.sort(), ['crypto', 'fs', 'path']);
});

test('readProvenanceRecords fails closed on a missing, empty or duplicated provenance file', () => {
  const dir = tmpRoot('prov');
  const file = path.join(dir, 'provenance.json');
  assert.throws(() => readProvenanceRecords(file), /no Phase-0 provenance/);
  fs.writeFileSync(file, JSON.stringify({ records: [] }));
  assert.throws(() => readProvenanceRecords(file), /carries no records/);
  fs.writeFileSync(file, JSON.stringify({ records: [{ name: 'a' }] }));
  assert.throws(() => readProvenanceRecords(file), /has no recorded sha256/);
  fs.writeFileSync(file, JSON.stringify({
    records: [{ name: 'a', sha256: 'x' }, { name: 'a', sha256: 'y' }],
  }));
  assert.throws(() => readProvenanceRecords(file), /duplicate provenance record/);
  fs.writeFileSync(file, JSON.stringify({ records: [{ name: 'a', sha256: 'x' }] }));
  assert.equal(readProvenanceRecords(file).get('a').sha256, 'x');
});
