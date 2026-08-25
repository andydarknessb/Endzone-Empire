const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const packager = require('../../scripts/backtest/package-snapshot');
const rehydrate = require('../../scripts/backtest/rehydrate');
const checks = require('../../scripts/backtest/snapshot-checks');
const store = require('../../scripts/backtest/lib/snapshotStore');
const { sha256Hex } = require('../../scripts/backtest/lib/verifiedBytes');
const { gzipDeterministic } = require('../../scripts/backtest/lib/deterministicGzip');
const { SOURCES: REAL_SOURCES } = require('../../scripts/backtest/lib/sources');
const { normalizeTeamKey } = require('../services/projectionFeatures');

/**
 * `rehydrate.js` is exercised here against a real, freshly-PACKAGED
 * fixture publication (built with `packager.packageSnapshot`, not a
 * hand-rolled manifest) - the same fixture shape `backtestPackageSnapshot
 * .test.js` uses, kept small on purpose. `backtestCleanClone.test.js` is
 * the one that proves the REAL, regenerated publication rehydrates and
 * reproduces the study end to end; this file is about `rehydrate.js`'s own
 * failure modes and its exact on-disk output shape.
 */

function tmpDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ez-rehydrate-${label}-`));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tmpPublishPath(label) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `ez-rehydrate-${label}-parent-`));
  test.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return path.join(parent, 'publish');
}

function csv(header, rows) {
  return [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n';
}

function fixtureSourceCsvText(sourceEntry) {
  switch (sourceEntry.kind) {
    case 'roster_weekly':
      return csv(sourceEntry.requiredColumns, [{
        season: sourceEntry.season, week: 1, team: 'KC', position: 'QB', status: 'ACT',
        gsis_id: '00-0000001', full_name: 'Fixture Player', game_type: 'REG',
      }]);
    case 'injuries':
      return csv(sourceEntry.requiredColumns, [{
        season: sourceEntry.season, week: 1, team: 'KC', gsis_id: '00-0000001',
        report_status: 'Questionable', game_type: 'REG', full_name: 'Fixture Player', position: 'QB',
      }]);
    case 'games':
      return csv(sourceEntry.requiredColumns, [{
        game_id: '2024_01_BUF_KC', season: 2024, game_type: 'REG', week: 1,
        gameday: '2024-09-08', gametime: '13:00:00', away_team: 'BUF', home_team: 'KC',
        away_score: 20, home_score: 27, location: 'Home',
      }]);
    case 'stats_player_week':
      return csv(sourceEntry.requiredColumns, [{
        season: sourceEntry.season, week: 1, season_type: 'REG', player_id: '00-0000001',
        team: 'KC', position: 'QB',
      }]);
    case 'stats_team_week':
      return csv(sourceEntry.requiredColumns, [{
        season: sourceEntry.season, week: 1, season_type: 'REG', team: 'KC', opponent_team: 'BUF',
      }]);
    case 'players':
      return csv(sourceEntry.requiredColumns, [{ gsis_id: '00-0000001', espn_id: '4241' }]);
    default:
      throw new Error(`fixtureSourceCsvText: unhandled source kind ${sourceEntry.kind}`);
  }
}

function buildFixtureSources() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-sources-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const records = [];
  let gamesCsvSha256 = null;
  for (const sourceEntry of REAL_SOURCES) {
    const bytes = Buffer.from(fixtureSourceCsvText(sourceEntry), 'utf8');
    fs.writeFileSync(path.join(dir, sourceEntry.file), bytes);
    const sha256 = sha256Hex(bytes);
    if (sourceEntry.name === 'games') gamesCsvSha256 = sha256;
    records.push({ name: sourceEntry.name, file: sourceEntry.file, sha256, byteLength: bytes.length });
  }
  const provenancePath = path.join(dir, 'provenance.json');
  fs.writeFileSync(provenancePath, `${JSON.stringify({ generator: 'test-fixture', records }, null, 2)}\n`, 'utf8');
  return { sourcesDir: dir, provenancePath, gamesCsvSha256, records };
}

const FIXTURE_SOURCES = buildFixtureSources();

function buildFixtureSnapshot(root) {
  const datasets = [
    {
      dataset: 'players', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false,
      rows: [{ id: 1, external_id: 4241, name: 'Fixture Player', position: 'QB', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: '12.5', team_key: 'KC' }],
    },
    {
      dataset: 'player_stats', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true,
      rows: [{ player_id: 1, season: 2024, week: 1, stats: { passingYards: 250, passingTDs: 2, gameTeam: 'KC', gameOpponent: 'BUF' } }],
    },
    {
      dataset: 'games_csv', store: store.STORES.RAW, path: store.PATHS.PROVENANCE, seasonScoped: true,
      rows: [{ game_id: '2024_01_BUF_KC', season: 2024, game_type: 'REG', week: 1, away_team: 'BUF', home_team: 'KC', location: 'Home' }],
    },
  ];
  const written = datasets.map((d) => store.saveDataset({ root, ...d }));
  const manifest = {
    studyId: 'fixture-study', generator: 'test-fixture', extractedAt: '2026-01-01T00:00:00.000Z',
    planDigest: 'fixture-plan-digest', quarantineFromSeason: store.QUARANTINE_FROM_SEASON,
    seasons: [2024], datasets: written,
    // The sealed manifest's OWN sources array - what rehydrate.js's
    // readAndParseSealedSourceManifest binds every rehydrated raw source's
    // hash to (round 6 fix). A real Gate-2 extraction always writes this (see
    // extract-snapshot.js); this fixture must carry a matching one, built
    // from the exact same records buildFixtureSources() computed for the
    // fixture sources directory itself, or rehydration of every fixture
    // publication in this file would fail the new sealed-source binding check.
    sources: FIXTURE_SOURCES.records.map(({ name, sha256, byteLength, file }) => ({ name, sha256, byteLength, file })),
  };
  store.saveManifest(root, manifest);
  fs.writeFileSync(store.receiptFile(root), `${store.canonicalJson({
    studyId: 'fixture-study', planDigest: 'fixture-digest', dryRunAt: '2026-01-01T00:00:00.000Z',
    rowCounts: {}, wouldWrite: [],
  })}\n`, 'utf8');
  const manifestSha256 = sha256Hex(fs.readFileSync(store.manifestFile(root)));
  return { manifestSha256 };
}

function makeFixtureReadSource() {
  return (arg) => {
    const name = typeof arg === 'string' ? arg : arg.name;
    if (name === 'roster_weekly_2024') {
      return csv(['season', 'week', 'game_type', 'gsis_id', 'team'], [
        { season: 2024, week: 1, game_type: 'REG', gsis_id: '00-0000001', team: 'KC' },
      ]);
    }
    if (name === 'stats_player_week_2024') {
      return csv(['season', 'week', 'season_type', 'player_id', 'team'], [
        { season: 2024, week: 1, season_type: 'REG', player_id: '00-0000001', team: 'KC' },
      ]);
    }
    throw new Error(`no fixture readSource entry for ${name}`);
  };
}

/** Package a small real fixture publication once per test, returning its
 * publish root - the shared building block for every test below.
 *
 * `manifestSha256` is also returned: every fixture built here has its OWN
 * hash, never the real pinned production `PINNED_SNAPSHOT_MANIFEST_SHA256`,
 * so every call to `rehydrate()` below must override
 * `expectedSourceManifestSha256` with THIS value - exactly mirroring how
 * `packageSnapshot`'s own `expectedManifestSha256` is overridden by every
 * fixture test in `backtestPackageSnapshot.test.js` (round 4, MEDIUM
 * finding 2's independent second check against the real pin would otherwise
 * refuse every fixture in this file, which is not what that check is for). */
function packageFixturePublication(label) {
  const snapshotRoot = tmpDir(`${label}-snap`);
  const publishRoot = tmpPublishPath(`${label}-pub`);
  const { manifestSha256 } = buildFixtureSnapshot(snapshotRoot);
  packager.packageSnapshot({
    snapshotRoot,
    publishRoot,
    sourcesDir: FIXTURE_SOURCES.sourcesDir,
    provenancePath: FIXTURE_SOURCES.provenancePath,
    expectedGamesCsvSha256: FIXTURE_SOURCES.gamesCsvSha256,
    readSource: makeFixtureReadSource(),
    normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  return { publishRoot, snapshotRoot, manifestSha256 };
}

/** Thin wrapper around `rehydrate.rehydrate` that supplies the fixture's own
 * `expectedSourceManifestSha256` by default - see `packageFixturePublication`
 * above for why every call in this file needs it. A test that wants to
 * exercise the independent-pin check itself passes its own override. */
function rehydrateFixture(manifestSha256, overrides) {
  return rehydrate.rehydrate({ expectedSourceManifestSha256: manifestSha256, ...overrides });
}

// ---------------------------------------------------------------------------
// The happy path: rehydrate a freshly-packaged fixture publication, and
// prove the output is a genuine drop-in stand-in for snapshot/ and sources/
// ---------------------------------------------------------------------------

test('rehydrate() reproduces every dataset and every source byte-for-byte from a real packaged publication', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('happy');
  const outSnapshotRoot = tmpDir('happy-out-snap');
  const outSourcesDir = tmpDir('happy-out-sources');

  const result = rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir });

  assert.equal(result.datasetResults.length, 3);
  assert.equal(result.sourceResults.length, REAL_SOURCES.length);
  for (const r of result.datasetResults) assert.equal(r.ok, true);
  for (const r of result.sourceResults) assert.equal(r.ok, true);

  // The rehydrated snapshot must load through snapshotStore exactly like a
  // real one - manifest first, then every dataset by name.
  const manifest = store.loadManifest(outSnapshotRoot);
  assert.equal(manifest.studyId, 'fixture-study');
  for (const entry of manifest.datasets) {
    const { rows } = store.loadDataset({
      root: outSnapshotRoot, store: entry.store, path: entry.path, dataset: entry.dataset,
      expectedSha256: entry.sha256,
    });
    assert.equal(rows.length, entry.rowCount, `${entry.dataset} row count`);
  }

  // Every one of the ten pinned sources must be present, named exactly as
  // the original, with byte-identical content, plus a rehydrated
  // provenance.json a real makeSourceReader can use with no other setup.
  for (const sourceEntry of REAL_SOURCES) {
    const original = fs.readFileSync(path.join(FIXTURE_SOURCES.sourcesDir, sourceEntry.file));
    const rehydrated = fs.readFileSync(path.join(outSourcesDir, sourceEntry.file));
    assert.ok(original.equals(rehydrated), `${sourceEntry.name} must be byte-identical`);
  }
  assert.ok(fs.existsSync(path.join(outSourcesDir, 'provenance.json')));
  const readSource = checks.makeSourceReader({ sourcesDir: outSourcesDir, provenancePath: path.join(outSourcesDir, 'provenance.json') });
  assert.match(readSource('roster_weekly_2024'), /gsis_id/);
});

test('the rehydrated snapshot dry-run-receipt.json is a byte-for-byte copy of the original', () => {
  const { publishRoot, snapshotRoot, manifestSha256 } = packageFixturePublication('receipt');
  const outSnapshotRoot = tmpDir('receipt-out-snap');
  const outSourcesDir = tmpDir('receipt-out-sources');
  rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir });
  const original = fs.readFileSync(store.receiptFile(snapshotRoot));
  const rehydrated = fs.readFileSync(store.receiptFile(outSnapshotRoot));
  assert.ok(original.equals(rehydrated));
});

// ---------------------------------------------------------------------------
// Fail-closed: any hash mismatch or missing chunk throws, never warns, and
// (round 4) leaves NO partial output tree behind - build happens in a temp
// directory first, so a build-phase failure never touches the real outputs.
// ---------------------------------------------------------------------------

function assertAbsentOrEmpty(dir, label) {
  if (!fs.existsSync(dir)) return;
  assert.deepEqual(fs.readdirSync(dir), [], `${label} (${dir}) must be empty after a failed rehydrate call`);
}

test('rehydrate() throws if a dataset chunk has been tampered with on disk, and leaves no partial output tree behind', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('tamper');
  const chunkFile = path.join(publishRoot, 'chunks', 'players', 'chunk-0000.ndjson.gz');
  const bytes = fs.readFileSync(chunkFile);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(chunkFile, bytes);

  const outSnapshotRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-tamper-parent-')), 'out-snap');
  const outSourcesDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-tamper-parent2-')), 'out-sources');
  test.after(() => { fs.rmSync(path.dirname(outSnapshotRoot), { recursive: true, force: true }); fs.rmSync(path.dirname(outSourcesDir), { recursive: true, force: true }); });

  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir }),
    /dataset players.*compressed bytes on disk do not match the manifest/
  );
  assertAbsentOrEmpty(outSnapshotRoot, 'outSnapshotRoot');
  assertAbsentOrEmpty(outSourcesDir, 'outSourcesDir');
});

test('rehydrate() throws if a source chunk has been tampered with on disk', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('tamper-src');
  const chunkFile = path.join(publishRoot, 'sources', 'players', 'chunk-0000.bin.gz');
  const bytes = fs.readFileSync(chunkFile);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(chunkFile, bytes);

  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot: tmpDir('tamper-src-out-snap'), outSourcesDir: tmpDir('tamper-src-out-sources') }),
    /source players.*compressed bytes on disk do not match the manifest/
  );
});

test('rehydrate() throws if a chunk file is missing entirely', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('missing');
  fs.rmSync(path.join(publishRoot, 'chunks', 'player_stats', 'chunk-0000.ndjson.gz'));

  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot: tmpDir('missing-out-snap'), outSourcesDir: tmpDir('missing-out-sources') }),
    /dataset player_stats chunk 0 is missing from disk/
  );
});

test('the deliberately-corrupted FINAL chunk of a source reproduction: rehydrate() throws, and no partial snapshot/sources tree survives on disk', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('final-chunk-tamper');
  // players.csv is small enough to be a single chunk in the fixture, so
  // "the final chunk" and "the only chunk" coincide here - the review's
  // point (a corrupted final chunk previously left a plausible partial tree
  // on disk) is about the temp-then-promote fix, not about chunk count.
  const manifest = JSON.parse(fs.readFileSync(path.join(publishRoot, 'manifest.json'), 'utf8'));
  const playersSource = manifest.sources.find((s) => s.name === 'players');
  const lastChunk = playersSource.chunks[playersSource.chunks.length - 1];
  const chunkFile = path.join(publishRoot, ...lastChunk.file.split('/'));
  const bytes = fs.readFileSync(chunkFile);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(chunkFile, bytes);

  const outParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-finalchunk-parent-'));
  test.after(() => fs.rmSync(outParent, { recursive: true, force: true }));
  const outSnapshotRoot = path.join(outParent, 'out-snap');
  const outSourcesDir = path.join(outParent, 'out-sources');

  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir }),
    /source players.*compressed bytes on disk do not match the manifest/
  );
  assertAbsentOrEmpty(outSnapshotRoot, 'outSnapshotRoot');
  assertAbsentOrEmpty(outSourcesDir, 'outSourcesDir');
});

// ---------------------------------------------------------------------------
// Round 6: a third-party review reproduced 3 further defects live -
// (1) the "pinned-manifest trust bypass": a rehydrated source's bytes were
//     only cross-checked against the mutable publish-tree's OWN manifest.json
//     and sources-provenance.json, both editable by an attacker who controls
//     the whole tree; (2) path traversal via chunk.file; (3) promotion is not
//     atomic - a failure of the SECOND rename left outSnapshotRoot promoted
//     while outSourcesDir stayed missing.
// ---------------------------------------------------------------------------

test('rehydrate() refuses a raw source whose bytes were changed consistently across the publish manifest.json, sources-provenance.json, and its own fixedFiles hash - but NOT the sealed source-manifest.json (pinned-manifest trust bypass reproduction)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('trust-bypass');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const playersSource = manifest.sources.find((s) => s.name === 'players');
  assert.equal(playersSource.chunks.length, 1, 'the fixture players.csv is expected to fit in a single chunk');
  const chunkPath = path.join(publishRoot, ...playersSource.chunks[0].file.split('/'));

  // Fake, DIFFERENT players.csv content an attacker wants rehydration to
  // accept in place of the real, sealed one.
  const fakeBytes = Buffer.from('gsis_id,espn_id\n00-9999999,9999\n', 'utf8');
  const fakeCompressed = gzipDeterministic(fakeBytes);
  fs.writeFileSync(chunkPath, fakeCompressed);
  const fakeCompressedSha256 = sha256Hex(fakeCompressed);
  const fakeUncompressedSha256 = sha256Hex(fakeBytes);

  // Update the chunk record and the source's own top-level hashes in the
  // PUBLICATION manifest.json - every self-consistency check rehydrateSources
  // already ran BEFORE this round's fix agrees with these fabricated values.
  playersSource.chunks[0].compressedSha256 = fakeCompressedSha256;
  playersSource.chunks[0].uncompressedSha256 = fakeUncompressedSha256;
  playersSource.uncompressedSha256 = fakeUncompressedSha256;
  playersSource.provenanceSha256 = fakeUncompressedSha256;

  // Update sources-provenance.json's own record for players to match, AND its
  // fixedFiles hash/byteLength in manifest.json to match THAT edit - so the
  // pre-existing (round 4) fixedFile integrity check does not itself catch
  // this tampering, isolating what only the round 6 sealed-source binding
  // check can catch.
  const provenancePath = path.join(publishRoot, 'sources-provenance.json');
  const provenanceDoc = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const playersRecord = provenanceDoc.records.find((r) => r.name === 'players');
  playersRecord.sha256 = fakeUncompressedSha256;
  playersRecord.byteLength = fakeBytes.length;
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenanceDoc, null, 2)}\n`, 'utf8');
  fs.writeFileSync(provenancePath, provenanceBytes);
  const provenanceFixedFile = manifest.fixedFiles.find((f) => f.name === 'sources-provenance.json');
  provenanceFixedFile.sha256 = sha256Hex(provenanceBytes);
  provenanceFixedFile.byteLength = provenanceBytes.length;

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  // The sealed source-manifest.json is DELIBERATELY left untouched, exactly
  // reproducing the reviewer's own scenario. Only it can still catch this.
  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('trust-bypass-out-snap'), outSourcesDir: tmpDir('trust-bypass-out-sources'),
    }),
    /source players.*SEALED Gate-2 source-manifest\.json independently pins/
  );
});

test('rehydrate() refuses to trust a manifest-supplied chunk.file that disagrees with the path derived from the chunk\'s own identity and index (path traversal reproduction)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('traversal');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const playersDataset = manifest.datasets.find((d) => d.dataset === 'players');
  playersDataset.chunks[0].file = '../outside.ndjson.gz';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  // A file that genuinely exists just outside publishRoot, so a fix that only
  // happened to fail for an unrelated reason (e.g. plain ENOENT) would not be
  // mistaken for the traversal actually being blocked.
  const outsideFile = path.join(path.dirname(publishRoot), 'outside.ndjson.gz');
  fs.writeFileSync(outsideFile, Buffer.from('not a real chunk'));
  test.after(() => { try { fs.rmSync(outsideFile, { force: true }); } catch (_e) { /* ignore */ } });

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('traversal-out-snap'), outSourcesDir: tmpDir('traversal-out-sources'),
    }),
    /records file ".*outside\.ndjson\.gz".*its identity and index derive/
  );
});

test('rehydrate() refuses to read a chunk whose real on-disk path (after following a directory junction) escapes publishRoot, even though the string path looks contained', (t) => {
  if (process.platform !== 'win32') { t.skip('directory junctions are a win32-only concern here'); return; }
  const { publishRoot, manifestSha256 } = packageFixturePublication('reparse');
  const chunksPlayersDir = path.join(publishRoot, 'chunks', 'players');
  const realChunkBytes = fs.readFileSync(path.join(chunksPlayersDir, 'chunk-0000.ndjson.gz'));

  // Move the real chunks/players directory content out of the way, then
  // replace chunks/players itself with a junction pointing OUTSIDE
  // publishRoot. The derived relative path string
  // (chunks/players/chunk-0000.ndjson.gz) still looks perfectly contained;
  // only resolving it through the filesystem reveals the escape.
  const outsideParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-reparse-outside-'));
  test.after(() => fs.rmSync(outsideParent, { recursive: true, force: true }));
  const outsideDir = path.join(outsideParent, 'players');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'chunk-0000.ndjson.gz'), realChunkBytes);
  fs.rmSync(chunksPlayersDir, { recursive: true, force: true });
  try {
    fs.symlinkSync(outsideDir, chunksPlayersDir, 'junction');
  } catch (err) {
    t.skip(`could not create a directory junction in this environment (${err.code || err.message})`);
    return;
  }

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('reparse-out-snap'), outSourcesDir: tmpDir('reparse-out-sources'),
    }),
    /resolves outside publishRoot once symlinks\/junctions\/reparse points are followed/
  );
});

test('rehydrate() rolls back the already-promoted outSnapshotRoot if promoting outSourcesDir fails, leaving nothing half-promoted WHEN THE ROLLBACK ITSELF SUCCEEDS (promotion-not-atomic reproduction)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('rollback');
  const outParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-rollback-parent-'));
  test.after(() => fs.rmSync(outParent, { recursive: true, force: true }));
  const outSnapshotRoot = path.join(outParent, 'out-snap');
  const outSourcesDir = path.join(outParent, 'out-sources');

  const originalRenameSync = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = (...args) => {
    renameCalls += 1;
    if (renameCalls === 2) {
      throw Object.assign(new Error('simulated rename failure (disk full / permission denied / cross-device)'), { code: 'EPERM' });
    }
    return originalRenameSync(...args);
  };
  let thrown;
  try {
    try {
      rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir });
      assert.fail('must throw when the second (outSourcesDir) rename fails');
    } catch (err) {
      thrown = err;
    }
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.match(thrown.message, /rolled back to its pre-promote state/);
  assert.equal(fs.existsSync(outSnapshotRoot), false, 'outSnapshotRoot must have been rolled back, not left promoted');
  assert.equal(fs.existsSync(outSourcesDir), false, 'outSourcesDir must never have been promoted');
});

test('rehydrate() leaves outSnapshotRoot PROMOTED (and says so explicitly) when BOTH the second rename and its own rollback fail - the promotion is a compensating rollback, not true atomicity', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('rollback-double-fail');
  const outParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-rollback2-parent-'));
  test.after(() => fs.rmSync(outParent, { recursive: true, force: true }));
  const outSnapshotRoot = path.join(outParent, 'out-snap');
  const outSourcesDir = path.join(outParent, 'out-sources');

  const originalRenameSync = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = (...args) => {
    renameCalls += 1;
    // Call 1: buildSnapshotRoot -> outSnapshotRoot (must succeed, so there is
    // something real to roll back). Call 2: buildSourcesDir -> outSourcesDir
    // (fails). Call 3: the rollback attempt, outSnapshotRoot -> buildSnapshotRoot
    // (ALSO fails here - the double-failure this test exists to prove).
    if (renameCalls === 2 || renameCalls === 3) {
      throw Object.assign(new Error(`simulated rename failure #${renameCalls}`), { code: 'EPERM' });
    }
    return originalRenameSync(...args);
  };
  let thrown;
  try {
    try {
      rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir });
      assert.fail('must throw when both the second rename and its rollback fail');
    } catch (err) {
      thrown = err;
    }
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.match(thrown.message, /rolling back the already-promoted outSnapshotRoot failed too/);
  assert.match(thrown.message, /manual cleanup required/);
  // The real, observable consequence: outSnapshotRoot IS left promoted (NOT
  // rolled back) and outSourcesDir is NOT promoted - exactly the
  // half-promoted state a "true atomicity" claim would deny is possible.
  assert.equal(fs.existsSync(outSnapshotRoot), true, 'outSnapshotRoot must be left PROMOTED when the rollback itself fails');
  assert.equal(fs.existsSync(outSourcesDir), false, 'outSourcesDir must never have been promoted');
});

test('rehydrate CLI parseArgs rejects a trailing flag with no value, instead of silently reverting --publish to the default', () => {
  assert.throws(() => rehydrate.parseArgs(['--publish']), /--publish requires a value \(got nothing\)/);
  assert.throws(() => rehydrate.parseArgs(['--out-snapshot']), /--out-snapshot requires a value \(got nothing\)/);
  assert.throws(() => rehydrate.parseArgs(['--out-sources']), /--out-sources requires a value \(got nothing\)/);
  assert.throws(
    () => rehydrate.parseArgs(['--publish', '--out-snapshot', 'a']),
    /--publish requires a value \(got "--out-snapshot"\)/
  );
});

// ---------------------------------------------------------------------------
// Round 6 (fourth review round): per-entry sealed-hash binding alone was not
// enough - a publication manifest that simply OMITS an entry (a whole
// dataset or source) is never iterated by a loop keyed off "whatever
// manifest.json lists", so nothing noticed the omission. Neither did
// anything bind the source FILENAME, or the CONTENT of sources-
// provenance.json's own records, to the sealed manifest.
// ---------------------------------------------------------------------------

test('rehydrate() refuses when the publication manifest is MISSING a source the sealed manifest has (rather than silently rehydrating nine of ten)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('missing-source');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.sources = manifest.sources.filter((s) => s.name !== 'stats_team_week_2024');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('missing-source-out-snap'), outSourcesDir: tmpDir('missing-source-out-sources'),
    }),
    /publication manifest's source set does not exactly match the sealed manifest's.*missing.*stats_team_week_2024/
  );
});

test('rehydrate() refuses when the publication manifest is MISSING a dataset the sealed manifest has (rather than silently rehydrating fewer datasets than the sealed manifest records)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('missing-dataset');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.datasets = manifest.datasets.filter((d) => d.dataset !== 'player_stats');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('missing-dataset-out-snap'), outSourcesDir: tmpDir('missing-dataset-out-sources'),
    }),
    /publication manifest's dataset set does not exactly match the sealed manifest's.*missing.*player_stats/
  );
});

test('rehydrate() refuses when a dataset\'s seasonScoped in the publication manifest disagrees with the sealed manifest (seasonScoped binding reproduction)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('season-scoped-flip');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const playerStatsEntry = manifest.datasets.find((d) => d.dataset === 'player_stats');
  playerStatsEntry.seasonScoped = !playerStatsEntry.seasonScoped;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('season-scoped-flip-out-snap'), outSourcesDir: tmpDir('season-scoped-flip-out-sources'),
    }),
    /dataset player_stats records seasonScoped false, the SEALED manifest pins true/
  );
});

test('rehydrate() refuses when the publication manifest has an EXTRA source name the sealed manifest does not recognize', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('extra-source');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.sources.push({
    name: 'players_extra', file: 'players_extra.csv', chunks: [], uncompressedSha256: '0'.repeat(64), provenanceSha256: '0'.repeat(64),
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('extra-source-out-snap'), outSourcesDir: tmpDir('extra-source-out-sources'),
    }),
    /publication manifest's source set does not exactly match the sealed manifest's.*extra.*players_extra/
  );
});

test('rehydrate() refuses when the publication manifest lists a DUPLICATE source name', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('dup-source');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const playersEntry = manifest.sources.find((s) => s.name === 'players');
  manifest.sources.push({ ...playersEntry });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('dup-source-out-snap'), outSourcesDir: tmpDir('dup-source-out-sources'),
    }),
    /the publication manifest has a duplicate source name/
  );
});

test('rehydrate() refuses when a source\'s filename in the publication manifest disagrees with the sealed manifest (renamed-source reproduction)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('renamed-source');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const playersEntry = manifest.sources.find((s) => s.name === 'players');
  playersEntry.file = 'alternate.csv';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('renamed-source-out-snap'), outSourcesDir: tmpDir('renamed-source-out-sources'),
    }),
    /records filename "alternate\.csv".*SEALED Gate-2 source-manifest\.json independently pins "players\.csv"/
  );
});

test('rehydrate() refuses when a sources-provenance.json record disagrees with the sealed manifest, even with its own fixedFiles hash updated to match (bad-provenance reproduction)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('bad-provenance');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const provenancePath = path.join(publishRoot, 'sources-provenance.json');
  const provenanceDoc = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const playersRecord = provenanceDoc.records.find((r) => r.name === 'players');
  playersRecord.sha256 = '0'.repeat(64);
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenanceDoc, null, 2)}\n`, 'utf8');
  fs.writeFileSync(provenancePath, provenanceBytes);
  const provenanceFixedFile = manifest.fixedFiles.find((f) => f.name === 'sources-provenance.json');
  provenanceFixedFile.sha256 = sha256Hex(provenanceBytes);
  provenanceFixedFile.byteLength = provenanceBytes.length;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  assert.throws(
    () => rehydrateFixture(manifestSha256, {
      publishRoot, outSnapshotRoot: tmpDir('bad-provenance-out-snap'), outSourcesDir: tmpDir('bad-provenance-out-sources'),
    }),
    /sources-provenance\.json's record for players has sha256 .*, but the SEALED source-manifest\.json independently pins/
  );
});

test('rehydrate() requires outSnapshotRoot and outSourcesDir, and refuses if they are the same directory', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('args');
  assert.throws(() => rehydrateFixture(manifestSha256, { publishRoot, outSourcesDir: tmpDir('args-sources') }), /outSnapshotRoot is required/);
  assert.throws(() => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot: tmpDir('args-snap') }), /outSourcesDir is required/);
  const same = tmpDir('args-same');
  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot: same, outSourcesDir: same }),
    /outSnapshotRoot and outSourcesDir resolve to the SAME directory/
  );
});

test('rehydrate() throws a clear error when publishRoot has no manifest.json at all', () => {
  const empty = tmpDir('no-manifest');
  assert.throws(
    () => rehydrate.rehydrate({ publishRoot: empty, outSnapshotRoot: tmpDir('no-manifest-out-snap'), outSourcesDir: tmpDir('no-manifest-out-sources') }),
    /no publication manifest at/
  );
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('rehydrate CLI parseArgs requires --out-snapshot and --out-sources, and rejects an unknown flag', () => {
  assert.throws(() => rehydrate.parseArgs([]), /--out-snapshot and --out-sources are both required/);
  assert.throws(() => rehydrate.parseArgs(['--out-snapshot', 'a']), /--out-snapshot and --out-sources are both required/);
  assert.throws(() => rehydrate.parseArgs(['--out-snapshot', 'a', '--out-sources', 'b', '--nope']), /unknown argument --nope/);
  const args = rehydrate.parseArgs(['--out-snapshot', 'a', '--out-sources', 'b']);
  assert.equal(args.outSnapshot, 'a');
  assert.equal(args.outSources, 'b');
  assert.equal(args.publish, rehydrate.parseArgs(['--out-snapshot', 'a', '--out-sources', 'b']).publish);
});

test('rehydrate CLI main() runs end to end against a real packaged fixture publication', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('cli');
  const outSnapshotRoot = tmpDir('cli-out-snap');
  const outSourcesDir = tmpDir('cli-out-sources');
  const lines = [];
  const code = rehydrate.main(
    ['--publish', publishRoot, '--out-snapshot', outSnapshotRoot, '--out-sources', outSourcesDir],
    { log: (l) => lines.push(String(l)), expectedSourceManifestSha256: manifestSha256 }
  );
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /rehydration complete/);
  assert.ok(fs.existsSync(store.manifestFile(outSnapshotRoot)));
  assert.ok(fs.existsSync(path.join(outSourcesDir, 'provenance.json')));
});

// ---------------------------------------------------------------------------
// BLOCKER (round 4 review): the rehydrator could destroy its own input.
// `rehydrate()` must now check publishRoot, outSnapshotRoot, and
// outSourcesDir pairwise disjoint, using the SAME hardened shared logic
// package-snapshot.js uses (lib/rootSafety.js), before any read or write.
// ---------------------------------------------------------------------------

test('BLOCKER reproduction: outSnapshotRoot pointed at publishRoot itself throws BEFORE any byte under publishRoot is modified', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('blocker-snap-eq-publish');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifestBytesBefore = fs.readFileSync(manifestPath);
  const elsewhere = tmpDir('blocker-snap-eq-publish-elsewhere');

  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot: publishRoot, outSourcesDir: elsewhere }),
    /publishRoot and outSnapshotRoot resolve to the SAME directory/
  );
  assert.ok(
    fs.readFileSync(manifestPath).equals(manifestBytesBefore),
    'the publication tree\'s manifest.json must be byte-identical before and after the refused attempt'
  );
});

test('BLOCKER reproduction (mirror case): outSourcesDir pointed at publishRoot itself throws BEFORE any byte under publishRoot is modified', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('blocker-src-eq-publish');
  const manifestPath = path.join(publishRoot, 'manifest.json');
  const manifestBytesBefore = fs.readFileSync(manifestPath);
  const elsewhere = tmpDir('blocker-src-eq-publish-elsewhere');

  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot: elsewhere, outSourcesDir: publishRoot }),
    /publishRoot and outSourcesDir resolve to the SAME directory/
  );
  assert.ok(
    fs.readFileSync(manifestPath).equals(manifestBytesBefore),
    'the publication tree\'s manifest.json must be byte-identical before and after the refused attempt'
  );
});

test('rehydrate() refuses when outSnapshotRoot is nested INSIDE publishRoot, before any write', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('nest-snap-in-publish');
  const outSnapshotRoot = path.join(publishRoot, 'nested-out-snap');
  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir: tmpDir('nest-snap-in-publish-sources') }),
    /outSnapshotRoot .* is nested INSIDE publishRoot/
  );
  assert.ok(!fs.existsSync(outSnapshotRoot), 'nothing was written under the publication tree');
});

test('rehydrate() refuses when outSourcesDir is nested INSIDE publishRoot, before any write', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('nest-src-in-publish');
  const outSourcesDir = path.join(publishRoot, 'nested-out-sources');
  assert.throws(
    () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot: tmpDir('nest-src-in-publish-snap'), outSourcesDir }),
    /outSourcesDir .* is nested INSIDE publishRoot/
  );
  assert.ok(!fs.existsSync(outSourcesDir), 'nothing was written under the publication tree');
});

test('rehydrate() refuses when publishRoot is nested INSIDE outSnapshotRoot, before any write', () => {
  const outSnapshotRoot = tmpDir('nest-publish-in-snap');
  const publishRoot = path.join(outSnapshotRoot, 'nested-publish');
  fs.mkdirSync(publishRoot, { recursive: true });
  assert.throws(
    () => rehydrate.rehydrate({ publishRoot, outSnapshotRoot, outSourcesDir: tmpDir('nest-publish-in-snap-sources') }),
    /publishRoot .* is nested INSIDE outSnapshotRoot/
  );
});

test('rehydrate() refuses when publishRoot is nested INSIDE outSourcesDir, before any write', () => {
  const outSourcesDir = tmpDir('nest-publish-in-src');
  const publishRoot = path.join(outSourcesDir, 'nested-publish');
  fs.mkdirSync(publishRoot, { recursive: true });
  assert.throws(
    () => rehydrate.rehydrate({ publishRoot, outSnapshotRoot: tmpDir('nest-publish-in-src-snap'), outSourcesDir }),
    /publishRoot .* is nested INSIDE outSourcesDir/
  );
});

test('rehydrate() refuses a UNC-form publishRoot, outSnapshotRoot, or outSourcesDir outright, before any read or write', () => {
  const uncPath = '\\\\localhost\\C$\\some\\unrelated\\path';
  assert.throws(
    () => rehydrate.rehydrate({ publishRoot: uncPath, outSnapshotRoot: 'C:\\out-snap', outSourcesDir: 'C:\\out-sources' }),
    /publishRoot .*is a UNC-form path/
  );
  assert.throws(
    () => rehydrate.rehydrate({ publishRoot: 'C:\\publish', outSnapshotRoot: uncPath, outSourcesDir: 'C:\\out-sources' }),
    /outSnapshotRoot .*is a UNC-form path/
  );
  assert.throws(
    () => rehydrate.rehydrate({ publishRoot: 'C:\\publish', outSnapshotRoot: 'C:\\out-snap', outSourcesDir: uncPath }),
    /outSourcesDir .*is a UNC-form path/
  );
});

// ---------------------------------------------------------------------------
// Atomicity: build-to-temp-then-promote, mirroring package-snapshot.js
// ---------------------------------------------------------------------------

test('rehydrate() rejects a non-empty pre-existing outSnapshotRoot, and leaves both fully-built temp dirs on disk', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('promote-conflict-snap');
  const outSnapshotRoot = tmpDir('promote-conflict-snap-out-snap');
  fs.writeFileSync(path.join(outSnapshotRoot, 'pre-existing-file.txt'), 'do not touch me\n');
  const outSourcesDir = tmpDir('promote-conflict-snap-out-sources'); // empty - never the blocker

  let thrown;
  try {
    rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir });
    assert.fail('rehydrate() must throw when outSnapshotRoot already exists and is not empty');
  } catch (err) {
    thrown = err;
  }
  assert.match(thrown.message, /outSnapshotRoot .* already exists and is not empty/);
  assert.equal(
    fs.readFileSync(path.join(outSnapshotRoot, 'pre-existing-file.txt'), 'utf8'),
    'do not touch me\n',
    'the pre-existing directory must be completely untouched'
  );
  assert.ok(!fs.existsSync(path.join(outSourcesDir, 'provenance.json')),
    'a conflict on ONE output must not leave the OTHER output half-promoted');

  const parent = path.dirname(outSnapshotRoot);
  const leakedSnap = fs.readdirSync(parent).find((n) => n.startsWith('.tmp-rehydrate-snapshot-'));
  assert.ok(leakedSnap, 'the fully-built snapshot temp directory must still be on disk');
  assert.ok(thrown.message.includes(path.join(parent, leakedSnap)), 'error message must name the real temp path');
  fs.rmSync(path.join(parent, leakedSnap), { recursive: true, force: true });

  const sourcesParent = path.dirname(outSourcesDir);
  const leakedSources = fs.readdirSync(sourcesParent).find((n) => n.startsWith('.tmp-rehydrate-sources-'));
  assert.ok(leakedSources, 'the fully-built sources temp directory must ALSO still be on disk (checked before either promote)');
  fs.rmSync(path.join(sourcesParent, leakedSources), { recursive: true, force: true });
});

test('rehydrate() tolerates an EMPTY pre-existing outSnapshotRoot/outSourcesDir (the common tmpDir()-helper idiom every other test here relies on)', () => {
  const { publishRoot, manifestSha256 } = packageFixturePublication('empty-preexisting');
  const outSnapshotRoot = tmpDir('empty-preexisting-snap'); // pre-created, EMPTY
  const outSourcesDir = tmpDir('empty-preexisting-sources'); // pre-created, EMPTY
  const result = rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir });
  assert.ok(result.datasetResults.length > 0);
  assert.ok(fs.existsSync(store.manifestFile(outSnapshotRoot)));
  assert.ok(fs.existsSync(path.join(outSourcesDir, 'provenance.json')));
});

// ---------------------------------------------------------------------------
// MEDIUM (round 4 review): fixed provenance files are copied without
// integrity verification. Corrupt each of the three, byte-flip AND
// byte-append, and confirm rehydrate() throws before writing the corrupted
// content anywhere, leaving no partial output tree behind.
// ---------------------------------------------------------------------------

function corruptByFlip(filePath) {
  const bytes = fs.readFileSync(filePath);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(filePath, bytes);
}

function corruptByAppend(filePath) {
  fs.appendFileSync(filePath, Buffer.from('\nUNEXPECTED-APPENDED-BYTES'));
}

for (const [fileLabel, fileName] of [
  ['source-manifest.json', 'source-manifest.json'],
  ['sources-provenance.json', 'sources-provenance.json'],
  ['dry-run-receipt.json', 'dry-run-receipt.json'],
]) {
  for (const [corruptLabel, corrupt] of [['byte-flip', corruptByFlip], ['byte-append', corruptByAppend]]) {
    test(`rehydrate() throws before writing anywhere when ${fileLabel} is corrupted (${corruptLabel}), and leaves no partial output tree`, () => {
      const { publishRoot, manifestSha256 } = packageFixturePublication(`corrupt-${fileLabel}-${corruptLabel}`.replace(/[^a-z0-9-]/gi, '_'));
      corrupt(path.join(publishRoot, fileName));

      const outParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-rehydrate-corrupt-parent-'));
      test.after(() => fs.rmSync(outParent, { recursive: true, force: true }));
      const outSnapshotRoot = path.join(outParent, 'out-snap');
      const outSourcesDir = path.join(outParent, 'out-sources');

      assert.throws(
        () => rehydrateFixture(manifestSha256, { publishRoot, outSnapshotRoot, outSourcesDir }),
        /hashes to .* (fixedFiles entry records|is .* byte\(s\) on disk)/
      );
      assertAbsentOrEmpty(outSnapshotRoot, 'outSnapshotRoot');
      assertAbsentOrEmpty(outSourcesDir, 'outSourcesDir');
    });
  }
}

test('rehydrate() independently re-verifies source-manifest.json against expectedSourceManifestSha256, refusing a mismatch even if the manifest\'s own fixedFiles entry agrees', () => {
  // Only publishRoot is wanted here: the point of this test is to pass an
  // expectedSourceManifestSha256 that is NOT the fixture's real hash.
  const { publishRoot } = packageFixturePublication('independent-pin-mismatch');
  assert.throws(
    () => rehydrate.rehydrate({
      publishRoot,
      outSnapshotRoot: tmpDir('independent-pin-mismatch-snap'),
      outSourcesDir: tmpDir('independent-pin-mismatch-sources'),
      expectedSourceManifestSha256: '0'.repeat(64), // deliberately wrong, unlike the fixture's real hash
    }),
    /independently pinned expectedSourceManifestSha256/
  );
});
