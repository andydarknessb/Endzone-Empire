const test = require('node:test');
const assert = require('node:assert/strict');

const sweepInference = require('../../scripts/backtest/lib/sweepInference');
const arms = require('../../scripts/backtest/lib/arms');

/** A minimal evaluateClaim()-shaped result for a given verdict. */
const claim = (verdict) => ({ cell: null, verdict, components: {}, failures: [], inconclusive: [], vetoedReasons: [] });

/** All 8 cells, defaulting to a given verdict, with per-name overrides. */
const allCells = (defaultVerdict = 'fail', overrides = {}) => Object.fromEntries(
  arms.ALL_CELLS.map((c) => [c.name, claim(overrides[c.name] || defaultVerdict)])
);

const cleanPermutation = { regretP: 0.0001, pairwiseP: 0.0001 };

test('evaluateSweep requires all 8 cells, no more and no fewer', () => {
  const cells = allCells();
  delete cells['usage-40-off'];
  assert.throws(
    () => sweepInference.evaluateSweep({ cellClaims: cells, permutationControl: cleanPermutation }),
    /usage-40-off/
  );
  const extra = { ...allCells(), 'not-a-cell': claim('fail') };
  assert.throws(
    () => sweepInference.evaluateSweep({ cellClaims: extra, permutationControl: cleanPermutation }),
    /outside the preregistered 8/
  );
});

test('a permutation-control threshold miss VOIDS the run, preempting the cell table', () => {
  const result = sweepInference.evaluateSweep({
    cellClaims: allCells('pass'), // even with every cell passing...
    permutationControl: { regretP: 0.5, pairwiseP: 0.0001 }, // ...the control fails its OWN gate
  });
  assert.equal(result.run.status, 'void');
  assert.match(result.run.reasons[0], /permutation control missed its threshold/);
  assert.equal(result.selection.outcome, 'no-selection');
});

test('a canary failure or an identity-assertion failure also void the run', () => {
  assert.equal(
    sweepInference.evaluateSweep({
      cellClaims: allCells(), permutationControl: cleanPermutation, canariesPassed: false,
    }).run.status,
    'void'
  );
  assert.equal(
    sweepInference.evaluateSweep({
      cellClaims: allCells(), permutationControl: cleanPermutation, identityAssertionsPassed: false,
    }).run.status,
    'void'
  );
});

test('a valid run with no passing cells reaches Level 5 as no-proposal (none passed)', () => {
  const result = sweepInference.evaluateSweep({
    cellClaims: allCells('fail'), permutationControl: cleanPermutation,
  });
  assert.equal(result.run.status, 'valid');
  assert.equal(result.selection.outcome, 'no-proposal');
  assert.deepEqual(result.selection.reasons, ['none passed']);
});

test('a valid run selects by parsimony among the passing NON-control cells', () => {
  const result = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { 'usage-25-on': 'pass', 'usage-40-off': 'pass' }),
    permutationControl: cleanPermutation,
  });
  assert.equal(result.run.status, 'valid');
  assert.equal(result.selection.outcome, 'selected');
  assert.equal(result.selection.selected.name, 'usage-40-off', 'parsimony rule 2 prefers the cell that activates no new factor');
});

test('the control cell itself is never a selection candidate, even if reported passing', () => {
  const result = sweepInference.evaluateSweep({
    cellClaims: allCells('fail', { 'usage-25-off': 'pass' }), // the control cell, marked pass
    permutationControl: cleanPermutation,
  });
  assert.equal(result.selection.outcome, 'no-proposal', 'the control is excluded from the selection family');
});

test('ordering disagreement and deployed-policy disagreement both force no-proposal, even with a passing cell', () => {
  const withPassing = allCells('fail', { 'usage-40-off': 'pass' });
  assert.equal(
    sweepInference.evaluateSweep({
      cellClaims: withPassing, permutationControl: cleanPermutation, orderingDisagreement: true,
    }).selection.outcome,
    'no-proposal'
  );
  assert.equal(
    sweepInference.evaluateSweep({
      cellClaims: withPassing, permutationControl: cleanPermutation, deployedPolicyDisagreement: true,
    }).selection.outcome,
    'no-proposal'
  );
});
