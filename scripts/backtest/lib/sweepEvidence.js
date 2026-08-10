'use strict';

/**
 * Gate 2's descriptive-evidence boundary.  Inputs are canonical synthetic
 * weekly observations, never caller-computed estimates or intervals.  This
 * module derives every published point/interval/aggregate from those rows.
 */

const { ALL_CELLS } = require('./arms');
const {
  MACRO_POSITIONS, EVALUATED_WEEKS, MOVING_BLOCK_LENGTHS, PERMUTATION_DRAWS, PERMUTATION_SEED,
  movingBlockBootstrap, buildBootstrapResamples, bootstrapMean,
  BOOTSTRAP_DRAWS, BOOTSTRAP_SEED, MOVING_BLOCK_SEED, COMPONENT_ALPHA,
} = require('./metrics');
const { PRIMARY_SCORING_PROFILE, SCORING_PROFILE_NAMES } = require('./freezeManifest');

const METRIC_KEYS = Object.freeze(['regret', 'pairwise', 'mae', 'rmse', 'rho', 'wis', 'coverage']);
const SEASONS = Object.freeze(['2025', '2024']);

/**
 * Section 8.7 rules 1-3 and 5: every unqualified family inherits prereg 4.3's
 * formal primary.  The identifier comes from the sealed freeze manifest rather
 * than a literal here, so the two can never drift apart.
 */
const PRIMARY_PROFILE = PRIMARY_SCORING_PROFILE;
const SCORING_PROFILES = Object.freeze([PRIMARY_PROFILE]);

/**
 * Section 8.7 rule 4: prereg 16's sensitivity publication is `standard` and
 * `ppr`, ABSOLUTE METRICS ONLY, endpoints `regret` and `pairwise`, season 2025
 * only, over the control cell and every candidate receiving an (e2) evaluation
 * - 8 cells x 2 endpoints x 2 profiles.  Paired deltas, the 12.2 composites and
 * the 10.6 diagnostics are NOT published for these two profiles.
 */
const SENSITIVITY_PROFILES = Object.freeze(SCORING_PROFILE_NAMES.filter((name) => name !== PRIMARY_PROFILE));
const SENSITIVITY_ENDPOINTS = Object.freeze(['regret', 'pairwise']);
const SENSITIVITY_SEASONS = Object.freeze(['2025']);

/**
 * Prereg 16's two WEEK-WINDOW families (SPEC-A, decision D2 ruled by the user
 * 2026-08-08: implement; SEALED at spec revision 35 as 8.7 rules 6-7).  The
 * weeks-2-17 sensitivity drops Week 18, whose widespread starter rest is a
 * common shock the paired contrasts already cancel; the Week-18 absolute
 * metrics are additionally published on their own - a one-cluster family that
 * lands in section 4.6.4's `degenerate` branch by construction.  Both families
 * are DERIVED from rule 1's already-validated per-week rows, never a second
 * input array, so one number can never carry two different values - section
 * 4.6.1's identity doctrine.  Scope SEALED at revision 35 (spec 8.7 rules
 * 6-7): absolute metrics only, the primary profile only (rule 4's "and
 * nothing else" bars composing these windows with `standard`/`ppr`), both
 * seasons, all seven endpoints over all eight cells, no moving-block
 * companions, union-then-window composition per spec 4.6.2.
 */
const WEEK_WINDOWS = Object.freeze([
  Object.freeze({ window: 'weeks-2-17', weeks: Object.freeze(EVALUATED_WEEKS.filter((week) => week !== 18)) }),
  Object.freeze({ window: 'week-18-only', weeks: Object.freeze([18]) }),
]);

const ESTIMANDS = Object.freeze(['absolute', 'paired-delta']);
const ATTRIBUTION_ESTIMANDS = Object.freeze(['usage-main', 'home-away-main', 'interaction']);
const DIAGNOSTIC_ESTIMANDS = Object.freeze(['control-naive', 'usage-signal']);
const CELL_NAMES = Object.freeze(ALL_CELLS.map((cell) => cell.name));
const ON_CELL_NAMES = Object.freeze(ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => cell.name));
const ATTRIBUTION_CELL_NAMES = Object.freeze(ALL_CELLS.filter((cell) => cell.homeAway === 'on' && cell.blendWeight !== 0.25).map((cell) => cell.name));
const NONFINITE = Object.freeze(['NaN', '+Infinity', '-Infinity']);

function closed(obj, keys, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${label}: must be an object`);
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(obj, key));
  const extra = Object.keys(obj).filter((key) => !keys.includes(key));
  if (missing.length || extra.length) throw new Error(`${label}: closed shape violation; missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}`);
}

function encodeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'number' && Number.isNaN(value)) return { nonfinite: 'NaN' };
  if (value === Infinity) return { nonfinite: '+Infinity' };
  if (value === -Infinity) return { nonfinite: '-Infinity' };
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && NONFINITE.includes(value.nonfinite)) return { nonfinite: value.nonfinite };
  throw new Error('evidence number: must be finite or an explicit nonfinite marker');
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function coordinate(row, fields) { return fields.map((field) => String(row[field])).join(':'); }

function exactRows(rows, expected, fields, label) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${label}: requires a non-empty complete row set`);
  const byKey = new Map();
  for (const [index, row] of rows.entries()) {
    const key = coordinate(row || {}, fields);
    if (byKey.has(key)) throw new Error(`${label}: duplicate coordinate ${key}`);
    byKey.set(key, { row, index });
  }
  const expectedKeys = expected.map((row) => coordinate(row, fields));
  const missing = expectedKeys.filter((key) => !byKey.has(key));
  const extra = [...byKey.keys()].filter((key) => !expectedKeys.includes(key));
  if (missing.length || extra.length || byKey.size !== expected.length) {
    throw new Error(`${label}: incomplete coordinate set; missing ${missing.length}, extra ${extra.length}`);
  }
  return expected.map((row) => byKey.get(coordinate(row, fields)).row);
}

function expectedMetricWeeks() {
  return SEASONS.flatMap((season) => CELL_NAMES.flatMap((cell) => ESTIMANDS.flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season, scoringProfile: PRIMARY_PROFILE, cell, endpoint, estimand, week })
  )))));
}

function expectedMovingWeeks() {
  return SEASONS.flatMap((season) => CELL_NAMES.flatMap((cell) => MOVING_BLOCK_LENGTHS.flatMap((blockLength) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season, scoringProfile: PRIMARY_PROFILE, cell, endpoint, estimand: 'absolute', sensitivity: `moving-block-${blockLength}`, week })
  )))));
}

function expectedAttributionWeeks() {
  return SEASONS.flatMap((season) => ATTRIBUTION_CELL_NAMES.flatMap((cell) => ATTRIBUTION_ESTIMANDS.flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season, scoringProfile: PRIMARY_PROFILE, cell, endpoint, estimand, week })
  )))));
}

function expectedDiagnosticWeeks() {
  return SEASONS.flatMap((season) => DIAGNOSTIC_ESTIMANDS.flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season, scoringProfile: PRIMARY_PROFILE, endpoint, estimand, week })
  ))));
}

/** Section 8.7 rule 4's row set, fixed at revision 22: 8 cells x 2 endpoints x 2 profiles, 2025 only. */
function expectedSensitivityWeeks() {
  return SENSITIVITY_SEASONS.flatMap((season) => SENSITIVITY_PROFILES.flatMap((scoringProfile) => CELL_NAMES.flatMap((cell) => SENSITIVITY_ENDPOINTS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season, scoringProfile, cell, endpoint, estimand: 'absolute', week })
  )))));
}

function expectedActivationWeeks() {
  return ON_CELL_NAMES.flatMap((cell) => SEASONS.flatMap((season) => SCORING_PROFILES.flatMap((scoringProfile) => EVALUATED_WEEKS.flatMap((week) => MACRO_POSITIONS.map((position) => ({ cell, season, scoringProfile, week, position }))))));
}

function normalizeMetricRow(row, label, moving = false) {
  closed(row, moving
    ? ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'sensitivity', 'week', 'value']
    : ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week', 'value'], label);
  if (!SEASONS.includes(String(row.season)) || row.scoringProfile !== PRIMARY_PROFILE || !CELL_NAMES.includes(row.cell)
    || !METRIC_KEYS.includes(row.endpoint) || !ESTIMANDS.includes(row.estimand) || !EVALUATED_WEEKS.includes(row.week)) {
    throw new Error(`${label}: invalid season/profile/cell/endpoint/estimand/week coordinate`);
  }
  if (moving && (!MOVING_BLOCK_LENGTHS.some((length) => row.sensitivity === `moving-block-${length}`) || row.estimand !== 'absolute')) {
    throw new Error(`${label}: invalid moving-block sensitivity coordinate`);
  }
  return { ...row, season: String(row.season), value: encodeNumber(row.value) };
}

function normalizeSensitivityRow(row, label) {
  closed(row, ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week', 'value'], label);
  if (!SENSITIVITY_SEASONS.includes(String(row.season)) || !SENSITIVITY_PROFILES.includes(row.scoringProfile)
    || !CELL_NAMES.includes(row.cell) || !SENSITIVITY_ENDPOINTS.includes(row.endpoint)
    || row.estimand !== 'absolute' || !EVALUATED_WEEKS.includes(row.week)) {
    throw new Error(`${label}: invalid prereg 16 sensitivity coordinate`);
  }
  return { ...row, season: String(row.season), value: encodeNumber(row.value) };
}

function normalizeAttributionRow(row, label) {
  closed(row, ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week', 'value'], label);
  if (!SEASONS.includes(String(row.season)) || row.scoringProfile !== PRIMARY_PROFILE || !ATTRIBUTION_CELL_NAMES.includes(row.cell)
    || !METRIC_KEYS.includes(row.endpoint) || !ATTRIBUTION_ESTIMANDS.includes(row.estimand) || !EVALUATED_WEEKS.includes(row.week)) throw new Error(`${label}: invalid attribution coordinate`);
  return { ...row, season: String(row.season), value: encodeNumber(row.value) };
}

function normalizeDiagnosticRow(row, label) {
  closed(row, ['season', 'scoringProfile', 'endpoint', 'estimand', 'week', 'value'], label);
  if (!SEASONS.includes(String(row.season)) || row.scoringProfile !== PRIMARY_PROFILE || !METRIC_KEYS.includes(row.endpoint)
    || !DIAGNOSTIC_ESTIMANDS.includes(row.estimand) || !EVALUATED_WEEKS.includes(row.week)) throw new Error(`${label}: invalid diagnostic coordinate`);
  return { ...row, season: String(row.season), value: encodeNumber(row.value) };
}

function normalizeActivationRow(row, label) {
  closed(row, ['cell', 'season', 'scoringProfile', 'week', 'position', 'eligible', 'activated', 'excludedIneligible'], label);
  if (!ON_CELL_NAMES.includes(row.cell) || !SEASONS.includes(String(row.season)) || !SCORING_PROFILES.includes(row.scoringProfile)
    || !EVALUATED_WEEKS.includes(row.week) || !MACRO_POSITIONS.includes(row.position)) throw new Error(`${label}: invalid activation coordinate`);
  for (const key of ['eligible', 'activated', 'excludedIneligible']) {
    if (!Number.isInteger(row[key]) || row[key] < 0) throw new Error(`${label}.${key}: must be a non-negative integer`);
  }
  if (row.activated > row.eligible) throw new Error(`${label}: activated cannot exceed eligible`);
  return { ...row, season: String(row.season) };
}

const DESCRIPTIVE_METHOD = 'percentile-cluster-bootstrap';
const MOVING_BLOCK_METHOD = 'moving-block-bootstrap';

/**
 * Section 4.6.3: prereg 10.1's shared resample index is shared PER CLUSTER
 * COUNT.  `buildBootstrapResamples` is seeded, so equal `n` already yields
 * byte-identical draws; this cache only avoids rebuilding a `draws x n` index
 * once per row.  Rows with different `n` necessarily do not share, because a
 * `draws x n` index cannot be reused at a different `n`.
 */
const resampleCache = new Map();
function sharedResamples(clusterCount, label) {
  // Keyed on the seed and draw count as well as the cluster count: those are
  // fixed here, but a cache keyed on `n` alone would silently return the wrong
  // index the moment anyone parameterized either, and a wrong-but-plausible
  // resample index is not a failure that announces itself.
  const cacheKey = `${BOOTSTRAP_SEED}:${BOOTSTRAP_DRAWS}:${clusterCount}`;
  if (!resampleCache.has(cacheKey)) {
    resampleCache.set(cacheKey, buildBootstrapResamples({ clusterCount, label }));
  }
  return resampleCache.get(cacheKey);
}

/**
 * The descriptive interval of section 4.6, with section 4.6.4's TOTAL reducer.
 *
 * `survivingWeeks`, when supplied, is the family-level surviving set required
 * by section 4.6.2 for an ABSOLUTE-METRIC family: a week survives only if it
 * has rows in ALL EIGHT cells, taken within a family and separately for each
 * `(season, scoringProfile, endpoint)`.  Contrasts pass null and take their own
 * finite weeks, which is prereg 10.4's contrast-scoped rule.
 *
 * Section 4.6.4 forbids this from ever throwing: a descriptive row's status is
 * never a Level 1/2/3/4/5 input.  Self-description is mandatory, so every row
 * carries its method, alpha, draw count, seed, surviving cluster count, season,
 * scoring profile and status alongside its bounds.
 */
function summarizeWeeks(rows, { key, label, season, scoringProfile, survivingWeeks = null, computeInterval = true }) {
  if (!rows) throw new Error(`${label}: no rows for this coordinate; the expected set and the derivation disagree`);
  const weeks = rows.map((row) => ({ week: row.week, value: row.value }));
  const surviving = survivingWeeks
    ? weeks.filter((row) => survivingWeeks.has(row.week))
    : weeks.filter((row) => finite(row.value));
  const self = {
    key, season, scoringProfile, method: DESCRIPTIVE_METHOD, alpha: COMPONENT_ALPHA,
    draws: BOOTSTRAP_DRAWS, seed: BOOTSTRAP_SEED, clusters: surviving.length, weeks,
  };
  if (surviving.length === 0 || !surviving.every((row) => finite(row.value))) {
    const reason = surviving.length === 0
      ? `${label}: no surviving clusters`
      : `${label}: nonfinite value in a surviving cluster`;
    return { ...self, status: 'unevaluable', point: null, lower: null, upper: null, reason };
  }
  if (surviving.length === 1) {
    return {
      ...self, status: 'degenerate', point: surviving[0].value, lower: null, upper: null,
      reason: `${label}: one surviving cluster; a one-cluster bootstrap interval is a zero-width artifact`,
    };
  }
  const weekValues = surviving.map((row) => row.value);
  // The moving-block path needs only the survivor set and the 4.6.4 status; it
  // publishes prereg 10.5's own bounds and discards section 4.6's. Running the
  // percentile bootstrap there would burn a third of the derivation's work to
  // produce three numbers that are then thrown away.
  if (!computeInterval) {
    return {
      ...self, status: 'estimated', point: weekValues.reduce((sum, value) => sum + value, 0) / weekValues.length,
      lower: null, upper: null, distinctValues: null, reason: null,
    };
  }
  const bootstrap = bootstrapMean({
    weekValues, resamples: sharedResamples(weekValues.length, label), alpha: COMPONENT_ALPHA, label,
  });
  return {
    ...self, status: 'estimated', point: bootstrap.point, lower: bootstrap.lower, upper: bootstrap.upper,
    distinctValues: bootstrap.distinctValues, reason: null,
  };
}

/**
 * Section 4.6.2's union drop, for ONE absolute-metric family: the set of weeks
 * finite in EVERY cell, computed per `(season, scoringProfile, endpoint)` and
 * never pooled across families, so a sparse week in a `ppr` sensitivity row
 * never drops a week from the primary `half_ppr` matrix.
 */
function survivingUnion(grouped, cells, keyFor) {
  return new Set(EVALUATED_WEEKS.filter((week) => cells.every((cell) => {
    const rows = grouped.get(keyFor(cell)) || [];
    const row = rows.find((candidate) => candidate.week === week);
    return row && finite(row.value);
  })));
}

function group(rows, fields) {
  const result = new Map();
  for (const row of rows) {
    const key = coordinate(row, fields);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

function deriveMetricMatrix(rows) {
  const grouped = group(rows, ['season', 'cell', 'estimand', 'endpoint']);
  return SEASONS.flatMap((season) => {
    // Section 4.6.2: the union is per (season, scoringProfile, endpoint), over
    // the eight cells, and applies to ABSOLUTE metrics only.  Paired deltas are
    // contrasts and keep prereg 10.4's contrast-scoped surviving set, so that a
    // descriptive paired delta and its gating counterpart share one cluster set.
    const unions = new Map(METRIC_KEYS.map((key) => [
      key, survivingUnion(grouped, CELL_NAMES, (cell) => `${season}:${cell}:absolute:${key}`),
    ]));
    return CELL_NAMES.map((cell) => ({
      season, scoringProfile: PRIMARY_PROFILE, cell,
      absoluteMetrics: METRIC_KEYS.map((key) => summarizeWeeks(grouped.get(`${season}:${cell}:absolute:${key}`), {
        key, label: `absolute ${season}/${cell}/${key}`, season, scoringProfile: PRIMARY_PROFILE, survivingWeeks: unions.get(key),
      })),
      pairedDeltas: METRIC_KEYS.map((key) => summarizeWeeks(grouped.get(`${season}:${cell}:paired-delta:${key}`), {
        key, label: `paired ${season}/${cell}/${key}`, season, scoringProfile: PRIMARY_PROFILE,
      })),
    }));
  });
}

/** Section 8.7 rule 4 / prereg 16: absolute metrics only, `standard` and `ppr`, 2025 only. */
function deriveSensitivity(rows) {
  const grouped = group(rows, ['season', 'scoringProfile', 'cell', 'endpoint']);
  return SENSITIVITY_SEASONS.flatMap((season) => SENSITIVITY_PROFILES.flatMap((scoringProfile) => {
    const unions = new Map(SENSITIVITY_ENDPOINTS.map((key) => [
      key, survivingUnion(grouped, CELL_NAMES, (cell) => `${season}:${scoringProfile}:${cell}:${key}`),
    ]));
    return CELL_NAMES.flatMap((cell) => SENSITIVITY_ENDPOINTS.map((key) => ({
      cell,
      estimand: 'absolute',
      ...summarizeWeeks(grouped.get(`${season}:${scoringProfile}:${cell}:${key}`), {
        key, label: `sensitivity ${season}/${scoringProfile}/${cell}/${key}`, season, scoringProfile, survivingWeeks: unions.get(key),
      }),
      endpoint: key,
    })));
  }));
}

/**
 * The two prereg 16 week-window families, computed from the SAME normalized
 * `metricWeeks` rows as rule 1's matrix.  Section 4.6.2's all-eight-cells
 * union is taken first, per `(season, scoringProfile, endpoint)` over the FULL
 * family, then intersected with the window: a week that fails the union in any
 * cell is dropped for every cell, so one cell's nonfinite week 18 makes the
 * whole `week-18-only` family unevaluable - the commensurability-consistent
 * reading of 4.6.2.  There is no cluster floor on this path: prereg 10.4's
 * `n >= 15` floor is component-scoped, and a descriptive window degrades
 * through `degenerate` to `unevaluable` (4.6.4) without ever voiding anything
 * or switching method.  A 16-cluster weeks-2-17 row shares its resample index
 * with every other 16-cluster row via `sharedResamples`, exactly as 4.6.3
 * promises.
 */
function deriveWeekWindows(rows) {
  const grouped = group(rows, ['season', 'cell', 'estimand', 'endpoint']);
  return WEEK_WINDOWS.flatMap(({ window, weeks }) => SEASONS.flatMap((season) => {
    const unions = new Map(METRIC_KEYS.map((key) => {
      const union = survivingUnion(grouped, CELL_NAMES, (cell) => `${season}:${cell}:absolute:${key}`);
      return [key, new Set(weeks.filter((week) => union.has(week)))];
    }));
    return CELL_NAMES.flatMap((cell) => METRIC_KEYS.map((key) => {
      // The row's published `weeks` are the window's weeks alone: the row is a
      // re-analysis over the restricted window, and listing all 17 would make
      // `clusters` unauditable against its own self-description.
      const windowRows = grouped.get(`${season}:${cell}:absolute:${key}`).filter((row) => weeks.includes(row.week));
      return {
        cell,
        estimand: 'absolute',
        window,
        ...summarizeWeeks(windowRows, {
          key, label: `week-window ${window} ${season}/${cell}/${key}`, season, scoringProfile: PRIMARY_PROFILE, survivingWeeks: unions.get(key),
        }),
        endpoint: key,
      };
    }));
  }));
}

function deriveMovingBlock(rows) {
  const grouped = group(rows, ['season', 'cell', 'endpoint', 'sensitivity']);
  return SEASONS.flatMap((season) => CELL_NAMES.flatMap((cell) => METRIC_KEYS.flatMap((key) => MOVING_BLOCK_LENGTHS.map((blockLength) => {
    const label = `moving ${season}/${cell}/${key}/${blockLength}`;
    const summary = summarizeWeeks(grouped.get(`${season}:${cell}:${key}:moving-block-${blockLength}`), {
      key, label, season, scoringProfile: PRIMARY_PROFILE, computeInterval: false,
    });
    const survivingValues = summary.weeks.filter((week) => finite(week.value)).map((week) => week.value);
    // Section 4.6.2's union covers rule 1's and rule 4's absolute families; its
    // case list is stated as exhaustive over section 4.6's scope and does not
    // reach prereg 10.5, so a moving-block row keeps its own surviving weeks.
    const contiguous = survivingValues.length === summary.weeks.length;
    // Section 4.6.4: prereg 10.5 keeps its own sealed construction and its own
    // bounds.  The primary interval is published on the cell's own row, so this
    // record never duplicates it.
    //
    // Section 4.6.4 requires this to be TOTAL.  `movingBlockBootstrap` throws
    // when the surviving cluster count is below the block length, and under the
    // 4.6.4 reducer `estimated` means only TWO OR MORE surviving clusters - so a
    // 2-cluster series at blockLength 3 would abort the whole run over a
    // descriptive sensitivity that gates nothing.  A block that cannot be formed
    // is an unevaluable ROW, never an exception.
    // STRICTLY GREATER than the block length, not `>=`: at n === blockLength the
    // only admissible start index is 0, so all 100,000 draws are the identical
    // block and lower === upper === point. Publishing that as an interval is the
    // same zero-width artifact the `degenerate` status exists to refuse.
    const formable = summary.status === 'estimated' && survivingValues.length > blockLength;
    const moving = formable ? movingBlockBootstrap({ weekValues: survivingValues, blockLength, label }) : null;
    const blocked = summary.status === 'estimated' && !formable;
    const status = blocked ? 'unevaluable' : summary.status;
    return {
      season, scoringProfile: PRIMARY_PROFILE, cell, endpoint: key, estimand: 'absolute',
      sensitivity: `moving-block-${blockLength}`, blockLength,
      // Bounds are published only when the moving-block construction actually
      // ran; falling back to section 4.6's interval here would publish the
      // primary bounds under prereg 10.5's method label.
      point: status === 'unevaluable' ? null : (moving ? moving.point : summary.point),
      lower: moving ? moving.lower : null,
      upper: moving ? moving.upper : null,
      // Self-description names prereg 10.5's OWN construction, not section
      // 4.6's, so a moving-block interval is never mistaken for the primary one.
      method: MOVING_BLOCK_METHOD, alpha: COMPONENT_ALPHA, draws: BOOTSTRAP_DRAWS, seed: MOVING_BLOCK_SEED,
      weeks: summary.weeks, clusters: summary.clusters, status,
      // Survivors are compacted before blocking, so a dropped week makes two
      // non-adjacent weeks adjacent in the drawn block. The moving-block
      // sensitivity exists to probe SERIAL structure, so a reader must be able
      // to see when the series it ran on was not contiguous.
      contiguous,
      reason: blocked
        ? `${label}: ${survivingValues.length} surviving clusters cannot form a block of ${blockLength} without a zero-width interval`
        : summary.reason,
    };
  }))));
}

function deriveAttribution(rows) {
  const grouped = group(rows, ['season', 'cell', 'endpoint', 'estimand']);
  return SEASONS.flatMap((season) => ATTRIBUTION_CELL_NAMES.flatMap((cell) => METRIC_KEYS.map((key) => ({
    season, scoringProfile: PRIMARY_PROFILE, cell, endpoint: key,
    usageMain: summarizeWeeks(grouped.get(`${season}:${cell}:${key}:usage-main`), { key, label: `usage ${season}/${cell}/${key}`, season, scoringProfile: PRIMARY_PROFILE }),
    homeAwayMain: summarizeWeeks(grouped.get(`${season}:${cell}:${key}:home-away-main`), { key, label: `homeAway ${season}/${cell}/${key}`, season, scoringProfile: PRIMARY_PROFILE }),
    interaction: summarizeWeeks(grouped.get(`${season}:${cell}:${key}:interaction`), { key, label: `interaction ${season}/${cell}/${key}`, season, scoringProfile: PRIMARY_PROFILE }),
  }))));
}

function deriveDiagnostics(rows, permutation) {
  const grouped = group(rows, ['season', 'endpoint', 'estimand']);
  const metricsFor = (estimand) => SEASONS.flatMap((season) => METRIC_KEYS.map((key) => summarizeWeeks(grouped.get(`${season}:${key}:${estimand}`), {
    key, label: `${season}/${estimand}/${key}`, season, scoringProfile: PRIMARY_PROFILE,
  })));
  return {
    controlNaive: metricsFor('control-naive'),
    usageSignal: metricsFor('usage-signal'),
    permutation: {
      seed: permutation.seed, replicates: permutation.replicates,
      regretStatistic: permutation.regret.observed, regretPValue: permutation.regret.p,
      pairwiseStatistic: permutation.pairwise.observed, pairwisePValue: permutation.pairwise.p,
    },
  };
}

function deriveActivation(rows) {
  const profiles = rows.map((row) => ({
    cell: row.cell, season: row.season, scoringProfile: row.scoringProfile, week: row.week, position: row.position,
    eligible: row.eligible, activated: row.activated, excludedIneligible: row.excludedIneligible,
    rate: row.eligible === 0 ? null : row.activated / row.eligible,
  }));
  const grouped = group(rows, ['cell', 'season', 'scoringProfile', 'position']);
  const aggregates = ON_CELL_NAMES.flatMap((cell) => SEASONS.flatMap((season) => SCORING_PROFILES.map((scoringProfile) => ({
    cell, season, scoringProfile,
    positions: Object.fromEntries(MACRO_POSITIONS.map((position) => {
      const weekRows = grouped.get(`${cell}:${season}:${scoringProfile}:${position}`);
      const eligible = weekRows.reduce((sum, row) => sum + row.eligible, 0);
      const activated = weekRows.reduce((sum, row) => sum + row.activated, 0);
      const excludedIneligible = weekRows.reduce((sum, row) => sum + row.excludedIneligible, 0);
      return [position, { eligible, activated, excludedIneligible, rate: eligible === 0 ? null : activated / eligible }];
    })),
  }))));
  return { profiles, aggregates };
}

function validatePermutation(permutation) {
  if (!permutation || permutation.seed !== PERMUTATION_SEED || permutation.replicates !== PERMUTATION_DRAWS) throw new Error('evidence permutation: requires the internally derived pinned seed and 10,000 replicates');
  for (const value of [permutation.regret && permutation.regret.observed, permutation.regret && permutation.regret.p, permutation.pairwise && permutation.pairwise.observed, permutation.pairwise && permutation.pairwise.p]) {
    if (!finite(value)) throw new Error('evidence permutation: derived statistics and p-values must be finite');
  }
}

function deriveEvidence(evidence, { permutation } = {}) {
  closed(evidence, ['metricWeeks', 'movingBlockWeeks', 'attributionWeeks', 'diagnosticWeeks', 'activationWeeks', 'sensitivityWeeks'], 'evidence');
  validatePermutation(permutation);
  const metricWeeks = exactRows(evidence.metricWeeks.map((row, index) => normalizeMetricRow(row, `evidence.metricWeeks[${index}]`)), expectedMetricWeeks(), ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week'], 'evidence.metricWeeks');
  const movingBlockWeeks = exactRows(evidence.movingBlockWeeks.map((row, index) => normalizeMetricRow(row, `evidence.movingBlockWeeks[${index}]`, true)), expectedMovingWeeks(), ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'sensitivity', 'week'], 'evidence.movingBlockWeeks');
  const attributionWeeks = exactRows(evidence.attributionWeeks.map((row, index) => normalizeAttributionRow(row, `evidence.attributionWeeks[${index}]`)), expectedAttributionWeeks(), ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week'], 'evidence.attributionWeeks');
  const diagnosticWeeks = exactRows(evidence.diagnosticWeeks.map((row, index) => normalizeDiagnosticRow(row, `evidence.diagnosticWeeks[${index}]`)), expectedDiagnosticWeeks(), ['season', 'scoringProfile', 'endpoint', 'estimand', 'week'], 'evidence.diagnosticWeeks');
  const activationWeeks = exactRows(evidence.activationWeeks.map((row, index) => normalizeActivationRow(row, `evidence.activationWeeks[${index}]`)), expectedActivationWeeks(), ['cell', 'season', 'scoringProfile', 'week', 'position'], 'evidence.activationWeeks');
  const sensitivityWeeks = exactRows(evidence.sensitivityWeeks.map((row, index) => normalizeSensitivityRow(row, `evidence.sensitivityWeeks[${index}]`)), expectedSensitivityWeeks(), ['season', 'scoringProfile', 'cell', 'endpoint', 'week'], 'evidence.sensitivityWeeks');
  const activation = deriveActivation(activationWeeks);
  return {
    cells: deriveMetricMatrix(metricWeeks),
    sensitivity: deriveSensitivity(sensitivityWeeks),
    weekWindows: deriveWeekWindows(metricWeeks),
    movingBlock: deriveMovingBlock(movingBlockWeeks),
    attribution: deriveAttribution(attributionWeeks),
    diagnostics: deriveDiagnostics(diagnosticWeeks, permutation),
    activationProfiles: activation.profiles,
    activationAggregates: activation.aggregates,
  };
}

function crossCheckActivationGate(cellClaims, evidence) {
  for (const cell of ON_CELL_NAMES) {
    const activation = cellClaims[cell] && cellClaims[cell].activation;
    if (!activation || !activation.bySeason) throw new Error(`evidence activation: missing claim activation for ${cell}`);
    for (const season of SEASONS) for (const position of MACRO_POSITIONS) {
      const aggregate = evidence.activationAggregates.find((row) => row.cell === cell && row.season === season && row.scoringProfile === PRIMARY_PROFILE).positions[position];
      const claim = activation.bySeason[season].byPosition[position];
      if (!claim || aggregate.eligible !== claim.eligible || aggregate.activated !== claim.activated || aggregate.excludedIneligible !== claim.excludedIneligible || aggregate.rate !== claim.rate) {
        throw new Error(`evidence activation: aggregate does not match activation gate for ${cell}/${season}/${position}`);
      }
    }
  }
}

/**
 * Each season's descriptive paired delta must equal the gating component that
 * owns that season, which is what section 4.6.1 means by "one number never
 * carries two different intervals": component (a) is the 2025 co-primary and
 * component (e1) is the 2024 co-primary safety gate (prereg 9.6), and both
 * carry the same `{regretWeekDeltas, pairwiseWeekDeltas}` shape.
 *
 * Checking only 2025 would leave the 2024 rows - which the season coordinate of
 * section 4.6.1 newly requires - published against nothing, so a 2024
 * descriptive delta could silently disagree with the (e1) gate for the same
 * cell and endpoint.
 */
const CLAIM_COMPONENT_BY_SEASON = Object.freeze({ 2025: 'a', 2024: 'e1' });

function crossCheckClaimInputs(cellInputs, evidence) {
  for (const cell of CELL_NAMES) {
    for (const season of SEASONS) {
      const component = CLAIM_COMPONENT_BY_SEASON[season];
      const source = cellInputs[cell] && cellInputs[cell][component];
      const published = evidence.cells.find((row) => row.cell === cell && row.season === season && row.scoringProfile === PRIMARY_PROFILE);
      if (!source || !published) throw new Error(`evidence claims: missing component-(${component}) input or published ${season} row for ${cell}`);
      for (const [endpoint, inputKey] of [['regret', 'regretWeekDeltas'], ['pairwise', 'pairwiseWeekDeltas']]) {
        const weekly = published.pairedDeltas.find((row) => row.key === endpoint).weeks;
        for (const row of weekly) {
          const sourceValue = source[inputKey][row.week];
          const matchesMissing = sourceValue === undefined && !finite(row.value);
          if (!matchesMissing && (!finite(row.value) || row.value !== sourceValue)) {
            throw new Error(`evidence claims: paired ${cell}/${season}/${endpoint}/week-${row.week} does not match component-(${component}) input`);
          }
        }
      }
    }
  }
}

module.exports = {
  METRIC_KEYS, SEASONS, SCORING_PROFILES, ESTIMANDS, CELL_NAMES, ON_CELL_NAMES, ATTRIBUTION_CELL_NAMES,
  PRIMARY_PROFILE, SENSITIVITY_PROFILES, SENSITIVITY_ENDPOINTS, SENSITIVITY_SEASONS, WEEK_WINDOWS,
  DESCRIPTIVE_METHOD, MOVING_BLOCK_METHOD,
  encodeNumber, deriveEvidence, crossCheckActivationGate, crossCheckClaimInputs,
};
