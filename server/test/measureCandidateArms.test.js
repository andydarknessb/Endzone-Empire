const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const harness = require('../scripts/measure-candidate-arms');
const candidateB = require('../scripts/measure-candidate-b');
const policy = require('../../scripts/backtest/lib/policy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Argument handling
// ---------------------------------------------------------------------------

test('parseArgs refuses missing values, unknown flags and missing required flags', () => {
  assert.throws(() => harness.parseArgs(['--snapshot']), /--snapshot requires a value/);
  // A flag immediately followed by another flag is a missing value, not a value.
  assert.throws(() => harness.parseArgs(['--snapshot', '--sources']), /--snapshot requires a value/);
  assert.throws(() => harness.parseArgs(['--bogus', 'x']), /unknown argument --bogus/);
  assert.throws(() => harness.parseArgs([]), /--snapshot is required/);
  assert.throws(
    () => harness.parseArgs(['--snapshot', 'a', '--sources', 'b', '--cohort', 'c']),
    /--rosters is required/
  );
  assert.deepEqual(
    harness.parseArgs(['--snapshot', 'a', '--sources', 'b', '--cohort', 'c', '--rosters', 'd', '--out', 'e']),
    { snapshot: 'a', sources: 'b', cohort: 'c', rosters: 'd', out: 'e' }
  );
});

// ---------------------------------------------------------------------------
// Path handling: inputs decide the ANSWER, so they are anchored like the output
// ---------------------------------------------------------------------------

test('input paths anchor to the repository root, not the working directory', () => {
  assert.equal(
    harness.resolveInputPath('backtest-artifacts/pit-sweep-2024-2025/cohort-weeks', '--cohort'),
    path.join(REPO_ROOT, 'backtest-artifacts', 'pit-sweep-2024-2025', 'cohort-weeks')
  );
  for (const bad of ['', '   ', undefined, null, 42]) {
    assert.throws(() => harness.resolveInputPath(bad, '--cohort'), /--cohort must be a non-empty path/);
  }
  assert.throws(() => harness.resolveInputPath('\\\\host\\share', '--cohort'), /UNC-form path/);
  assert.throws(() => harness.resolveInputPath('//host/share', '--cohort'), /UNC-form path/);
});

test('--out takes a DIRECTORY and the filename is never operator input', () => {
  const ok = harness.resolveOutFile('backtest-artifacts/holdout-confirm-2026');
  assert.equal(ok.dir, path.join(REPO_ROOT, 'backtest-artifacts', 'holdout-confirm-2026'));
  assert.equal(ok.file, path.join(ok.dir, harness.OUTPUT_BASENAME));

  // Containment is not write safety on its own: the repository is exactly where
  // the valuable files are. Because the basename is a module constant, naming a
  // tracked source file as --out writes BESIDE it, never OVER it.
  const asDir = harness.resolveOutFile('server/services/projectionModel.js');
  assert.equal(asDir.file, path.join(REPO_ROOT, 'server', 'services', 'projectionModel.js', harness.OUTPUT_BASENAME));
  assert.notEqual(asDir.file, path.join(REPO_ROOT, 'server', 'services', 'projectionModel.js'));

  for (const bad of ['', '   ', undefined, null, 7]) {
    assert.throws(() => harness.resolveOutFile(bad), /--out must be a non-empty directory path/);
  }
  assert.throws(() => harness.resolveOutFile('\\\\evil-host\\share\\out'), /UNC-form path/);
  assert.throws(() => harness.resolveOutFile('//evil-host/share/out'), /UNC-form path/);
  assert.throws(
    () => harness.resolveOutFile(path.join('..', '..', '..', '..', 'Windows', 'Temp')),
    /is not a directory inside this repository/s
  );
  // THE DISCRIMINATING CASE: a sibling whose name merely EXTENDS the repo's own.
  // A naive `child.startsWith(parent)` accepts it; containment refuses it.
  assert.throws(
    () => harness.resolveOutFile(path.join('..', `${path.basename(REPO_ROOT)}-evil`)),
    /is not a directory inside this repository/s
  );
  assert.throws(() => harness.resolveOutFile('.'), /is not a directory inside this repository/s);
});

test('Candidate B reuses the validated output directory with its fixed basename', () => {
  assert.equal(
    candidateB.resolveOutputPath('backtest-artifacts/holdout-confirm-2026'),
    path.join(REPO_ROOT, 'backtest-artifacts', 'holdout-confirm-2026', 'candidate-b.json')
  );
});

// ---------------------------------------------------------------------------
// Corpus coverage: the guard that stops a truncated corpus flattering the result
// ---------------------------------------------------------------------------

function fullKeys() {
  const keys = [];
  for (const season of harness.EXPECTED_SEASONS) {
    for (const week of harness.EXPECTED_WEEKS) keys.push(`${season}:${week}`);
  }
  return keys;
}

test('a corpus that is not exactly the measurement definition is refused', () => {
  assert.equal(fullKeys().length, 34);
  assert.doesNotThrow(() => harness.assertExpectedCoverage(fullKeys(), '--rosters'));

  // A 2024-only corpus is the dangerous case: it produces a control level of
  // 25.861, which is 0.054 from the very figure under audit, and would read as
  // a near-confirmation of the hypothesis being tested.
  const only2024 = fullKeys().filter((k) => k.startsWith('2024:'));
  assert.throws(() => harness.assertExpectedCoverage(only2024, '--rosters'), /Missing: 2025:2/);

  assert.throws(
    () => harness.assertExpectedCoverage(fullKeys().filter((k) => k !== '2024:10'), '--rosters'),
    /Missing: 2024:10/
  );
  assert.throws(
    () => harness.assertExpectedCoverage([...fullKeys(), '2023:5'], '--rosters'),
    /Unexpected: 2023:5/
  );
});

// ---------------------------------------------------------------------------
// The arms: what the optimizer is actually allowed to see
// ---------------------------------------------------------------------------

test('each arm ranks on its own statistic when read through the real pointsValue', () => {
  const [medianArm, meanArm] = harness.ARMS;
  assert.equal(medianArm.key, 'median');
  assert.equal(meanArm.key, 'mean');

  const projection = { mean: 12.5, median: 11.0, p10: 4, p90: 20 };
  // The control arm passes the OBJECT, so pointsValue reads .median.
  assert.equal(policy.pointsValue(medianArm.rank(projection)), 11.0);
  // The candidate arm passes a NUMBER, so pointsValue uses it directly.
  assert.equal(policy.pointsValue(meanArm.rank(projection)), 12.5);
});

test('the mean arm falls back to the displayed median, mirroring decision.service', () => {
  const [, meanArm] = harness.ARMS;
  // Production (`decision.service.js:177-184`) ranks on the mean only when it is
  // finite and otherwise falls back to the DISPLAYED points. Returning a
  // non-finite mean unchanged would coerce to 0 through pointsValue and bench a
  // player production would still start - a different policy from the one
  // under measurement.
  for (const missing of [null, undefined, NaN]) {
    assert.equal(policy.pointsValue(meanArm.rank({ mean: missing, median: 9.5 })), 9.5);
  }
  assert.equal(policy.pointsValue(meanArm.rank({ median: 9.5 })), 9.5);
  // Both statistics absent is genuinely worth zero, exactly as production coerces it.
  assert.equal(policy.pointsValue(meanArm.rank({ mean: null, median: null })), 0);
  // Non-object inputs pass through untouched for both arms.
  for (const arm of harness.ARMS) assert.equal(arm.rank(7.25), 7.25);
});

test('the arms coincide exactly when a projection carries no dispersion', () => {
  // simulateDistribution returns the point estimate for BOTH statistics when
  // there is no residual evidence, so such a week contributes a real 0 delta.
  const flat = { mean: 8.4, median: 8.4, p10: null, p90: null };
  const [medianArm, meanArm] = harness.ARMS;
  assert.equal(policy.pointsValue(medianArm.rank(flat)), policy.pointsValue(meanArm.rank(flat)));
});

test('dispersedCount counts only projections where the arms can differ', () => {
  const map = new Map([
    [1, { mean: 12.5, median: 11.0, p10: 4, p90: 20 }],  // dispersed
    [2, { mean: 8.4, median: 8.4, p10: null, p90: null }], // no interval
    [3, { mean: 9.0, median: 9.0, p10: 3, p90: 15 }],      // interval but identical statistics
    [4, null],
  ]);
  assert.equal(harness.dispersedCount(map), 1);
  assert.equal(harness.dispersedCount(new Map()), 0);
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test('meanOf refuses an empty series and every non-number, including null', () => {
  assert.equal(harness.meanOf([1, 2, 3], 'x'), 2);
  assert.throws(() => harness.meanOf([], 'x'), /has no values, and 0 would be a lie/);
  assert.throws(() => harness.meanOf(null, 'x'), /has no values/);
  // `Number(null)` is 0 and finite, so a naive guard would average a null in as
  // a real zero - the exact lie the empty-series check refuses.
  assert.throws(() => harness.meanOf([1, null], 'x'), /non-numeric value/);
  assert.throws(() => harness.meanOf([1, undefined], 'x'), /non-numeric value/);
  assert.throws(() => harness.meanOf([1, NaN], 'x'), /non-numeric value/);
});

// ---------------------------------------------------------------------------
// Artifact shape: the two directory flags sit adjacent on a long command line
// ---------------------------------------------------------------------------

test('swapping --cohort and --rosters is refused by name, not by a bare TypeError', () => {
  assert.throws(
    () => harness.verifyCohortFreezeHash({ season: 2024, week: 2, rosters: [] }),
    /--cohort artifact for 2024w2 has no members\[\]/
  );
  assert.throws(
    () => harness.verifyRosterFreezeHash({ season: 2024, week: 2, members: [] }),
    /--rosters artifact for 2024w2 has no rosters\[\]/
  );
});

// ---------------------------------------------------------------------------
// The reference figures are reference, not an assertion
// ---------------------------------------------------------------------------

test('the reported figures carry an explicit basis disclaimer', () => {
  assert.match(harness.REPORTED.basis, /basis unknown|not established equal/);
  assert.equal(harness.REPORTED.medianRegret, 25.915);
  assert.equal(harness.REPORTED.meanRegret, 24.016);
});
