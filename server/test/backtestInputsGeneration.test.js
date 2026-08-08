const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const inputsGeneration = require('../../scripts/backtest/lib/inputsGeneration');
const inputsAssembly = require('../../scripts/backtest/lib/inputsAssembly');
const inputsSensitivity = require('../../scripts/backtest/lib/inputsSensitivity');
const sweepPreflight = require('../../scripts/backtest/lib/sweepPreflight');
const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const runBacktestSweep = require('../scripts/run-backtest-sweep');

// The REAL production wrapper pieces and the REAL constants, exactly as the
// two increments before this one inject them.
const model = require('../services/projectionModel');
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');

const { SALTS, EVALUATED_WEEKS, MACRO_POSITIONS } = metrics;
const { PRIMARY_SEASON, SAFETY_SEASON, STORED_TWIN_CELL, USAGE25_OFF_CELL } = inputsGeneration;
const SEASONS = [PRIMARY_SEASON, SAFETY_SEASON];
const ON_CELLS = arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on');
/** The fixture roster below: 2 QB, 4 RB, 4 WR, 2 TE, 2 K, 2 DEF. */
const COHORT_SIZE = 16;
// Of those sixteen: ids 5, 10 and 15 always carry a NEGATIVE matched-off
// baseline, id 8 carries b === 0 everywhere (spec 6.3 is `b <= 0`, not
// `b < 0`), and id 3's sign depends on the cell's blend weight - so the
// subgroup domain is DERIVED per cell in the assertions below, never a
// constant the mutants can hide behind (the F-BLIND lesson).

// ---------------------------------------------------------------------------
// Fixtures
//
// One roster of sixteen players per week, deep enough that every macro position
// is pair-eligible (increment 2's one-member-position trap: a shallow bench
// makes `values.pairwise` null everywhere and hides the numeric path).
// ---------------------------------------------------------------------------

function makeRoster({ season, week }) {
  const starters = [];
  const bench = [];
  let id = 1;
  const add = (position, starterSlots, benchCount) => {
    for (const slot of starterSlots) {
      starters.push({ slot, playerId: id, teamKey: `T${id}`, position, isDefense: position === 'DEF' });
      id++;
    }
    for (let i = 0; i < benchCount; i++) {
      bench.push({ playerId: id, teamKey: `T${id}`, position, isDefense: position === 'DEF' });
      id++;
    }
  };
  add('QB', ['QB'], 1);
  add('RB', ['RB', 'RB'], 2);
  add('WR', ['WR', 'WR'], 2);
  add('TE', ['TE'], 1);
  add('K', ['K'], 1);
  add('DEF', ['DEF'], 1);
  const players = [...starters, ...bench].map((p) => ({ ...p }));
  return {
    season, week, replicate: 0, teamIndex: 0, draftSlot: 0, players, starters, bench,
  };
}

function makeWeekArtifacts({ season, week }) {
  const roster = makeRoster({ season, week });
  const rosterWeek = {
    season, week, poolSize: roster.players.length, rosters: [roster],
  };
  const members = [...roster.starters, ...roster.bench].map((p) => ({
    season,
    week,
    gsisId: p.isDefense ? null : `gsis-${p.playerId}`,
    playerId: p.playerId,
    position: p.position,
    team: p.teamKey,
    teamKey: p.teamKey,
    injuryStatus: null,
    onBye: false,
    isDefense: p.isDefense,
    contradiction: null,
  }));
  // Outcomes vary with the week so no week is a copy of another, and with the
  // player so pairwise has a real ordering to be right or wrong about.
  const actualPointsByPlayerId = new Map(members.map((m) => [
    m.playerId, Number((m.playerId * 1.1 + ((m.playerId * week) % 7) - 2).toFixed(2)),
  ]));
  return {
    rosterWeek,
    cohortWeek: {
      season, week, members, actualPointsByPlayerId,
    },
    positionRank: new Map(MACRO_POSITIONS.map((position, index) => [position, index + 1])),
    nameRankById: new Map(members.map((m) => [m.playerId, m.playerId])),
  };
}

function makeWeekArtifactMap() {
  const map = new Map();
  for (const season of SEASONS) {
    for (const week of EVALUATED_WEEKS) map.set(`${season}:${week}`, makeWeekArtifacts({ season, week }));
  }
  return map;
}

const SCORING_HASHES = Object.freeze({ half_ppr: 'a1b2c3', standard: 'd4e5f6', ppr: '0a1b2c' });
const INPUT_CUTOFF = '2025-09-01T00:00:00.000Z';
const SOURCE_COVERAGE = Object.freeze({ synthetic: true });

/**
 * The subgroup (spec 6.3: `b <= 0` in the matched off cell) VARIES BY CELL
 * and `b` VARIES WITH THE BLEND WEIGHT - so a driver that captured every on
 * cell's baseline from the CONTROL's off cell instead of from its own
 * matched off cell would produce a numerically different DOMAIN, not merely
 * different values. (Increment 1's QA lesson, sharpened by the increment-3
 * mutation sweep: a sign that depends only on `playerId % 5` made the
 * subgroup one constant across all 8 cells x 2 seasons x 17 weeks, and
 * membership-from-the-wrong-cell survived 32/32 tests.) Player 8's b === 0
 * makes the `b <= 0` vs `b < 0` boundary decidable; player 3's sign flips
 * with the blend weight so membership itself discriminates the cells.
 */
function baselineFor({ blendWeight, season, week, playerId }) {
  const magnitude = 1 + ((playerId % 7) * 0.5) + (blendWeight * 2) + ((week % 5) * 0.1) + (season === SAFETY_SEASON ? 0.25 : 0);
  if (playerId === 8) return 0;
  if (playerId === 3) return blendWeight >= 0.4 ? -magnitude : magnitude;
  return playerId % 5 === 0 ? -magnitude : magnitude;
}

const HOME_AWAY_EFFECT = 0.03;

/**
 * The injected generator. It is a PURE function of the arguments the driver
 * passes, which is what makes the two sealed identity assertions true of it:
 * the independent control arm and the `usage-25 x off` cell receive identical
 * constants and hashValue, so they are bit-identical; the `on` and
 * `on-stored` arms differ only in `homeAway.useStoredHistory`, which this
 * generator never reads - the same no-op section 8.6.1 exists to verify
 * against real data.
 */
function makeGenerator({ mutate = null } = {}) {
  const calls = [];
  const generate = async ({ scoringProfile, season, week, playerIds, hashValue, modelConstants, weatherService, onPreHomeAwayBaseline }) => {
    const blendWeight = modelConstants.usage.blendWeight;
    const homeAwayOn = modelConstants.homeAway.enabled === true;
    const saltIndex = SALTS.indexOf(String(hashValue).split(':')[1]);
    assert.ok(saltIndex >= 0, 'the driver must salt the hashValue with a preregistered salt');
    assert.equal(String(hashValue).split(':')[0], SCORING_HASHES[scoringProfile], 'the driver must salt the profile\'s OWN scoring hash');
    assert.equal(weatherService, false, 'the driver must pass weatherService: false on every call (QA A5): the audit operand records the flag, so it must describe an input that was actually sent');
    const profileOffset = { half_ppr: 0, standard: -0.4, ppr: 0.6 }[scoringProfile];
    calls.push({ scoringProfile, season, week, hashValue, blendWeight, homeAwayOn, useStoredHistory: modelConstants.homeAway.useStoredHistory === true });

    const projections = new Map();
    for (const playerId of playerIds) {
      const baseline = baselineFor({ blendWeight, season, week, playerId });
      if (onPreHomeAwayBaseline) {
        onPreHomeAwayBaseline({ playerId, position: 'RB', season, week, blendWeight, baseline });
      }
      // The salt moves the median (it is the simulation seed) but never the
      // baseline, which is resolved before the draw - the invariance the
      // driver checks.
      // toFixed(4), NOT toFixed(2): a 2dp fixture median makes the module's
      // round2-at-the-error-boundary the identity, which is exactly the
      // claim the boundary exists to protect (F-BLIND). And the season term
      // means 2024 is not a relabelling of 2025.
      const median = Number((
        (playerId * 1.1)
        + (homeAwayOn ? baseline * HOME_AWAY_EFFECT : 0)
        + (blendWeight * 0.8)
        + (saltIndex * 0.01)
        + profileOffset
        + ((week % 4) * 0.05)
        + (season === SAFETY_SEASON ? 0.07 : 0)
      ).toFixed(4));
      projections.set(playerId, {
        playerId,
        median,
        mean: median,
        p10: median - 2,
        p25: median - 1,
        p75: median + 1,
        p90: median + 2,
        sampleSize: 8,
        eligible: true,
        neutralSite: false,
        knownOrientation: true,
        factors: {
          homeAway: homeAwayOn
            ? { available: true, effect: HOME_AWAY_EFFECT, pointsContribution: Number((baseline * HOME_AWAY_EFFECT).toFixed(2)) }
            : { available: false, effect: 0, pointsContribution: 0 },
        },
      });
    }
    const run = { projections, inputCutoff: INPUT_CUTOFF, sourceCoverage: SOURCE_COVERAGE };
    return mutate ? mutate(run, { scoringProfile, season, week, hashValue, modelConstants, saltIndex, onPreHomeAwayBaseline }) : run;
  };
  return { generate, calls };
}

/** FNV-1a over the exact tuple `model.seedFrom` consumes - deterministic, and distinct across the 24 salts. */
function seedFor({ hashValue, season, week, playerId }) {
  let hash = 2166136261;
  for (const character of `${hashValue}:${season}:${week}:${playerId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The benchmarks (prereg 7.2): no intervals, so coverage/WIS score null with published exclusion counts. */
async function benchmarkProjectionsFor({ season, week, playerIds }) {
  const build = (scale) => new Map(playerIds.map((playerId) => [playerId, {
    // week * 0.13, not (week % 3): 2 % 3 === 5 % 3, and a degenerate week
    // term let a benchmark scored from another week's projections survive.
    playerId, median: Number((playerId * scale + (week * 0.13)).toFixed(2)), p10: null, p25: null, p75: null, p90: null, factors: {},
  }]));
  return {
    'naive-recency': build(0.9),
    'usage-signal': build(1.3),
  };
}

function baseArgs(overrides = {}) {
  return {
    weekArtifacts: makeWeekArtifactMap(),
    baseConstants: model.MODEL_CONSTANTS,
    scoringHashFor: (profile) => SCORING_HASHES[profile],
    generate: makeGenerator().generate,
    seedFor,
    benchmarkProjectionsFor,
    availabilityFor,
    optimize: optimalAssignment,
    ...overrides,
  };
}

/** The primary profile alone - the whole capture surface, at a third of the grid's cost. */
function primaryOnly(overrides = {}) {
  return baseArgs({ profiles: [inputsGeneration.GENERATION_PROFILES[0]], ...overrides });
}

// The full-grid production is expensive enough (14,688 generations, 13,056
// arm-week evaluations) to be worth computing ONCE and asserting against many
// times, so the suite pays for it once rather than per test.
let fullGridPromise = null;
function fullGrid() {
  if (!fullGridPromise) fullGridPromise = inputsGeneration.generateSweepInputRecords(baseArgs());
  return fullGridPromise;
}

function syntheticPermutationControl() {
  const pid = (position, n) => MACRO_POSITIONS.indexOf(position) * 100 + n;
  const everyPlayer = MACRO_POSITIONS.flatMap((position) => [pid(position, 1), pid(position, 2)]);
  const byWeek = (build) => Object.fromEntries(EVALUATED_WEEKS.map((week) => [week, build(week)]));
  return {
    rosterRows: EVALUATED_WEEKS.flatMap((week) => MACRO_POSITIONS.flatMap((position) => [
      { season: PRIMARY_SEASON, week, position, playerId: pid(position, 1) },
      { season: PRIMARY_SEASON, week, position, playerId: pid(position, 2) },
    ])),
    observations: SALTS.flatMap((salt) => EVALUATED_WEEKS.flatMap((week) => MACRO_POSITIONS.flatMap((position) => [
      { season: PRIMARY_SEASON, week, salt, position, playerId: pid(position, 1), actual: 1, projected: 1 },
      { season: PRIMARY_SEASON, week, salt, position, playerId: pid(position, 2), actual: 0, projected: 0 },
    ]))),
    rosterWeeks: byWeek(() => ({
      rosters: [{ replicate: 1, teamIndex: 0, starters: [], bench: everyPlayer.map((playerId) => ({ playerId })) }],
    })),
    cohortWeeks: byWeek(() => ({
      members: MACRO_POSITIONS.flatMap((position) => [1, 2].map((n) => ({
        playerId: pid(position, n), position, teamKey: `T${pid(position, n)}`, injuryStatus: null, onBye: false,
      }))),
    })),
    positionRank: Object.fromEntries(MACRO_POSITIONS.map((position, index) => [position, index + 1])),
    nameRankById: Object.fromEntries(everyPlayer.map((playerId) => [playerId, playerId])),
  };
}

/**
 * The two inputs increment 3 deliberately does NOT produce (see the module
 * docblock's scope note): the permutation control belongs to increment 4, and
 * the ordering-sensitivity verdicts are a second full reducer pass that
 * belongs to the entrypoint owning both.
 */
function assembleFrom(records) {
  return inputsAssembly.assembleSweepInputs({
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    orderingDisagreement: false,
    deployedPolicyDisagreement: false,
    armWeekMetrics: records.armWeekMetrics,
    subgroupErrorRows: records.subgroupErrorRows,
    activationRecords: records.activationRecords,
    orderingSensitivityByCell: Object.fromEntries(arms.SELECTION_FAMILY.map((cell) => [cell.name, { contradicted: false, detail: null }])),
    preflight: records.preflight,
    permutationControl: syntheticPermutationControl(),
  });
}

// ---------------------------------------------------------------------------
// The plan (section 9's sealed table)
// ---------------------------------------------------------------------------

test('the generation plan is section 9\'s grid, arm by arm, and totals 14,688', () => {
  const plan = inputsGeneration.buildGenerationPlan();
  assert.equal(plan.length, inputsGeneration.GRID_TOTAL);
  assert.equal(plan.length, 14688);

  const count = (predicate) => plan.filter(predicate).length;
  const primary = inputsGeneration.GENERATION_PROFILES[0];
  assert.equal(count((row) => row.scoringProfile === primary && row.kind === 'cell'), 6528, '8 cells x 24 salts x 34 season-weeks');
  assert.equal(count((row) => row.kind === 'stored-twin'), 816, 'the homeaway-on-stored twin is 24 x 34');
  assert.equal(count((row) => row.kind === 'independent-control'), 816, 'the independently generated control arm is 24 x 34');
  assert.equal(count((row) => row.scoringProfile !== primary), 6528, '2 sensitivity profiles x 8 cells x 24 salts x 17 weeks');

  // The invariant section 9 states about its own table.
  assert.equal(count((row) => row.scoringProfile !== primary), count((row) => row.scoringProfile === primary && row.kind === 'cell'));
  // Sensitivity generation is 2025-only; the twin and the independent control exist only under the primary profile.
  assert.equal(count((row) => row.scoringProfile !== primary && row.season !== PRIMARY_SEASON), 0);
  assert.equal(count((row) => row.kind !== 'cell' && row.scoringProfile !== primary), 0);
});

test('the two identity assertions are pinned to the cells the sealed text names', () => {
  // 8.6.1: the pair is "the shipped-usage (usage-25) `on` cell's pair,
  // specifically" - not any of the three other usage levels' analogous pairs,
  // which the spec explicitly does NOT adopt.
  assert.equal(STORED_TWIN_CELL, arms.cellName({ blendWeight: 0.25, homeAway: 'on' }));
  // 8.6.0: the right-hand side is the `usage-25 x off` cell, which IS the
  // control's own coordinate - which is exactly why the LEFT side has to be
  // generated independently rather than read off the same cell.
  assert.equal(USAGE25_OFF_CELL, arms.CONTROL_CELL);
});

test('neither identity-assertion arm can enter the document\'s arm vocabulary', () => {
  const evaluation = { season: PRIMARY_SEASON, week: 5, values: Object.fromEntries(metrics.METRIC_KEYS ? [] : []) };
  for (const arm of [inputsGeneration.STORED_TWIN_ARM, inputsGeneration.INDEPENDENT_CONTROL_ARM]) {
    assert.ok(!arms.ALL_CELLS.some((cell) => cell.name === arm));
    assert.ok(!inputsAssembly.BENCHMARK_ARMS.includes(arm));
    assert.throws(
      () => require('../../scripts/backtest/lib/armWeekEvaluator').toArmWeekMetricsRecord({
        scoringProfile: 'half_ppr', arm, salt: SALTS[0], evaluation,
      }),
      /is not one of the 8 cells or the 2 benchmark arms/,
      `${arm} must be rejected by the record composer`
    );
  }
});

test('the driver is structurally incapable of generating a projection or opening a snapshot', () => {
  // Gate 0 is enforced by the REQUIRE GRAPH, not by intention: this is the
  // module most likely to grow a real dependency, because it is the one whose
  // whole job is to drive the harness. `generate` is a parameter; the day it
  // becomes a require, this test says so.
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'inputsGeneration.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const requires = [...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
  assert.deepEqual(
    requires.sort(),
    ['./armWeekEvaluator', './arms', './freezeManifest', './inputsAssembly', './inputsSensitivity', './metrics', './numbers', './sweepPreflight'],
    'pure computation only - no fs, no path, no database driver, and nothing under server/services'
  );
  // Named as CALL shapes, not bare substrings: the module names
  // `generateProjections` and `onPreHomeAwayBaseline` in its error messages
  // on purpose, and a diagnostic that tells the operator which production
  // seam their wiring dropped is exactly what should survive this check.
  for (const forbidden of [
    /\bgenerateProjections\s*\(/, /\bprojectPoints\s*\(/, /\bsnapshotClientLib?\b/, /\bsnapshotStore\b/,
    /\breadFileSync\s*\(/, /\bprocess\.env\b/, /\bMath\.random\s*\(/, /\bDate\.now\s*\(/, /server\/services/,
  ]) {
    assert.ok(!forbidden.test(code), `inputsGeneration.js must not reference ${forbidden}`);
  }
});

test('round2 is pinned to production\'s, not merely similar to it', () => {
  const vector = [0, 1, -1, 0.005, 0.015, 1.005, 2.675, -2.675, 12.344999, 12.345001, 1e-9, -1e-9, 1234.5678];
  for (const value of vector) {
    assert.equal(
      inputsGeneration.round2(value), model.round2(value),
      `round2(${value}) must match production's byte-for-byte; the lib layer may not require server/services, so this replication is the only thing holding them together`
    );
  }
});

// ---------------------------------------------------------------------------
// The flagship: generated records -> assembled document -> the approved reducer
// ---------------------------------------------------------------------------

test('the driver\'s records assemble into a document the approved reducer validates and reduces to a non-void run', async () => {
  const records = await fullGrid();

  // Increment 5: the sensitivity comparison passes run against the REAL
  // reducer's exported claim assembly. This universe is deliberately tie-free
  // and all-positive, so every pass reproduces the primary's verdicts and
  // winner exactly - nothing contradicted, neither disagreement - and the
  // discriminating fixtures (where the knobs DO move regret) live in their
  // own test below.
  const sensitivity = inputsSensitivity.deriveSensitivityInputs({
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    records,
    permutationControl: syntheticPermutationControl(),
    reducer: runBacktestSweep,
  });
  for (const cell of arms.SELECTION_FAMILY) {
    assert.deepEqual(sensitivity.orderingSensitivityByCell[cell.name], { contradicted: false, detail: null });
  }
  assert.equal(sensitivity.orderingDisagreement, false);
  assert.equal(sensitivity.deployedPolicyDisagreement, false);

  // The FINAL document carries the DERIVED sensitivity inputs - the complete
  // producer path, end to end.
  const inputs = inputsAssembly.assembleSweepInputs({
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    orderingDisagreement: sensitivity.orderingDisagreement,
    deployedPolicyDisagreement: sensitivity.deployedPolicyDisagreement,
    armWeekMetrics: records.armWeekMetrics,
    subgroupErrorRows: records.subgroupErrorRows,
    activationRecords: records.activationRecords,
    orderingSensitivityByCell: sensitivity.orderingSensitivityByCell,
    preflight: records.preflight,
    permutationControl: syntheticPermutationControl(),
  });
  runBacktestSweep.validateInputs(inputs);

  const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
  assert.notEqual(report.run.status, 'void', `a complete, self-consistent generation must not void the harness: ${JSON.stringify(report.run)}`);
  // A void run publishes no cells at all, so a 'valid' status with no
  // reasons IS the statement that the canaries, both sealed identity
  // assertions and the salt-collision guard all held (sweepInference's
  // void-forcing set) - the per-assertion detail is checked directly against
  // the preflight in the next test.
  assert.equal(report.run.status, 'valid');
  assert.deepEqual(report.run.reasons, []);
  const byCell = Object.fromEntries(report.cells.map((cell) => [cell.name, cell]));
  assert.equal(byCell[arms.CONTROL_CELL].verdict, 'baseline');
  for (const cell of arms.SELECTION_FAMILY) {
    assert.ok(byCell[cell.name], `${cell.name} must receive a verdict`);
    assert.ok(['pass', 'fail', 'inconclusive', 'vetoed'].includes(byCell[cell.name].verdict), `${cell.name}: ${byCell[cell.name].verdict}`);
  }
});

test('the produced preflight passes the reducer\'s own preflight, assertion by assertion', async () => {
  const records = await fullGrid();
  const inputs = assembleFrom(records);
  const result = sweepPreflight.runPreflight({
    ...inputs.preflight,
    componentFVetoRecords: runBacktestSweep.componentFVetoRecords(inputs.cells, inputs.preflight),
  });
  assert.equal(result.passed, true, JSON.stringify(runBacktestSweep.preflightFailureDetails(result)));
  assert.equal(result.identities.controlUsage25.passed, true);
  assert.equal(result.identities.homeAwayStored.passed, true);
  assert.equal(result.saltSeeds.passed, true);
  assert.equal(result.componentFVeto.passed, true);
});

test('generation is deterministic: two independent runs produce byte-identical documents', async () => {
  const first = await inputsGeneration.generateSweepInputRecords(primaryOnly());
  const second = await inputsGeneration.generateSweepInputRecords(primaryOnly());
  assert.equal(canonicalJson(first.counts), canonicalJson(second.counts));
  assert.equal(canonicalJson(first.armWeekMetrics), canonicalJson(second.armWeekMetrics));
  assert.equal(canonicalJson(first.subgroupErrorRows), canonicalJson(second.subgroupErrorRows));
  assert.equal(canonicalJson(first.preflight.matchedOffBaselineRows), canonicalJson(second.preflight.matchedOffBaselineRows));
  assert.equal(canonicalJson(first.preflight.saltSeedRecords), canonicalJson(second.preflight.saltSeedRecords));
});

// ---------------------------------------------------------------------------
// Cardinalities, coordinate by coordinate
// ---------------------------------------------------------------------------

test('the record counts are the grid\'s, and the two never-scored arms are generated but never published', async () => {
  const records = await fullGrid();
  const weeks = EVALUATED_WEEKS.length;

  assert.equal(records.counts.generations, inputsGeneration.GRID_TOTAL, 'every plan coordinate must have reached the generator exactly once');
  // 8 cells x 24 salts x 34 weeks (primary) + 2 benchmarks x 24 salts x 34 weeks + 8 cells x 24 salts x 17 weeks x 2 profiles.
  assert.equal(records.counts.armWeekMetrics, (8 * 24 * weeks * 2) + (2 * 24 * weeks * 2) + (8 * 24 * weeks * 2));
  const publishedArms = new Set(records.armWeekMetrics.map((row) => row.arm));
  assert.ok(!publishedArms.has(inputsGeneration.STORED_TWIN_ARM));
  assert.ok(!publishedArms.has(inputsGeneration.INDEPENDENT_CONTROL_ARM));
  assert.equal(publishedArms.size, 10, 'the 8 cells and the 2 benchmarks, and nothing else');

  assert.equal(records.counts.cohortRosterRows, COHORT_SIZE * weeks * 2, 'the cohort domain is a property of the season-week; the sensitivity profiles must not re-append 2025');
  assert.equal(records.counts.controlUsage25Records, 24 * weeks * 2);
  assert.equal(records.counts.homeAwayStoredRecords, 24 * weeks * 2);
  assert.equal(records.counts.saltSeedRecords, 8 * COHORT_SIZE * weeks * 2);
  assert.equal(records.counts.matchedOffBaselineRows, ON_CELLS.length * COHORT_SIZE * weeks * 2);
  // The subgroup domain is DERIVED from baselineFor per cell (its sign
  // depends on playerId AND blendWeight, never on week or season), so a
  // driver reading membership from the wrong cell's baseline map changes
  // this count rather than being invisible to it.
  const ALL_IDS = Array.from({ length: COHORT_SIZE }, (u, i) => i + 1);
  const expectedSubgroup = ON_CELLS.reduce((sum, c) => sum
    + ALL_IDS.filter((pid) => baselineFor({ blendWeight: c.blendWeight, season: PRIMARY_SEASON, week: 2, playerId: pid }) <= 0).length, 0);
  assert.equal(records.counts.subgroupErrorRows, expectedSubgroup * weeks * 2 * SALTS.length);
});

test('the sensitivity profiles carry the 8 cells for 2025 only, and no benchmark', async () => {
  const records = await fullGrid();
  for (const row of records.armWeekMetrics) {
    if (row.scoringProfile === 'half_ppr') continue;
    assert.equal(row.season, PRIMARY_SEASON, 'section 8.7 rule 4: sensitivity generation is 2025-only');
    assert.ok(arms.ALL_CELLS.some((cell) => cell.name === row.arm), 'sensitivity profiles cover the 8 cells only');
  }
  const benchmarkSeasons = new Set(records.armWeekMetrics.filter((row) => inputsAssembly.BENCHMARK_ARMS.includes(row.arm)).map((row) => row.season));
  assert.deepEqual([...benchmarkSeasons].sort(), [SAFETY_SEASON, PRIMARY_SEASON].sort());
});

test('the sensitivity profiles are scored against the PRIMARY profile\'s outcome truth (risk C, pinned deliberately)', async () => {
  // Section 9 makes the scoring profile a generation coordinate on the
  // FEATURE side. The OUTCOME side is a frozen Commit-A artifact:
  // `run-backtest-rosters.js` prices `actualPointsByPlayerId` once through
  // `SCORING_RULES`, and a cohort artifact carries exactly one such map - so
  // a `standard` arm-week's regret is a lineup chosen on standard-priced
  // projections, measured in half-PPR points. The driver has no other
  // behaviour available to it, and this test exists so that if the B3
  // deferral batch answers the question the other way, a TEST changes rather
  // than a silence.
  const records = await fullGrid();
  const season = PRIMARY_SEASON;
  const week = 6;
  const salt = SALTS[0];
  const cell = arms.ALL_CELLS.find((c) => c.name === arms.CONTROL_CELL);
  const published = records.armWeekMetrics.find((row) => row.scoringProfile === 'standard'
    && row.arm === cell.name && row.season === season && row.week === week && row.salt === salt);
  assert.ok(published, 'the standard profile must carry this arm-week');

  // Re-score the same standard-profile projections against the artifact's own
  // (half-PPR) actuals. Equality is the statement that no re-pricing happened.
  const artifacts = makeWeekArtifacts({ season, week });
  const projections = new Map(artifacts.cohortWeek.members.map((member) => {
    const baseline = baselineFor({ blendWeight: cell.blendWeight, season, week, playerId: member.playerId });
    const median = Number((
      (member.playerId * 1.1) + (cell.homeAway === 'on' ? baseline * HOME_AWAY_EFFECT : 0)
      + (cell.blendWeight * 0.8) + (SALTS.indexOf(salt) * 0.01) + (-0.4) + ((week % 4) * 0.05)
    ).toFixed(4));
    return [member.playerId, {
      playerId: member.playerId, median, p10: median - 2, p25: median - 1, p75: median + 1, p90: median + 2, factors: {},
    }];
  }));
  const rescored = require('../../scripts/backtest/lib/armWeekEvaluator').evaluateArmWeek({
    season,
    week,
    rosterWeek: artifacts.rosterWeek,
    cohortWeek: artifacts.cohortWeek,
    projectionsByPlayerId: projections,
    positionRank: artifacts.positionRank,
    nameRankById: artifacts.nameRankById,
    availabilityFor,
    optimize: optimalAssignment,
  });
  assert.deepEqual(published.values, rescored.values);
  // ...and the standard profile really is a different generation, not a
  // relabelled half_ppr one - otherwise the pin above would be vacuous.
  const primaryRow = records.armWeekMetrics.find((row) => row.scoringProfile === 'half_ppr'
    && row.arm === cell.name && row.season === season && row.week === week && row.salt === salt);
  assert.notEqual(canonicalJson(primaryRow.values), canonicalJson(published.values));
});

test('a benchmark arm-week is evaluated once and published under all 24 salts, identically', async () => {
  const records = await fullGrid();
  for (const arm of inputsAssembly.BENCHMARK_ARMS) {
    const week = records.armWeekMetrics.filter((row) => row.arm === arm && row.season === PRIMARY_SEASON && row.week === 5);
    assert.equal(week.length, SALTS.length);
    const values = new Set(week.map((row) => canonicalJson(row.values)));
    assert.equal(values.size, 1, `${arm} has no simulation draw for a salt to vary, so its 24 salt records must be one value (determination 4)`);
    // ...and the interval-free shape must reach the document as an honest null, not a fabricated band.
    assert.equal(week[0].values.coverage, null);
    assert.equal(week[0].values.wis, null);
    assert.ok(Number.isFinite(week[0].values.regret));
  }
});

// ---------------------------------------------------------------------------
// The captures, each discriminated against the plausible wrong answer
// ---------------------------------------------------------------------------

test('every baseline row is labelled with its ON cell but carries the MATCHED OFF cell\'s b', async () => {
  const records = await fullGrid();
  const rows = records.preflight.matchedOffBaselineRows.filter((row) => row.season === PRIMARY_SEASON && row.week === 7);
  assert.equal(rows.length, ON_CELLS.length * COHORT_SIZE);
  for (const row of rows) {
    const cell = ON_CELLS.find((c) => c.name === row.cellName);
    const expected = baselineFor({ blendWeight: cell.blendWeight, season: PRIMARY_SEASON, week: 7, playerId: row.playerId });
    assert.equal(row.baseline, expected, `${row.cellName}/${row.playerId} must carry the b captured in its own matched off cell`);
    // The discrimination: the CONTROL's off cell is the plausible wrong
    // source, and for every cell whose blend weight is not 0.25 it yields a
    // different number.
    // Player 8's b === 0 is deliberately identical in every cell (a zero has
    // no magnitude to vary), so the source discrimination skips it.
    if (cell.blendWeight !== arms.CONTROL_BLEND_WEIGHT && row.playerId !== 8) {
      const wrong = baselineFor({ blendWeight: arms.CONTROL_BLEND_WEIGHT, season: PRIMARY_SEASON, week: 7, playerId: row.playerId });
      assert.notEqual(expected, wrong, 'the fixture must be able to tell the two sources apart');
      assert.notEqual(row.baseline, wrong);
    }
  }
});

test('subgroup error rows pair the on and off cells at the SAME salt, over round2 medians', async () => {
  const records = await fullGrid();
  const cell = ON_CELLS.find((c) => c.blendWeight === 0.6);
  const offName = arms.cellName({ blendWeight: cell.blendWeight, homeAway: 'off' });
  const rows = records.subgroupErrorRows.filter((row) => row.cellName === cell.name && row.season === PRIMARY_SEASON && row.week === 9);
  assert.ok(rows.length > 0);
  const artifacts = makeWeekArtifacts({ season: PRIMARY_SEASON, week: 9 });

  for (const row of rows) {
    assert.ok(
      baselineFor({ blendWeight: cell.blendWeight, season: PRIMARY_SEASON, week: 9, playerId: row.playerId }) <= 0,
      'membership is b <= 0 in the MATCHED off cell'
    );
    const actual = artifacts.cohortWeek.actualPointsByPlayerId.get(row.playerId);
    const saltIndex = SALTS.indexOf(row.salt);
    const medianFor = (homeAwayOn) => {
      const baseline = baselineFor({ blendWeight: cell.blendWeight, season: PRIMARY_SEASON, week: 9, playerId: row.playerId });
      return Number((
        (row.playerId * 1.1) + (homeAwayOn ? baseline * HOME_AWAY_EFFECT : 0)
        + (cell.blendWeight * 0.8) + (saltIndex * 0.01) + 0 + ((9 % 4) * 0.05)
      ).toFixed(4));
    };
    assert.equal(row.errorOn, inputsGeneration.round2(medianFor(true)) - actual);
    assert.equal(row.errorOff, inputsGeneration.round2(medianFor(false)) - actual);
    // A cross-salt pairing is the plausible wrong answer, and the fixture
    // moves the median with the salt so it produces a different number.
    if (saltIndex > 0) {
      const wrongSaltMedian = medianFor(false) - 0.01;
      assert.notEqual(inputsGeneration.round2(medianFor(false)) - actual, inputsGeneration.round2(wrongSaltMedian) - actual);
    }
    assert.equal(offName, arms.cellName({ blendWeight: cell.blendWeight, homeAway: 'off' }));
  }
  // Exact coverage: the derived domain x the 24 salts, no more and no less -
  // and the domain is asserted POSITIVELY against baselineFor's own rule, so
  // a membership read from the wrong cell's baseline map changes the set
  // rather than passing on cardinality alone. b === 0 (player 8) is IN.
  const domain = new Set(rows.map((row) => row.playerId));
  assert.equal(rows.length, domain.size * SALTS.length);
  const expectedDomain = Array.from({ length: COHORT_SIZE }, (u, i) => i + 1)
    .filter((pid) => baselineFor({ blendWeight: cell.blendWeight, season: PRIMARY_SEASON, week: 9, playerId: pid }) <= 0);
  assert.deepEqual([...domain].sort((a, b) => a - b), expectedDomain, 'the domain must come from THIS cell\'s matched off cell, and b === 0 is a member');
});

test('activation counts are per player, not per salt, and come from the reference salt', async () => {
  const records = await fullGrid();
  const cell = ON_CELLS[0];
  const record = records.activationRecords.find((row) => row.cell === cell.name && row.season === PRIMARY_SEASON && row.week === 4 && row.position === 'RB');
  assert.ok(record, 'every on cell x season x week x macro position gets a record');
  // Four RBs on the fixture roster (2 starters + 2 bench) - NOT 4 x 24.
  assert.equal(record.projections.length, 4);
  const report = arms.activationReport({
    projectionsByPosition: Object.fromEntries(MACRO_POSITIONS.map((position) => [position,
      records.activationRecords.find((row) => row.cell === cell.name && row.season === PRIMARY_SEASON && row.week === 4 && row.position === position).projections])),
  });
  assert.equal(report.verdict, 'treated', 'an on cell whose homeAway factor is available with a non-zero effect everywhere must read as treated');
  assert.equal(report.byPosition.RB.eligible, 4);
  assert.equal(report.byPosition.RB.activated, 4);
  // The off cells receive no activation record at all (prereg 11 scopes the
  // question to the treated arms).
  assert.equal(records.activationRecords.filter((row) => !ON_CELLS.some((c) => c.name === row.cell)).length, 0);
});

test('the identity records hold this salt\'s two runs, and the control is a genuinely separate object', async () => {
  const records = await fullGrid();
  for (const record of records.preflight.controlUsage25Records) {
    assert.notEqual(record.leftRun, record.rightRun, 'section 9: reusing the usage-25 x off output as "the control" compares an object against itself and proves nothing');
    assert.equal(canonicalJson([...record.leftRun.projections.entries()]), canonicalJson([...record.rightRun.projections.entries()]), 'independently generated, and bit-identical - which is the assertion');
  }
  for (const record of records.preflight.homeAwayStoredRecords) {
    assert.notEqual(record.leftRun, record.rightRun);
    arms.assertOnlyStoredHistoryLeafDiffers({
      baseResolved: record.leftConstants, storedResolved: record.rightConstants, label: 'stored twin record',
    });
  }
  // The generator saw both extra arms: 816 stored-history calls and 816 more
  // control-constant calls than the primary grid alone contains.
  const { generate, calls } = makeGenerator();
  await inputsGeneration.generateSweepInputRecords(primaryOnly({ generate, weekArtifacts: new Map([['2025:2', makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 })]]), profiles: [] }));
  assert.equal(calls.length, 0, 'an empty profile list generates nothing - the loop is driven by the plan, not by a hardcoded arm list');
});

test('the salt-seed records cover 8 cells x every cohort player-week, with 24 distinct seeds each', async () => {
  const records = await fullGrid();
  const one = records.preflight.saltSeedRecords.find((row) => row.season === PRIMARY_SEASON && row.week === 3 && row.playerId === 6);
  assert.equal(Object.keys(one.seedsBySalt).length, SALTS.length);
  assert.equal(new Set(Object.values(one.seedsBySalt)).size, SALTS.length);
  for (const salt of SALTS) {
    assert.equal(one.seedsBySalt[salt], seedFor({
      hashValue: arms.composeSaltedHashValue({ scoringHash: SCORING_HASHES.half_ppr, salt }), season: PRIMARY_SEASON, week: 3, playerId: 6,
    }));
  }
  const cells = records.preflight.saltSeedRecords
    .filter((row) => row.season === PRIMARY_SEASON && row.week === 3 && row.playerId === 6)
    .map((row) => row.cellName);
  assert.deepEqual(cells.sort(), arms.ALL_CELLS.map((cell) => cell.name).sort());
});

// ---------------------------------------------------------------------------
// Fail-closed: each of these is a defect of the RUN, named at the coordinate
// that produced it rather than three layers downstream
// ---------------------------------------------------------------------------

/** One 2025 week only - enough to reach every capture, cheap enough to run a dozen negative cases against. */
function oneWeek(overrides = {}) {
  return primaryOnly({
    weekArtifacts: new Map([[`${PRIMARY_SEASON}:2`, makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 })]]),
    ...overrides,
  });
}

/** The driver walks the whole 17-week grid, so a one-week artifact map fails on week 3 - after every week-2 capture has run. */
async function runOneWeek(overrides = {}) {
  return inputsGeneration.generateSweepInputRecords(oneWeek(overrides));
}

test('a generator that never forwards onPreHomeAwayBaseline is named, not tolerated as an empty subgroup', async () => {
  const generate = async (args) => {
    const { generate: inner } = makeGenerator();
    return inner({ ...args, onPreHomeAwayBaseline: undefined });
  };
  await assert.rejects(runOneWeek({ generate }), /the generator did not forward onPreHomeAwayBaseline into generateProjections/);
});

test('a baseline reporting a different blendWeight than the cell being generated is rejected', async () => {
  const { generate: inner } = makeGenerator();
  const generate = async (args) => inner({
    ...args,
    onPreHomeAwayBaseline: args.onPreHomeAwayBaseline
      ? (row) => args.onPreHomeAwayBaseline({ ...row, blendWeight: 0.99 })
      : undefined,
  });
  await assert.rejects(runOneWeek({ generate }), /the resolved constants did not reach the model, so this baseline belongs to a different cell/);
});

test('a baseline that moves between salts is rejected: the salt varies the seed, never the model', async () => {
  const { generate: inner } = makeGenerator();
  const generate = async (args) => {
    const saltIndex = SALTS.indexOf(String(args.hashValue).split(':')[1]);
    return inner({
      ...args,
      onPreHomeAwayBaseline: args.onPreHomeAwayBaseline
        ? (row) => args.onPreHomeAwayBaseline({ ...row, baseline: row.baseline + saltIndex * 1e-9 })
        : undefined,
    });
  };
  await assert.rejects(runOneWeek({ generate }), /baseline moved between salts/);
});

test('a cohort player-week whose projection never reached the homeAway step is named with its count', async () => {
  const { generate: inner } = makeGenerator();
  const generate = async (args) => inner({
    ...args,
    onPreHomeAwayBaseline: args.onPreHomeAwayBaseline
      ? (row) => { if (row.playerId !== 4) args.onPreHomeAwayBaseline(row); }
      : undefined,
  });
  await assert.rejects(runOneWeek({ generate }), /1 of 16 cohort player-weeks produced no pre-homeAway baseline/);
});

test('a doubled onPreHomeAwayBaseline call cannot last-wins its way into a different membership', async () => {
  const { generate: inner } = makeGenerator();
  const generate = async (args) => inner({
    ...args,
    onPreHomeAwayBaseline: args.onPreHomeAwayBaseline
      ? (row) => { args.onPreHomeAwayBaseline(row); if (row.playerId === 5) args.onPreHomeAwayBaseline({ ...row, baseline: 1 }); }
      : undefined,
  });
  await assert.rejects(runOneWeek({ generate }), /fired twice for playerId 5/);
});

test('a duplicate cohort playerId is rejected before any run is generated, never deduplicated', async () => {
  const artifacts = makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 });
  artifacts.cohortWeek.members.push({ ...artifacts.cohortWeek.members[3] });
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(primaryOnly({ weekArtifacts: new Map([[`${PRIMARY_SEASON}:2`, artifacts]]) })),
    /a duplicate raw id must be rejected before any run is generated/
  );
});

test('a salt-seed collision aborts generation at the coordinate, not hours later in the reducer', async () => {
  const collide = ({ hashValue, season, week, playerId }) => (playerId === 3
    ? 42
    : seedFor({ hashValue, season, week, playerId }));
  await assert.rejects(runOneWeek({ seedFor: collide }), /produced the identical final seed/);
});

test('a non-integer final seed is rejected', async () => {
  await assert.rejects(runOneWeek({ seedFor: () => 1.5 }), /a final seed must be an unsigned 32-bit integer/);
});

test('an activation verdict that varies with the salt is rejected', async () => {
  const { generate: inner } = makeGenerator();
  const generate = async (args) => {
    const run = await inner(args);
    const saltIndex = SALTS.indexOf(String(args.hashValue).split(':')[1]);
    if (args.modelConstants.homeAway.enabled === true && saltIndex === 3) {
      const projection = run.projections.get(7);
      run.projections.set(7, { ...projection, factors: { homeAway: { ...projection.factors.homeAway, effect: 0 } } });
    }
    return run;
  };
  await assert.rejects(runOneWeek({ generate }), /activation verdict for playerId 7 differs between salts/);
});

test('a subgroup member with no finite median is a defect of the run, not a sparse week', async () => {
  const { generate: inner } = makeGenerator();
  const generate = async (args) => {
    const run = await inner(args);
    if (args.modelConstants.homeAway.enabled === true) {
      run.projections.set(5, { ...run.projections.get(5), median: null });
    }
    return run;
  };
  // Since the shell-run closure, the missing median is caught at the scored
  // collection's own boundary (projectionsMapOf's per-entry check), at the
  // same coordinate but earlier and for EVERY cohort member, not only
  // subgroup members; the deeper subgroup-pairing check in
  // emitSubgroupErrorRows remains as defense in depth behind it.
  await assert.rejects(runOneWeek({ generate }), /carries no finite median/);
});

test('a subgroup member with no resolved outcome has no error, rather than a zero one', async () => {
  const artifacts = makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 });
  artifacts.cohortWeek.actualPointsByPlayerId.set(5, null);
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(primaryOnly({ weekArtifacts: new Map([[`${PRIMARY_SEASON}:2`, artifacts]]) })),
    /has no finite resolved outcome/
  );
});

test('a missing week artifact is named by its season-week', async () => {
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(primaryOnly({ weekArtifacts: new Map() })),
    /no roster\/cohort artifacts supplied for 2025:2/
  );
});

test('a generator that returns no projections Map is rejected', async () => {
  await assert.rejects(runOneWeek({ generate: async () => ({ projections: null }) }), /must return a run carrying a projections Map/);
});

test('a benchmark arm the caller does not supply is named', async () => {
  // The present arm carries REAL projections: an empty Map is no longer a
  // way to be "present" (QA A2 below), and this test is about ABSENCE.
  await assert.rejects(
    runOneWeek({
      benchmarkProjectionsFor: async (args) => {
        const benchmarks = await benchmarkProjectionsFor(args);
        return { 'naive-recency': benchmarks['naive-recency'] };
      },
    }),
    /returned no usage-signal projections/
  );
});

test('an unsealed scoring profile and a missing injection are both rejected up front', async () => {
  await assert.rejects(inputsGeneration.generateSweepInputRecords(baseArgs({ profiles: ['ppr-6'] })), /is not a sealed scoring profile/);
  await assert.rejects(inputsGeneration.generateSweepInputRecords(baseArgs({ generate: null })), /generate must be injected/);
  await assert.rejects(inputsGeneration.generateSweepInputRecords(baseArgs({ scoringHashFor: () => 'NOT-HEX' })), /must return a lowercase hexadecimal scoring hash/);
});

// ---------------------------------------------------------------------------
// The sensitivity re-evaluations (increment 5)
// ---------------------------------------------------------------------------

test('every sensitivity pass carries the identical record universe, byte-identical here because this universe is sensitivity-blind', async () => {
  const records = await fullGrid();
  assert.deepEqual(
    records.counts.armWeekMetricsBySensitivity,
    Object.fromEntries(inputsSensitivity.SENSITIVITY_PASS_KEYS.map((key) => [key, records.counts.armWeekMetrics]))
  );
  const coordOf = (row) => `${row.scoringProfile}|${row.arm}|${row.season}|${row.week}|${row.salt}`;
  const primaryCoords = records.armWeekMetrics.map(coordOf);
  for (const key of inputsSensitivity.SENSITIVITY_PASS_KEYS) {
    const rows = records.armWeekMetricsBySensitivity[key];
    assert.deepEqual(rows.map(coordOf), primaryCoords, `${key} must cover the identical coordinates in the identical order`);
    // This universe has no projection ties, no duplicate name ranks, no
    // negative projections and no null projections - so every knob is
    // outcome-neutral and the variant records are BYTE-identical. That is a
    // property of the fixture, not of the passes; the discriminating
    // universe below is where each knob provably moves a number.
    assert.equal(canonicalJson(rows), canonicalJson(records.armWeekMetrics), `${key} must be byte-identical on a tie-free universe`);
  }
});

/**
 * A universe where each sensitivity knob has a real decision to flip, per
 * the id layout of makeRoster (QB 1-2, RB 3-6, WR 7-10, TE 11-12, K 13-14,
 * DEF 15-16):
 *   - RBs 4, 5 and 6 TIE for the second RB slot and share a NAME RANK (the
 *     duplicate-name run production leaves unordered; three members because
 *     the seed-1 shuffle leaves a two-element run in place).
 *   - bench WR 10 and bench TE 12 TIE for FLEX; the TE outranks the WR by
 *     NAME, so the DB-collation variant (name first, position ignored)
 *     reverses the primary's position-first tie-break.
 *   - both Ks (13, 14) are NEGATIVE: the deployed policy leaves the K slot
 *     empty, force-fill starts one.
 * The ties survive only where homeAway is OFF (the on-cells' baseline*effect
 * term is player-specific), which is enough: discrimination needs SOME
 * moved record, not every record.
 */
const DISCRIMINATING_MEDIANS = Object.freeze({
  1: 20, 2: 1, 3: 19, 4: 2, 5: 2, 6: 2, 7: 18, 8: 17, 9: 3, 10: 10,
  11: 15, 12: 10, 13: -5, 14: -7, 15: 8, 16: 1,
});

function discriminatingWeekArtifactMap() {
  const map = makeWeekArtifactMap();
  for (const artifacts of map.values()) {
    artifacts.nameRankById = new Map([...artifacts.nameRankById.keys()].map((playerId) => {
      if (playerId === 12) return [playerId, 1];
      if (playerId === 10) return [playerId, 2];
      if (playerId === 4 || playerId === 5 || playerId === 6) return [playerId, 50];
      return [playerId, 100 + playerId];
    }));
  }
  return map;
}

function discriminatingGenerator() {
  return async ({ season, week, playerIds, hashValue, modelConstants, onPreHomeAwayBaseline }) => {
    const blendWeight = modelConstants.usage.blendWeight;
    const homeAwayOn = modelConstants.homeAway.enabled === true;
    const saltIndex = SALTS.indexOf(String(hashValue).split(':')[1]);
    const projections = new Map();
    for (const playerId of playerIds) {
      const baseline = baselineFor({ blendWeight, season, week, playerId });
      if (onPreHomeAwayBaseline) {
        onPreHomeAwayBaseline({ playerId, position: 'RB', season, week, blendWeight, baseline });
      }
      // Every non-table term is GLOBAL to the week's generation (or zero in
      // off cells), so the engineered ties survive exactly there.
      const median = Number((
        DISCRIMINATING_MEDIANS[playerId]
        + (homeAwayOn ? baseline * HOME_AWAY_EFFECT : 0)
        + (blendWeight * 0.8)
        + (saltIndex * 0.01)
      ).toFixed(2));
      projections.set(playerId, {
        playerId,
        median,
        mean: median,
        p10: median - 2,
        p25: median - 1,
        p75: median + 1,
        p90: median + 2,
        sampleSize: 8,
        eligible: true,
        neutralSite: false,
        knownOrientation: true,
        factors: {
          homeAway: homeAwayOn
            ? { available: true, effect: HOME_AWAY_EFFECT, pointsContribution: Number((baseline * HOME_AWAY_EFFECT).toFixed(2)) }
            : { available: false, effect: 0, pointsContribution: 0 },
        },
      });
    }
    return { projections, inputCutoff: INPUT_CUTOFF, sourceCoverage: SOURCE_COVERAGE };
  };
}

test('each sensitivity knob MOVES regret in a universe with something to decide, and moves nothing else', async () => {
  const records = await inputsGeneration.generateSweepInputRecords(primaryOnly({
    weekArtifacts: discriminatingWeekArtifactMap(),
    generate: discriminatingGenerator(),
  }));
  const keyOf = (row) => `${row.scoringProfile}|${row.arm}|${row.season}|${row.week}|${row.salt}`;
  const primaryByKey = new Map(records.armWeekMetrics.map((row) => [keyOf(row), row]));
  for (const pass of inputsSensitivity.SENSITIVITY_PASSES) {
    const rows = records.armWeekMetricsBySensitivity[pass.key];
    const moved = rows.filter((row) => row.values.regret !== primaryByKey.get(keyOf(row)).values.regret);
    // A pass whose records were silently copied from the primary evaluation
    // - the exact mutant the tie-free universe cannot see - dies here.
    assert.ok(moved.length > 0, `${pass.key} must move regret somewhere in this universe`);
    for (const row of rows) {
      const primary = primaryByKey.get(keyOf(row));
      for (const endpoint of Object.keys(primary.values)) {
        if (endpoint === 'regret') continue;
        assert.ok(Object.is(primary.values[endpoint], row.values[endpoint]), `${pass.key} must not move ${endpoint} at ${keyOf(row)}`);
      }
    }
  }
  // The force-fill knob fires on EVERY cell arm-week: the negative-K slot is
  // empty under the deployed policy in every cell, and the started K's actual
  // points are never zero.
  const forceFill = records.armWeekMetricsBySensitivity['estimand:force-fill'];
  const cellRows = forceFill.filter((row) => arms.ALL_CELLS.some((cell) => cell.name === row.arm));
  const cellMoved = cellRows.filter((row) => row.values.regret !== primaryByKey.get(keyOf(row)).values.regret);
  assert.equal(cellMoved.length, cellRows.length, 'every cell arm-week must feel the estimand change');
});

// ---------------------------------------------------------------------------
// QA closures on increment 5 (adversarial finding 1; mutation survivors
// S8/S14, G4, R4/R5/R6)
// ---------------------------------------------------------------------------

const runBacktestInputs = require('../scripts/run-backtest-inputs');
const armWeekEvaluatorLib = require('../../scripts/backtest/lib/armWeekEvaluator');

test('the non-regret invariance guard actually fires (mutation QA G4)', () => {
  const artifacts = makeWeekArtifacts({ season: PRIMARY_SEASON, week: 3 });
  const projections = new Map(artifacts.cohortWeek.members.map((m) => [m.playerId, {
    playerId: m.playerId, median: m.playerId, p10: m.playerId - 2, p25: m.playerId - 1, p75: m.playerId + 1, p90: m.playerId + 2, factors: {},
  }]));
  const evaluateArgs = {
    season: PRIMARY_SEASON,
    week: 3,
    rosterWeek: artifacts.rosterWeek,
    cohortWeek: artifacts.cohortWeek,
    projectionsByPlayerId: projections,
    positionRank: artifacts.positionRank,
    nameRankById: artifacts.nameRankById,
    availabilityFor,
    optimize: optimalAssignment,
  };
  const primaryEvaluation = armWeekEvaluatorLib.evaluateArmWeek({ ...evaluateArgs, label: 'g4' });
  // Sanity: the real invariants hold on an honest evaluation.
  assert.ok(inputsGeneration.evaluateSensitivityVariants({ evaluateArgs, primaryEvaluation, where: 'g4' }));
  // A primary whose non-regret endpoint disagrees with the variant's - the
  // shape an evaluator defect would produce - must throw by endpoint name.
  const doctored = { ...primaryEvaluation, values: { ...primaryEvaluation.values, pairwise: (primaryEvaluation.values.pairwise ?? 0) + 1 } };
  assert.throws(
    () => inputsGeneration.evaluateSensitivityVariants({ evaluateArgs, primaryEvaluation: doctored, where: 'g4' }),
    /moved endpoint 'pairwise'/
  );
});

test('a comparison document reflects the metrics it was PASSED, under the sensitivity inputs it was GIVEN (mutation QA S8/S14)', async () => {
  const records = await fullGrid();
  // S8: the armWeekMetrics ARGUMENT is what assembles - proven both ways: a
  // valid argument assembles even when records.armWeekMetrics could not, and
  // an unassemblable argument fails even when records.armWeekMetrics could.
  const doc = inputsSensitivity.assembleComparisonDocument({
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    records: { ...records, armWeekMetrics: [] },
    armWeekMetrics: records.armWeekMetrics,
    permutationControl: syntheticPermutationControl(),
  });
  assert.ok(doc.cells, 'a valid argument must assemble even when records.armWeekMetrics would not');
  assert.throws(() => inputsSensitivity.assembleComparisonDocument({
    studyId: 'pit-sweep-2024-2025', canariesPassed: true, records, armWeekMetrics: [], permutationControl: syntheticPermutationControl(),
  }), Error, 'an empty argument must fail even when records.armWeekMetrics would assemble');
  // S14: a stage-1 comparison document carries the all-uncontradicted
  // placeholder - contradicted-true placeholders degrade every pass
  // symmetrically toward inconclusive and mask real contradictions.
  for (const cell of arms.SELECTION_FAMILY) {
    assert.deepEqual(doc.cells[cell.name].orderingSensitivity, { contradicted: false, detail: null });
  }
  // ...and the stage-2 path carries exactly the derived flags it was given.
  const flagged = {
    ...inputsSensitivity.placeholderOrderingSensitivityByCell(),
    [arms.SELECTION_FAMILY[0].name]: { contradicted: true, detail: 'injected' },
  };
  const flaggedDoc = inputsSensitivity.assembleComparisonDocument({
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    records,
    armWeekMetrics: records.armWeekMetrics,
    permutationControl: syntheticPermutationControl(),
    orderingSensitivityByCell: flagged,
  });
  assert.deepEqual(flaggedDoc.cells[arms.SELECTION_FAMILY[0].name].orderingSensitivity, { contradicted: true, detail: 'injected' });
});

test('the estimand halt is evaluated on the POST-contradiction basis (adversarial QA finding 1)', async () => {
  const records = await fullGrid();
  // The demonstrated scenario: two candidates pass under the primary
  // ordering; the parsimony winner (A) is CONTRADICTED by the DB-collation
  // variant. The final document therefore demotes A and selects B - and the
  // force-fill estimand, which endorses only A, must halt that selection.
  // A halt evaluated on placeholder-basis winners reads false here (both
  // placeholder winners are A), which is exactly the escape this test pins
  // shut.
  const A = 'usage-00-off';
  const B = 'usage-00-on';
  let calls = 0;
  const scriptFor = (passIndex, name) => {
    const passing = {
      0: [A, B], // stage-1 primary: winner A by parsimony
      1: [B], // db-collation flips A to fail
      2: [A, B], // duplicate-shuffle agrees with the primary
      3: [A, B], // stage-2 final primary: A is demoted by its flag below
      4: [A], // stage-2 final force-fill: only A would pass
    }[passIndex] || [];
    return passing.includes(name) ? 'pass' : 'fail';
  };
  const reducer = {
    ...runBacktestSweep,
    // The wrapper mirrors evaluateClaim's own demotion rule: a cell whose
    // document input says contradicted is inconclusive, whatever the script
    // would have said - which is what makes the stage-2 passes read the
    // derived flags the way the final reducer will.
    assembleCellClaim: (cellMeta, cellInput) => {
      const passIndex = Math.floor(calls / arms.ALL_CELLS.length);
      calls += 1;
      if (cellMeta.name === arms.CONTROL_CELL) return { cell: cellMeta.name, verdict: 'baseline' };
      if (cellInput.orderingSensitivity && cellInput.orderingSensitivity.contradicted) {
        return { cell: cellMeta.name, verdict: 'inconclusive' };
      }
      return { cell: cellMeta.name, verdict: scriptFor(passIndex, cellMeta.name) };
    },
  };
  const sensitivity = inputsSensitivity.deriveSensitivityInputs({
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    records,
    permutationControl: syntheticPermutationControl(),
    reducer,
  });
  assert.equal(sensitivity.orderingSensitivityByCell[A].contradicted, true);
  assert.equal(sensitivity.orderingDisagreement, false);
  assert.equal(sensitivity.detail.primaryWinner, A);
  assert.equal(sensitivity.detail.finalPrimaryWinner, B, 'the stage-2 primary winner reflects the derived demotion');
  assert.equal(
    sensitivity.deployedPolicyDisagreement, true,
    'the halt must fire against the winner the final document will actually select, not the placeholder-basis winner'
  );
  assert.deepEqual(sensitivity.detail.estimandReconciliation.winners, { deployedPolicy: B, forceFill: null });
  assert.equal(sensitivity.detail.winnersByPass['estimand:force-fill'], null);
});

test('assembleFinalDocument bakes the DERIVED sensitivity inputs into a reducer-validated document (mutation QA R4/R5/R6)', async () => {
  const records = await fullGrid();
  const derived = {
    orderingSensitivityByCell: {
      ...inputsSensitivity.placeholderOrderingSensitivityByCell(),
      'usage-40-off': { contradicted: true, detail: 'injected' },
    },
    orderingDisagreement: true,
    deployedPolicyDisagreement: true,
    detail: {},
  };
  let validated = 0;
  const reducer = {
    ...runBacktestSweep,
    validateInputs: (...args) => { validated += 1; return runBacktestSweep.validateInputs(...args); },
  };
  const { document, sensitivity } = runBacktestInputs.assembleFinalDocument({
    records,
    permutationControl: syntheticPermutationControl(),
    canariesPassed: true,
    reducer,
    deriveSensitivityInputsImpl: () => derived,
  });
  assert.equal(sensitivity, derived);
  assert.deepEqual(document.cells['usage-40-off'].orderingSensitivity, { contradicted: true, detail: 'injected' });
  assert.equal(document.orderingDisagreement, true, 'the document carries the DERIVED boolean, never a hardcoded false');
  assert.equal(document.deployedPolicyDisagreement, true);
  assert.equal(document.studyId, runBacktestInputs.STUDY_ID);
  assert.ok(validated >= 1, "the finished document must pass the reducer's own validateInputs before anyone serializes it");
});

// ---------------------------------------------------------------------------
// QA closures on the increment-3 backlog (findings S2, A1, A3, S1, A2, A5,
// A6, and the F-BLIND fixture patch), worked against the post-increment-5
// tree
// ---------------------------------------------------------------------------

test('a stored-history twin that diverges from its on cell aborts AT GENERATION TIME, not hours later in the reducer (QA S2)', async () => {
  const { generate: inner } = makeGenerator();
  const generate = async (args) => {
    const run = await inner(args);
    if (args.modelConstants.homeAway.useStoredHistory === true) {
      const projection = run.projections.get(1);
      run.projections.set(1, { ...projection, median: projection.median + 0.01 });
    }
    return run;
  };
  await assert.rejects(runOneWeek({ generate }), /homeaway-on == homeaway-on-stored/);
});

test('an independent control that is not bit-identical to usage-25 x off aborts at generation time (QA S2)', async () => {
  const { generate: inner } = makeGenerator();
  // The independent control arm receives IDENTICAL constants and hashValue
  // to the usage-25 x off cell - that identity is the assertion - so the
  // second call a salt makes with the control coordinate is the control
  // arm, and a generator that is not deterministic across the two calls is
  // exactly what 8.6.0 exists to catch.
  const seen = new Set();
  const generate = async (args) => {
    const run = await inner(args);
    if (args.modelConstants.usage.blendWeight === arms.CONTROL_BLEND_WEIGHT
      && args.modelConstants.homeAway.enabled !== true) {
      const key = `${args.season}:${args.week}:${args.hashValue}`;
      if (seen.has(key)) {
        const projection = run.projections.get(2);
        run.projections.set(2, { ...projection, median: projection.median + 0.01 });
      }
      seen.add(key);
    }
    return run;
  };
  await assert.rejects(runOneWeek({ generate }), /usage-25 x off == control/);
});

test('a cohort whose playerIds are strings is rejected by name, never coerced (QA A1)', async () => {
  const artifacts = makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 });
  artifacts.cohortWeek.members = artifacts.cohortWeek.members.map((m) => ({ ...m, playerId: String(m.playerId) }));
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(primaryOnly({ weekArtifacts: new Map([[`${PRIMARY_SEASON}:2`, artifacts]]) })),
    /ids are asserted, never coerced/
  );
});

test('a baseline whose blendWeight is missing cannot satisfy the provenance guard by coercing to usage-00 (QA A3)', async () => {
  // The bypass being killed: Number(null) === 0, and 0 IS usage-00-off's
  // blend weight - so a missing blendWeight reported only in that cell used
  // to pass the provenance comparison silently.
  const { generate: inner } = makeGenerator();
  const generate = async (args) => inner({
    ...args,
    onPreHomeAwayBaseline: (args.onPreHomeAwayBaseline && args.modelConstants.usage.blendWeight === 0)
      ? (row) => args.onPreHomeAwayBaseline({ ...row, blendWeight: null })
      : args.onPreHomeAwayBaseline,
  });
  await assert.rejects(runOneWeek({ generate }), /blendWeight must be a finite number/);
});

test('the salt-seed collision guard covers the sensitivity profiles\' own seed streams (QA S1)', async () => {
  const collide = ({ hashValue, season, week, playerId }) => (playerId === 3
    ? 42
    : seedFor({ hashValue, season, week, playerId }));
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(baseArgs({
      profiles: ['standard'],
      weekArtifacts: new Map([[`${PRIMARY_SEASON}:2`, makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 })]]),
      seedFor: collide,
    })),
    /produced the identical final seed/
  );
});

test('an EMPTY benchmark projections collection is rejected by name, not scored as an all-empty lineup (QA A2)', async () => {
  await assert.rejects(
    runOneWeek({
      benchmarkProjectionsFor: async (args) => {
        const benchmarks = await benchmarkProjectionsFor(args);
        return { ...benchmarks, 'naive-recency': new Map() };
      },
    }),
    /projections collection is EMPTY/
  );
});

test('a sensitivity-profile generation that returns no projections is rejected - the output-side checks are not primary-only (QA A2)', async () => {
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(baseArgs({
      profiles: ['standard'],
      weekArtifacts: new Map([[`${PRIMARY_SEASON}:2`, makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 })]]),
      generate: async () => ({ projections: new Map(), inputCutoff: INPUT_CUTOFF, sourceCoverage: SOURCE_COVERAGE }),
    })),
    /projections collection is EMPTY/
  );
});

test('a constant-returning scoringHashFor is rejected before any generation is paid for (QA A6)', async () => {
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(baseArgs({ scoringHashFor: () => 'a1b2c3' })),
    /the profiles' seed streams must be distinct/
  );
});

// ---------------------------------------------------------------------------
// Adversarial-QA closures on the backlog closure itself: the four confirmed
// escapes (shell runs, partial runs, memoized 8.6.0 sides, baseline-row id
// laundering) each pinned shut
// ---------------------------------------------------------------------------

test('a SHELL run - full key coverage, substance-free values - is rejected at the boundary, not scored as an all-empty lineup', async () => {
  // Numeric keys and size 16 satisfied the emptiness check while every value
  // carried no median, so the evaluator scored exactly the all-empty lineup
  // A2 exists to block - and a sensitivity-profile cell had no other
  // output-side check at all.
  await assert.rejects(
    inputsGeneration.generateSweepInputRecords(baseArgs({
      profiles: ['standard'],
      weekArtifacts: new Map([[`${PRIMARY_SEASON}:2`, makeWeekArtifacts({ season: PRIMARY_SEASON, week: 2 })]]),
      generate: async ({ playerIds }) => ({
        projections: new Map(playerIds.map((id) => [id, {}])), inputCutoff: INPUT_CUTOFF, sourceCoverage: SOURCE_COVERAGE,
      }),
    })),
    /carries no finite median/
  );
});

test('a projection dropped AFTER its baseline was captured is caught at the boundary, never published as a silently moved regret', async () => {
  // Player 2 is NOT a subgroup member, so the subgroup-pairing checks never
  // saw it; the dropped projection previously moved the published regret by
  // +3.1 points at the coordinate with no failure anywhere. The scored
  // collection now gets the same exact key-set check the identity arms
  // always had (sweepPreflight.assertMapMatchesRawIds - the reducer's own).
  const { generate: inner } = makeGenerator();
  const generate = async (args) => {
    const run = await inner(args);
    if (args.modelConstants.usage.blendWeight === 0.4 && args.modelConstants.homeAway.enabled !== true) {
      run.projections.delete(2);
    }
    return run;
  };
  await assert.rejects(runOneWeek({ generate }), /projection keys do not exactly match the raw playerIds set/);
});

test('a memoizing harness cannot satisfy 8.6.0 with its own object - aliased identity sides are rejected at generation time', async () => {
  // The independent control receives arguments identical to the
  // `usage-25 x off` cell BY DESIGN, so a results-cache keyed on generation
  // inputs returns one object for both sides: 816 records of "independent
  // regeneration" evidence with zero independent generations, passing the
  // bit-identity trivially - verbatim the reuse section 9 forbids.
  const cache = new Map();
  const { generate: inner } = makeGenerator();
  const generate = async (args) => {
    const key = [
      args.hashValue,
      args.modelConstants.usage.blendWeight,
      args.modelConstants.homeAway.enabled === true,
      args.modelConstants.homeAway.useStoredHistory === true,
      args.season,
      args.week,
    ].join('|');
    if (cache.has(key)) return cache.get(key);
    const run = await inner(args);
    cache.set(key, run);
    return run;
  };
  await assert.rejects(runOneWeek({ generate }), /the two sides are the SAME run object/);
});

test('a corrupted baseline-row playerId is rejected by type, never laundered onto a different real player', async () => {
  // `Number(true) === 1`: the corrupted row previously landed on player 1,
  // fabricating player 1's subgroup membership AND masking the run-voiding
  // coverage gap left by player 1's own missing callback - the same
  // assert-never-coerce rule A1 pinned for cohort ids, at the callback
  // boundary.
  const { generate: inner } = makeGenerator();
  const generate = async (args) => inner({
    ...args,
    onPreHomeAwayBaseline: args.onPreHomeAwayBaseline
      ? (row) => {
        if (row.playerId === 1) return;
        args.onPreHomeAwayBaseline(row);
        if (row.playerId === 5) args.onPreHomeAwayBaseline({ ...row, playerId: true });
      }
      : undefined,
  });
  await assert.rejects(runOneWeek({ generate }), /playerId must be a number/);
});

test('FIXTURE-FIX: a benchmark arm-week is scored from ITS OWN week\'s benchmark projections', async () => {
  const records = await fullGrid();
  const season = PRIMARY_SEASON;
  const week = 5;
  const artifacts = makeWeekArtifacts({ season, week });
  const playerIds = artifacts.cohortWeek.members.map((m) => m.playerId);
  const benches = await benchmarkProjectionsFor({ season, week, playerIds });
  for (const arm of inputsAssembly.BENCHMARK_ARMS) {
    const rescored = armWeekEvaluatorLib.evaluateArmWeek({
      season,
      week,
      rosterWeek: artifacts.rosterWeek,
      cohortWeek: artifacts.cohortWeek,
      projectionsByPlayerId: benches[arm],
      positionRank: artifacts.positionRank,
      nameRankById: artifacts.nameRankById,
      availabilityFor,
      optimize: optimalAssignment,
    });
    const published = records.armWeekMetrics.find((row) => row.arm === arm
      && row.season === season && row.week === week && row.salt === SALTS[0]);
    assert.deepEqual(published.values, rescored.values, arm);
  }
});

test('FIXTURE-FIX: arm-week values are positively pinned in BOTH seasons', async () => {
  const records = await fullGrid();
  const week = 9;
  const salt = SALTS[5];
  for (const season of SEASONS) {
    for (const cell of [arms.ALL_CELLS.find((c) => c.name === arms.CONTROL_CELL), ON_CELLS[3]]) {
      const artifacts = makeWeekArtifacts({ season, week });
      const playerIds = artifacts.cohortWeek.members.map((m) => m.playerId);
      const run = await makeGenerator().generate({
        scoringProfile: 'half_ppr',
        season,
        week,
        playerIds,
        hashValue: arms.composeSaltedHashValue({ scoringHash: SCORING_HASHES.half_ppr, salt }),
        modelConstants: arms.resolveConstants({ cell, baseConstants: model.MODEL_CONSTANTS }),
        weatherService: false,
      });
      const rescored = armWeekEvaluatorLib.evaluateArmWeek({
        season,
        week,
        rosterWeek: artifacts.rosterWeek,
        cohortWeek: artifacts.cohortWeek,
        projectionsByPlayerId: run.projections,
        positionRank: artifacts.positionRank,
        nameRankById: artifacts.nameRankById,
        availabilityFor,
        optimize: optimalAssignment,
      });
      const published = records.armWeekMetrics.find((row) => row.scoringProfile === 'half_ppr'
        && row.arm === cell.name && row.season === season && row.week === week && row.salt === salt);
      assert.ok(published, `${cell.name} ${season}w${week} must be published`);
      assert.deepEqual(published.values, rescored.values, `${cell.name} ${season}w${week}`);
    }
  }
});

test('FIXTURE-FIX: the two benchmark arms are not the same numbers', async () => {
  const records = await fullGrid();
  const at = (arm) => records.armWeekMetrics.find((row) => row.arm === arm
    && row.season === PRIMARY_SEASON && row.week === 5 && row.salt === SALTS[0]);
  assert.notEqual(canonicalJson(at('naive-recency').values), canonicalJson(at('usage-signal').values),
    'the two benchmarks are different models; publishing one from the other\'s projections must fail');
});

test('assertRunsNotAliased catches a shared per-player projection object in EVERY collection shape, including the serialization-safe array form (adversarial QA on c95d751)', () => {
  const inputsGeneration = require('../../scripts/backtest/lib/inputsGeneration');
  const shared = { playerId: 7, median: 12.5 };
  const asMap = (projection) => ({ projections: new Map([[7, projection]]) });
  const asArray = (projection) => ({ projections: [projection] });
  const asObject = (projection) => ({ projections: { 7: projection } });
  // A non-cloning cache returns new run/container objects wrapping the SAME
  // per-player projection - the third depth must fire for all shapes and all
  // cross-shape pairs, since records are captured in the array form.
  for (const [name, left, right] of [
    ['map/map', asMap(shared), asMap(shared)],
    ['array/array', asArray(shared), asArray(shared)],
    ['object/object', asObject(shared), asObject(shared)],
    ['map/array', asMap(shared), asArray(shared)],
    ['array/object', asArray(shared), asObject(shared)],
  ]) {
    assert.throws(() => inputsGeneration.assertRunsNotAliased({ leftRun: left, rightRun: right, label: name }),
      /projection object is SHARED between the two sides/, name);
  }
  // Distinct objects with equal values pass - the guard is about aliasing,
  // never about value equality (bit-identity is the sealed assertion's job).
  assert.equal(inputsGeneration.assertRunsNotAliased({
    leftRun: asArray({ playerId: 7, median: 12.5 }),
    rightRun: asArray({ playerId: 7, median: 12.5 }),
    label: 'distinct',
  }), true);
});
