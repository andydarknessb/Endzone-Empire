const test = require('node:test');
const assert = require('node:assert/strict');

const sweepReport = require('../../scripts/backtest/lib/sweepReport');
const sweepInference = require('../../scripts/backtest/lib/sweepInference');
const arms = require('../../scripts/backtest/lib/arms');

const claim = (verdict, componentOverrides = {}) => ({
  cell: null,
  verdict,
  components: {
    a: { status: 'passed', passes: true },
    b: { status: 'passed', passes: true },
    c: { status: 'passed', passes: true },
    d: { status: 'passed', passes: true },
    e1: { status: 'passed', passes: true },
    e2: { status: 'passed', passes: true },
    f: { status: 'passed', passes: true },
    ...componentOverrides,
  },
  failures: [],
  inconclusive: [],
  vetoedReasons: [],
});

// The control never receives a candidate IUT verdict (independent
// implementation review ruling, row 26): 'baseline', no components.
const controlClaim = () => ({
  cell: arms.CONTROL_CELL, verdict: 'baseline', components: {}, failures: [], inconclusive: [], vetoedReasons: [],
});

const allCells = (defaultVerdict = 'fail', overrides = {}) => Object.fromEntries(
  arms.ALL_CELLS.map((c) => [
    c.name,
    overrides[c.name] || (c.name === arms.CONTROL_CELL ? controlClaim() : claim(defaultVerdict)),
  ])
);

const cleanPermutation = { regretP: 0.0001, pairwiseP: 0.0001 };

// ---------------------------------------------------------------------------
// End to end: a real sweepInference.evaluateSweep() result through buildReport
// ---------------------------------------------------------------------------

test('buildReport: end to end, a void run publishes NO cell-level results (prereg 7.3)', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('pass'),
    permutationControl: { regretP: 0.5, pairwiseP: 0.0001 }, // fails its own gate
  });
  const report = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep });
  assert.equal(report.run.status, 'void');
  assert.equal(report.cells, null);
  assert.equal(report.selection.outcome, 'no-selection');
  // The closed schema's key set is present regardless of branch.
  assert.deepEqual(Object.keys(report).sort(), [...sweepReport.REPORT_KEYS].sort());
});

test('buildReport: end to end, a valid run with a selected cell publishes all 8 cells in ALL_CELLS order', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', {
      'usage-40-off': claim('pass'),
      'usage-25-on': claim('pass'),
    }),
    permutationControl: cleanPermutation,
  });
  const report = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep });
  assert.equal(report.run.status, 'valid');
  assert.equal(report.cells.length, 8);
  assert.deepEqual(report.cells.map((c) => c.name), arms.ALL_CELLS.map((c) => c.name));
  assert.equal(report.cells.find((c) => c.name === 'usage-25-off').isControl, true);
  assert.equal(report.selection.outcome, 'selected');
  assert.equal(report.selection.selected.name, 'usage-40-off');
  assert.ok(report.selection.reason, 'the parsimony reason string is carried into the report');
});

test('decision D6: buildReport publishes the sensitivity audit trail on a valid run and null on a void run or when absent', () => {
  const audit = {
    winnersByPass: { 'ordering:db-collation': null, 'ordering:duplicate-shuffle': null, 'estimand:force-fill': 'usage-40-off' },
    basisByPass: {
      'ordering:db-collation': 'stage-1-placeholder-basis',
      'ordering:duplicate-shuffle': 'stage-1-placeholder-basis',
      'estimand:force-fill': 'stage-2-post-contradiction',
    },
    estimandReconciliation: {
      selection: null, halted: true, reason: 'estimand-disagreement', detail: 'winners disagree',
      winners: { deployedPolicy: null, forceFill: 'usage-40-off' },
    },
  };
  const valid = sweepInference.evaluateSweep({ cellClaims: allCells('fail'), permutationControl: cleanPermutation });
  const report = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep: { ...valid, sensitivityAudit: audit } });
  assert.equal(report.run.status, 'valid');
  assert.deepEqual(report.sensitivityAudit, audit);

  // Absent from the sweep (unit fixtures): null, mirroring evidence.
  assert.equal(sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep: valid }).sensitivityAudit, null);

  // Void run: null even when supplied - selection-level evidence (prereg 7.3).
  const voidSweep = sweepInference.evaluateSweep({
    cellClaims: allCells('pass'), permutationControl: { regretP: 0.5, pairwiseP: 0.0001 },
  });
  const voidReport = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep: { ...voidSweep, sensitivityAudit: audit } });
  assert.equal(voidReport.run.status, 'void');
  assert.equal(voidReport.sensitivityAudit, null);

  // The Markdown block renders sorted, with the halt visible.
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const rendered = sweepReport.renderMarkdown(report);
  assert.match(rendered, /## Sensitivity audit \(spec 8\.4\/8\.5\)/);
  assert.match(rendered, /- winner estimand:force-fill \(basis: stage-2 post-contradiction\): usage-40-off/);
  assert.match(rendered, /- estimand reconciliation: halted=true, selection=-, deployedPolicy=-, forceFill=usage-40-off, reason=estimand-disagreement/);
  // A closed-shape violation in the trail is rejected at publication.
  assert.throws(
    () => sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep: { ...valid, sensitivityAudit: { ...audit, extra: 1 } } }),
    /unexpected key\(s\).*extra/
  );
});

// ---------------------------------------------------------------------------
// The closed schema
// ---------------------------------------------------------------------------

test('assertClosedKeys refuses any key outside the allowed set', () => {
  assert.equal(sweepReport.assertClosedKeys({ a: 1, b: 2 }, ['a', 'b']), true);
  assert.throws(
    () => sweepReport.assertClosedKeys({ a: 1, c: 3 }, ['a', 'b']),
    /unexpected key\(s\).*c/
  );
});

test('buildReport refuses studyId that is missing or the wrong type', () => {
  const sweep = sweepInference.evaluateSweep({ cellClaims: allCells('fail'), permutationControl: cleanPermutation });
  for (const bad of [undefined, null, '', 123, {}]) {
    assert.throws(() => sweepReport.buildReport({ studyId: bad, sweep }), /studyId must be a non-empty string/);
  }
});

test('buildReport refuses an unrecognized cell verdict', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { 'usage-40-off': { ...claim('pass'), verdict: 'maybe' } }),
    permutationControl: cleanPermutation,
  });
  assert.throws(
    () => sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep }),
    /verdict 'maybe' is not valid for usage-40-off/
  );
});

test('buildReport refuses a candidate cell reporting the control-only "baseline" verdict, and the control reporting a candidate verdict', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { 'usage-40-off': controlClaim() }),
    permutationControl: cleanPermutation,
  });
  assert.throws(
    () => sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep }),
    /verdict 'baseline' is not valid for usage-40-off.*a candidate cell/s
  );

  const controlWithPass = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { [arms.CONTROL_CELL]: claim('pass') }),
    permutationControl: cleanPermutation,
  });
  assert.throws(
    () => sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep: controlWithPass }),
    /verdict 'pass' is not valid for usage-25-off.*the control cell/s
  );
});

test('buildReport refuses a component carrying a key outside the closed component schema', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', {
      'usage-40-off': claim('pass', { a: { status: 'passed', passes: true, extraField: 'nope' } }),
    }),
    permutationControl: cleanPermutation,
  });
  assert.throws(
    () => sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep }),
    /unexpected key\(s\).*extraField/
  );
});

// ---------------------------------------------------------------------------
// Non-finite rejection
// ---------------------------------------------------------------------------

test('assertFinite refuses NaN/Infinity/-Infinity anywhere, naming the exact path', () => {
  assert.equal(sweepReport.assertFinite({ a: [1, 2, { b: 3 }] }), true);
  assert.throws(() => sweepReport.assertFinite({ a: [1, NaN] }), /a\[1\] is NaN/);
  assert.throws(() => sweepReport.assertFinite({ a: { b: Infinity } }), /a\.b is Infinity/);
  assert.throws(() => sweepReport.assertFinite({ a: -Infinity }), /a is -Infinity/);
});

test('buildReport propagates the non-finite guard through the whole assembled report', () => {
  // A pathological blendWeight is impossible via arms.ALL_CELLS, so exercise
  // the guard directly on the assembled shape via a corrupted selection field.
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail'),
    permutationControl: cleanPermutation,
  });
  const report = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep });
  report.selection.reasons = ['fine'];
  // Directly prove the finite guard covers the full report shape once more,
  // via a deliberately corrupted clone (buildReport itself cannot construct
  // one from real inputs, since arms.ALL_CELLS is a fixed, finite table).
  const corrupted = JSON.parse(JSON.stringify(report));
  corrupted.selection.outcome = 'no-proposal';
  corrupted.someBogusNumber = NaN;
  assert.throws(() => sweepReport.assertFinite(corrupted), /someBogusNumber is NaN/);
});

// ---------------------------------------------------------------------------
// Unstated-unevaluable rejection
// ---------------------------------------------------------------------------

test('assertNoUnstatedUnevaluable refuses unevaluable/wide-straddle/vetoed with no reason, requires one with a reason', () => {
  for (const status of sweepReport.REQUIRED_STATES_WITH_REASON) {
    assert.throws(
      () => sweepReport.assertNoUnstatedUnevaluable({
        'usage-40-off': { components: { f: { status, passes: false } } },
      }),
      new RegExp(`is '${status}' with no stated reason`)
    );
    assert.throws(
      () => sweepReport.assertNoUnstatedUnevaluable({
        'usage-40-off': { components: { f: { status, passes: false, reason: '   ' } } },
      }),
      /no stated reason/
    );
    assert.equal(
      sweepReport.assertNoUnstatedUnevaluable({
        'usage-40-off': { components: { f: { status, passes: false, reason: 'below the minimum' } } },
      }),
      true
    );
  }
  // A 'passed' or 'failed' component never needs a reason.
  assert.equal(
    sweepReport.assertNoUnstatedUnevaluable({
      'usage-40-off': { components: { a: { status: 'passed', passes: true } } },
    }),
    true
  );
});

test('buildReport refuses a real sweep whose f component is unevaluable with no reason', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', {
      'usage-40-off': claim('inconclusive', { f: { status: 'unevaluable', passes: false } }),
    }),
    permutationControl: cleanPermutation,
  });
  assert.throws(
    () => sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep }),
    /usage-40-off\.f is 'unevaluable' with no stated reason/
  );
});

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

test('canonicalizeReport is byte-stable regardless of key insertion order and refuses undefined', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { 'usage-40-off': claim('pass') }),
    permutationControl: cleanPermutation,
  });
  const report = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep });
  const bytesA = sweepReport.canonicalizeReport(report);
  // Rebuild the exact same logical content via a fresh call - determinism
  // rests on the pure functions above, not on object identity.
  const sweepAgain = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { 'usage-40-off': claim('pass') }),
    permutationControl: cleanPermutation,
  });
  const reportAgain = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep: sweepAgain });
  const bytesB = sweepReport.canonicalizeReport(reportAgain);
  assert.equal(bytesA, bytesB);
  assert.doesNotThrow(() => JSON.parse(bytesA));
});

// ---------------------------------------------------------------------------
// Deterministic Markdown
// ---------------------------------------------------------------------------

test('renderMarkdown is a pure function of the report - identical input, identical output', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { 'usage-40-off': claim('pass') }),
    permutationControl: cleanPermutation,
  });
  const report = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep });
  // testing-library's render-result-naming-convention matches any `render*`
  // callee; this is Markdown text, not a rendered component.
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const markdownA = sweepReport.renderMarkdown(report);
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const markdownB = sweepReport.renderMarkdown(JSON.parse(JSON.stringify(report)));
  assert.equal(markdownA, markdownB);
  assert.match(markdownA, /# Sweep report: pit-sweep-2024-2025/);
  assert.match(markdownA, /Status: \*\*valid\*\*/);
  assert.match(markdownA, /### usage-25-off \(control\)/);
  assert.match(markdownA, /Outcome: \*\*selected\*\*/);
  // Cell headings appear in the fixed ALL_CELLS order, not any other order.
  const positions = arms.ALL_CELLS.map((c) => markdownA.indexOf(`### ${c.name}`));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  positions.forEach((p) => assert.ok(p >= 0));
});

test('renderMarkdown reports the void disposition in prose, with no cell sections', () => {
  const sweep = sweepInference.evaluateSweep({
    cellClaims: allCells('pass'),
    permutationControl: { regretP: 0.5, pairwiseP: 0.0001 },
  });
  const report = sweepReport.buildReport({ studyId: 'pit-sweep-2024-2025', sweep });
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const markdown = sweepReport.renderMarkdown(report);
  assert.match(markdown, /Status: \*\*void\*\*/);
  assert.match(markdown, /No cell-level results are published/);
  assert.doesNotMatch(markdown, /###/);
});
