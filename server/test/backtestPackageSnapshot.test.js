const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const packager = require('../../scripts/backtest/package-snapshot');
const checks = require('../../scripts/backtest/snapshot-checks');
const store = require('../../scripts/backtest/lib/snapshotStore');
const { sha256Hex } = require('../../scripts/backtest/lib/verifiedBytes');
const { SOURCES: REAL_SOURCES } = require('../../scripts/backtest/lib/sources');
const { normalizeTeamKey } = require('../services/projectionFeatures');

/**
 * `package-snapshot.js` is tested here against a SMALL, HAND-BUILT fixture
 * snapshot - not a real extraction - because its job is generic over
 * whatever the source manifest lists: one representative dataset per schema
 * FAMILY (a flat DB-row envelope, a JSONB-subset blob, the raw provenance
 * path, and the fully-nested oracle projection) is enough to prove the
 * packager's own logic (chunking, gzip, verification ordering, the
 * teamContradictions wiring, the manifest/NOTICE/gitattributes/staging
 * output) without needing to also reproduce the real projection engine's
 * output shape. Every value in every fixture below is FABRICATED for this
 * test - never real snapshot data.
 *
 * The ten pinned RAW SOURCES packaging now requires (`sourcesDir`,
 * `provenancePath`) are built ONCE as a small, shared, read-only fixture
 * tree (`FIXTURE_SOURCES` below) and reused across every test - packaging
 * never mutates `sourcesDir`, so sharing it is safe, and it keeps every test
 * here fast rather than chunking the real ~58 MB of archived CSVs on every
 * call.
 */

function tmpDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ez-pkg-${label}-`));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A path that does NOT exist yet, inside a fresh temp directory that DOES -
 * for `publishRoot` in every test where packaging is expected to actually
 * SUCCEED. Packaging now builds into a temp directory and only PROMOTES
 * (renames) it onto `publishRoot` on complete success, and refuses to
 * promote over an already-existing directory (see the "atomicity" tests
 * below) - so a success-path test must hand packaging a `publishRoot` that
 * does not exist yet, unlike the old "always pre-create an empty tmpdir"
 * pattern `tmpDir` still provides for every OTHER use (snapshotRoot, and
 * every failure-path test's publishRoot, where packaging never reaches the
 * promote step at all).
 */
function tmpPublishPath(label) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `ez-pkg-${label}-parent-`));
  test.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return path.join(parent, 'publish');
}

const FULL_PROJECTION = {
  activeProbability: null, confidence: 'high', confidenceReasons: [], effectiveGames: 4,
  mean: null, median: 12.3, modelVersion: 'fixture_v1', p10: null, p25: null, p75: null,
  p90: null, playerId: 1, position: 'RB', sampleSize: 4, unavailableReason: null,
  factors: {
    availability: { activeProbability: null, available: true, locked: false, lockedSlot: null, reason: null, status: null },
    dataQuality: { level: 'good', reason: 'ok', residualSource: null },
    expertConsensus: null, homeAway: null, opponent: null, recentProduction: null, role: null,
    versusOpponent: null, weather: null,
  },
};

/**
 * Build a small, schema-conformant fixture snapshot directly with
 * `snapshotStore`, covering one dataset per schema family. `mutateRows` lets
 * a test corrupt one dataset's rows AFTER they are built but BEFORE they are
 * saved, for the negative-path tests.
 */
function buildFixtureSnapshot({
  root,
  rosterTeam2024 = 'KC',
  statsTeam2024 = 'KC', // set to something else to create a real contradiction
  mutate = (name, rows) => rows,
  // Defaults to the SHARED FIXTURE_SOURCES.records - correct for every test
  // that reads the shared, unmutated fixture sources tree. A test that
  // builds its OWN independent, differently-hashed sources tree (via
  // `buildFixtureSources({ mutateText })`) must override this to match, or
  // the new sealed-source binding check (round 6, packager-side) refuses
  // before the test ever reaches whatever it actually means to exercise.
  sourceRecords,
} = {}) {
  const datasets = [
    {
      dataset: 'players', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false,
      rows: mutate('players', [
        { id: 1, external_id: 4241, name: 'Fixture Player', position: 'QB', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: '12.5', team_key: 'KC' },
        { id: 2, external_id: null, name: 'Kansas City Chiefs', position: 'DEF', nfl_team: 'Kansas City Chiefs', injury_status: null, injury_detail: null, adp: null, team_key: 'KC' },
      ]),
    },
    {
      dataset: 'player_stats', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true,
      rows: mutate('player_stats', [
        { player_id: 1, season: 2024, week: 1, stats: { passingYards: 250, passingTDs: 2, gameTeam: statsTeam2024, gameOpponent: 'BUF' } },
        { player_id: 1, season: 2024, week: 2, stats: { passingYards: 180, passingTDs: 1 } },
      ]),
    },
    {
      dataset: 'player_season_stats', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true,
      rows: mutate('player_season_stats', [
        { player_id: 1, season: 2023, games_played: 16, stats: { passingYards: 4000, passingTDs: 30 }, fantasy_points: '312.4' },
      ]),
    },
    {
      dataset: 'nfl_games_2024', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true,
      rows: mutate('nfl_games_2024', [
        { season: 2024, week: 1, nfl_team: 'KC', opponent: 'BUF', kickoff_at: '2024-09-08T17:00:00.000Z', game_key: null, home_away: null, neutral_site: null, venue: null, roof: null, surface: null, latitude: null, longitude: null, rest_days: null, team_key: 'KC', opponent_key: 'BUF' },
      ]),
    },
    {
      dataset: 'orientation_overlay', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true,
      rows: mutate('orientation_overlay', [
        { season: 2024, week: 1, team_key: 'KC', opponent_key: 'BUF', source_team: 'KC', home_away: 'home', neutral_site: false, game_id: '2024_01_BUF_KC' },
      ]),
    },
    {
      dataset: 'position_rank', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false,
      rows: mutate('position_rank', [{ code: 'QB', rank: '1' }, { code: 'RB', rank: '2' }]),
    },
    {
      dataset: 'player_name_rank', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false,
      rows: mutate('player_name_rank', [{ id: 1, name: 'Fixture Player', rank: '1' }]),
    },
    {
      dataset: 'games_csv', store: store.STORES.RAW, path: store.PATHS.PROVENANCE, seasonScoped: true,
      rows: mutate('games_csv', [
        { game_id: '2024_01_BUF_KC', season: 2024, game_type: 'REG', week: 1, away_team: 'BUF', home_team: 'KC', location: 'Home' },
      ]),
    },
    {
      dataset: 'oracle_2024_w1', store: store.STORES.EVALUATION, path: store.PATHS.OUTCOME, seasonScoped: true,
      rows: mutate('oracle_2024_w1', [
        { season: 2024, week: 1, player_id: 1, projection: FULL_PROJECTION },
      ]),
    },
  ];

  const written = datasets.map((d) => store.saveDataset({ root, ...d }));
  const manifest = {
    studyId: 'fixture-study', generator: 'test-fixture', extractedAt: '2026-01-01T00:00:00.000Z',
    planDigest: 'fixture-plan-digest', quarantineFromSeason: store.QUARANTINE_FROM_SEASON,
    seasons: [2024], datasets: written,
    // The sealed manifest's OWN sources array - what package-snapshot.js's
    // (round 6, packager-side) sealed-source binding check anchors every raw
    // source's on-disk bytes to, and what rehydrate.js's
    // readAndParseSealedSourceManifest anchors every rehydrated source to.
    // Defaults to the shared FIXTURE_SOURCES.records; see the `sourceRecords`
    // parameter docs above for when a test must override it.
    sources: (sourceRecords || FIXTURE_SOURCES.records).map(({ name, sha256, byteLength, file }) => (
      { name, sha256, byteLength, file }
    )),
  };
  store.saveManifest(root, manifest);
  fs.writeFileSync(store.receiptFile(root), `${store.canonicalJson({
    studyId: 'fixture-study', planDigest: 'fixture-digest', dryRunAt: '2026-01-01T00:00:00.000Z',
    rowCounts: {}, wouldWrite: [],
  })}\n`, 'utf8');

  const manifestBytes = fs.readFileSync(store.manifestFile(root));
  return { root, manifestSha256: sha256Hex(manifestBytes) };
}

function csv(header, rows) {
  return [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n';
}

/** A readSource sufficient for checkTeamContradictions over season 2024 only. */
function makeFixtureReadSource({ rosterTeam2024 = 'KC', statsTeam2024 = 'KC' } = {}) {
  return (arg) => {
    const name = typeof arg === 'string' ? arg : arg.name;
    if (name === 'roster_weekly_2024') {
      return csv(['season', 'week', 'game_type', 'gsis_id', 'team'], [
        { season: 2024, week: 1, game_type: 'REG', gsis_id: '00-0000001', team: rosterTeam2024 },
      ]);
    }
    if (name === 'stats_player_week_2024') {
      return csv(['season', 'week', 'season_type', 'player_id', 'team'], [
        { season: 2024, week: 1, season_type: 'REG', player_id: '00-0000001', team: statsTeam2024 },
      ]);
    }
    throw new Error(`no fixture readSource entry for ${name}`);
  };
}

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

// ---------------------------------------------------------------------------
// Fixture raw sources: a small, shared, read-only tree matching the REAL
// `SOURCES` registry by name and required column, so `packageSnapshot`'s
// mandatory source-packaging step has something real (if tiny) to chunk,
// hash-verify and secret-scan on every test run.
// ---------------------------------------------------------------------------

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
      return csv(sourceEntry.requiredColumns, [
        { gsis_id: '00-0000001', espn_id: '4241' },
      ]);
    default:
      throw new Error(`fixtureSourceCsvText: unhandled source kind ${sourceEntry.kind}`);
  }
}

/**
 * Build the ten fixture raw sources plus a matching `provenance.json` ONCE,
 * in a directory that lives for the whole test file (cleaned up via a
 * module-scope `test.after`, same idiom `tmpDir` already uses per-test).
 * `mutateText` lets a test corrupt exactly one source file's text for a
 * negative-path test, producing an INDEPENDENT copy of the fixture tree
 * rather than mutating the shared one other tests rely on.
 */
function buildFixtureSources({ mutateText = (name, text) => text } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-pkg-sources-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const records = [];
  let gamesCsvSha256 = null;
  for (const sourceEntry of REAL_SOURCES) {
    const text = mutateText(sourceEntry.name, fixtureSourceCsvText(sourceEntry));
    const bytes = Buffer.from(text, 'utf8');
    fs.writeFileSync(path.join(dir, sourceEntry.file), bytes);
    const sha256 = sha256Hex(bytes);
    if (sourceEntry.name === 'games') gamesCsvSha256 = sha256;
    records.push({ name: sourceEntry.name, file: sourceEntry.file, sha256, byteLength: bytes.length });
  }
  const provenancePath = path.join(dir, 'provenance.json');
  fs.writeFileSync(provenancePath, `${JSON.stringify({ generator: 'test-fixture', records }, null, 2)}\n`, 'utf8');
  return { sourcesDir: dir, provenancePath, gamesCsvSha256, records };
}

/** The shared, read-only fixture sources tree - built once, reused by every test below. */
const FIXTURE_SOURCES = buildFixtureSources();

/**
 * Thin wrapper around `packager.packageSnapshot` that supplies the shared
 * fixture sources by default, so every EXISTING test (which cares only
 * about dataset packaging) does not have to repeat that boilerplate. A test
 * that specifically exercises source-packaging behavior can still override
 * `sourcesDir`/`provenancePath`/`expectedGamesCsvSha256` explicitly.
 */
function packageSnapshotFixture(overrides = {}) {
  return packager.packageSnapshot({
    sourcesDir: FIXTURE_SOURCES.sourcesDir,
    provenancePath: FIXTURE_SOURCES.provenancePath,
    expectedGamesCsvSha256: FIXTURE_SOURCES.gamesCsvSha256,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The happy path, exercised through the same public API the real entrypoint
// (server/scripts/run-backtest-package.js) uses
// ---------------------------------------------------------------------------

test('packageSnapshot produces a full publication tree from a clean fixture snapshot', () => {
  const snapshotRoot = tmpDir('happy-snap');
  const publishRoot = tmpPublishPath('happy-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const readSource = makeFixtureReadSource();

  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource, normalizeTeamKey, expectedManifestSha256: manifestSha256,
  });

  assert.equal(result.manifest.sourceSnapshot.manifestSha256, manifestSha256);
  assert.equal(result.manifest.totals.datasets, 9);
  assert.ok(result.manifest.totals.chunks >= 9);
  assert.equal(result.verification.teamContradictions.hasFindings, false);
  assert.deepEqual(result.verification.teamContradictions.counts['2024'],
    { compared: 1, contradictions: 0, statRowsWithNoRosterRow: 0 });
  for (const r of result.verification.reconstruction) assert.equal(r.ok, true);
  for (const r of result.verification.schema) assert.equal(r.ok, true);
  for (const r of result.verification.secretScan) assert.equal(r.hits, 0);

  assert.ok(fs.existsSync(path.join(publishRoot, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(publishRoot, 'NOTICE.md')));
  assert.ok(fs.existsSync(path.join(publishRoot, '.gitattributes')));
  assert.ok(fs.existsSync(path.join(publishRoot, 'dry-run-receipt.json')));
  assert.ok(fs.existsSync(path.join(publishRoot, 'dry-run-receipt-note.md')));
  assert.ok(fs.existsSync(path.join(publishRoot, 'verification.json')));
  assert.ok(fs.existsSync(path.join(publishRoot, 'STAGING_PATHS.txt')));
  assert.ok(fs.existsSync(path.join(publishRoot, 'source-manifest.json')));
  assert.ok(fs.existsSync(path.join(publishRoot, 'sources-provenance.json')));
  for (const dataset of ['players', 'player_stats', 'player_season_stats', 'nfl_games_2024',
    'orientation_overlay', 'position_rank', 'player_name_rank', 'games_csv', 'oracle_2024_w1']) {
    assert.ok(fs.existsSync(path.join(publishRoot, 'chunks', dataset, 'chunk-0000.ndjson.gz')), dataset);
  }
  for (const sourceEntry of REAL_SOURCES) {
    assert.ok(fs.existsSync(path.join(publishRoot, 'sources', sourceEntry.name, 'chunk-0000.bin.gz')), sourceEntry.name);
  }
});

// ---------------------------------------------------------------------------
// Determinism: run the packager TWICE against the identical input and the
// identical output path, and byte-compare EVERY file it produced
// ---------------------------------------------------------------------------

test('packageSnapshot run twice on the same input produces byte-identical output, file for file', () => {
  const snapshotRoot = tmpDir('det-snap');
  const publishRoot = tmpPublishPath('det-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const readSource = makeFixtureReadSource();
  const run = () => packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource, normalizeTeamKey, expectedManifestSha256: manifestSha256,
  });

  run();
  const firstBytesByFile = new Map(
    walkFiles(publishRoot).map((f) => [path.relative(publishRoot, f), fs.readFileSync(f)])
  );
  fs.rmSync(publishRoot, { recursive: true, force: true });

  run();
  const secondFiles = walkFiles(publishRoot);
  assert.deepEqual(
    secondFiles.map((f) => path.relative(publishRoot, f)).sort(),
    [...firstBytesByFile.keys()].sort(),
    'the exact same set of files is produced both times'
  );
  for (const f of secondFiles) {
    const rel = path.relative(publishRoot, f);
    assert.ok(fs.readFileSync(f).equals(firstBytesByFile.get(rel)), `${rel} must be byte-identical across runs`);
  }
});

// ---------------------------------------------------------------------------
// Reconstruction proof, independently re-checked here (not just trusting
// the packager's own returned result)
// ---------------------------------------------------------------------------

test('every published chunk decompresses and reassembles to the exact original snapshot bytes', () => {
  const snapshotRoot = tmpDir('recon-snap');
  const publishRoot = tmpPublishPath('recon-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });

  for (const ds of result.manifest.datasets) {
    const originalFile = store.datasetFile(snapshotRoot, ds.store, ds.path, ds.dataset);
    const originalBytes = fs.readFileSync(originalFile);
    const pieces = ds.chunks.map((c) => {
      const compressed = fs.readFileSync(path.join(publishRoot, ...c.file.split('/')));
      assert.equal(sha256Hex(compressed), c.compressedSha256);
      const decompressed = zlib.gunzipSync(compressed);
      assert.equal(sha256Hex(decompressed), c.uncompressedSha256);
      return decompressed;
    });
    assert.ok(Buffer.concat(pieces).equals(originalBytes), `${ds.dataset} must reassemble exactly`);
  }
});

test('every published SOURCE chunk decompresses and reassembles to the exact original raw CSV bytes', () => {
  const snapshotRoot = tmpDir('recon-src-snap');
  const publishRoot = tmpPublishPath('recon-src-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });

  assert.equal(result.manifest.sources.length, REAL_SOURCES.length);
  for (const s of result.manifest.sources) {
    const originalFile = path.join(FIXTURE_SOURCES.sourcesDir, s.file);
    const originalBytes = fs.readFileSync(originalFile);
    const pieces = s.chunks.map((c) => {
      const compressed = fs.readFileSync(path.join(publishRoot, ...c.file.split('/')));
      assert.equal(sha256Hex(compressed), c.compressedSha256);
      const decompressed = zlib.gunzipSync(compressed);
      assert.equal(sha256Hex(decompressed), c.uncompressedSha256);
      return decompressed;
    });
    const reassembled = Buffer.concat(pieces);
    assert.ok(reassembled.equals(originalBytes), `${s.name} must reassemble exactly`);
    assert.equal(sha256Hex(reassembled), s.provenanceSha256);
  }
});

test('reconstructAndVerify throws when a published chunk has been tampered with after packaging', () => {
  const snapshotRoot = tmpDir('recon-tamper-snap');
  const publishRoot = tmpPublishPath('recon-tamper-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const playersChunkFile = path.join(publishRoot, 'chunks', 'players', 'chunk-0000.ndjson.gz');
  const tampered = fs.readFileSync(playersChunkFile);
  tampered[tampered.length - 1] ^= 0xff; // flip the last byte of the compressed chunk
  fs.writeFileSync(playersChunkFile, tampered);

  assert.throws(
    () => packager.reconstructAndVerify({ snapshotRoot, publishRoot, datasetEntries: result.manifest.datasets }),
    /reconstruction: players chunk 0/
  );
});

test('reconstructAndVerify throws when the reassembled bytes disagree with the original despite matching hashes recorded elsewhere', () => {
  // A more surgical tamper: replace the chunk with a DIFFERENT but validly
  // gzipped payload of the exact same compressed length is hard to force
  // deterministically, so instead this proves the final byte-compare fires
  // by pointing reconstructAndVerify at chunk metadata whose recorded hashes
  // do not match the file actually on disk for a DIFFERENT dataset than the
  // one tampered above - i.e. the dataset-entry/chunk-file pairing itself is
  // what is being proven load-bearing.
  const snapshotRoot = tmpDir('recon-tamper2-snap');
  const publishRoot = tmpPublishPath('recon-tamper2-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const swapped = result.manifest.datasets.map((d) => (d.dataset === 'players'
    ? { ...d, chunks: result.manifest.datasets.find((x) => x.dataset === 'position_rank').chunks }
    : d));
  assert.throws(
    () => packager.reconstructAndVerify({ snapshotRoot, publishRoot, datasetEntries: swapped }),
    /reconstruction proof FAILED for players/
  );
});

test('chunkTargetBytes actually forces multiple chunks, and reconstruction still holds', () => {
  const snapshotRoot = tmpDir('multichunk-snap');
  const publishRoot = tmpPublishPath('multichunk-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256, chunkTargetBytes: 40, // deliberately tiny
  });
  const playerStats = result.manifest.datasets.find((d) => d.dataset === 'player_stats');
  assert.ok(playerStats.chunkCount > 1, 'a tiny budget must force more than one chunk');
  const recon = result.verification.reconstruction.find((r) => r.dataset === 'player_stats');
  assert.equal(recon.ok, true);
});

test('sourceChunkTargetBytes forces multiple SOURCE chunks, and source reconstruction still holds', () => {
  const snapshotRoot = tmpDir('multichunk-src-snap');
  const publishRoot = tmpPublishPath('multichunk-src-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256, sourceChunkTargetBytes: 20, // deliberately tiny
  });
  const roster = result.manifest.sources.find((s) => s.name === 'roster_weekly_2024');
  assert.ok(roster.chunkCount > 1, 'a tiny budget must force more than one source chunk');
  const recon = result.verification.sourceReconstruction.find((r) => r.source === 'roster_weekly_2024');
  assert.equal(recon.ok, true);
});

// ---------------------------------------------------------------------------
// Manifest structure (requirement c): per-chunk fields, per-dataset totals,
// the global ordered chunk list
// ---------------------------------------------------------------------------

test('the publication manifest records every required per-chunk and per-dataset field, deterministically serialized', () => {
  const snapshotRoot = tmpDir('manifest-snap');
  const publishRoot = tmpPublishPath('manifest-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });

  const players = result.manifest.datasets.find((d) => d.dataset === 'players');
  assert.equal(players.chunkCount, 1);
  const chunk = players.chunks[0];
  for (const key of ['dataset', 'index', 'rowCount', 'uncompressedBytes', 'uncompressedSha256',
    'compressedBytes', 'compressedSha256', 'file']) {
    assert.ok(key in chunk, `chunk record missing ${key}`);
  }
  assert.equal(chunk.file, 'chunks/players/chunk-0000.ndjson.gz');

  assert.equal(result.manifest.totals.datasets, result.manifest.datasets.length);
  assert.equal(result.manifest.totals.chunks,
    result.manifest.datasets.reduce((s, d) => s + d.chunkCount, 0));
  assert.deepEqual(result.manifest.chunkList,
    result.manifest.datasets.flatMap((d) => d.chunks.map((c) => c.file)));

  // No new wall-clock timestamp: only the SOURCE manifest's own extractedAt
  // is carried forward, never a new "packagedAt".
  assert.equal(result.manifest.sourceSnapshot.extractedAt, '2026-01-01T00:00:00.000Z');
  assert.ok(!('packagedAt' in result.manifest));

  const onDisk = fs.readFileSync(path.join(publishRoot, 'manifest.json'), 'utf8');
  assert.ok(onDisk.endsWith('\n') && !onDisk.slice(0, -1).includes('\n'), 'one canonical line plus trailing LF');
  assert.equal(sha256Hex(Buffer.from(onDisk, 'utf8')), result.manifestSha256);

  // The raw-source counterparts (Finding 1): a `sources` array parallel to
  // `datasets`, and a `sourceChunking` block parallel to `chunking` that
  // names a DIFFERENT algorithm explicitly.
  assert.equal(result.manifest.sources.length, REAL_SOURCES.length);
  const roster = result.manifest.sources.find((s) => s.name === 'roster_weekly_2024');
  for (const key of ['name', 'file', 'kind', 'uncompressedBytes', 'uncompressedSha256',
    'provenanceSha256', 'chunkCount', 'chunks']) {
    assert.ok(key in roster, `source record missing ${key}`);
  }
  assert.equal(roster.chunks[0].file, 'sources/roster_weekly_2024/chunk-0000.bin.gz');
  assert.match(result.manifest.sourceChunking.algorithm, /fixed-size raw-byte chunking/);
  assert.match(result.manifest.sourceChunking.algorithm, /NOT line-atomic/);
  assert.notEqual(result.manifest.chunking.algorithm, result.manifest.sourceChunking.algorithm);
  assert.deepEqual(result.manifest.sourceChunkList,
    result.manifest.sources.flatMap((s) => s.chunks.map((c) => c.file)));
  assert.equal(result.manifest.sourceTotals.sources, REAL_SOURCES.length);
});

// ---------------------------------------------------------------------------
// generator section (sign-off condition attached to approving the fixed
// gzip OS byte, 0xFF): the exact Node/zlib build that produced this
// publication's gzip bytes must be recorded, since the exact bytes depend on
// the zlib build even with a pinned level/OS-byte/mtime=0.
// ---------------------------------------------------------------------------

test('manifest.json records a generator section with the real process.version and process.versions.zlib', () => {
  const snapshotRoot = tmpDir('generator-snap');
  const publishRoot = tmpPublishPath('generator-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  assert.equal(result.manifest.generator.node, process.version);
  assert.equal(result.manifest.generator.zlib, process.versions.zlib);
  assert.match(result.manifest.generator.note, /zlib/i);

  const onDisk = JSON.parse(fs.readFileSync(path.join(publishRoot, 'manifest.json'), 'utf8'));
  assert.equal(onDisk.generator.node, process.version);
  assert.equal(onDisk.generator.zlib, process.versions.zlib);
});

// ---------------------------------------------------------------------------
// fixedFiles section (round 4, MEDIUM finding 2): source-manifest.json,
// sources-provenance.json, and dry-run-receipt.json must each be recorded
// with the hash of the ACTUAL bytes writeVerified wrote, so rehydrate.js has
// something pinned to check them against before treating them as trustworthy.
// ---------------------------------------------------------------------------

test('manifest.json records a fixedFiles entry (name/sha256/byteLength) for source-manifest.json, sources-provenance.json, and dry-run-receipt.json, matching the actual bytes on disk', () => {
  const snapshotRoot = tmpDir('fixedfiles-snap');
  const publishRoot = tmpPublishPath('fixedfiles-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const byName = new Map(result.manifest.fixedFiles.map((f) => [f.name, f]));
  for (const name of ['source-manifest.json', 'sources-provenance.json', 'dry-run-receipt.json']) {
    const record = byName.get(name);
    assert.ok(record, `fixedFiles must include ${name}`);
    const bytes = fs.readFileSync(path.join(publishRoot, name));
    assert.equal(record.sha256, sha256Hex(bytes), `${name} fixedFiles sha256 must match the actual bytes on disk`);
    assert.equal(record.byteLength, bytes.length, `${name} fixedFiles byteLength must match the actual bytes on disk`);
  }
});

// ---------------------------------------------------------------------------
// NOTICE.md / .gitattributes / staging paths
// ---------------------------------------------------------------------------

test('NOTICE.md names the pinned sources, follows house copy style, and never echoes real row data', () => {
  const snapshotRoot = tmpDir('notice-snap');
  const publishRoot = tmpPublishPath('notice-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const notice = fs.readFileSync(path.join(publishRoot, 'NOTICE.md'), 'utf8');
  assert.match(notice, /nflverse-data/);
  assert.match(notice, /nflverse\/nfldata/);
  assert.match(notice, /games\.csv/);
  assert.ok(!notice.includes('—'), 'house style: no em-dashes in user-facing copy');
});

test('NOTICE.md attributes nflverse-data under CC BY 4.0 and states chunking/gzip is the only transformation', () => {
  const snapshotRoot = tmpDir('notice-ccby-snap');
  const publishRoot = tmpPublishPath('notice-ccby-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const notice = fs.readFileSync(path.join(publishRoot, 'NOTICE.md'), 'utf8');
  assert.match(notice, /CC BY 4\.0/);
  assert.match(notice, /nflverse-data\/blob\/main\/LICENSE\.md/);
  assert.match(notice, /only transformation/i);
});

test('NOTICE.md states games.csv redistribution permission is NOT established, not that it is fine', () => {
  const snapshotRoot = tmpDir('notice-games-snap');
  const publishRoot = tmpPublishPath('notice-games-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const notice = fs.readFileSync(path.join(publishRoot, 'NOTICE.md'), 'utf8');
  assert.match(notice, /has NOT\s+been established or confirmed/);
  assert.match(notice, /licensing status flagged as unresolved,\s+not asserted to be fine/);
});

test('NOTICE.md names the real upstream systems (Tank01, nflverse, Sleeper, FantasyFootballCalculator, ESPN) rather than implying the app generated the data itself', () => {
  const snapshotRoot = tmpDir('notice-provenance-snap');
  const publishRoot = tmpPublishPath('notice-provenance-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const notice = fs.readFileSync(path.join(publishRoot, 'NOTICE.md'), 'utf8');
  assert.match(notice, /Tank01/);
  assert.match(notice, /Sleeper/);
  assert.match(notice, /FantasyFootballCalculator/);
  assert.match(notice, /ESPN/);
  assert.match(notice, /external_id/);
});

test('NOTICE.md narrows the privacy claim to Endzone user/account/league/credential/authentication data, and does not claim "no personal data"', () => {
  const snapshotRoot = tmpDir('notice-privacy-snap');
  const publishRoot = tmpPublishPath('notice-privacy-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const notice = fs.readFileSync(path.join(publishRoot, 'NOTICE.md'), 'utf8');
  assert.match(notice, /no Endzone USER, ACCOUNT, LEAGUE, CREDENTIAL, or AUTHENTICATION/);
  assert.match(notice, /birth_date/);
  assert.ok(!/No proprietary, personal, league, or account data of any kind/.test(notice),
    'must not still claim the old, overly broad "no personal data" wording');
});

test('NOTICE.md states a factual inventory of the personal/biographical categories present, never a value judgment about whether publishing them is defensible', () => {
  const snapshotRoot = tmpDir('notice-factual-snap');
  const publishRoot = tmpPublishPath('notice-factual-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const notice = fs.readFileSync(path.join(publishRoot, 'NOTICE.md'), 'utf8');
  assert.ok(!/defensible/i.test(notice),
    'must not assert a legal/ethical conclusion ("that is a defensible thing to publish") - only facts');
  assert.match(notice, /report_status/);
  assert.match(notice, /gsis_id/);
  assert.match(notice, /espn_id/);
  assert.match(notice, /nfl_id/);
  assert.match(notice, /pfr_id/);
  assert.match(notice, /pff_id/);
  assert.match(notice, /otc_id/);
  assert.match(notice, /esb_id/);
  assert.match(notice, /smart_id/);
  assert.match(notice, /headshot/);
});

test('NOTICE.md documents the sources/ raw chunks, the two provenance copies, and points at the rehydrator', () => {
  const snapshotRoot = tmpDir('notice-sources-snap');
  const publishRoot = tmpPublishPath('notice-sources-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const notice = fs.readFileSync(path.join(publishRoot, 'NOTICE.md'), 'utf8');
  assert.match(notice, /source-manifest\.json/);
  assert.match(notice, /sources-provenance\.json/);
  assert.match(notice, /rehydrate\.js/);
  assert.match(notice, /injuries_2024\.csv/);
});

test('.gitattributes marks JSON/NDJSON text+LF and .gz binary, and explains the autocrlf risk', () => {
  const snapshotRoot = tmpDir('attrs-snap');
  const publishRoot = tmpPublishPath('attrs-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const attrs = fs.readFileSync(path.join(publishRoot, '.gitattributes'), 'utf8');
  assert.match(attrs, /\*\.json text eol=lf/);
  assert.match(attrs, /\*\.ndjson text eol=lf/);
  assert.match(attrs, /\*\.gz binary/);
  assert.match(attrs, /core\.autocrlf=true/);
});

test('STAGING_PATHS.txt individually names every publication file (datasets AND sources), is sorted, and never names backtest-data/snapshot', () => {
  const snapshotRoot = tmpDir('staging-snap');
  const publishRoot = tmpPublishPath('staging-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const text = fs.readFileSync(path.join(publishRoot, 'STAGING_PATHS.txt'), 'utf8');
  const lines = text.trim().split('\n');
  assert.deepEqual(lines, [...lines].sort(), 'the staging list is sorted');
  assert.equal(new Set(lines).size, lines.length, 'no duplicate path');
  assert.ok(!lines.some((l) => l.includes('backtest-data/snapshot')), 'never names the sealed snapshot input');
  assert.ok(!lines.some((l) => l.includes('backtest-data/sources')), 'never names the sealed sources input');
  assert.ok(!lines.some((l) => l === '-A' || l.includes('*')), 'never a glob or -A shorthand');
  assert.deepEqual(lines, result.stagingPaths);
  for (const chunkPath of result.manifest.chunkList) {
    assert.ok(lines.some((l) => l.endsWith(`/${chunkPath}`)), `${chunkPath} individually named`);
  }
  for (const chunkPath of result.manifest.sourceChunkList) {
    assert.ok(lines.some((l) => l.endsWith(`/${chunkPath}`)), `${chunkPath} individually named`);
  }
  assert.ok(lines.some((l) => l.endsWith('/source-manifest.json')));
  assert.ok(lines.some((l) => l.endsWith('/sources-provenance.json')));
});

// ---------------------------------------------------------------------------
// dry-run-receipt.json (requirement h)
// ---------------------------------------------------------------------------

test('dry-run-receipt.json is copied byte for byte, alongside a note documenting what it does and does not prove', () => {
  const snapshotRoot = tmpDir('receipt-snap');
  const publishRoot = tmpPublishPath('receipt-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const src = fs.readFileSync(store.receiptFile(snapshotRoot));
  const dst = fs.readFileSync(path.join(publishRoot, 'dry-run-receipt.json'));
  assert.ok(src.equals(dst));
  const note = fs.readFileSync(path.join(publishRoot, 'dry-run-receipt-note.md'), 'utf8');
  assert.match(note, /configuration digest/);
  assert.match(note, /does NOT prove/);
  assert.match(note, /byte-identical/);
});

// ---------------------------------------------------------------------------
// source-manifest.json / sources-provenance.json (Finding 1, item 3)
// ---------------------------------------------------------------------------

test('source-manifest.json is a byte-for-byte copy of the sealed snapshot manifest, and sources-provenance.json of provenance.json', () => {
  const snapshotRoot = tmpDir('srcmanifest-snap');
  const publishRoot = tmpPublishPath('srcmanifest-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  const sealed = fs.readFileSync(store.manifestFile(snapshotRoot));
  const published = fs.readFileSync(path.join(publishRoot, 'source-manifest.json'));
  assert.ok(sealed.equals(published));

  const provenanceSealed = fs.readFileSync(FIXTURE_SOURCES.provenancePath);
  const provenancePublished = fs.readFileSync(path.join(publishRoot, 'sources-provenance.json'));
  assert.ok(provenanceSealed.equals(provenancePublished));
});

test('verification.json records receiptScan, sourceManifestScan, and per-source sourceScan/sourceReconstruction results', () => {
  const snapshotRoot = tmpDir('verjson-snap');
  const publishRoot = tmpPublishPath('verjson-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256,
  });
  assert.equal(result.verification.receiptScan.hits, 0);
  assert.equal(result.verification.sourceManifestScan.sourceManifest.hits, 0);
  assert.equal(result.verification.sourceManifestScan.provenance.hits, 0);
  assert.equal(result.verification.sourceScan.length, REAL_SOURCES.length);
  for (const s of result.verification.sourceScan) assert.equal(s.hits, 0);
  assert.equal(result.verification.sourceReconstruction.length, REAL_SOURCES.length);
  for (const r of result.verification.sourceReconstruction) assert.equal(r.ok, true);

  const onDisk = JSON.parse(fs.readFileSync(path.join(publishRoot, 'verification.json'), 'utf8'));
  assert.equal(onDisk.receiptScan.hits, 0);
  assert.equal(onDisk.sourceManifestScan.sourceManifest.hits, 0);
  assert.equal(onDisk.sourceScan.length, REAL_SOURCES.length);
});

// ---------------------------------------------------------------------------
// The real teamContradictions execution (requirement g) - never skipped,
// and a fixture where a contradiction genuinely exists and is caught
// ---------------------------------------------------------------------------

test('teamContradictions runs for real and reports zero on agreeing sources', () => {
  const snapshotRoot = tmpDir('tc-clean-snap');
  const publishRoot = tmpPublishPath('tc-clean-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot, rosterTeam2024: 'KC', statsTeam2024: 'KC' });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource({ rosterTeam2024: 'KC', statsTeam2024: 'KC' }),
    normalizeTeamKey, expectedManifestSha256: manifestSha256,
  });
  assert.equal(result.verification.teamContradictions.hasFindings, false);
  assert.equal(result.verification.teamContradictions.totalContradictions, 0);
});

test('a genuine roster-vs-gameTeam contradiction is found for real, recorded, and does NOT abort packaging WHEN acknowledged', () => {
  const snapshotRoot = tmpDir('tc-found-snap');
  const publishRoot = tmpPublishPath('tc-found-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  // The roster says KC; the stats source says BUF for the SAME player-week -
  // a real, detectable contradiction.
  const readSource = makeFixtureReadSource({ rosterTeam2024: 'KC', statsTeam2024: 'BUF' });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource, normalizeTeamKey, expectedManifestSha256: manifestSha256,
    acknowledgeContradictions: true,
  });
  assert.equal(result.verification.teamContradictions.hasFindings, true);
  assert.equal(result.verification.teamContradictions.totalContradictions, 1);
  assert.equal(result.verification.teamContradictions.acknowledged, true);
  assert.deepEqual(result.verification.teamContradictions.counts['2024'],
    { compared: 1, contradictions: 1, statRowsWithNoRosterRow: 0 });
  // Packaging still completed - contradictions are reported, never excluded.
  assert.ok(fs.existsSync(path.join(publishRoot, 'manifest.json')));
  const onDisk = JSON.parse(fs.readFileSync(path.join(publishRoot, 'verification.json'), 'utf8'));
  assert.deepEqual(onDisk.teamContradictions.counts['2024'],
    { compared: 1, contradictions: 1, statRowsWithNoRosterRow: 0 });
  assert.equal(onDisk.teamContradictions.acknowledged, true,
    'the acknowledgement itself must be recorded in the on-disk verification.json, not only in the returned result');
});

// ---------------------------------------------------------------------------
// The user's "report, never abort" approval was conditional: ONLY with an
// explicit, per-run, recorded acknowledgement whenever hasFindings is true.
// acknowledgeContradictions defaults to false, so a run that finds a real
// contradiction and was never told to acknowledge one must refuse to
// silently proceed past it.
// ---------------------------------------------------------------------------

test('packageSnapshot refuses to proceed past a real, nonzero contradiction count without acknowledgeContradictions: true', () => {
  const snapshotRoot = tmpDir('tc-unacked-snap');
  const publishRoot = tmpDir('tc-unacked-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const readSource = makeFixtureReadSource({ rosterTeam2024: 'KC', statsTeam2024: 'BUF' });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource, normalizeTeamKey, expectedManifestSha256: manifestSha256,
      // acknowledgeContradictions deliberately omitted - defaults to false
    }),
    /acknowledgeContradictions was not explicitly set to true/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')), 'nothing is written on refusal');

  // Explicitly passing false must behave identically to omitting it.
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource, normalizeTeamKey, expectedManifestSha256: manifestSha256,
      acknowledgeContradictions: false,
    }),
    /acknowledgeContradictions was not explicitly set to true/
  );
});

test('acknowledgeContradictions has no effect when there are zero contradictions - packaging succeeds the same either way', () => {
  const snapshotRoot = tmpDir('tc-clean-ack-snap');
  const publishRoot = tmpPublishPath('tc-clean-ack-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot, rosterTeam2024: 'KC', statsTeam2024: 'KC' });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource({ rosterTeam2024: 'KC', statsTeam2024: 'KC' }),
    normalizeTeamKey, expectedManifestSha256: manifestSha256,
    // acknowledgeContradictions omitted - must not matter when hasFindings is false
  });
  assert.equal(result.verification.teamContradictions.hasFindings, false);
  assert.ok(!('acknowledged' in result.verification.teamContradictions),
    'no acknowledged field when there was nothing to acknowledge');
});

test('a WAS/WSH-shaped spelling difference is normalized away and never counted as a contradiction', () => {
  const snapshotRoot = tmpDir('tc-spelling-snap');
  const publishRoot = tmpPublishPath('tc-spelling-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  // 'LA' (roster) vs 'LAR' (stats) both normalize to the same team key.
  const readSource = makeFixtureReadSource({ rosterTeam2024: 'LA', statsTeam2024: 'LAR' });
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource, normalizeTeamKey, expectedManifestSha256: manifestSha256,
  });
  assert.equal(result.verification.teamContradictions.hasFindings, false);
});

test('packageSnapshot refuses to run without readSource or normalizeTeamKey - it may never silently skip', () => {
  const snapshotRoot = tmpDir('mandatory-snap');
  const publishRoot = tmpDir('mandatory-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, normalizeTeamKey, expectedManifestSha256: manifestSha256,
    }),
    /readSource is required/
  );
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), expectedManifestSha256: manifestSha256,
    }),
    /normalizeTeamKey is required/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')), 'nothing is written on refusal');
});

test('packageSnapshot refuses to run without sourcesDir or provenancePath - sources may never be silently skipped', () => {
  const snapshotRoot = tmpDir('mandatory-src-snap');
  const publishRoot = tmpDir('mandatory-src-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      provenancePath: FIXTURE_SOURCES.provenancePath, expectedManifestSha256: manifestSha256,
    }),
    /sourcesDir is required/
  );
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      sourcesDir: FIXTURE_SOURCES.sourcesDir, expectedManifestSha256: manifestSha256,
    }),
    /provenancePath is required/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')), 'nothing is written on refusal');
});

// ---------------------------------------------------------------------------
// F1 (BLOCKER, review round 2): snapshotRoot and publishRoot must be
// structurally disjoint - a copy-paste transposition of --snapshot/--publish
// must never let packaging overwrite the sealed, never-in-git snapshot.
// ---------------------------------------------------------------------------

test('packageSnapshot refuses when snapshotRoot and publishRoot are the SAME directory, before any write', () => {
  const dir = tmpDir('collide-equal');
  const { manifestSha256 } = buildFixtureSnapshot({ root: dir });
  const manifestBefore = fs.readFileSync(store.manifestFile(dir));
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot: dir, publishRoot: dir, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    /snapshotRoot and publishRoot resolve to the SAME directory/
  );
  assert.ok(fs.readFileSync(store.manifestFile(dir)).equals(manifestBefore),
    'the fixture manifest bytes must be byte-identical after the refusal');
});

test('packageSnapshot refuses when publishRoot is nested INSIDE snapshotRoot, before any write', () => {
  const snapshotRoot = tmpDir('collide-publish-in-snapshot');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const manifestBefore = fs.readFileSync(store.manifestFile(snapshotRoot));
  const publishRoot = path.join(snapshotRoot, 'publish-subdir');
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    /publishRoot .* is nested INSIDE snapshotRoot/
  );
  assert.ok(fs.readFileSync(store.manifestFile(snapshotRoot)).equals(manifestBefore),
    'the fixture manifest bytes must be byte-identical after the refusal');
  assert.ok(!fs.existsSync(publishRoot), 'nothing was written under the sealed snapshot tree');
});

test('packageSnapshot refuses when snapshotRoot is nested INSIDE publishRoot, before any write', () => {
  const publishRoot = tmpDir('collide-snapshot-in-publish');
  const snapshotRoot = path.join(publishRoot, 'nested-snapshot');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const manifestBefore = fs.readFileSync(store.manifestFile(snapshotRoot));
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    /snapshotRoot .* is nested INSIDE publishRoot/
  );
  assert.ok(fs.readFileSync(store.manifestFile(snapshotRoot)).equals(manifestBefore),
    'the fixture manifest bytes must be byte-identical after the refusal');
});

test('the CLI (main()) inherits the disjoint-roots guard for free, since it delegates to packageSnapshot', () => {
  const dir = tmpDir('collide-cli');
  buildFixtureSnapshot({ root: dir });
  assert.throws(
    () => packager.main(['--snapshot', dir, '--publish', dir], {
      log: () => {}, normalizeTeamKey, readSource: makeFixtureReadSource(),
    }),
    /snapshotRoot and publishRoot resolve to the SAME directory/
  );
});

// ---------------------------------------------------------------------------
// Finding 2: assertDisjointRoots must be immune to a Windows case-only
// difference (NTFS is case-insensitive by default) - path.resolve alone
// does not case-fold, so a plain string compare lets a case-only alias
// straight through. These tests only exercise the real collision on win32,
// where the premise (NTFS case-insensitivity) actually holds.
// ---------------------------------------------------------------------------

test('assertDisjointRoots catches a same-directory reference that differs only in CASE, on Windows', (t) => {
  if (process.platform !== 'win32') { t.skip('NTFS case-insensitivity is a win32-only concern'); return; }
  const dir = tmpDir('case-collide');
  const upperAlias = path.join(path.dirname(dir), path.basename(dir).toUpperCase());
  assert.ok(fs.existsSync(upperAlias), 'the uppercased alias must resolve to the SAME real directory on NTFS');
  assert.throws(() => packager.assertDisjointRoots(dir, upperAlias), /SAME directory/);
  assert.throws(() => packager.assertDisjointRoots(upperAlias, dir), /SAME directory/);
});

test('assertDisjointRoots catches a NESTED collision disguised by case, on Windows', (t) => {
  if (process.platform !== 'win32') { t.skip('NTFS case-insensitivity is a win32-only concern'); return; }
  const parent = tmpDir('case-nest-parent');
  const childReal = path.join(parent, 'child');
  fs.mkdirSync(childReal);
  const parentUpperAlias = path.join(path.dirname(parent), path.basename(parent).toUpperCase());
  // snapshotRoot referenced via the parent's uppercased alias; publishRoot is
  // the real child path - a real "publishRoot nested inside snapshotRoot"
  // even though the two strings share no common case-sensitive prefix.
  assert.throws(
    () => packager.assertDisjointRoots(parentUpperAlias, childReal),
    /publishRoot .* is nested INSIDE snapshotRoot/
  );
});

test('assertDisjointRoots case-folds correctly even when NEITHER directory has been created yet, only their shared parent has', (t) => {
  if (process.platform !== 'win32') { t.skip('NTFS case-insensitivity is a win32-only concern'); return; }
  const parent = tmpDir('case-notyet');
  const parentUpperAlias = path.join(path.dirname(parent), path.basename(parent).toUpperCase());
  const snapshotRoot = path.join(parent, 'not-created-yet');
  const publishRoot = path.join(parentUpperAlias, 'not-created-yet');
  assert.ok(!fs.existsSync(snapshotRoot) && !fs.existsSync(publishRoot),
    'neither leaf exists yet - only their shared parent does');
  assert.throws(() => packager.assertDisjointRoots(snapshotRoot, publishRoot), /SAME directory/);
});

test('assertDisjointRoots catches a collision hidden behind a directory junction, when one can be created', (t) => {
  if (process.platform !== 'win32') { t.skip('directory junctions are a win32-only concern here'); return; }
  const real = tmpDir('junction-real');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-pkg-junction-parent-'));
  test.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const junctionPath = path.join(parent, 'alias');
  try {
    fs.symlinkSync(real, junctionPath, 'junction');
  } catch (err) {
    t.skip(`could not create a directory junction in this environment (${err.code || err.message})`);
    return;
  }
  assert.throws(() => packager.assertDisjointRoots(real, junctionPath), /SAME directory/);
});

// ---------------------------------------------------------------------------
// BLOCKER (adversarial review round 3): fs.realpathSync.native does NOT
// collapse a UNC admin-share alias (\\localhost\C$\...) down to its local
// drive-letter equivalent, so a real collision reachable through that alias
// shape would otherwise sail past assertDisjointRoots undetected. The fix is
// to reject any UNC-form path outright, before canonicalization ever runs.
// ---------------------------------------------------------------------------

test('a UNC admin-share alias reads back the identical bytes written through the local drive-letter path (reproducing the reviewer-proven alias)', (t) => {
  if (process.platform !== 'win32') { t.skip('UNC admin shares are a win32-only concern'); return; }
  const dir = tmpDir('unc-alias-real');
  fs.writeFileSync(path.join(dir, 'marker.txt'), 'unc-alias-marker\n');
  const driveLetter = dir.charAt(0);
  const uncDir = `\\\\localhost\\${driveLetter}$${dir.slice(2)}`;
  let uncBytes;
  try {
    uncBytes = fs.readFileSync(path.join(uncDir, 'marker.txt'));
  } catch (err) {
    t.skip(`administrative shares are not reachable in this environment (${err.code || err.message})`);
    return;
  }
  assert.equal(uncBytes.toString('utf8'), 'unc-alias-marker\n',
    'the UNC admin-share form must read back the exact bytes written through the local path - proving ' +
    'the two path forms name the SAME directory, which realpathSync.native does not agree they do');

  // Now confirm the fix: assertDisjointRoots must refuse the UNC form
  // outright, in either position, rather than silently letting a real
  // collision through an alias shape canonicalization cannot see through.
  assert.throws(() => packager.assertDisjointRoots(dir, uncDir), /UNC-form path/);
  assert.throws(() => packager.assertDisjointRoots(uncDir, dir), /UNC-form path/);
});

test('assertNotUncFormPath rejects every named UNC alias shape and leaves ordinary drive-letter paths untouched', () => {
  assert.throws(
    () => packager.assertNotUncFormPath('\\\\localhost\\C$\\backtest-data\\snapshot', 'snapshotRoot'),
    /snapshotRoot .*is a UNC-form path/
  );
  assert.throws(
    () => packager.assertNotUncFormPath('\\\\fileserver\\share\\backtest-data\\publish', 'publishRoot'),
    /publishRoot .*is a UNC-form path/
  );
  assert.throws(
    () => packager.assertNotUncFormPath('\\\\?\\UNC\\localhost\\C$\\backtest-data\\snapshot', 'snapshotRoot'),
    /UNC-form path/
  );
  // A forward-slash-spelled UNC path must not slip through unnoticed either.
  assert.throws(
    () => packager.assertNotUncFormPath('//localhost/C$/backtest-data/snapshot', 'snapshotRoot'),
    /UNC-form path/
  );
  // An ordinary drive-letter path is never affected by this guard.
  assert.doesNotThrow(() => packager.assertNotUncFormPath('C:\\backtest-data\\snapshot', 'snapshotRoot'));
  assert.doesNotThrow(() => packager.assertNotUncFormPath('/home/user/backtest-data/snapshot', 'snapshotRoot'));
});

test('assertDisjointRoots refuses a UNC-form snapshotRoot or publishRoot even when the two paths are otherwise unrelated (fail closed on the path shape alone)', () => {
  assert.throws(
    () => packager.assertDisjointRoots('\\\\localhost\\C$\\some\\unrelated\\path', 'C:\\backtest-data\\publish'),
    /snapshotRoot .*is a UNC-form path/
  );
  assert.throws(
    () => packager.assertDisjointRoots('C:\\backtest-data\\snapshot', '\\\\localhost\\C$\\some\\unrelated\\path'),
    /publishRoot .*is a UNC-form path/
  );
});

test('assertDisjointRoots still catches the ordinary nested-either-direction and exact-match cases after canonicalization', () => {
  const a = tmpDir('regress-a');
  const bNotExisting = path.join(a, 'b');
  assert.throws(() => packager.assertDisjointRoots(a, bNotExisting), /nested INSIDE snapshotRoot/);
  assert.throws(() => packager.assertDisjointRoots(bNotExisting, a), /nested INSIDE publishRoot/);
  assert.throws(() => packager.assertDisjointRoots(a, a), /SAME directory/);
});

// ---------------------------------------------------------------------------
// Round 6, finding 4: a third-party review reproduced `C:\` and `C:\Users`
// passing as "disjoint", because the old nesting check compared with
// `child.startsWith(parent + path.sep)` - and `path.resolve`/`realpathSync`
// already render a drive/filesystem root WITH a trailing separator, so
// appending a SECOND one produced a string (`C:\\`) nothing starts with.
// Fixed by replacing the manual prefix check with `path.relative`
// (`isContainedIn` in lib/rootSafety.js), which has no such edge case.
// ---------------------------------------------------------------------------

test('assertDisjointRoots catches C:\\ containing C:\\Users - the exact drive-root containment bypass a third-party review reproduced, on Windows', (t) => {
  // A drive letter + backslash is a win32-only notion - on POSIX, backslash
  // is an ordinary filename character, so 'C:\' and 'C:\Users' are just two
  // unrelated sibling strings sharing a prefix, not a root/child pair. This
  // premise (that 'C:\Users' names a real child of 'C:\') only holds on
  // win32; CI's Linux runner surfaced exactly this the first time this test
  // ever ran off the original Windows dev box.
  if (process.platform !== 'win32') { t.skip('drive-letter path semantics are a win32-only concern'); return; }
  assert.throws(() => packager.assertDisjointRoots('C:\\', 'C:\\Users'), /nested INSIDE snapshotRoot/);
  assert.throws(() => packager.assertDisjointRoots('C:\\Users', 'C:\\'), /nested INSIDE publishRoot/);
});

test('isContainedIn correctly handles a Windows drive-root parent that already carries a trailing separator', (t) => {
  if (process.platform !== 'win32') { t.skip('drive-letter path semantics are a win32-only concern'); return; }
  const { isContainedIn } = packager;
  assert.equal(isContainedIn('C:\\', 'C:\\Users'), true);
  assert.equal(isContainedIn('C:\\Users', 'C:\\'), false);
  assert.equal(isContainedIn('C:\\foo', 'C:\\foo'), false, 'equal paths are not containment - that is the SAME-directory case');
  assert.equal(isContainedIn('C:\\foo', 'C:\\foobar'), false, 'a sibling with a shared string prefix must not be treated as nested');
});

test('isContainedIn correctly handles a POSIX root parent that already carries a trailing separator', () => {
  // The POSIX-side analog of the Windows drive-root case above - this
  // assertion does not depend on platform-specific path semantics the way
  // the win32 literals above do ('/' is a real filesystem root on any
  // platform Node runs on), so it is not gated.
  const { isContainedIn } = packager;
  assert.equal(isContainedIn('/', '/etc'), true);
  assert.equal(isContainedIn('/etc', '/'), false);
  assert.equal(isContainedIn('/foo', '/foo'), false, 'equal paths are not containment - that is the SAME-directory case');
  assert.equal(isContainedIn('/foo', '/foobar'), false, 'a sibling with a shared string prefix must not be treated as nested');
});

// ---------------------------------------------------------------------------
// Round 4, MEDIUM finding 1: warnAboutLeakedTempDirs (which calls
// fs.readdirSync on publishRoot's parent - a real SMB directory-listing call
// if publishRoot is UNC-shaped) must never run before the UNC-rejection
// guard. Proven by pointing publishRoot at a UNC-form path and confirming
// fs.readdirSync itself is never invoked.
// ---------------------------------------------------------------------------

test('packageSnapshot checks disjoint roots (and rejects a UNC-form publishRoot) BEFORE ever scanning for leaked temp dirs', () => {
  const snapshotRoot = tmpDir('order-snap');
  buildFixtureSnapshot({ root: snapshotRoot });
  const uncPublishRoot = '\\\\localhost\\C$\\some\\unc\\publish\\path';

  const originalReaddirSync = fs.readdirSync;
  let called = false;
  fs.readdirSync = (...args) => { called = true; return originalReaddirSync(...args); };
  let thrown;
  try {
    try {
      packageSnapshotFixture({
        snapshotRoot, publishRoot: uncPublishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      });
      assert.fail('must throw for a UNC-form publishRoot');
    } catch (err) {
      thrown = err;
    }
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
  assert.match(thrown.message, /publishRoot .*is a UNC-form path/);
  assert.equal(called, false,
    'fs.readdirSync (the leaked-temp-dir scan) must never run before the UNC-rejection guard has a chance to refuse the path');
});

// ---------------------------------------------------------------------------
// Round 4, MEDIUM finding 2: a canonicalization failure on an ancestor that
// DOES exist must ABORT, never silently fall back to an unresolved path.
// Proven via the injectable realpathNative seam canonicalizeForCompare now
// takes, rather than depending on platform-specific permission revocation.
// ---------------------------------------------------------------------------

test('canonicalizeForCompare aborts (never falls back) when fs.realpathSync.native fails on an existing ancestor', () => {
  const dir = tmpDir('realpath-fail');
  const failingRealpathNative = () => { throw new Error('simulated EPERM: permission denied'); };
  assert.throws(
    () => packager.canonicalizeForCompare(dir, { realpathNative: failingRealpathNative }),
    /could not canonicalize .* refusing to fall back to an unresolved, potentially-aliased path/
  );
});

test('canonicalizeForCompare still succeeds normally when realpathNative is not injected (the real fs.realpathSync.native)', () => {
  const dir = tmpDir('realpath-ok');
  const result = packager.canonicalizeForCompare(dir);
  assert.ok(typeof result === 'string' && result.length > 0);
});

// ---------------------------------------------------------------------------
// Round 4, MEDIUM finding 3: sourcesDir was never checked against
// snapshotRoot or publishRoot at all. packageSnapshot must now refuse a
// sourcesDir that collides with either, pairwise, in every direction.
// ---------------------------------------------------------------------------

test('packageSnapshot refuses when sourcesDir is the SAME directory as snapshotRoot, before any write', () => {
  const dir = tmpDir('src-eq-snap');
  const { manifestSha256 } = buildFixtureSnapshot({ root: dir });
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot: dir, publishRoot: tmpPublishPath('src-eq-snap-pub'),
      sourcesDir: dir, provenancePath: FIXTURE_SOURCES.provenancePath,
      readSource: makeFixtureReadSource(), normalizeTeamKey, expectedManifestSha256: manifestSha256,
    }),
    /snapshotRoot and sourcesDir resolve to the SAME directory/
  );
});

test('packageSnapshot refuses when sourcesDir is the SAME directory as publishRoot, before any write', () => {
  const snapshotRoot = tmpDir('src-eq-pub-snap');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const publishAndSources = tmpDir('src-eq-pub-both');
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot: publishAndSources,
      sourcesDir: publishAndSources, provenancePath: FIXTURE_SOURCES.provenancePath,
      readSource: makeFixtureReadSource(), normalizeTeamKey, expectedManifestSha256: manifestSha256,
    }),
    /publishRoot and sourcesDir resolve to the SAME directory/
  );
});

test('packageSnapshot refuses when sourcesDir is nested INSIDE snapshotRoot, before any write', () => {
  const snapshotRoot = tmpDir('src-in-snap');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const sourcesDir = path.join(snapshotRoot, 'nested-sources');
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot: tmpPublishPath('src-in-snap-pub'),
      sourcesDir, provenancePath: FIXTURE_SOURCES.provenancePath,
      readSource: makeFixtureReadSource(), normalizeTeamKey, expectedManifestSha256: manifestSha256,
    }),
    /sourcesDir .* is nested INSIDE snapshotRoot/
  );
});

test('packageSnapshot refuses when snapshotRoot is nested INSIDE sourcesDir, before any write', () => {
  const sourcesDir = tmpDir('snap-in-src');
  const snapshotRoot = path.join(sourcesDir, 'nested-snapshot');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot: tmpPublishPath('snap-in-src-pub'),
      sourcesDir, provenancePath: FIXTURE_SOURCES.provenancePath,
      readSource: makeFixtureReadSource(), normalizeTeamKey, expectedManifestSha256: manifestSha256,
    }),
    /snapshotRoot .* is nested INSIDE sourcesDir/
  );
});

test('packageSnapshot refuses when sourcesDir is nested INSIDE publishRoot, before any write', () => {
  const snapshotRoot = tmpDir('src-in-pub-snap');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const publishRoot = tmpDir('src-in-pub-pub');
  const sourcesDir = path.join(publishRoot, 'nested-sources');
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot, sourcesDir, provenancePath: FIXTURE_SOURCES.provenancePath,
      readSource: makeFixtureReadSource(), normalizeTeamKey, expectedManifestSha256: manifestSha256,
    }),
    /sourcesDir .* is nested INSIDE publishRoot/
  );
});

test('packageSnapshot refuses when publishRoot is nested INSIDE sourcesDir, before any write', () => {
  const snapshotRoot = tmpDir('pub-in-src-snap');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const sourcesDir = tmpDir('pub-in-src-sources');
  const publishRoot = path.join(sourcesDir, 'nested-publish');
  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot, sourcesDir, provenancePath: FIXTURE_SOURCES.provenancePath,
      readSource: makeFixtureReadSource(), normalizeTeamKey, expectedManifestSha256: manifestSha256,
    }),
    /publishRoot .* is nested INSIDE sourcesDir/
  );
});

test('assertRootsDisjoint re-checks the CANONICALIZED result of each root for UNC shape too, not only the raw input', () => {
  // A symlink/junction whose target resolves to a UNC form is simulated via
  // the injectable `canonicalize` seam, since real UNC-alias infrastructure
  // is not reliably available in every test environment (see the existing
  // UNC-admin-share tests above, which DO exercise the real thing where
  // possible). This proves the SECOND assertNotUncFormPath call - on the
  // canonicalized output - is actually wired in, independent of environment.
  assert.throws(
    () => packager.assertRootsDisjoint(
      [{ name: 'snapshotRoot', path: 'C:\\ordinary\\path' }, { name: 'publishRoot', path: 'C:\\other\\path' }],
      { canonicalize: (p) => (p.includes('ordinary') ? '\\\\localhost\\C$\\ordinary\\path' : p) }
    ),
    /snapshotRoot \(canonicalized\) .*is a UNC-form path/
  );
});

// ---------------------------------------------------------------------------
// Atomicity: build-to-temp-then-promote
// ---------------------------------------------------------------------------

test('packageSnapshot refuses to promote over an already-existing publishRoot, and leaves the fully-built temp tree on disk', () => {
  const snapshotRoot = tmpDir('atomic-collide-snap');
  const publishRoot = tmpDir('atomic-collide-pub'); // pre-created and non-empty on purpose
  fs.writeFileSync(path.join(publishRoot, 'pre-existing-file.txt'), 'do not touch me\n');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });

  let thrown;
  try {
    packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    });
    assert.fail('packageSnapshot must throw when publishRoot already exists');
  } catch (err) {
    thrown = err;
  }
  assert.match(thrown.message, /publishRoot .* already exists - refusing to silently delete or overwrite it/);

  // The pre-existing directory must be completely untouched.
  assert.equal(
    fs.readFileSync(path.join(publishRoot, 'pre-existing-file.txt'), 'utf8'),
    'do not touch me\n'
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')),
    'the pre-existing directory must not have been silently populated');

  // The fully-built, fully-verified temp directory must still exist
  // SOMEWHERE alongside publishRoot (never deleted on a PROMOTE failure,
  // only on a BUILD failure) - find it and confirm it really does hold a
  // complete, valid publication.
  const siblingEntries = fs.readdirSync(path.dirname(publishRoot));
  const tempDirName = siblingEntries.find((name) => name.startsWith('.tmp-package-'));
  assert.ok(tempDirName, 'the built-but-not-yet-promoted temp directory must still be on disk');
  const tempDir = path.join(path.dirname(publishRoot), tempDirName);
  assert.ok(fs.existsSync(path.join(tempDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(tempDir, 'verification.json')));

  // MEDIUM 1 (adversarial review round 3): the thrown message must name the
  // EXACT leaked temp-directory path, not just publishRoot - an operator
  // must not have to guess the `.tmp-package-*` convention and search for it
  // themselves.
  assert.ok(thrown.message.includes(tempDir),
    `error message must include the real buildRoot path (${tempDir}); got: ${thrown.message}`);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('assertPublishRootAbsentForPromote includes the exact buildRoot path in its thrown message', () => {
  const publishRoot = tmpDir('promote-msg-publish'); // pre-created, so it "already exists"
  const buildRoot = path.join(os.tmpdir(), `ez-pkg-fake-buildroot-${Date.now()}`);
  assert.throws(
    () => packager.assertPublishRootAbsentForPromote(publishRoot, buildRoot),
    (err) => {
      assert.match(err.message, /already exists - refusing to silently delete or overwrite it/);
      assert.ok(err.message.includes(buildRoot), 'must name the real buildRoot path directly');
      return true;
    }
  );
});

test('packageSnapshot cleans up its temp build directory when the BUILD itself fails (never leaves a stray .tmp-package-* dir)', () => {
  const snapshotRoot = tmpDir('atomic-buildfail-snap');
  const publishRoot = tmpPublishPath('atomic-buildfail-pub');
  const { manifestSha256 } = buildFixtureSnapshot({
    root: snapshotRoot,
    // A schema violation aborts mid-build (well after buildRoot is created).
    mutate: (name, rows) => (name === 'player_stats'
      ? rows.map((r, i) => (i === 0 ? { ...r, stats: { ...r.stats, notAllowlisted: 1 } } : r))
      : rows),
  });
  const parentDirBefore = fs.readdirSync(path.dirname(publishRoot));

  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    /closed-schema violation/
  );

  const parentDirAfter = fs.readdirSync(path.dirname(publishRoot));
  assert.deepEqual(parentDirAfter.sort(), parentDirBefore.sort(),
    'a build-time failure must leave no stray .tmp-package-* directory behind');
});

// ---------------------------------------------------------------------------
// MEDIUM 2 (adversarial review round 3): every conflicting-promote leaks
// another full .tmp-package-* publication tree next to publishRoot forever,
// with nothing surfacing this to the operator. packageSnapshot must now scan
// for and WARN about (never abort on) any such leaked siblings, near the
// very start of a run, before the expensive build work.
// ---------------------------------------------------------------------------

test('warnAboutLeakedTempDirs logs a warning naming every leftover .tmp-package-* sibling, and does nothing when none exist', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-pkg-leakscan-'));
  test.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const publishRoot = path.join(parent, 'publish');

  const linesClean = [];
  packager.warnAboutLeakedTempDirs({ publishRoot, log: (l) => linesClean.push(String(l)) });
  assert.equal(linesClean.length, 0, 'no warning when nothing has leaked');

  const leak1 = path.join(parent, '.tmp-package-aaaaaa');
  const leak2 = path.join(parent, '.tmp-package-bbbbbb');
  fs.mkdirSync(leak1);
  fs.mkdirSync(leak2);
  // A non-matching directory must never be mistaken for a leaked build dir.
  fs.mkdirSync(path.join(parent, 'not-a-leak'));

  const lines = [];
  packager.warnAboutLeakedTempDirs({ publishRoot, log: (l) => lines.push(String(l)) });
  assert.equal(lines.length, 1, 'exactly one warning line for the whole scan');
  assert.match(lines[0], /WARNING/);
  assert.match(lines[0], /found 2 leftover/);
  assert.ok(lines[0].includes(leak1), 'names the first leaked directory');
  assert.ok(lines[0].includes(leak2), 'names the second leaked directory');
  assert.ok(!lines[0].includes(path.join(parent, 'not-a-leak')), 'never names an unrelated sibling directory');
});

test('warnAboutLeakedTempDirs does nothing when publishRoot\'s parent directory does not exist yet', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-pkg-leakscan-noparent-'));
  test.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const publishRoot = path.join(parent, 'does-not-exist-yet', 'publish');
  const lines = [];
  assert.doesNotThrow(() => packager.warnAboutLeakedTempDirs({ publishRoot, log: (l) => lines.push(String(l)) }));
  assert.equal(lines.length, 0);
});

test('packageSnapshot warns (via the log callback) about a pre-existing leaked .tmp-package-* dir, but still completes the run - never aborts', () => {
  const snapshotRoot = tmpDir('leakwarn-snap');
  const publishRoot = tmpPublishPath('leakwarn-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });

  // Simulate a prior conflicting-promote run's leftover build directory,
  // sitting right where a real one would: next to publishRoot's parent.
  const staleLeak = fs.mkdtempSync(path.join(path.dirname(publishRoot), '.tmp-package-'));

  const lines = [];
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
    expectedManifestSha256: manifestSha256, log: (l) => lines.push(String(l)),
  });

  assert.ok(fs.existsSync(path.join(publishRoot, 'manifest.json')),
    'a leaked sibling temp dir must never block a legitimate run');
  assert.ok(result.manifestSha256, 'packaging still completes and returns a result');
  const warningLine = lines.find((l) => /WARNING/.test(l) && /leftover/.test(l));
  assert.ok(warningLine, `expected a leaked-temp-dir warning among logged lines: ${JSON.stringify(lines)}`);
  assert.ok(warningLine.includes(staleLeak), 'the warning must name the actual leaked directory');

  fs.rmSync(staleLeak, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fail-closed guards (requirement b): schema, external_id, secrets, and the
// pinned source-manifest hash - each aborts BEFORE any chunk is written
// ---------------------------------------------------------------------------

test('a schema-violating row aborts the whole run before any file is written', () => {
  const snapshotRoot = tmpDir('schemabad-snap');
  const publishRoot = tmpDir('schemabad-pub');
  const { manifestSha256 } = buildFixtureSnapshot({
    root: snapshotRoot,
    mutate: (name, rows) => (name === 'player_stats'
      ? rows.map((r, i) => (i === 0 ? { ...r, stats: { ...r.stats, notAllowlisted: 1 } } : r))
      : rows),
  });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    /closed-schema violation in dataset player_stats.*notAllowlisted/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')));
  assert.ok(!fs.existsSync(path.join(publishRoot, 'chunks')));
});

test('a nested unexpected TYPE (a string where a number is declared) aborts the run', () => {
  const snapshotRoot = tmpDir('typebad-snap');
  const publishRoot = tmpDir('typebad-pub');
  const { manifestSha256 } = buildFixtureSnapshot({
    root: snapshotRoot,
    mutate: (name, rows) => (name === 'player_stats'
      ? rows.map((r, i) => (i === 0 ? { ...r, stats: { ...r.stats, passingYards: 'two hundred fifty' } } : r))
      : rows),
  });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    /passingYards: expected a finite number, got string/
  );
});

test('external_id smuggled into a non-players dataset aborts the run', () => {
  const snapshotRoot = tmpDir('extid-snap');
  const publishRoot = tmpDir('extid-pub');
  const { manifestSha256 } = buildFixtureSnapshot({
    root: snapshotRoot,
    mutate: (name, rows) => (name === 'player_season_stats'
      ? rows.map((r) => ({ ...r, external_id: 999 }))
      : rows),
  });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    /player_season_stats.*external_id/
  );
});

test('a fabricated secret-shaped value anywhere in a row aborts the run and the thrown message never echoes it', () => {
  const snapshotRoot = tmpDir('secret-snap');
  const publishRoot = tmpDir('secret-pub');
  const planted = 'reach me at nobody@example.invalid';
  const { manifestSha256 } = buildFixtureSnapshot({
    root: snapshotRoot,
    mutate: (name, rows) => (name === 'players'
      ? rows.map((r, i) => (i === 0 ? { ...r, injury_detail: planted } : r))
      : rows),
  });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    (err) => {
      assert.match(err.message, /secret scan: 1 hit\(s\) in dataset players/);
      assert.ok(!err.message.includes('nobody@example.invalid'));
      return true;
    }
  );
});

test('a fabricated secret-shaped value inside dry-run-receipt.json aborts before it is copied anywhere', () => {
  const snapshotRoot = tmpDir('receipt-secret-snap');
  const publishRoot = tmpDir('receipt-secret-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  // Poison the receipt AFTER the fixture is built - this file is copied
  // verbatim, never loaded as rows, so `assertNoSecrets` (which walks row
  // objects) could never reach it; only a dedicated raw-text scan can.
  const receiptPath = store.receiptFile(snapshotRoot);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.note = 'operator contact: nobody@example.invalid';
  fs.writeFileSync(receiptPath, `${store.canonicalJson(receipt)}\n`, 'utf8');

  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
    }),
    (err) => {
      assert.match(err.message, /1 pattern\(s\) matched in dry-run-receipt\.json/);
      assert.ok(!err.message.includes('nobody@example.invalid'));
      return true;
    }
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'dry-run-receipt.json')),
    'the poisoned receipt must never be copied into the publication tree');
});

test('a source manifest that does not hash to the pinned expectation is refused before anything is read', () => {
  const snapshotRoot = tmpDir('pin-snap');
  const publishRoot = tmpDir('pin-pub');
  buildFixtureSnapshot({ root: snapshotRoot });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: '0'.repeat(64),
    }),
    /refusing to package a snapshot that is not the one this build was authorized against/
  );
});

test('the real, shipped PINNED_SNAPSHOT_MANIFEST_SHA256 is the one recorded in the Gate-2 handoff', () => {
  assert.equal(
    packager.PINNED_SNAPSHOT_MANIFEST_SHA256,
    '2896872ba583fffbd8bacc089b0615365feee30bb60ec06e78afd090b0eda855'
  );
});

// ---------------------------------------------------------------------------
// The real snapshot itself (requirement d, run for real elsewhere via
// server/scripts/run-backtest-package.js) - this test only proves the
// PINNED constant matches the actual sealed file on disk, read-only, so a
// CI run without production access still catches drift.
// ---------------------------------------------------------------------------

test('the sealed snapshot manifest on disk still hashes to the pinned constant', () => {
  const path2 = path.join(__dirname, '..', '..', 'backtest-data', 'snapshot', 'manifest.json');
  if (!fs.existsSync(path2)) return; // the local-only snapshot may not exist in every environment
  const bytes = fs.readFileSync(path2);
  assert.equal(sha256Hex(bytes), packager.PINNED_SNAPSHOT_MANIFEST_SHA256);
});

// ---------------------------------------------------------------------------
// Raw source verification (Finding 1): hash pin, games.csv cross-check,
// and the value-level secret scan over parsed rows - each aborts BEFORE any
// chunk (dataset or source) is written
// ---------------------------------------------------------------------------

test('a raw source whose bytes do not match the pinned provenance sha256 aborts the whole run before any write', () => {
  const snapshotRoot = tmpDir('srchash-snap');
  const publishRoot = tmpDir('srchash-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const tamperedProvenance = JSON.parse(fs.readFileSync(FIXTURE_SOURCES.provenancePath, 'utf8'));
  tamperedProvenance.records = tamperedProvenance.records.map((r) => (r.name === 'roster_weekly_2024'
    ? { ...r, sha256: '0'.repeat(64) }
    : r));
  const badProvenancePath = path.join(tmpDir('badprov'), 'provenance.json');
  fs.writeFileSync(badProvenancePath, JSON.stringify(tamperedProvenance));

  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      sourcesDir: FIXTURE_SOURCES.sourcesDir, provenancePath: badProvenancePath,
      expectedGamesCsvSha256: FIXTURE_SOURCES.gamesCsvSha256, expectedManifestSha256: manifestSha256,
    }),
    /source roster_weekly_2024 on disk .* hashes to .*, provenance\.json records .* - refusing to chunk/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')));
});

test('games.csv failing the cross-check against the hardcoded GAMES_CSV_SHA256 constant aborts the run', () => {
  const snapshotRoot = tmpDir('srcgames-snap');
  const publishRoot = tmpDir('srcgames-pub');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      expectedManifestSha256: manifestSha256,
      expectedGamesCsvSha256: '0'.repeat(64), // deliberately wrong, unlike the fixture's real hash
    }),
    /games\.csv hashes to .*, the pinned GAMES_CSV_SHA256 constant .* expects/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')));
});

test('a secret-shaped value inside a raw source row aborts the run before any write', () => {
  const snapshotRoot = tmpDir('srcsecret-snap');
  const publishRoot = tmpDir('srcsecret-pub');
  const poisoned = buildFixtureSources({
    mutateText: (name, text) => (name === 'players'
      ? text.replace('4241', '4241,') /* no-op placeholder, replaced below */
      : text),
  });
  // Build the poisoned players.csv directly (the mutateText hook above is
  // for a same-shape substitution; a secret needs its own row entirely).
  const playersEntry = REAL_SOURCES.find((s) => s.name === 'players');
  const poisonedText = csv(playersEntry.requiredColumns, [
    { gsis_id: '00-0000001', espn_id: 'reach-me-at-nobody@example.invalid' },
  ]);
  fs.writeFileSync(path.join(poisoned.sourcesDir, 'players.csv'), poisonedText);
  const poisonedBytes = fs.readFileSync(path.join(poisoned.sourcesDir, 'players.csv'));
  const poisonedProvenance = JSON.parse(fs.readFileSync(poisoned.provenancePath, 'utf8'));
  poisonedProvenance.records = poisonedProvenance.records.map((r) => (r.name === 'players'
    ? { ...r, sha256: sha256Hex(poisonedBytes) }
    : r));
  fs.writeFileSync(poisoned.provenancePath, JSON.stringify(poisonedProvenance));

  // The sealed snapshot manifest's own `sources` array must reflect THIS
  // poisoned tree's actual bytes for packaging to reach the secret scan at
  // all - a real run refuses at the sealed-hash-binding check first if the
  // local sources and the sealed manifest disagree (see the dedicated
  // "packager-side source substitution" regression test below).
  const sourceRecords = poisoned.records.map((r) => (r.name === 'players'
    ? { ...r, sha256: sha256Hex(poisonedBytes), byteLength: poisonedBytes.length }
    : r));
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot, sourceRecords });

  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      sourcesDir: poisoned.sourcesDir, provenancePath: poisoned.provenancePath,
      expectedGamesCsvSha256: poisoned.gamesCsvSha256, expectedManifestSha256: manifestSha256,
    }),
    (err) => {
      assert.match(err.message, /secret scan: 1 hit\(s\) in dataset players/);
      assert.ok(!err.message.includes('nobody@example.invalid'));
      return true;
    }
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')));
});

// ---------------------------------------------------------------------------
// Round 6 (fourth review): "packager-side source substitution" - altering a
// local non-games source PLUS its provenance.json record consistently was
// still accepted by verifySources(), despite contradicting the sealed
// manifest. games.csv had a hardcoded-constant check nothing else did;
// every other source had NO anchor beyond "does sourcesDir agree with its
// own provenance.json" - both of which an attacker (or operator error)
// controlling the local sources directory can always keep in agreement with
// each other. Fixed by binding every source's bytes to the sealed snapshot
// manifest's OWN sources array (sealedSources, built from manifest.sources
// via buildSealedSourcesMap), which the local sourcesDir/provenance.json
// pair cannot also forge.
// ---------------------------------------------------------------------------

test('packageSnapshot refuses a local non-games source whose bytes were changed consistently with its own provenance.json record, but disagree with the SEALED snapshot manifest (packager-side source substitution reproduction)', () => {
  const snapshotRoot = tmpDir('pkg-substitution-snap');
  const publishRoot = tmpDir('pkg-substitution-pub');
  // The sealed manifest here defaults to the SHARED FIXTURE_SOURCES.records
  // (unmutated) - deliberately NOT updated to match the tampered source
  // below, exactly reproducing the reviewer's scenario: only the LOCAL
  // sourcesDir and its LOCAL provenance.json were changed, together.
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });

  const substituted = buildFixtureSources({
    // A same-shape substitution (still valid CSV, still satisfies every
    // schema/column requirement) - the point is that ONLY the sealed-hash
    // binding can tell this apart from the real source, not that the file
    // becomes malformed some other way.
    mutateText: (name, text) => (name === 'roster_weekly_2024' ? text.replace('KC', 'BUF') : text),
  });

  assert.throws(
    () => packager.packageSnapshot({
      snapshotRoot, publishRoot, readSource: makeFixtureReadSource(), normalizeTeamKey,
      sourcesDir: substituted.sourcesDir, provenancePath: substituted.provenancePath,
      expectedGamesCsvSha256: substituted.gamesCsvSha256, expectedManifestSha256: manifestSha256,
    }),
    /source roster_weekly_2024 on disk .* hashes to .*, the SEALED snapshot manifest independently pins/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')));
});

test('an expected identifier/biographical column (birth_date, gsis_id, espn_id) never trips the secret scan by its mere presence', () => {
  // players.csv's OWN required columns are just gsis_id/espn_id, but the
  // real registry's optionalColumns for players includes exactly the shape
  // of column the reviewer named as "expected, not a finding". This proves
  // the scan is VALUE-shape-based, not key-based: a birth-date-shaped value
  // and ordinary identifiers never match any secret pattern.
  const { scanRowsForSecrets } = require('../../scripts/backtest/lib/secretScan');
  const rows = [{
    gsis_id: '00-0028830', espn_id: '4241', birth_date: '1994-03-02',
    nfl_id: '42-012345', pfr_id: 'AaitIs00', pff_id: '12345', otc_id: '6789',
    esb_id: 'AAI-100000', smart_id: '3200123456',
  }];
  const hits = scanRowsForSecrets(rows, 'players');
  assert.equal(hits.length, 0);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('main() without an injected normalizeTeamKey packages nothing and says so', () => {
  const lines = [];
  const code = packager.main([], { log: (l) => lines.push(String(l)) });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /run-backtest-package\.js/);
});

test('main() defaults to the PINNED production hash, so pointing the CLI at an unrelated fixture refuses rather than publishing it', () => {
  const snapshotRoot = tmpDir('cli-snap');
  const publishRoot = tmpDir('cli-pub');
  buildFixtureSnapshot({ root: snapshotRoot });
  assert.throws(
    () => packager.main(['--snapshot', snapshotRoot, '--publish', publishRoot], {
      log: () => {},
      normalizeTeamKey,
      readSource: makeFixtureReadSource(),
    }),
    /refusing to package a snapshot that is not the one this build was authorized against/
  );
  assert.ok(!fs.existsSync(path.join(publishRoot, 'manifest.json')));
});

test('parseArgs rejects an unknown flag and defaults to the repo snapshot/publish/sources/provenance paths, acknowledgeContradictions defaulting to false', () => {
  const args = packager.parseArgs([]);
  assert.equal(args.snapshot, packager.DEFAULT_SNAPSHOT_DIR);
  assert.equal(args.publish, packager.DEFAULT_PUBLISH_DIR);
  assert.equal(args.sourcesDir, packager.DEFAULT_SOURCES_DIR);
  assert.equal(args.provenance, packager.DEFAULT_PROVENANCE_PATH);
  assert.equal(args.acknowledgeContradictions, false);
  assert.throws(() => packager.parseArgs(['--nope']), /unknown argument --nope/);
});

test('parseArgs recognizes --acknowledge-contradictions, and its value plumbs through to packageSnapshot exactly as run-backtest-package.js wires it', () => {
  const argsWithFlag = packager.parseArgs(['--acknowledge-contradictions']);
  assert.equal(argsWithFlag.acknowledgeContradictions, true);
  const argsWithout = packager.parseArgs([]);
  assert.equal(argsWithout.acknowledgeContradictions, false);

  // main()'s own CLI wiring always uses the PINNED production manifest hash
  // (see "main() defaults to the PINNED production hash" below), so a
  // fixture cannot be run all the way through main() itself - this proves
  // the actual plumbing shape instead: parseArgs's `acknowledgeContradictions`
  // field flowing straight into packageSnapshot's parameter of the same
  // name, exactly as `server/scripts/run-backtest-package.js` wires it.
  const snapshotRoot = tmpDir('cli-ack-snap');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const readSource = makeFixtureReadSource({ rosterTeam2024: 'KC', statsTeam2024: 'BUF' });

  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot: tmpDir('cli-ack-pub-noack'), readSource, normalizeTeamKey,
      expectedManifestSha256: manifestSha256, acknowledgeContradictions: argsWithout.acknowledgeContradictions,
    }),
    /acknowledgeContradictions was not explicitly set to true/
  );
  const result = packageSnapshotFixture({
    snapshotRoot, publishRoot: tmpPublishPath('cli-ack-pub-ack'), readSource, normalizeTeamKey,
    expectedManifestSha256: manifestSha256, acknowledgeContradictions: argsWithFlag.acknowledgeContradictions,
  });
  assert.equal(result.verification.teamContradictions.acknowledged, true);
});

// ---------------------------------------------------------------------------
// Round 6, finding 5: a third-party review reproduced a trailing `--snapshot`
// (or `--publish`, `--sources-dir`, `--provenance`) with no value silently
// reverting to the REAL production default, because `argv[++i]` past the end
// of the array is `undefined`, and `undefined` satisfies a destructuring
// default (`snapshotRoot = DEFAULT_SNAPSHOT_DIR`) as if the argument had never
// been passed at all - the CLI never noticed the caller's value was missing.
// ---------------------------------------------------------------------------

test('parseArgs rejects a trailing flag with no value, for every flag that takes one, instead of silently reverting to the default', () => {
  assert.throws(() => packager.parseArgs(['--snapshot']), /--snapshot requires a value \(got nothing\)/);
  assert.throws(() => packager.parseArgs(['--publish']), /--publish requires a value \(got nothing\)/);
  assert.throws(() => packager.parseArgs(['--sources-dir']), /--sources-dir requires a value \(got nothing\)/);
  assert.throws(() => packager.parseArgs(['--provenance']), /--provenance requires a value \(got nothing\)/);
});

test('parseArgs rejects a flag whose "value" is itself another flag, rather than swallowing it as a literal path', () => {
  assert.throws(
    () => packager.parseArgs(['--snapshot', '--publish', 'C:\\real-pub']),
    /--snapshot requires a value \(got "--publish"\)/
  );
});

test('a real end-to-end CLI run with a trailing --snapshot never falls back to packaging the REAL production snapshot', () => {
  // Before the fix, `packager.parseArgs(['--snapshot'])` produced
  // `{ snapshot: undefined, ... }`, and `packageSnapshot({ snapshotRoot:
  // undefined })`'s own destructuring default silently substituted
  // DEFAULT_SNAPSHOT_DIR - the real, sealed backtest-data/snapshot/. This
  // proves the CLI layer itself refuses before packageSnapshot is ever
  // called, so that substitution can no longer happen.
  assert.throws(() => packager.main(['--snapshot']), /--snapshot requires a value \(got nothing\)/);
});

// ---------------------------------------------------------------------------
// Round 6, finding 4 (second half): a third-party review noted the packager's
// promote step lacked the same final, immediately-before-promote disjointness
// recheck rehydrate.js's promote step already had (round 5). The gap: the
// FIRST check runs before the (potentially long) dataset/source verification
// and chunking work; if one of the three declared roots is swapped out from
// under the run DURING that work, nothing re-examined its current identity
// before the final rename. This reproduces exactly that: `sourcesDir` starts
// as a junction to the real fixture sources (safe, disjoint from everything),
// and gets re-pointed - via the injectable `log` callback, fired from inside
// dataset packaging, well after the sources have already been read and
// verified - to alias `snapshotRoot` itself. The pre-existing checks (the
// very first one, and the one right after buildRoot is created) both ran
// BEFORE this swap and so cannot see it; only the new final recheck can.
// ---------------------------------------------------------------------------

test('packageSnapshot re-checks root disjointness one last time immediately before promote, catching a root re-pointed mid-run after the earlier checks already passed', (t) => {
  if (process.platform !== 'win32') { t.skip('directory junctions are a win32-only concern here'); return; }
  const snapshotRoot = tmpDir('toctou-snap');
  const { manifestSha256 } = buildFixtureSnapshot({ root: snapshotRoot });
  const publishRoot = tmpPublishPath('toctou-pub');

  const sourcesHost = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-pkg-toctou-sources-host-'));
  test.after(() => fs.rmSync(sourcesHost, { recursive: true, force: true }));
  const sourcesLink = path.join(sourcesHost, 'sources');
  try {
    fs.symlinkSync(FIXTURE_SOURCES.sourcesDir, sourcesLink, 'junction');
  } catch (err) {
    t.skip(`could not create a directory junction in this environment (${err.code || err.message})`);
    return;
  }

  let swapped = false;
  const log = (message) => {
    // Fires after "source reconstruction proof" - the LAST point at which
    // sourcesDir is genuinely read (reconstructAndVerifySources re-reads the
    // raw source bytes to prove the just-written chunks reassemble to them),
    // so re-pointing it here can never corrupt what was actually packaged,
    // only prove whether anything re-examines the root's identity afterward.
    if (!swapped && /source reconstruction proof/.test(message)) {
      fs.rmSync(sourcesLink, { recursive: true, force: true });
      fs.symlinkSync(snapshotRoot, sourcesLink, 'junction');
      swapped = true;
    }
  };

  assert.throws(
    () => packageSnapshotFixture({
      snapshotRoot, publishRoot, sourcesDir: sourcesLink, readSource: makeFixtureReadSource(), normalizeTeamKey, log,
      expectedManifestSha256: manifestSha256,
    }),
    /snapshotRoot and sourcesDir resolve to the SAME directory/
  );
  assert.equal(swapped, true, 'the test must actually have performed the mid-run swap for this to prove anything');
});
