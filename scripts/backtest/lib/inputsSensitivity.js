'use strict';

/**
 * Gate 2, the `--inputs` PRODUCER's sensitivity comparison passes
 * (increment 5) - the piece that produces the LAST three
 * `assembleSweepInputs` inputs the generation driver could not:
 * `orderingSensitivityByCell`, `orderingDisagreement` and
 * `deployedPolicyDisagreement`.
 *
 * WHAT THE SEALED TEXTS REQUIRE (prereg 5.2/5.3/16, spec 8.4/8.5):
 *
 *   - Prereg 5.2: "Required sensitivities: a DB-collation variant and a
 *     duplicate-order shuffle. **If ordering changes any winner or any pass
 *     verdict, that result is INCONCLUSIVE.**"
 *   - Prereg 5.3: "**If the two estimands disagree on a winner, NO SELECTION
 *     OCCURS.**"
 *   - Spec 8.4 splits the ordering rule in two: a CELL-LEVEL check (a cell
 *     whose recorded verdict under the primary ordering is contradicted by
 *     either ordering variant gets Level 2 `inconclusive` - carried into the
 *     document as `orderingSensitivityByCell[cell].contradicted`, consumed by
 *     `arms.evaluateClaim`) and a SELECTION-LEVEL winner-only check
 *     (`orderingDisagreement`, consumed by `arms.selectAtLevel5`). Spec 8.4
 *     also states the estimand rule is "selection-level only, with no
 *     cell-level analog" - so the force-fill pass feeds
 *     `deployedPolicyDisagreement` and NEVER a cell's `contradicted`.
 *
 * HOW THE COMPARISON PASSES WORK
 *
 * Each pass assembles a COMPLETE variant `--inputs` document - identical to
 * the primary in every raw record, differing ONLY in `armWeekMetrics` (the
 * generation driver evaluates every scored arm-week once per sensitivity
 * configuration, over the SAME generated projections - an evaluation-time
 * re-scoring, never a regeneration, so section 9's sealed grid stays 14,688)
 * - and then computes that document's candidate verdicts and parsimony winner
 * through the REDUCER'S OWN EXPORTED claim assembly, injected by the caller:
 * `validateInputs`, `componentFVetoRecords`, `deriveComponentFOperands`,
 * `deriveComponentFOneSeries` and `assembleCellClaim` from
 * `server/scripts/run-backtest-sweep.js`, then `arms.selectAtLevel5`. Nothing
 * here re-implements a verdict; a verdict this module reports is one the
 * sealed reducer functions computed from a validated document.
 *
 * Producer-side determinations this module PINS because the sealed text does
 * not (B3 deferral-batch candidates, continuing the numbering of
 * `inputsAssembly.js` (1-3), `inputsGeneration.js` (4-6), the wiring's
 * determination 7 and the permutation capture's determination 8):
 *
 *   9. **The comparison passes evaluate candidate claims and Level-5
 *      parsimony only - the harness legs (canaries, the two identity
 *      assertions, the salt-collision guard, the permutation control) are
 *      not re-run per variant.** Every one of those legs reads the
 *      `preflight` and `permutationControl` blocks, which are byte-identical
 *      across the variant documents (only `armWeekMetrics` varies), and none
 *      of them enters any candidate cell's verdict - they force run-level
 *      `void`, which is variant-invariant. The comparison verdicts are
 *      computed with PLACEHOLDER sensitivity inputs (`contradicted: false`,
 *      both disagreement booleans false): spec 8.4 compares each cell's "own
 *      recorded verdict under the primary ordering" against the variants',
 *      so the verdicts being compared must not already carry the comparison's
 *      own output - the alternative is circular.
 *  10. **The estimand halt is evaluated on the POST-CONTRADICTION basis, and
 *      each estimand's "winner" is the Level-5 parsimony winner over that
 *      estimand's passing set.** After the ordering comparison has produced
 *      `orderingSensitivityByCell`, BOTH estimands' claims are recomputed
 *      from documents carrying those derived flags (the same flags for both:
 *      the ordering sensitivities are computed once, over the primary
 *      estimand, and their cell demotions are estimand-independent), and the
 *      two estimands "disagree on a winner" exactly when
 *      `policy.reconcileEstimands` halts on THOSE winners - including when
 *      one estimand selects a cell and the other selects none (`null`): an
 *      estimand under which no cell passes has not agreed that any cell is
 *      better. The sealed halt function is REUSED, not paraphrased. The
 *      basis matters (adversarial QA on this increment): an ordering
 *      contradiction can demote the placeholder-basis winner and shift the
 *      final document's actual selection to a cell the force-fill estimand
 *      never endorsed, so a halt evaluated on placeholder-basis winners can
 *      read `false` while prereg 5.3's "NO SELECTION OCCURS" condition is
 *      true of the selection the run will actually make. Determination 9's
 *      circularity argument does not apply here: `orderingSensitivityByCell`
 *      is fully computed before the halt is evaluated, so nothing feeds the
 *      comparison its own output.
 *  11. **The force-fill estimand governs BOTH sides of its regret.** Prereg
 *      5.3 defines a "legal nine-slot lineup" ESTIMAND - a redefinition of
 *      lineup legality under a heading that names it a regret estimand - and
 *      regret (prereg 5.2/6.1) is best-legal-lineup minus started-lineup. A
 *      started-side-only reading would mix legality regimes across the two
 *      sides of one regret and can make it negative (a deployed-policy
 *      "best" may leave a slot empty over negative actuals that force-fill's
 *      "started" must fill), which `policy.regretFor` rejects as a solver
 *      defect. Implemented in `armWeekEvaluator` (`lineupFor` applies to
 *      `started` AND `best`); registered HERE so it rides to the B3 batch as
 *      a numbered determination rather than an implicit code choice.
 *
 * Pure: no database, no filesystem, no clock, no RNG. The reducer functions
 * arrive by injection (they live in `server/scripts/`, which this tree may
 * not require); tests inject the real ones.
 */

const arms = require('./arms');
const inputsAssembly = require('./inputsAssembly');
const policy = require('./policy');
const { ORDERINGS } = require('./ordering');

/**
 * The three sensitivity configurations, in the pinned execution order:
 * prereg 5.2's two REQUIRED ordering variants, then prereg 5.3's force-fill
 * estimand. `key` is the label the generation driver files each variant's
 * `armWeekMetrics` under; `kind` decides which comparison the pass feeds
 * (spec 8.4: ordering passes feed the cell-level AND winner-only checks;
 * the estimand pass feeds the selection-level halt only).
 */
const SENSITIVITY_PASSES = Object.freeze([
  Object.freeze({
    key: 'ordering:db-collation', kind: 'ordering', ordering: ORDERINGS.DB_COLLATION, estimand: policy.ESTIMANDS.DEPLOYED_POLICY,
  }),
  Object.freeze({
    key: 'ordering:duplicate-shuffle', kind: 'ordering', ordering: ORDERINGS.DUPLICATE_SHUFFLE, estimand: policy.ESTIMANDS.DEPLOYED_POLICY,
  }),
  Object.freeze({
    key: 'estimand:force-fill', kind: 'estimand', ordering: ORDERINGS.PRIMARY, estimand: policy.ESTIMANDS.FORCE_FILL,
  }),
]);
const SENSITIVITY_PASS_KEYS = Object.freeze(SENSITIVITY_PASSES.map((pass) => pass.key));
const SENSITIVITY_BASIS_BY_PASS = Object.freeze({
  'ordering:db-collation': 'stage-1-placeholder-basis',
  'ordering:duplicate-shuffle': 'stage-1-placeholder-basis',
  'estimand:force-fill': 'stage-2-post-contradiction',
});

/** The two REQUIRED ordering variants (prereg 5.2) - the passes that feed spec 8.4's cell-level and winner-only checks. */
const ORDERING_PASSES = Object.freeze(SENSITIVITY_PASSES.filter((pass) => pass.kind === 'ordering'));

/** The candidate IUT verdict vocabulary (spec 8.2); 'baseline' is the control's alone and never enters a comparison. */
const IUT_VERDICTS = Object.freeze(['pass', 'fail', 'inconclusive', 'vetoed']);

/**
 * Own-layer domain check on a claims-pass result (adversarial QA finding 2 on
 * this increment): every one of the seven candidates must carry a candidate
 * IUT verdict, and a `winner` key must be present. Without this, a candidate
 * missing from BOTH sides of a comparison reads as agreement
 * (`undefined === undefined`) - fail-open by omission at an exported
 * boundary, the exact class `deriveComponentFOneSeries`' own-layer guards
 * exist for. `claimsPass` results satisfy this by construction; direct
 * callers of the comparison functions get the same line held.
 */
function assertClaimsPassResult(result, name, label) {
  if (!result || typeof result !== 'object' || !result.verdictByCell || typeof result.verdictByCell !== 'object') {
    throw new Error(`${label}: ${name} must be a claims-pass result carrying verdictByCell`);
  }
  for (const cell of arms.SELECTION_FAMILY) {
    const verdict = result.verdictByCell[cell.name];
    if (!IUT_VERDICTS.includes(verdict)) {
      throw new Error(
        `${label}: ${name} carries no candidate IUT verdict for ${cell.name} (got ${JSON.stringify(verdict)}) - `
        + 'a missing verdict must never read as agreement'
      );
    }
  }
  if (!('winner' in result)) {
    throw new Error(`${label}: ${name} carries no winner - a missing winner must never read as agreement`);
  }
  return true;
}

/**
 * The placeholder `orderingSensitivityByCell` every COMPARISON document
 * carries (determination 9): all seven candidates `contradicted: false`. The
 * real values exist only after the comparison this placeholder makes
 * non-circular, and they go into the FINAL document alone.
 */
function placeholderOrderingSensitivityByCell() {
  return Object.fromEntries(arms.SELECTION_FAMILY.map((cell) => [
    cell.name, { contradicted: false, detail: null },
  ]));
}

/**
 * The placeholder `sensitivityAudit` every COMPARISON document carries
 * (decision D6, same fixed-point doctrine as determination 9): all winners
 * null, no halt.  The real trail is this derivation's own OUTPUT and belongs
 * only to the FINAL document - a comparison document carrying real winners
 * would be feeding the comparison its own answer.  The shape satisfies the
 * document validators' internal-consistency checks by construction
 * (halted=false with equal null winners, null selection).
 */
function placeholderSensitivityAudit() {
  return {
    winnersByPass: Object.fromEntries(SENSITIVITY_PASS_KEYS.map((key) => [key, null])),
    basisByPass: { ...SENSITIVITY_BASIS_BY_PASS },
    estimandReconciliation: {
      selection: null,
      halted: false,
      reason: null,
      detail: 'placeholder: the audit trail is the sensitivity derivation\'s own output and belongs only to the final document (determination 9)',
      winners: { deployedPolicy: null, forceFill: null },
    },
  };
}

/**
 * Assemble one comparison document: the caller's raw records with ONE
 * sensitivity configuration's `armWeekMetrics` swapped in, and the
 * `orderingSensitivityByCell` the pass calls for - the PLACEHOLDER for the
 * stage-1 ordering comparison (determination 9's fixed point), the DERIVED
 * flags for the stage-2 estimand passes (determination 10's basis). The
 * disagreement booleans are always false here: they are the comparison's own
 * OUTPUT and belong only to the final document. Both sides of every
 * comparison go through this identical assembly.
 */
function assembleComparisonDocument({
  studyId, canariesPassed, records, armWeekMetrics, permutationControl,
  orderingSensitivityByCell = null, label = 'sensitivity comparison document',
}) {
  if (!records || typeof records !== 'object' || !records.preflight) {
    throw new Error(`${label}: records must be a generateSweepInputRecords result (with preflight)`);
  }
  if (!Array.isArray(armWeekMetrics)) {
    throw new Error(`${label}: armWeekMetrics must be an array (one sensitivity configuration's records)`);
  }
  return inputsAssembly.assembleSweepInputs({
    studyId,
    canariesPassed,
    orderingDisagreement: false,
    deployedPolicyDisagreement: false,
    armWeekMetrics,
    subgroupErrorRows: records.subgroupErrorRows,
    activationRecords: records.activationRecords,
    cohortExclusions: records.cohortExclusionRows,
    orderingSensitivityByCell: orderingSensitivityByCell || placeholderOrderingSensitivityByCell(),
    sensitivityAudit: placeholderSensitivityAudit(),
    preflight: records.preflight,
    permutationControl,
  });
}

const REDUCER_FUNCTIONS = Object.freeze([
  'validateInputs', 'componentFVetoRecords', 'deriveComponentFOperands', 'deriveComponentFOneSeries', 'assembleCellClaim',
]);

function assertReducerInjected(reducer, label) {
  if (!reducer || typeof reducer !== 'object') {
    throw new Error(`${label}: the reducer's exported claim-assembly functions must be injected (run-backtest-sweep.js)`);
  }
  for (const name of REDUCER_FUNCTIONS) {
    if (typeof reducer[name] !== 'function') {
      throw new Error(`${label}: reducer.${name} must be a function - a verdict this module reports must come from the sealed reducer, never a re-implementation`);
    }
  }
}

/**
 * One document's candidate verdicts and parsimony winner, via the injected
 * reducer exports - the same composition `buildReportFromInputs` performs on
 * its harness-ok path (validate, derive the (f) operands and f1 series per
 * on-cell, assemble every cell's claim, then Level 5), minus the
 * variant-invariant harness legs (determination 9 above).
 */
function claimsPass({ document, reducer, label = 'sensitivity claims pass' }) {
  assertReducerInjected(reducer, label);
  reducer.validateInputs(document, { label });
  const onCells = arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on');
  const derivedFOperandsByCell = Object.fromEntries(onCells.map((cell) => [
    cell.name, reducer.deriveComponentFOperands(cell.name, document.preflight),
  ]));
  const vetoRecordsByCell = Object.fromEntries(
    reducer.componentFVetoRecords(document.cells, document.preflight).map((row) => [row.cellName, row])
  );
  const derivedF1SeriesByCell = Object.fromEntries(onCells.map((cell) => [
    cell.name, reducer.deriveComponentFOneSeries(cell.name, {
      realizations: document.cells[cell.name].f.veto.realizations,
      qualifyingWeeks: derivedFOperandsByCell[cell.name].qualifyingWeeks,
    }),
  ]));
  const claims = Object.fromEntries(arms.ALL_CELLS.map((cellMeta) => [
    cellMeta.name,
    reducer.assembleCellClaim(
      cellMeta,
      document.cells[cellMeta.name],
      vetoRecordsByCell[cellMeta.name] || null,
      cellMeta.homeAway === 'on' ? derivedFOperandsByCell[cellMeta.name] : null,
      cellMeta.homeAway === 'on' ? derivedF1SeriesByCell[cellMeta.name] : null
    ),
  ]));
  const verdictByCell = Object.fromEntries(arms.SELECTION_FAMILY.map((cell) => {
    const verdict = claims[cell.name] && claims[cell.name].verdict;
    if (!['pass', 'fail', 'inconclusive', 'vetoed'].includes(verdict)) {
      throw new Error(`${label}: ${cell.name} produced verdict ${JSON.stringify(verdict)}, not a candidate IUT verdict`);
    }
    return [cell.name, verdict];
  }));
  const passingCells = arms.SELECTION_FAMILY.filter((cell) => verdictByCell[cell.name] === 'pass');
  // Level 5 with a 'valid' run status and no disagreement inputs: the
  // comparison asks what THIS document's claims would select; run-level void
  // causes are variant-invariant and the disagreement booleans are this
  // comparison's own OUTPUT (determination 9).
  const selection = arms.selectAtLevel5({
    runStatus: 'valid', passingCells, label: `${label} selection`,
  });
  const winner = selection.outcome === 'selected' ? selection.selected.name : null;
  return { verdictByCell, passingCells: passingCells.map((cell) => cell.name), winner, selection };
}

/**
 * STAGE 1 - the ordering comparison (spec 8.4), primary vs each REQUIRED
 * ordering variant, all on the placeholder basis (determination 9):
 *
 * - `orderingSensitivityByCell` (cell-level): a candidate is `contradicted`
 *   when EITHER ordering variant's recorded verdict differs from the
 *   primary's, with every disagreeing variant named in the detail.
 * - `orderingDisagreement` (winner-only): true when an ordering variant
 *   leaves every candidate verdict unchanged and still selects a different
 *   parsimony winner. Provably unreachable under the configuration-only
 *   parsimony order (spec 8.5) - computed anyway, as the sealed text keeps
 *   the branch: defense in depth, never assumed.
 */
function compareOrderingSensitivity({ primary, orderingResults, label = 'ordering sensitivity comparison' }) {
  assertClaimsPassResult(primary, 'the primary claims-pass result', label);
  for (const pass of ORDERING_PASSES) {
    const result = orderingResults && orderingResults[pass.key];
    if (!result || typeof result !== 'object') {
      // Prereg 5.2 makes both ordering variants REQUIRED: a missing pass is
      // never "no disagreement".
      throw new Error(`${label}: no claims-pass result for ${pass.key} - a sensitivity that was never run cannot show stability`);
    }
    assertClaimsPassResult(result, pass.key, label);
  }

  const orderingSensitivityByCell = {};
  for (const cell of arms.SELECTION_FAMILY) {
    const primaryVerdict = primary.verdictByCell[cell.name];
    const disagreements = [];
    for (const pass of ORDERING_PASSES) {
      const variantVerdict = orderingResults[pass.key].verdictByCell[cell.name];
      if (variantVerdict !== primaryVerdict) {
        disagreements.push(`${pass.key}: ${variantVerdict} vs primary ${primaryVerdict}`);
      }
    }
    orderingSensitivityByCell[cell.name] = disagreements.length > 0
      ? { contradicted: true, detail: disagreements.join('; ') }
      : { contradicted: false, detail: null };
  }

  const verdictsUnchanged = (pass) => arms.SELECTION_FAMILY.every(
    (cell) => orderingResults[pass.key].verdictByCell[cell.name] === primary.verdictByCell[cell.name]
  );
  const orderingDisagreement = ORDERING_PASSES.some(
    (pass) => verdictsUnchanged(pass) && orderingResults[pass.key].winner !== primary.winner
  );

  return { orderingSensitivityByCell, orderingDisagreement };
}

/**
 * STAGE 2 - the estimand halt (prereg 5.3), on the POST-CONTRADICTION basis
 * (determination 10): both inputs must be claims-pass results computed from
 * documents that already carry the DERIVED `orderingSensitivityByCell`, so
 * the winners reconciled here are the winners each estimand's analysis
 * actually produces once the ordering rule has been applied. The sealed halt
 * (`policy.reconcileEstimands`) is reused verbatim; null-vs-selected halts,
 * null-vs-null agrees.
 */
function compareEstimands({ finalPrimary, finalForceFill, label = 'estimand comparison' }) {
  assertClaimsPassResult(finalPrimary, 'the final primary claims-pass result', label);
  assertClaimsPassResult(finalForceFill, 'the final force-fill claims-pass result', label);
  const reconciliation = policy.reconcileEstimands({
    deployedPolicy: { winner: finalPrimary.winner },
    forceFill: { winner: finalForceFill.winner },
    label: `${label} estimands`,
  });
  return { deployedPolicyDisagreement: reconciliation.halted, reconciliation };
}

/**
 * The whole second-pass sequence, in one call, in two stages:
 *
 *   STAGE 1 (placeholder basis, determination 9): assemble the primary
 *   comparison document and one per REQUIRED ordering variant, run the
 *   claims pass on each, compare -> `orderingSensitivityByCell` and
 *   `orderingDisagreement`.
 *
 *   STAGE 2 (post-contradiction basis, determination 10): re-assemble the
 *   primary and force-fill documents CARRYING the stage-1 derived flags, run
 *   the claims pass on each, reconcile the two winners ->
 *   `deployedPolicyDisagreement`. The stage-2 primary winner is, by
 *   construction, the winner the FINAL document will select on a valid run
 *   with no disagreement (same records, same flags, same claim assembly).
 *
 * Documents are assembled and released SEQUENTIALLY - the preflight identity
 * arrays are the document's bulk, and five live documents would quintuple
 * peak memory for nothing.
 *
 * `records` must carry `armWeekMetricsBySensitivity` - the generation
 * driver's per-configuration re-evaluations. A missing configuration fails
 * here by name.
 */
function deriveSensitivityInputs({
  studyId, canariesPassed, records, permutationControl, reducer, label = 'sensitivity inputs',
}) {
  assertReducerInjected(reducer, label);
  const bySensitivity = records && records.armWeekMetricsBySensitivity;
  if (!bySensitivity || typeof bySensitivity !== 'object') {
    throw new Error(`${label}: records.armWeekMetricsBySensitivity is required - the generation driver evaluates every scored arm-week once per sensitivity configuration`);
  }
  // Every pass's records are checked BEFORE any assembly runs: a missing pass
  // is a structural defect of the records, and discovering it after the
  // primary pass has already paid for a full document assembly reports the
  // same fact later for no reason.
  for (const pass of SENSITIVITY_PASSES) {
    if (!Array.isArray(bySensitivity[pass.key])) {
      throw new Error(`${label}: records.armWeekMetricsBySensitivity[${JSON.stringify(pass.key)}] is missing - prereg 5.2/5.3 make every sensitivity pass required`);
    }
  }
  const runOne = (armWeekMetrics, passLabel, orderingSensitivityByCell) => {
    const document = assembleComparisonDocument({
      studyId, canariesPassed, records, armWeekMetrics, permutationControl, orderingSensitivityByCell, label: `${label} ${passLabel}`,
    });
    return claimsPass({ document, reducer, label: `${label} ${passLabel}` });
  };

  // --- stage 1: the ordering comparison, placeholder basis ---------------
  const primary = runOne(records.armWeekMetrics, 'primary', null);
  const orderingResults = {};
  for (const pass of ORDERING_PASSES) {
    orderingResults[pass.key] = runOne(bySensitivity[pass.key], pass.key, null);
  }
  const ordering = compareOrderingSensitivity({ primary, orderingResults, label });

  // --- stage 2: the estimand halt, post-contradiction basis --------------
  const finalPrimary = runOne(records.armWeekMetrics, 'final primary', ordering.orderingSensitivityByCell);
  const finalForceFill = runOne(bySensitivity['estimand:force-fill'], 'final force-fill', ordering.orderingSensitivityByCell);
  const estimand = compareEstimands({ finalPrimary, finalForceFill, label });

  return {
    orderingSensitivityByCell: ordering.orderingSensitivityByCell,
    orderingDisagreement: ordering.orderingDisagreement,
    deployedPolicyDisagreement: estimand.deployedPolicyDisagreement,
    detail: {
      primaryWinner: primary.winner,
      finalPrimaryWinner: finalPrimary.winner,
      winnersByPass: {
        ...Object.fromEntries(ORDERING_PASSES.map((pass) => [pass.key, orderingResults[pass.key].winner])),
        'estimand:force-fill': finalForceFill.winner,
      },
      basisByPass: { ...SENSITIVITY_BASIS_BY_PASS },
      estimandReconciliation: estimand.reconciliation,
    },
  };
}

module.exports = {
  SENSITIVITY_PASSES,
  SENSITIVITY_PASS_KEYS,
  SENSITIVITY_BASIS_BY_PASS,
  ORDERING_PASSES,
  IUT_VERDICTS,
  placeholderOrderingSensitivityByCell,
  placeholderSensitivityAudit,
  assembleComparisonDocument,
  assertClaimsPassResult,
  claimsPass,
  compareOrderingSensitivity,
  compareEstimands,
  deriveSensitivityInputs,
};
