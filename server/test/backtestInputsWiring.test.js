const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const script = require('../scripts/run-backtest-inputs');
const inputsGeneration = require('../../scripts/backtest/lib/inputsGeneration');
const naive = require('../../scripts/backtest/lib/naive');
const { PRIMARY_SCORING_PROFILE } = require('../../scripts/backtest/lib/freezeManifest');
const model = require('../services/projectionModel');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../services/scoring.service');

/**
 * The `--inputs` producer's WIRING (increment 3). Everything here runs on
 * synthetic fixtures: no snapshot, no database, no projection is ever
 * computed - the wiring's four obligations are exactly the ones that produce a
 * document which still validates, so each is pinned with a negative control
 * that shows the wrong alternative yields a DIFFERENT observable result.
 */

const FIVE_FLAGS = [
  '--rehydrated-snapshot', '/snap',
  '--rehydrated-sources', '/src',
  '--rosters', '/rosters',
  '--cohort', '/cohort',
  '--out', '/out/records.json',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('every flag is required with no default, and unknown tokens are refused', () => {
  const parsed = script.parseArgs(FIVE_FLAGS);
  assert.deepEqual(parsed, {
    rehydratedSnapshot: '/snap',
    rehydratedSources: '/src',
    rosters: '/rosters',
    cohort: '/cohort',
    out: '/out/records.json',
  });

  for (const flag of ['--rehydrated-snapshot', '--rehydrated-sources', '--rosters', '--cohort', '--out']) {
    const without = [];
    for (let i = 0; i < FIVE_FLAGS.length; i += 2) {
      if (FIVE_FLAGS[i] !== flag) without.push(FIVE_FLAGS[i], FIVE_FLAGS[i + 1]);
    }
    assert.throws(() => script.parseArgs(without), /required, with no default/, `${flag} must be required`);
  }

  assert.throws(() => script.parseArgs([...FIVE_FLAGS, '--profiles', 'half_ppr']), /unknown argument --profiles/);
  assert.throws(() => script.parseArgs(['--out', '--rosters']), /--out requires a value/);
});

// ---------------------------------------------------------------------------
// The sealed grid arithmetic
// ---------------------------------------------------------------------------

test('the executed generation count is checked against section 9, not just the plan', () => {
  assert.equal(script.assertGridComplete({ generations: inputsGeneration.GRID_TOTAL }), true);

  // NEGATIVE CONTROL: one sensitivity profile silently skipped (6,528 fewer).
  assert.throws(
    () => script.assertGridComplete({ generations: inputsGeneration.GRID_TOTAL - 6528 }),
    /did not generate/
  );
  // And one identity arm silently skipped (816 fewer).
  assert.throws(
    () => script.assertGridComplete({ generations: inputsGeneration.GRID_TOTAL - 816 }),
    /section 9's sealed grid is 14688/
  );
});

// ---------------------------------------------------------------------------
// The written artifact
// ---------------------------------------------------------------------------

function minimalPermutationBlock() {
  return {
    observations: [{ season: 2025, week: 2, salt: 's', position: 'QB', playerId: 1, actual: 1, projected: 2 }],
    rosterRows: [{ season: 2025, week: 2, position: 'QB', playerId: 1 }],
    rosterWeeks: { 2: { rosters: [] } },
    cohortWeeks: { 2: { members: [], actualPointsByPlayerId: { 1: 7.5 } } },
    positionRank: { QB: 1 },
    nameRankById: { 1: 1 },
  };
}

test('the records artifact is canonical, environment-free, and refuses to omit the permutation control', () => {
  const records = {
    armWeekMetrics: [{ scoringProfile: 'half_ppr', arm: 'usage-25-off', season: 2025, week: 1, salt: 's1', values: {} }],
    subgroupErrorRows: [],
    activationRecords: [],
    preflight: { cohortRosterRows: [], saltSeedRecords: [] },
    counts: { generations: 14688 },
  };
  const withBlock = { permutationControl: minimalPermutationBlock(), permutationCounts: { generations: 408 } };
  const serialized = script.serializeArtifact(script.buildArtifact(records, withBlock));
  assert.equal(serialized.endsWith('\n'), true);
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed.counts, { generations: 14688, permutationControl: { generations: 408 } });
  // The Map trap, pinned from the round trip side: the embedded cohort
  // artifact's outcome truth must SURVIVE serialization, not collapse to {}.
  assert.deepEqual(parsed.permutationControl.cohortWeeks[2].actualPointsByPlayerId, { 1: 7.5 });

  // NEGATIVE CONTROL: a records artifact without the block looks
  // one-increment-from-assemblable and is not - refused, not written.
  assert.throws(() => script.buildArtifact(records), /requires the permutationControl block/);
  assert.throws(
    () => script.buildArtifact(records, { permutationControl: minimalPermutationBlock() }),
    /requires the permutation capture counts/
  );

  // NEGATIVE CONTROL: a leaked absolute path is refused, not written.
  assert.throws(
    () => script.serializeArtifact({ ...records, note: 'C:\\Users\\someone\\backtest-data\\snapshot' }),
    /absolute-path-shaped/
  );
});

// ---------------------------------------------------------------------------
// Obligation 4: the benchmark history must carry usage
// ---------------------------------------------------------------------------

const PRIMARY_RULES = SCORING_PRESETS[PRIMARY_SCORING_PROFILE];

function statLine({ receptions, receivingYards, targets }) {
  return {
    receptions, receivingYards, usageTargets: targets, usagePassAttempts: null, usageCarries: null,
  };
}

function fakeSnapshot() {
  return {
    playerStats: [
      { player_id: 11, season: 2025, week: 1, stats: statLine({ receptions: 5, receivingYards: 60, targets: 8 }) },
      { player_id: 11, season: 2025, week: 2, stats: statLine({ receptions: 3, receivingYards: 40, targets: 6 }) },
      { player_id: 11, season: 2025, week: 3, stats: statLine({ receptions: 7, receivingYards: 90, targets: 11 }) },
      // No crosswalk link: must be skipped, never scored into someone's history.
      { player_id: 99, season: 2025, week: 1, stats: statLine({ receptions: 9, receivingYards: 200, targets: 14 }) },
    ],
  };
}

const GSIS_BY_PLAYER_ID = new Map([[11, '00-0011111']]);

test('the benchmark history carries usage, and rescores points identically to the roster index', () => {
  const index = script.buildBenchmarkPriorGamesIndex({
    snapshot: fakeSnapshot(), gsisByPlayerId: GSIS_BY_PLAYER_ID, rules: PRIMARY_RULES,
  });

  assert.deepEqual([...index.keys()], ['00-0011111'], 'an uncrosswalked stat row must not create a history');
  const games = index.get('00-0011111');
  assert.equal(games.length, 3);

  // Points are the pinned profile's own rescoring, not a second opinion.
  assert.equal(
    games[0].points,
    calculateFantasyPoints(statLine({ receptions: 5, receivingYards: 60, targets: 8 }), PRIMARY_RULES)
  );
  // ...and every game is usage-bearing, which is the whole point of this index.
  for (const game of games) {
    assert.equal(naive.isUsageBearing(game), true, 'every game must carry the usage counts usage-signal reads');
  }
});

test('NEGATIVE CONTROL: a history without usage silently nulls usage-signal for every player', () => {
  const withUsage = script.buildBenchmarkPriorGamesIndex({
    snapshot: fakeSnapshot(), gsisByPlayerId: GSIS_BY_PLAYER_ID, rules: PRIMARY_RULES,
  }).get('00-0011111');

  // Exactly what `run-backtest-rosters.buildPriorGamesIndex` emits: no usage.
  const withoutUsage = withUsage.map(({ season, week, points }) => ({ season, week, points }));

  const scored = naive.benchmarksFor({ playerId: 11, priorGames: withUsage, season: 2025, week: 4 });
  const unscored = naive.benchmarksFor({ playerId: 11, priorGames: withoutUsage, season: 2025, week: 4 });

  // naive-recency cannot tell the two apart - which is why the defect is
  // invisible without this test.
  assert.equal(
    scored[naive.BENCHMARKS.NAIVE_RECENCY].median,
    unscored[naive.BENCHMARKS.NAIVE_RECENCY].median
  );
  // usage-signal is the discriminator: finite with usage, null without it.
  assert.equal(Number.isFinite(scored[naive.BENCHMARKS.USAGE_SIGNAL].median), true);
  assert.equal(unscored[naive.BENCHMARKS.USAGE_SIGNAL].median, null);
});

// ---------------------------------------------------------------------------
// The per-week benchmark projections, humans and DEF
// ---------------------------------------------------------------------------

const MEMBERS = new Map([
  [11, { playerId: 11, gsisId: '00-0011111', teamKey: 'KC', isDefense: false }],
  [900, { playerId: 900, gsisId: null, teamKey: 'SF', isDefense: true }],
]);

function benchmarkFixtures() {
  return {
    season: 2025,
    week: 4,
    playerIds: [11, 900],
    memberById: MEMBERS,
    priorGamesByGsis: script.buildBenchmarkPriorGamesIndex({
      snapshot: fakeSnapshot(), gsisByPlayerId: GSIS_BY_PLAYER_ID, rules: PRIMARY_RULES,
    }),
    priorGamesByTeamKey: new Map([['SF', [
      { season: 2025, week: 1, points: 12 },
      { season: 2025, week: 2, points: 6 },
      { season: 2025, week: 3, points: 9 },
    ]]]),
  };
}

test('a DEF is scored from the team-key history, a human from the gsis history', () => {
  const byArm = script.benchmarkProjectionsForWeek(benchmarkFixtures());

  assert.deepEqual(
    Object.keys(byArm).sort(),
    [naive.BENCHMARKS.NAIVE_RECENCY, naive.BENCHMARKS.USAGE_SIGNAL].sort()
  );

  const naiveArm = byArm[naive.BENCHMARKS.NAIVE_RECENCY];
  // Both member kinds score - the DEF is the one that would have been silently
  // null had the team-key index been skipped.
  assert.equal(Number.isFinite(naiveArm.get(11).median), true);
  assert.equal(Number.isFinite(naiveArm.get(900).median), true, 'a DEF must have a naive-recency estimate');

  const usageArm = byArm[naive.BENCHMARKS.USAGE_SIGNAL];
  assert.equal(Number.isFinite(usageArm.get(11).median), true);
  // Correct, not a gap: no DEF game is usage-bearing under lib/naive's own
  // definition, because a defence has no attempts, carries or targets.
  assert.equal(usageArm.get(900).median, null);
});

test('a playerId with no cohort member is named, never handed an empty history', () => {
  const fixtures = benchmarkFixtures();
  assert.throws(
    () => script.benchmarkProjectionsForWeek({ ...fixtures, playerIds: [11, 900, 4242] }),
    /no cohort member for playerId 4242/
  );
});

// ---------------------------------------------------------------------------
// The playerId key-type boundary
// ---------------------------------------------------------------------------

const HONEST_WEEK = () => ({
  cohortWeek: { members: [{ playerId: 11 }, { playerId: 900 }] },
  rosterWeek: { rosters: [{ players: [{ playerId: 11 }, { playerId: 900 }] }] },
});

test('numeric cohort and roster ids pass, and the real committed artifacts satisfy it', () => {
  assert.equal(script.assertNumericPlayerIds({ ...HONEST_WEEK(), label: 'x' }), true);

  // Against real frozen Commit-A artifacts, not a fixture: this is the claim
  // that the assertion is a contract pin rather than a live repair.
  const root = 'backtest-artifacts/pit-sweep-2024-2025';
  const cohortWeek = JSON.parse(fs.readFileSync(`${root}/cohort-weeks/2025-w2.json`, 'utf8'));
  const rosterWeek = JSON.parse(fs.readFileSync(`${root}/roster-weeks/2025-w2.json`, 'utf8'));
  assert.equal(script.assertNumericPlayerIds({ rosterWeek, cohortWeek, label: '2025:2' }), true);
  assert.ok(cohortWeek.members.length > 0 && rosterWeek.rosters.length > 0, 'the artifacts must be non-empty for this to mean anything');
});

test('NEGATIVE CONTROL: a string cohort id is refused, not coerced into agreement', () => {
  // The demonstrated defect: string ids score nothing while every count,
  // baseline row and subgroup row stays byte-identical to an honest run,
  // because those paths travel on `cohortPlayerIds`' coerced ids.
  const partial = HONEST_WEEK();
  partial.cohortWeek.members[1].playerId = '900';
  assert.throws(
    () => script.assertNumericPlayerIds({ ...partial, label: 'w' }),
    /cohortWeek\.members\[1\]\.playerId is "900" \(string\), not a finite number/
  );

  const roster = HONEST_WEEK();
  roster.rosterWeek.rosters[0].players[0].playerId = '11';
  assert.throws(() => script.assertNumericPlayerIds({ ...roster, label: 'w' }), /rosterWeek\.rosters\[0\]\.players\[0\]\.playerId/);

  for (const value of [null, undefined, NaN, '11']) {
    const bad = HONEST_WEEK();
    bad.cohortWeek.members[0].playerId = value;
    assert.throws(() => script.assertNumericPlayerIds({ ...bad, label: 'w' }), /not a finite number/, `${JSON.stringify(value)} must be refused`);
  }
});

// ---------------------------------------------------------------------------
// Obligations 1-3: the generation seam
// ---------------------------------------------------------------------------

function spyGenerate() {
  const calls = [];
  const generate = script.makeGenerate({
    snapshot: { id: 'fake-snapshot' },
    reconstructionFor: (season) => ({ forSeason: season }),
    createClient: (args) => ({ client: true, ...args }),
    generateProjectionsImpl: async (args) => {
      calls.push(args);
      return {
        projections: new Map([[11, { median: 12.5 }]]),
        inputCutoff: 'cutoff',
        sourceCoverage: { status: 'ok' },
      };
    },
  });
  return { calls, generate };
}

const COORDINATE = {
  scoringProfile: 'half_ppr',
  season: 2025,
  week: 4,
  playerIds: [11],
  hashValue: 'abc123',
  modelConstants: { usage: { blendWeight: 0.4 } },
};

test('obligation 1: weatherService is a literal false on every call', async () => {
  const { calls, generate } = spyGenerate();
  await generate(COORDINATE);
  // Even when a caller tries to pass one - the parameter does not exist, so a
  // stray argument cannot reach generateProjections.
  await generate({ ...COORDINATE, weatherService: { getForecastsForGames: () => {} } });

  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.weatherService, false);
});

test('obligation 2: onPreHomeAwayBaseline is forwarded by identity, not rebuilt', async () => {
  const { calls, generate } = spyGenerate();
  const callback = () => {};
  await generate({ ...COORDINATE, onPreHomeAwayBaseline: callback });
  assert.equal(calls[0].onPreHomeAwayBaseline, callback);

  // Absent stays absent: a manufactured no-op callback would capture zero
  // baseline rows and read as an empty subgroup rather than a wiring fault.
  await generate(COORDINATE);
  assert.equal(calls[1].onPreHomeAwayBaseline, undefined);
});

test('obligation 3: the whole run object is returned, never the projections Map', async () => {
  const { generate } = spyGenerate();
  const run = await generate(COORDINATE);

  assert.equal(run instanceof Map, false, 'returning the Map is the defect this pins');
  assert.equal(run.projections instanceof Map, true);
  assert.equal(run.projections.get(11).median, 12.5);
  // The fields the pure layer's projectionsMapOf unwraps around.
  assert.equal(run.inputCutoff, 'cutoff');
});

test('the profile decides the rules, the reconstruction is the season\'s own, and an unsealed profile throws', async () => {
  const { calls, generate } = spyGenerate();

  await generate(COORDINATE);
  assert.deepEqual(calls[0].rules, SCORING_PRESETS.half_ppr);
  assert.equal(calls[0].modelConstants, COORDINATE.modelConstants);
  assert.deepEqual(calls[0].client.reconstruction, { forSeason: 2025 });

  await generate({ ...COORDINATE, scoringProfile: 'ppr', season: 2024 });
  assert.deepEqual(calls[1].rules, SCORING_PRESETS.ppr);
  assert.deepEqual(calls[1].client.reconstruction, { forSeason: 2024 }, 'the 2024 grid must not reuse 2025\'s reconstruction');
  assert.notDeepEqual(calls[0].rules, calls[1].rules, 'two profiles must not resolve to the same rules');

  await assert.rejects(() => generate({ ...COORDINATE, scoringProfile: 'quarter_ppr' }), /no scoring preset/);
});

// ---------------------------------------------------------------------------
// The final seed
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The permutation-control document block (increment 4)
// ---------------------------------------------------------------------------

const metrics = require('../../scripts/backtest/lib/metrics');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');

function blockFixtures({ mapConverted = false } = {}) {
  const rosterIndexByWeek = {};
  const cohortIndexByWeek = {};
  for (const week of metrics.EVALUATED_WEEKS) {
    rosterIndexByWeek[`2025:${week}`] = { season: 2025, week, rosters: [{ players: [] }] };
    cohortIndexByWeek[`2025:${week}`] = {
      season: 2025,
      week,
      members: [{ playerId: 11 }],
      actualPointsByPlayerId: mapConverted ? new Map([[11, 9.5]]) : { 11: 9.5 },
    };
  }
  // A 2024 week that must NOT be embedded: section 5 is 2025-only.
  rosterIndexByWeek['2024:2'] = { season: 2024, week: 2, rosters: [] };
  cohortIndexByWeek['2024:2'] = { season: 2024, week: 2, members: [], actualPointsByPlayerId: {} };
  return {
    capture: {
      observations: [{ season: 2025, week: 2, salt: 's', position: 'QB', playerId: 11, actual: 9.5, projected: 12 }],
      rosterRows: [{ season: 2025, week: 2, position: 'QB', playerId: 11 }],
      counts: { generations: 408 },
    },
    rosterIndexByWeek,
    cohortIndexByWeek,
    ranks: {
      positionRank: new Map([['QB', 1], ['RB', 2]]),
      nameRankById: new Map([[11, 4], [900, 7]]),
    },
  };
}

test('the block carries the six closed keys: raw 2025 artifacts by identity, rank Maps as plain objects', () => {
  const fixtures = blockFixtures();
  const block = script.buildPermutationControlBlock(fixtures);

  assert.deepEqual(
    Object.keys(block).sort(),
    ['cohortWeeks', 'nameRankById', 'observations', 'positionRank', 'rosterRows', 'rosterWeeks'],
    'assembleSweepInputs closes the block to exactly these keys'
  );
  assert.equal(block.observations, fixtures.capture.observations);
  assert.equal(block.rosterRows, fixtures.capture.rosterRows);
  for (const week of metrics.EVALUATED_WEEKS) {
    // IDENTITY, not a copy: the embedded artifact is the raw parsed JSON the
    // freeze hash verified, byte for byte.
    assert.equal(block.rosterWeeks[week], fixtures.rosterIndexByWeek[`2025:${week}`]);
    assert.equal(block.cohortWeeks[week], fixtures.cohortIndexByWeek[`2025:${week}`]);
  }
  assert.equal(2024 in block.rosterWeeks, false, 'section 5 is 2025-only; the 2024 artifacts must not ride along');
  // The two DB-produced rank artifacts survive serialization as plain objects.
  assert.deepEqual(block.positionRank, { QB: 1, RB: 2 });
  assert.deepEqual(block.nameRankById, { 11: 4, 900: 7 });
  assert.equal(canonicalJson(block.nameRankById) === '{}', false);
});

test('NEGATIVE CONTROL: a Map-converted cohort artifact would serialize its outcome truth as {} - refused by name', () => {
  const fixtures = blockFixtures({ mapConverted: true });
  // The defect being pinned: canonicalJson collapses a Map to {} silently.
  assert.equal(canonicalJson(fixtures.cohortIndexByWeek['2025:2'].actualPointsByPlayerId), '{}');
  assert.throws(
    () => script.buildPermutationControlBlock(fixtures),
    /actualPointsByPlayerId as a Map.*carrying no outcome truth at all/s
  );
});

test('a missing 2025 evaluated week fails the block, never a partial embed', () => {
  const fixtures = blockFixtures();
  delete fixtures.cohortIndexByWeek['2025:9'];
  assert.throws(() => script.buildPermutationControlBlock(fixtures), /no frozen artifacts for 2025:9/);
});

test('a captured player the embedded cohort does not carry fails the block (adversarial finding F5)', () => {
  const fixtures = blockFixtures();
  fixtures.capture.rosterRows.push({ season: 2025, week: 3, position: 'RB', playerId: 999 });
  assert.throws(
    () => script.buildPermutationControlBlock(fixtures),
    /captured roster row 3:RB:999 names a player the embedded cohort artifact does not carry/
  );
});

test('the outcome-truth conversion is STRICT: alias keys and non-number values are refused, never coerced (adversarial finding F1)', () => {
  const honest = script.numericOutcomeTruthMap({ 1: 11, 42: 0 }, 'w');
  assert.deepEqual([...honest.entries()], [[1, 11], [42, 0]]);

  // NEGATIVE CONTROL: every one of these keys satisfies bare Number() as
  // player 1, so the old conversion silently overwrote 11 last-wins.
  for (const alias of ['1.0', ' 1', '0x1', '1e0', '+1']) {
    assert.throws(
      () => script.numericOutcomeTruthMap({ 1: 11, [alias]: 3.25 }, 'w'),
      /not a canonical non-negative integer playerId/,
      `${JSON.stringify(alias)} must be refused`
    );
  }
  assert.throws(() => script.numericOutcomeTruthMap({ 1: '7.5' }, 'w'), /is "7\.5" \(string\), not a finite number/);
  assert.throws(() => script.numericOutcomeTruthMap({ 1: null }, 'w'), /not a finite number/);
});

test('PATCH G: every record member survives into the serialized artifact by value, under the closed key set', () => {
  const records = {
    armWeekMetrics: [{ scoringProfile: 'half_ppr', arm: 'usage-25-off', season: 2025, week: 1, salt: 's1', values: {} }],
    subgroupErrorRows: [{ cellName: 'usage-40-on', week: 2 }],
    activationRecords: [{ cell: 'usage-40-on', position: 'QB' }],
    preflight: { cohortRosterRows: [{ week: 2 }], saltSeedRecords: [] },
    counts: { generations: 14688 },
  };
  const withBlock = { permutationControl: minimalPermutationBlock(), permutationCounts: { generations: 408 } };
  const parsed = JSON.parse(script.serializeArtifact(script.buildArtifact(records, withBlock)));

  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['activationRecords', 'armWeekMetrics', 'counts', 'permutationControl', 'preflight', 'subgroupErrorRows'],
    'a dropped record key would serialize, validate, and read as a checkpoint carrying nothing to assemble'
  );
  assert.deepEqual(parsed.armWeekMetrics, records.armWeekMetrics);
  assert.deepEqual(parsed.subgroupErrorRows, records.subgroupErrorRows);
  assert.deepEqual(parsed.activationRecords, records.activationRecords);
  assert.deepEqual(parsed.preflight, records.preflight);

  // And buildArtifact itself refuses a records object missing any member.
  for (const key of ['armWeekMetrics', 'subgroupErrorRows', 'activationRecords', 'preflight']) {
    const { [key]: _dropped, ...withoutKey } = records;
    assert.throws(() => script.buildArtifact(withoutKey, withBlock), new RegExp(`requires records\\.${key}`));
  }
});

test('the seed is the pinned parts in the pinned order, as an unsigned 32-bit integer', () => {
  const seed = script.seedFor({ hashValue: 'abc123', season: 2025, week: 4, playerId: 11 });

  assert.equal(seed, model.seedFrom(model.MODEL_VERSION, 'abc123', 2025, 4, 11));
  assert.equal(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, true);

  // NEGATIVE CONTROL: the salt reaches the seed only through hashValue, so two
  // salted hash values must not collide, and the part ORDER is load-bearing.
  assert.notEqual(seed, script.seedFor({ hashValue: 'abc124', season: 2025, week: 4, playerId: 11 }));
  assert.notEqual(seed, model.seedFrom(model.MODEL_VERSION, 'abc123', 2025, 11, 4));
});
