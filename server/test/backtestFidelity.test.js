const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fidelity = require('../../scripts/backtest/lib/fidelity');
const snapshotClient = require('../../scripts/backtest/lib/snapshotClient');
const store = require('../../scripts/backtest/lib/snapshotStore');
const extract = require('../../scripts/backtest/extract-snapshot');

// The REAL engine. The whole value of a fidelity harness is that it replays the
// code the snapshot must reproduce, so this test uses production's
// generateProjections rather than a stand-in.
const { generateProjections } = require('../services/projection.service');
const model = require('../services/projectionModel');
const { SCORING_RULES } = require('../services/scoring.service');

const { MODES } = snapshotClient;
const OID = { int4: 23, int8: 20, text: 25, numeric: 1700, jsonb: 3802, timestamptz: 1184, bool: 16 };
const fields = (spec) => Object.entries(spec).map(([name, dataTypeID]) => ({ name, dataTypeID }));

/**
 * A synthetic snapshot, built through the REAL store write path so the bytes,
 * the digests and the type metadata are produced exactly as a Gate-2 extraction
 * would produce them. The authoritative fidelity run happens after Gate 2; this
 * proves the harness itself works, end to end, today.
 */
const PLAYERS = [
  { id: 1, name: 'Aaron QB', position: 'QB', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: '1.5', team_key: 'KC' },
  { id: 2, name: 'Bella RB', position: 'RB', nfl_team: 'BUF', injury_status: null, injury_detail: null, adp: '2.5', team_key: 'BUF' },
];

function scheduleRows(season) {
  const rows = [];
  for (let week = 1; week <= 6; week++) {
    const kickoff = `${season}-09-${String(week + 6).padStart(2, '0')}T17:00:00.000Z`;
    for (const [team, opponent] of [['KC', 'BUF'], ['BUF', 'KC']]) {
      rows.push({
        season, week, nfl_team: team, opponent, kickoff_at: kickoff,
        game_key: `${season}-${week}-KC-BUF`, home_away: null, neutral_site: null,
        venue: null, roof: null, surface: null, latitude: null, longitude: null, rest_days: null,
        team_key: team, opponent_key: opponent,
      });
    }
  }
  return rows;
}

function statRows(season) {
  const rows = [];
  for (let week = 1; week <= 6; week++) {
    rows.push({
      player_id: 1, season, week,
      stats: { passingYards: 200 + week * 10, passingTD: 1, gameTeam: 'KC', gameOpponent: 'BUF' },
    });
    rows.push({
      player_id: 2, season, week,
      stats: { rushingYards: 60 + week, rushingTD: week % 2, receptions: 3, gameTeam: 'BUF', gameOpponent: 'KC' },
    });
  }
  return rows;
}

const MANIFEST_BASE = {
  studyId: 'pit-sweep-2024-2025',
  quarantineFromSeason: 2026,
  seasons: [2024, 2025],
  scheduleSeasons: [2022, 2023, 2024, 2025],
  schemaFingerprint: {
    players: { fields: fields({ id: OID.int4, name: OID.text, position: OID.text, nfl_team: OID.text, injury_status: OID.text, injury_detail: OID.text, adp: OID.numeric, team_key: OID.text }) },
    player_stats: { fields: fields({ player_id: OID.int4, season: OID.int4, week: OID.int4, stats: OID.jsonb }) },
    player_season_stats: { fields: fields({ player_id: OID.int4, season: OID.int4, games_played: OID.int4, stats: OID.jsonb, fantasy_points: OID.numeric }) },
    nfl_games_2025: { fields: fields({ season: OID.int4, week: OID.int4, nfl_team: OID.text, opponent: OID.text, kickoff_at: OID.timestamptz, game_key: OID.text, home_away: OID.text, neutral_site: OID.bool, venue: OID.text, roof: OID.text, surface: OID.text, latitude: OID.numeric, longitude: OID.numeric, rest_days: OID.int4, team_key: OID.text, opponent_key: OID.text }) },
  },
};

/** The two oracle weeks this fixture can support, one per branch state. */
const FIXTURE_ORACLES = [
  { season: 2025, week: 1, leagueScan: false, defenseGameCount: false },
  { season: 2025, week: 5, leagueScan: true, defenseGameCount: true },
];

const PLAYER_IDS = [1, 2];
const HASH_VALUE = model.scoringHash(SCORING_RULES);
const NOW = new Date('2026-01-01T00:00:00.000Z');

/**
 * Build a snapshot on disk, then produce the oracles by replaying the real
 * engine through an `off` client and STORING what it produced.
 *
 * Producing the oracle this way is honest for a harness test: the question here
 * is whether the harness detects agreement and disagreement, not whether the
 * client matches a database (that is Gate 2's job, and the disposable-PG
 * contract tests'). Every mutation test below perturbs one side and checks the
 * harness notices.
 */
async function buildFixtureSnapshot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-fidelity-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const written = [];
  const save = (dataset, rows, seasonScoped, pathKind = store.PATHS.FEATURE) => {
    written.push(store.saveDataset({
      root, store: store.STORES.EVALUATION, path: pathKind, dataset, rows, seasonScoped,
    }));
  };
  save('players', PLAYERS, false);
  save('player_stats', statRows(2025), true);
  save('player_season_stats', [
    { player_id: 1, season: 2024, games_played: 17, stats: { passingYards: 4000 }, fantasy_points: '300.5' },
  ], true);
  for (const season of [2022, 2023, 2024]) save(`nfl_games_${season}`, [], true);
  save('nfl_games_2025', scheduleRows(2025), true);
  save('orientation_overlay', [], true);
  save('position_rank', [{ code: 'QB', rank: 1 }], false);
  save('player_name_rank', PLAYERS.map((p, i) => ({ id: p.id, name: p.name, rank: i + 1 })), false);
  store.saveManifest(root, { ...MANIFEST_BASE, datasets: written });

  // Produce and store the oracles.
  const snapshot = snapshotClient.loadSnapshot({ root });
  const oracleWritten = [];
  for (const oracle of FIXTURE_ORACLES) {
    const client = snapshotClient.createSnapshotClient({
      snapshot, season: oracle.season, week: oracle.week, mode: MODES.OFF,
    });
    // eslint-disable-next-line no-await-in-loop
    const result = await generateProjections({
      season: oracle.season, week: oracle.week, rules: SCORING_RULES, playerIds: PLAYER_IDS,
      hashValue: HASH_VALUE, client, now: NOW, weatherService: false,
      modelConstants: model.MODEL_CONSTANTS,
    });
    // Branch expectations really did hold while producing the oracle.
    assert.equal((client.counters.byQuery.leagueScan || 0) > 0, oracle.leagueScan,
      `${oracle.season} W${oracle.week} scan branch`);
    assert.equal((client.counters.byQuery.defenseGameCount || 0) > 0, oracle.defenseGameCount,
      `${oracle.season} W${oracle.week} defense-count branch`);
    const rows = [...result.projections.entries()]
      .map(([playerId, projection]) => ({
        season: oracle.season, week: oracle.week, player_id: Number(playerId),
        projection: extract.jsonSafe(projection, `oracle p${playerId}`),
      }))
      .sort((a, b) => a.player_id - b.player_id);
    oracleWritten.push(store.saveDataset({
      root, store: store.STORES.EVALUATION, path: store.PATHS.OUTCOME,
      dataset: `oracle_${oracle.season}_w${oracle.week}`, rows, seasonScoped: true,
    }));
  }
  // The manifest records, per oracle week, which conditionals fired when the
  // engine ran against the source of truth. The harness cross-checks the
  // replay against exactly this.
  const manifest = {
    ...MANIFEST_BASE,
    datasets: [...written, ...oracleWritten],
    oracles: FIXTURE_ORACLES.map((o) => ({
      season: o.season,
      week: o.week,
      dataset: `oracle_${o.season}_w${o.week}`,
      branches: { leagueScan: o.leagueScan, defenseGameCount: o.defenseGameCount },
    })),
  };
  store.saveManifest(root, manifest);
  return { root, snapshot: { ...snapshot, manifest } };
}

function harnessArgs({ snapshot, root, oracles = FIXTURE_ORACLES, overrides = {} }) {
  const manifest = store.loadManifest(root);
  return {
    snapshot,
    oracles,
    loadOracleRows: (oracle) => snapshotClient.loadOracle({
      root, season: oracle.season, week: oracle.week, manifest,
    }),
    generateProjections,
    rules: SCORING_RULES,
    hashValue: HASH_VALUE,
    modelConstants: model.MODEL_CONSTANTS,
    now: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

test('off mode reproduces the stored oracles bit-identically, on both branch states', async () => {
  const { root, snapshot } = await buildFixtureSnapshot();
  const report = await fidelity.assertOffModeFidelity(harnessArgs({ snapshot, root }));
  assert.equal(report.status, 'passed');
  assert.equal(report.weeks, 2);
  assert.equal(report.projectionsCompared, 4);
  // BOTH sides of BOTH conditionals were exercised.
  assert.deepEqual(report.branchCoverage, {
    leagueScan: { on: true, off: true },
    defenseGameCount: { on: true, off: true },
  });
  assert.deepEqual(report.perWeek.map((w) => w.branches.leagueScan), [false, true]);
});

test('a single changed digit anywhere in a projection fails the harness', async () => {
  const { root, snapshot } = await buildFixtureSnapshot();
  const manifest = store.loadManifest(root);
  const real = snapshotClient.loadOracle({ root, season: 2025, week: 5, manifest });
  const nudged = real.map((row, i) => (i === 0
    ? { ...row, projection: { ...row.projection, median: Number(row.projection.median) + 1e-9 } }
    : row));
  await assert.rejects(() => fidelity.assertOffModeFidelity(harnessArgs({
    snapshot,
    root,
    overrides: {
      loadOracleRows: (oracle) => (oracle.week === 5
        ? nudged
        : snapshotClient.loadOracle({ root, season: oracle.season, week: oracle.week, manifest })),
    },
  })), (err) => {
    assert.match(err.message, /FAILED: 1 of 2 oracle week\(s\) did not reproduce bit-identically/);
    assert.match(err.message, /2025 W5, player 1 \(mismatch\)/);
    return true;
  });
});

test('the comparison is on CONTENT, not on shape: same-length differences are caught', () => {
  // The +1e-9 perturbation elsewhere in this file changes the serialized
  // LENGTH, so it cannot tell a content comparison apart from a length
  // comparison. These three can: each produces two canonical strings of
  // identical length that differ in what they say.
  const cases = [
    {
      label: 'a same-length numeric change',
      stored: { median: 10 },
      produced: { median: 11 },
    },
    {
      label: 'a key rename of the same length',
      stored: { median: 10 },
      produced: { medain: 10 },
    },
    {
      label: 'a number that became a string',
      stored: { median: 10 },
      produced: { median: '10' },
    },
    {
      label: 'two fields swapping values',
      stored: { mean: 12, median: 21 },
      produced: { mean: 21, median: 12 },
    },
  ];
  for (const { label, stored, produced } of cases) {
    const storedJson = fidelity.canonicalProjection(stored);
    const producedJson = fidelity.canonicalProjection(produced);
    // The premise: a length comparison genuinely could not tell these apart.
    if (label !== 'a number that became a string') {
      assert.equal(storedJson.length, producedJson.length,
        `${label}: the fixture must be same-length or it proves nothing`);
    }
    const diff = fidelity.diffAgainstOracle({
      projections: new Map([[1, produced]]),
      oracleRows: [{ player_id: 1, projection: stored }],
      season: 2025,
      week: 5,
    });
    assert.equal(diff.differences.length, 1, `${label} must be reported`);
    assert.equal(diff.differences[0].kind, 'mismatch');
    assert.equal(diff.differences[0].playerId, 1);
  }

  // And the converse, so the check is not simply always-fail: identical content
  // reports nothing, whatever order the keys arrived in.
  const clean = fidelity.diffAgainstOracle({
    projections: new Map([[1, { median: 10, mean: 12 }]]),
    oracleRows: [{ player_id: 1, projection: { mean: 12, median: 10 } }],
    season: 2025,
    week: 5,
  });
  assert.deepEqual(clean.differences, []);
});

test('a nested same-length difference is caught too, not just a top-level one', () => {
  // Projections carry a `factors` object; a difference buried inside it is
  // exactly as much a fidelity failure as one on `median`.
  const diff = fidelity.diffAgainstOracle({
    projections: new Map([[1, { median: 10, factors: { homeAway: { effect: 0.02 } } }]]),
    oracleRows: [{ player_id: 1, projection: { median: 10, factors: { homeAway: { effect: 0.03 } } } }],
    season: 2025,
    week: 5,
  });
  assert.equal(diff.differences.length, 1);
  assert.equal(diff.differences[0].kind, 'mismatch');
  assert.match(diff.differences[0].stored, /0\.03/);
  assert.match(diff.differences[0].produced, /0\.02/);
});

test('a missing or extra projection is caught, not just a changed value', () => {
  const oracleRows = [
    { player_id: 1, projection: { median: 10 } },
    { player_id: 2, projection: { median: 20 } },
  ];
  const missing = fidelity.diffAgainstOracle({
    projections: new Map([[1, { median: 10 }]]), oracleRows, season: 2025, week: 5,
  });
  assert.deepEqual(missing.differences.map((d) => [d.playerId, d.kind]), [[2, 'missing']]);

  const extra = fidelity.diffAgainstOracle({
    projections: new Map([[1, { median: 10 }], [2, { median: 20 }], [3, { median: 30 }]]),
    oracleRows, season: 2025, week: 5,
  });
  assert.deepEqual(extra.differences.map((d) => [d.playerId, d.kind]), [[3, 'extra']]);

  const clean = fidelity.diffAgainstOracle({
    projections: new Map([[1, { median: 10 }], [2, { median: 20 }]]), oracleRows, season: 2025, week: 5,
  });
  assert.deepEqual(clean.differences, []);
  assert.equal(clean.compared, 2);
});

test('key order and undefined-vs-absent do not read as differences', () => {
  // The stored side went through JSON already, so the comparison round-trips
  // the produced side too. Otherwise every projection carrying an undefined
  // field would look like a fidelity break.
  const oracleRows = [{ player_id: 1, projection: { b: 2, a: 1 } }];
  const same = fidelity.diffAgainstOracle({
    projections: new Map([[1, { a: 1, b: 2, c: undefined }]]), oracleRows, season: 2025, week: 5,
  });
  assert.deepEqual(same.differences, []);
});

test('a replay that takes the other side of a branch fails, even with matching outputs', async () => {
  // Coverage alone would be satisfied by "some week took each side". This is
  // the stronger property: each week must take the side the EXTRACTION
  // recorded, because a different branch means a different shape of input and
  // any output agreement is luck.
  const { root, snapshot } = await buildFixtureSnapshot();
  const lying = {
    ...snapshot,
    manifest: {
      ...snapshot.manifest,
      oracles: snapshot.manifest.oracles.map((o) => (o.week === 5
        ? { ...o, branches: { leagueScan: false, defenseGameCount: false } }
        : o)),
    },
  };
  await assert.rejects(
    () => fidelity.assertOffModeFidelity(harnessArgs({ snapshot: lying, root })),
    /2025 W5 replayed with leagueScan ON, but the extraction recorded it OFF.*luck rather than reproduction/s
  );
});

test('the branch cross-check refuses a manifest that describes nothing, or the wrong week', () => {
  const reports = [{ season: 2025, week: 5, branches: { leagueScan: true, defenseGameCount: true } }];
  assert.equal(fidelity.assertBranchesMatchManifest(reports, [
    { season: 2025, week: 5, branches: { leagueScan: true, defenseGameCount: true } },
  ]), true);
  assert.throws(() => fidelity.assertBranchesMatchManifest(reports, []),
    /records no oracle branches to check the replay against/);
  assert.throws(() => fidelity.assertBranchesMatchManifest(reports, [
    { season: 2025, week: 9, branches: { leagueScan: true, defenseGameCount: true } },
  ]), /replayed 2025 W5, which the manifest does not describe/);
  assert.throws(() => fidelity.assertBranchesMatchManifest(reports, [
    { season: 2025, week: 5, branches: { leagueScan: true, defenseGameCount: false } },
  ]), /defenseGameCount ON, but the extraction recorded it OFF/);
});

test('a run that only ever took one side of a branch is refused', () => {
  assert.throws(() => fidelity.assertBranchCoverage([
    { branches: { leagueScan: true, defenseGameCount: true } },
    { branches: { leagueScan: true, defenseGameCount: true } },
  ]), /the leagueScan branch was only ever ON across the 2 replayed week\(s\)/);

  assert.throws(() => fidelity.assertBranchCoverage([
    { branches: { leagueScan: false, defenseGameCount: false } },
  ]), /only ever OFF/);

  assert.deepEqual(fidelity.assertBranchCoverage([
    { branches: { leagueScan: true, defenseGameCount: true } },
    { branches: { leagueScan: false, defenseGameCount: false } },
  ]), {
    leagueScan: { on: true, off: true },
    defenseGameCount: { on: true, off: true },
  });
});

test('the harness refuses to pass over nothing', async () => {
  const { root, snapshot } = await buildFixtureSnapshot();
  await assert.rejects(
    () => fidelity.assertOffModeFidelity(harnessArgs({ snapshot, root, oracles: [] })),
    /no oracles to replay, so nothing was proven/
  );
  await assert.rejects(
    () => fidelity.assertOffModeFidelity(harnessArgs({
      snapshot, root, overrides: { loadOracleRows: () => [] },
    })),
    /stored no projections/
  );
  await assert.rejects(
    () => fidelity.assertOffModeFidelity(harnessArgs({
      snapshot, root, overrides: { generateProjections: null },
    })),
    /requires the real generateProjections to be injected/
  );
  await assert.rejects(
    () => fidelity.assertOffModeFidelity(harnessArgs({
      snapshot, root, overrides: { loadOracleRows: null },
    })),
    /requires a loader for the stored oracle rows/
  );
});

test('the harness replays with weather EXPLICITLY disabled', async () => {
  // `weatherService: null` is generateProjections' DEFAULT and makes it
  // `require('./nwsWeather.service')` and reach out. Offline that call fails
  // and the engine degrades to "no weather", so the OUTPUT would look correct
  // while the run had tried to touch the network - and, per the
  // preregistration's (f) derivation, the on-minus-off factor delta is exact
  // only because weather is off. So the argument itself is asserted, not just
  // its effect.
  const { root, snapshot } = await buildFixtureSnapshot();
  const seen = [];
  const recording = async (args) => {
    seen.push(args.weatherService);
    return generateProjections(args);
  };
  await fidelity.assertOffModeFidelity(harnessArgs({
    snapshot, root, overrides: { generateProjections: recording },
  }));
  assert.equal(seen.length, 2);
  for (const value of seen) {
    assert.equal(value, false, 'weather must be passed as exactly false, never null or undefined');
  }
});

test('the replay reaches the real engine through the snapshot client only', async () => {
  const { root, snapshot } = await buildFixtureSnapshot();
  const manifest = store.loadManifest(root);
  const oracle = FIXTURE_ORACLES[1];
  const report = await fidelity.replayOracleWeek({
    snapshot,
    oracle,
    generateProjections,
    rules: SCORING_RULES,
    hashValue: HASH_VALUE,
    modelConstants: model.MODEL_CONSTANTS,
    now: NOW,
    oracleRows: snapshotClient.loadOracle({ root, season: oracle.season, week: oracle.week, manifest }),
  });
  assert.deepEqual(report.differences, []);
  // Every one of the unconditional queries was answered from the snapshot, and
  // the two conditionals fired for a week 5 replay.
  for (const name of ['playersById', 'priorPlayerStats', 'priorPlayerSeasonStats',
    'targetWeekSchedule', 'historyWindowSchedule', 'byeWeeks', 'leagueScan', 'defenseGameCount']) {
    assert.ok(report.observedQueries[name] > 0, `${name} was served offline`);
  }
});

test('the real engine really did see a Date for kickoff_at, not the stored string', async () => {
  // This is the type-rehydration contract in its most consequential form:
  // `inputCutoff` is built from `kickoff_at`, and a string would have produced
  // a different value silently.
  const { root, snapshot } = await buildFixtureSnapshot();
  const client = snapshotClient.createSnapshotClient({
    snapshot, season: 2025, week: 5, mode: MODES.OFF,
  });
  const result = await generateProjections({
    season: 2025, week: 5, rules: SCORING_RULES, playerIds: PLAYER_IDS, hashValue: HASH_VALUE,
    client, now: NOW, weatherService: false, modelConstants: model.MODEL_CONSTANTS,
  });
  assert.ok(result.inputCutoff instanceof Date, 'inputCutoff is a Date');
  // Week 5's fixture kickoff (the schedule builder puts week W on day W+6).
  assert.equal(result.inputCutoff.toISOString(), '2025-09-11T17:00:00.000Z');

  // And the failure mode this guards: had the client served the ISO string,
  // `Math.min` over `new Date(string).getTime()` would still work but
  // `inputCutoff` would be a Date built from a string the engine never saw as
  // one. Prove the client hands over a real Date at the seam.
  const raw = await client.query(
    require('../../scripts/backtest/lib/sqlSurface').SQL_BY_NAME.get('targetWeekSchedule').text,
    [2025, 5]
  );
  assert.ok(raw.rows[0].kickoff_at instanceof Date);
});
