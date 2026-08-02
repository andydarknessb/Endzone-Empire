const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runBacktestSweep = require('../scripts/run-backtest-sweep');
const arms = require('../../scripts/backtest/lib/arms');
const sweepEvaluator = require('../../scripts/backtest/lib/sweepEvaluator');
const metrics = require('../../scripts/backtest/lib/metrics');

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
  incrementalErrors: [0.01, 0.02],
});

function treatedActivationInput() {
  const position = () => ({
    eligible: true, neutralSite: false, knownOrientation: true,
    factors: { homeAway: { available: true, effect: 0.02 } },
  });
  const oneSeason = () => Object.fromEntries(
    metrics.MACRO_POSITIONS.map((p) => [p, Array.from({ length: 20 }, position)])
  );
  return {
    // Prereg 11.2: activation is checked once per season, independently.
    projectionsByPositionBySeason: { 2025: oneSeason(), 2024: oneSeason() },
  };
}

/** A full, valid --inputs document: every cell comfortably PASSES every applicable component. */
function fullPassingInputs({ permutationControl = { regretP: 0.0001, pairwiseP: 0.0001 } } = {}) {
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
      f: isOnCell ? { f1: HEALTHY_F_ENDPOINT, f2: HEALTHY_F_ENDPOINT } : null,
      activation: isOnCell ? treatedActivationInput() : null,
      // Prereg 5.2/16: null only for the control (no verdict to contradict).
      orderingSensitivity: isControlCell ? null : { contradicted: false, detail: null },
    };
  }
  return {
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    identityAssertions: { controlBitIdentity: true, homeAwayStoredPointIdentity: true },
    saltCollisionPassed: true,
    permutationControl,
    orderingDisagreement: false,
    deployedPolicyDisagreement: false,
    cells,
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
  bad.permutationControl = { regretP: 0.001 };
  assert.throws(() => runBacktestSweep.validateInputs(bad), /pairwiseP: must be a finite number/);

  const nanCase = fullPassingInputs();
  nanCase.permutationControl.regretP = NaN;
  assert.throws(() => runBacktestSweep.validateInputs(nanCase), /regretP: must be a finite number/);
});

// ---------------------------------------------------------------------------
// End to end: main() as a deterministic disk-to-disk reducer
// ---------------------------------------------------------------------------

test('main(): a comfortably-passing inputs document produces a VALID run with a SELECTED cell', (t) => {
  const dir = tmpDir(t);
  const inputsPath = path.join(dir, 'inputs.json');
  const outJson = path.join(dir, 'report.json');
  const outMarkdown = path.join(dir, 'REPORT.md');
  fs.writeFileSync(inputsPath, JSON.stringify(fullPassingInputs()));

  const code = runBacktestSweep.main(['--inputs', inputsPath, '--out-json', outJson, '--out-markdown', outMarkdown]);
  assert.equal(code, 0);

  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(report.run.status, 'valid');
  assert.equal(report.cells.length, 8);
  assert.equal(report.selection.outcome, 'selected');
  assert.equal(report.selection.selected.name, 'usage-40-off', 'parsimony prefers the cell that activates no new factor');

  const markdown = fs.readFileSync(outMarkdown, 'utf8');
  assert.match(markdown, /# Sweep report: pit-sweep-2024-2025/);
  assert.match(markdown, /Outcome: \*\*selected\*\*/);

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
  assert.ok(onCell.activation.bySeason['2025'].byPosition.QB.rate > 0, 'per-season, per-position activation rate is real');
  assert.ok(onCell.activation.bySeason['2024'], 'both seasons published, per prereg 11.2');
});

test('main(): a permutation-control threshold miss produces a VOID run with no cell-level results', (t) => {
  const dir = tmpDir(t);
  const inputsPath = path.join(dir, 'inputs.json');
  const outJson = path.join(dir, 'report.json');
  const outMarkdown = path.join(dir, 'REPORT.md');
  fs.writeFileSync(inputsPath, JSON.stringify(fullPassingInputs({
    permutationControl: { regretP: 0.5, pairwiseP: 0.0001 },
  })));

  runBacktestSweep.main(['--inputs', inputsPath, '--out-json', outJson, '--out-markdown', outMarkdown]);

  const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(report.run.status, 'void');
  assert.equal(report.cells, null);

  const markdown = fs.readFileSync(outMarkdown, 'utf8');
  assert.match(markdown, /Status: \*\*void\*\*/);
  assert.match(markdown, /No cell-level results are published/);
});

test('main(): either sealed identity assertion failing alone VOIDS the run - never a single opaque flag', (t) => {
  for (const key of runBacktestSweep.IDENTITY_ASSERTION_KEYS) {
    const dir = tmpDir(t);
    const inputs = fullPassingInputs();
    inputs.identityAssertions[key] = false;
    const inputsPath = path.join(dir, 'inputs.json');
    fs.writeFileSync(inputsPath, JSON.stringify(inputs));
    runBacktestSweep.main([
      '--inputs', inputsPath,
      '--out-json', path.join(dir, 'report.json'),
      '--out-markdown', path.join(dir, 'REPORT.md'),
    ]);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(report.run.status, 'void', `${key} alone must void the run`);
    assert.equal(report.cells, null);
  }
});

test('main(): a real salt-collision VOIDS the run (section 3.4 item 5)', (t) => {
  const dir = tmpDir(t);
  const inputs = fullPassingInputs();
  inputs.saltCollisionPassed = false;
  const inputsPath = path.join(dir, 'inputs.json');
  fs.writeFileSync(inputsPath, JSON.stringify(inputs));
  runBacktestSweep.main([
    '--inputs', inputsPath,
    '--out-json', path.join(dir, 'report.json'),
    '--out-markdown', path.join(dir, 'REPORT.md'),
  ]);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  assert.equal(report.run.status, 'void');
  assert.match(report.run.detail, /salt-collision/);
});

test('validateInputs requires identityAssertions to name BOTH sealed assertions independently', () => {
  const missingBoth = fullPassingInputs();
  missingBoth.identityAssertions = true; // the old, now-refused single-flag shape
  assert.throws(() => runBacktestSweep.validateInputs(missingBoth), /identityAssertions: must be an object/);

  const missingOne = fullPassingInputs();
  delete missingOne.identityAssertions.homeAwayStoredPointIdentity;
  assert.throws(
    () => runBacktestSweep.validateInputs(missingOne),
    /identityAssertions\.homeAwayStoredPointIdentity: must be a boolean/
  );

  const extraKey = fullPassingInputs();
  extraKey.identityAssertions.someExtra = true;
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
  ]);
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
  ]);
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
  ]);

  // Second, independent generation, verified against the first - the
  // reproduction check this script can actually offer without a Docker/DB
  // harness: same inputs, byte-identical report, every time.
  const regeneratedJson = path.join(dir, 'regenerated-report.json');
  assert.doesNotThrow(() => runBacktestSweep.main([
    '--inputs', inputsPath,
    '--out-json', regeneratedJson,
    '--out-markdown', path.join(dir, 'regenerated-REPORT.md'),
    '--verify-against', committedJson,
  ]));

  // A genuine divergence (different inputs) must be CAUGHT, not silently
  // accepted - proving the check actually compares content, not just that
  // both files exist.
  const divergentInputsPath = path.join(dir, 'divergent-inputs.json');
  fs.writeFileSync(divergentInputsPath, JSON.stringify(fullPassingInputs({
    permutationControl: { regretP: 0.5, pairwiseP: 0.0001 }, // now void, a genuinely different report
  })));
  assert.throws(
    () => runBacktestSweep.main([
      '--inputs', divergentInputsPath,
      '--out-json', path.join(dir, 'divergent-report.json'),
      '--out-markdown', path.join(dir, 'divergent-REPORT.md'),
      '--verify-against', committedJson,
    ]),
    /NOT byte-identical.*not reproducible/s
  );
});
