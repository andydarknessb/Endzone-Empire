'use strict';

/**
 * Gate 2 (PHASE5_EXECUTION_SPEC.md sections 3-8): assembles ONE cell's full
 * `arms.evaluateClaim()` input from raw, already-scored per-week contrast
 * series.
 *
 * Pure: no clock, no I/O, no database. Every function here consumes
 * `lib/metrics.js`'s per-week/bootstrap primitives and `lib/arms.js`'s
 * endpoint/component classifiers exactly as they already exist - this module
 * adds no new statistical machinery, only the orchestration that wires a raw
 * `{ [week]: value }` contrast series through week-dropping, the shared
 * bootstrap, the exact-trigger reconciliation rule, and the Level 3/4
 * combiners, for components (a)-(e1) and the thirteen (e2) inequalities.
 * Component (f) is NOT re-implemented here - `arms.componentF` already does
 * that, unchanged, and its output is combined at the cell level exactly as
 * documented in `arms.evaluateClaim`.
 */

const metrics = require('./metrics');
const arms = require('./arms');

const { EVALUATED_WEEKS, COMPONENT_ALPHA } = metrics;

/**
 * Level 4, ONE bootstrap-based endpoint, end to end: week-dropping (prereg
 * 10.4, symmetric by construction since `weekDeltas` is already the paired
 * contrast) -> the shared bootstrap (section 3.3: sharing rests on
 * `(seed, clusterCount)` determinism, not on passing one object around) ->
 * the exact-trigger check (prereg 10.2, section 4.3: only the degenerate-
 * distribution half can ever fire, since the preregistered n >= 15 floor is
 * already above the cluster-count trigger's threshold of 12) -> IF triggered,
 * the section 4.2 AND rule (both procedures required, never a substitution).
 *
 * `weekDeltas`: `{ [week]: value }`, the per-week candidate-minus-comparator
 * contrast (already averaged over the 24 salts upstream, `saltPairedDelta`).
 * `direction`: `'below'` when the upper CI bound must clear BELOW
 * `passingBoundary` (favorable-negative: regret, MAE, RMSE, WIS), `'above'`
 * when the lower bound must clear ABOVE it (favorable-positive: pairwise,
 * coverage, rho) - matches `arms.classifyBootstrapEndpoint`'s own contract.
 */
function evaluateBootstrapEndpoint({
  weekDeltas,
  passingBoundary,
  harmfulBoundary,
  direction,
  evaluatedWeeks = EVALUATED_WEEKS,
  alpha = COMPONENT_ALPHA,
  label = 'endpoint',
}) {
  const dropped = metrics.dropWeeks({ series: { delta: weekDeltas }, evaluatedWeeks, label });
  if (!dropped.evaluable) {
    return {
      status: 'unevaluable',
      passes: false,
      reason: dropped.reason,
      trigger: { fired: false },
      weekDropping: dropped,
      label,
    };
  }
  const surviving = dropped.aligned.delta;
  const resamples = metrics.buildBootstrapResamples({ clusterCount: surviving.length });
  const bootstrap = metrics.bootstrapMean({ weekValues: surviving, resamples, alpha, label });
  const trigger = metrics.exactInferenceTrigger({ clusters: bootstrap.clusters, distinctValues: bootstrap.distinctValues });

  const bootstrapClassification = arms.classifyBootstrapEndpoint({
    evaluable: true, lower: bootstrap.lower, upper: bootstrap.upper,
    passingBoundary, harmfulBoundary, direction,
  });

  if (!trigger.fired) {
    return {
      ...bootstrapClassification,
      trigger, bootstrap, weekDropping: dropped, exact: null, label,
    };
  }

  const exact = arms.exactSignTest({
    weekDeltas: surviving,
    margin: passingBoundary,
    alpha,
    favorablePositive: direction === 'above',
    label,
  });
  const triggered = arms.classifyTriggeredEndpoint({ bootstrap: bootstrapClassification, exact });
  return {
    ...triggered,
    trigger, bootstrap, weekDropping: dropped, exact, label,
  };
}

/**
 * Level 3, generic component combiner for anything OTHER than component
 * (f): missing is handled one level up (by `arms.evaluateClaim`, when the
 * whole component object is absent) - this combines the endpoint(s)
 * belonging to ONE already-present component. Precedence
 * `unevaluable > wide-straddle > failed > passed` (section 8.2's Level 3,
 * minus the `vetoed` row, which is (f)-only and handled by
 * `arms.componentF`'s own combiner).
 */
function combineEndpoints(endpointResults, { label = 'component' } = {}) {
  if (!Array.isArray(endpointResults) || endpointResults.length === 0) {
    throw new Error(`${label}: combineEndpoints requires at least one endpoint result`);
  }
  const unevaluable = endpointResults.filter((r) => r.status === 'unevaluable');
  if (unevaluable.length > 0) {
    return {
      status: 'unevaluable',
      passes: false,
      reason: unevaluable.map((r) => `${r.label}: ${r.reason}`).join('; '),
      endpoints: endpointResults,
      label,
    };
  }
  const straddled = endpointResults.filter((r) => r.status === 'wide-straddle');
  if (straddled.length > 0) {
    return {
      status: 'wide-straddle',
      passes: false,
      reason: straddled.map((r) => `${r.label}: ${r.reason}`).join('; '),
      endpoints: endpointResults,
      label,
    };
  }
  const passes = endpointResults.every((r) => r.passes);
  return {
    status: passes ? 'passed' : 'failed',
    passes,
    reason: passes ? null
      : `${endpointResults.filter((r) => !r.passes).map((r) => r.label).join(', ')} did not clear noninferiority`,
    endpoints: endpointResults,
    label,
  };
}

/**
 * Components (a), (b), (c), (d), (e1): the shared co-primary shape - regret
 * AND pairwise, both must hold, from independently week-dropped series
 * (section 8.1's table: (a) is the sole superiority endpoint, (e1) and
 * (b)/(c)/(d) are noninferiority/zero-margin - which one a caller is
 * building is entirely a function of the boundary values it supplies, never
 * hardcoded here).
 */
function evaluateCoPrimaryComponent({
  name,
  regretWeekDeltas, pairwiseWeekDeltas,
  regretPassingBoundary, regretHarmfulBoundary,
  pairwisePassingBoundary, pairwiseHarmfulBoundary,
  regretDirection = 'below', pairwiseDirection = 'above',
  evaluatedWeeks = EVALUATED_WEEKS, alpha = COMPONENT_ALPHA, label = name,
}) {
  const regret = evaluateBootstrapEndpoint({
    weekDeltas: regretWeekDeltas,
    passingBoundary: regretPassingBoundary, harmfulBoundary: regretHarmfulBoundary,
    direction: regretDirection, evaluatedWeeks, alpha, label: `${label} regret`,
  });
  const pairwise = evaluateBootstrapEndpoint({
    weekDeltas: pairwiseWeekDeltas,
    passingBoundary: pairwisePassingBoundary, harmfulBoundary: pairwiseHarmfulBoundary,
    direction: pairwiseDirection, evaluatedWeeks, alpha, label: `${label} pairwise`,
  });
  return combineEndpoints([regret, pairwise], { label });
}

/**
 * Component (e2): the thirteen preregistered endpoint-season inequalities
 * (prereg 9.7, PHASE5_EXECUTION_SPEC.md section 4.2: `1 + (4 x 2) + 2 + 2 =
 * 13`), combined as ONE component - every one of the thirteen must pass.
 *
 * `endpoints`: an array of exactly 13 `{ key, weekDeltas, passingBoundary,
 * harmfulBoundary, direction }` descriptors. The exact set of 13 keys is
 * asserted so a caller cannot silently under- or over-report the family.
 */
const E2_ENDPOINT_KEYS = Object.freeze([
  'coverage',
  'mae-2025', 'mae-2024',
  'rmse-2025', 'rmse-2024',
  'rho-2025', 'rho-2024',
  'wis-2025', 'wis-2024',
  'standard-regret-2025', 'standard-pairwise-2025',
  'full-ppr-regret-2025', 'full-ppr-pairwise-2025',
]);

function evaluateE2Component({ endpoints, evaluatedWeeks = EVALUATED_WEEKS, alpha = COMPONENT_ALPHA, label = 'e2' }) {
  if (!Array.isArray(endpoints)) throw new Error(`${label}: endpoints must be an array`);
  const keys = endpoints.map((e) => e.key);
  const missing = E2_ENDPOINT_KEYS.filter((k) => !keys.includes(k));
  const unexpected = keys.filter((k) => !E2_ENDPOINT_KEYS.includes(k));
  const duplicated = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (missing.length > 0 || unexpected.length > 0 || duplicated.length > 0) {
    throw new Error(
      `${label}: requires exactly the thirteen preregistered (e2) endpoint-season inequalities. `
      + `missing: [${missing.join(', ')}], unexpected: [${unexpected.join(', ')}], `
      + `duplicated: [${duplicated.join(', ')}]`
    );
  }
  const results = endpoints.map((e) => evaluateBootstrapEndpoint({
    weekDeltas: e.weekDeltas,
    passingBoundary: e.passingBoundary, harmfulBoundary: e.harmfulBoundary,
    direction: e.direction, evaluatedWeeks, alpha, label: `${label}:${e.key}`,
  }));
  return combineEndpoints(results, { label });
}

module.exports = {
  E2_ENDPOINT_KEYS,
  evaluateBootstrapEndpoint,
  combineEndpoints,
  evaluateCoPrimaryComponent,
  evaluateE2Component,
};
