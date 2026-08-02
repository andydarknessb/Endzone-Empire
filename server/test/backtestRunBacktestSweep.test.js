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
  return {
    projectionsByPosition: Object.fromEntries(
      metrics.MACRO_POSITIONS.map((p) => [p, Array.from({ length: 20 }, position)])
    ),
  };
}

/** A full, valid --inputs document: every cell comfortably PASSES every component. */
function fullPassingInputs({ permutationControl = { regretP: 0.0001, pairwiseP: 0.0001 } } = {}) {
  const cells = {};
  for (const cellMeta of arms.ALL_CELLS) {
    cells[cellMeta.name] = {
      a: passingCoPrimaryInput(),
      b: passingCoPrimaryInput(),
      c: passingCoPrimaryInput(),
      d: passingCoPrimaryInput(),
      e1: passingCoPrimaryInput(),
      e2: passingE2Input(),
      f: cellMeta.homeAway === 'on' ? { f1: HEALTHY_F_ENDPOINT, f2: HEALTHY_F_ENDPOINT } : null,
      activation: cellMeta.homeAway === 'on' ? treatedActivationInput() : null,
    };
  }
  return {
    studyId: 'pit-sweep-2024-2025',
    canariesPassed: true,
    identityAssertionsPassed: true,
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
