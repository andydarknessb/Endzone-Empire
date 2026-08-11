/* eslint-disable no-console */
'use strict';

/**
 * Gate 2, the runtime/CLI wiring for the Phase 5 sweep report (increment 4).
 * `sweepEvaluator.js`/`sweepInference.js`/`sweepReport.js` are PURE - this
 * file is the only place their inputs come from disk and their output goes
 * back to disk.
 *
 * SCOPE, STATED PLAINLY: this script is a REDUCER, not a candidate-cell
 * COMPUTER. It reads an already-assembled `--inputs` JSON artifact - one
 * `weekDeltas` series per co-primary/e2 endpoint and for (f)'s f2, per cell,
 * already averaged over the 24 salts (`saltPairedDelta`); f1's series and
 * every (f) gate operand are DERIVED from the document's own raw records
 * (rounds 3 and 5), which is arithmetic over supplied data, not candidate
 * computation - and reduces it through the pure evaluator/inference/report
 * pipeline to a report. It does NOT call
 * `generateProjections`, does NOT touch a database or a snapshot client, and
 * does NOT compute a single candidate cell's projections itself. Building
 * THAT - the actual per-player-week generation across 8 cells x 24 salts x
 * 34 season-weeks that would PRODUCE an `--inputs` artifact from raw data -
 * is explicitly out of this increment's scope: Gate 0 (PHASE5_EXECUTION_
 * SPEC.md section 1) holds until a replacement freeze (Gate 4) carries the
 * complete implementation AND passes the independent implementation review,
 * and building a real generator now would mean this script could actually
 * execute a candidate cell, which is exactly what remains unauthorized. A
 * deterministic, disk-to-disk reducer with no I/O beyond the two files it is
 * told to read and write is the piece that CAN be built and tested now
 * without that authorization, since it never touches live data at all.
 *
 * The signed boundary VALUES themselves (section 8.1) are NOT read from
 * `--inputs` - they come from `arms.SIGNED_BOUNDARY_TABLE`, hardcoded in the
 * pure library, so an operator-supplied inputs file cannot smuggle in a
 * different margin than the sealed one.
 *
 * `--inputs`/`--out-json`/`--out-markdown` are all required, with no
 * default - the same discipline `run-backtest-mde.js` documents for its own
 * `--out`: a defaulted path is a path that can silently land somewhere a
 * container's copy-out step never looks.
 *
 * `--verify-against <path>`, OPTIONAL: after writing `--out-json`, byte-
 * compare it against an existing committed report and exit nonzero on any
 * difference - the reproduction check this script can actually offer today
 * (given the same `--inputs`, the same report bytes, every time), as
 * opposed to the full Commit-A/M/B Docker reproduction `backtest-
 * reproduction.yml` performs for the freeze sequence.
 */

const fs = require('fs');
const path = require('path');

const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');
const sweepEvaluator = require('../../scripts/backtest/lib/sweepEvaluator');
const sweepInference = require('../../scripts/backtest/lib/sweepInference');
const sweepReport = require('../../scripts/backtest/lib/sweepReport');
const sweepPreflight = require('../../scripts/backtest/lib/sweepPreflight');
const sweepEvidence = require('../../scripts/backtest/lib/sweepEvidence');
// Section 5's T_regret is a LINEUP outcome, so the permutation control needs
// the same production machinery the control cell evaluator uses. Functions
// cannot travel in an --inputs document, so the runner injects them here and
// the document carries only data - the same split run-backtest-mde.js uses.
const { optimalAssignment } = require('../services/lineupOptimizer');
const { availabilityFor } = require('../services/projectionModel');
const { DEFAULT_ROSTER_SLOTS } = require('../services/lineup.service');
const rosters = require('../../scripts/backtest/lib/rosters');
const { ORDERINGS } = require('../../scripts/backtest/lib/ordering');
const canonicalJsonIo = require('./lib/canonicalJsonIo');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
    throw new Error(`run-backtest-sweep: ${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    inputs: null, outJson: null, outMarkdown: null, verifyAgainst: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--inputs') args.inputs = requireFlagValue(argv, ++i, token);
    else if (token === '--out-json') args.outJson = requireFlagValue(argv, ++i, token);
    else if (token === '--out-markdown') args.outMarkdown = requireFlagValue(argv, ++i, token);
    else if (token === '--verify-against') args.verifyAgainst = requireFlagValue(argv, ++i, token);
    else throw new Error(`run-backtest-sweep: unknown argument ${token}`);
  }
  for (const [flag, value] of [
    ['--inputs', args.inputs],
    ['--out-json', args.outJson],
    ['--out-markdown', args.outMarkdown],
  ]) {
    if (!value) {
      throw new Error(
        `run-backtest-sweep: ${flag} is required, with no default. A defaulted output path is a path `
        + 'that can silently land outside a container\'s dedicated writable output mount.'
      );
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// The closed "sweep inputs" schema
// ---------------------------------------------------------------------------

const COMPONENT_KEYS = Object.freeze(['a', 'b', 'c', 'd', 'e1']);
const TOP_LEVEL_KEYS = Object.freeze([
  'studyId', 'canariesPassed', 'preflight', 'permutationControl',
  'orderingDisagreement', 'deployedPolicyDisagreement', 'sensitivityAudit', 'cohortExclusions', 'cells', 'evidence',
]);
// Decision D6 (ruled 2026-08-08): the estimand audit trail is a required
// document key.  These closed lists are the REDUCER's own - deliberately not
// imported from the producer, per the same independence rule as every other
// list here.  The winners themselves are attested producer data (the reducer
// receives neither the variant armWeekMetrics nor the per-pass claims, so it
// cannot recompute them - same trust class as `preflight`); what the reducer
// CAN check, it does, in validateInputs.
const SENSITIVITY_AUDIT_KEYS = Object.freeze(['winnersByPass', 'basisByPass', 'estimandReconciliation']);
const SENSITIVITY_AUDIT_PASS_KEYS = Object.freeze(['ordering:db-collation', 'ordering:duplicate-shuffle', 'estimand:force-fill']);
const SENSITIVITY_AUDIT_BASIS_BY_PASS = Object.freeze({
  'ordering:db-collation': 'stage-1-placeholder-basis',
  'ordering:duplicate-shuffle': 'stage-1-placeholder-basis',
  'estimand:force-fill': 'stage-2-post-contradiction',
});
const ESTIMAND_RECONCILIATION_KEYS = Object.freeze(['selection', 'halted', 'reason', 'detail', 'winners']);
const ESTIMAND_WINNER_KEYS = Object.freeze(['deployedPolicy', 'forceFill']);
const PREFLIGHT_KEYS = Object.freeze([
  'cohortRosterRows', 'controlUsage25Records', 'homeAwayStoredRecords', 'saltSeedRecords', 'matchedOffBaselineRows',
]);
const CO_PRIMARY_INPUT_KEYS = Object.freeze(['regretWeekDeltas', 'pairwiseWeekDeltas']);
const E2_INPUT_KEYS = Object.freeze(['endpoints']);
const E2_ENDPOINT_INPUT_KEYS = Object.freeze(['key', 'weekDeltas']);
// Round 3, SUBSTANTIVE 2: the four evaluability-gate operands (subgroupRows,
// meanAbsBaseline, maxAbsBaseline, weekMeanAbsBaselines) are DERIVED from
// preflight.matchedOffBaselineRows - section 6.1a item 2's definition run as
// code - and may no longer be supplied.
//
// Round 5, SUBSTANTIVE F: f1's weekDeltas is DERIVED too, and the document
// may not carry f1 at all. The round-3 justification for keeping the series
// supplied - "its per-week deltas need per-salt errors the document does not
// carry row-wise" - was FALSE for f1: f.veto.realizations carries exactly
// those per-salt differences row-wise (inc = |e_on| - |e_off|, section 6.4),
// and by sections 6.3 + 6.4 + prereg 9.8, D_w(f1) is exactly the mean over
// salts of the per-salt week mean of inc. A supplied f1 series was a second
// source of truth the document's own attested evidence already determined -
// the shipped fixture contradicted itself for two rounds, and a falsified
// series flipped a cell verdict against its own realizations. Only f2 stays
// supplied: inc destroys the individual error signs its |mean(e)| needs
// (proven by counterexample - two realization sets with identical inc and
// different f2).
const F_ENDPOINT_INPUT_KEYS = Object.freeze(['weekDeltas']);
const F_VETO_INPUT_KEYS = Object.freeze(['realizations']);
const F_VETO_REALIZATION_KEYS = Object.freeze(['season', 'week', 'playerId', 'salt', 'incrementalError']);
const CELL_INPUT_KEYS = Object.freeze(['a', 'b', 'c', 'd', 'e1', 'e2', 'f', 'activation', 'orderingSensitivity']);
const ORDERING_SENSITIVITY_KEYS = Object.freeze(['contradicted', 'detail']);
const COHORT_EXCLUSION_ROW_KEYS = Object.freeze([
  'season', 'week', 'members', 'defenses', 'onBye', 'excluded', 'excludedTotal', 'contradictions',
]);
const COHORT_EXCLUSION_REASON_KEYS = Object.freeze([
  'no-roster-row', 'status-class-reserve', 'status-class-off_roster',
  'no-fantasy-position', 'malformed-gsis-id', 'unmapped-gsis-id',
  'absent-from-players-table',
]);

function assertClosedKeys(obj, allowed, label) {
  const extra = Object.keys(obj || {}).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new Error(`${label}: unexpected key(s): ${extra.join(', ')}`);
  }
}

function validateCohortExclusions(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label}: must be an array with one row per evaluated season-week`);
  const expected = [2025, 2024].flatMap((season) => metrics.EVALUATED_WEEKS.map((week) => `${season}:${week}`));
  const seen = new Set();
  const integer = (value, valueLabel) => {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${valueLabel}: must be a nonnegative integer`);
  };
  for (const [index, row] of rows.entries()) {
    const rowLabel = `${label}[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${rowLabel}: must be an object`);
    const missing = COHORT_EXCLUSION_ROW_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(row, key));
    if (missing.length > 0) throw new Error(`${rowLabel}: missing required key(s): ${missing.join(', ')}`);
    assertClosedKeys(row, COHORT_EXCLUSION_ROW_KEYS, rowLabel);
    const coordinate = `${row.season}:${row.week}`;
    if (!expected.includes(coordinate)) throw new Error(`${rowLabel}: ${coordinate} is outside the evaluated grid`);
    if (seen.has(coordinate)) throw new Error(`${rowLabel}: duplicate coordinate ${coordinate}`);
    seen.add(coordinate);
    if (!row.excluded || typeof row.excluded !== 'object' || Array.isArray(row.excluded)) throw new Error(`${rowLabel}.excluded: must be an object`);
    const missingReasons = COHORT_EXCLUSION_REASON_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(row.excluded, key));
    if (missingReasons.length > 0) throw new Error(`${rowLabel}.excluded: missing required key(s): ${missingReasons.join(', ')}`);
    assertClosedKeys(row.excluded, COHORT_EXCLUSION_REASON_KEYS, `${rowLabel}.excluded`);
    for (const reason of COHORT_EXCLUSION_REASON_KEYS) integer(row.excluded[reason], `${rowLabel}.excluded.${reason}`);
    for (const field of ['members', 'defenses', 'onBye', 'excludedTotal', 'contradictions']) integer(row[field], `${rowLabel}.${field}`);
    const total = COHORT_EXCLUSION_REASON_KEYS.reduce((sum, reason) => sum + row.excluded[reason], 0);
    if (row.excludedTotal !== total) throw new Error(`${rowLabel}.excludedTotal does not equal its reason-count sum`);
  }
  const missing = expected.filter((coordinate) => !seen.has(coordinate));
  if (missing.length > 0 || rows.length !== expected.length) {
    throw new Error(`${label}: requires exactly one row per evaluated season-week; missing [${missing.join(', ')}]`);
  }
}

// The evaluated 17-week grid as string keys, once.
const WEEK_KEYS = Object.freeze(metrics.EVALUATED_WEEKS.map(String));

/**
 * A `{ [week]: number }` contrast series, VALUE-validated.
 *
 * Round 5, MINOR G: the container check accepted anything object-shaped, and
 * `dropWeeks` decides presence with the COERCING `isFiniteNumber`, so a
 * quoted number ('0.5') survived the filter and then concatenated into
 * `bootstrapMean`'s numeric accumulator - producing an unlocated
 * classifyBootstrapEndpoint abort on non-integer data, and on all-integer
 * data a FINITE, corrupted CI bound (6.5e14) published inside a `valid` run.
 * Malformed values ({}, NaN, '+Infinity', 'n/a') were meanwhile silently
 * indistinguishable from a legitimately dropped week, so three of them
 * flipped a cell verdict and moved the SELECTED cell with no diagnostic.
 *
 * Unlike (f) - whose week set is DEFINED by presence, so absence is
 * self-contradictory - prereg 10.4 genuinely permits a week here to carry no
 * rows. Absence is expressed by OMITTING the key, the only form the harness
 * has ever produced and the same form crossCheckClaimInputs already requires
 * (`sourceValue === undefined`). A present key is a claim that the week WAS
 * measured, so it must carry a real, finite number.
 */
function assertWeekDeltaSeries(series, label) {
  if (Array.isArray(series)) {
    throw new Error(`${label}: must be a { [week]: number } object keyed by evaluated week, not an array - the array is the (f) series' shape, and its indices would silently misalign the weeks`);
  }
  if (!series || typeof series !== 'object') {
    throw new Error(`${label}: must be a { [week]: number } object keyed by evaluated week`);
  }
  for (const [week, value] of Object.entries(series)) {
    if (!WEEK_KEYS.includes(week)) {
      throw new Error(`${label}: week ${JSON.stringify(week)} is outside the evaluated grid (weeks ${WEEK_KEYS[0]}-${WEEK_KEYS[WEEK_KEYS.length - 1]}, prereg 4.1) - a key the evaluator never reads is evidence that silently does nothing`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      // String(value) for numbers, not JSON.stringify: JSON renders NaN and
      // +/-Infinity as the literal `null`, and a rejection that names a
      // DIFFERENT value than the one supplied is exactly the Number(null)
      // class of misreading this repo keeps having to guard against.
      const rendered = typeof value === 'number' ? String(value) : JSON.stringify(value);
      throw new Error(`${label}.week-${week}: must be a finite number, got ${rendered}. A week with no rows for this arm is dropped by OMITTING its key (prereg 10.4); never write a placeholder`);
    }
  }
}

/**
 * Validate the document's sensitivity audit trail (decision D6).  The
 * reducer cannot recompute the winners (it never sees the variant
 * armWeekMetrics), but a trail whose own story contradicts itself - or
 * contradicts the document's `deployedPolicyDisagreement` boolean the run
 * verdict actually consumes - is rejected, never published.  Note the MIXED
 * basis carried as one map: the `ordering:*` winners are stage-1
 * placeholder-basis, the `estimand:force-fill` winner is stage-2
 * post-contradiction (determinations 9/10).
 */
function validateSensitivityAudit(audit, deployedPolicyDisagreement, label) {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    throw new Error(`${label}: must be the derived audit-trail object; a document without its trail is not auditable from the report alone`);
  }
  assertClosedKeys(audit, SENSITIVITY_AUDIT_KEYS, label);
  for (const key of SENSITIVITY_AUDIT_KEYS) {
    if (!audit[key] || typeof audit[key] !== 'object' || Array.isArray(audit[key])) throw new Error(`${label}.${key}: must be an object`);
  }
  const candidateNames = arms.SELECTION_FAMILY.map((cell) => cell.name);
  const winner = (value, valueLabel) => {
    if (value !== null && !candidateNames.includes(value)) {
      throw new Error(`${valueLabel}: must be null or a candidate cell name, got ${JSON.stringify(value)}`);
    }
    return value;
  };
  assertClosedKeys(audit.winnersByPass, SENSITIVITY_AUDIT_PASS_KEYS, `${label}.winnersByPass`);
  for (const key of SENSITIVITY_AUDIT_PASS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(audit.winnersByPass, key)) {
      throw new Error(`${label}.winnersByPass: missing required pass ${JSON.stringify(key)} - a pass with no recorded winner cannot show stability`);
    }
    winner(audit.winnersByPass[key], `${label}.winnersByPass[${JSON.stringify(key)}]`);
  }
  assertClosedKeys(audit.basisByPass, SENSITIVITY_AUDIT_PASS_KEYS, `${label}.basisByPass`);
  for (const key of SENSITIVITY_AUDIT_PASS_KEYS) {
    const expected = SENSITIVITY_AUDIT_BASIS_BY_PASS[key];
    if (audit.basisByPass[key] !== expected) {
      throw new Error(`${label}.basisByPass[${JSON.stringify(key)}]: must be ${JSON.stringify(expected)}, got ${JSON.stringify(audit.basisByPass[key])}`);
    }
  }
  const reconciliation = audit.estimandReconciliation;
  assertClosedKeys(reconciliation, ESTIMAND_RECONCILIATION_KEYS, `${label}.estimandReconciliation`);
  for (const key of ESTIMAND_RECONCILIATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(reconciliation, key)) throw new Error(`${label}.estimandReconciliation.${key}: missing`);
  }
  if (typeof reconciliation.halted !== 'boolean') throw new Error(`${label}.estimandReconciliation.halted: must be a boolean`);
  if (reconciliation.reason !== null && typeof reconciliation.reason !== 'string') throw new Error(`${label}.estimandReconciliation.reason: must be a string or null`);
  if (typeof reconciliation.detail !== 'string') throw new Error(`${label}.estimandReconciliation.detail: must be a string`);
  assertClosedKeys(reconciliation.winners, ESTIMAND_WINNER_KEYS, `${label}.estimandReconciliation.winners`);
  const deployedPolicy = winner(reconciliation.winners.deployedPolicy, `${label}.estimandReconciliation.winners.deployedPolicy`);
  const forceFill = winner(reconciliation.winners.forceFill, `${label}.estimandReconciliation.winners.forceFill`);
  const selection = winner(reconciliation.selection, `${label}.estimandReconciliation.selection`);
  if (reconciliation.halted !== (deployedPolicy !== forceFill)) {
    throw new Error(`${label}.estimandReconciliation: halted=${reconciliation.halted} contradicts its own winners (deployedPolicy=${JSON.stringify(deployedPolicy)}, forceFill=${JSON.stringify(forceFill)})`);
  }
  if (selection !== (reconciliation.halted ? null : deployedPolicy)) {
    throw new Error(`${label}.estimandReconciliation: selection=${JSON.stringify(selection)} contradicts halted=${reconciliation.halted} and deployedPolicy=${JSON.stringify(deployedPolicy)}`);
  }
  if (audit.winnersByPass['estimand:force-fill'] !== forceFill) {
    throw new Error(`${label}: winnersByPass['estimand:force-fill'] disagrees with estimandReconciliation.winners.forceFill`);
  }
  // The one cross-document invariant: the boolean the run verdict consumes
  // must be the trail's own halt - a laundered trail beside a clean boolean
  // (or the reverse) is a document telling two stories.
  if (deployedPolicyDisagreement !== reconciliation.halted) {
    throw new Error(`${label}: deployedPolicyDisagreement=${deployedPolicyDisagreement} disagrees with the audit trail's halted=${reconciliation.halted}`);
  }
}

/**
 * Validate the whole `--inputs` document against the closed schema, throwing
 * an ACTIONABLE, path-specific error on the first thing wrong - never a
 * partial read that fails deep inside the evaluator with a confusing
 * message about a symptom rather than the actual malformed input.
 */
function validateInputs(inputs, { label = '--inputs' } = {}) {
  if (!inputs || typeof inputs !== 'object') throw new Error(`${label}: must be a JSON object`);
  assertClosedKeys(inputs, TOP_LEVEL_KEYS, label);
  if (typeof inputs.studyId !== 'string' || inputs.studyId.length === 0) {
    throw new Error(`${label}.studyId: must be a non-empty string`);
  }
  for (const flag of ['canariesPassed', 'orderingDisagreement', 'deployedPolicyDisagreement']) {
    if (typeof inputs[flag] !== 'boolean') throw new Error(`${label}.${flag}: must be a boolean`);
  }
  validateCohortExclusions(inputs.cohortExclusions, `${label}.cohortExclusions`);
  validateSensitivityAudit(inputs.sensitivityAudit, inputs.deployedPolicyDisagreement, `${label}.sensitivityAudit`);
  if (!inputs.preflight || typeof inputs.preflight !== 'object') {
    throw new Error(`${label}.preflight: must carry raw identity and salt-seed records; operator-supplied pass/fail booleans are prohibited`);
  }
  assertClosedKeys(inputs.preflight, PREFLIGHT_KEYS, `${label}.preflight`);
  for (const key of PREFLIGHT_KEYS) {
    if (!Array.isArray(inputs.preflight[key])) {
      throw new Error(`${label}.preflight.${key}: must be an array of raw preflight records`);
    }
  }
  if (!inputs.evidence || typeof inputs.evidence !== 'object' || Array.isArray(inputs.evidence)) {
    throw new Error(`${label}.evidence: must be the complete descriptive-evidence object`);
  }
  if (!inputs.permutationControl || typeof inputs.permutationControl !== 'object') {
    throw new Error(`${label}.permutationControl: must be an object`);
  }
  // Section 5's T_regret is mean DEPLOYED-POLICY regret over the week's rosters,
  // so the control needs the same roster/cohort artifacts the control cell
  // evaluator uses. Only DATA is accepted here: `rosterSlots`, `availabilityFor`
  // and `optimize` are injected by this runner, never read from the document, so
  // an operator cannot substitute a different optimizer or slot model.
  assertClosedKeys(
    inputs.permutationControl,
    ['observations', 'rosterRows', 'rosterWeeks', 'cohortWeeks', 'positionRank', 'nameRankById'],
    `${label}.permutationControl`
  );
  for (const key of ['rosterWeeks', 'cohortWeeks']) {
    const artifact = inputs.permutationControl[key];
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error(`${label}.permutationControl.${key}: must map each evaluated week to its artifact; section 5's statistic is a lineup outcome and cannot be computed without it`);
    }
  }
  for (const key of ['positionRank', 'nameRankById']) {
    if (!inputs.permutationControl[key] || typeof inputs.permutationControl[key] !== 'object') {
      throw new Error(`${label}.permutationControl.${key}: must be an object; candidate order fails closed rather than guessing`);
    }
  }
  for (const key of ['observations', 'rosterRows']) {
    if (!Array.isArray(inputs.permutationControl[key])) {
      throw new Error(`${label}.permutationControl.${key}: must be canonical raw control observations`);
    }
  }
  if (!inputs.cells || typeof inputs.cells !== 'object') throw new Error(`${label}.cells: must be an object`);
  const missingCells = arms.ALL_CELLS.filter((c) => inputs.cells[c.name] === undefined);
  if (missingCells.length > 0) {
    throw new Error(`${label}.cells: missing ${missingCells.map((c) => c.name).join(', ')} - all 8 factorial cells are required`);
  }
  const extraCells = Object.keys(inputs.cells).filter((name) => !arms.ALL_CELLS.some((c) => c.name === name));
  if (extraCells.length > 0) throw new Error(`${label}.cells: unrecognized cell(s): ${extraCells.join(', ')}`);

  for (const cellMeta of arms.ALL_CELLS) {
    const cellInput = inputs.cells[cellMeta.name];
    const cellLabel = `${label}.cells.${cellMeta.name}`;
    if (!cellInput || typeof cellInput !== 'object') throw new Error(`${cellLabel}: must be an object`);
    assertClosedKeys(cellInput, CELL_INPUT_KEYS, cellLabel);

    const isOnCell = cellMeta.homeAway === 'on';
    const usageDiffersFromControl = cellMeta.blendWeight !== arms.CONTROL_BLEND_WEIGHT;
    // Prereg 9.3/9.4: (b) applies only to "on" cells, (c) only when
    // blendWeight differs from the control's 0.25 - not-applicable
    // otherwise. Mirrors the f/activation null-when-not-applicable pattern
    // exactly, so an --inputs author cannot silently compute data that gets
    // discarded downstream.
    const applicability = { b: isOnCell, c: usageDiffersFromControl };
    for (const key of COMPONENT_KEYS) {
      const required = !(key in applicability) || applicability[key];
      if (!required) {
        if (cellInput[key] !== null) {
          throw new Error(
            `${cellLabel}.${key}: must be null - component (${key}) is not applicable to this cell `
            + `(prereg 9.${key === 'b' ? 3 : 4})`
          );
        }
        continue;
      }
      if (!cellInput[key] || typeof cellInput[key] !== 'object') {
        throw new Error(`${cellLabel}.${key}: must be an object (component (${key}) IS applicable to this cell)`);
      }
      assertClosedKeys(cellInput[key], CO_PRIMARY_INPUT_KEYS, `${cellLabel}.${key}`);
      for (const seriesKey of CO_PRIMARY_INPUT_KEYS) {
        assertWeekDeltaSeries(cellInput[key][seriesKey], `${cellLabel}.${key}.${seriesKey}`);
      }
    }
    if (!cellInput.e2 || typeof cellInput.e2 !== 'object') throw new Error(`${cellLabel}.e2: must be an object`);
    assertClosedKeys(cellInput.e2, E2_INPUT_KEYS, `${cellLabel}.e2`);
    if (!Array.isArray(cellInput.e2.endpoints)) throw new Error(`${cellLabel}.e2.endpoints: must be an array`);
    for (const [i, endpoint] of cellInput.e2.endpoints.entries()) {
      const endpointLabel = `${cellLabel}.e2.endpoints[${i}]`;
      if (!endpoint || typeof endpoint !== 'object') throw new Error(`${endpointLabel}: must be an object`);
      assertClosedKeys(endpoint, E2_ENDPOINT_INPUT_KEYS, endpointLabel);
      if (typeof endpoint.key !== 'string' || !sweepEvaluator.E2_ENDPOINT_KEYS.includes(endpoint.key)) {
        throw new Error(`${endpointLabel}.key: must be one of the thirteen preregistered (e2) keys`);
      }
      assertWeekDeltaSeries(endpoint.weekDeltas, `${endpointLabel}(${endpoint.key}).weekDeltas`);
    }

    if (isOnCell) {
      if (!cellInput.f || typeof cellInput.f !== 'object') throw new Error(`${cellLabel}.f: must be an object for an "on" cell`);
      // Round 5, SUBSTANTIVE F: f1 is fully DERIVED and the key may not
      // appear at all - not `null` (that family means "not applicable", and
      // f1 is applicable; a null would read as "no f1 evidence", the exact
      // misreading BLOCKER A punished), not an empty object (which would
      // survive a closed-key check silently). Absent, structurally.
      if ('f1' in cellInput.f) {
        throw new Error(
          `${cellLabel}.f: unexpected key(s): f1 - f1's D_w series is DERIVED from f.veto.realizations `
          + '(sections 6.3 + 6.4, prereg 9.8); supplying it would give the document two sources of '
          + 'truth for one quantity, and the raw realizations already win.'
        );
      }
      assertClosedKeys(cellInput.f, ['f2', 'veto'], `${cellLabel}.f`);
      for (const endpointKey of ['f2']) {
        if (!cellInput.f[endpointKey] || typeof cellInput.f[endpointKey] !== 'object') {
          throw new Error(`${cellLabel}.f.${endpointKey}: must be an object`);
        }
        assertClosedKeys(cellInput.f[endpointKey], F_ENDPOINT_INPUT_KEYS, `${cellLabel}.f.${endpointKey}`);
        // Round 4, BLOCKER A: Number(null) is 0, and 0 is the most favourable
        // value the margin-shifted sign test can see - a document with NO (f)
        // evidence at all published a valid run with the no-harm gate passed.
        // Every entry must be a FINITE NUMBER, throw-class, because under the
        // derived-operand contract a qualifying week's delta is computable BY
        // CONSTRUCTION: the veto coverage assertion demands a realization for
        // every subgroup player-week x salt, so evidence exists for every
        // qualifying week by the document's own attestation, and an absent or
        // non-finite entry contradicts it - malformed, never sparse.
        //
        // The sealed convention this DECLINES, named so the argument is won
        // rather than omitted: prereg 10.4's drop-and-report rule ("a week
        // with no rows for an arm is dropped ... more than 2 of the 17
        // evaluated weeks drop -> UNEVALUABLE"). That rule governs series
        // over the FIXED 17-week grid, where a week can legitimately carry no
        // rows. Component (f)'s week set is DEFINED by presence (prereg 9.8
        // step 1: weeks WITH subgroup rows in both cells; spec 6.1a item 1:
        // "the identical week set the endpoint's own D_w series is built
        // from"), so a null aligned 1:1 to a QUALIFYING week is
        // self-contradictory, not a legitimate drop - the sibling of 6.4a's
        // "a missing realization is a HARD ERROR". An empty array stays
        // legal: an empty subgroup has zero qualifying weeks. (This loop now
        // guards f2 only - f1's series is derived, and its finiteness is
        // guaranteed harder still: assertVetoRealizationCoverage rejects any
        // non-finite incrementalError in preflight, before derivation runs.)
        const weekDeltas = cellInput.f[endpointKey].weekDeltas;
        if (!Array.isArray(weekDeltas) || weekDeltas.some((d) => typeof d !== 'number' || !Number.isFinite(d))) {
          throw new Error(
            `${cellLabel}.f.${endpointKey}.weekDeltas: every entry must be a finite number - a `
            + 'qualifying week with no delta contradicts the document\'s own complete veto coverage, '
            + 'and absent evidence must never read as a favourable sign (prereg 9.1).'
          );
        }
      }
      if (!cellInput.f.veto || typeof cellInput.f.veto !== 'object') {
        throw new Error(`${cellLabel}.f.veto: must contain the complete player-week x salt realization domain`);
      }
      assertClosedKeys(cellInput.f.veto, F_VETO_INPUT_KEYS, `${cellLabel}.f.veto`);
      for (const [name, rows, keys] of [
        ['realizations', cellInput.f.veto.realizations, F_VETO_REALIZATION_KEYS],
      ]) {
        if (!Array.isArray(rows)) throw new Error(`${cellLabel}.f.veto.${name}: must be an array`);
        for (const [index, row] of rows.entries()) assertClosedKeys(row || {}, keys, `${cellLabel}.f.veto.${name}[${index}]`);
      }
      if (!cellInput.activation || typeof cellInput.activation !== 'object') {
        throw new Error(`${cellLabel}.activation: must be an object for an "on" cell`);
      }
      assertClosedKeys(cellInput.activation, ['projectionsByPositionBySeason'], `${cellLabel}.activation`);
      const bySeason = cellInput.activation.projectionsByPositionBySeason;
      if (!bySeason || typeof bySeason !== 'object') {
        throw new Error(`${cellLabel}.activation.projectionsByPositionBySeason: must be an object`);
      }
      assertClosedKeys(bySeason, ['2025', '2024'], `${cellLabel}.activation.projectionsByPositionBySeason`);
      // Prereg 11.2: activation is checked ONCE PER SEASON, independently -
      // "2025 (primary)" and "2024 (safety)" are two separate rows in the
      // sealed threshold table, both required.
      for (const season of ['2025', '2024']) {
        if (!bySeason[season] || typeof bySeason[season] !== 'object') {
          throw new Error(`${cellLabel}.activation.projectionsByPositionBySeason.${season}: must be an object`);
        }
      }
    } else {
      if (cellInput.f !== null) throw new Error(`${cellLabel}.f: must be null for an "off" cell - component (f) has no matched off-twin to compare an off-cell against`);
      if (cellInput.activation !== null) throw new Error(`${cellLabel}.activation: must be null for an "off" cell - there is nothing to check activation of`);
    }

    // Prereg 5.2/16, PHASE5_EXECUTION_SPEC.md section 8.4: the DB-collation
    // variant and duplicate-order shuffle can CONTRADICT a candidate cell's
    // own verdict under the primary ordering, at Level 2 (cell), regardless
    // of the overall winner. Required for every CANDIDATE cell - the
    // control never receives a verdict to contradict (row 26 ruling).
    const isControlCell = cellMeta.name === arms.CONTROL_CELL;
    if (isControlCell) {
      if (cellInput.orderingSensitivity !== null) {
        throw new Error(`${cellLabel}.orderingSensitivity: must be null for the control cell - it receives no candidate verdict to contradict`);
      }
    } else {
      const sensitivity = cellInput.orderingSensitivity;
      if (!sensitivity || typeof sensitivity !== 'object') {
        throw new Error(`${cellLabel}.orderingSensitivity: must be an object for a candidate cell`);
      }
      assertClosedKeys(sensitivity, ORDERING_SENSITIVITY_KEYS, `${cellLabel}.orderingSensitivity`);
      if (typeof sensitivity.contradicted !== 'boolean') {
        throw new Error(`${cellLabel}.orderingSensitivity.contradicted: must be a boolean`);
      }
      if (sensitivity.detail !== null && typeof sensitivity.detail !== 'string') {
        throw new Error(`${cellLabel}.orderingSensitivity.detail: must be a string or null`);
      }
    }
  }
  // The ORDERING-axis audit cross-check, symmetric with the halted-axis one
  // inside validateSensitivityAudit (adversarial QA on this slice found the
  // asymmetry).  It runs here, after every cell's orderingSensitivity has
  // been validated, because it reads them.  When NO candidate is
  // contradicted, the stage-1 and stage-2 bases coincide (the derived flags
  // equal the placeholder), so the honest derivation forces: every
  // `ordering:*` winner equals the reconciliation's deployed-policy winner
  // exactly when `orderingDisagreement` is false, and at least one differs
  // when it is true.  With a contradicted candidate the bases genuinely
  // diverge (a stage-1 variant winner may legitimately differ from the
  // stage-2 deployed-policy winner), so no cross-winner constraint is
  // checkable and none is imposed.
  {
    const candidates = arms.SELECTION_FAMILY.map((cell) => cell.name);
    const anyContradicted = candidates.some((name) => inputs.cells[name].orderingSensitivity.contradicted === true);
    if (!anyContradicted) {
      const deployedPolicy = inputs.sensitivityAudit.estimandReconciliation.winners.deployedPolicy;
      const orderingKeys = SENSITIVITY_AUDIT_PASS_KEYS.filter((key) => key.startsWith('ordering:'));
      const disagreeing = orderingKeys.filter((key) => inputs.sensitivityAudit.winnersByPass[key] !== deployedPolicy);
      if (inputs.orderingDisagreement === false && disagreeing.length > 0) {
        throw new Error(
          `${label}.sensitivityAudit: orderingDisagreement=false with no contradicted candidate, but `
          + `${disagreeing.map((key) => `winnersByPass[${JSON.stringify(key)}]=${JSON.stringify(inputs.sensitivityAudit.winnersByPass[key])}`).join(', ')} `
          + `disagrees with the deployed-policy winner ${JSON.stringify(deployedPolicy)} - a laundered ordering trail beside a clean boolean`
        );
      }
      if (inputs.orderingDisagreement === true && disagreeing.length === 0) {
        throw new Error(
          `${label}.sensitivityAudit: orderingDisagreement=true with no contradicted candidate, but every ordering winner `
          + `equals the deployed-policy winner ${JSON.stringify(deployedPolicy)} - the boolean claims a disagreement the trail does not show`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Assembling one cell's evaluateClaim() input from its raw series
// ---------------------------------------------------------------------------

function boundariesFor(key) {
  const boundary = arms.SIGNED_BOUNDARY_TABLE[key];
  if (!boundary) throw new Error(`run-backtest-sweep: no signed boundary is defined for '${key}'`);
  return boundary;
}

function evaluateCoPrimary(name, cellInput) {
  const regret = boundariesFor(`${name}-regret`);
  const pairwise = boundariesFor(`${name}-pairwise`);
  return sweepEvaluator.evaluateCoPrimaryComponent({
    name,
    regretWeekDeltas: cellInput.regretWeekDeltas,
    pairwiseWeekDeltas: cellInput.pairwiseWeekDeltas,
    regretPassingBoundary: regret.passingBoundary,
    regretHarmfulBoundary: regret.harmfulBoundary,
    regretDirection: regret.direction,
    pairwisePassingBoundary: pairwise.passingBoundary,
    pairwiseHarmfulBoundary: pairwise.harmfulBoundary,
    pairwiseDirection: pairwise.direction,
  });
}

function evaluateE2(cellInput) {
  const endpoints = cellInput.e2.endpoints.map((e) => {
    const boundary = boundariesFor(e.key);
    return {
      key: e.key,
      weekDeltas: e.weekDeltas,
      passingBoundary: boundary.passingBoundary,
      harmfulBoundary: boundary.harmfulBoundary,
      direction: boundary.direction,
    };
  });
  return sweepEvaluator.evaluateE2Component({ endpoints });
}

/**
 * Component applicability, per PREREGISTRATION.md - confirmed against the
 * SEALED text directly (independent implementation review finding, not
 * inferred from PHASE5_EXECUTION_SPEC.md, which does not itself restate
 * this):
 *
 *   - **(a)** superiority over the shipped control (9.2): no gating
 *     condition is stated, so it applies to every candidate cell.
 *   - **(b)** homeAway attribution (9.3): "**only if the cell has homeAway =
 *     on**" - not-applicable otherwise. Prereg 9.1 gives this EXACT case as
 *     its own worked example of "not applicable": "(for example (b) for an
 *     off cell)".
 *   - **(c)** usage attribution (9.4): "**only if blendWeight differs from
 *     0.25**" - not-applicable for usage-25-off (the control) and
 *     usage-25-on, both of which sit AT the control's blend weight.
 *   - **(d)** superiority over the naive benchmark (9.5): no gating
 *     condition stated, applies to every cell.
 *   - **(e1)** the 2024 safety co-primary (9.6): no gating condition
 *     stated, applies to every cell.
 *   - **(e2)** the thirteen secondary-safety rows (9.7): no gating
 *     condition stated, applies to every cell.
 *   - **(f)** the negative-baseline subgroup no-harm gate (9.8): its own
 *     section header states "(homeAway = on cells only)" - it compares an
 *     on-cell against its OWN matched off-twin, so an off-cell has nothing
 *     further to match against.
 *
 * `evaluateClaim` already implements prereg 9.1's "vacuous by definition"
 * rule for a component marked `{ applicable: false }` - it passes
 * trivially and the divisor stays fixed at 7 regardless.
 */
/**
 * The control (usage-25 x off) never receives a candidate IUT verdict.
 * Independent implementation review ruling (row 26, resolved as a DEFECT,
 * not an ambiguity): prereg §9.1 says "one claim per **candidate** cell,"
 * and §7.1/§12.1 name the control as distinct from "the 7 non-control
 * cells." Component (a)'s own comparator IS the control, so a control-vs-
 * itself run would trivially and permanently `fail` every real run - not a
 * finding, an artifact of asking a nonsensical question. The control MAY
 * publish baseline metrics and pipeline assertions (not yet wired - see
 * the report-schema expansion), but MUST NOT receive `pass`, `fail`,
 * `inconclusive`, or `vetoed` under the seven-component candidate IUT.
 * `verdict: 'baseline'` is a distinct fifth value `sweepReport.js` accepts
 * ONLY for the control cell, never for a candidate.
 */
/** The four derived gate operands, shaped for arms.componentFEndpoint. */
function componentFOperandFields(derived) {
  return {
    subgroupRows: derived.subgroupRows,
    meanAbsBaseline: derived.meanAbsBaseline,
    maxAbsBaseline: derived.maxAbsBaseline,
    weekMeanAbsBaselines: derived.weekMeanAbsBaselines,
  };
}

function controlBaselineClaim(cellMeta) {
  return {
    cell: cellMeta.name,
    verdict: 'baseline',
    components: {},
    failures: [],
    inconclusive: [],
    vetoedReasons: [],
  };
}

function assembleCellClaim(cellMeta, cellInput, derivedFVeto = null, derivedFOperands = null, derivedF1WeekDeltas = null) {
  if (cellMeta.name === arms.CONTROL_CELL) {
    return controlBaselineClaim(cellMeta);
  }
  const isOnCell = cellMeta.homeAway === 'on';
  const usageDiffersFromControl = cellMeta.blendWeight !== arms.CONTROL_BLEND_WEIGHT;
  if (isOnCell) {
    if (!derivedFOperands) {
      throw new Error(`${cellMeta.name}: an on-cell claim requires the derived component (f) operands (round 3, SUBSTANTIVE 2)`);
    }
    if (!Array.isArray(derivedF1WeekDeltas)) {
      throw new Error(`${cellMeta.name}: an on-cell claim requires f1's DERIVED D_w series (round 5, SUBSTANTIVE F)`);
    }
    // Section 6.1a item 1: the qualifying weeks are "the identical week set
    // the endpoint's own D_w series is built from". The count is now DERIVED
    // from the raw rows, so a document whose weekDeltas disagree with it is
    // MALFORMED (throw-class), never sparse evidence - and this is a
    // guarantee the supplied-operand contract could not express, because
    // clusters used to be the supplied array's own length.
    // f2 only: f1's series is derived and matches the qualifying set by
    // construction (deriveComponentFOneSeries fails closed on both directions
    // of a week-set mismatch, which is strictly stronger than this check).
    for (const endpointKey of ['f2']) {
      const weekDeltas = cellInput.f[endpointKey].weekDeltas;
      if (!Array.isArray(weekDeltas) || weekDeltas.length !== derivedFOperands.qualifyingWeekCount) {
        throw new Error(
          `${cellMeta.name}.f.${endpointKey}: carries ${Array.isArray(weekDeltas) ? weekDeltas.length : 'no'} `
          + `weekDeltas against ${derivedFOperands.qualifyingWeekCount} derived qualifying weeks - `
          + 'section 6.1a item 1 pins the identical week set, so a mismatched document is malformed.'
        );
      }
    }
  }
  const components = {
    a: evaluateCoPrimary('a', cellInput.a),
    b: isOnCell ? evaluateCoPrimary('b', cellInput.b) : { applicable: false },
    c: usageDiffersFromControl ? evaluateCoPrimary('c', cellInput.c) : { applicable: false },
    d: evaluateCoPrimary('d', cellInput.d),
    e1: evaluateCoPrimary('e1', cellInput.e1),
    e2: evaluateE2(cellInput),
    f: isOnCell
      ? arms.componentF({
        // f1's series and every gate operand are DERIVED (rounds 3 and 5);
        // the document supplies only f2's series and the raw realizations.
        f1: { weekDeltas: derivedF1WeekDeltas, ...componentFOperandFields(derivedFOperands) },
        f2: { weekDeltas: cellInput.f.f2.weekDeltas, ...componentFOperandFields(derivedFOperands) },
        veto: derivedFVeto,
      })
      : { applicable: false },
  };
  const activation = isOnCell
    ? arms.activationReportBothSeasons({
      projectionsByPositionBySeason: cellInput.activation.projectionsByPositionBySeason,
    })
    : null;
  return arms.evaluateClaim({
    cell: cellMeta.name, components, activation, orderingSensitivity: cellInput.orderingSensitivity,
  });
}

/**
 * Round 3, SUBSTANTIVE 2: component (f)'s evaluability-gate operands, derived
 * per on-cell from the raw matched-off-cell baseline rows the document
 * already carries. Section 6.1a item 2: "`meanAbsBaseline_w` is the mean
 * `|b|` over that week's subgroup rows, `b` being the pre-homeAway baseline
 * captured by `onPreHomeAwayBaseline` (section 6.5) in the MATCHED OFF-CELL,
 * which is where subgroup membership is assigned (prereg 9.8)" - membership
 * is b <= 0, and the qualifying weeks are "the identical week set the
 * endpoint's own D_w series is built from" (item 1), which assembleCellClaim
 * enforces against each endpoint's weekDeltas length.
 *
 * Scoping is deliberately ASYMMETRIC and the two must never share a
 * season-filtered helper: these GATE operands are 2025-only (prereg 9.8:
 * "2024 can never rescue sparse 2025 evidence"); the VETO domain below is
 * not season-filtered (sections 6.3/6.4a assign membership per
 * (season, week, blendWeight, playerId)).
 *
 * Under the frozen definition both endpoints derive the IDENTICAL operands -
 * f1 and f2 are still evaluated independently in arms.js, but a runner-level
 * derivation cannot produce differing weekMeanAbsBaselines for them. The
 * arms unit tests keep that representability; the round-3 response records
 * the consequence.
 */
function deriveComponentFOperands(cellName, { matchedOffBaselineRows, cohortRosterRows }) {
  // Domain identity BY CONSTRUCTION: the operands derive from the same
  // cohort-intersected rows the veto domain uses. The preflight also rejects
  // out-of-cohort baseline rows outright, so this intersection is defense in
  // depth for direct library callers rather than the primary gate - the QA
  // pass on the first derivation showed an unintersected read let extra raw
  // rows widen the gate operands past the veto domain with the preflight
  // green, which is SUBSTANTIVE 2's divergence by another door.
  const cohortKeys = new Set((cohortRosterRows || []).map((row) => `${Number(row.season)}:${Number(row.week)}:${Number(row.playerId)}`));
  // Prereg 4.1's exclusion propagates into 6.3's membership (the A4 ruling,
  // 2026-08-08, sealed at spec revision 35, section 6.3): a bye or non-macro member
  // has no scored endpoint row, so its exactly-zero error pair must not
  // dilute D_w. Eligibility is validated for EVERY cohort row - a malformed
  // position/onBye is an artifact defect, never a silent non-member.
  const eligibleByKey = new Map((cohortRosterRows || []).map((row, index) => [
    `${Number(row.season)}:${Number(row.week)}:${Number(row.playerId)}`,
    sweepPreflight.componentFSubgroupEligible(row, `deriveComponentFOperands: cohort roster[${index}]`),
  ]));
  const subgroup = matchedOffBaselineRows.filter((row) => row.cellName === cellName
    && Number(row.season) === 2025 && Number(row.baseline) <= 0
    && eligibleByKey.get(`${Number(row.season)}:${Number(row.week)}:${Number(row.playerId)}`) === true
    && cohortKeys.has(`${Number(row.season)}:${Number(row.week)}:${Number(row.playerId)}`));
  const byWeek = new Map();
  for (const row of subgroup) {
    const week = Number(row.week);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(Math.abs(Number(row.baseline)));
  }
  const qualifyingWeeks = [...byWeek.keys()].sort((a, b) => a - b);
  const abs = subgroup.map((row) => Math.abs(Number(row.baseline)));
  return {
    subgroupRows: subgroup.length,
    meanAbsBaseline: abs.length > 0 ? abs.reduce((sum, value) => sum + value, 0) / abs.length : null,
    maxAbsBaseline: abs.length > 0 ? Math.max(...abs) : null,
    // Ascending-week emission. Every consumer is order-invariant: the floor
    // disclosure counts, and the falsifiability guard sorts before its median.
    weekMeanAbsBaselines: qualifyingWeeks.map((week) => {
      const values = byWeek.get(week);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }),
    // The week LIST rides with the count so the f1 derivation below maps over
    // the identical set (section 6.1a item 1: "the identical week set the
    // endpoint's own D_w series is built from").
    qualifyingWeeks,
    qualifyingWeekCount: qualifyingWeeks.length,
  };
}

/**
 * Round 5, SUBSTANTIVE F: f1's D_w series, derived from the veto realizations
 * the same document already attests complete. Section 6.3 LITERALLY: the mean
 * over the 24 salts of the per-salt week mean - NOT the flat mean over the
 * week's realizations, which is mathematically identical and NOT bit-identical
 * (last-ulp drift even on constant input), and the JSON report is
 * byte-compared by --verify-against with no rounding in between. Iteration
 * order is pinned twice - salts in metrics.SALTS order, rows ascending by
 * playerId - so the series is reproducible byte-for-byte.
 *
 * 2025 SCOPING is required, not stylistic: the veto domain is deliberately
 * unscoped by season (SPEC-C, RULED both-season by the user 2026-08-08 -
 * the interim reading is now the sealed one, per spec revision 35's
 * 6.1a/6.4/6.4a text), while f1's estimand is "the MEDIAN
 * over 2025 season-weeks" (prereg 9.8) and its qualifying weeks are the
 * 2025-only set deriveComponentFOperands computes. The two derivations stay
 * SEPARATE functions for the same reason their docblocks already state: they
 * must never share a season-filtered helper.
 *
 * Fails closed both ways on the week set (section 6.1a item 1's identity):
 * a 2025 realization week outside the qualifying set, or a qualifying week
 * with no realizations, is a malformed document - stronger than the length
 * check the supplied series used to get.
 */
function deriveComponentFOneSeries(cellName, { realizations, qualifyingWeeks }) {
  const rows2025 = realizations.filter((row) => Number(row.season) === 2025);
  const qualifying = new Set(qualifyingWeeks.map(Number));
  for (const row of rows2025) {
    if (!qualifying.has(Number(row.week))) {
      throw new Error(
        `${cellName} f1: a 2025 realization for week ${row.week} lies outside the derived qualifying `
        + 'week set - section 6.1a item 1 pins the identical week set, so the document is malformed.'
      );
    }
  }
  return qualifyingWeeks.map((week) => {
    const rows = rows2025.filter((row) => Number(row.week) === Number(week));
    if (rows.length === 0) {
      throw new Error(
        `${cellName} f1: qualifying week ${week} has no 2025 realizations - the veto coverage the `
        + 'document attests makes this impossible on a well-formed document.'
      );
    }
    const byPlayer = new Map();
    for (const row of rows) {
      const pid = Number(row.playerId);
      // Own-layer guards, same doctrine as bootstrapMean's strict typeof: the
      // preflight coverage assertion makes both states unreachable through
      // main(), but this function is exported, and without these a NaN pid
      // collapses distinct players onto one Map key (SameValueZero) and a
      // duplicate (playerId, salt) row silently last-write-wins - both
      // mis-averaging instead of failing.
      if (!Number.isFinite(pid)) {
        throw new Error(`${cellName} f1: week ${week} realization has a non-finite playerId (${JSON.stringify(row.playerId)})`);
      }
      if (!byPlayer.has(pid)) byPlayer.set(pid, new Map());
      if (byPlayer.get(pid).has(row.salt)) {
        throw new Error(`${cellName} f1: week ${week} has duplicate realizations for playerId ${pid}, salt ${row.salt}`);
      }
      // Strict typeof for the one field that determines the published number
      // (round-6 QA): without it a null coerced to a MEASURED ZERO (round-4
      // BLOCKER A's shape) and a '0.2' string coerced into a verdict, at
      // this exported layer - the preflight's own strict check covers
      // main()'s path, not a direct caller's.
      if (typeof row.incrementalError !== 'number' || !Number.isFinite(row.incrementalError)) {
        const rendered = typeof row.incrementalError === 'number' ? String(row.incrementalError) : JSON.stringify(row.incrementalError);
        throw new Error(`${cellName} f1: week ${week} playerId ${pid} salt ${row.salt}: incrementalError must be a finite number, got ${rendered}`);
      }
      byPlayer.get(pid).set(row.salt, row.incrementalError);
    }
    // Named-cause guard (round 6, MINOR I; hardened by the same round's QA):
    // without it, a player-week missing one salt flowed a NaN into perSalt
    // and saltPairedDelta reported "salt ... is missing from the candidate
    // or the comparator" - but no salt is ever missing from the constructed
    // object; a PLAYER ROW is. MEMBERSHIP, not cardinality: a
    // size-preserving salt substitution keeps size 24 while both losing a
    // preregistered salt and carrying an unknown one, and a pure addition
    // makes size 25 with nothing missing - each half of the check names its
    // own defect. Iteration over SORTED pids so which player gets named
    // never depends on document row order.
    const players = [...byPlayer.keys()].sort((a, b) => a - b);
    for (const pid of players) {
      const bySalt = byPlayer.get(pid);
      const absent = metrics.SALTS.filter((salt) => !bySalt.has(salt));
      const unknown = [...bySalt.keys()].filter((salt) => !metrics.SALTS.includes(salt));
      if (absent.length > 0 || unknown.length > 0) {
        throw new Error(
          `${cellName} f1: week ${week} playerId ${pid} has realizations for ${bySalt.size} of `
          + `${metrics.SALTS.length} salts`
          + (absent.length > 0 ? ` - missing ${absent.join(', ')}` : '')
          + (unknown.length > 0 ? ` - carrying unknown salt(s) ${unknown.join(', ')} (not among the 24 preregistered)` : '')
          + '. Section 6.4\'s domain is the complete player-week x salt Cartesian product over the '
          + 'preregistered salts, so anything else is a malformed input, not a different average.'
        );
      }
    }
    const perSalt = Object.fromEntries(metrics.SALTS.map((salt) => [salt,
      players.reduce((sum, pid) => sum + byPlayer.get(pid).get(salt), 0) / players.length]));
    // Reuse the sealed helper rather than re-implementing its arithmetic: the
    // realization IS already the same-salt on-minus-off difference, so the
    // comparator is zero and `a - 0 === a` bit-exactly. saltPairedDelta's own
    // pairing check remains beneath this as a second layer; the salt-coverage
    // guard above fires first and names the true cause (round 6, MINOR I).
    return metrics.saltPairedDelta({
      candidateBySalt: perSalt,
      comparatorBySalt: Object.fromEntries(metrics.SALTS.map((salt) => [salt, 0])),
      label: `${cellName} f1 D_w week ${week}`,
    });
  });
}

function componentFVetoRecords(cells, { cohortRosterRows, matchedOffBaselineRows }) {
  return arms.ALL_CELLS
    .filter((cell) => cell.homeAway === 'on')
    .map((cell) => ({
      cellName: cell.name,
      // Membership = b <= 0 AND prereg-4.1 eligibility (the A4 ruling) -
      // the same conjunction every other derivation applies, so the sites
      // cannot disagree about who is in the subgroup. The predicate's throw
      // is swallowed HERE ONLY because this derivation runs EAGERLY, as an
      // argument to `runPreflight`, outside its capture (the adversarial QA
      // on c95d751 demonstrated a malformed roster row crashing the reducer
      // instead of writing the pinned "Level 1 void, immediately" report).
      // This cannot fail open: `assertComponentFVetoCoverage` validates the
      // SAME rows inside the capture and voids the run by name, so a
      // malformed row never reaches any published number - the swallow only
      // preserves WHERE the failure is reported.
      subgroupPlayerWeeks: cohortRosterRows.filter((row, index) => {
        try {
          if (!sweepPreflight.componentFSubgroupEligible(row, `componentFVetoRecords: cohort roster[${index}]`)) return false;
        } catch {
          return false;
        }
        return matchedOffBaselineRows.some((baseline) => baseline.cellName === cell.name
        && Number(baseline.season) === Number(row.season) && Number(baseline.week) === Number(row.week)
        && Number(baseline.playerId) === Number(row.playerId) && Number(baseline.baseline) <= 0);
      }),
      ...cells[cell.name].f.veto,
    }));
}

function preflightFailureDetails(preflight) {
  return [
    preflight.identities.controlUsage25,
    preflight.identities.homeAwayStored,
    preflight.saltSeeds,
    preflight.componentFVeto,
  ].filter((result) => !result.passed).map((result) => result.detail);
}

function unevaluatedCellClaims() {
  return Object.fromEntries(arms.ALL_CELLS.map((cell) => [cell.name, {}]));
}

function crossCheckComponentFEvidence(cellInputs, cellClaims, derivedFOperandsByCell, vetoRecordsByCell, derivedF1SeriesByCell) {
  for (const cellMeta of arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on')) {
    const component = cellClaims[cellMeta.name].components.f;
    const published = component && component.evidence;
    const source = cellInputs[cellMeta.name].f;
    // Round 3, SUBSTANTIVE 2: the comparison target is the DERIVED operands,
    // not the document - the previous form compared the published copy
    // against the raw copy it was copied from, a self-check that could catch
    // only normalization drops, never a falsified operand.
    const derived = derivedFOperandsByCell[cellMeta.name];
    if (!published || !Array.isArray(published.transparency) || published.transparency.length !== 2 || !published.veto) {
      throw new Error(`component (f) evidence: incomplete transparency or veto evidence for ${cellMeta.name}`);
    }
    for (const [index, endpoint] of ['f1', 'f2'].entries()) {
      const transparency = published.transparency[index];
      // f1's length leg is SELF-CONSISTENT BY CONSTRUCTION under derivation
      // (round-5 QA): the derived series maps over qualifyingWeeks, and the
      // published qualifyingWeekCount is that same array's length two calls
      // later - so this leg validates no document evidence and can only fire
      // if a future edit decouples the three sites. It is retained as that
      // decoupling tripwire, not as a cross-check; f2's leg still checks the
      // published count against the SUPPLIED document series.
      const seriesLength = endpoint === 'f1'
        ? derivedF1SeriesByCell[cellMeta.name].length
        : source[endpoint].weekDeltas.length;
      if (transparency.subgroupRows !== derived.subgroupRows || transparency.meanAbsBaseline !== derived.meanAbsBaseline
        || transparency.maxAbsBaseline !== derived.maxAbsBaseline || transparency.qualifyingWeekCount !== seriesLength
        || transparency.qualifyingWeekCount !== derived.qualifyingWeekCount) {
        throw new Error(`component (f) evidence: published ${cellMeta.name}/${endpoint} transparency does not match the derived operands`);
      }
    }
    if (published.veto.realizationCount !== source.veto.realizations.length || published.veto.complete !== true) {
      throw new Error(`component (f) evidence: published ${cellMeta.name} veto completeness does not match raw realizations`);
    }
    // Round 4, SUBSTANTIVE B: section 6.4a's attestation, checked against the
    // veto's OWN derived domain - realizationCount === 24 x |subgroup
    // player-weeks|, with the size itself published so a reader can run the
    // same arithmetic on the report alone.
    const derivedVetoPlayerWeeks = vetoRecordsByCell[cellMeta.name].subgroupPlayerWeeks.length;
    if (published.veto.subgroupPlayerWeekCount !== derivedVetoPlayerWeeks
      || published.veto.realizationCount !== metrics.SALTS.length * derivedVetoPlayerWeeks) {
      throw new Error(`component (f) evidence: published ${cellMeta.name} veto domain size does not reconcile with the derived subgroup (section 6.4a)`);
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * `overrides.expectedRosterCount` is a TEST-ONLY seam, and a named smell: a
 * test-only parameter on a production function. It exists because section 5's
 * conformant control is 50 rosters x 24 salts x 17 weeks x 10,000 replicates =
 * 204,000,000 lineup solves - roughly an hour (see the main() docblock) - so a
 * test suite that lets the runner inject the real denominator cannot also run
 * to completion. The alternatives were worse: a permanently-skipped hour-long
 * test, or dropping end-to-end coverage of the control - the untested-seam
 * pattern three prior findings share.
 *
 * An operator cannot reach it:
 *  - not from the CLI: parseArgs throws on any unknown argument;
 *  - not from the --inputs document: validateInputs closes
 *    inputs.permutationControl's key list, which must never gain
 *    expectedRosterCount;
 *  - not from backtest-entrypoint.js: it shells this script with argv only,
 *    and a function parameter cannot cross a process boundary.
 * Unknown override keys throw, so a typo'd override configures nothing
 * silently. One test runs main() with NO override and asserts the pinned 50
 * is what a 1-roster fixture is rejected against.
 */
function buildReportFromInputs(inputs, { expectedRosterCount = rosters.TEAM_COUNT * rosters.REPLICATES, ...unknown } = {}) {
  const unknownKeys = Object.keys(unknown);
  if (unknownKeys.length > 0) {
    throw new Error(`run-backtest-sweep: unknown override key(s): ${unknownKeys.join(', ')}`);
  }
  validateInputs(inputs);
  // Section 8.6.0 pins the pre-flight order: canaries -> the two identity
  // assertions -> permutation control -> candidate cells - and pins the
  // DISPOSITION: "Level 1 void, immediately". `runPreflight` captures rather
  // than throws; everything downstream of a harness failure is then SKIPPED,
  // for two reasons the round-3 review separated. A malformed control document
  // throws inside canonicalObservations, so running the control after a
  // captured failure could discard the void report the capture existed to
  // produce. And a conformant control is a ~204,000,000-solve, 1-3 hour
  // computation (see the main() docblock) - burning it after the harness is
  // known broken defeats 8.6.0's stated rationale, and publishing its
  // p-values inside a report that declares the harness broken is worse.
  const preflight = sweepPreflight.runPreflight({
    ...inputs.preflight,
    componentFVetoRecords: componentFVetoRecords(inputs.cells, inputs.preflight),
  });
  // Canaries are FIRST in the pinned order and void-forcing on their own.
  const harnessOk = preflight.passed && inputs.canariesPassed === true;
  const permutationControl = harnessOk
    ? metrics.computePermutationControl({
      ...inputs.permutationControl,
      // Unconditional, with NO fallback read of the document. The previous form
      // was `inputs.permutationControl.rosterSlots || DEFAULT_ROSTER_SLOTS`, which
      // contradicted the comment above the closed-key list: the boundary held only
      // because `rosterSlots` is absent from a key array in a DIFFERENT function,
      // so adding it there - the obvious edit for anyone making those lists
      // consistent - would have made the slot model operator-supplied in one line.
      // Now the read does not exist to be enabled.
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      availabilityFor,
      optimize: optimalAssignment,
      // The lineup ORDERING is injected like the optimizer and the slot model
      // - never from the document, and never via policy.js's own destructuring
      // default three modules away. Round 3: a value the runner does not
      // explicitly pin is one key-list edit from operator-supplied, and
      // metrics' key list already names this one.
      ordering: ORDERINGS.PRIMARY,
      // Section 5 pins the denominator; defaulted from the same constants
      // rosters.js asserts when BUILDING an artifact, never from the document.
      expectedRosterCount,
    })
    // NOT-RUN, never fabricated p-values: sweepInference accepts this marker
    // only beside a void-forcing failure and throws on a clean run, so the
    // skip cannot be used to dodge the gate.
    : null;
  const evidence = harnessOk
    ? sweepEvidence.deriveEvidence(inputs.evidence, { permutation: permutationControl })
    : null;
  const derivedFOperandsByCell = harnessOk
    ? Object.fromEntries(arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on')
      .map((cell) => [cell.name, deriveComponentFOperands(cell.name, inputs.preflight)]))
    : null;
  const vetoRecordsByCell = harnessOk
    ? Object.fromEntries(componentFVetoRecords(inputs.cells, inputs.preflight).map((row) => [row.cellName, row]))
    : null;
  // Round 5, SUBSTANTIVE F: f1's D_w series, derived ONCE per on-cell after
  // the preflight has attested the realizations complete (deriving earlier
  // would read realizations the preflight is about to reject), and shared by
  // claim assembly and the evidence cross-check so both read the same array.
  const derivedF1SeriesByCell = harnessOk
    ? Object.fromEntries(arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on')
      .map((cell) => [cell.name, deriveComponentFOneSeries(cell.name, {
        realizations: inputs.cells[cell.name].f.veto.realizations,
        qualifyingWeeks: derivedFOperandsByCell[cell.name].qualifyingWeeks,
      })]))
    : null;
  const cellClaims = harnessOk
    ? Object.fromEntries(arms.ALL_CELLS.map((cellMeta) => [cellMeta.name, assembleCellClaim(cellMeta, inputs.cells[cellMeta.name], vetoRecordsByCell[cellMeta.name] || null, cellMeta.homeAway === 'on' ? derivedFOperandsByCell[cellMeta.name] : null, cellMeta.homeAway === 'on' ? derivedF1SeriesByCell[cellMeta.name] : null)]))
    : unevaluatedCellClaims();
  if (harnessOk) sweepEvidence.crossCheckActivationGate(cellClaims, evidence);
  if (harnessOk) sweepEvidence.crossCheckClaimInputs(inputs.cells, evidence);
  if (harnessOk) crossCheckComponentFEvidence(inputs.cells, cellClaims, derivedFOperandsByCell, vetoRecordsByCell, derivedF1SeriesByCell);
  const sweep = sweepInference.evaluateSweep({
    cellClaims,
    permutationControl: harnessOk
      ? { regretP: permutationControl.regret.p, pairwiseP: permutationControl.pairwise.p }
      : { notRun: true },
    canariesPassed: inputs.canariesPassed,
    identityAssertionsPassed: preflight.identities.passed,
    saltCollisionPassed: preflight.saltSeeds.passed,
    preflightFailures: preflightFailureDetails(preflight),
    orderingDisagreement: inputs.orderingDisagreement,
    deployedPolicyDisagreement: inputs.deployedPolicyDisagreement,
  });
  // Decision D6: the validated audit trail rides to publication.  It is
  // selection-level, candidate-claims-derived evidence, so buildReport
  // publishes it null on a void run (prereg 7.3), mirroring `cells`.
  return sweepReport.buildReport({
    studyId: inputs.studyId,
    sweep: { ...sweep, evidence, sensitivityAudit: inputs.sensitivityAudit },
    cohortExclusions: inputs.cohortExclusions,
  });
}

/**
 * RUNTIME, for whoever first runs this against a real --inputs artifact at
 * Gate 4: the permutation control alone is 50 rosters x 24 salts x 17 weeks x
 * 10,000 replicates = 204,000,000 deployedPolicyLineup solves. Measured at
 * 15.2 us/call on drafting hardware (MEMO-blocker3-permutation-regret.md
 * section 3) and independently re-measured at 21.34 us/call worst-realistic in
 * the round-2 review (~73 minutes), a real run takes roughly ONE TO THREE
 * HOURS single-core before the report is written. It has not hung.
 *
 * `overrides` is forwarded verbatim to buildReportFromInputs - see the seam
 * docblock there. The require.main block below passes argv only, so nothing
 * outside a test can supply it.
 */
async function main(argv, overrides = {}) {
  const args = parseArgs(argv);

  // args.inputs is the operator's own CLI argument to this locally-invoked
  // tool, not external/network input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const inputsPath = path.resolve(String(args.inputs));
  let inputs;
  try {
    inputs = await canonicalJsonIo.readJsonFile(inputsPath);
  } catch (err) {
    throw new Error(`run-backtest-sweep: could not read/parse ${inputsPath}: ${err.message}`);
  }

  const report = buildReportFromInputs(inputs, overrides);
  const canonicalBytes = `${sweepReport.canonicalizeReport(report)}\n`;
  const markdownBytes = sweepReport.renderMarkdown(report);

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const outJsonPath = path.resolve(String(args.outJson));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const outMarkdownPath = path.resolve(String(args.outMarkdown));
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outMarkdownPath), { recursive: true });
  fs.writeFileSync(outJsonPath, canonicalBytes, 'utf8');
  fs.writeFileSync(outMarkdownPath, markdownBytes, 'utf8');
  console.log(`wrote sweep report to ${outJsonPath} and ${outMarkdownPath}`);

  if (args.verifyAgainst) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const verifyPath = path.resolve(String(args.verifyAgainst));
    const committed = fs.readFileSync(verifyPath, 'utf8');
    if (committed !== canonicalBytes) {
      throw new Error(
        `run-backtest-sweep: regenerated report at ${outJsonPath} is NOT byte-identical to ${verifyPath} - `
        + 'the sweep report is not reproducible from these inputs.'
      );
    }
    console.log(`verified: regenerated report is byte-identical to ${verifyPath}`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  TOP_LEVEL_KEYS,
  CELL_INPUT_KEYS,
  PREFLIGHT_KEYS,
  COHORT_EXCLUSION_REASON_KEYS,
  parseArgs,
  validateInputs,
  componentFVetoRecords,
  deriveComponentFOperands,
  deriveComponentFOneSeries,
  preflightFailureDetails,
  boundariesFor,
  assembleCellClaim,
  buildReportFromInputs,
  main,
};
