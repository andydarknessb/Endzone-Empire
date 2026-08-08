const test = require('node:test');
const assert = require('node:assert/strict');

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

test('the records artifact is canonical and environment-free', () => {
  const records = {
    armWeekMetrics: [{ scoringProfile: 'half_ppr', arm: 'usage-25-off', season: 2025, week: 1, salt: 's1', values: {} }],
    subgroupErrorRows: [],
    activationRecords: [],
    preflight: { cohortRosterRows: [], saltSeedRecords: [] },
    counts: { generations: 14688 },
  };
  const serialized = script.serializeArtifact(script.buildArtifact(records));
  assert.equal(serialized.endsWith('\n'), true);
  assert.deepEqual(JSON.parse(serialized).counts, { generations: 14688 });

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

test('the seed is the pinned parts in the pinned order, as an unsigned 32-bit integer', () => {
  const seed = script.seedFor({ hashValue: 'abc123', season: 2025, week: 4, playerId: 11 });

  assert.equal(seed, model.seedFrom(model.MODEL_VERSION, 'abc123', 2025, 4, 11));
  assert.equal(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, true);

  // NEGATIVE CONTROL: the salt reaches the seed only through hashValue, so two
  // salted hash values must not collide, and the part ORDER is load-bearing.
  assert.notEqual(seed, script.seedFor({ hashValue: 'abc124', season: 2025, week: 4, playerId: 11 }));
  assert.notEqual(seed, model.seedFrom(model.MODEL_VERSION, 'abc123', 2025, 11, 4));
});
