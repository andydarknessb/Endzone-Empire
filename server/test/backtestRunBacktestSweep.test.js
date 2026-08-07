const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runBacktestSweep = require('../scripts/run-backtest-sweep');
const arms = require('../../scripts/backtest/lib/arms');
const sweepEvaluator = require('../../scripts/backtest/lib/sweepEvaluator');
const metrics = require('../../scripts/backtest/lib/metrics');
const sweepEvidence = require('../../scripts/backtest/lib/sweepEvidence');

const PRIMARY = sweepEvidence.PRIMARY_PROFILE;

// ---------------------------------------------------------------------------
// Fixture construction: a full, valid --inputs document
// ---------------------------------------------------------------------------

/** A varied, non-degenerate week series favoring `sign` (1 = favorable-positive-ish, -1 = favorable-negative-ish). */
function variedSeries(sign, magnitude, offset = 0) {
  return Object.fromEntries(
    metrics.EVALUATED_WEEKS.map((w, i) => [w, sign * (magnitude + i * 0.0013 + offset) + (i % 3) * 0.0001])
  );
}

/** A comfortably-passing co-primary component input for any of the zero/DELTA_R/DELTA_P margins. */
function passingCoPrimaryInput() {
  return {
    regretWeekDeltas: variedSeries(-1, 0.6),
    pairwiseWeekDeltas: variedSeries(1, 0.05),
  };
}

/** A comfortably-passing e2 endpoint set: all thirteen keys, each favorable per its own direction. */
function passingE2Input() {
  return {
    endpoints: sweepEvaluator.E2_ENDPOINT_KEYS.map((key, i) => {
      const boundary = arms.SIGNED_BOUNDARY_TABLE[key];
      const sign = boundary.direction === 'below' ? -1 : 1;
      return { key, weekDeltas: variedSeries(sign, 0.3, i * 0.01) };
    }),
  };
}

const HEALTHY_F_ENDPOINT = Object.freeze({
  weekDeltas: new Array(8).fill(-0.01),
  subgroupRows: 40,
  meanAbsBaseline: 1.0,
  maxAbsBaseline: 2.0,
  weekMeanAbsBaselines: new Array(8).fill(1.0),
});

function healthyFVeto() {
  return {
    realizations: metrics.SALTS.map((salt) => ({ season: 2025, week: 2, playerId: 7, salt, incrementalError: 0.01 })),
  };
}

function syntheticPreflight() {
  const cohortRosterRows = [{ season: 2025, week: 2, playerId: 7 }];
  const rawRun = () => ({
    projections: [{ playerId: 7, median: 12.5, p10: 4, factors: {} }],
    inputCutoff: '2025-09-01T00:00:00.000Z', sourceCoverage: { synthetic: true },
  });
  // Section 8.6.1's single-leaf guard runs on the constants the two arms were
  // ACTUALLY built with, so the records carry them. The on-stored arm differs
  // from its twin in exactly homeAway.useStoredHistory.
  const model = require('../services/projectionModel');
  const usage25 = arms.ALL_CELLS.find((cell) => cell.blendWeight === 0.25 && cell.homeAway === 'on');
  const baseResolved = () => arms.resolveConstants({ cell: usage25, baseConstants: model.MODEL_CONSTANTS });
  const storedResolved = () => arms.resolveConstantsWithStoredHistory({ cell: usage25, baseConstants: model.MODEL_CONSTANTS });
  const records = () => metrics.SALTS.map((salt) => ({
    season: 2025, week: 2, salt,
    leftPlayerIds: [7], rightPlayerIds: [7], leftRun: rawRun(), rightRun: rawRun(),
    leftConstants: baseResolved(), rightConstants: storedResolved(),
  }));
  return {
    cohortRosterRows,
    controlUsage25Records: records(),
    homeAwayStoredRecords: records(),
    saltSeedRecords: arms.ALL_CELLS.map((cell) => ({
      cellName: cell.name, season: 2025, week: 2, playerId: 7,
      seedsBySalt: Object.fromEntries(metrics.SALTS.map((salt, index) => [salt, index])),
    })),
    matchedOffBaselineRows: arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => ({
      cellName: cell.name, season: 2025, week: 2, playerId: 7, baseline: -1,
    })),
  };
}

function syntheticEvidence() {
  const weekly = (point) => metrics.EVALUATED_WEEKS.map((week) => ({ week, value: point + (week - 2) * 0.0001 }));
  return {
    metricWeeks: sweepEvidence.SEASONS.flatMap((season) => arms.ALL_CELLS.flatMap((cell, cellIndex) => ['absolute', 'paired-delta'].flatMap((estimand) => sweepEvidence.METRIC_KEYS.flatMap((endpoint, index) => weekly((estimand === 'absolute' ? 1 + cellIndex : cellIndex * 0.01) + index * 0.001).map(({ week, value }) => ({ season, scoringProfile: PRIMARY, cell: cell.name, endpoint, estimand, week, value })))))),
    movingBlockWeeks: sweepEvidence.SEASONS.flatMap((season) => arms.ALL_CELLS.flatMap((cell) => metrics.MOVING_BLOCK_LENGTHS.flatMap((blockLength) => sweepEvidence.METRIC_KEYS.flatMap((endpoint) => weekly(0).map(({ week, value }) => ({ season, scoringProfile: PRIMARY, cell: cell.name, endpoint, estimand: 'absolute', sensitivity: `moving-block-${blockLength}`, week, value })))))),
    attributionWeeks: sweepEvidence.SEASONS.flatMap((season) => sweepEvidence.ATTRIBUTION_CELL_NAMES.flatMap((cell) => ['usage-main', 'home-away-main', 'interaction'].flatMap((estimand, estimateIndex) => sweepEvidence.METRIC_KEYS.flatMap((endpoint) => weekly(0.01 + estimateIndex * 0.01).map(({ week, value }) => ({ season, scoringProfile: PRIMARY, cell, endpoint, estimand, week, value })))))),
    diagnosticWeeks: sweepEvidence.SEASONS.flatMap((season) => ['control-naive', 'usage-signal'].flatMap((estimand, estimateIndex) => sweepEvidence.METRIC_KEYS.flatMap((endpoint) => weekly(-0.1 + estimateIndex * 0.2).map(({ week, value }) => ({ season, scoringProfile: PRIMARY, endpoint, estimand, week, value }))))),
    activationWeeks: sweepEvidence.ON_CELL_NAMES.flatMap((cell) => ['2025', '2024'].flatMap((season) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.map((position) => ({ cell, season, scoringProfile: PRIMARY, week, position, eligible: 1, activated: 1, excludedIneligible: 0 }))))),
    sensitivityWeeks: sweepEvidence.SENSITIVITY_SEASONS.flatMap((season) => sweepEvidence.SENSITIVITY_PROFILES.flatMap((scoringProfile) => arms.ALL_CELLS.flatMap((cell, cellIndex) => sweepEvidence.SENSITIVITY_ENDPOINTS.flatMap((endpoint, index) => weekly(1 + cellIndex + index * 0.001).map(({ week, value }) => ({ season, scoringProfile, cell: cell.name, endpoint, estimand: 'absolute', week, value })))))),
  };
}

function syntheticPermutationControl({ fail = false } = {}) {
  // Player ids must be unique ACROSS positions once rosters exist, because a
  // roster is a set of players and a cohort maps id -> position.
  const pid = (position, n) => metrics.MACRO_POSITIONS.indexOf(position) * 100 + n;
  const rosterRows = metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, position, playerId: pid(position, 1) },
    { season: 2025, week, position, playerId: pid(position, 2) },
  ]));
  // Section 5's T_regret is mean DEPLOYED-POLICY regret over the week's rosters,
  // so the control carries the same roster/cohort artifacts the control cell
  // evaluator uses. The RUNNER injects rosterSlots/availabilityFor/optimize -
  // functions cannot travel in an --inputs document - so only data appears here.
  const byWeek = (build) => Object.fromEntries(metrics.EVALUATED_WEEKS.map((week) => [week, build(week)]));
  const everyPlayer = metrics.MACRO_POSITIONS.flatMap((position) => [pid(position, 1), pid(position, 2)]);
  return {
    rosterRows,
    observations: metrics.SALTS.flatMap((salt) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
      { season: 2025, week, salt, position, playerId: pid(position, 1), actual: fail ? 0 : 1, projected: 1 },
      { season: 2025, week, salt, position, playerId: pid(position, 2), actual: fail ? 1 : 0, projected: 0 },
    ]))),
    rosterWeeks: byWeek(() => ({
      rosters: [{ replicate: 1, teamIndex: 0, starters: [], bench: everyPlayer.map((playerId) => ({ playerId })) }],
    })),
    cohortWeeks: byWeek(() => ({
      members: metrics.MACRO_POSITIONS.flatMap((position) => [1, 2].map((n) => ({
        playerId: pid(position, n), position, teamKey: `T${pid(position, n)}`, injuryStatus: null, onBye: false,
      }))),
    })),
    positionRank: Object.fromEntries(metrics.MACRO_POSITIONS.map((position, i) => [position, i + 1])),
    nameRankById: Object.fromEntries(everyPlayer.map((playerId) => [playerId, playerId])),
  };
}

function treatedActivationInput() {
  const position = () => ({
    eligible: true, neutralSite: false, knownOrientation: true,
    factors: { homeAway: { available: true, effect: 0.02 } },
  });
  const oneSeason = () => Object.fromEntries(
    metrics.MACRO_POSITIONS.map((p) => [p, Array.from({ length: 17 }, position)])
  );
  return {
    // Prereg 11.2: activation is checked once per season, independently.
    projectionsByPositionBySeason: { 2025: oneSeason(), 2024: oneSeason() },
  };
}

/** A full, valid --inputs document: every cell comfortably PASSES every applicable component. */
function fullPassingInputs({ permutationControl = syntheticPermutationControl() } = {}) {
  const cells = {};
  for (const cellMeta of arms.ALL_CELLS) {
    const isOnCell = cellMeta.homeAway === 'on';
    // Prereg 9.3/9.4: (b) applies only to "on" cells, (c) only when
    // blendWeight differs from the control's 0.25 - null otherwise, exactly
    // like (f)/activation are null for an "off" cell.
    const usageDiffersFromControl = cellMeta.blendWeight !== arms.CONTROL_BLEND_WEIGHT;
    const isControlCell = cellMeta.name === arms.CONTROL_CELL;
    cells[cellMeta.name] = {
      a: passingCoPrimaryInput(),
      b: isOnCell ? passingCoPrimaryInput() : null,
      c: usageDiffersFromControl ? passingCoPrimaryInput() : null,
      d: passingCoPrimaryInput(),
      e1: passingCoPrimaryInput(),
      e2: passingE2Input(),
      f: isOnCell ? { f1: HEALTHY_F_ENDPOINT, f2: HEALTHY_F_ENDPOINT, veto: healthyFVeto() } : null,
      activation: isOnCell ? treatedActivationInput() : null,
      // Prereg 5.2/16: null only for the control (no verdict to contradict).
      orderingSensitivity: isControlCell ? null : { contradicted: false, detail: null },
    };
  }
  const evidence = syntheticEvidence();
  for (const row of evidence.metricWeeks) {
    if (row.estimand === 'paired-delta' && ['regret', 'pairwise'].includes(row.endpoint)) {
      // Each season's descriptive paired delta must equal the gating component
      // that OWNS that season: (a) is the 2025 co-primary, (e1) the 2024
      // co-primary safety gate (prereg 9.6). Seeding both seasons from (a) would
      // make the 2024 cross-check pass only because nothing was checking it.
      const component = row.season === '2024' ? 'e1' : 'a';
      row.value = cells[row.cell][component][row.endpoint === 'regret' ? 'regretWeekDeltas' : 'pairwiseWeekDeltas'][row.week];
    }
  }
  return {
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    preflight: syntheticPreflight(),
    permutationControl,
    orderingDisagreement: false,
    deployedPolicyDisagreement: false,
    cells,
    evidence,
  };
}

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-backtest-sweep-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs requires --inputs, --out-json, --out-markdown, with no default', () => {
  assert.throws(() => runBacktestSweep.parseArgs([]), /--inputs is required/);
  assert.throws(
    () => runBacktestSweep.parseArgs(['--inputs', 'x.json']),
    /--out-json is required/
  );
  assert.deepEqual(
    runBacktestSweep.parseArgs(['--inputs', 'a.json', '--out-json', 'b.json', '--out-markdown', 'c.md']),
    { inputs: 'a.json', outJson: 'b.json', outMarkdown: 'c.md', verifyAgainst: null }
  );
});

test('parseArgs refuses an unknown flag and a flag missing its value', () => {
  assert.throws(() => runBacktestSweep.parseArgs(['--bogus', 'x']), /unknown argument --bogus/);
  assert.throws(() => runBacktestSweep.parseArgs(['--inputs']), /--inputs requires a value/);
  assert.throws(() => runBacktestSweep.parseArgs(['--inputs', '--out-json']), /--inputs requires a value/);
});

// ---------------------------------------------------------------------------
// validateInputs: the closed schema, actionable failures
// ---------------------------------------------------------------------------

test('validateInputs accepts a well-formed document and refuses a non-object', () => {
  assert.doesNotThrow(() => runBacktestSweep.validateInputs(fullPassingInputs()));
  assert.throws(() => runBacktestSweep.validateInputs(null), /must be a JSON object/);
  assert.throws(() => runBacktestSweep.validateInputs('nope'), /must be a JSON object/);
});

test('validateInputs refuses an unexpected top-level key', () => {
  const bad = { ...fullPassingInputs(), extra: true };
  assert.throws(() => runBacktestSweep.validateInputs(bad), /unexpected key\(s\).*extra/);
});

test('validateInputs refuses a missing or extra cell', () => {
  const missing = fullPassingInputs();
  delete missing.cells['usage-40-off'];
  assert.throws(() => runBacktestSweep.validateInputs(missing), /missing usage-40-off/);

  const extra = fullPassingInputs();
  extra.cells['not-a-cell'] = extra.cells['usage-40-off'];
  assert.throws(() => runBacktestSweep.validateInputs(extra), /unrecognized cell\(s\): not-a-cell/);
});

test('validateInputs requires activation to carry BOTH seasons independently (prereg 11.2)', () => {
  const missing2024 = fullPassingInputs();
  delete missing2024.cells['usage-25-on'].activation.projectionsByPositionBySeason['2024'];
  assert.throws(
    () => runBacktestSweep.validateInputs(missing2024),
    /projectionsByPositionBySeason\.2024: must be an object/
  );

  const extraSeason = fullPassingInputs();
  extraSeason.cells['usage-25-on'].activation.projectionsByPositionBySeason['2023'] = {};
  assert.throws(
    () => runBacktestSweep.validateInputs(extraSeason),
    /projectionsByPositionBySeason: unexpected key\(s\): 2023/
  );
});

test('validateInputs requires f/activation to be null for an off-cell, and present for an on-cell', () => {
  const offWithF = fullPassingInputs();
  offWithF.cells['usage-40-off'].f = { f1: HEALTHY_F_ENDPOINT, f2: HEALTHY_F_ENDPOINT };
  assert.throws(() => runBacktestSweep.validateInputs(offWithF), /f: must be null for an "off" cell/);

  const onMissingF = fullPassingInputs();
  onMissingF.cells['usage-25-on'].f = null;
  assert.throws(() => runBacktestSweep.validateInputs(onMissingF), /f: must be an object for an "on" cell/);

  const onMissingActivation = fullPassingInputs();
  onMissingActivation.cells['usage-25-on'].activation = null;
  assert.throws(() => runBacktestSweep.validateInputs(onMissingActivation), /activation: must be an object for an "on" cell/);
});

test('validateInputs requires b to be null for an "off" cell and c to be null when blendWeight === 0.25 (prereg 9.3/9.4)', () => {
  const offWithB = fullPassingInputs();
  offWithB.cells['usage-40-off'].b = passingCoPrimaryInput();
  assert.throws(() => runBacktestSweep.validateInputs(offWithB), /b: must be null - component \(b\) is not applicable/);

  const onMissingB = fullPassingInputs();
  onMissingB.cells['usage-25-on'].b = null;
  assert.throws(() => runBacktestSweep.validateInputs(onMissingB), /b: must be an object \(component \(b\) IS applicable/);

  const controlBlendWithC = fullPassingInputs();
  controlBlendWithC.cells['usage-25-on'].c = passingCoPrimaryInput();
  assert.throws(() => runBacktestSweep.validateInputs(controlBlendWithC), /c: must be null - component \(c\) is not applicable/);

  const offControlWithC = fullPassingInputs();
  offControlWithC.cells['usage-25-off'].c = passingCoPrimaryInput();
  assert.throws(() => runBacktestSweep.validateInputs(offControlWithC), /c: must be null - component \(c\) is not applicable/);

  const differingUsageMissingC = fullPassingInputs();
  differingUsageMissingC.cells['usage-40-off'].c = null;
  assert.throws(() => runBacktestSweep.validateInputs(differingUsageMissingC), /c: must be an object \(component \(c\) IS applicable/);
});

test('validateInputs refuses an e2 endpoint with an unrecognized key', () => {
  const bad = fullPassingInputs();
  bad.cells['usage-40-off'].e2.endpoints[0] = { key: 'not-a-real-endpoint', weekDeltas: {} };
  assert.throws(() => runBacktestSweep.validateInputs(bad), /must be one of the thirteen preregistered/);
});

test('validateInputs refuses a permutationControl field that is missing or non-finite', () => {
  const bad = fullPassingInputs();
  bad.permutationControl = { regret: { observed: 1, permuted: [] } };
  assert.throws(() => runBacktestSweep.validateInputs(bad), /unexpected key/);

  const nanCase = fullPassingInputs();
  nanCase.permutationControl.observations[0].actual = NaN;
  assert.throws(() => runBacktestSweep.buildReportFromInputs(nanCase), /invalid raw observation/);
});

// ---------------------------------------------------------------------------
// End to end: main() as a deterministic disk-to-disk reducer
// ---------------------------------------------------------------------------

test('main(): an UNEVALUABLE endpoint still publishes its n, k, p, bound, and trigger reasons - evidence is never discarded', (t) => {
  const dir = tmpDir(t);
  const inputs = fullPassingInputs();
  // Drive usage-40-off's component (a) regret endpoint to unevaluable via
  // week-dropping (3 of 17 dropped leaves n=14, below the n>=15 floor).
  const dropped = variedSeries(-1, 0.6);
  delete dropped[2]; delete dropped[3]; delete dropped[4];
  inputs.cells['usage-40-off'].a.regretWeekDeltas = dropped;
  // Component (a) owns 2025 only, so only the 2025 descriptive rows may be
  // blanked. Dropping both seasons' rows would put the 2024 row out of step with
  // component (e1), which still has those weeks, and fail the cross-check for a
  // reason this test is not about.
  for (const row of inputs.evidence.metricWeeks) {
    if (row.season === '2025' && row.cell === 'usage-40-off' && row.estimand === 'paired-delta' && row.endpoint === 'regret' && [2, 3, 4].includes(row.week)) row.value = { nonfinite: '+Infinity' };
  }
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(inputs));
  // Every main() call that REACHES the control passes the test-only
  // { expectedRosterCount: 1 } override: the fixtures carry one roster, and
  // the conformant 50 is a ~1-hour production run. The runner-default test
  // below proves main() WITHOUT the override injects the pinned 50. Calls that
  // fail before the control (bad file, bad JSON, bad schema) stay bare - an
  // override on a path that never reaches the control is dead configuration.
  runBacktestSweep.main([
    '--inputs', inputsPath,
    '--out-json', path.join(dir, 'report.json'),
    '--out-markdown', path.join(dir, 'REPORT.md'),
  ], { expectedRosterCount: 1 });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const cell = report.cells.find((c) => c.name === 'usage-40-off');
  assert.equal(cell.components.a.status, 'unevaluable');
  const endpoints = cell.components.a.evidence.endpoints;
  const unevaluableEndpoint = endpoints.find((e) => e.status === 'unevaluable');
  assert.ok(unevaluableEndpoint, 'the unevaluable endpoint is still published');
  // The WHY is auditable, not a bare status.
  assert.match(unevaluableEndpoint.unevaluableReason, /weeks dropped/);
  assert.equal(Array.isArray(unevaluableEndpoint.triggerReasons), true);
  // The sibling endpoint that WAS evaluable still carries its full evidence.
  const evaluableEndpoint = endpoints.find((e) => e.status !== 'unevaluable');
  assert.equal(typeof evaluableEndpoint.n, 'number');
  assert.equal(typeof evaluableEndpoint.lower, 'number');
});

test('main(): an infinite inverted bound is published as a flag, never dropped and never crashing canonical serialization', (t) => {
  const dir = tmpDir(t);
  const inputs = fullPassingInputs();
  // A degenerate, tie-heavy (f) endpoint: 8 raw clusters clears the minimum,
  // but 2 tie out on the margin leaving n=6 - below the n=8 at which any
  // finite inverted bound exists at alpha/7. exactBound must publish as
  // null with exactBoundIsInfinite true, and the report must still
  // canonically serialize (assertFinite refuses raw Infinity).
  inputs.cells['usage-25-on'].f.f1 = {
    ...HEALTHY_F_ENDPOINT,
    weekDeltas: [arms.DELTA_F, arms.DELTA_F, ...new Array(6).fill(-0.01)],
  };
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(inputs));
  assert.doesNotThrow(() => runBacktestSweep.main([
    '--inputs', inputsPath,
    '--out-json', path.join(dir, 'report.json'),
    '--out-markdown', path.join(dir, 'REPORT.md'),
  ], { expectedRosterCount: 1 }), 'an infinite bound must not crash canonical serialization');
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const cell = report.cells.find((c) => c.name === 'usage-25-on');
  assert.equal(cell.components.f.status, 'unevaluable');
  assert.equal(cell.verdict, 'inconclusive', "(f) unevaluable is the named inconclusive exception");
});

test('main(): a comfortably-passing inputs document produces a VALID run with a SELECTED cell', (t) => {
  const dir = tmpDir(t);
  const inputsPath = path.join(dir, 'inputs.json');
  const outJson = path.join(dir, 'report.json');
  const outMarkdown = path.join(dir, 'REPORT.md');
  fs.writeFileSync(inputsPath, JSON.stringify(fullPassingInputs()));

  const code = runBacktestSweep.main(['--inputs', inputsPath, '--out-json', outJson, '--out-markdown', outMarkdown], { expectedRosterCount: 1 });
  assert.equal(code, 0);

  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(report.run.status, 'valid');
  assert.equal(report.cells.length, 8);
  assert.equal(report.selection.outcome, 'selected');
  assert.equal(report.selection.selected.name, 'usage-40-off', 'parsimony prefers the cell that activates no new factor');

  const markdown = fs.readFileSync(outMarkdown, 'utf8');
  assert.match(markdown, /# Sweep report: pit-sweep-2024-2025/);
  assert.match(markdown, /Outcome: \*\*selected\*\*/);
  assert.match(markdown, /## Descriptive evidence/);
  assert.match(markdown, /Permutation: seed=940227589, replicates=10000/);
  assert.match(markdown, /### Eight-cell metrics/);
  // Section 8.7 rule 1: the factorial family is the formal primary, half_ppr.
  assert.match(markdown, /\| 2025 \| half_ppr \| usage-25-off \| absolute \| regret \|/);
  // Section 4.6.1: both seasons are published.
  assert.match(markdown, /\| 2024 \| half_ppr \| usage-25-off \| absolute \| regret \|/);
  // Section 8.7 rule 4: prereg 16's family carries standard and ppr, 2025 only.
  assert.match(markdown, /### Scoring-profile sensitivity \(prereg 16\)/);
  assert.match(markdown, /\| 2025 \| standard \| usage-25-off \| absolute \| regret \|/);
  assert.match(markdown, /\| 2025 \| ppr \| usage-25-off \| absolute \| regret \|/);
  // Section 4.6: mandatory self-description distinguishes the two methods.
  assert.match(markdown, /percentile-cluster-bootstrap \| 100000 \| 1499811874/);
  assert.match(markdown, /moving-block-bootstrap \| 100000 \| 588165040/);
  assert.match(markdown, /### Moving-block sensitivity/);
  assert.match(markdown, /### Attribution composites/);
  assert.match(markdown, /### Activation aggregates/);
  assert.doesNotMatch(markdown, /Eight-cell metrics: \d+/);

  // Independent implementation review finding: the report previously
  // discarded component (f) transparency, bootstrap n/CI, and per-season
  // activation rates - all now genuinely populated, not just schema-valid.
  const selectedCell = report.cells.find((c) => c.name === report.selection.selected.name);
  const aEvidence = selectedCell.components.a.evidence;
  assert.ok(aEvidence.endpoints, 'component (a) carries endpoint evidence');
  assert.equal(aEvidence.endpoints.length, 2, 'regret and pairwise');
  assert.ok(aEvidence.endpoints.every((e) => typeof e.n === 'number' && e.n > 0), 'surviving cluster count is real');
  assert.ok(aEvidence.endpoints.every((e) => typeof e.lower === 'number' && typeof e.upper === 'number'));

  const onCell = report.cells.find((c) => c.homeAway === 'on' && !c.isControl);
  const fTransparency = onCell.components.f.evidence.transparency;
  assert.equal(fTransparency.length, 2, 'f1 and f2, per prereg 9.8');
  assert.ok(fTransparency.every((t) => typeof t.subgroupRows === 'number' && typeof t.meanAbsBaseline === 'number'));
  assert.ok(fTransparency.every((t) => Array.isArray(t.weeklyBounds) && typeof t.medianWeeklyBound === 'number' && typeof t.qualifyingWeekCount === 'number'));
  assert.equal(onCell.components.f.evidence.veto.complete, true);
  assert.equal(onCell.components.f.evidence.veto.expectedCount, onCell.components.f.evidence.veto.realizationCount);
  assert.ok(onCell.activation.bySeason['2025'].byPosition.QB.rate > 0, 'per-season, per-position activation rate is real');
  assert.ok(onCell.activation.bySeason['2024'], 'both seasons published, per prereg 11.2');
});

test('main(): a permutation-control threshold miss produces a VOID run with no cell-level results', (t) => {
  const dir = tmpDir(t);
  const inputsPath = path.join(dir, 'inputs.json');
  const outJson = path.join(dir, 'report.json');
  const outMarkdown = path.join(dir, 'REPORT.md');
  fs.writeFileSync(inputsPath, JSON.stringify(fullPassingInputs({
    permutationControl: syntheticPermutationControl({ fail: true }),
  })));

  runBacktestSweep.main(['--inputs', inputsPath, '--out-json', outJson, '--out-markdown', outMarkdown], { expectedRosterCount: 1 });

  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(report.run.status, 'void');
  assert.equal(report.cells, null);
  assert.deepEqual(Object.keys(report.evidence), ['diagnostics']);

  const markdown = fs.readFileSync(outMarkdown, 'utf8');
  assert.match(markdown, /Status: \*\*void\*\*/);
  assert.match(markdown, /No cell-level results are published/);
  assert.doesNotMatch(markdown, /### Eight-cell metrics/);
});

test('main(): caller-published permutation evidence is prohibited; the report derives it from the gate', (t) => {
  const dir = tmpDir(t);
  const inputs = fullPassingInputs();
  inputs.evidence.permutation = { seed: 1, replicates: 1 };
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(inputs));
  assert.throws(
    () => runBacktestSweep.main([
      '--inputs', inputsPath,
      '--out-json', path.join(dir, 'report.json'),
      '--out-markdown', path.join(dir, 'REPORT.md'),
    ], { expectedRosterCount: 1 }),
    /closed shape violation.*extra permutation/
  );
});

test('main(): raw weekly evidence is cross-checked against claim and activation gate inputs', (t) => {
  const dir = tmpDir(t);
  const claimMismatch = fullPassingInputs();
  // The season predicate is load-bearing: without it this depends on SEASONS[0]
  // being '2025', and reordering SEASONS would corrupt the 2024 row instead and
  // make the assertion below fail for an unrelated reason.
  claimMismatch.evidence.metricWeeks.find((row) => row.season === '2025' && row.cell === 'usage-40-off' && row.estimand === 'paired-delta' && row.endpoint === 'regret' && row.week === 2).value = 99;
  const claimPath = path.join(dir, 'claim-mismatch.json');
  fs.writeFileSync(claimPath, JSON.stringify(claimMismatch));
  assert.throws(
    () => runBacktestSweep.main(['--inputs', claimPath, '--out-json', path.join(dir, 'claim.json'), '--out-markdown', path.join(dir, 'claim.md')], { expectedRosterCount: 1 }),
    /paired usage-40-off\/2025\/regret\/week-2 does not match component-\(a\) input/
  );

  const activationMismatch = fullPassingInputs();
  activationMismatch.evidence.activationWeeks.find((row) => row.cell === 'usage-25-on' && row.season === '2025' && row.week === 2 && row.position === 'QB').activated = 0;
  const activationPath = path.join(dir, 'activation-mismatch.json');
  fs.writeFileSync(activationPath, JSON.stringify(activationMismatch));
  assert.throws(
    () => runBacktestSweep.main(['--inputs', activationPath, '--out-json', path.join(dir, 'activation.json'), '--out-markdown', path.join(dir, 'activation.md')], { expectedRosterCount: 1 }),
    /aggregate does not match activation gate/
  );
});

test('main(): each sealed identity gate failing from raw records independently VOIDS the run', (t) => {
  const cases = [
    ['control projection mutation', (inputs) => { inputs.preflight.controlUsage25Records[0].rightRun.projections[0].median = 12.500000001; }],
    ['stored projection mutation', (inputs) => { inputs.preflight.homeAwayStoredRecords[0].rightRun.projections[0].median = 12.500000001; }],
    ['control coverage gap', (inputs) => { inputs.preflight.controlUsage25Records.pop(); }],
    ['stored coverage gap', (inputs) => { inputs.preflight.homeAwayStoredRecords.pop(); }],
  ];
  for (const [name, mutate] of cases) {
    const dir = tmpDir(t);
    const inputs = fullPassingInputs();
    mutate(inputs);
    const inputsPath = path.join(dir, 'inputs.json');
    fs.writeFileSync(inputsPath, JSON.stringify(inputs));
    runBacktestSweep.main([
      '--inputs', inputsPath,
      '--out-json', path.join(dir, 'report.json'),
      '--out-markdown', path.join(dir, 'REPORT.md'),
    ], { expectedRosterCount: 1 });
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(report.run.status, 'void', `${name} alone must void the run`);
    assert.equal(report.cells, null, name);
    assert.match(report.run.detail, /raw-evidence preflight failed: (usage-25 identity|homeaway stored identity)/, name);
  }
});

test('main(): each salt preflight failure independently VOIDS the run from raw seed records', (t) => {
  const cases = [
    ['collision', (inputs) => { inputs.preflight.saltSeedRecords[0].seedsBySalt[metrics.SALTS[1]] = 0; }],
    ['missing salt', (inputs) => { delete inputs.preflight.saltSeedRecords[0].seedsBySalt[metrics.SALTS[0]]; }],
    ['unexpected salt', (inputs) => { inputs.preflight.saltSeedRecords[0].seedsBySalt.notPreregistered = 24; }],
  ];
  for (const [name, mutate] of cases) {
    const dir = tmpDir(t);
    const inputs = fullPassingInputs();
    mutate(inputs);
    const inputsPath = path.join(dir, 'inputs.json');
    fs.writeFileSync(inputsPath, JSON.stringify(inputs));
    runBacktestSweep.main([
      '--inputs', inputsPath,
      '--out-json', path.join(dir, 'report.json'),
      '--out-markdown', path.join(dir, 'REPORT.md'),
    ], { expectedRosterCount: 1 });
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(report.run.status, 'void', name);
    assert.equal(report.cells, null, name);
    assert.match(report.run.detail, /raw-evidence preflight failed: salt seed guard/, name);
  }
});

test('main(): each component (f) raw-evidence preflight failure independently VOIDS before reduction', (t) => {
  const cases = [
    ['missing composite key', (inputs) => inputs.cells['usage-25-on'].f.veto.realizations.pop()],
    ['duplicate composite key', (inputs) => inputs.cells['usage-25-on'].f.veto.realizations.push({ ...inputs.cells['usage-25-on'].f.veto.realizations[0] })],
    ['extra composite key', (inputs) => inputs.cells['usage-25-on'].f.veto.realizations.push({ ...inputs.cells['usage-25-on'].f.veto.realizations[0], playerId: 99 })],
    ['missing incremental error', (inputs) => delete inputs.cells['usage-25-on'].f.veto.realizations[0].incrementalError],
    ['nonfinite incremental error', (inputs) => { inputs.cells['usage-25-on'].f.veto.realizations[0].incrementalError = Infinity; }],
  ];
  for (const [name, mutate] of cases) {
    const dir = tmpDir(t);
    const inputs = fullPassingInputs();
    mutate(inputs);
    const inputsPath = path.join(dir, 'inputs.json');
    fs.writeFileSync(inputsPath, JSON.stringify(inputs));
    runBacktestSweep.main([
      '--inputs', inputsPath,
      '--out-json', path.join(dir, 'report.json'),
      '--out-markdown', path.join(dir, 'REPORT.md'),
    ], { expectedRosterCount: 1 });
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(report.run.status, 'void', name);
    assert.equal(report.cells, null, name);
    assert.match(report.run.detail, /raw-evidence preflight failed: component \(f\) veto/, name);
  }
});

test('a harness failure voids IMMEDIATELY: the control never runs, and a malformed control document cannot swallow the void report (round-3 SUBSTANTIVE 3)', (t) => {
  // Round 3: the runner captured preflight failures, then called the control
  // unconditionally. A malformed control document threw inside
  // canonicalObservations and the captured sealed-identity failure was never
  // reported - no report at all - while a well-formed one burned the full
  // 10,000-replicate compute (1-3 h on real data) AFTER the harness was known
  // broken, then published control p-values inside the very report that
  // declares the harness broken. Now any harness failure skips the control
  // and the report carries an explicit NOT-RUN marker - never fabricated
  // p-values (sweepInference rejects the marker on a clean run).
  // Negative control: revert the harnessOk gate to the unconditional call -
  // case (a) throws "invalid raw observation" instead of reporting void, and
  // the spy records an invocation.
  const realCompute = metrics.computePermutationControl;
  const invocations = [];
  t.after(() => { metrics.computePermutationControl = realCompute; });
  metrics.computePermutationControl = (args) => { invocations.push(args); return realCompute(args); };

  // (a) A sealed-identity failure PLUS a malformed control document.
  const compound = fullPassingInputs();
  compound.preflight.homeAwayStoredRecords = compound.preflight.homeAwayStoredRecords
    .map(({ leftConstants, rightConstants, ...rest }) => rest);
  compound.permutationControl.observations[0] = { ...compound.permutationControl.observations[0], projected: null };
  const report = runBacktestSweep.buildReportFromInputs(compound, { expectedRosterCount: 1 });
  assert.equal(report.run.status, 'void');
  assert.match(report.run.detail, /raw-evidence preflight failed: homeaway stored identity/);
  assert.equal(report.cells, null);
  assert.equal(report.evidence, null, 'no evidence is derived on a harness the report declares broken');
  assert.equal(report.permutationControl.reason, 'not-run');
  assert.match(report.permutationControl.detail, /NOT RUN/);
  assert.equal(invocations.length, 0, 'the control must never be invoked after a harness failure');

  // (b) A canary failure alone - FIRST in section 8.6.0's pinned order, and
  // previously ungated: it voided the run only after the control had run.
  const canary = fullPassingInputs();
  canary.canariesPassed = false;
  const canaryReport = runBacktestSweep.buildReportFromInputs(canary, { expectedRosterCount: 1 });
  assert.equal(canaryReport.run.status, 'void');
  assert.match(canaryReport.run.detail, /a canary failed \(prereg 17\)/);
  assert.equal(canaryReport.permutationControl.reason, 'not-run');
  assert.equal(invocations.length, 0, 'a canary failure alone must also skip the control');
});

test('validateInputs requires raw preflight records, never operator-supplied identity/salt booleans', () => {
  const missingBoth = fullPassingInputs();
  missingBoth.preflight = true;
  assert.throws(() => runBacktestSweep.validateInputs(missingBoth), /preflight: must carry raw identity and salt-seed records/);

  const missingOne = fullPassingInputs();
  delete missingOne.preflight.homeAwayStoredRecords;
  assert.throws(
    () => runBacktestSweep.validateInputs(missingOne),
    /preflight\.homeAwayStoredRecords: must be an array/
  );

  const extraKey = fullPassingInputs();
  extraKey.preflight.someExtra = true;
  assert.throws(() => runBacktestSweep.validateInputs(extraKey), /unexpected key\(s\).*someExtra/);
});

test('main(): a missing or unparsable --inputs file fails loudly and actionably', (t) => {
  const dir = tmpDir(t);
  const missingPath = path.join(dir, 'does-not-exist.json');
  assert.throws(
    () => runBacktestSweep.main(['--inputs', missingPath, '--out-json', path.join(dir, 'r.json'), '--out-markdown', path.join(dir, 'r.md')]),
    /could not read\/parse/
  );

  const malformedPath = path.join(dir, 'malformed.json');
  fs.writeFileSync(malformedPath, '{ this is not json');
  assert.throws(
    () => runBacktestSweep.main(['--inputs', malformedPath, '--out-json', path.join(dir, 'r2.json'), '--out-markdown', path.join(dir, 'r2.md')]),
    /could not read\/parse/
  );
});

test('main(): a malformed inputs DOCUMENT (valid JSON, wrong shape) fails with a schema-specific error', (t) => {
  const dir = tmpDir(t);
  const inputsPath = path.join(dir, 'inputs.json');
  const bad = fullPassingInputs();
  delete bad.studyId;
  fs.writeFileSync(inputsPath, JSON.stringify(bad));
  assert.throws(
    () => runBacktestSweep.main(['--inputs', inputsPath, '--out-json', path.join(dir, 'r.json'), '--out-markdown', path.join(dir, 'r.md')]),
    /studyId: must be a non-empty string/
  );
});

test('main(): (b)/(c) not-applicable is reported as such, and a FAILING (b)/(c) series on a cell where it does not apply cannot fail that cell', (t) => {
  const dir = tmpDir(t);
  const inputs = fullPassingInputs();
  // usage-40-off: (c) IS applicable (blendWeight != 0.25); make it fail hard.
  inputs.cells['usage-40-off'].c = {
    regretWeekDeltas: variedSeries(1, 0.9), // wrong sign: unfavorable regret
    pairwiseWeekDeltas: variedSeries(-1, 0.9), // wrong sign: unfavorable pairwise
  };
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(inputs));
  runBacktestSweep.main([
    '--inputs', inputsPath,
    '--out-json', path.join(dir, 'report.json'),
    '--out-markdown', path.join(dir, 'REPORT.md'),
  ], { expectedRosterCount: 1 });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const usage40Off = report.cells.find((c) => c.name === 'usage-40-off');
  assert.equal(usage40Off.components.c.status, 'failed', '(c) genuinely applies to usage-40-off and genuinely fails here');
  assert.equal(usage40Off.verdict, 'fail');
  // Parsimony now selects the NEXT-best passing cell instead.
  assert.equal(report.selection.outcome, 'selected');
  assert.notEqual(report.selection.selected.name, 'usage-40-off');

  // usage-25-on: (c) is NOT applicable (blendWeight === 0.25, the control's
  // own weight) - reported not-applicable regardless of any data, since the
  // schema does not even accept c data for this cell (proven above).
  const onReport = report.cells.find((c) => c.name === 'usage-25-on');
  assert.equal(onReport.components.c.status, 'not-applicable');
  assert.equal(onReport.components.c.passes, true, 'vacuously true by definition, never by test');
  // usage-25-off (the control itself): no candidate IUT verdict at all -
  // 'baseline', not pass/fail/inconclusive/vetoed, and no components (row
  // 26 ruling: the control must not be measured against itself).
  const control = report.cells.find((c) => c.name === 'usage-25-off');
  assert.equal(control.verdict, 'baseline');
  assert.deepEqual(control.components, {});
  // Every "off" candidate cell (excluding the control, which has no
  // components at all) reports (b) not-applicable.
  for (const cell of report.cells.filter((c) => c.homeAway === 'off' && !c.isControl)) {
    assert.equal(cell.components.b.status, 'not-applicable', `${cell.name}: (b) requires homeAway = on`);
  }
});

test('main(): a cell-level ordering contradiction forces that cell inconclusive, even though every component otherwise passed (prereg 5.2/16)', (t) => {
  const dir = tmpDir(t);
  const inputs = fullPassingInputs();
  // usage-40-off would otherwise pass every component (it is the cell
  // parsimony selects first in fullPassingInputs' baseline scenario) - flag
  // it as ordering-contradicted and confirm the verdict flips to
  // inconclusive, DESPITE every component individually passing.
  inputs.cells['usage-40-off'].orderingSensitivity = {
    contradicted: true,
    detail: 'the duplicate-order shuffle flips this cell from pass to fail',
  };
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(inputs));
  runBacktestSweep.main([
    '--inputs', inputsPath,
    '--out-json', path.join(dir, 'report.json'),
    '--out-markdown', path.join(dir, 'REPORT.md'),
  ], { expectedRosterCount: 1 });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const usage40Off = report.cells.find((c) => c.name === 'usage-40-off');
  assert.equal(usage40Off.verdict, 'inconclusive');
  assert.match(usage40Off.inconclusive.join(';'), /ordering sensitivity/);
  // Every individual component still shows its own real result (passed) -
  // the contradiction overrides only the CELL-level verdict, not the
  // components themselves.
  assert.equal(usage40Off.components.a.status, 'passed');
  // Selection moves to the next cell in parsimony order.
  assert.equal(report.selection.outcome, 'selected');
  assert.notEqual(report.selection.selected.name, 'usage-40-off');
});

test('validateInputs requires orderingSensitivity: an object for every candidate cell, null for the control', () => {
  const controlWithSensitivity = fullPassingInputs();
  controlWithSensitivity.cells['usage-25-off'].orderingSensitivity = { contradicted: false, detail: null };
  assert.throws(
    () => runBacktestSweep.validateInputs(controlWithSensitivity),
    /orderingSensitivity: must be null for the control cell/
  );

  const candidateMissingSensitivity = fullPassingInputs();
  candidateMissingSensitivity.cells['usage-40-off'].orderingSensitivity = null;
  assert.throws(
    () => runBacktestSweep.validateInputs(candidateMissingSensitivity),
    /orderingSensitivity: must be an object for a candidate cell/
  );

  const badContradicted = fullPassingInputs();
  badContradicted.cells['usage-40-off'].orderingSensitivity = { contradicted: 'yes', detail: null };
  assert.throws(
    () => runBacktestSweep.validateInputs(badContradicted),
    /orderingSensitivity\.contradicted: must be a boolean/
  );
});

// ---------------------------------------------------------------------------
// Section 8.2: an unevaluable component (f) is a CELL verdict, never an abort
// ---------------------------------------------------------------------------

test('an unevaluable component (f) - all three early causes - produces cell inconclusive THROUGH the runner, never an abort (round-3 BLOCKER 1)', () => {
  // Round 3: the two pre-guard unevaluable returns carried a bare transparency
  // block, summarize mapped the absent qualifyingWeekCount to null, and the
  // runner's evidence cross-check threw on null !== weekDeltas.length - so a
  // schema-valid document whose section 8.2 outcome is cell `inconclusive`
  // aborted the whole authoritative run AFTER the full permutation-control
  // compute. The unit tests exercised componentFEndpoint directly; nothing
  // routed an unevaluable (f) through the gate - round 2's "true of the
  // library function and false of the gate", again.
  // Negative control: revert the producer returns to the bare transparency()
  // and every case below throws instead of reporting.
  // (Cheap despite three full reports: the permutationControl fixture is
  // byte-identical across cases, so the control computes once and cache-hits.)
  // HEALTHY_F_ENDPOINT is frozen and shared, so each case REPLACES f1.
  const cases = [
    ['below the minimum by clusters', {
      ...HEALTHY_F_ENDPOINT,
      weekDeltas: HEALTHY_F_ENDPOINT.weekDeltas.slice(0, 7),
      weekMeanAbsBaselines: HEALTHY_F_ENDPOINT.weekMeanAbsBaselines.slice(0, 7),
    }, 7],
    ['below the minimum by rows', { ...HEALTHY_F_ENDPOINT, subgroupRows: 29 }, 8],
    ['misaligned mean-|b| series', {
      ...HEALTHY_F_ENDPOINT,
      weekMeanAbsBaselines: HEALTHY_F_ENDPOINT.weekMeanAbsBaselines.slice(0, 7),
    }, 8],
  ];
  for (const [name, f1Replacement, expectedQualifyingWeeks] of cases) {
    const inputs = fullPassingInputs();
    inputs.cells['usage-00-on'].f.f1 = f1Replacement;
    const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
    assert.equal(report.run.status, 'valid', `${name}: sparse (f) evidence must not void or abort the run`);
    const cell = report.cells.find((c) => c.name === 'usage-00-on');
    assert.equal(cell.components.f.status, 'unevaluable', name);
    assert.equal(cell.verdict, 'inconclusive', `${name}: prereg 9.8's explicit override, section 8.2's Level-2 row`);
    const f1 = cell.components.f.evidence.transparency.find((t) => t.endpoint === 'f1-subgroup-mae');
    assert.equal(f1.qualifyingWeekCount, expectedQualifyingWeeks,
      `${name}: the qualifying week count is defined by the D_w series itself (section 6.1a item 1), evaluable or not`);
  }
});

// ---------------------------------------------------------------------------
// Reproduction: --verify-against
// ---------------------------------------------------------------------------

test('main(): --verify-against succeeds when regenerating from the SAME inputs, and fails on a genuine divergence', (t) => {
  const dir = tmpDir(t);
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(fullPassingInputs()));

  // First generation, the "committed" report.
  const committedJson = path.join(dir, 'committed-report.json');
  runBacktestSweep.main([
    '--inputs', inputsPath, '--out-json', committedJson, '--out-markdown', path.join(dir, 'committed-REPORT.md'),
  ], { expectedRosterCount: 1 });

  // Second, independent generation, verified against the first - the
  // reproduction check this script can actually offer without a Docker/DB
  // harness: same inputs, byte-identical report, every time.
  const regeneratedJson = path.join(dir, 'regenerated-report.json');
  assert.doesNotThrow(() => runBacktestSweep.main([
    '--inputs', inputsPath,
    '--out-json', regeneratedJson,
    '--out-markdown', path.join(dir, 'regenerated-REPORT.md'),
    '--verify-against', committedJson,
  ], { expectedRosterCount: 1 }));

  // A genuine divergence (different inputs) must be CAUGHT, not silently
  // accepted - proving the check actually compares content, not just that
  // both files exist.
  const divergentInputsPath = path.join(dir, 'divergent-inputs.json');
  fs.writeFileSync(divergentInputsPath, JSON.stringify(fullPassingInputs({
    permutationControl: syntheticPermutationControl({ fail: true }), // now void, a genuinely different report
  })));
  assert.throws(
    () => runBacktestSweep.main([
      '--inputs', divergentInputsPath,
      '--out-json', path.join(dir, 'divergent-report.json'),
      '--out-markdown', path.join(dir, 'divergent-REPORT.md'),
      '--verify-against', committedJson,
    ], { expectedRosterCount: 1 }),
    /NOT byte-identical.*not reproducible/s
  );
});

// ---------------------------------------------------------------------------
// Section 5's pinned denominator: the seam is test-only, the default is 50
// ---------------------------------------------------------------------------

test('main() injects section 5\'s pinned 50-roster denominator, unreachable from the CLI and the --inputs document (NEW-B)', (t) => {
  // The seam is a test-only options parameter. Three boundaries keep the count
  // out of an operator's hands, each pinned here:
  assert.throws(
    () => runBacktestSweep.parseArgs(['--inputs', 'a.json', '--out-json', 'b.json', '--out-markdown', 'c.md', '--expected-roster-count', '1']),
    /unknown argument --expected-roster-count/
  );
  const doc = fullPassingInputs();
  doc.permutationControl.expectedRosterCount = 1;
  assert.throws(() => runBacktestSweep.validateInputs(doc), /unexpected key\(s\).*expectedRosterCount/);
  // And with NO override, main() injects the pinned 50: the 1-roster fixture
  // is rejected on the count mismatch, proving the default END TO END through
  // the CLI and the file path. Cheap: assertPolicyArtifactDomain throws before
  // the policy context is built or a replicate runs - and rejections are never
  // cached, so this cannot poison the earlier successful runs.
  // Negative control: change the runner default to 1 - this stops throwing.
  const dir = tmpDir(t);
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(fullPassingInputs()));
  assert.throws(
    () => runBacktestSweep.main([
      '--inputs', inputsPath,
      '--out-json', path.join(dir, 'report.json'),
      '--out-markdown', path.join(dir, 'REPORT.md'),
    ]),
    /carries 1 rosters, not the 50 /
  );
});

test('buildReportFromInputs rejects a contradicted injected count and an unknown override key (NEW-B)', () => {
  // The count participates in the cache key, so the count-3 call cannot
  // stale-hit the earlier successful { expectedRosterCount: 1 } runs on the
  // same fixture - dropping expectedRosterCount from the key turns this throw
  // into a silently-returned stale success, which is the negative control.
  // PREMISE, self-checked: a count-1 SUCCESS on this exact fixture must exist
  // in-process before the contradicted call, or the negative control above
  // has no stale entry to hit and this test proves less than it claims. This
  // call makes the premise local (cache hit if the earlier main() tests ran;
  // a fresh computation under test isolation) instead of order-coupled.
  assert.ok(runBacktestSweep.buildReportFromInputs(fullPassingInputs(), { expectedRosterCount: 1 }));
  assert.throws(
    () => runBacktestSweep.buildReportFromInputs(fullPassingInputs(), { expectedRosterCount: 3 }),
    /carries 1 rosters, not the 3 /
  );
  // A typo'd override must throw, not silently configure nothing.
  assert.throws(
    () => runBacktestSweep.buildReportFromInputs(fullPassingInputs(), { expectedRosterCounts: 1 }),
    /unknown override key\(s\): expectedRosterCounts/
  );
});
