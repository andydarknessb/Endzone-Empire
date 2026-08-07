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
 * `weekDeltas` series per co-primary/e2 endpoint, per cell, already averaged
 * over the 24 salts (`saltPairedDelta`) - and reduces it through the pure
 * evaluator/inference/report pipeline to a report. It does NOT call
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
  'orderingDisagreement', 'deployedPolicyDisagreement', 'cells', 'evidence',
]);
const PREFLIGHT_KEYS = Object.freeze([
  'cohortRosterRows', 'controlUsage25Records', 'homeAwayStoredRecords', 'saltSeedRecords', 'matchedOffBaselineRows',
]);
const CO_PRIMARY_INPUT_KEYS = Object.freeze(['regretWeekDeltas', 'pairwiseWeekDeltas']);
const E2_INPUT_KEYS = Object.freeze(['endpoints']);
const E2_ENDPOINT_INPUT_KEYS = Object.freeze(['key', 'weekDeltas']);
// Round 3, SUBSTANTIVE 2: the four evaluability-gate operands (subgroupRows,
// meanAbsBaseline, maxAbsBaseline, weekMeanAbsBaselines) are DERIVED from
// preflight.matchedOffBaselineRows - section 6.1a item 2's definition run as
// code - and may no longer be supplied. They were previously read verbatim
// and "cross-checked" against the copies they were read from, while the same
// document's raw rows contradicted them. Only the weekDeltas series stays
// supplied: its per-week deltas need per-salt errors the document does not
// carry row-wise.
const F_ENDPOINT_INPUT_KEYS = Object.freeze(['weekDeltas']);
const F_VETO_INPUT_KEYS = Object.freeze(['realizations']);
const F_VETO_REALIZATION_KEYS = Object.freeze(['season', 'week', 'playerId', 'salt', 'incrementalError']);
const CELL_INPUT_KEYS = Object.freeze(['a', 'b', 'c', 'd', 'e1', 'e2', 'f', 'activation', 'orderingSensitivity']);
const ORDERING_SENSITIVITY_KEYS = Object.freeze(['contradicted', 'detail']);

function assertClosedKeys(obj, allowed, label) {
  const extra = Object.keys(obj || {}).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new Error(`${label}: unexpected key(s): ${extra.join(', ')}`);
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
        if (!cellInput[key][seriesKey] || typeof cellInput[key][seriesKey] !== 'object') {
          throw new Error(`${cellLabel}.${key}.${seriesKey}: must be a { [week]: number } object`);
        }
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
      if (!endpoint.weekDeltas || typeof endpoint.weekDeltas !== 'object') {
        throw new Error(`${endpointLabel}.weekDeltas: must be a { [week]: number } object`);
      }
    }

    if (isOnCell) {
      if (!cellInput.f || typeof cellInput.f !== 'object') throw new Error(`${cellLabel}.f: must be an object for an "on" cell`);
      assertClosedKeys(cellInput.f, ['f1', 'f2', 'veto'], `${cellLabel}.f`);
      for (const endpointKey of ['f1', 'f2']) {
        if (!cellInput.f[endpointKey] || typeof cellInput.f[endpointKey] !== 'object') {
          throw new Error(`${cellLabel}.f.${endpointKey}: must be an object`);
        }
        assertClosedKeys(cellInput.f[endpointKey], F_ENDPOINT_INPUT_KEYS, `${cellLabel}.f.${endpointKey}`);
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

function assembleCellClaim(cellMeta, cellInput, derivedFVeto = null, derivedFOperands = null) {
  if (cellMeta.name === arms.CONTROL_CELL) {
    return controlBaselineClaim(cellMeta);
  }
  const isOnCell = cellMeta.homeAway === 'on';
  const usageDiffersFromControl = cellMeta.blendWeight !== arms.CONTROL_BLEND_WEIGHT;
  if (isOnCell) {
    if (!derivedFOperands) {
      throw new Error(`${cellMeta.name}: an on-cell claim requires the derived component (f) operands (round 3, SUBSTANTIVE 2)`);
    }
    // Section 6.1a item 1: the qualifying weeks are "the identical week set
    // the endpoint's own D_w series is built from". The count is now DERIVED
    // from the raw rows, so a document whose weekDeltas disagree with it is
    // MALFORMED (throw-class), never sparse evidence - and this is a
    // guarantee the supplied-operand contract could not express, because
    // clusters used to be the supplied array's own length.
    for (const endpointKey of ['f1', 'f2']) {
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
        // The document supplies only the D_w series; every gate operand is
        // the derived value (round 3, SUBSTANTIVE 2).
        f1: { weekDeltas: cellInput.f.f1.weekDeltas, ...componentFOperandFields(derivedFOperands) },
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
function deriveComponentFOperands(cellName, { matchedOffBaselineRows }) {
  const subgroup = matchedOffBaselineRows.filter((row) => row.cellName === cellName
    && Number(row.season) === 2025 && Number(row.baseline) <= 0);
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
    qualifyingWeekCount: qualifyingWeeks.length,
  };
}

function componentFVetoRecords(cells, { cohortRosterRows, matchedOffBaselineRows }) {
  return arms.ALL_CELLS
    .filter((cell) => cell.homeAway === 'on')
    .map((cell) => ({
      cellName: cell.name,
      subgroupPlayerWeeks: cohortRosterRows.filter((row) => matchedOffBaselineRows.some((baseline) => baseline.cellName === cell.name
        && Number(baseline.season) === Number(row.season) && Number(baseline.week) === Number(row.week)
        && Number(baseline.playerId) === Number(row.playerId) && Number(baseline.baseline) <= 0)),
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

function crossCheckComponentFEvidence(cellInputs, cellClaims, derivedFOperandsByCell) {
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
      const raw = source[endpoint];
      if (transparency.subgroupRows !== derived.subgroupRows || transparency.meanAbsBaseline !== derived.meanAbsBaseline
        || transparency.maxAbsBaseline !== derived.maxAbsBaseline || transparency.qualifyingWeekCount !== raw.weekDeltas.length
        || transparency.qualifyingWeekCount !== derived.qualifyingWeekCount) {
        throw new Error(`component (f) evidence: published ${cellMeta.name}/${endpoint} transparency does not match the derived operands`);
      }
    }
    if (published.veto.realizationCount !== source.veto.realizations.length || published.veto.complete !== true) {
      throw new Error(`component (f) evidence: published ${cellMeta.name} veto completeness does not match raw realizations`);
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
  const cellClaims = harnessOk
    ? Object.fromEntries(arms.ALL_CELLS.map((cellMeta) => [cellMeta.name, assembleCellClaim(cellMeta, inputs.cells[cellMeta.name], componentFVetoRecords(inputs.cells, inputs.preflight).find((row) => row.cellName === cellMeta.name) || null, cellMeta.homeAway === 'on' ? derivedFOperandsByCell[cellMeta.name] : null)]))
    : unevaluatedCellClaims();
  if (harnessOk) sweepEvidence.crossCheckActivationGate(cellClaims, evidence);
  if (harnessOk) sweepEvidence.crossCheckClaimInputs(inputs.cells, evidence);
  if (harnessOk) crossCheckComponentFEvidence(inputs.cells, cellClaims, derivedFOperandsByCell);
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
  return sweepReport.buildReport({ studyId: inputs.studyId, sweep: { ...sweep, evidence } });
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
function main(argv, overrides = {}) {
  const args = parseArgs(argv);

  // args.inputs is the operator's own CLI argument to this locally-invoked
  // tool, not external/network input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const inputsPath = path.resolve(String(args.inputs));
  let inputs;
  try {
    inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
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
  try {
    process.exit(main(process.argv.slice(2)) || 0);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  TOP_LEVEL_KEYS,
  CELL_INPUT_KEYS,
  PREFLIGHT_KEYS,
  parseArgs,
  validateInputs,
  componentFVetoRecords,
  preflightFailureDetails,
  boundariesFor,
  assembleCellClaim,
  buildReportFromInputs,
  main,
};
