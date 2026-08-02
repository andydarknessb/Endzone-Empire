const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sweepEvaluator = require('../../scripts/backtest/lib/sweepEvaluator');
const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');

// ---------------------------------------------------------------------------
// Isolation: the Gate 2 sweep pipeline stays inside the pure lib tree
//
// Independent implementation review finding: `controlCellEvaluator.js` has
// its own version of this check (backtestControlCellEvaluator.test.js), but
// it is FILE-SPECIFIC - it never covered sweepEvaluator.js/sweepInference.js/
// sweepReport.js, which were added to the SAME scripts/backtest/lib/ tree
// this session with no automated purity check at all (confirmed manually via
// grep during the review; this closes that gap with a regression test).
// ---------------------------------------------------------------------------

const PURE_LIB_FILES = Object.freeze([
  'sweepEvaluator.js', 'sweepInference.js', 'sweepReport.js',
]);

test('the Gate 2 sweep pipeline files stay inside the pure lib tree (no pg, no server/services, no process.env, no child_process, no network)', () => {
  for (const file of PURE_LIB_FILES) {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', file), 'utf8');
    // Strip comments first, same idiom as controlCellEvaluator.js's own test:
    // the docblocks in these files necessarily NAME "process.env"/"pg"/
    // "server/services" in prose explaining the isolation rule, which would
    // false-positive a raw-text scan.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!/require\(['"]pg['"]\)/.test(src), `${file}: must not require('pg')`);
    assert.ok(!/require\(['"]child_process['"]\)/.test(src), `${file}: must not require('child_process')`);
    assert.ok(!/server\/services/.test(src), `${file}: must not reach server/services`);
    assert.ok(!/server\/modules\/pool/.test(src), `${file}: must not reach the DB pool`);
    assert.ok(!/process\.env/.test(src), `${file}: must not read process.env`);
    assert.ok(!/\bfetch\(/.test(src), `${file}: must not perform network I/O`);
    assert.ok(!/require\(['"]http['"]\)|require\(['"]https['"]\)|require\(['"]net['"]\)/.test(src),
      `${file}: must not require a network module`);
  }
});

/** Every one of the 17 evaluated weeks (prereg 4.1), as a `{ [week]: value }` series. */
const fullSeries = (value) => Object.fromEntries(metrics.EVALUATED_WEEKS.map((w) => [w, value]));

// ---------------------------------------------------------------------------
// evaluateBootstrapEndpoint: every Level 4 status, synthetically produced
// ---------------------------------------------------------------------------

test('evaluateBootstrapEndpoint: unevaluable when too many weeks drop (n < 15)', () => {
  const series = fullSeries(-0.5);
  // Drop 3 of 17, leaving 14 - below the MIN_SURVIVING_CLUSTERS floor of 15.
  delete series[2]; delete series[3]; delete series[4];
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(result.status, 'unevaluable');
  assert.equal(result.passes, false);
  assert.match(result.reason, /3 of 17 weeks dropped/);
  assert.equal(result.trigger.fired, false);
});

test('evaluateBootstrapEndpoint: passed, not triggered (healthy, varied series)', () => {
  // A genuinely varied series (no repeated raw values, unlike a small modular
  // cycle) so the bootstrap distribution has far more than 100 distinct
  // resampled means and the exact trigger does not fire.
  const series = Object.fromEntries(
    metrics.EVALUATED_WEEKS.map((w, i) => [w, -0.5 - i * 0.013 - (i * i) * 0.0007])
  );
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.passes, true);
  assert.equal(result.trigger.fired, false, 'a varied series over 17 weeks is not degenerate');
  assert.equal(result.exact, null, 'the exact procedure is only computed when the trigger fires');
});

test('evaluateBootstrapEndpoint: wide-straddle when the CI spans both the favorable and harmful boundaries', () => {
  const series = Object.fromEntries(
    metrics.EVALUATED_WEEKS.map((w, i) => [w, (i % 2 === 0 ? -0.3 : 0.3) + (i % 7) * 0.001])
  );
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(result.status, 'wide-straddle');
  assert.equal(result.passes, false);
});

test('evaluateBootstrapEndpoint: threshold-not-established when fully evaluated but not passing and not wide-straddle', () => {
  const series = Object.fromEntries(
    metrics.EVALUATED_WEEKS.map((w, i) => [w, -0.05 - (i % 5) * 0.001])
  );
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(result.status, 'threshold-not-established');
  assert.equal(result.passes, false);
});

test('evaluateBootstrapEndpoint: the exact-trigger AND rule fires on a degenerate distribution, and passes when both agree', () => {
  // A constant series: every resample mean is identical, so distinctValues
  // === 1 < 100, firing the exact trigger (section 4.3: only the
  // degenerate-distribution half can ever fire under the n >= 15 floor).
  const series = fullSeries(-0.5);
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(result.trigger.fired, true);
  assert.ok(result.exact, 'the exact procedure is computed once triggered');
  assert.equal(result.exact.evaluable, true);
  assert.equal(result.status, 'passed', 'both the bootstrap and exact sides agree the endpoint passes');
  assert.equal(result.passes, true);
});

test('evaluateBootstrapEndpoint: the AND rule reports unevaluable when the exact side has no finite bound, even though the bootstrap side is fine', () => {
  // Every week ties EXACTLY on the shifted margin (delta === margin), so the
  // exact sign test has zero non-tied weeks - n = 0, unevaluable.
  const series = fullSeries(-0.15);
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(result.trigger.fired, true);
  assert.equal(result.exact.evaluable, false);
  assert.equal(result.status, 'unevaluable', 'exact-side non-estimability takes precedence, even over an evaluable bootstrap side');
});

test('evaluateBootstrapEndpoint: the AND rule reports threshold-not-established on disagreement, never unevaluable', () => {
  // 14 of 17 weeks comfortably favorable (-0.9), 3 weeks unfavorable enough
  // (+1.0) that the bootstrap MEAN's upper CI bound (-0.118) does not clear
  // below the -0.15 margin - but the exact SIGN test only counts favorable
  // vs. unfavorable weeks (14 of 17 favorable clears the n=17 exact
  // threshold), so the two procedures genuinely disagree.
  const series = Object.fromEntries(
    metrics.EVALUATED_WEEKS.map((w, i) => [w, i < 14 ? -0.9 : 1.0])
  );
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(result.trigger.fired, true, 'a two-value series is degenerate, firing the trigger');
  assert.equal(result.bootstrap.upper < -0.15, false, 'the bootstrap side does not clear the margin');
  assert.equal(result.exact.passes, true, 'the exact side, driven by the 14-of-17 sign count, does pass');
  assert.equal(result.status, 'threshold-not-established');
  assert.equal(result.passes, false);
});

test('a favorable-positive endpoint (pairwise-shaped) uses direction "above"', () => {
  const series = Object.fromEntries(
    metrics.EVALUATED_WEEKS.map((w, i) => [w, 0.02 + (i % 5) * 0.001])
  );
  const result = sweepEvaluator.evaluateBootstrapEndpoint({
    weekDeltas: series, passingBoundary: 0.005, harmfulBoundary: -0.005, direction: 'above',
  });
  assert.equal(result.status, 'passed');
});

// ---------------------------------------------------------------------------
// combineEndpoints: Level 3 precedence
// ---------------------------------------------------------------------------

test('combineEndpoints: unevaluable > wide-straddle > failed > passed', () => {
  const unevaluable = { status: 'unevaluable', passes: false, reason: 'x', label: 'r1' };
  const straddled = { status: 'wide-straddle', passes: false, reason: 'y', label: 'r2' };
  const failed = { status: 'threshold-not-established', passes: false, reason: 'z', label: 'r3' };
  const passed = { status: 'passed', passes: true, reason: null, label: 'r4' };

  assert.equal(sweepEvaluator.combineEndpoints([unevaluable, passed]).status, 'unevaluable');
  assert.equal(sweepEvaluator.combineEndpoints([straddled, passed]).status, 'wide-straddle');
  assert.equal(sweepEvaluator.combineEndpoints([unevaluable, straddled]).status, 'unevaluable');
  assert.equal(sweepEvaluator.combineEndpoints([failed, passed]).status, 'failed');
  assert.equal(sweepEvaluator.combineEndpoints([passed, passed]).status, 'passed');
  assert.equal(sweepEvaluator.combineEndpoints([passed, passed]).passes, true);
  assert.throws(() => sweepEvaluator.combineEndpoints([]), /at least one endpoint/);
});

// ---------------------------------------------------------------------------
// evaluateCoPrimaryComponent: components (a)/(b)/(c)/(d)/(e1)'s shared shape
// ---------------------------------------------------------------------------

test('evaluateCoPrimaryComponent: both regret and pairwise must pass', () => {
  const goodRegret = Object.fromEntries(metrics.EVALUATED_WEEKS.map((w, i) => [w, -0.5 - (i % 5) * 0.01]));
  const goodPairwise = Object.fromEntries(metrics.EVALUATED_WEEKS.map((w, i) => [w, 0.05 + (i % 5) * 0.001]));
  const badPairwise = Object.fromEntries(metrics.EVALUATED_WEEKS.map((w, i) => [w, 0.001 + (i % 3) * 0.0001]));

  const strong = sweepEvaluator.evaluateCoPrimaryComponent({
    name: 'a', regretWeekDeltas: goodRegret, pairwiseWeekDeltas: goodPairwise,
    regretPassingBoundary: -arms.DELTA_R, regretHarmfulBoundary: arms.DELTA_R,
    pairwisePassingBoundary: arms.DELTA_P, pairwiseHarmfulBoundary: -arms.DELTA_P,
  });
  assert.equal(strong.status, 'passed');
  assert.equal(strong.passes, true);

  const halfFails = sweepEvaluator.evaluateCoPrimaryComponent({
    name: 'a', regretWeekDeltas: goodRegret, pairwiseWeekDeltas: badPairwise,
    regretPassingBoundary: -arms.DELTA_R, regretHarmfulBoundary: arms.DELTA_R,
    pairwisePassingBoundary: arms.DELTA_P, pairwiseHarmfulBoundary: -arms.DELTA_P,
  });
  assert.notEqual(halfFails.status, 'passed');
  assert.equal(halfFails.passes, false);
});

// ---------------------------------------------------------------------------
// evaluateE2Component: the thirteen preregistered endpoint-season rows
// ---------------------------------------------------------------------------

const passingSeries = (i) => Object.fromEntries(metrics.EVALUATED_WEEKS.map((w, j) => [w, -0.5 - ((i + j) % 5) * 0.01]));

/** All thirteen keys, each with a comfortably-passing favorable-negative series. */
const allThirteenPassing = () => sweepEvaluator.E2_ENDPOINT_KEYS.map((key, i) => ({
  key, weekDeltas: passingSeries(i), passingBoundary: -0.05, harmfulBoundary: 0.05, direction: 'below',
}));

test('evaluateE2Component requires exactly the thirteen preregistered rows', () => {
  assert.equal(sweepEvaluator.E2_ENDPOINT_KEYS.length, 13);
  const complete = allThirteenPassing();
  assert.equal(sweepEvaluator.evaluateE2Component({ endpoints: complete }).status, 'passed');

  const missingOne = complete.slice(0, 12);
  assert.throws(() => sweepEvaluator.evaluateE2Component({ endpoints: missingOne }), /missing:/);

  const withUnexpected = [...complete, { key: 'not-a-real-row', weekDeltas: passingSeries(0), passingBoundary: -0.05, harmfulBoundary: 0.05, direction: 'below' }];
  assert.throws(() => sweepEvaluator.evaluateE2Component({ endpoints: withUnexpected }), /unexpected:/);

  const withDuplicate = [...complete.slice(0, 12), complete[0]];
  assert.throws(() => sweepEvaluator.evaluateE2Component({ endpoints: withDuplicate }), /missing:|duplicated:/);
});

test('evaluateE2Component: ALL thirteen must pass - one failure fails the whole component', () => {
  const complete = allThirteenPassing();
  const badSeries = Object.fromEntries(metrics.EVALUATED_WEEKS.map((w) => [w, 0.5]));
  const oneBad = complete.map((e) => (e.key === 'wis-2024' ? { ...e, weekDeltas: badSeries } : e));
  const result = sweepEvaluator.evaluateE2Component({ endpoints: oneBad });
  assert.notEqual(result.status, 'passed');
  assert.equal(result.passes, false);
});
