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
const F_ENDPOINT_INPUT_KEYS = Object.freeze([
  'weekDeltas', 'subgroupRows', 'meanAbsBaseline', 'maxAbsBaseline', 'weekMeanAbsBaselines',
]);
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
  assertClosedKeys(inputs.permutationControl, ['regret', 'pairwise'], `${label}.permutationControl`);
  for (const key of ['regret', 'pairwise']) {
    const endpoint = inputs.permutationControl[key];
    if (!endpoint || typeof endpoint !== 'object' || !Number.isFinite(endpoint.observed) || !Array.isArray(endpoint.permuted)) {
      throw new Error(`${label}.permutationControl.${key}: requires finite observed and raw permuted statistics`);
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

function assembleCellClaim(cellMeta, cellInput, derivedFVeto = null) {
  if (cellMeta.name === arms.CONTROL_CELL) {
    return controlBaselineClaim(cellMeta);
  }
  const isOnCell = cellMeta.homeAway === 'on';
  const usageDiffersFromControl = cellMeta.blendWeight !== arms.CONTROL_BLEND_WEIGHT;
  const components = {
    a: evaluateCoPrimary('a', cellInput.a),
    b: isOnCell ? evaluateCoPrimary('b', cellInput.b) : { applicable: false },
    c: usageDiffersFromControl ? evaluateCoPrimary('c', cellInput.c) : { applicable: false },
    d: evaluateCoPrimary('d', cellInput.d),
    e1: evaluateCoPrimary('e1', cellInput.e1),
    e2: evaluateE2(cellInput),
    f: isOnCell ? arms.componentF({ f1: cellInput.f.f1, f2: cellInput.f.f2, veto: derivedFVeto }) : { applicable: false },
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

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function buildReportFromInputs(inputs) {
  validateInputs(inputs);
  const evidence = sweepEvidence.validateEvidence(inputs.evidence);
  const permutationControl = metrics.computePermutationControl(inputs.permutationControl);
  if (evidence.diagnostics.permutation.regretPValue !== permutationControl.regret.p
    || evidence.diagnostics.permutation.pairwisePValue !== permutationControl.pairwise.p
    || evidence.diagnostics.permutation.regretStatistic !== permutationControl.regret.observed
    || evidence.diagnostics.permutation.pairwiseStatistic !== permutationControl.pairwise.observed) {
    throw new Error('evidence.diagnostics.permutation: published statistics/p-values must match internally computed permutation control');
  }
  const preflight = sweepPreflight.runPreflight({
    ...inputs.preflight,
    componentFVetoRecords: componentFVetoRecords(inputs.cells, inputs.preflight),
  });
  const cellClaims = preflight.passed
    ? Object.fromEntries(arms.ALL_CELLS.map((cellMeta) => [cellMeta.name, assembleCellClaim(cellMeta, inputs.cells[cellMeta.name], componentFVetoRecords(inputs.cells, inputs.preflight).find((row) => row.cellName === cellMeta.name) || null)]))
    : unevaluatedCellClaims();
  const sweep = sweepInference.evaluateSweep({
    cellClaims,
    permutationControl: { regretP: permutationControl.regret.p, pairwiseP: permutationControl.pairwise.p },
    canariesPassed: inputs.canariesPassed,
    identityAssertionsPassed: preflight.identities.passed,
    saltCollisionPassed: preflight.saltSeeds.passed,
    preflightFailures: preflightFailureDetails(preflight),
    orderingDisagreement: inputs.orderingDisagreement,
    deployedPolicyDisagreement: inputs.deployedPolicyDisagreement,
  });
  return sweepReport.buildReport({ studyId: inputs.studyId, sweep: { ...sweep, evidence } });
}

function main(argv) {
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

  const report = buildReportFromInputs(inputs);
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
