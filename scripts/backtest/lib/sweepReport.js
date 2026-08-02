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
 *
 * SCOPE, STATED PLAINLY (independent implementation review finding): the
 * closed schema below now carries every component's endpoint-level
 * bootstrap evidence (surviving cluster count `n`, the CI, whether the
 * exact trigger fired), component (f)'s full prereg-9.8-required
 * transparency block, per-season/per-position activation rates (prereg
 * 11.2), and the cell-level ordering-sensitivity finding (prereg 5.2/16).
 * It does NOT yet carry three things the sealed preregistration also
 * requires reported: **absolute metrics and their CIs** (this pipeline
 * only ever computes PAIRED CONTRAST deltas, never each arm's own absolute
 * metric - prereg 12.1's "all 8 cells' absolute metrics... reported" has
 * no corresponding computation anywhere in `sweepEvaluator.js` yet);
 * **sensitivities** (`metrics.movingBlockBootstrap` exists but is never
 * invoked by this pipeline - prereg 10.5); and **attribution composites**
 * (the usage/homeAway/interaction decomposition, prereg 12.2 - not
 * computed anywhere). These are real, larger scope items for a future
 * increment, not schema omissions this file can fix on its own - reported
 * here rather than left implicit.
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
const CELL_KEYS = Object.freeze([
  'name', 'blendWeight', 'homeAway', 'isControl', 'verdict', 'components',
  'failures', 'inconclusive', 'vetoedReasons', 'activation', 'orderingSensitivity',
]);
const COMPONENT_KEYS = Object.freeze(['status', 'passes', 'reason', 'evidence']);
const EVIDENCE_KEYS = Object.freeze(['endpoints', 'transparency']);
const ENDPOINT_EVIDENCE_KEYS = Object.freeze(['label', 'status', 'n', 'lower', 'upper', 'triggerFired']);
const TRANSPARENCY_KEYS = Object.freeze([
  'endpoint', 'subgroupRows', 'meanAbsBaseline', 'maxAbsBaseline', 'weeksBelowFalsifiabilityFloor',
  'weeksWithBaseline', 'catastrophicCapCouldFire', 'weekSignIndependenceAssumed',
  'nonTiedWeeks', 'k', 'exactP', 'invertedBound',
]);
// `arms.activationReport`/`activationReportBothSeasons` also carry their own
// `label` (a caller-supplied diagnostic string, e.g. "activation 2025") -
// accepted here but not surfaced in the normalized report, since it names
// the CALL rather than the DATA.
const ACTIVATION_KEYS = Object.freeze(['bySeason', 'threshold', 'inconclusiveSeasons', 'verdict', 'detail', 'label']);
const ACTIVATION_SEASON_KEYS = Object.freeze(['byPosition', 'threshold', 'belowThreshold', 'verdict', 'detail', 'label']);
const ACTIVATION_POSITION_KEYS = Object.freeze(['eligible', 'activated', 'excludedIneligible', 'rate']);
const ORDERING_SENSITIVITY_KEYS = Object.freeze(['contradicted', 'detail']);
const SELECTION_KEYS = Object.freeze(['outcome', 'reasons', 'reason', 'selected', 'ranked']);
const RANKED_CELL_KEYS = Object.freeze(['name', 'blendWeight', 'homeAway']);
const REPORT_KEYS = Object.freeze(['studyId', 'run', 'permutationControl', 'cells', 'selection']);

/** Normalize one bootstrap/exact endpoint's evidence summary to the closed shape. */
function normalizeEndpointEvidence(endpoint, { label }) {
  assertClosedKeys(endpoint, ENDPOINT_EVIDENCE_KEYS, { label });
  return {
    label: typeof endpoint.label === 'string' ? endpoint.label : null,
    status: typeof endpoint.status === 'string' ? endpoint.status : null,
    n: typeof endpoint.n === 'number' ? endpoint.n : null,
    lower: typeof endpoint.lower === 'number' ? endpoint.lower : null,
    upper: typeof endpoint.upper === 'number' ? endpoint.upper : null,
    triggerFired: !!endpoint.triggerFired,
  };
}

/** Normalize component (f)'s prereg-9.8-required transparency block to the closed shape. */
function normalizeTransparency(t, { label }) {
  assertClosedKeys(t, TRANSPARENCY_KEYS, { label });
  const num = (v) => (typeof v === 'number' ? v : null);
  return {
    endpoint: typeof t.endpoint === 'string' ? t.endpoint : null,
    subgroupRows: num(t.subgroupRows),
    meanAbsBaseline: num(t.meanAbsBaseline),
    maxAbsBaseline: num(t.maxAbsBaseline),
    weeksBelowFalsifiabilityFloor: num(t.weeksBelowFalsifiabilityFloor),
    weeksWithBaseline: num(t.weeksWithBaseline),
    catastrophicCapCouldFire: typeof t.catastrophicCapCouldFire === 'boolean' ? t.catastrophicCapCouldFire : null,
    weekSignIndependenceAssumed: typeof t.weekSignIndependenceAssumed === 'boolean'
      ? t.weekSignIndependenceAssumed : null,
    nonTiedWeeks: num(t.nonTiedWeeks),
    k: num(t.k),
    exactP: num(t.exactP),
    invertedBound: num(t.invertedBound),
  };
}

function normalizeEvidence(evidence, { label }) {
  if (!evidence) return null;
  assertClosedKeys(evidence, EVIDENCE_KEYS, { label });
  return {
    endpoints: Array.isArray(evidence.endpoints)
      ? evidence.endpoints.map((e, i) => normalizeEndpointEvidence(e, { label: `${label}.endpoints[${i}]` }))
      : null,
    transparency: Array.isArray(evidence.transparency)
      ? evidence.transparency.map((t, i) => normalizeTransparency(t, { label: `${label}.transparency[${i}]` }))
      : null,
  };
}

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
    evidence: normalizeEvidence(component.evidence, { label: `${label}.evidence` }),
  };
}

/** Normalize one position's activation counts (prereg 11.2) to the closed shape. */
function normalizeActivationPosition(p, { label }) {
  assertClosedKeys(p, ACTIVATION_POSITION_KEYS, { label });
  return {
    eligible: typeof p.eligible === 'number' ? p.eligible : null,
    activated: typeof p.activated === 'number' ? p.activated : null,
    excludedIneligible: typeof p.excludedIneligible === 'number' ? p.excludedIneligible : null,
    rate: typeof p.rate === 'number' ? p.rate : null,
  };
}

/** Normalize one season's full activation report to the closed shape. */
function normalizeActivationSeason(season, { label }) {
  assertClosedKeys(season, ACTIVATION_SEASON_KEYS, { label });
  const byPosition = {};
  for (const [position, p] of Object.entries(season.byPosition || {})) {
    byPosition[position] = normalizeActivationPosition(p, { label: `${label}.byPosition.${position}` });
  }
  return {
    byPosition,
    threshold: typeof season.threshold === 'number' ? season.threshold : null,
    belowThreshold: Array.isArray(season.belowThreshold) ? [...season.belowThreshold] : [],
    verdict: season.verdict,
    detail: typeof season.detail === 'string' ? season.detail : null,
  };
}

/**
 * Normalize the full per-season activation report (prereg 11.2: "Activation
 * rates are published per season and position regardless of outcome") -
 * `null` for an off-cell, which has no activation to check at all.
 */
function normalizeActivation(activation, { label }) {
  if (!activation) return null;
  assertClosedKeys(activation, ACTIVATION_KEYS, { label });
  const bySeason = {};
  for (const [season, report] of Object.entries(activation.bySeason || {})) {
    bySeason[season] = normalizeActivationSeason(report, { label: `${label}.bySeason.${season}` });
  }
  return {
    bySeason,
    threshold: typeof activation.threshold === 'number' ? activation.threshold : null,
    inconclusiveSeasons: Array.isArray(activation.inconclusiveSeasons) ? [...activation.inconclusiveSeasons] : [],
    verdict: activation.verdict,
    detail: typeof activation.detail === 'string' ? activation.detail : null,
  };
}

/** Normalize the cell-level ordering-sensitivity finding (prereg 5.2/16) - `null` for the control. */
function normalizeOrderingSensitivity(sensitivity, { label }) {
  if (!sensitivity) return null;
  assertClosedKeys(sensitivity, ORDERING_SENSITIVITY_KEYS, { label });
  return {
    contradicted: !!sensitivity.contradicted,
    detail: typeof sensitivity.detail === 'string' ? sensitivity.detail : null,
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
    activation: normalizeActivation(claim.activation, { label: `${label}.activation` }),
    orderingSensitivity: normalizeOrderingSensitivity(claim.orderingSensitivity, { label: `${label}.orderingSensitivity` }),
  };
  assertClosedKeys(normalized, CELL_KEYS, { label });
  // The control never receives a candidate IUT verdict (independent
  // implementation review ruling, row 26): 'baseline' is a distinct fifth
  // value, valid ONLY for the control cell - a non-control cell reporting
  // 'baseline' would be silently opting out of the IUT it is required to
  // pass, and the control reporting a real IUT verdict would be measuring
  // it against itself, which is not a finding.
  const allowedVerdicts = normalized.isControl
    ? ['baseline']
    : ['pass', 'fail', 'inconclusive', 'vetoed'];
  if (!allowedVerdicts.includes(normalized.verdict)) {
    throw new Error(
      `${label}: verdict '${normalized.verdict}' is not valid for ${cellMeta.name} - `
      + `expected one of ${allowedVerdicts.join(', ')} (${normalized.isControl ? 'the control cell' : 'a candidate cell'})`
    );
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

/** One evidence endpoint (n, CI) rendered inline, e.g. "regret n=17 [-0.412, -0.201]". */
function renderEndpointEvidence(endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) return '';
  return endpoints.map((e) => {
    const ci = e.lower !== null && e.upper !== null ? `[${e.lower}, ${e.upper}]` : '';
    const n = e.n !== null ? `n=${e.n}` : '';
    return `${escapeMd(e.label || '?')} ${n} ${ci}`.trim();
  }).join('; ');
}

function renderComponentsTable(components) {
  const keys = Object.keys(components).sort();
  if (keys.length === 0) return '_(no components reported)_';
  const rows = keys.map((key) => {
    const c = components[key];
    const evidence = c.evidence
      ? escapeMd(renderEndpointEvidence(c.evidence.endpoints))
      : '';
    return `| ${escapeMd(key)} | ${escapeMd(c.status)} | ${c.passes} | ${escapeMd(c.reason ?? '')} | ${evidence} |`;
  });
  const lines = [
    '| component | status | passes | reason | evidence |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ];
  // Component (f)'s prereg-9.8-required transparency block, one line per endpoint.
  const fTransparency = components.f && components.f.evidence && components.f.evidence.transparency;
  if (Array.isArray(fTransparency) && fTransparency.length > 0) {
    lines.push('', '**Component (f) transparency:**', '');
    for (const t of fTransparency) {
      lines.push(
        `- ${escapeMd(t.endpoint || 'f')}: subgroupRows=${t.subgroupRows}, meanAbsBaseline=${t.meanAbsBaseline}, `
        + `maxAbsBaseline=${t.maxAbsBaseline}, weeksBelowFalsifiabilityFloor=${t.weeksBelowFalsifiabilityFloor}, `
        + `catastrophicCapCouldFire=${t.catastrophicCapCouldFire}`
      );
    }
  }
  return lines.join('\n');
}

/** Per-season, per-position activation rates (prereg 11.2: published regardless of outcome). */
function renderActivation(activation) {
  if (!activation) return '';
  const lines = ['', '**Activation:**', ''];
  for (const season of Object.keys(activation.bySeason).sort()) {
    const seasonReport = activation.bySeason[season];
    const positions = Object.keys(seasonReport.byPosition).sort()
      .map((p) => `${p}=${seasonReport.byPosition[p].rate}`).join(', ');
    lines.push(`- ${season}: **${seasonReport.verdict}** (${positions})`);
  }
  return lines.join('\n');
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
      const activationBlock = renderActivation(cell.activation);
      if (activationBlock) lines.push(activationBlock);
      if (cell.orderingSensitivity && cell.orderingSensitivity.contradicted) {
        lines.push('', `**Ordering sensitivity: CONTRADICTED** - ${escapeMd(cell.orderingSensitivity.detail || '')}`);
      }
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
