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
const { ORDERINGS } = require('../../scripts/backtest/lib/ordering');

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

// Round 3, SUBSTANTIVE 2: the four (f) gate operands are DERIVED from
// preflight.matchedOffBaselineRows, so the endpoint input carries only its
// weekDeltas series and the RAW DOMAIN below is what makes (f) evaluable:
// 8 qualifying 2025 weeks x 5 players = 40 subgroup rows (b = -1 everywhere,
// so mean |b| = max |b| = 1.0 and every week's transformed bound
// 0.05*1.0 + 0.01 = 0.06 clears DELTA_F 0.025). The previous fixture
// SUPPLIED subgroupRows 40 beside a raw domain of one player-week - the
// round-3 reviewer showed the flagship fixture passed only via the
// unreconciled copies.
const COHORT_WEEKS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9]);
const COHORT_PLAYERS = Object.freeze([7, 8, 9, 10, 11]);

// f2 ONLY: f1's series is DERIVED from the veto realizations (round 5), so
// the document carries no f1 key at all.
const HEALTHY_F_ENDPOINT = Object.freeze({
  weekDeltas: new Array(COHORT_WEEKS.length).fill(-0.01),
});

function healthyFVeto(subgroupPlayerWeeks) {
  const playerWeeks = subgroupPlayerWeeks
    || COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.map((playerId) => ({ week, playerId })));
  return {
    // -0.01: FAVOURABLE. The old +0.01 made the fixture internally false -
    // its supplied f1 series said -0.01 while its own realizations said
    // +0.01, sign-opposite, and nothing looked for two rounds (round 5,
    // SUBSTANTIVE F). Under derivation the realizations ARE f1's series, and
    // a comfortably-passing flagship should not describe a harmful
    // configuration.
    realizations: playerWeeks.flatMap(({ week, playerId }) => metrics.SALTS.map((salt) => (
      { season: 2025, week, playerId, salt, incrementalError: -0.01 }
    ))),
  };
}

function syntheticPreflight() {
  const cohortRosterRows = COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.map((playerId) => (
    // Roster rows carry prereg 4.1's eligibility facts (the A4 membership
    // ruling): every synthetic member is a macro-position non-bye, so the
    // subgroup stays the full cohort and the older expectations hold.
    { season: 2025, week, playerId, position: 'RB', onBye: false }
  )));
  const rawRun = () => ({
    projections: COHORT_PLAYERS.map((playerId) => ({ playerId, median: 12.5 + playerId, p10: 4, factors: {} })),
    inputCutoff: '2025-09-01T00:00:00.000Z', sourceCoverage: { synthetic: true },
  });
  // Section 8.6.1's single-leaf guard runs on the constants the two arms were
  // ACTUALLY built with, so the records carry them. The on-stored arm differs
  // from its twin in exactly homeAway.useStoredHistory.
  const model = require('../services/projectionModel');
  const usage25 = arms.ALL_CELLS.find((cell) => cell.blendWeight === 0.25 && cell.homeAway === 'on');
  const baseResolved = () => arms.resolveConstants({ cell: usage25, baseConstants: model.MODEL_CONSTANTS });
  const storedResolved = () => arms.resolveConstantsWithStoredHistory({ cell: usage25, baseConstants: model.MODEL_CONSTANTS });
  const records = () => COHORT_WEEKS.flatMap((week) => metrics.SALTS.map((salt) => ({
    season: 2025, week, salt,
    leftPlayerIds: [...COHORT_PLAYERS], rightPlayerIds: [...COHORT_PLAYERS],
    leftRun: rawRun(), rightRun: rawRun(),
    leftConstants: baseResolved(), rightConstants: storedResolved(),
  })));
  return {
    cohortRosterRows,
    controlUsage25Records: records(),
    homeAwayStoredRecords: records(),
    saltSeedRecords: arms.ALL_CELLS.flatMap((cell) => COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.map((playerId) => ({
      cellName: cell.name, season: 2025, week, playerId,
      seedsBySalt: Object.fromEntries(metrics.SALTS.map((salt, index) => [salt, index])),
    })))),
    matchedOffBaselineRows: arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').flatMap((cell) => COHORT_WEEKS.flatMap((week) => COHORT_PLAYERS.map((playerId) => ({
      cellName: cell.name, season: 2025, week, playerId, baseline: -1,
    })))),
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
      f: isOnCell ? { f2: HEALTHY_F_ENDPOINT, veto: healthyFVeto() } : null,
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
    sensitivityAudit: passingSensitivityAudit(),
    cells,
    evidence,
  };
}

/**
 * Decision D6: a self-consistent audit trail for a clean run - every pass
 * selects the same winner, no halt.  The winners are attested producer data
 * (the reducer cannot recompute them), so they need not match the verdicts
 * the fixture's cells produce; only the trail's internal story and the
 * document's `deployedPolicyDisagreement` are checkable.
 */
function passingSensitivityAudit() {
  return {
    winnersByPass: {
      'ordering:db-collation': 'usage-40-off',
      'ordering:duplicate-shuffle': 'usage-40-off',
      'estimand:force-fill': 'usage-40-off',
    },
    estimandReconciliation: {
      selection: 'usage-40-off',
      halted: false,
      reason: null,
      detail: 'both estimands select the same cell',
      winners: { deployedPolicy: 'usage-40-off', forceFill: 'usage-40-off' },
    },
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

test('decision D6: validateInputs refuses a document whose audit trail is missing, self-contradictory, or contradicts the halt boolean', () => {
  const missing = fullPassingInputs();
  delete missing.sensitivityAudit;
  assert.throws(() => runBacktestSweep.validateInputs(missing), /sensitivityAudit: must be the derived audit-trail object/);

  // The trail's own halt disagreeing with the boolean the run verdict
  // consumes - a document telling two stories - is rejected even though each
  // half is well-formed on its own.
  const laundered = fullPassingInputs();
  laundered.deployedPolicyDisagreement = true;
  assert.throws(() => runBacktestSweep.validateInputs(laundered), /deployedPolicyDisagreement=true disagrees with the audit trail's halted=false/);

  const inconsistent = fullPassingInputs();
  inconsistent.sensitivityAudit.estimandReconciliation.halted = true;
  assert.throws(() => runBacktestSweep.validateInputs(inconsistent), /halted=true contradicts its own winners/);

  const missingPass = fullPassingInputs();
  delete missingPass.sensitivityAudit.winnersByPass['ordering:duplicate-shuffle'];
  assert.throws(() => runBacktestSweep.validateInputs(missingPass), /missing required pass "ordering:duplicate-shuffle"/);

  const controlWinner = fullPassingInputs();
  controlWinner.sensitivityAudit.winnersByPass['ordering:db-collation'] = 'usage-25-off';
  assert.throws(() => runBacktestSweep.validateInputs(controlWinner), /must be null or a candidate cell name/);
});

test('decision D6: the ORDERING-axis cross-check, symmetric with the halted-axis one (adversarial QA F2)', () => {
  // With no contradicted candidate, orderingDisagreement=false forces every
  // ordering winner to equal the deployed-policy winner - a laundered
  // ordering trail beside a clean boolean is a document telling two stories.
  const laundered = fullPassingInputs();
  laundered.sensitivityAudit.winnersByPass['ordering:db-collation'] = 'usage-60-on';
  assert.throws(() => runBacktestSweep.validateInputs(laundered), /a laundered ordering trail beside a clean boolean/);

  // The reverse direction: a claimed disagreement the trail does not show.
  const phantomDisagreement = fullPassingInputs();
  phantomDisagreement.orderingDisagreement = true;
  assert.throws(() => runBacktestSweep.validateInputs(phantomDisagreement), /the boolean claims a disagreement the trail does not show/);

  // With a contradicted candidate the stage-1 and stage-2 bases genuinely
  // diverge (the generation suite exercises primaryWinner A vs
  // finalPrimaryWinner B), so no cross-winner constraint applies.
  const contradicted = fullPassingInputs();
  contradicted.cells['usage-60-on'].orderingSensitivity = { contradicted: true, detail: 'variant demoted it' };
  contradicted.sensitivityAudit.winnersByPass['ordering:db-collation'] = 'usage-60-on';
  assert.doesNotThrow(() => runBacktestSweep.validateInputs(contradicted));
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
  offWithF.cells['usage-40-off'].f = { f2: HEALTHY_F_ENDPOINT };
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
  // f1 is DERIVED (round 5), so the tie-heavy state is produced through the
  // REALIZATIONS: weeks 2 and 3's per-week mean incrementalError lands
  // exactly on DELTA_F. The derivation cannot produce 0.025 bit-exactly
  // (float drift at the last ulp), and the ties survive anyway because
  // exactSignTest ties on roundToTie(x - margin) - which is 0 for the
  // drifted value. If that tie test is ever "simplified" to x === margin,
  // this test and the study's tie convention both break silently.
  for (const row of inputs.cells['usage-25-on'].f.veto.realizations) {
    if (row.week === 2 || row.week === 3) row.incrementalError = arms.DELTA_F;
  }
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
  // Section 6.4a's attestation is checkable on the MARKDOWN artifact alone,
  // not only the JSON one (round-4 QA follow-up).
  assert.match(markdown, /veto coverage: subgroup player-weeks=40, expected=960, realized=960, complete=true/);
  assert.match(markdown, /### Eight-cell metrics/);
  // Section 8.7 rule 1: the factorial family is the formal primary, half_ppr.
  assert.match(markdown, /\| 2025 \| half_ppr \| usage-25-off \| absolute \| regret \|/);
  // Section 4.6.1: both seasons are published.
  assert.match(markdown, /\| 2024 \| half_ppr \| usage-25-off \| absolute \| regret \|/);
  // Section 8.7 rule 4: prereg 16's family carries standard and ppr, 2025 only.
  assert.match(markdown, /### Scoring-profile sensitivity \(prereg 16\)/);
  assert.match(markdown, /\| 2025 \| standard \| usage-25-off \| absolute \| regret \|/);
  assert.match(markdown, /\| 2025 \| ppr \| usage-25-off \| absolute \| regret \|/);
  // Decision D2 (2026-08-08): prereg 16's week-window families - weeks-2-17
  // and the Week-18 absolute rows on their own, primary profile, both seasons.
  assert.match(markdown, /### Week-window sensitivity \(prereg 16\)/);
  assert.match(markdown, /\| 2025 \| half_ppr \| usage-25-off \| weeks-2-17 \| absolute \| regret \|/);
  assert.match(markdown, /\| 2024 \| half_ppr \| usage-25-off \| week-18-only \| absolute \| regret \|/);
  // The one-cluster Week-18 row publishes a degenerate point with no interval.
  assert.match(markdown, /week-18-only \| absolute \| regret \| [-\d.]+ \| \[-, -\] \| degenerate \| 1 \|/);
  // Section 4.6: mandatory self-description distinguishes the two methods.
  assert.match(markdown, /percentile-cluster-bootstrap \| 100000 \| 1499811874/);
  assert.match(markdown, /moving-block-bootstrap \| 100000 \| 588165040/);
  assert.match(markdown, /### Moving-block sensitivity/);
  assert.match(markdown, /### Attribution composites/);
  assert.match(markdown, /### Activation aggregates/);
  assert.doesNotMatch(markdown, /Eight-cell metrics: \d+/);
  // Decision D6: the audit trail publishes in the report AND the Markdown.
  assert.deepEqual(report.sensitivityAudit.winnersByPass, {
    'estimand:force-fill': 'usage-40-off',
    'ordering:db-collation': 'usage-40-off',
    'ordering:duplicate-shuffle': 'usage-40-off',
  });
  assert.equal(report.sensitivityAudit.estimandReconciliation.halted, false);
  assert.equal(report.sensitivityAudit.estimandReconciliation.winners.deployedPolicy, 'usage-40-off');
  assert.match(markdown, /## Sensitivity audit \(spec 8\.4\/8\.5\)/);
  assert.match(markdown, /- winner estimand:force-fill: usage-40-off/);
  assert.match(markdown, /- estimand reconciliation: halted=false, selection=usage-40-off, deployedPolicy=usage-40-off, forceFill=usage-40-off/);

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
  // Decision D6: the audit trail is selection-level evidence, so a void run
  // publishes null - mirroring cells (prereg 7.3).
  assert.equal(report.sensitivityAudit, null);
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
    // Round-5 QA: since f1's series is DERIVED from this field, a coercible
    // string previously slipped the preflight's coercing guard and flowed
    // into a PUBLISHED VERDICT (Number('0.19') everywhere downstream) - the
    // one realization field whose value feeds arithmetic must be a real
    // number, and a violation voids like its non-finite siblings, never
    // scores. Negative control: revert the coverage assertion's strict
    // typeof to the coercing isFiniteNumber - this case publishes a valid
    // run with a verdict instead of voiding.
    ['coercible string incremental error', (inputs) => { inputs.cells['usage-25-on'].f.veto.realizations[0].incrementalError = '0.19'; }],
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

// Flip a slice of usage-00-on's matched-off baselines POSITIVE (out of the
// b <= 0 subgroup), and shrink the cell's veto realizations to the surviving
// subgroup - the veto domain is b <= 0 too, and its coverage is asserted.
function flipBaselinesPositive(inputs, predicate) {
  for (const row of inputs.preflight.matchedOffBaselineRows) {
    if (row.cellName === 'usage-00-on' && predicate(row)) row.baseline = 1;
  }
  const surviving = inputs.preflight.matchedOffBaselineRows
    .filter((row) => row.cellName === 'usage-00-on' && row.baseline <= 0)
    .map(({ week, playerId }) => ({ week, playerId }));
  inputs.cells['usage-00-on'].f.veto = healthyFVeto(surviving);
  return surviving;
}

test('an unevaluable component (f) - sparse RAW evidence - produces cell inconclusive THROUGH the runner, never an abort (round-3 BLOCKER 1)', () => {
  // Round 3: the two pre-guard unevaluable returns carried a bare transparency
  // block, summarize mapped the absent qualifyingWeekCount to null, and the
  // runner's evidence cross-check threw on null !== weekDeltas.length - so a
  // schema-valid document whose section 8.2 outcome is cell `inconclusive`
  // aborted the whole authoritative run AFTER the full permutation-control
  // compute. The unit tests exercised componentFEndpoint directly; nothing
  // routed an unevaluable (f) through the gate - round 2's "true of the
  // library function and false of the gate", again.
  // Sparsity now lives in the RAW rows (the operands are derived), so each
  // case shapes the matched-off baseline domain rather than supplied numbers.
  // Negative control: revert the producer returns to the bare transparency()
  // and every case below throws instead of reporting.
  // (Cheap despite two full reports: the permutationControl fixture is
  // byte-identical across cases, so the control computes once and cache-hits.)
  const cases = [
    ['below the minimum by clusters', (inputs) => {
      // Weeks 8 and 9 leave the subgroup: 6 qualifying weeks x 5 players =
      // 30 rows (rows pass at exactly the minimum, clusters 6 < 8). Both
      // endpoints' weekDeltas shrink to match the derived week set.
      flipBaselinesPositive(inputs, (row) => row.week >= 8);
      // f1's derived series auto-tracks the surviving weeks; only the
      // supplied f2 series must shrink to match.
      inputs.cells['usage-00-on'].f.f2 = { weekDeltas: new Array(6).fill(-0.01) };
    }, 6],
    ['below the minimum by rows', (inputs) => {
      // 11 player-weeks leave the subgroup, spread so every week keeps at
      // least one row: 8 clusters, 29 rows < 30.
      flipBaselinesPositive(inputs, (row) => ((row.playerId === 8 || row.playerId === 9) && row.week <= 6)
        || (row.playerId === 8 && row.week === 7));
    }, 8],
  ];
  for (const [name, mutate, expectedQualifyingWeeks] of cases) {
    const inputs = fullPassingInputs();
    mutate(inputs);
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

test('the (f) gate operands are DERIVED from the raw rows; the document may not supply them (round-3 SUBSTANTIVE 2)', () => {
  // The four operands were read verbatim from the document and "cross-checked"
  // against the copies they were read from, while the raw rows contradicted
  // them - the round-2 fixture published subgroupRows 40 beside a derived
  // one-player-week veto domain in a single valid report. Now the operands
  // derive from preflight.matchedOffBaselineRows (section 6.1a item 2 run as
  // code), the document cannot carry them, and the published transparency and
  // veto domain come from the SAME rows.
  // Negative control: revert assembleCellClaim to spread the document's f
  // endpoints verbatim - the derived assertions below fail on null.
  const supplied = fullPassingInputs();
  supplied.cells['usage-00-on'].f.f2 = { weekDeltas: new Array(8).fill(-0.01), subgroupRows: 40 };
  assert.throws(() => runBacktestSweep.validateInputs(supplied), /unexpected key\(s\): subgroupRows/);

  const report = runBacktestSweep.buildReportFromInputs(fullPassingInputs(), { expectedRosterCount: 1 });
  const cell = report.cells.find((c) => c.name === 'usage-00-on');
  const f1 = cell.components.f.evidence.transparency.find((t) => t.endpoint === 'f1-subgroup-mae');
  assert.equal(f1.subgroupRows, 40, 'derived: 8 weeks x 5 players, all b <= 0');
  assert.equal(f1.meanAbsBaseline, 1, 'derived mean |b|; a supplied copy can no longer disagree');
  assert.equal(f1.maxAbsBaseline, 1, 'derived max |b|; the old fixture SUPPLIED 2.0 against raw rows of |b| = 1');
  assert.equal(f1.qualifyingWeekCount, 8);
  const veto = cell.components.f.evidence.veto;
  assert.equal(veto.expectedCount, metrics.SALTS.length * 40, 'the veto domain and the gate operands come from the same raw rows');
  assert.equal(veto.complete, true);
});

test('a weekDeltas series misaligned with the DERIVED qualifying weeks is a malformed document, never sparse evidence (round-3 SUBSTANTIVE 2)', () => {
  // Section 6.1a item 1 pins the qualifying weeks as "the identical week set
  // the endpoint's own D_w series is built from". Under the supplied-operand
  // contract this was unverifiable (clusters WAS the supplied array's own
  // length); under derivation a disagreement is a malformed document.
  const inputs = fullPassingInputs();
  inputs.cells['usage-00-on'].f.f2 = { weekDeltas: new Array(7).fill(-0.01) };
  assert.throws(
    () => runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 }),
    /carries 7 weekDeltas against 8 derived qualifying weeks/
  );
});

test('a matched-off baseline row OUTSIDE the cohort domain voids the run - extra raw rows cannot widen the (f) gate operands (round-3 SUBSTANTIVE 2, QA follow-up)', () => {
  // QA probe on the first derivation: baseline rows for weeks the cohort
  // never carried inflated subgroupRows/qualifyingWeekCount past the veto
  // domain with the preflight green - SUBSTANTIVE 2's divergence by another
  // door, extra raw rows instead of a free-hand number. The preflight now
  // rejects the superset outright (extra input is rejected, never silently
  // ignored), and the derivation additionally intersects with the cohort as
  // defense in depth.
  // Negative control: remove the preflight rejection - this reports VALID
  // (the derivation's own intersection holds the operands at 40) instead of
  // VOID, and the assertion below fails.
  const inputs = fullPassingInputs();
  for (const week of [10, 11, 12]) {
    for (const playerId of COHORT_PLAYERS) {
      inputs.preflight.matchedOffBaselineRows.push({ cellName: 'usage-00-on', season: 2025, week, playerId, baseline: -1 });
    }
  }
  const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
  assert.equal(report.run.status, 'void');
  assert.match(report.run.detail, /OUTSIDE the cohort domain/);
});

test('deriveComponentFOperands pins per-week grouping, 2025 scoping, the b <= 0 boundary, cohort intersection, prereg-4.1 eligibility, and mean-vs-max (round-3 SUBSTANTIVE 2, QA follow-up; A4 ruling)', () => {
  // The flagship fixture is uniform (|b| = 1 everywhere), so it cannot
  // distinguish mean from max, per-week grouping from a flat fill, or the
  // season filter from its absence. This heterogeneous row set can - each
  // excluded row below is excluded by exactly one filter.
  const matchedOffBaselineRows = [
    { cellName: 'usage-00-on', season: 2025, week: 2, playerId: 7, baseline: -1 },
    { cellName: 'usage-00-on', season: 2025, week: 2, playerId: 8, baseline: -3 },
    // b = 0 is IN the subgroup (prereg 9.8: "at or below zero").
    { cellName: 'usage-00-on', season: 2025, week: 4, playerId: 7, baseline: 0 },
    // Excluded: positive baseline (out of subgroup, in cohort).
    { cellName: 'usage-00-on', season: 2025, week: 3, playerId: 7, baseline: 2 },
    // Excluded: 2024 (in cohort - only the season filter removes it).
    { cellName: 'usage-00-on', season: 2024, week: 2, playerId: 7, baseline: -5 },
    // Excluded: another cell's row.
    { cellName: 'usage-25-on', season: 2025, week: 2, playerId: 7, baseline: -7 },
    // Excluded: outside the cohort domain (the intersection, defense in depth).
    { cellName: 'usage-00-on', season: 2025, week: 9, playerId: 99, baseline: -9 },
    // Excluded: ON BYE with b <= 0 - only prereg-4.1 eligibility (the A4
    // ruling) removes it; its exactly-zero error pair must not dilute D_w.
    { cellName: 'usage-00-on', season: 2025, week: 5, playerId: 7, baseline: -4 },
    // Excluded: non-macro position with b <= 0, same ruling, other leg.
    { cellName: 'usage-00-on', season: 2025, week: 6, playerId: 11, baseline: -6 },
  ];
  const cohortRosterRows = [
    { season: 2025, week: 2, playerId: 7, position: 'RB', onBye: false }, { season: 2025, week: 2, playerId: 8, position: 'WR', onBye: false },
    { season: 2025, week: 3, playerId: 7, position: 'RB', onBye: false }, { season: 2025, week: 4, playerId: 7, position: 'RB', onBye: false },
    { season: 2024, week: 2, playerId: 7, position: 'RB', onBye: false }, { season: 2025, week: 9, playerId: 7, position: 'RB', onBye: false },
    { season: 2025, week: 5, playerId: 7, position: 'RB', onBye: true },
    { season: 2025, week: 6, playerId: 11, position: 'FB', onBye: false },
  ];
  const derived = runBacktestSweep.deriveComponentFOperands('usage-00-on', { matchedOffBaselineRows, cohortRosterRows });
  assert.deepEqual(derived, {
    subgroupRows: 3,
    meanAbsBaseline: (1 + 3 + 0) / 3,
    maxAbsBaseline: 3, // mean !== max here; a swapped derivation fails
    // Ascending weeks [2, 4]; a flat fill of the pooled mean would give
    // [4/3, 4/3] and lose the per-week grouping section 6.1a item 2 defines.
    weekMeanAbsBaselines: [2, 0],
    qualifyingWeeks: [2, 4],
    qualifyingWeekCount: 2,
  });
});

test('a supplied f.f1 is rejected outright - the document may not carry a second source of truth for a derived series (round-5 SUBSTANTIVE F)', () => {
  const supplied = fullPassingInputs();
  supplied.cells['usage-00-on'].f.f1 = { weekDeltas: new Array(8).fill(-0.01) };
  assert.throws(
    () => runBacktestSweep.validateInputs(supplied),
    /unexpected key\(s\): f1 - f1's D_w series is DERIVED from f\.veto\.realizations/
  );
});

test('deriveComponentFOneSeries: the section 6.3 form, the 2025 filter, pinned iteration order, and week-set equality (round-5 SUBSTANTIVE F)', () => {
  // Three qualifying weeks plus a 2024 realization that must be EXCLUDED by
  // the season filter (it belongs to the veto's wider domain, not f1's).
  // Week 6's rows are deliberately INSERTED out of pid order (9, 7, 8) with
  // values whose reduce is order-sensitive in the last ulp.
  const realizations = [];
  for (const salt of metrics.SALTS) {
    realizations.push({ season: 2025, week: 2, playerId: 7, salt, incrementalError: 0.1 });
    realizations.push({ season: 2025, week: 2, playerId: 8, salt, incrementalError: 0.3 });
    realizations.push({ season: 2025, week: 4, playerId: 7, salt, incrementalError: -0.05 });
    realizations.push({ season: 2024, week: 2, playerId: 7, salt, incrementalError: 99 });
    realizations.push({ season: 2025, week: 6, playerId: 9, salt, incrementalError: 0.35 });
    realizations.push({ season: 2025, week: 6, playerId: 7, salt, incrementalError: 0.1 });
    realizations.push({ season: 2025, week: 6, playerId: 8, salt, incrementalError: 0.2 });
  }
  const series = runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
    realizations, qualifyingWeeks: [2, 4, 6],
  });
  assert.equal(series.length, 3);
  // EXACT BIT equality, not a tolerance (round-5 QA): a 1e-12 window is four
  // orders of magnitude wider than the last-ulp differences the literal 6.3
  // form exists to pin, so it cannot tell this form from the flat mean it
  // was chosen over - and arms publishes the raw D_w as test.bound, so a
  // form change alters report BYTES while a tolerance test stays green.
  // Negative controls: a flat-mean rewrite fails weeks 2 and 6 (week 6 flat
  // is 0.21666666666666642); dropping the ascending-pid sort fails week 6
  // (its insertion-order reduce lands on 0.2166666666666667). All three
  // values survive the 24-salt mean distinct - triples where the per-salt
  // means differ but the salt means collapse exist, and this one was chosen
  // because it does not.
  assert.equal(series[0], 0.20000000000000007, `week 2 (literal form): ${series[0]}`);
  assert.equal(series[1], -0.05000000000000002, `week 4: ${series[1]}`);
  assert.equal(series[2], 0.21666666666666676, `week 6 (pid-ascending reduce): ${series[2]}`);

  // Week-set equality fails closed BOTH ways (section 6.1a item 1).
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations, qualifyingWeeks: [2],
    }),
    /a 2025 realization for week 4 lies outside the derived qualifying/
  );
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations, qualifyingWeeks: [2, 4, 6, 9],
    }),
    /qualifying week 9 has no 2025 realizations/
  );

  // Own-layer guards (round-5 QA): unreachable through main() because the
  // preflight coverage assertion rejects both states first, but the function
  // is exported, and without them a NaN pid collapses distinct players onto
  // one Map key and a duplicate (playerId, salt) row last-write-wins - both
  // silently mis-averaging.
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations: metrics.SALTS.flatMap((salt) => [
        { season: 2025, week: 2, playerId: 'alice', salt, incrementalError: 0.1 },
        { season: 2025, week: 2, playerId: 'bob', salt, incrementalError: 99 },
      ]),
      qualifyingWeeks: [2],
    }),
    /week 2 realization has a non-finite playerId \("alice"\)/
  );
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations: [
        ...metrics.SALTS.map((salt) => ({ season: 2025, week: 2, playerId: 7, salt, incrementalError: 0.1 })),
        { season: 2025, week: 2, playerId: 7, salt: metrics.SALTS[0], incrementalError: 99 },
      ],
      qualifyingWeeks: [2],
    }),
    /week 2 has duplicate realizations for playerId 7, salt/
  );

  // A player-week missing one salt must name the TRUE cause - a missing
  // player row - not saltPairedDelta's "salt ... is missing", since every
  // salt key is constructed and none is ever absent (round-6 MINOR I).
  // Negative control: remove the salt-coverage guard - the message reverts
  // to the salt-blaming one and this regex fails.
  const missingOneSalt = metrics.SALTS.flatMap((salt) => [
    { season: 2025, week: 2, playerId: 7, salt, incrementalError: 0.1 },
    { season: 2025, week: 2, playerId: 8, salt, incrementalError: 0.2 },
  ]);
  missingOneSalt.splice(missingOneSalt.findIndex((r) => r.playerId === 8 && r.salt === metrics.SALTS[3]), 1);
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations: missingOneSalt, qualifyingWeeks: [2],
    }),
    /week 2 playerId 8 has realizations for 23 of 24 salts - missing/
  );

  // Round-6 QA hardening of that guard - MEMBERSHIP, not cardinality:
  // (a) a size-preserving salt SUBSTITUTION (one character changed) keeps
  // size 24 and previously walked past the check, resurrecting the exact
  // salt-blaming message the guard was added against;
  // (b) a pure ADDITION made "25 of 24 - missing ." with an empty list.
  // Negative control: revert the check to bySalt.size !== SALTS.length -
  // (a) reverts to the saltPairedDelta message and its regex fails.
  const substituted = metrics.SALTS.flatMap((salt) => [
    { season: 2025, week: 2, playerId: 7, salt, incrementalError: 0.1 },
    { season: 2025, week: 2, playerId: 8, salt: salt === metrics.SALTS[3] ? `${metrics.SALTS[3]}x` : salt, incrementalError: 0.2 },
  ]);
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations: substituted, qualifyingWeeks: [2],
    }),
    /week 2 playerId 8 has realizations for 24 of 24 salts - missing pit-04-[0-9a-f]+ - carrying unknown salt\(s\)/
  );
  const added = metrics.SALTS.flatMap((salt) => [
    { season: 2025, week: 2, playerId: 7, salt, incrementalError: 0.1 },
  ]);
  added.push({ season: 2025, week: 2, playerId: 7, salt: 'pit-99-deadbeefcafe', incrementalError: 0.1 });
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations: added, qualifyingWeeks: [2],
    }),
    /25 of 24 salts - carrying unknown salt\(s\) pit-99-deadbeefcafe/
  );

  // WHICH partial player gets named must not depend on document row order:
  // both players below are partial, rows arrive with pid 8 first, and the
  // sorted iteration names pid 7.
  const twoPartial = metrics.SALTS.slice(1).flatMap((salt) => [
    { season: 2025, week: 2, playerId: 8, salt, incrementalError: 0.2 },
    { season: 2025, week: 2, playerId: 7, salt, incrementalError: 0.1 },
  ]);
  assert.throws(
    () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
      realizations: twoPartial, qualifyingWeeks: [2],
    }),
    /week 2 playerId 7 has realizations for 23 of 24 salts/
  );

  // The one field that determines the published number gets its own strict
  // layer too (round-6 QA): at this exported layer a null previously
  // coerced to a MEASURED ZERO and a '0.2' string into a verdict.
  for (const [bad, renderedAs] of [[null, 'null'], ['0.2', '"0.2"'], [NaN, 'NaN']]) {
    const badInc = metrics.SALTS.flatMap((salt) => [
      { season: 2025, week: 2, playerId: 7, salt, incrementalError: salt === metrics.SALTS[5] ? bad : 0.1 },
    ]);
    assert.throws(
      () => runBacktestSweep.deriveComponentFOneSeries('usage-00-on', {
        realizations: badInc, qualifyingWeeks: [2],
      }),
      new RegExp(`week 2 playerId 7 salt pit-06-[0-9a-f]+: incrementalError must be a finite number, got ${renderedAs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
  }
});

test('a document whose realizations state HARM cannot publish a passing (f) - the derived series IS the evidence (round-5 SUBSTANTIVE F)', () => {
  // Round 5's verdict flip: realizations all +0.19 (harmful, below the 0.20
  // catastrophic cap, so no veto fires) previously coexisted with a supplied
  // favourable series and the cell PASSED. Under derivation the same
  // document fails, because the series is now computed from the evidence the
  // document itself attests complete.
  // Negative control: replace the derived series at the componentF call with
  // a fabricated favourable one - this test reports pass and fails.
  const inputs = fullPassingInputs();
  for (const row of inputs.cells['usage-00-on'].f.veto.realizations) {
    row.incrementalError = 0.19;
  }
  const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
  assert.equal(report.run.status, 'valid');
  const cell = report.cells.find((c) => c.name === 'usage-00-on');
  assert.equal(cell.components.f.status, 'failed', 'eight weeks of +0.19 against a 0.025 margin');
  assert.equal(cell.verdict, 'fail');
  assert.equal(cell.components.f.evidence.veto.catastrophicVeto, false, '0.19 is harmful but below the cap - the veto is not what catches this');
});

test('a component (f) week delta that is null, non-finite, or non-numeric is a MALFORMED document - absent evidence can never pass the no-harm gate (round-4 BLOCKER A)', () => {
  // Round 4: Number(null) === 0, the most favourable value the margin-shifted
  // sign test can see - a schema-valid document with NO (f) evidence at all
  // published a valid run with f passed (exactP 0.00390625) and a selected
  // cell. A qualifying week's delta is computable by construction (the same
  // document's veto coverage asserts a realization for every subgroup
  // player-week x salt), so an absent or non-finite entry contradicts the
  // document itself: throw-class at validation, never sparse evidence. This
  // is deliberately NOT the dropWeeks convention, which exists for series
  // whose weeks can legitimately drop.
  // Negative control: remove the validateInputs entry check - the all-null
  // document then dies on arms' own fail-closed guard with a DIFFERENT
  // message and this regex fails; remove both layers and the round-4
  // reviewer's `passed` verdict reproduces.
  for (const [name, badDeltas] of [
    ['all null - no evidence at all', new Array(8).fill(null)],
    ['one null week', [null, ...new Array(7).fill(-0.01)]],
    ['NaN entry', new Array(8).fill(NaN)],
    ['string entry', new Array(8).fill('x')],
  ]) {
    const inputs = fullPassingInputs();
    inputs.cells['usage-00-on'].f.f2 = { weekDeltas: badDeltas };
    assert.throws(
      () => runBacktestSweep.validateInputs(inputs),
      /every entry must be a finite number/,
      name
    );
  }
});

test('every co-primary and (e2) week delta must be a finite NUMBER - coercible and malformed values are rejected at the boundary, with the key named (round-5 MINOR G)', (t) => {
  // Round 5: the container check accepted anything object-shaped. A quoted
  // number ('0.5') survived dropWeeks' coercing presence filter and
  // string-concatenated into bootstrapMean's accumulator - an unlocated
  // classifyBootstrapEndpoint abort on non-integer data, and on all-integer
  // data a FINITE corrupted bound (6.5e14) published inside a valid run.
  // Malformed values (NaN, 'n/a', {nonfinite}) were silently
  // indistinguishable from a sanctioned dropped week: three of them flipped
  // a cell verdict and moved the SELECTED cell with no diagnostic.
  // Negative control: remove the assertWeekDeltaSeries value loop - the
  // quoted-number case aborts from classifyBootstrapEndpoint instead and the
  // located-message assertion fails.
  const seriesSites = [
    ['a.regretWeekDeltas', (inputs, value) => { inputs.cells['usage-40-off'].a.regretWeekDeltas[5] = value; return /usage-40-off\.a\.regretWeekDeltas\.week-5/; }],
    ['d.pairwiseWeekDeltas (no cross-check backstop)', (inputs, value) => { inputs.cells['usage-40-off'].d.pairwiseWeekDeltas[7] = value; return /usage-40-off\.d\.pairwiseWeekDeltas\.week-7/; }],
    ['e2 endpoint', (inputs, value) => { inputs.cells['usage-40-off'].e2.endpoints[0].weekDeltas[9] = value; return /e2\.endpoints\[0\]\(.*\)\.weekDeltas\.week-9/; }],
  ];
  for (const [name, plant] of seriesSites) {
    for (const bad of ['0.5', [1], NaN, 'n/a', null, true, {}, { nonfinite: '+Infinity' }]) {
      const inputs = fullPassingInputs();
      const locator = plant(inputs, bad);
      assert.throws(() => runBacktestSweep.validateInputs(inputs), locator,
        `${name} <- ${JSON.stringify(bad)} must be rejected AT THE BOUNDARY with the key named`);
    }
  }

  // The rejection must name the value the operator actually wrote:
  // JSON.stringify renders NaN and +/-Infinity as the literal `null`, and
  // "got null" for a NaN is the Number(null) class of misreading (round-5
  // QA). Negative control: revert the renderer to bare JSON.stringify - this
  // assertion fails with "got null".
  const nanPlant = fullPassingInputs();
  nanPlant.cells['usage-40-off'].a.regretWeekDeltas[5] = NaN;
  assert.throws(() => runBacktestSweep.validateInputs(nanPlant), /got NaN/);

  // An ARRAY-shaped series is the (f) contract's shape and would silently
  // misalign the weeks by its zero-based indices - rejected as a container.
  const arrayShaped = fullPassingInputs();
  arrayShaped.cells['usage-40-off'].d.regretWeekDeltas = new Array(17).fill(-1);
  assert.throws(() => runBacktestSweep.validateInputs(arrayShaped), /the array is the \(f\) series' shape/);

  // An out-of-grid week key is evidence the evaluator never reads.
  const outOfGrid = fullPassingInputs();
  outOfGrid.cells['usage-40-off'].d.regretWeekDeltas[19] = -1;
  assert.throws(() => runBacktestSweep.validateInputs(outOfGrid), /week "19" is outside the evaluated grid/);

  // The drop convention SURVIVES the tightening: absence is key omission
  // (with the matching 2025 descriptive rows blanked, as the harness would),
  // and a single deletion keeps prereg 10.4's existing disposition.
  const dir = tmpDir(t);
  const dropped = fullPassingInputs();
  delete dropped.cells['usage-40-off'].a.regretWeekDeltas[5];
  for (const row of dropped.evidence.metricWeeks) {
    if (row.season === '2025' && row.cell === 'usage-40-off' && row.estimand === 'paired-delta' && row.endpoint === 'regret' && row.week === 5) row.value = { nonfinite: '+Infinity' };
  }
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(dropped));
  const code = runBacktestSweep.main(['--inputs', inputsPath, '--out-json', path.join(dir, 'r.json'), '--out-markdown', path.join(dir, 'r.md')], { expectedRosterCount: 1 });
  assert.equal(code, 0, 'one omitted week still drops cleanly through the full pipeline');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8')).run.status, 'valid');

  // And the flagship document still validates unchanged.
  assert.doesNotThrow(() => runBacktestSweep.validateInputs(fullPassingInputs()));
});

test('the veto publishes its OWN subgroup size, and section 6.4a\'s arithmetic reconciles on the report alone (round-4 SUBSTANTIVE B)', () => {
  // Before this field, the only published subgroup size was the GATE's
  // (2025-scoped) set, so 6.4a's attestation - realizationCount === 24 x
  // |subgroup player-weeks| - failed against the report's own numbers
  // wherever the two domains differ. On the single-season fixture they
  // coincide at 40; the two-season case is the next test.
  const report = runBacktestSweep.buildReportFromInputs(fullPassingInputs(), { expectedRosterCount: 1 });
  const veto = report.cells.find((c) => c.name === 'usage-00-on').components.f.evidence.veto;
  assert.equal(veto.subgroupPlayerWeekCount, 40);
  assert.equal(veto.realizationCount, metrics.SALTS.length * veto.subgroupPlayerWeekCount,
    'section 6.4a mutation test (iv), runnable by a reader on the report alone');
});

test('a 2024 subgroup player-week widens the VETO domain but not the gate operands, and both published counts reconcile (round-4 SUBSTANTIVE B; SPEC-C RULED both-season)', () => {
  // SPEC-C was RULED BOTH-SEASON by the user on 2026-08-08 (the B3 deferral
  // batch): the veto domain is UNSCOPED by season, and this test now ASSERTS
  // the sealed reading rather than documenting an interim. The report
  // carries the veto's own domain size so 6.4a's arithmetic is checkable
  // even where the domains differ (the gate operands stay 2025-scoped,
  // prereg 9.8).
  // (Precision on this test's teeth: under a quietly 2025-scoped veto it
  // still fails, but via the coverage assertion's throw - 984 realizations
  // against a 40-player-week domain is "unexpected 24" - which fires inside
  // assembleCellClaim before the count assertions below are reached.)
  const inputs = fullPassingInputs();
  // One 2024 cohort player-week, every coverage assertion satisfied:
  inputs.preflight.cohortRosterRows.push({ season: 2024, week: 2, playerId: 7, position: 'RB', onBye: false });
  const model = require('../services/projectionModel');
  const usage25 = arms.ALL_CELLS.find((cell) => cell.blendWeight === 0.25 && cell.homeAway === 'on');
  const rawRun = () => ({
    projections: [{ playerId: 7, median: 19.5, p10: 4, factors: {} }],
    inputCutoff: '2025-09-01T00:00:00.000Z', sourceCoverage: { synthetic: true },
  });
  for (const family of ['controlUsage25Records', 'homeAwayStoredRecords']) {
    for (const salt of metrics.SALTS) {
      inputs.preflight[family].push({
        season: 2024, week: 2, salt,
        leftPlayerIds: [7], rightPlayerIds: [7], leftRun: rawRun(), rightRun: rawRun(),
        leftConstants: arms.resolveConstants({ cell: usage25, baseConstants: model.MODEL_CONSTANTS }),
        rightConstants: arms.resolveConstantsWithStoredHistory({ cell: usage25, baseConstants: model.MODEL_CONSTANTS }),
      });
    }
  }
  for (const cell of arms.ALL_CELLS) {
    inputs.preflight.saltSeedRecords.push({
      cellName: cell.name, season: 2024, week: 2, playerId: 7,
      seedsBySalt: Object.fromEntries(metrics.SALTS.map((salt, index) => [salt, index])),
    });
  }
  for (const cell of arms.ALL_CELLS.filter((c) => c.homeAway === 'on')) {
    inputs.preflight.matchedOffBaselineRows.push({ cellName: cell.name, season: 2024, week: 2, playerId: 7, baseline: -1 });
    for (const salt of metrics.SALTS) {
      inputs.cells[cell.name].f.veto.realizations.push({
        season: 2024, week: 2, playerId: 7, salt,
        // Only usage-00-on's 2024 realization is catastrophic (> 0.2).
        incrementalError: cell.name === 'usage-00-on' && salt === metrics.SALTS[0] ? 0.5 : 0.01,
      });
    }
  }
  const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
  const cell = report.cells.find((c) => c.name === 'usage-00-on');
  const f1 = cell.components.f.evidence.transparency.find((t) => t.endpoint === 'f1-subgroup-mae');
  assert.equal(f1.subgroupRows, 40, 'the gate operands stay 2025-scoped (prereg 9.8)');
  assert.equal(f1.qualifyingWeekCount, 8, 'the 2024 week never enters the qualifying set');
  const veto = cell.components.f.evidence.veto;
  assert.equal(veto.subgroupPlayerWeekCount, 41, 'the veto domain includes the 2024 player-week');
  assert.equal(veto.realizationCount, metrics.SALTS.length * 41, '24 x 41 = 984, checkable on the report alone');
  assert.equal(cell.verdict, 'vetoed', 'the SEALED both-season reading (SPEC-C ruled 2026-08-08): a catastrophic 2024 realization vetoes');
});

test('the runner injects ORDERINGS.PRIMARY by VALUE - presence is the guard, identity is this test (round-3 SUBSTANTIVE 4, QA follow-up)', (t) => {
  // The fail-closed guard pins that SOME ordering is injected; nothing pinned
  // WHICH. Swapping the injection to any other ordering would previously have
  // been caught by no assertion.
  const realCompute = metrics.computePermutationControl;
  const captured = [];
  t.after(() => { metrics.computePermutationControl = realCompute; });
  metrics.computePermutationControl = (args) => { captured.push(args); return realCompute(args); };
  runBacktestSweep.buildReportFromInputs(fullPassingInputs(), { expectedRosterCount: 1 });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ordering, ORDERINGS.PRIMARY);
  assert.equal(captured[0].expectedRosterCount, 1, 'the override travels to the control unchanged');
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

test('a malformed eligibility field on a roster row produces the pinned Level-1 VOID report, never a reducer crash (adversarial QA on c95d751)', () => {
  const inputs = fullPassingInputs();
  // Strip onBye from one roster row: componentFVetoRecords derives EAGERLY,
  // outside runPreflight's capture, so before the fix this crashed the
  // reducer instead of writing the void report the capture exists for.
  const row = inputs.preflight.cohortRosterRows[0];
  delete row.onBye;
  const report = runBacktestSweep.buildReportFromInputs(inputs, { expectedRosterCount: 1 });
  assert.equal(report.run.status, 'void');
  assert.match(report.run.reasons.join(' '), /boolean onBye/);
  assert.equal(report.cells, null, 'no candidate-cell results survive a harness failure');
});
