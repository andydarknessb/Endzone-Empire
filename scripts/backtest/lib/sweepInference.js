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
 * `p <= 0.001` threshold - or `{ notRun: true }` when a void-forcing harness
 * failure skipped the control (section 8.6.0's disposition; rejected on a
 * clean run). `canariesPassed`/`identityAssertionsPassed`/
 * `saltCollisionPassed`: the other named `void` causes (prereg 17; section
 * 8.6's two sealed assertions; section 3.4 item 5's salt-collision guard),
 * booleans derived by the raw-record preflight, rather than operator-supplied
 * assertions. `preflightFailures` preserves the specific raw-evidence failure
 * in the void report while this pure reducer remains free of raw data.
 */
function evaluateSweep({
  cellClaims,
  permutationControl,
  canariesPassed = true,
  identityAssertionsPassed = true,
  saltCollisionPassed = true,
  preflightFailures = [],
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

  // Section 8.6.0's disposition on a harness failure is "Level 1 void,
  // immediately" - the control is skipped, never computed on a harness the
  // same report declares broken. The marker is accepted ONLY beside a
  // void-forcing failure: on a clean run the control is mandatory and a
  // caller cannot use the skip to dodge the gate. No p-values are fabricated
  // - metrics.assertPermutationControl stays the single source of the 0.001
  // threshold and is simply not called for a control that never ran.
  const controlNotRun = permutationControl && permutationControl.notRun === true;
  // Void-forcing means ANY leg classifyRun voids on: the three booleans OR a
  // captured raw-evidence preflight failure (the component (f) veto leg flows
  // through preflightFailures alone, with no boolean of its own).
  const voidForcingFailure = !canariesPassed || !identityAssertionsPassed || !saltCollisionPassed
    || (Array.isArray(preflightFailures) && preflightFailures.length > 0);
  if (controlNotRun && !voidForcingFailure) {
    throw new Error(
      `${label}: the permutation control may be skipped ONLY when a void-forcing preflight or `
      + 'canary failure precedes it (section 8.6.0, disposition on failure); on a clean run the '
      + 'control is mandatory.'
    );
  }
  const permResult = controlNotRun
    ? {
      void: false,
      reason: 'not-run',
      detail: 'the permutation control was NOT RUN: a canary or raw-evidence preflight failure '
        + 'voids the run before the control per section 8.6.0, so no control statistic exists '
        + 'for this run and none is published.',
      failures: [],
    }
    : metrics.assertPermutationControl({
      regretP: permutationControl.regretP,
      pairwiseP: permutationControl.pairwiseP,
      label: `${label}: permutation control`,
    });

  const run = arms.classifyRun({
    canariesPassed,
    // On a skipped control the run's void reasons are the harness failures
    // themselves; adding a control reason would claim the control missed a
    // threshold it was never measured against.
    permutationControlPassed: controlNotRun ? true : !permResult.void,
    identityAssertionsPassed,
    saltCollisionPassed,
    preflightFailures,
  });
  if (controlNotRun && run.status !== 'void') {
    throw new Error(`${label}: a skipped control must land on a void run - classifyRun disagrees, which is a bug`);
  }

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
