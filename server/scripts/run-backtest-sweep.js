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
const sweepEvaluator = require('../../scripts/backtest/lib/sweepEvaluator');
const sweepInference = require('../../scripts/backtest/lib/sweepInference');
const sweepReport = require('../../scripts/backtest/lib/sweepReport');

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
  'studyId', 'canariesPassed', 'identityAssertionsPassed', 'permutationControl',
  'orderingDisagreement', 'deployedPolicyDisagreement', 'cells',
]);
const CO_PRIMARY_INPUT_KEYS = Object.freeze(['regretWeekDeltas', 'pairwiseWeekDeltas']);
const E2_INPUT_KEYS = Object.freeze(['endpoints']);
const E2_ENDPOINT_INPUT_KEYS = Object.freeze(['key', 'weekDeltas']);
const F_ENDPOINT_INPUT_KEYS = Object.freeze([
  'weekDeltas', 'subgroupRows', 'meanAbsBaseline', 'maxAbsBaseline', 'weekMeanAbsBaselines', 'incrementalErrors',
]);
const CELL_INPUT_KEYS = Object.freeze(['a', 'b', 'c', 'd', 'e1', 'e2', 'f', 'activation']);

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
  for (const flag of ['canariesPassed', 'identityAssertionsPassed', 'orderingDisagreement', 'deployedPolicyDisagreement']) {
    if (typeof inputs[flag] !== 'boolean') throw new Error(`${label}.${flag}: must be a boolean`);
  }
  if (!inputs.permutationControl || typeof inputs.permutationControl !== 'object') {
    throw new Error(`${label}.permutationControl: must be an object`);
  }
  assertClosedKeys(inputs.permutationControl, ['regretP', 'pairwiseP'], `${label}.permutationControl`);
  for (const key of ['regretP', 'pairwiseP']) {
    if (typeof inputs.permutationControl[key] !== 'number' || !Number.isFinite(inputs.permutationControl[key])) {
      throw new Error(`${label}.permutationControl.${key}: must be a finite number`);
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
    for (const key of COMPONENT_KEYS) {
      if (!cellInput[key] || typeof cellInput[key] !== 'object') throw new Error(`${cellLabel}.${key}: must be an object`);
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

    const isOnCell = cellMeta.homeAway === 'on';
    if (isOnCell) {
      if (!cellInput.f || typeof cellInput.f !== 'object') throw new Error(`${cellLabel}.f: must be an object for an "on" cell`);
      assertClosedKeys(cellInput.f, ['f1', 'f2'], `${cellLabel}.f`);
      for (const endpointKey of ['f1', 'f2']) {
        if (!cellInput.f[endpointKey] || typeof cellInput.f[endpointKey] !== 'object') {
          throw new Error(`${cellLabel}.f.${endpointKey}: must be an object`);
        }
        assertClosedKeys(cellInput.f[endpointKey], F_ENDPOINT_INPUT_KEYS, `${cellLabel}.f.${endpointKey}`);
      }
      if (!cellInput.activation || typeof cellInput.activation !== 'object') {
        throw new Error(`${cellLabel}.activation: must be an object for an "on" cell`);
      }
      assertClosedKeys(cellInput.activation, ['projectionsByPosition'], `${cellLabel}.activation`);
    } else {
      if (cellInput.f !== null) throw new Error(`${cellLabel}.f: must be null for an "off" cell - component (f) has no matched off-twin to compare an off-cell against`);
      if (cellInput.activation !== null) throw new Error(`${cellLabel}.activation: must be null for an "off" cell - there is nothing to check activation of`);
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
 * Component (f) applies ONLY to "on" cells - it compares an on-cell against
 * its OWN matched off-twin (section 6.1-6.4), so an off-cell itself has
 * nothing further to match against. This is the one cross-component
 * applicability rule this script hardcodes rather than reading from
 * `--inputs`, since it follows structurally from (f)'s own definition -
 * unlike components (a)-(e2), whose applicability to a given homeAway state
 * this codebase does not have enough of the sealed preregistration text to
 * decide on its own, and which are therefore always evaluated for every
 * cell here. **This hardcoded rule is exactly the kind of decision the
 * independent implementation review (PHASE5_EXECUTION_SPEC.md section 10)
 * must confirm against the real preregistration text before Gate 0 lifts.**
 */
function assembleCellClaim(cellMeta, cellInput) {
  const isOnCell = cellMeta.homeAway === 'on';
  const components = {
    a: evaluateCoPrimary('a', cellInput.a),
    b: evaluateCoPrimary('b', cellInput.b),
    c: evaluateCoPrimary('c', cellInput.c),
    d: evaluateCoPrimary('d', cellInput.d),
    e1: evaluateCoPrimary('e1', cellInput.e1),
    e2: evaluateE2(cellInput),
    f: isOnCell ? arms.componentF({ f1: cellInput.f.f1, f2: cellInput.f.f2 }) : { applicable: false },
  };
  const activation = isOnCell
    ? arms.activationReport({ projectionsByPosition: cellInput.activation.projectionsByPosition })
    : null;
  return arms.evaluateClaim({ cell: cellMeta.name, components, activation });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function buildReportFromInputs(inputs) {
  validateInputs(inputs);
  const cellClaims = Object.fromEntries(
    arms.ALL_CELLS.map((cellMeta) => [cellMeta.name, assembleCellClaim(cellMeta, inputs.cells[cellMeta.name])])
  );
  const sweep = sweepInference.evaluateSweep({
    cellClaims,
    permutationControl: inputs.permutationControl,
    canariesPassed: inputs.canariesPassed,
    identityAssertionsPassed: inputs.identityAssertionsPassed,
    orderingDisagreement: inputs.orderingDisagreement,
    deployedPolicyDisagreement: inputs.deployedPolicyDisagreement,
  });
  return sweepReport.buildReport({ studyId: inputs.studyId, sweep });
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
  parseArgs,
  validateInputs,
  boundariesFor,
  assembleCellClaim,
  buildReportFromInputs,
  main,
};
