const test = require('node:test');
const assert = require('node:assert/strict');

const inputsAssembly = require('../../scripts/backtest/lib/inputsAssembly');
const inputsSensitivity = require('../../scripts/backtest/lib/inputsSensitivity');
const runBacktestSweep = require('../scripts/run-backtest-sweep');
const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');
const sweepEvidence = require('../../scripts/backtest/lib/sweepEvidence');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const model = require('../services/projectionModel');

const { SALTS, EVALUATED_WEEKS, MACRO_POSITIONS } = metrics;
const CELL_NAMES = arms.ALL_CELLS.map((cell) => cell.name);
const PRIMARY = sweepEvidence.PRIMARY_PROFILE;

// ---------------------------------------------------------------------------
// The synthetic generation universe
//
// Deterministic metric values with a per-cell "goodness" g = (on ? 1 : 0) +
// (blendWeight != 0.25 ? 1 : 0), so that EVERY candidate is strictly
// favorable against EVERY comparator its components name: (a)/(e1) against
// the control (g >= 1 vs 0), (b) on vs matched off (delta-g = 1), (c) any
// non-0.25 usage vs usage-25 at the same homeAway (delta-g = 1), (d) against
// the deliberately-worse benchmarks. Week- and salt-varying epsilons keep
// every contrast series non-degenerate without threatening a margin.
// ---------------------------------------------------------------------------

const FAVOR_BELOW = Object.freeze(['regret', 'mae', 'rmse', 'wis']);
const CONTROL_BASE = Object.freeze({ regret: 6, pairwise: 0.55, mae: 5, rmse: 6, rho: 0.4, wis: 8, coverage: 0.8 });
const PROFILE_OFFSET = Object.freeze({ half_ppr: 0, standard: 0.07, ppr: 0.13 });
const COHORT_WEEKS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9]);
const COHORT_PLAYERS = Object.freeze([7, 8, 9, 10, 11]);

function favorSign(endpoint) { return FAVOR_BELOW.includes(endpoint) ? 1 : -1; }

function goodness(cellMeta) {
  return (cellMeta.homeAway === 'on' ? 1 : 0) + (cellMeta.blendWeight !== arms.CONTROL_BLEND_WEIGHT ? 1 : 0);
}

function armOrdinal(arm) {
  const cellIndex = CELL_NAMES.indexOf(arm);
  return cellIndex >= 0 ? cellIndex : CELL_NAMES.length + inputsAssembly.BENCHMARK_ARMS.indexOf(arm);
}

function metricValue({ scoringProfile, arm, endpoint, season, week, salt }) {
  const weekIndex = EVALUATED_WEEKS.indexOf(week);
  const saltIndex = SALTS.indexOf(salt);
  const sign = favorSign(endpoint);
  // The season term multiplies the ARM-SPECIFIC component (not the shared
  // base), so a 2024 contrast is byte-DIFFERENT from its 2025 twin: an
  // arm-independent season offset would cancel in every candidate-minus-
  // comparator delta, and a wrong season mapping (e1 fed 2025 data,
  // mae-2024 fed 2025 data) would be undetectable (QA on the first cut).
  const seasonFactor = season === 2024 ? 1.07 : 1;
  const base = CONTROL_BASE[endpoint] + PROFILE_OFFSET[scoringProfile]
    + (season === 2024 ? 0.03 : 0) + weekIndex * 0.0007 + saltIndex * 1e-5;
  const cellMeta = arms.ALL_CELLS.find((cell) => cell.name === arm);
  if (cellMeta) {
    const ordinal = armOrdinal(arm);
    return base - sign * seasonFactor * (0.4 * goodness(cellMeta) + 0.004 * ordinal
      + weekIndex * 1e-4 * (1 + ordinal) + saltIndex * 1e-6 * (1 + ordinal));
  }
  const handicap = arm === inputsAssembly.ARM_NAIVE ? 0.8 : 0.5;
  return base + sign * seasonFactor * (handicap + weekIndex * 5e-5);
}

function armWeekRecord(scoringProfile, arm, season, week, salt) {
  return {
    scoringProfile, arm, season, week, salt,
    values: Object.fromEntries(sweepEvidence.METRIC_KEYS.map((endpoint) => [
      endpoint, metricValue({ scoringProfile, arm, endpoint, season, week, salt }),
    ])),
  };
}

function syntheticArmWeekMetrics() {
  const primaryArms = [...CELL_NAMES, ...inputsAssembly.BENCHMARK_ARMS];
  const primary = primaryArms.flatMap((arm) => [2025, 2024].flatMap((season) => EVALUATED_WEEKS.flatMap((week) => SALTS.map(
    (salt) => armWeekRecord(PRIMARY, arm, season, week, salt)
  ))));
  const sensitivity = sweepEvidence.SENSITIVITY_PROFILES.flatMap((scoringProfile) => CELL_NAMES.flatMap((arm) => EVALUATED_WEEKS.flatMap((week) => SALTS.map(
    (salt) => armWeekRecord(scoringProfile, arm, 2025, week, salt)
  ))));
  return [...primary, ...sensitivity];
}

function subgroupError(field, { week, playerId, salt }) {
  const saltIndex = SALTS.indexOf(salt);
  // errorOn alternates SIGN by player parity, so |mean(e)| and mean(|e|)
  // genuinely differ within every week: an all-same-signed fixture cannot
  // distinguish prereg 9.8's abs-of-mean f2 from a mean-of-abs substitution
  // (QA on the first cut). Magnitudes keep |errorOn| < |errorOff| on every
  // row, so inc stays negative and the veto never fires.
  const orientation = playerId % 2 === 0 ? 1 : -1;
  return field === 'errorOn'
    ? orientation * (0.004 + week * 1e-4 + playerId * 1e-5 + saltIndex * 1e-6)
    : -0.03 - week * 2e-4 - playerId * 1e-5 - saltIndex * 1e-6;
}

function syntheticSubgroupErrorRows() {
  return arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').flatMap((cell) => COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.flatMap((playerId) => SALTS.map((salt) => ({
    cellName: cell.name, season: 2025, week, playerId, salt,
    errorOn: subgroupError('errorOn', { week, playerId, salt }),
    errorOff: subgroupError('errorOff', { week, playerId, salt }),
  })))));
}

function treatedProjection() {
  return {
    eligible: true, neutralSite: false, knownOrientation: true,
    factors: { homeAway: { available: true, effect: 0.02 } },
  };
}

function syntheticActivationRecords() {
  return arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').flatMap((cell) => ['2025', '2024'].flatMap((season) => EVALUATED_WEEKS.flatMap((week) => MACRO_POSITIONS.map((position) => ({
    cell: cell.name, season, week, position, projections: [treatedProjection()],
  })))));
}

function syntheticPreflight() {
  const cohortRosterRows = COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.map((playerId) => (
    // Prereg-4.1 eligibility facts ride on every roster row (the A4
    // membership ruling); all-eligible keeps the subgroup = full cohort.
    { season: 2025, week, playerId, position: 'RB', onBye: false }
  )));
  const rawRun = () => ({
    projections: COHORT_PLAYERS.map((playerId) => ({ playerId, median: 12.5 + playerId, p10: 4, factors: {} })),
    inputCutoff: '2025-09-01T00:00:00.000Z', sourceCoverage: { synthetic: true },
  });
  const usage25 = arms.ALL_CELLS.find((cell) => cell.blendWeight === 0.25 && cell.homeAway === 'on');
  const records = () => COHORT_WEEKS.flatMap((week) => SALTS.map((salt) => ({
    season: 2025, week, salt,
    leftPlayerIds: [...COHORT_PLAYERS], rightPlayerIds: [...COHORT_PLAYERS],
    leftRun: rawRun(), rightRun: rawRun(),
    leftConstants: arms.resolveConstants({ cell: usage25, baseConstants: model.MODEL_CONSTANTS }),
    rightConstants: arms.resolveConstantsWithStoredHistory({ cell: usage25, baseConstants: model.MODEL_CONSTANTS }),
  })));
  return {
    cohortRosterRows,
    controlUsage25Records: records(),
    homeAwayStoredRecords: records(),
    saltSeedRecords: arms.ALL_CELLS.flatMap((cell) => COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.map((playerId) => ({
      cellName: cell.name, season: 2025, week, playerId,
      seedsBySalt: Object.fromEntries(SALTS.map((salt, index) => [salt, index])),
    })))),
    matchedOffBaselineRows: arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').flatMap((cell) => COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.map((playerId) => ({
      cellName: cell.name, season: 2025, week, playerId, baseline: -1,
    })))),
  };
}

function syntheticPermutationControl() {
  const pid = (position, n) => MACRO_POSITIONS.indexOf(position) * 100 + n;
  const rosterRows = EVALUATED_WEEKS.flatMap((week) => MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, position, playerId: pid(position, 1) },
    { season: 2025, week, position, playerId: pid(position, 2) },
  ]));
  const byWeek = (build) => Object.fromEntries(EVALUATED_WEEKS.map((week) => [week, build(week)]));
  const everyPlayer = MACRO_POSITIONS.flatMap((position) => [pid(position, 1), pid(position, 2)]);
  const observations = SALTS.flatMap((salt) => EVALUATED_WEEKS.flatMap((week) => MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, salt, position, playerId: pid(position, 1), actual: 1, projected: 1 },
    { season: 2025, week, salt, position, playerId: pid(position, 2), actual: 0, projected: 0 },
  ])));
  return {
    rosterRows: [...rosterRows].reverse(),
    // Deliberately REVERSED: the assembler owns canonical emission order, and
    // a fixture already in canonical order could not detect a sort that never
    // ran (the wrapped-line-grep lesson, applied to ordering).
    observations: [...observations].reverse(),
    rosterWeeks: byWeek(() => ({
      rosters: [{ replicate: 1, teamIndex: 0, starters: [], bench: everyPlayer.map((playerId) => ({ playerId })) }],
    })),
    cohortWeeks: byWeek(() => ({
      members: MACRO_POSITIONS.flatMap((position) => [1, 2].map((n) => ({
        playerId: pid(position, n), position, teamKey: `T${pid(position, n)}`, injuryStatus: null, onBye: false,
      }))),
    })),
    positionRank: Object.fromEntries(MACRO_POSITIONS.map((position, i) => [position, i + 1])),
    nameRankById: Object.fromEntries(everyPlayer.map((playerId) => [playerId, playerId])),
  };
}

function syntheticOrderingSensitivity() {
  return Object.fromEntries(arms.SELECTION_FAMILY.map((cell) => [cell.name, { contradicted: false, detail: null }]));
}

function universe(overrides = {}) {
  return {
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    orderingDisagreement: false,
    deployedPolicyDisagreement: false,
    armWeekMetrics: syntheticArmWeekMetrics(),
    subgroupErrorRows: syntheticSubgroupErrorRows(),
    activationRecords: syntheticActivationRecords(),
    orderingSensitivityByCell: syntheticOrderingSensitivity(),
    sensitivityAudit: inputsSensitivity.placeholderSensitivityAudit(),
    preflight: syntheticPreflight(),
    permutationControl: syntheticPermutationControl(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The flagship round trip: assembled document -> reducer -> valid, passing run
// ---------------------------------------------------------------------------

test('assembled document round-trips through the reducer to a valid run with every candidate passing', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  // The reducer's own closed-schema validation is the contract this module
  // exists to satisfy; run it explicitly before the full reduction so a
  // schema drift fails here by name rather than deep in a claim assembly.
  runBacktestSweep.validateInputs(inputs);
  const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
  assert.equal(report.run.status, 'valid');
  const byCell = Object.fromEntries(report.cells.map((cell) => [cell.name, cell]));
  assert.equal(byCell[arms.CONTROL_CELL].verdict, 'baseline');
  for (const cell of arms.SELECTION_FAMILY) {
    assert.equal(byCell[cell.name].verdict, 'pass', `${cell.name} should pass comfortably: ${JSON.stringify(byCell[cell.name].failures)} ${JSON.stringify(byCell[cell.name].inconclusive)}`);
  }
  assert.equal(report.selection.outcome, 'selected');
  assert.ok(report.selection.selected, 'a fully-passing family must select a cell');
});

test('assembly is deterministic: two independently built universes produce byte-identical documents', () => {
  const first = canonicalJson(inputsAssembly.assembleSweepInputs(universe()));
  const second = canonicalJson(inputsAssembly.assembleSweepInputs(universe()));
  assert.equal(first, second);
});

// ---------------------------------------------------------------------------
// Contrast arithmetic
// ---------------------------------------------------------------------------

test('a component weekDelta is exactly saltPairedDelta over the 24 same-salt deltas', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const cell = 'usage-40-on';
  const week = 5;
  const expected = metrics.saltPairedDelta({
    candidateBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: PRIMARY, arm: cell, endpoint: 'regret', season: 2025, week, salt })])),
    comparatorBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: PRIMARY, arm: arms.CONTROL_CELL, endpoint: 'regret', season: 2025, week, salt })])),
    label: 'expected',
  });
  assert.equal(inputs.cells[cell].a.regretWeekDeltas[week], expected);
});

test('components (b), (c), (d), (e1) each pin their preregistered comparator and season, bit-exactly', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const week = 11;
  const expectedDelta = (candidate, comparator, endpoint, season) => metrics.saltPairedDelta({
    candidateBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: PRIMARY, arm: candidate, endpoint, season, week, salt })])),
    comparatorBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: PRIMARY, arm: comparator, endpoint, season, week, salt })])),
    label: 'expected',
  });
  // (b): the matched same-usage OFF cell (prereg 9.3) - NOT the control.
  assert.equal(inputs.cells['usage-40-on'].b.regretWeekDeltas[week], expectedDelta('usage-40-on', 'usage-40-off', 'regret', 2025));
  // (c): usage-25 at the SAME homeAway setting (prereg 9.4) - NOT the control.
  assert.equal(inputs.cells['usage-40-on'].c.pairwiseWeekDeltas[week], expectedDelta('usage-40-on', 'usage-25-on', 'pairwise', 2025));
  // A control-comparator substitution for (c) must be DETECTABLE: the two
  // expected values differ in this fixture (delta-goodness 1 vs 2).
  assert.notEqual(expectedDelta('usage-40-on', 'usage-25-on', 'pairwise', 2025), expectedDelta('usage-40-on', arms.CONTROL_CELL, 'pairwise', 2025));
  // (d): the naive-recency benchmark (prereg 9.5).
  assert.equal(inputs.cells['usage-40-on'].d.regretWeekDeltas[week], expectedDelta('usage-40-on', inputsAssembly.ARM_NAIVE, 'regret', 2025));
  // (e1): the control under SEASON 2024 (prereg 9.6), byte-different from
  // the 2025 (a) series in this fixture by construction.
  assert.equal(inputs.cells['usage-40-on'].e1.regretWeekDeltas[week], expectedDelta('usage-40-on', arms.CONTROL_CELL, 'regret', 2024));
  assert.notEqual(inputs.cells['usage-40-on'].e1.regretWeekDeltas[week], inputs.cells['usage-40-on'].a.regretWeekDeltas[week]);
});

test('e2 season suffixes draw the named season: mae-2024 is byte-different from mae-2025', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const cell = 'usage-00-off';
  const week = 8;
  const endpointFor = (key) => inputs.cells[cell].e2.endpoints.find((e) => e.key === key);
  const expected = (season) => metrics.saltPairedDelta({
    candidateBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: PRIMARY, arm: cell, endpoint: 'mae', season, week, salt })])),
    comparatorBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: PRIMARY, arm: arms.CONTROL_CELL, endpoint: 'mae', season, week, salt })])),
    label: 'expected',
  });
  assert.equal(endpointFor('mae-2024').weekDeltas[week], expected(2024));
  assert.equal(endpointFor('mae-2025').weekDeltas[week], expected(2025));
  assert.notEqual(expected(2024), expected(2025), 'the fixture must make a season swap detectable');
});

test('f2 implements abs-of-mean (prereg 9.8), byte-exactly, and the fixture distinguishes it from mean-of-abs', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const week = COHORT_WEEKS[2];
  const absOfMean = (field) => Object.fromEntries(SALTS.map((salt) => [salt,
    Math.abs(COHORT_PLAYERS.reduce((sum, playerId) => sum + subgroupError(field, { week, playerId, salt }), 0) / COHORT_PLAYERS.length),
  ]));
  const expected = metrics.saltPairedDelta({
    candidateBySalt: absOfMean('errorOn'), comparatorBySalt: absOfMean('errorOff'), label: 'expected',
  });
  assert.equal(inputs.cells['usage-25-on'].f.f2.weekDeltas[2], expected);
  const meanOfAbs = SALTS.reduce((sum, salt) => sum + COHORT_PLAYERS.reduce((inner, playerId) => inner + Math.abs(subgroupError('errorOn', { week, playerId, salt })), 0) / COHORT_PLAYERS.length, 0) / SALTS.length;
  const absOfMeanOn = SALTS.reduce((sum, salt) => sum + absOfMean('errorOn')[salt], 0) / SALTS.length;
  assert.notEqual(meanOfAbs, absOfMeanOn, 'the mixed-sign fixture must separate the two estimators');
});

test('the control cell carries exact-zero self-contrast series for (a) and (e1)', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  for (const series of [inputs.cells[arms.CONTROL_CELL].a.regretWeekDeltas, inputs.cells[arms.CONTROL_CELL].e1.pairwiseWeekDeltas]) {
    assert.equal(Object.keys(series).length, EVALUATED_WEEKS.length);
    for (const value of Object.values(series)) assert.equal(value, 0);
  }
});

test('e2 profile rows are drawn from their own scoring-profile generations', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const cell = 'usage-60-off';
  const week = 3;
  const endpoint = inputs.cells[cell].e2.endpoints.find((e) => e.key === 'standard-regret-2025');
  const expected = metrics.saltPairedDelta({
    candidateBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: 'standard', arm: cell, endpoint: 'regret', season: 2025, week, salt })])),
    comparatorBySalt: Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: 'standard', arm: arms.CONTROL_CELL, endpoint: 'regret', season: 2025, week, salt })])),
    label: 'expected',
  });
  assert.equal(endpoint.weekDeltas[week], expected);
});

// ---------------------------------------------------------------------------
// Prereg 10.4 drop rule: absence is an omitted key plus a nonfinite marker
// ---------------------------------------------------------------------------

test('a week with no generated rows drops by omitted key and publishes nonfinite evidence markers, and the run stays valid', () => {
  const dropped = universe();
  dropped.armWeekMetrics = dropped.armWeekMetrics.filter((record) => !(
    record.arm === 'usage-60-off' && record.scoringProfile === PRIMARY && record.season === 2025 && record.week === 18
  ));
  const inputs = inputsAssembly.assembleSweepInputs(dropped);
  assert.equal(inputs.cells['usage-60-off'].a.regretWeekDeltas[18], undefined);
  assert.equal(Object.keys(inputs.cells['usage-60-off'].a.regretWeekDeltas).length, EVALUATED_WEEKS.length - 1);
  const marker = inputs.evidence.metricWeeks.find((row) => row.cell === 'usage-60-off' && row.season === '2025'
    && row.estimand === 'absolute' && row.endpoint === 'regret' && row.week === 18);
  assert.deepEqual(marker.value, { nonfinite: 'NaN' });
  const paired = inputs.evidence.metricWeeks.find((row) => row.cell === 'usage-60-off' && row.season === '2025'
    && row.estimand === 'paired-delta' && row.endpoint === 'regret' && row.week === 18);
  assert.deepEqual(paired.value, { nonfinite: 'NaN' });
  // Other cells keep their own week-18 values: the union drop for the
  // absolute family is deriveEvidence's job, never expressed by falsifying
  // another cell's generated value.
  const other = inputs.evidence.metricWeeks.find((row) => row.cell === 'usage-40-off' && row.season === '2025'
    && row.estimand === 'absolute' && row.endpoint === 'regret' && row.week === 18);
  assert.ok(typeof other.value === 'number' && Number.isFinite(other.value));
  const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
  assert.equal(report.run.status, 'valid');
});

test('an endpoint uniformly null for a week drops that week from its own contrasts only', () => {
  const nulled = universe();
  for (const record of nulled.armWeekMetrics) {
    if (record.arm === 'usage-00-on' && record.scoringProfile === PRIMARY && record.season === 2025 && record.week === 7) {
      record.values = { ...record.values, pairwise: null };
    }
  }
  const inputs = inputsAssembly.assembleSweepInputs(nulled);
  assert.equal(inputs.cells['usage-00-on'].a.pairwiseWeekDeltas[7], undefined);
  assert.equal(inputs.cells['usage-00-on'].a.regretWeekDeltas[7] !== undefined, true);
  const marker = inputs.evidence.metricWeeks.find((row) => row.cell === 'usage-00-on' && row.season === '2025'
    && row.estimand === 'absolute' && row.endpoint === 'pairwise' && row.week === 7);
  assert.deepEqual(marker.value, { nonfinite: 'NaN' });
});

// ---------------------------------------------------------------------------
// Component (f)
// ---------------------------------------------------------------------------

test('veto realizations are the complete pinned-order Cartesian product with incrementalError = |errorOn| - |errorOff|', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  for (const cellMeta of arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on')) {
    const { realizations } = inputs.cells[cellMeta.name].f.veto;
    assert.equal(realizations.length, COHORT_WEEKS.length * COHORT_PLAYERS.length * SALTS.length);
    assert.deepEqual(
      { season: realizations[0].season, week: realizations[0].week, playerId: realizations[0].playerId, salt: realizations[0].salt },
      { season: 2025, week: COHORT_WEEKS[0], playerId: COHORT_PLAYERS[0], salt: SALTS[0] }
    );
    const sample = realizations.find((row) => row.week === 4 && row.playerId === 9 && row.salt === SALTS[3]);
    const expected = Math.abs(subgroupError('errorOn', { week: 4, playerId: 9, salt: SALTS[3] }))
      - Math.abs(subgroupError('errorOff', { week: 4, playerId: 9, salt: SALTS[3] }));
    assert.equal(sample.incrementalError, expected);
    assert.ok(!('f1' in inputs.cells[cellMeta.name].f), 'no f1 series may ever be emitted (round 5, SUBSTANTIVE F)');
  }
});

test('f2 weekDeltas covers exactly the derived 2025 qualifying weeks, ascending', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const f = inputs.cells['usage-25-on'].f;
  assert.equal(f.f2.weekDeltas.length, COHORT_WEEKS.length);
  for (const delta of f.f2.weekDeltas) {
    assert.ok(Number.isFinite(delta) && delta < 0, 'the synthetic subgroup is favorably biased');
  }
});

// ---------------------------------------------------------------------------
// Evidence cardinality, identity with the gating series, canonical ordering
// ---------------------------------------------------------------------------

test('evidence arrays carry the exact Cartesian cardinalities deriveEvidence demands', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  assert.equal(inputs.evidence.metricWeeks.length, 3808);
  assert.equal(inputs.evidence.movingBlockWeeks.length, 3808);
  assert.equal(inputs.evidence.attributionWeeks.length, 2142);
  assert.equal(inputs.evidence.diagnosticWeeks.length, 476);
  assert.equal(inputs.evidence.activationWeeks.length, 816);
  assert.equal(inputs.evidence.sensitivityWeeks.length, 544);
});

test('paired-delta regret/pairwise evidence rows carry the same numbers as the owning gate component', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  for (const cell of CELL_NAMES) {
    for (const [season, component, endpoint, seriesKey] of [
      ['2025', 'a', 'regret', 'regretWeekDeltas'],
      ['2024', 'e1', 'pairwise', 'pairwiseWeekDeltas'],
    ]) {
      for (const week of EVALUATED_WEEKS) {
        const row = inputs.evidence.metricWeeks.find((candidate) => candidate.cell === cell && candidate.season === season
          && candidate.estimand === 'paired-delta' && candidate.endpoint === endpoint && candidate.week === week);
        assert.equal(row.value, inputs.cells[cell][component][seriesKey][week], `${cell}/${season}/${endpoint}/w${week}`);
      }
    }
  }
});

test('attribution composites follow prereg 12.2 exactly', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const week = 6;
  const bySalt = (arm) => Object.fromEntries(SALTS.map((salt) => [salt, metricValue({ scoringProfile: PRIMARY, arm, endpoint: 'mae', season: 2025, week, salt })]));
  const usageMain = inputs.evidence.attributionWeeks.find((row) => row.cell === 'usage-40-on' && row.season === '2025'
    && row.estimand === 'usage-main' && row.endpoint === 'mae' && row.week === week);
  assert.equal(usageMain.value, metrics.saltPairedDelta({
    candidateBySalt: bySalt('usage-40-off'), comparatorBySalt: bySalt('usage-25-off'), label: 'expected',
  }));
  const interaction = inputs.evidence.attributionWeeks.find((row) => row.cell === 'usage-40-on' && row.season === '2025'
    && row.estimand === 'interaction' && row.endpoint === 'mae' && row.week === week);
  const on40 = bySalt('usage-40-on'); const off40 = bySalt('usage-40-off');
  const on25 = bySalt('usage-25-on'); const off25 = bySalt('usage-25-off');
  const expected = SALTS.reduce((sum, salt) => sum + ((on40[salt] - off40[salt]) - (on25[salt] - off25[salt])), 0) / SALTS.length;
  assert.equal(interaction.value, expected);
});

test('permutation observations are emitted in canonical salt/week/position/playerId order from shuffled input', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  const { observations } = inputs.permutationControl;
  for (let i = 1; i < observations.length; i++) {
    const rank = (row) => ((SALTS.indexOf(row.salt) * EVALUATED_WEEKS.length + EVALUATED_WEEKS.indexOf(row.week)) * MACRO_POSITIONS.length
      + MACRO_POSITIONS.indexOf(row.position)) * 1e6 + row.playerId;
    assert.ok(rank(observations[i - 1]) < rank(observations[i]), `observation ${i} out of canonical order`);
  }
});

// ---------------------------------------------------------------------------
// Fail-closed validation
// ---------------------------------------------------------------------------

test('a duplicate arm-week-salt record is rejected by coordinate', () => {
  const broken = universe();
  broken.armWeekMetrics = [...broken.armWeekMetrics, broken.armWeekMetrics[0]];
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /duplicate coordinate/);
});

test('a generated week carrying only a partial salt set is rejected as malformed, never treated as sparse', () => {
  const broken = universe();
  const target = broken.armWeekMetrics.findIndex((record) => record.arm === 'usage-00-off'
    && record.scoringProfile === PRIMARY && record.season === 2025 && record.week === 9 && record.salt === SALTS[5]);
  broken.armWeekMetrics.splice(target, 1);
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /23 of 24 salts.*missing/s);
});

test('an endpoint null under some salts but not others is rejected', () => {
  const broken = universe();
  const record = broken.armWeekMetrics.find((candidate) => candidate.arm === 'usage-00-off'
    && candidate.scoringProfile === PRIMARY && candidate.season === 2025 && candidate.week === 9 && candidate.salt === SALTS[5]);
  record.values = { ...record.values, wis: null };
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /null under 1 of 24 salts/);
});

test('benchmark generations under a sensitivity profile are rejected', () => {
  const broken = universe();
  broken.armWeekMetrics.push(armWeekRecord('standard', inputsAssembly.ARM_NAIVE, 2025, 2, SALTS[0]));
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /sensitivity profiles cover the 8 cells only/);
});

test('sensitivity-profile generations outside 2025 are rejected', () => {
  const broken = universe();
  broken.armWeekMetrics.push(armWeekRecord('ppr', 'usage-00-off', 2024, 2, SALTS[0]));
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /2025-only/);
});

test('an unknown arm name is rejected', () => {
  const broken = universe();
  broken.armWeekMetrics.push(armWeekRecord(PRIMARY, 'usage-25-off', 2025, 2, SALTS[0]));
  broken.armWeekMetrics[broken.armWeekMetrics.length - 1].arm = 'usage-99-off';
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /not one of the 8 cells or the 2 benchmark arms/);
});

test('a missing veto realization is a hard error, never a smaller domain', () => {
  const broken = universe();
  const index = broken.subgroupErrorRows.findIndex((row) => row.cellName === 'usage-25-on' && row.week === 4 && row.playerId === 9 && row.salt === SALTS[3]);
  broken.subgroupErrorRows.splice(index, 1);
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /veto realizations missing.*HARD ERROR/s);
});

test('a duplicate subgroup error row is rejected', () => {
  const broken = universe();
  const row = broken.subgroupErrorRows.find((candidate) => candidate.cellName === 'usage-25-on');
  broken.subgroupErrorRows.push({ ...row });
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /duplicate realization coordinate/);
});

test('a subgroup error row outside the derived domain is rejected as a defect, never extra evidence', () => {
  const broken = universe();
  const row = broken.subgroupErrorRows.find((candidate) => candidate.cellName === 'usage-25-on');
  broken.subgroupErrorRows.push({ ...row, playerId: 999 });
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /outside the derived subgroup domain/);
});

test('a non-finite subgroup error is rejected by field name', () => {
  const broken = universe();
  const row = broken.subgroupErrorRows.find((candidate) => candidate.cellName === 'usage-25-on');
  row.errorOff = '-0.03';
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /errorOff: must be a finite number/);
});

test('a duplicate activation coordinate is rejected', () => {
  const broken = universe();
  broken.activationRecords = [...broken.activationRecords, { ...broken.activationRecords[0] }];
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /duplicate coordinate/);
});

test('orderingSensitivityByCell must cover exactly the seven candidates - a control entry is rejected', () => {
  const withControl = universe();
  withControl.orderingSensitivityByCell = {
    ...withControl.orderingSensitivityByCell,
    [arms.CONTROL_CELL]: { contradicted: false, detail: null },
  };
  assert.throws(() => inputsAssembly.assembleSweepInputs(withControl), /orderingSensitivityByCell/);
  const missingCandidate = universe();
  delete missingCandidate.orderingSensitivityByCell['usage-60-on'];
  assert.throws(() => inputsAssembly.assembleSweepInputs(missingCandidate), /orderingSensitivityByCell/);
});

test('a subgroup error row naming an off cell or unknown cell is rejected, never silently discarded', () => {
  const offCell = universe();
  offCell.subgroupErrorRows.push({ ...offCell.subgroupErrorRows[0], cellName: 'usage-25-off' });
  assert.throws(() => inputsAssembly.assembleSweepInputs(offCell), /not an "on" cell.*never silently discarded/s);
  const unknown = universe();
  unknown.subgroupErrorRows.push({ ...unknown.subgroupErrorRows[0], cellName: 'usage-99-on' });
  assert.throws(() => inputsAssembly.assembleSweepInputs(unknown), /not an "on" cell/);
});

test('a duplicate cohort player-week that lands in the subgroup domain is rejected before it can double-count', () => {
  const broken = universe();
  broken.preflight.cohortRosterRows.push({ season: 2025, week: 3, playerId: 8, position: 'RB', onBye: false });
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /duplicate cohort player-week \(2025:3:8\)/);
});

test('a non-finite identity field in the cohort or baseline rows is rejected at assembly, not coerced', () => {
  const nanCohort = universe();
  nanCohort.preflight.cohortRosterRows[0] = { ...nanCohort.preflight.cohortRosterRows[0], playerId: 'seven' };
  assert.throws(() => inputsAssembly.assembleSweepInputs(nanCohort), /playerId: must coerce to a finite number/);
  const nanBaseline = universe();
  const row = nanBaseline.preflight.matchedOffBaselineRows.find((candidate) => candidate.cellName === 'usage-25-on');
  row.baseline = 'NaN';
  assert.throws(() => inputsAssembly.assembleSweepInputs(nanBaseline), /baseline: must coerce to a finite number/);
});

test('preflight capture arrays are canonicalized: shuffled capture order yields a byte-identical document', () => {
  const shuffled = universe();
  shuffled.preflight.cohortRosterRows.reverse();
  shuffled.preflight.matchedOffBaselineRows.reverse();
  shuffled.preflight.saltSeedRecords.reverse();
  shuffled.preflight.controlUsage25Records.reverse();
  shuffled.preflight.homeAwayStoredRecords.reverse();
  assert.equal(
    canonicalJson(inputsAssembly.assembleSweepInputs(shuffled)),
    canonicalJson(inputsAssembly.assembleSweepInputs(universe()))
  );
});

test('a permutation observation with an unknown salt or out-of-grid week is rejected at the sort boundary', () => {
  const badSalt = universe();
  badSalt.permutationControl.observations.push({ ...badSalt.permutationControl.observations[0], salt: 'pit-99-000000000000' });
  assert.throws(() => inputsAssembly.assembleSweepInputs(badSalt), /not one of the 24 preregistered salts/);
  const stringWeek = universe();
  stringWeek.permutationControl.observations.push({ ...stringWeek.permutationControl.observations[0], week: '7' });
  assert.throws(() => inputsAssembly.assembleSweepInputs(stringWeek), /outside the evaluated grid \(checked uncoerced/);
});

test('orderingSensitivity detail must be a string or null', () => {
  const broken = universe();
  broken.orderingSensitivityByCell['usage-40-on'].detail = 42;
  assert.throws(() => inputsAssembly.assembleSweepInputs(broken), /detail must be a string or null/);
});

test('decision D6: the mirrored sensitivity-audit pass-key list cannot drift from inputsSensitivity\'s own', () => {
  // inputsAssembly cannot import inputsSensitivity (the comparison documents
  // are assembled THROUGH inputsAssembly), so the pass-key list is mirrored
  // and this pin is the drift guard.
  assert.deepEqual([...inputsAssembly.SENSITIVITY_AUDIT_PASS_KEYS], [...inputsSensitivity.SENSITIVITY_PASS_KEYS]);
});

test('decision D6: a sensitivity-audit trail that contradicts its own story is rejected, never assembled', () => {
  // Missing entirely.
  const missing = universe();
  delete missing.sensitivityAudit;
  assert.throws(() => inputsAssembly.assembleSweepInputs(missing), /sensitivityAudit: must be an object/);
  // halted beside winners that agree.
  const launderedHalt = universe();
  launderedHalt.sensitivityAudit.estimandReconciliation.halted = true;
  assert.throws(() => inputsAssembly.assembleSweepInputs(launderedHalt), /halted=true contradicts its own winners/);
  // A selection published despite a halt.
  const haltedSelection = universe();
  haltedSelection.sensitivityAudit.estimandReconciliation.winners.deployedPolicy = 'usage-40-off';
  haltedSelection.sensitivityAudit.estimandReconciliation.halted = true;
  haltedSelection.sensitivityAudit.estimandReconciliation.selection = 'usage-40-off';
  assert.throws(() => inputsAssembly.assembleSweepInputs(haltedSelection), /selection="usage-40-off" contradicts halted=true/);
  // The estimand pass row disagreeing with the reconciliation's own winner.
  const forked = universe();
  forked.sensitivityAudit.winnersByPass['estimand:force-fill'] = 'usage-40-off';
  assert.throws(() => inputsAssembly.assembleSweepInputs(forked), /disagrees with estimandReconciliation.winners.forceFill/);
  // A winner outside the candidate family (the control can never win).
  const controlWinner = universe();
  controlWinner.sensitivityAudit.winnersByPass['ordering:db-collation'] = arms.CONTROL_CELL;
  assert.throws(() => inputsAssembly.assembleSweepInputs(controlWinner), /must be null or a candidate cell name/);
  // An unknown pass key.
  const extraPass = universe();
  extraPass.sensitivityAudit.winnersByPass['ordering:bogus'] = null;
  assert.throws(() => inputsAssembly.assembleSweepInputs(extraPass), /winnersByPass: closed shape violation/);
});

test('saltMean is strict-typeof at its own layer: a quoted number throws instead of concatenating', () => {
  const bySalt = Object.fromEntries(SALTS.map((salt) => [salt, 1]));
  assert.equal(inputsAssembly.saltMean(bySalt), 1);
  bySalt[SALTS[7]] = '1';
  assert.throws(() => inputsAssembly.saltMean(bySalt), /must carry a finite number, got "1"/);
});

test('activation weeks sum to the aggregates the claim path recomputes', () => {
  const inputs = inputsAssembly.assembleSweepInputs(universe());
  // 17 weeks x 1 treated projection per (cell, season, week, position).
  const rows = inputs.evidence.activationWeeks.filter((row) => row.cell === 'usage-25-on' && row.season === '2024' && row.position === 'TE');
  assert.equal(rows.length, EVALUATED_WEEKS.length);
  assert.equal(rows.reduce((sum, row) => sum + row.eligible, 0), EVALUATED_WEEKS.length);
  assert.equal(rows.reduce((sum, row) => sum + row.activated, 0), EVALUATED_WEEKS.length);
  const seasonArray = inputs.cells['usage-25-on'].activation.projectionsByPositionBySeason['2024'].TE;
  assert.equal(seasonArray.length, EVALUATED_WEEKS.length);
});

test('deriveSubgroupDomain: b <= 0 AND prereg-4.1 eligibility (A4 ruling) - a bye or non-macro member with a negative baseline leaves the domain; malformed eligibility fields throw', () => {
  const cellName = 'usage-25-on';
  const rows = [
    { cellName, season: 2025, week: 2, playerId: 7, baseline: -1 },
    { cellName, season: 2025, week: 2, playerId: 8, baseline: -1 },
    { cellName, season: 2025, week: 2, playerId: 9, baseline: -1 },
  ];
  const roster = [
    { season: 2025, week: 2, playerId: 7, position: 'RB', onBye: false },
    { season: 2025, week: 2, playerId: 8, position: 'RB', onBye: true },
    { season: 2025, week: 2, playerId: 9, position: 'FB', onBye: false },
  ];
  const domain = inputsAssembly.deriveSubgroupDomain({
    cohortRosterRows: roster, matchedOffBaselineRows: rows, cellName,
  });
  assert.deepEqual(domain, [{ season: 2025, week: 2, playerId: 7 }],
    'only the macro-position non-bye member stays in the subgroup');
  // Eligibility fields are validated on EVERY roster row, member or not -
  // asserted, never coerced (the fail-open-by-coercion posture).
  const missingFields = [{ season: 2025, week: 2, playerId: 7 }];
  assert.throws(() => inputsAssembly.deriveSubgroupDomain({
    cohortRosterRows: missingFields, matchedOffBaselineRows: rows, cellName,
  }), /string position.*never coerced/);
});
