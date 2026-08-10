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
 * The validated descriptive-evidence object carries the complete eight-cell
 * absolute/paired matrix, moving-block results, attribution composites,
 * control diagnostics, permutation metadata, and weekly/season activation
 * views. Those values are descriptive and never become candidate verdicts.
 */

const arms = require('./arms');
const metrics = require('./metrics');
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

/** Require every key in a closed schema when omission would change a gate result. */
function assertRequiredKeys(obj, required, { label = 'object' } = {}) {
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(obj || {}, key));
  if (missing.length > 0) throw new Error(`${label}: missing required key(s) from the closed schema: ${missing.join(', ')}`);
  return true;
}

const RUN_KEYS = Object.freeze(['status', 'reasons', 'detail']);
const PERMUTATION_KEYS = Object.freeze(['void', 'reason', 'detail', 'failures']);
const CELL_KEYS = Object.freeze([
  'name', 'blendWeight', 'homeAway', 'isControl', 'verdict', 'components',
  'failures', 'inconclusive', 'vetoedReasons', 'activation', 'orderingSensitivity',
]);
const COMPONENT_KEYS = Object.freeze(['status', 'passes', 'reason', 'evidence']);
const EVIDENCE_KEYS = Object.freeze(['endpoints', 'transparency', 'veto']);
const ENDPOINT_EVIDENCE_KEYS = Object.freeze([
  'label', 'status', 'n', 'lower', 'upper', 'triggerFired', 'triggerReasons',
  'exactN', 'exactK', 'exactP', 'exactBound', 'exactBoundIsInfinite', 'unevaluableReason',
]);
const TRANSPARENCY_KEYS = Object.freeze([
  'endpoint', 'subgroupRows', 'meanAbsBaseline', 'maxAbsBaseline', 'weeksBelowFalsifiabilityFloor',
  'weeksWithBaseline', 'catastrophicCapCouldFire', 'weekSignIndependenceAssumed',
  'nonTiedWeeks', 'k', 'exactP', 'invertedBound',
  'weeklyBounds', 'medianWeeklyBound', 'qualifyingWeekCount',
]);
const VETO_EVIDENCE_KEYS = Object.freeze(['subgroupPlayerWeekCount', 'expectedCount', 'realizationCount', 'complete', 'catastrophicVeto', 'reason', 'realizations']);
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
// Decision D6 (ruled 2026-08-08): the estimand audit trail is published.
const SENSITIVITY_AUDIT_KEYS = Object.freeze(['winnersByPass', 'basisByPass', 'estimandReconciliation']);
// The report layer's own copy of the pass-key list (the third mirror -
// producer and reducer each keep theirs for the same independence reason;
// requiring either from here would be a cycle). Drift across all three is
// pinned by test.
const SENSITIVITY_AUDIT_PASS_KEYS = Object.freeze(['ordering:db-collation', 'ordering:duplicate-shuffle', 'estimand:force-fill']);
const SENSITIVITY_AUDIT_BASIS_BY_PASS = Object.freeze({
  'ordering:db-collation': 'stage-1-placeholder-basis',
  'ordering:duplicate-shuffle': 'stage-1-placeholder-basis',
  'estimand:force-fill': 'stage-2-post-contradiction',
});
const ESTIMAND_RECONCILIATION_KEYS = Object.freeze(['selection', 'halted', 'reason', 'detail', 'winners']);
const ESTIMAND_WINNER_KEYS = Object.freeze(['deployedPolicy', 'forceFill']);
const COHORT_EXCLUSION_ROW_KEYS = Object.freeze([
  'season', 'week', 'members', 'defenses', 'onBye', 'excluded', 'excludedTotal', 'contradictions',
]);
const COHORT_EXCLUSION_REASON_KEYS = Object.freeze([
  'no-roster-row', 'status-class-reserve', 'status-class-off_roster',
  'no-fantasy-position', 'malformed-gsis-id', 'unmapped-gsis-id',
  'absent-from-players-table',
]);
const REPORT_KEYS = Object.freeze(['studyId', 'run', 'permutationControl', 'cohortExclusions', 'cells', 'selection', 'sensitivityAudit', 'evidence']);

function normalizeCohortExclusions(rows, { label }) {
  if (!Array.isArray(rows)) throw new Error(`${label}: must be an array with one row per evaluated season-week`);
  const expected = [2025, 2024].flatMap((season) => metrics.EVALUATED_WEEKS.map((week) => `${season}:${week}`));
  const byCoordinate = new Map();
  const integer = (value, valueLabel) => {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${valueLabel}: must be a nonnegative integer`);
    return value;
  };
  for (const [index, row] of rows.entries()) {
    const rowLabel = `${label}[${index}]`;
    assertRequiredKeys(row, COHORT_EXCLUSION_ROW_KEYS, { label: rowLabel });
    assertClosedKeys(row, COHORT_EXCLUSION_ROW_KEYS, { label: rowLabel });
    const coordinate = `${row.season}:${row.week}`;
    if (!expected.includes(coordinate)) throw new Error(`${rowLabel}: ${coordinate} is outside the evaluated grid`);
    if (byCoordinate.has(coordinate)) throw new Error(`${rowLabel}: duplicate coordinate ${coordinate}`);
    assertRequiredKeys(row.excluded, COHORT_EXCLUSION_REASON_KEYS, { label: `${rowLabel}.excluded` });
    assertClosedKeys(row.excluded, COHORT_EXCLUSION_REASON_KEYS, { label: `${rowLabel}.excluded` });
    const excluded = Object.fromEntries(COHORT_EXCLUSION_REASON_KEYS.map((reason) => [
      reason, integer(row.excluded[reason], `${rowLabel}.excluded.${reason}`),
    ]));
    const excludedTotal = integer(row.excludedTotal, `${rowLabel}.excludedTotal`);
    const computedTotal = Object.values(excluded).reduce((sum, count) => sum + count, 0);
    if (excludedTotal !== computedTotal) throw new Error(`${rowLabel}.excludedTotal does not equal its reason-count sum`);
    byCoordinate.set(coordinate, {
      season: row.season,
      week: row.week,
      members: integer(row.members, `${rowLabel}.members`),
      defenses: integer(row.defenses, `${rowLabel}.defenses`),
      onBye: integer(row.onBye, `${rowLabel}.onBye`),
      excluded,
      excludedTotal,
      contradictions: integer(row.contradictions, `${rowLabel}.contradictions`),
    });
  }
  const missing = expected.filter((coordinate) => !byCoordinate.has(coordinate));
  if (missing.length > 0 || rows.length !== expected.length) {
    throw new Error(`${label}: requires exactly one row per evaluated season-week; missing [${missing.join(', ')}]`);
  }
  return expected.map((coordinate) => byCoordinate.get(coordinate));
}

/** Normalize one bootstrap/exact endpoint's evidence summary to the closed shape. */
function normalizeEndpointEvidence(endpoint, { label }) {
  assertClosedKeys(endpoint, ENDPOINT_EVIDENCE_KEYS, { label });
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    label: typeof endpoint.label === 'string' ? endpoint.label : null,
    status: typeof endpoint.status === 'string' ? endpoint.status : null,
    n: num(endpoint.n),
    lower: num(endpoint.lower),
    upper: num(endpoint.upper),
    triggerFired: !!endpoint.triggerFired,
    // Which of prereg 10.2's two conditions fired, verbatim.
    triggerReasons: Array.isArray(endpoint.triggerReasons) ? [...endpoint.triggerReasons] : [],
    // The exact-method evidence (prereg 9.8): surviving n, sign count k, the
    // exact p-value, and the inverted bound. `exactBound` is null when the
    // bound is infinite; `exactBoundIsInfinite` records that fact separately,
    // since the canonical serializer cannot carry a non-finite number.
    exactN: num(endpoint.exactN),
    exactK: num(endpoint.exactK),
    exactP: num(endpoint.exactP),
    exactBound: num(endpoint.exactBound),
    exactBoundIsInfinite: !!endpoint.exactBoundIsInfinite,
    unevaluableReason: typeof endpoint.unevaluableReason === 'string' ? endpoint.unevaluableReason : null,
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
    weeklyBounds: Array.isArray(t.weeklyBounds) ? t.weeklyBounds.map(num) : [],
    medianWeeklyBound: num(t.medianWeeklyBound),
    qualifyingWeekCount: num(t.qualifyingWeekCount),
  };
}

function normalizeVeto(veto, { label }) {
  if (!veto) return null;
  assertClosedKeys(veto, VETO_EVIDENCE_KEYS, { label });
  assertRequiredKeys(veto, VETO_EVIDENCE_KEYS, { label });
  for (const key of ['subgroupPlayerWeekCount', 'expectedCount', 'realizationCount']) {
    if (typeof veto[key] !== 'number' || !Number.isFinite(veto[key])) throw new Error(`${label}.${key}: must be a finite number`);
  }
  for (const key of ['complete', 'catastrophicVeto']) {
    if (typeof veto[key] !== 'boolean') throw new Error(`${label}.${key}: must be a boolean`);
  }
  if (veto.reason !== null && typeof veto.reason !== 'string') throw new Error(`${label}.reason: must be a string or null`);
  if (!Array.isArray(veto.realizations)) throw new Error(`${label}.realizations: must be an array`);
  return {
    // Section 6.4a's attestation is checkable ONLY against the veto's own
    // domain size - the gate operands' subgroupRows is a different set.
    subgroupPlayerWeekCount: veto.subgroupPlayerWeekCount,
    expectedCount: veto.expectedCount,
    realizationCount: veto.realizationCount,
    complete: veto.complete,
    catastrophicVeto: veto.catastrophicVeto,
    reason: veto.reason,
    realizations: veto.realizations.map((row) => ({ ...row })),
  };
}

function normalizeEvidence(evidence, { label, requireVeto = false }) {
  if (!evidence) return null;
  assertClosedKeys(evidence, EVIDENCE_KEYS, { label });
  if (requireVeto && !Object.prototype.hasOwnProperty.call(evidence, 'veto')) {
    throw new Error(`${label}: missing required veto evidence`);
  }
  return {
    endpoints: Array.isArray(evidence.endpoints)
      ? evidence.endpoints.map((e, i) => normalizeEndpointEvidence(e, { label: `${label}.endpoints[${i}]` }))
      : null,
    transparency: Array.isArray(evidence.transparency)
      ? evidence.transparency.map((t, i) => normalizeTransparency(t, { label: `${label}.transparency[${i}]` }))
      : null,
    veto: normalizeVeto(evidence.veto, { label: `${label}.veto` }),
  };
}

/** Normalize one component to the closed shape - `reason` is always present, `null` when unused. */
function normalizeComponent(component, { label, componentKey }) {
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
    evidence: normalizeEvidence(component.evidence, { label: `${label}.evidence`, requireVeto: componentKey === 'f' }),
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
    components[key] = normalizeComponent(component, { label: `${label}.components.${key}`, componentKey: key });
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
 * Normalize the sensitivity audit trail (decision D6) to the closed shape.
 * The two `ordering:*` rows of `winnersByPass` are STAGE-1 placeholder-basis
 * winners; the `estimand:force-fill` row is the STAGE-2 post-contradiction
 * winner (determinations 9/10) - a reader of the published report needs that
 * distinction from the spec, not from the shape, which deliberately carries
 * them as the one map spec 8.4's disagreement rules consumed.
 */
function normalizeSensitivityAudit(audit, { label }) {
  if (!audit) return null;
  assertClosedKeys(audit, SENSITIVITY_AUDIT_KEYS, { label });
  const winner = (value) => (typeof value === 'string' ? value : null);
  // Closed on the pass-key list at THIS layer too: an unknown pass must not
  // publish, and a missing one normalizes to a typed null rather than
  // silently vanishing (claims-fidelity QA on this slice).
  assertClosedKeys(audit.winnersByPass || {}, SENSITIVITY_AUDIT_PASS_KEYS, { label: `${label}.winnersByPass` });
  const winnersByPass = {};
  for (const key of [...SENSITIVITY_AUDIT_PASS_KEYS].sort()) {
    winnersByPass[key] = winner((audit.winnersByPass || {})[key]);
  }
  assertClosedKeys(audit.basisByPass || {}, SENSITIVITY_AUDIT_PASS_KEYS, { label: `${label}.basisByPass` });
  const basisByPass = {};
  for (const key of [...SENSITIVITY_AUDIT_PASS_KEYS].sort()) {
    const expected = SENSITIVITY_AUDIT_BASIS_BY_PASS[key];
    if ((audit.basisByPass || {})[key] !== expected) {
      throw new Error(`${label}.basisByPass[${JSON.stringify(key)}]: must be ${JSON.stringify(expected)}, got ${JSON.stringify((audit.basisByPass || {})[key])}`);
    }
    basisByPass[key] = expected;
  }
  const reconciliation = audit.estimandReconciliation || {};
  assertClosedKeys(reconciliation, ESTIMAND_RECONCILIATION_KEYS, { label: `${label}.estimandReconciliation` });
  assertClosedKeys(reconciliation.winners || {}, ESTIMAND_WINNER_KEYS, { label: `${label}.estimandReconciliation.winners` });
  return {
    winnersByPass,
    basisByPass,
    estimandReconciliation: {
      selection: winner(reconciliation.selection),
      halted: reconciliation.halted === true,
      reason: typeof reconciliation.reason === 'string' ? reconciliation.reason : null,
      detail: typeof reconciliation.detail === 'string' ? reconciliation.detail : null,
      winners: {
        deployedPolicy: winner((reconciliation.winners || {}).deployedPolicy),
        forceFill: winner((reconciliation.winners || {}).forceFill),
      },
    },
  };
}

/**
 * Build the closed-schema report. `sweep` is exactly what
 * `sweepInference.evaluateSweep()` returns. `studyId` is the preregistered
 * study identifier (`pit-sweep-2024-2025`), threaded through rather than
 * hardcoded so a future study reusing this module does not have to fork it.
 */
function buildReport({ studyId, sweep, cohortExclusions, label = 'sweepReport' }) {
  if (typeof studyId !== 'string' || studyId.length === 0) {
    throw new Error(`${label}: studyId must be a non-empty string`);
  }
  if (!sweep || typeof sweep !== 'object') {
    throw new Error(`${label}: sweep must be an evaluateSweep() result`);
  }
  const { run, permutationControl, cells: cellClaims, selection, evidence } = sweep;
  const publishedCohortExclusions = normalizeCohortExclusions(cohortExclusions, { label: `${label}.cohortExclusions` });

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
    // Section 7: contextual cohort construction counts are published even on
    // a void run. They are input diagnostics, never candidate-cell results.
    cohortExclusions: publishedCohortExclusions,
    cells,
    selection: normalizeSelection(selection, { label: `${label}.selection` }),
    // Decision D6: selection-level, candidate-claims-derived evidence, so a
    // void run publishes null (prereg 7.3), mirroring `cells`.
    sensitivityAudit: run.status === 'void' ? null
      : normalizeSensitivityAudit(sweep.sensitivityAudit === undefined ? null : sweep.sensitivityAudit, { label: `${label}.sensitivityAudit` }),
    // A void report retains only its independently derived pipeline
    // diagnostic.  Candidate matrix/sensitivity/profile evidence would be a
    // candidate-cell result and is therefore not publishable on a void run.
    evidence: evidence === undefined || evidence === null ? null
      : run.status === 'void' ? { diagnostics: { permutation: evidence.diagnostics.permutation } } : evidence,
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
        + `catastrophicCapCouldFire=${t.catastrophicCapCouldFire}, weeklyBounds=[${t.weeklyBounds.join(', ')}], `
        + `medianWeeklyBound=${t.medianWeeklyBound}, qualifyingWeekCount=${t.qualifyingWeekCount}`
      );
    }
    if (components.f.evidence.veto) {
      const veto = components.f.evidence.veto;
      // The veto's OWN domain size leads the line so section 6.4a's
      // attestation (realized === 24 x subgroup player-weeks) is checkable on
      // the Markdown artifact alone, not only the JSON one.
      lines.push(`- veto coverage: subgroup player-weeks=${veto.subgroupPlayerWeekCount}, expected=${veto.expectedCount}, realized=${veto.realizationCount}, complete=${veto.complete}, catastrophic=${veto.catastrophicVeto}`);
      for (const realization of veto.realizations) {
        lines.push(`  - realization: season=${realization.season}, week=${realization.week}, player=${realization.playerId}, salt=${realization.salt}, incrementalError=${realization.incrementalError}`);
      }
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

function displayValue(value) {
  if (value && typeof value === 'object' && value.nonfinite) return value.nonfinite;
  // Section 4.6.4 publishes null bounds for `unevaluable` and `degenerate` rows
  // rather than a non-finite marker, so `String(null)` would print the literal
  // word "null" in a published table. The row's own `status` column says why the
  // bound is absent; the cell itself just needs to read as absent.
  if (value === null || value === undefined) return '-';
  return String(value);
}

function renderEvidenceTables(evidence) {
  // Section 4.6: self-description is mandatory on every published descriptive
  // row - method, alpha, draws, surviving cluster count, season, profile and
  // status - so a prereg 12.1 primary interval and a prereg 10.5 moving-block
  // interval are never typographically indistinguishable.
  const selfDescription = (row) => `${row.status} | ${row.clusters} | ${row.method} | ${row.draws} | ${row.seed} | ${row.alpha}`;
  const SELF_HEADER = 'status | n | method | draws | seed | alpha';
  const SELF_RULE = '--- | ---: | --- | ---: | ---: | ---:';
  const lines = ['', '### Eight-cell metrics (prereg 12.1)', '', `| season | profile | cell | estimand | endpoint | point | CI | ${SELF_HEADER} |`, `| --- | --- | --- | --- | --- | ---: | --- | ${SELF_RULE} |`];
  for (const cell of evidence.cells) for (const [estimand, rows] of [['absolute', cell.absoluteMetrics], ['paired-delta', cell.pairedDeltas]]) {
    for (const row of rows) lines.push(`| ${cell.season} | ${cell.scoringProfile} | ${cell.cell} | ${estimand} | ${row.key} | ${displayValue(row.point)} | [${displayValue(row.lower)}, ${displayValue(row.upper)}] | ${selfDescription(row)} |`);
  }
  // Section 8.7 rule 4: prereg 16's sensitivity publication, absolute metrics
  // only, `standard` and `ppr`, 2025 only.  Published as its own table because
  // it is NOT rule 1's family.
  lines.push(
    '',
    '### Scoring-profile sensitivity (prereg 16)',
    '',
    "These rows use a half-PPR-selected cohort and half-PPR-priced outcome truth. Each standard or ppr arm-week's regret uses that profile's projected lineup and is measured in half-PPR points.",
    '',
    `| season | profile | cell | estimand | endpoint | point | CI | ${SELF_HEADER} |`,
    `| --- | --- | --- | --- | --- | ---: | --- | ${SELF_RULE} |`
  );
  for (const row of evidence.sensitivity) lines.push(`| ${row.season} | ${row.scoringProfile} | ${row.cell} | ${row.estimand} | ${row.endpoint} | ${displayValue(row.point)} | [${displayValue(row.lower)}, ${displayValue(row.upper)}] | ${selfDescription(row)} |`);
  // Prereg 16's week-window families (SPEC-A / decision D2, ruled 2026-08-08):
  // the weeks-2-17 re-analysis and the Week-18 absolute rows on their own,
  // primary profile, both seasons, absolute metrics only, derived from rule
  // 1's per-week rows.  A `week-18-only` row is a one-cluster family, so its
  // status is `degenerate` by construction and its CI reads as absent - that
  // is 4.6.4's refusal of a zero-width artifact, not a rendering gap.
  lines.push('', '### Week-window sensitivity (prereg 16)', '', `| season | profile | cell | window | estimand | endpoint | point | CI | ${SELF_HEADER} |`, `| --- | --- | --- | --- | --- | --- | ---: | --- | ${SELF_RULE} |`);
  for (const row of evidence.weekWindows) lines.push(`| ${row.season} | ${row.scoringProfile} | ${row.cell} | ${row.window} | ${row.estimand} | ${row.endpoint} | ${displayValue(row.point)} | [${displayValue(row.lower)}, ${displayValue(row.upper)}] | ${selfDescription(row)} |`);
  lines.push('', '### Moving-block sensitivity (prereg 10.5)', '', `| season | profile | cell | endpoint | sensitivity | point | CI | ${SELF_HEADER} |`, `| --- | --- | --- | --- | --- | ---: | --- | ${SELF_RULE} |`);
  for (const row of evidence.movingBlock) lines.push(`| ${row.season} | ${row.scoringProfile} | ${row.cell} | ${row.endpoint} | ${row.sensitivity} | ${displayValue(row.point)} | [${displayValue(row.lower)}, ${displayValue(row.upper)}] | ${selfDescription(row)} |`);
  lines.push('', '### Control diagnostics (prereg 10.6)', '', `| comparator | season | profile | endpoint | point | CI | ${SELF_HEADER} |`, `| --- | --- | --- | --- | ---: | --- | ${SELF_RULE} |`);
  for (const [comparator, rows] of [['control-naive', evidence.diagnostics.controlNaive], ['usage-signal', evidence.diagnostics.usageSignal]]) {
    for (const row of rows) lines.push(`| ${comparator} | ${row.season} | ${row.scoringProfile} | ${row.key} | ${displayValue(row.point)} | [${displayValue(row.lower)}, ${displayValue(row.upper)}] | ${selfDescription(row)} |`);
  }
  lines.push('', '### Attribution composites (prereg 12.2)', '', `| season | profile | cell | endpoint | composite | point | CI | ${SELF_HEADER} |`, `| --- | --- | --- | --- | --- | ---: | --- | ${SELF_RULE} |`);
  for (const row of evidence.attribution) for (const [composite, summary] of [['usage main', row.usageMain], ['home-away main', row.homeAwayMain], ['interaction', row.interaction]]) {
    lines.push(`| ${row.season} | ${row.scoringProfile} | ${row.cell} | ${row.endpoint} | ${composite} | ${displayValue(summary.point)} | [${displayValue(summary.lower)}, ${displayValue(summary.upper)}] | ${selfDescription(summary)} |`);
  }
  lines.push('', '### Activation aggregates', '', '| season | profile | cell | position | eligible | activated | excluded | rate |', '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const row of evidence.activationAggregates) for (const position of Object.keys(row.positions).sort()) {
    const value = row.positions[position];
    lines.push(`| ${row.season} | ${row.scoringProfile} | ${row.cell} | ${position} | ${value.eligible} | ${value.activated} | ${value.excludedIneligible} | ${displayValue(value.rate)} |`);
  }
  return lines;
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
  lines.push('## S3 prospective deviation');
  lines.push('');
  lines.push('S3 was preregistered but is not reported. These cohort exclusion counts are published only as deviation context and are not an S3 result.');
  lines.push('');
  lines.push('| season | week | members | defenses | onBye | excludedTotal | contradictions | no-roster-row | status-class-reserve | status-class-off_roster | no-fantasy-position | malformed-gsis-id | unmapped-gsis-id | absent-from-players-table |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.cohortExclusions) {
    lines.push(`| ${row.season} | ${row.week} | ${row.members} | ${row.defenses} | ${row.onBye} | ${row.excludedTotal} | ${row.contradictions} | ${COHORT_EXCLUSION_REASON_KEYS.map((reason) => row.excluded[reason]).join(' | ')} |`);
  }
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
  if (report.evidence) {
    lines.push('', '## Descriptive evidence', '');
    lines.push(`- Permutation: seed=${report.evidence.diagnostics.permutation.seed}, replicates=${report.evidence.diagnostics.permutation.replicates}, regret p=${report.evidence.diagnostics.permutation.regretPValue}, pairwise p=${report.evidence.diagnostics.permutation.pairwisePValue}`);
    if (report.run.status === 'valid') lines.push(...renderEvidenceTables(report.evidence));
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
  // Decision D6: the audit trail publishes beside the selection it explains.
  // Keys render sorted for byte determinism.  The ordering:* winners are
  // stage-1 placeholder-basis; the estimand:force-fill winner is stage-2
  // post-contradiction (determinations 9/10).
  if (report.sensitivityAudit) {
    lines.push('', '## Sensitivity audit (spec 8.4/8.5)', '');
    for (const key of Object.keys(report.sensitivityAudit.winnersByPass).sort()) {
      const basis = report.sensitivityAudit.basisByPass[key] === 'stage-1-placeholder-basis'
        ? 'stage-1 placeholder-basis'
        : 'stage-2 post-contradiction';
      lines.push(`- winner ${escapeMd(key)} (basis: ${escapeMd(basis)}): ${report.sensitivityAudit.winnersByPass[key] === null ? '-' : escapeMd(report.sensitivityAudit.winnersByPass[key])}`);
    }
    const reconciliation = report.sensitivityAudit.estimandReconciliation;
    const show = (value) => (value === null ? '-' : escapeMd(value));
    lines.push(`- estimand reconciliation: halted=${reconciliation.halted}, selection=${show(reconciliation.selection)}, deployedPolicy=${show(reconciliation.winners.deployedPolicy)}, forceFill=${show(reconciliation.winners.forceFill)}${reconciliation.reason ? `, reason=${escapeMd(reconciliation.reason)}` : ''}`);
    if (reconciliation.detail) lines.push('', escapeMd(reconciliation.detail));
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
  SENSITIVITY_AUDIT_PASS_KEYS,
  SENSITIVITY_AUDIT_BASIS_BY_PASS,
  COHORT_EXCLUSION_REASON_KEYS,
  assertFinite,
  assertNoUnstatedUnevaluable,
  assertClosedKeys,
  buildReport,
  canonicalizeReport,
  renderMarkdown,
};
