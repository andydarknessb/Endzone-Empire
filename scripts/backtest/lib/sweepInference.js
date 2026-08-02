'use strict';

/**
 * Gate 2 (PHASE5_EXECUTION_SPEC.md sections 5, 8): the top-level, whole-run
 * orchestration over the fixed eight-cell grid - permutation control,
 * run-level void classification, and Level 5 selection.
 *
 * Pure: no clock, no I/O, no database. This module does NOT compute cell
 * verdicts itself - it takes each of the 8 cells' already-assembled
 * `arms.evaluateClaim()` result (built by a caller from `sweepEvaluator.js`
 * plus `arms.componentF`/`arms.activationReport`) and reconciles them into
 * one whole-run result: void-or-valid, then (if valid) the frozen Level 5
 * selection order.
 */

const arms = require('./arms');
const metrics = require('./metrics');

/**
 * `cellClaims`: `{ [cellName]: evaluateClaim()-shaped result }`, one entry
 * per `arms.ALL_CELLS` name, no more and no fewer - the eight reported
 * factorial cells are evaluated and reported whether or not any cell passes
 * (prereg 7.1, 12.1), so a caller that omitted one has not actually run the
 * sweep. `permutationControl`: `{ regretP, pairwiseP }`, the control cell's
 * plus-one p-values against the permutation null (section 5) -
 * `metrics.assertPermutationControl` is the single source of truth for the
 * `p <= 0.001` threshold. `canariesPassed`/`identityAssertionsPassed`/
 * `saltCollisionPassed`: the other named `void` causes (prereg 17; section
 * 8.6's two sealed assertions; section 3.4 item 5's salt-collision guard),
 * booleans because their own machinery (canary checks, the two identity
 * assertions, the per-player-week salt-collision scan) all require raw
 * per-player-week data this pure reducer never receives - it can only
 * consult a caller's already-computed result, never verify the check was
 * actually run. **`identityAssertionsPassed` must be the AND of BOTH
 * sealed assertions** (`assertProjectionRunBitIdentical` AND
 * `assertHomeAwayStoredPointIdentity`) - never a single pre-combined flag a
 * caller derived some other way; see `run-backtest-sweep.js`'s
 * `--inputs.identityAssertions` for the structured, named-method schema
 * that enforces this at the one layer that CAN check it (the CLI, not this
 * pure library).
 */
function evaluateSweep({
  cellClaims,
  permutationControl,
  canariesPassed = true,
  identityAssertionsPassed = true,
  saltCollisionPassed = true,
  orderingDisagreement = false,
  deployedPolicyDisagreement = false,
  label = 'sweep',
}) {
  if (!cellClaims || typeof cellClaims !== 'object') {
    throw new Error(`${label}: cellClaims must be an object keyed by cell name`);
  }
  const missingCells = arms.ALL_CELLS.filter((c) => cellClaims[c.name] === undefined);
  if (missingCells.length > 0) {
    throw new Error(
      `${label}: ${missingCells.length} of the 8 factorial cells are missing from cellClaims `
      + `(${missingCells.map((c) => c.name).join(', ')}) - all 8 are evaluated and reported whether `
      + 'or not any cell passes (prereg 7.1, 12.1).'
    );
  }
  const extraCells = Object.keys(cellClaims).filter((name) => !arms.ALL_CELLS.some((c) => c.name === name));
  if (extraCells.length > 0) {
    throw new Error(`${label}: cellClaims names cell(s) outside the preregistered 8: ${extraCells.join(', ')}`);
  }

  const permResult = metrics.assertPermutationControl({
    regretP: permutationControl.regretP,
    pairwiseP: permutationControl.pairwiseP,
    label: `${label}: permutation control`,
  });

  const run = arms.classifyRun({
    canariesPassed,
    permutationControlPassed: !permResult.void,
    identityAssertionsPassed,
    saltCollisionPassed,
  });

  if (run.status === 'void') {
    return {
      run,
      permutationControl: permResult,
      cells: cellClaims,
      selection: arms.selectAtLevel5({ runStatus: 'void', passingCells: [] }),
    };
  }

  // The selection FAMILY only (the 7 non-control cells, prereg 7.1) - the
  // control itself is never a selection candidate, even if its own claim
  // were (nonsensically) reported as passing.
  const passingCells = arms.SELECTION_FAMILY.filter((c) => cellClaims[c.name].verdict === 'pass');

  const selection = arms.selectAtLevel5({
    runStatus: run.status,
    passingCells,
    orderingDisagreement,
    deployedPolicyDisagreement,
    label: `${label}: selection`,
  });

  return {
    run,
    permutationControl: permResult,
    cells: cellClaims,
    selection,
  };
}

module.exports = {
  evaluateSweep,
};
