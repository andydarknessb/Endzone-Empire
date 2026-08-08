const test = require('node:test');
const assert = require('node:assert/strict');

const inputsSensitivity = require('../../scripts/backtest/lib/inputsSensitivity');
const arms = require('../../scripts/backtest/lib/arms');
const { ORDERINGS } = require('../../scripts/backtest/lib/ordering');
const { ESTIMANDS } = require('../../scripts/backtest/lib/policy');
const runBacktestSweep = require('../scripts/run-backtest-sweep');

/**
 * The sensitivity COMPARISON layer (increment 5), unit-tested against
 * synthetic claims-pass results. The end-to-end path - real generated
 * records through real variant documents through the real reducer's claim
 * assembly - lives in backtestInputsGeneration.test.js, where the synthetic
 * universe already exists; what this file pins is the comparison SEMANTICS
 * (spec 8.4/8.5, prereg 5.2/5.3), which are exactly the rules a plausible
 * rewrite gets subtly wrong.
 */

const CANDIDATES = arms.SELECTION_FAMILY.map((cell) => cell.name);
const ORDERING_KEYS = inputsSensitivity.ORDERING_PASSES.map((pass) => pass.key);

function verdicts(overrides = {}) {
  return Object.fromEntries(CANDIDATES.map((name) => [name, overrides[name] || 'fail']));
}

function passResult({ verdictOverrides = {}, winner = null } = {}) {
  return { verdictByCell: verdicts(verdictOverrides), winner };
}

function orderingResultsAll(build = () => passResult()) {
  return Object.fromEntries(ORDERING_KEYS.map((key) => [key, build(key)]));
}

// ---------------------------------------------------------------------------
// The pass list itself is part of the contract
// ---------------------------------------------------------------------------

test('the three sensitivity passes are pinned: both required ordering variants, then the force-fill estimand', () => {
  assert.deepEqual(inputsSensitivity.SENSITIVITY_PASSES.map((pass) => ({ ...pass })), [
    { key: 'ordering:db-collation', kind: 'ordering', ordering: ORDERINGS.DB_COLLATION, estimand: ESTIMANDS.DEPLOYED_POLICY },
    { key: 'ordering:duplicate-shuffle', kind: 'ordering', ordering: ORDERINGS.DUPLICATE_SHUFFLE, estimand: ESTIMANDS.DEPLOYED_POLICY },
    { key: 'estimand:force-fill', kind: 'estimand', ordering: ORDERINGS.PRIMARY, estimand: ESTIMANDS.FORCE_FILL },
  ]);
  assert.equal(Object.isFrozen(inputsSensitivity.SENSITIVITY_PASSES), true);
  for (const pass of inputsSensitivity.SENSITIVITY_PASSES) assert.equal(Object.isFrozen(pass), true);
  // The ordering comparison consumes EXACTLY the two ordering variants - the
  // estimand pass has no cell-level analog (spec 8.4), which is structural:
  // it is not in this list.
  assert.deepEqual(ORDERING_KEYS, ['ordering:db-collation', 'ordering:duplicate-shuffle']);
});

test('the placeholder covers exactly the seven candidates, none contradicted', () => {
  const placeholder = inputsSensitivity.placeholderOrderingSensitivityByCell();
  assert.deepEqual(Object.keys(placeholder).sort(), [...CANDIDATES].sort());
  for (const name of CANDIDATES) {
    assert.deepEqual(placeholder[name], { contradicted: false, detail: null });
  }
});

// ---------------------------------------------------------------------------
// Stage 1 - compareOrderingSensitivity: the spec 8.4 semantics
// ---------------------------------------------------------------------------

test('full ordering agreement: nothing contradicted, no winner-only disagreement', () => {
  const winnerCell = CANDIDATES[0];
  const primary = passResult({ verdictOverrides: { [winnerCell]: 'pass' }, winner: winnerCell });
  const outcome = inputsSensitivity.compareOrderingSensitivity({
    primary,
    orderingResults: orderingResultsAll(() => passResult({ verdictOverrides: { [winnerCell]: 'pass' }, winner: winnerCell })),
  });
  for (const name of CANDIDATES) {
    assert.deepEqual(outcome.orderingSensitivityByCell[name], { contradicted: false, detail: null });
  }
  assert.equal(outcome.orderingDisagreement, false);
});

test('an ordering variant flipping one cell verdict contradicts THAT cell, names the variant, and is not a winner-only disagreement', () => {
  const flipped = CANDIDATES[2];
  const primary = passResult({ verdictOverrides: { [flipped]: 'pass' }, winner: flipped });
  const orderingResults = orderingResultsAll((key) => (key === 'ordering:db-collation'
    ? passResult({ verdictOverrides: { [flipped]: 'inconclusive' }, winner: null })
    : passResult({ verdictOverrides: { [flipped]: 'pass' }, winner: flipped })));
  const outcome = inputsSensitivity.compareOrderingSensitivity({ primary, orderingResults });

  assert.equal(outcome.orderingSensitivityByCell[flipped].contradicted, true);
  assert.match(outcome.orderingSensitivityByCell[flipped].detail, /ordering:db-collation: inconclusive vs primary pass/);
  for (const name of CANDIDATES.filter((n) => n !== flipped)) {
    assert.equal(outcome.orderingSensitivityByCell[name].contradicted, false, `${name} did not flip and must not be contradicted`);
  }
  // The winner ALSO differs here, but a verdict flipped with it - spec 8.4's
  // winner-only branch applies only when "individual cells' verdicts are
  // unaffected", and the cell-level rule already owns this case.
  assert.equal(outcome.orderingDisagreement, false);
});

test('both ordering variants flipping the same cell are BOTH named in its detail', () => {
  const flipped = CANDIDATES[1];
  const primary = passResult({ verdictOverrides: { [flipped]: 'pass' }, winner: flipped });
  const orderingResults = orderingResultsAll(() => passResult({ verdictOverrides: { [flipped]: 'fail' }, winner: null }));
  const outcome = inputsSensitivity.compareOrderingSensitivity({ primary, orderingResults });
  assert.match(outcome.orderingSensitivityByCell[flipped].detail, /ordering:db-collation: fail vs primary pass; ordering:duplicate-shuffle: fail vs primary pass/);
});

test('the winner-only branch: identical verdicts with a different winner is a selection-level disagreement, never a cell contradiction', () => {
  // Provably unreachable under the configuration-only parsimony order (spec
  // 8.5) - which is exactly why the comparison must compute it rather than
  // assume it: the branch is sealed as defense in depth.
  const overrides = { [CANDIDATES[0]]: 'pass', [CANDIDATES[1]]: 'pass' };
  const primary = passResult({ verdictOverrides: overrides, winner: CANDIDATES[0] });
  const orderingResults = orderingResultsAll((key) => (key === 'ordering:duplicate-shuffle'
    ? passResult({ verdictOverrides: overrides, winner: CANDIDATES[1] })
    : passResult({ verdictOverrides: overrides, winner: CANDIDATES[0] })));
  const outcome = inputsSensitivity.compareOrderingSensitivity({ primary, orderingResults });
  assert.equal(outcome.orderingDisagreement, true);
  for (const name of CANDIDATES) {
    assert.equal(outcome.orderingSensitivityByCell[name].contradicted, false);
  }
});

test('a missing ordering pass, a missing candidate verdict, or a missing winner can never read as stability', () => {
  const primary = passResult({ winner: null });
  // Missing pass.
  for (const key of ORDERING_KEYS) {
    const { [key]: _dropped, ...partial } = orderingResultsAll(() => passResult({ winner: null }));
    assert.throws(
      () => inputsSensitivity.compareOrderingSensitivity({ primary, orderingResults: partial }),
      /cannot show stability/,
      `${key} missing must throw`
    );
  }
  assert.throws(
    () => inputsSensitivity.compareOrderingSensitivity({ primary: null, orderingResults: orderingResultsAll() }),
    /must be a claims-pass result/
  );
  // Missing candidate verdict (adversarial QA finding 2): a candidate absent
  // from BOTH sides would compare undefined === undefined and read as
  // agreement - refused by name instead, on every side.
  const dropped = CANDIDATES[3];
  const withoutCell = (result) => {
    const { [dropped]: _gone, ...rest } = result.verdictByCell;
    return { ...result, verdictByCell: rest };
  };
  assert.throws(
    () => inputsSensitivity.compareOrderingSensitivity({ primary: withoutCell(primary), orderingResults: orderingResultsAll(() => passResult({ winner: null })) }),
    new RegExp(`no candidate IUT verdict for ${dropped}`)
  );
  assert.throws(
    () => inputsSensitivity.compareOrderingSensitivity({ primary, orderingResults: orderingResultsAll(() => withoutCell(passResult({ winner: null }))) }),
    new RegExp(`no candidate IUT verdict for ${dropped}`)
  );
  // A non-IUT verdict (the control's 'baseline', say) is refused too.
  assert.throws(
    () => inputsSensitivity.compareOrderingSensitivity({
      primary: passResult({ verdictOverrides: { [dropped]: 'baseline' }, winner: null }),
      orderingResults: orderingResultsAll(() => passResult({ winner: null })),
    }),
    /no candidate IUT verdict/
  );
  // Missing winner key.
  const { winner: _w, ...noWinner } = passResult({ winner: null });
  assert.throws(
    () => inputsSensitivity.compareOrderingSensitivity({ primary: noWinner, orderingResults: orderingResultsAll(() => passResult({ winner: null })) }),
    /carries no winner/
  );
});

// ---------------------------------------------------------------------------
// Stage 2 - compareEstimands: the prereg 5.3 halt, post-contradiction basis
// ---------------------------------------------------------------------------

test('estimand winner disagreement halts, including the null-vs-selected case; null-vs-null agrees; winners are attributed to the right estimand', () => {
  const winnerCell = CANDIDATES[0];
  const finalPrimary = passResult({ verdictOverrides: { [winnerCell]: 'pass' }, winner: winnerCell });

  const disagree = inputsSensitivity.compareEstimands({
    finalPrimary, finalForceFill: passResult({ verdictOverrides: { [CANDIDATES[1]]: 'pass' }, winner: CANDIDATES[1] }),
  });
  assert.equal(disagree.deployedPolicyDisagreement, true);
  // The attribution matters (mutation QA: an argument swap survived every
  // prior test because `halted` is symmetric - the audit-trail record is not).
  assert.deepEqual(disagree.reconciliation.winners, { deployedPolicy: winnerCell, forceFill: CANDIDATES[1] });

  const nullCase = inputsSensitivity.compareEstimands({
    finalPrimary, finalForceFill: passResult({ winner: null }),
  });
  assert.equal(nullCase.deployedPolicyDisagreement, true, 'an estimand under which nothing passes has not agreed any cell is better (determination 10)');
  assert.match(nullCase.reconciliation.detail, /NO SELECTION OCCUR/);
  assert.deepEqual(nullCase.reconciliation.winners, { deployedPolicy: winnerCell, forceFill: null });

  const bothNull = inputsSensitivity.compareEstimands({
    finalPrimary: passResult({ winner: null }), finalForceFill: passResult({ winner: null }),
  });
  assert.equal(bothNull.deployedPolicyDisagreement, false, 'two estimands selecting nothing agree');

  // The same fail-closed domain line as stage 1.
  assert.throws(() => inputsSensitivity.compareEstimands({ finalPrimary, finalForceFill: null }), /must be a claims-pass result/);
  const { winner: _w, ...noWinner } = passResult({ winner: null });
  assert.throws(() => inputsSensitivity.compareEstimands({ finalPrimary, finalForceFill: noWinner }), /carries no winner/);
});

// ---------------------------------------------------------------------------
// claimsPass: injection and composition
// ---------------------------------------------------------------------------

function fakeReducer(assembleCellClaim) {
  return {
    validateInputs: () => true,
    componentFVetoRecords: () => arms.ALL_CELLS.filter((c) => c.homeAway === 'on').map((c) => ({ cellName: c.name })),
    deriveComponentFOperands: () => ({ qualifyingWeeks: [] }),
    deriveComponentFOneSeries: () => [],
    assembleCellClaim,
  };
}

function fakeDocument() {
  return { preflight: {}, cells: Object.fromEntries(arms.ALL_CELLS.map((c) => [c.name, { f: { veto: { realizations: [] } } }])) };
}

test('every reducer function must be injected, each named on absence', () => {
  const REDUCER_FUNCTIONS = ['validateInputs', 'componentFVetoRecords', 'deriveComponentFOperands', 'deriveComponentFOneSeries', 'assembleCellClaim'];
  for (const missing of REDUCER_FUNCTIONS) {
    const reducer = Object.fromEntries(REDUCER_FUNCTIONS.filter((name) => name !== missing).map((name) => [name, () => {}]));
    assert.throws(
      () => inputsSensitivity.claimsPass({ document: {}, reducer }),
      new RegExp(`reducer\\.${missing} must be a function`),
      `${missing} must be required by name`
    );
  }
  assert.throws(() => inputsSensitivity.claimsPass({ document: {}, reducer: null }), /must be injected/);
  // The real reducer's export surface satisfies the injection contract - so a
  // rename there fails HERE, not at Gate 4.
  for (const name of REDUCER_FUNCTIONS) {
    assert.equal(typeof runBacktestSweep[name], 'function', `run-backtest-sweep must export ${name}`);
  }
});

test('claimsPass composes the injected reducer: verdicts from assembleCellClaim, winner from Level-5 PARSIMONY', () => {
  // TWO passing candidates whose parsimony order INVERTS the family order:
  // usage-00-off precedes usage-40-off in the fixed family order, but
  // usage-40-off wins parsimony (smaller |blendWeight - 0.25|). A winner
  // extraction that took "first passing cell" instead of Level 5 survived
  // the previous single-passing-cell fixtures (mutation QA).
  const passing = ['usage-00-off', 'usage-40-off'];
  const claim = (cellMeta) => ({
    cell: cellMeta.name,
    verdict: cellMeta.name === arms.CONTROL_CELL ? 'baseline' : (passing.includes(cellMeta.name) ? 'pass' : 'fail'),
  });
  const result = inputsSensitivity.claimsPass({ document: fakeDocument(), reducer: fakeReducer(claim) });
  assert.equal(result.winner, 'usage-40-off', 'the winner is the parsimony winner, never the first passing cell in family order');
  assert.deepEqual(result.passingCells.sort(), passing.sort());
  assert.deepEqual(Object.keys(result.verdictByCell).sort(), [...CANDIDATES].sort());
  assert.equal(result.selection.outcome, 'selected');

  // NEGATIVE CONTROL: a claim carrying a non-IUT verdict for a candidate is a
  // reducer-contract break, refused rather than compared.
  const broken = fakeReducer((cellMeta) => ({ cell: cellMeta.name, verdict: 'baseline' }));
  assert.throws(() => inputsSensitivity.claimsPass({ document: fakeDocument(), reducer: broken }), /not a candidate IUT verdict/);
});

test('claimsPass with NO passing candidate returns winner null via a no-proposal selection', () => {
  const claim = (cellMeta) => ({
    cell: cellMeta.name,
    verdict: cellMeta.name === arms.CONTROL_CELL ? 'baseline' : 'inconclusive',
  });
  const result = inputsSensitivity.claimsPass({ document: fakeDocument(), reducer: fakeReducer(claim) });
  assert.equal(result.winner, null);
  assert.equal(result.selection.outcome, 'no-proposal');
});

// ---------------------------------------------------------------------------
// deriveSensitivityInputs: fail-closed structure checks
// ---------------------------------------------------------------------------

test('deriveSensitivityInputs refuses records without the sensitivity re-evaluations, before any assembly', () => {
  const reducer = fakeReducer(() => ({ verdict: 'fail' }));
  assert.throws(
    () => inputsSensitivity.deriveSensitivityInputs({
      studyId: 's', canariesPassed: true, records: { armWeekMetrics: [], preflight: {} }, permutationControl: {}, reducer,
    }),
    /armWeekMetricsBySensitivity is required/
  );
  for (const key of inputsSensitivity.SENSITIVITY_PASS_KEYS) {
    const partial = Object.fromEntries(inputsSensitivity.SENSITIVITY_PASS_KEYS.filter((k) => k !== key).map((k) => [k, []]));
    assert.throws(
      () => inputsSensitivity.deriveSensitivityInputs({
        studyId: 's',
        canariesPassed: true,
        records: { armWeekMetrics: [], armWeekMetricsBySensitivity: partial, preflight: {} },
        permutationControl: {},
        reducer,
      }),
      /every sensitivity pass required/,
      `${key} missing must throw before any document is assembled`
    );
  }
});
