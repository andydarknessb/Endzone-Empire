'use strict';

/**
 * Gate 2: the report layer. Assembles ONE authoritative sweep report from a
 * `sweepInference.evaluateSweep()` result, as a CLOSED schema - an exact,
 * enumerated set of fields, no more and no fewer, at every level - plus
 * canonical (byte-stable) serialization and deterministic Markdown
 * rendering.
 *
 * Pure: no clock, no I/O, no random ordering, no dependence on any object's
 * insertion order - cell ordering is always `arms.ALL_CELLS`'s fixed order,
 * never the order a caller happened to build a `cellClaims` object in.
 *
 * `sweepInference.evaluateSweep`'s own return value is the COMPLETE computed
 * result (kept whole, for internal debugging, even when the run is void).
 * `buildReport` here is the PUBLICATION layer, and enforces prereg 7.3's
 * publication rule separately: a void run publishes no cell-level results at
 * all - `cells` is present in the schema (so the schema's own key set never
 * changes shape) but its value is `null`.
 *
 * Two invariants are enforced BEFORE a report can be built:
 *   1. **no non-finite number anywhere in the input** - `NaN`/`Infinity`/
 *      `-Infinity`, walked and reported by exact path, so a bad value is
 *      caught at its source rather than surfacing as an opaque throw deep
 *      inside `canonicalJson` or the Markdown renderer;
 *   2. **no UNSTATED unevaluable state** - every component whose status is
 *      `'unevaluable'`, `'wide-straddle'`, or `'vetoed'` (`arms.js`'s own
 *      Level 3 vocabulary) MUST carry a non-empty string `reason`. A silent
 *      unevaluable is exactly the failure mode this whole exercise exists to
 *      prevent (prereg 9.1: "there is no 'assume pass'"); an unevaluable with
 *      no stated reason is the reporting-layer version of the same failure -
 *      a verdict nobody can audit.
 */

const arms = require('./arms');
const { canonicalJson } = require('./snapshotStore');

const REQUIRED_STATES_WITH_REASON = Object.freeze(['unevaluable', 'wide-straddle', 'vetoed']);

// ---------------------------------------------------------------------------
// The two pre-build invariants
// ---------------------------------------------------------------------------

/** Walk a value depth-first, calling `visit(value, path)` on every node, including the root. */
function walk(value, path, visit) {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) walk(value[key], path ? `${path}.${key}` : key, visit);
  }
}

/** Refuse NaN/Infinity/-Infinity anywhere in `value`, naming the exact path. */
function assertFinite(value, { label = 'report' } = {}) {
  walk(value, '(root)', (v, path) => {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new Error(`${label}: ${path} is ${String(v)}, not a finite number`);
    }
  });
  return true;
}

/**
 * Refuse an `unevaluable`/`wide-straddle`/`vetoed` component (searched
 * inside every cell's `components` object) whose `reason` is missing, not a
 * string, or blank.
 */
function assertNoUnstatedUnevaluable(cellClaims, { label = 'report' } = {}) {
  for (const [cellName, cell] of Object.entries(cellClaims || {})) {
    for (const [componentKey, component] of Object.entries((cell && cell.components) || {})) {
      if (!REQUIRED_STATES_WITH_REASON.includes(component.status)) continue;
      if (typeof component.reason !== 'string' || component.reason.trim().length === 0) {
        throw new Error(
          `${label}: ${cellName}.${componentKey} is '${component.status}' with no stated reason - an ` +
          'unevaluable, wide-straddle, or vetoed component must always be auditable, never silent.'
        );
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The closed schema
// ---------------------------------------------------------------------------

/** Refuse any key outside `allowed`, at exactly this one level (not recursive). */
function assertClosedKeys(obj, allowed, { label = 'object' } = {}) {
  const extra = Object.keys(obj || {}).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new Error(`${label}: unexpected key(s) outside the closed schema: ${extra.join(', ')}`);
  }
  return true;
}

const RUN_KEYS = Object.freeze(['status', 'reasons', 'detail']);
const PERMUTATION_KEYS = Object.freeze(['void', 'reason', 'detail', 'failures']);
const CELL_KEYS = Object.freeze(['name', 'blendWeight', 'homeAway', 'isControl', 'verdict', 'components', 'failures', 'inconclusive', 'vetoedReasons']);
const COMPONENT_KEYS = Object.freeze(['status', 'passes', 'reason']);
const SELECTION_KEYS = Object.freeze(['outcome', 'reasons', 'reason', 'selected', 'ranked']);
const RANKED_CELL_KEYS = Object.freeze(['name', 'blendWeight', 'homeAway']);
const REPORT_KEYS = Object.freeze(['studyId', 'run', 'permutationControl', 'cells', 'selection']);

/** Normalize one component to the closed shape - `reason` is always present, `null` when unused. */
function normalizeComponent(component, { label }) {
  assertClosedKeys(component, COMPONENT_KEYS, { label });
  if (typeof component.status !== 'string' || component.status.length === 0) {
    throw new Error(`${label}: status must be a non-empty string`);
  }
  if (typeof component.passes !== 'boolean') {
    throw new Error(`${label}: passes must be a boolean`);
  }
  return {
    status: component.status,
    passes: component.passes,
    reason: typeof component.reason === 'string' ? component.reason : null,
  };
}

/** Normalize one cell (from `arms.ALL_CELLS` metadata + its `evaluateClaim` result) to the closed shape. */
function normalizeCell(cellMeta, claim, { label }) {
  if (!claim || typeof claim !== 'object') {
    throw new Error(`${label}: no evaluateClaim() result for cell ${cellMeta.name}`);
  }
  const components = {};
  for (const [key, component] of Object.entries(claim.components || {})) {
    components[key] = normalizeComponent(component, { label: `${label}.components.${key}` });
  }
  const normalized = {
    name: cellMeta.name,
    blendWeight: cellMeta.blendWeight,
    homeAway: cellMeta.homeAway,
    isControl: cellMeta.name === arms.CONTROL_CELL,
    verdict: claim.verdict,
    components,
    failures: Array.isArray(claim.failures) ? [...claim.failures] : [],
    inconclusive: Array.isArray(claim.inconclusive) ? [...claim.inconclusive] : [],
    vetoedReasons: Array.isArray(claim.vetoedReasons) ? [...claim.vetoedReasons] : [],
  };
  assertClosedKeys(normalized, CELL_KEYS, { label });
  if (!['pass', 'fail', 'inconclusive', 'vetoed'].includes(normalized.verdict)) {
    throw new Error(`${label}: unrecognized verdict '${normalized.verdict}' for cell ${cellMeta.name}`);
  }
  return normalized;
}

/** Reduce a `selectByParsimony`/`arms.ALL_CELLS`-shaped cell down to its report identity only. */
function normalizeRankedCell(cell, { label }) {
  const reduced = { name: cell.name, blendWeight: cell.blendWeight, homeAway: cell.homeAway };
  assertClosedKeys(reduced, RANKED_CELL_KEYS, { label });
  return reduced;
}

function normalizeSelection(selection, { label = 'report.selection' } = {}) {
  if (!selection || typeof selection !== 'object') {
    throw new Error(`${label}: missing`);
  }
  if (!['no-selection', 'no-proposal', 'selected'].includes(selection.outcome)) {
    throw new Error(`${label}: unrecognized outcome '${selection.outcome}'`);
  }
  return {
    outcome: selection.outcome,
    reasons: Array.isArray(selection.reasons) ? [...selection.reasons] : null,
    reason: typeof selection.reason === 'string' ? selection.reason : null,
    selected: selection.selected ? normalizeRankedCell(selection.selected, { label: `${label}.selected` }) : null,
    ranked: Array.isArray(selection.ranked)
      ? selection.ranked.map((c, i) => normalizeRankedCell(c, { label: `${label}.ranked[${i}]` }))
      : null,
  };
}

/**
 * Build the closed-schema report. `sweep` is exactly what
 * `sweepInference.evaluateSweep()` returns. `studyId` is the preregistered
 * study identifier (`pit-sweep-2024-2025`), threaded through rather than
 * hardcoded so a future study reusing this module does not have to fork it.
 */
function buildReport({ studyId, sweep, label = 'sweepReport' }) {
  if (typeof studyId !== 'string' || studyId.length === 0) {
    throw new Error(`${label}: studyId must be a non-empty string`);
  }
  if (!sweep || typeof sweep !== 'object') {
    throw new Error(`${label}: sweep must be an evaluateSweep() result`);
  }
  const { run, permutationControl, cells: cellClaims, selection } = sweep;

  assertClosedKeys(run || {}, RUN_KEYS, { label: `${label}.run` });
  if (!['valid', 'void'].includes(run && run.status)) {
    throw new Error(`${label}.run: status must be 'valid' or 'void'`);
  }
  assertClosedKeys(permutationControl || {}, PERMUTATION_KEYS, { label: `${label}.permutationControl` });

  // prereg 7.3: a void run publishes NO cell-level results. The schema's own
  // key set stays constant (`cells` is always present); only its VALUE
  // changes - `null` when void.
  let cells = null;
  if (run.status === 'valid') {
    assertNoUnstatedUnevaluable(cellClaims, { label });
    cells = arms.ALL_CELLS.map(
      (cellMeta) => normalizeCell(cellMeta, cellClaims[cellMeta.name], { label: `${label}.cells.${cellMeta.name}` })
    );
  }

  const report = {
    studyId,
    run: {
      status: run.status,
      reasons: Array.isArray(run.reasons) ? [...run.reasons] : [],
      detail: typeof run.detail === 'string' ? run.detail : null,
    },
    permutationControl: {
      void: !!permutationControl.void,
      reason: permutationControl.reason ?? null,
      detail: permutationControl.detail ?? null,
      failures: Array.isArray(permutationControl.failures) ? [...permutationControl.failures] : [],
    },
    cells,
    selection: normalizeSelection(selection, { label: `${label}.selection` }),
  };
  assertClosedKeys(report, REPORT_KEYS, { label });
  assertFinite(report, { label });
  return report;
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Canonical (byte-stable) JSON text for an already-built report. Reuses
 * `snapshotStore.canonicalJson` (sorted keys, refuses `undefined` and
 * non-finite numbers) rather than re-implementing serialization - the same
 * function the freeze manifest and the two sealed identity assertions rely
 * on, so "canonical" means the same thing everywhere in this pipeline.
 */
function canonicalizeReport(report) {
  return canonicalJson(report);
}

// ---------------------------------------------------------------------------
// Deterministic Markdown rendering
// ---------------------------------------------------------------------------

function escapeMd(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderComponentsTable(components) {
  const keys = Object.keys(components).sort();
  if (keys.length === 0) return '_(no components reported)_';
  const rows = keys.map((key) => {
    const c = components[key];
    return `| ${escapeMd(key)} | ${escapeMd(c.status)} | ${c.passes} | ${escapeMd(c.reason ?? '')} |`;
  });
  return [
    '| component | status | passes | reason |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/**
 * Render a closed-schema report to deterministic Markdown: fixed section
 * order, cells in `arms.ALL_CELLS`'s fixed order (never object insertion
 * order), components sorted lexicographically by key. No timestamps, no
 * environment-dependent text - the same report object always renders to the
 * identical string.
 */
function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Sweep report: ${report.studyId}`);
  lines.push('');
  lines.push('## Run');
  lines.push('');
  lines.push(`Status: **${report.run.status}**`);
  if (report.run.detail) lines.push('', escapeMd(report.run.detail));
  if (report.run.reasons.length > 0) {
    lines.push('');
    for (const reason of report.run.reasons) lines.push(`- ${escapeMd(reason)}`);
  }
  lines.push('');
  lines.push('## Permutation control');
  lines.push('');
  lines.push(`Void: **${report.permutationControl.void}**`);
  if (report.permutationControl.detail) lines.push('', escapeMd(report.permutationControl.detail));
  lines.push('');
  lines.push('## Cells');
  lines.push('');
  if (report.cells === null) {
    lines.push('_No cell-level results are published: the run is void (prereg 7.3)._');
  } else {
    for (const cell of report.cells) {
      lines.push(`### ${cell.name}${cell.isControl ? ' (control)' : ''}`);
      lines.push('');
      lines.push(`Verdict: **${cell.verdict}**`);
      lines.push('');
      lines.push(renderComponentsTable(cell.components));
      lines.push('');
    }
  }
  lines.push('## Selection');
  lines.push('');
  lines.push(`Outcome: **${report.selection.outcome}**`);
  if (report.selection.reasons && report.selection.reasons.length > 0) {
    lines.push('');
    for (const reason of report.selection.reasons) lines.push(`- ${escapeMd(reason)}`);
  }
  if (report.selection.selected) {
    lines.push('', `Selected: **${report.selection.selected.name}**`);
  }
  if (report.selection.reason) {
    lines.push('', escapeMd(report.selection.reason));
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  REQUIRED_STATES_WITH_REASON,
  REPORT_KEYS,
  RUN_KEYS,
  PERMUTATION_KEYS,
  CELL_KEYS,
  COMPONENT_KEYS,
  SELECTION_KEYS,
  RANKED_CELL_KEYS,
  assertFinite,
  assertNoUnstatedUnevaluable,
  assertClosedKeys,
  buildReport,
  canonicalizeReport,
  renderMarkdown,
};
