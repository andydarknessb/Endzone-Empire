'use strict';

/**
 * Gate 2, the `--inputs` PRODUCER's assembly layer (increment P1).
 *
 * `run-backtest-sweep.js` is a REDUCER over an already-assembled `--inputs`
 * JSON document. Nothing in the tree yet PRODUCES that document from the
 * generation grid (PHASE5_EXECUTION_SPEC.md section 9: 8 cells x 24 salts x
 * 34 season-weeks, plus the identity-assertion arms and the two sensitivity
 * scoring profiles - 14,688 salted arm-week generations). This module is the
 * pure middle of that producer: it consumes RAW, ALREADY-GENERATED records -
 * per-arm-week metric values, per-row subgroup error pairs, per-week
 * activation projection records, the preflight capture arrays, the
 * permutation-control artifacts - and assembles the complete document the
 * reducer's `validateInputs` closes over. It generates nothing itself: no
 * projection, no snapshot, no database, no clock, no I/O. Under Gate 0 that
 * is exactly the split that keeps this buildable and testable now: the
 * records it consumes are synthetic fixtures in every test, and the module
 * cannot execute a candidate cell because it has no code path that computes
 * a projection at all. (The generation driver that will feed it real records
 * is a later increment, and running THAT stays barred until Gate 4/Gate 3.)
 *
 * Contract with the spec, stated by obligation:
 *
 *  - Component weekDeltas (prereg 6.7): every formal contrast is the
 *    arithmetic mean of the 24 SAME-SALT candidate-minus-comparator deltas,
 *    computed by `metrics.saltPairedDelta` - never re-implemented here.
 *    Comparators per component (prereg 9.2-9.7): (a) control, 2025; (b) the
 *    matched same-usage off cell, on-cells only; (c) usage-25 at the SAME
 *    homeAway setting, only when blendWeight differs from 0.25; (d) the
 *    `naive-recency` benchmark; (e1) control, 2024; (e2) the thirteen
 *    endpoint-season inequalities of prereg 9.7, with the `standard` /
 *    `full-ppr` rows drawn from their OWN scoring-profile generations
 *    (section 9: profile is a generation coordinate, never a re-scoring).
 *  - Prereg 10.4's drop rule: a week with no rows for either side of a
 *    contrast is dropped by OMITTING the week's key from the series - the
 *    only absence form the reducer accepts - and the matching evidence row
 *    carries an explicit `{ nonfinite: 'NaN' }` marker, which is the pair
 *    `crossCheckClaimInputs` tolerates (`sourceValue === undefined` beside a
 *    nonfinite published value).
 *  - Component (f) (sections 6.3/6.4/6.4a): the veto realization set is the
 *    complete Cartesian product of the derived subgroup player-weeks and the
 *    24 salts, `incrementalError = |errorOn| - |errorOff|`, emitted in a
 *    pinned order (season, week, playerId ascending, then `metrics.SALTS`
 *    order); f2's per-week delta is `saltPairedDelta` of the per-salt
 *    subgroup absolute biases, rows summed in ascending-playerId order. The
 *    subgroup domain is derived from `matchedOffBaselineRows` intersected
 *    with the cohort EXACTLY as the reducer's own `componentFVetoRecords` /
 *    `deriveComponentFOperands` derive it, so the assembled document cannot
 *    disagree with the reducer's re-derivation. No f1 series is ever
 *    emitted: the reducer derives it from the realizations (round 5,
 *    SUBSTANTIVE F) and rejects a supplied one.
 *  - Activation (prereg 11, section 8.7 rule 5): per-week counts are
 *    computed by `arms.activationReport` itself - the same predicate pair
 *    the reducer's claim path applies to the concatenated per-season arrays
 *    - so the published `activationWeeks` rows sum to the aggregates
 *    `crossCheckActivationGate` compares, by construction rather than by a
 *    parallel implementation.
 *  - The evidence document (sections 4.6/8.7): rows are emitted at the exact
 *    Cartesian cardinalities `sweepEvidence.deriveEvidence` demands, in the
 *    same coordinate order its `expected*` builders enumerate. The
 *    paired-delta regret/pairwise rows are seeded from the very series
 *    objects components (a) (2025) and (e1) (2024) carry, so the
 *    cross-check compares a number against itself, never against a second
 *    computation of the same estimand.
 *
 * Producer-side determinations this module PINS because the sealed text does
 * not (each is a deferral-batch candidate for the B3 re-cut, recorded here
 * so the choice is visible rather than incidental):
 *
 *  1. The per-week value of an ABSOLUTE descriptive row is the arithmetic
 *     mean of the 24 salt-specific week values, accumulated in
 *     `metrics.SALTS` order. Section 5 pins exactly this within-week
 *     salt-average for the permutation statistic and section 3.3's CRN
 *     doctrine makes the salts replicates of one week; no sealed text
 *     states a different estimator for the descriptive absolute families.
 *  2. `control-naive` is a CONTRAST (spec 4.6.2 says so explicitly): its
 *     per-week value is the salt-paired control-minus-naive delta, in
 *     prereg 6.7's form. `usage-signal` is NOT a contrast (4.6.2 assigns it
 *     the own-weeks rule): its per-week value is the benchmark arm's own
 *     absolute week value, salt-averaged as in (1).
 *  3. The attribution composites (prereg 12.2) are evaluated per salt and
 *     then averaged over the 24 salts in `metrics.SALTS` order - the same
 *     pairing discipline as prereg 6.7, extended to the four-cell
 *     interaction `(u,on) - (u,off) - (0.25,on) + (0.25,off)` evaluated as
 *     `((u,on) - (u,off)) - ((0.25,on) - (0.25,off))` per salt. The
 *     two-term composites reuse `saltPairedDelta` unchanged so their bytes
 *     match the gating contrasts' arithmetic exactly.
 *
 * Everything here fails CLOSED: duplicate or missing coordinates, a partial
 * salt set for a generated week, an endpoint null under some salts but not
 * others, a subgroup error row outside the derived veto domain (or a domain
 * member without one), and a malformed activation record are all throw-class
 * defects of the RECORDS, surfaced by name at assembly time - never
 * smoothed into a smaller domain or a favorable default (round 4 BLOCKER A's
 * lesson, applied at the layer that writes the document instead of the layer
 * that reads it).
 */

const metrics = require('./metrics');
const arms = require('./arms');
const sweepEvaluator = require('./sweepEvaluator');
const sweepEvidence = require('./sweepEvidence');

const { SALTS, EVALUATED_WEEKS, MACRO_POSITIONS } = metrics;
const { METRIC_KEYS, PRIMARY_PROFILE, SENSITIVITY_PROFILES } = sweepEvidence;

/** The two benchmark arms (prereg 7.2). Neither is ever selectable. */
const ARM_NAIVE = 'naive-recency';
const ARM_USAGE_SIGNAL = 'usage-signal';
const BENCHMARK_ARMS = Object.freeze([ARM_NAIVE, ARM_USAGE_SIGNAL]);

const CELL_NAMES = Object.freeze(arms.ALL_CELLS.map((cell) => cell.name));
const ARM_NAMES = Object.freeze([...CELL_NAMES, ...BENCHMARK_ARMS]);
const SEASON_NUMBERS = Object.freeze([2025, 2024]);
/** String forms for evidence rows, in `sweepEvidence.SEASONS` order. */
const SEASON_STRINGS = sweepEvidence.SEASONS;

const ARM_RECORD_KEYS = Object.freeze(['scoringProfile', 'arm', 'season', 'week', 'salt', 'values']);
const SUBGROUP_ERROR_ROW_KEYS = Object.freeze(['cellName', 'season', 'week', 'playerId', 'salt', 'errorOn', 'errorOff']);
const ACTIVATION_RECORD_KEYS = Object.freeze(['cell', 'season', 'week', 'position', 'projections']);
const PERMUTATION_CONTROL_KEYS = Object.freeze(['observations', 'rosterRows', 'rosterWeeks', 'cohortWeeks', 'positionRank', 'nameRankById']);
const PREFLIGHT_KEYS = Object.freeze(['cohortRosterRows', 'controlUsage25Records', 'homeAwayStoredRecords', 'saltSeedRecords', 'matchedOffBaselineRows']);

/**
 * The thirteen (e2) endpoint-season inequalities (prereg 9.7), each mapped to
 * the generation coordinate its weekDeltas contrast is drawn from. The key
 * set is asserted equal to `sweepEvaluator.E2_ENDPOINT_KEYS` at module load,
 * so this table and the evaluator's closed family can never drift apart.
 */
const E2_SOURCE_BY_KEY = Object.freeze({
  coverage: Object.freeze({ endpoint: 'coverage', season: 2025, scoringProfile: PRIMARY_PROFILE }),
  'mae-2025': Object.freeze({ endpoint: 'mae', season: 2025, scoringProfile: PRIMARY_PROFILE }),
  'mae-2024': Object.freeze({ endpoint: 'mae', season: 2024, scoringProfile: PRIMARY_PROFILE }),
  'rmse-2025': Object.freeze({ endpoint: 'rmse', season: 2025, scoringProfile: PRIMARY_PROFILE }),
  'rmse-2024': Object.freeze({ endpoint: 'rmse', season: 2024, scoringProfile: PRIMARY_PROFILE }),
  'rho-2025': Object.freeze({ endpoint: 'rho', season: 2025, scoringProfile: PRIMARY_PROFILE }),
  'rho-2024': Object.freeze({ endpoint: 'rho', season: 2024, scoringProfile: PRIMARY_PROFILE }),
  'wis-2025': Object.freeze({ endpoint: 'wis', season: 2025, scoringProfile: PRIMARY_PROFILE }),
  'wis-2024': Object.freeze({ endpoint: 'wis', season: 2024, scoringProfile: PRIMARY_PROFILE }),
  'standard-regret-2025': Object.freeze({ endpoint: 'regret', season: 2025, scoringProfile: 'standard' }),
  'standard-pairwise-2025': Object.freeze({ endpoint: 'pairwise', season: 2025, scoringProfile: 'standard' }),
  'full-ppr-regret-2025': Object.freeze({ endpoint: 'regret', season: 2025, scoringProfile: 'ppr' }),
  'full-ppr-pairwise-2025': Object.freeze({ endpoint: 'pairwise', season: 2025, scoringProfile: 'ppr' }),
});
{
  const tableKeys = Object.keys(E2_SOURCE_BY_KEY);
  const missing = sweepEvaluator.E2_ENDPOINT_KEYS.filter((key) => !tableKeys.includes(key));
  const extra = tableKeys.filter((key) => !sweepEvaluator.E2_ENDPOINT_KEYS.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`inputsAssembly: E2_SOURCE_BY_KEY drifted from sweepEvaluator.E2_ENDPOINT_KEYS - missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
  }
}

const NONFINITE_MARKER = Object.freeze({ nonfinite: 'NaN' });

function assertClosedKeys(obj, allowed, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`${label}: must be an object`);
  }
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(obj, key));
  const extra = Object.keys(obj).filter((key) => !allowed.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${label}: closed shape violation; missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// The arm-week metric index
// ---------------------------------------------------------------------------

function groupKey(scoringProfile, arm, season, week) {
  return `${scoringProfile}|${arm}|${season}|${week}`;
}

/**
 * Index the raw arm-week metric records and validate the whole set at once.
 *
 * A record exists per `(scoringProfile, arm, season, week, salt)` that the
 * generation actually produced. Absence of a week is expressed by emitting NO
 * record for it under ANY salt - prereg 10.4's "a week with no rows". A week
 * generated under SOME salts only is a malformed universe (a salt changes
 * nothing about which rows a week has, section 3.3), as is an endpoint null
 * under some salts and finite under others - both throw by coordinate.
 */
function indexArmWeekMetrics(records, { label = 'armWeekMetrics' } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`${label}: must be a non-empty array of per-(profile, arm, season, week, salt) metric records`);
  }
  const groups = new Map();
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const recordLabel = `${label}[${index}]`;
    assertClosedKeys(record, ARM_RECORD_KEYS, recordLabel);
    const { scoringProfile, arm, salt } = record;
    const season = Number(record.season);
    const week = Number(record.week);
    if (scoringProfile !== PRIMARY_PROFILE && !SENSITIVITY_PROFILES.includes(scoringProfile)) {
      throw new Error(`${recordLabel}.scoringProfile: ${JSON.stringify(scoringProfile)} is not a sealed profile identifier`);
    }
    if (!ARM_NAMES.includes(arm)) {
      throw new Error(`${recordLabel}.arm: ${JSON.stringify(arm)} is not one of the 8 cells or the 2 benchmark arms`);
    }
    if (!SEASON_NUMBERS.includes(season)) throw new Error(`${recordLabel}.season: must be 2025 or 2024`);
    if (!EVALUATED_WEEKS.includes(week)) throw new Error(`${recordLabel}.week: ${JSON.stringify(record.week)} is outside the evaluated grid`);
    if (!SALTS.includes(salt)) throw new Error(`${recordLabel}.salt: ${JSON.stringify(salt)} is not one of the 24 preregistered salts`);
    if (scoringProfile !== PRIMARY_PROFILE) {
      // Section 8.7 rule 4 / prereg 9.7: the sensitivity profiles exist for
      // the (e2) scoring-profile gates and the rule-4 absolute rows - 8
      // cells, 2025 only. A benchmark or 2024 record under `standard`/`ppr`
      // is a generation the study never defined.
      if (!CELL_NAMES.includes(arm)) {
        throw new Error(`${recordLabel}: benchmark arm ${arm} has no ${scoringProfile} generation - sensitivity profiles cover the 8 cells only`);
      }
      if (season !== 2025) {
        throw new Error(`${recordLabel}: ${scoringProfile} generation is 2025-only (section 8.7 rule 4, prereg 9.7)`);
      }
    }
    assertClosedKeys(record.values, METRIC_KEYS, `${recordLabel}.values`);
    for (const endpoint of METRIC_KEYS) {
      const value = record.values[endpoint];
      if (value !== null && !isFiniteNumber(value)) {
        throw new Error(`${recordLabel}.values.${endpoint}: must be a finite number or null, got ${typeof value === 'number' ? String(value) : JSON.stringify(value)}`);
      }
    }
    const coordinate = `${groupKey(scoringProfile, arm, season, week)}|${salt}`;
    if (seen.has(coordinate)) throw new Error(`${recordLabel}: duplicate coordinate ${coordinate}`);
    seen.add(coordinate);
    const key = groupKey(scoringProfile, arm, season, week);
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(salt, record.values);
  }
  for (const [key, bySalt] of groups.entries()) {
    const absent = SALTS.filter((salt) => !bySalt.has(salt));
    if (absent.length > 0) {
      throw new Error(`${label}: ${key} carries ${bySalt.size} of ${SALTS.length} salts - missing ${absent.join(', ')}. A salt changes nothing about which rows a week has (section 3.3), so a partial salt set is a malformed universe, not a sparse week`);
    }
    for (const endpoint of METRIC_KEYS) {
      const nulls = SALTS.filter((salt) => bySalt.get(salt)[endpoint] === null).length;
      if (nulls !== 0 && nulls !== SALTS.length) {
        throw new Error(`${label}: ${key}.${endpoint} is null under ${nulls} of ${SALTS.length} salts - a week-level metric is defined or undefined for the WEEK, never per salt`);
      }
    }
  }
  return groups;
}

/**
 * `{ [salt]: number }` for one endpoint of one generated arm-week, or null
 * when the group is absent (no rows that week) or the endpoint is uniformly
 * null (the metric was undefined for the week, e.g. a >1-position pairwise
 * drop). Both nulls mean the same downstream thing: the week drops.
 */
function endpointBySalt(groups, { scoringProfile, arm, season, week, endpoint }) {
  const bySalt = groups.get(groupKey(scoringProfile, arm, season, week));
  if (!bySalt) return null;
  if (bySalt.get(SALTS[0])[endpoint] === null) return null;
  return Object.fromEntries(SALTS.map((salt) => [salt, bySalt.get(salt)[endpoint]]));
}

/**
 * The salt-average of one arm-week endpoint, in pinned `SALTS` order
 * (docblock determination 1). Own-layer strict typeof, same doctrine as
 * `bootstrapMean`'s: `indexArmWeekMetrics` makes a non-finite value
 * unreachable through `assembleSweepInputs`, but this function is exported,
 * and without the guard a quoted number would string-concatenate into the
 * accumulator instead of failing.
 */
function saltMean(bySalt, { label = 'saltMean' } = {}) {
  return SALTS.reduce((sum, salt) => {
    const value = bySalt[salt];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      const rendered = typeof value === 'number' ? String(value) : JSON.stringify(value);
      throw new Error(`${label}: salt ${salt} must carry a finite number, got ${rendered}`);
    }
    return sum + value;
  }, 0) / SALTS.length;
}

/**
 * One contrast series in the reducer's `{ [week]: number }` form: prereg
 * 6.7's mean of the 24 same-salt deltas per week, with prereg 10.4's drop
 * expressed by omitting the week's key when either side has no value.
 */
function pairedDeltaSeries(groups, { scoringProfile, candidate, comparator, endpoint, season, label }) {
  const series = {};
  for (const week of EVALUATED_WEEKS) {
    const candidateBySalt = endpointBySalt(groups, { scoringProfile, arm: candidate, season, week, endpoint });
    const comparatorBySalt = endpointBySalt(groups, { scoringProfile, arm: comparator, season, week, endpoint });
    if (!candidateBySalt || !comparatorBySalt) continue;
    series[week] = metrics.saltPairedDelta({
      candidateBySalt, comparatorBySalt, label: `${label} week ${week}`,
    });
  }
  return series;
}

// ---------------------------------------------------------------------------
// Components (a)-(e2)
// ---------------------------------------------------------------------------

function coPrimaryInput(groups, { candidate, comparator, season, label }) {
  return {
    regretWeekDeltas: pairedDeltaSeries(groups, {
      scoringProfile: PRIMARY_PROFILE, candidate, comparator, endpoint: 'regret', season, label: `${label} regret`,
    }),
    pairwiseWeekDeltas: pairedDeltaSeries(groups, {
      scoringProfile: PRIMARY_PROFILE, candidate, comparator, endpoint: 'pairwise', season, label: `${label} pairwise`,
    }),
  };
}

function assembleE2(groups, { cellName }) {
  return {
    endpoints: sweepEvaluator.E2_ENDPOINT_KEYS.map((key) => {
      const source = E2_SOURCE_BY_KEY[key];
      return {
        key,
        weekDeltas: pairedDeltaSeries(groups, {
          scoringProfile: source.scoringProfile,
          candidate: cellName,
          comparator: arms.CONTROL_CELL,
          endpoint: source.endpoint,
          season: source.season,
          label: `${cellName} e2:${key}`,
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Component (f)
// ---------------------------------------------------------------------------

/**
 * The veto domain for one on-cell, derived from the SAME rows and by the SAME
 * membership rule as the reducer's `componentFVetoRecords` (baseline <= 0 in
 * the matched off-cell, intersected with the cohort, NOT season-filtered -
 * sections 6.3/6.4a; the 2025-only scoping belongs to the GATE operands and
 * qualifying weeks alone, prereg 9.8).
 */
function deriveSubgroupDomain({ cohortRosterRows, matchedOffBaselineRows, cellName }) {
  const negativeBaselineKeys = new Set(
    (matchedOffBaselineRows || [])
      .filter((row) => row.cellName === cellName && Number(row.baseline) <= 0)
      .map((row) => `${Number(row.season)}:${Number(row.week)}:${Number(row.playerId)}`)
  );
  return (cohortRosterRows || [])
    .filter((row) => negativeBaselineKeys.has(`${Number(row.season)}:${Number(row.week)}:${Number(row.playerId)}`))
    .map((row) => ({ season: Number(row.season), week: Number(row.week), playerId: Number(row.playerId) }));
}

/**
 * `cells[cell].f` for one on-cell: the complete veto realization set and f2's
 * supplied series, both from one source - the per-(player-week, salt) error
 * pairs - so the two can never disagree about the same evidence.
 *
 * `subgroupErrorRows` must cover the derived domain x the 24 salts EXACTLY:
 * a gap, a duplicate, or a row outside the domain is a hard error (6.4a's "a
 * missing realization is a HARD ERROR", enforced at the layer that writes the
 * document). `errorOn`/`errorOff` are the round2-median errors
 * `projected_median - actual` of the on-cell and its matched off-cell for the
 * SAME salt (section 6.1); `incrementalError = |errorOn| - |errorOff|` (6.4).
 */
function assembleComponentF({ cellName, domain, subgroupErrorRows, label = `${cellName} f` }) {
  const domainKeys = new Set(domain.map((row) => `${row.season}:${row.week}:${row.playerId}`));
  const byCoordinate = new Map();
  for (const [index, row] of (subgroupErrorRows || []).entries()) {
    if (row.cellName !== cellName) continue;
    const rowLabel = `${label}: subgroupErrorRows[${index}]`;
    assertClosedKeys(row, SUBGROUP_ERROR_ROW_KEYS, rowLabel);
    const season = Number(row.season);
    const week = Number(row.week);
    const playerId = Number(row.playerId);
    if (!SALTS.includes(row.salt)) throw new Error(`${rowLabel}.salt: ${JSON.stringify(row.salt)} is not one of the 24 preregistered salts`);
    for (const field of ['errorOn', 'errorOff']) {
      if (!isFiniteNumber(row[field])) {
        throw new Error(`${rowLabel}.${field}: must be a finite number, got ${typeof row[field] === 'number' ? String(row[field]) : JSON.stringify(row[field])}`);
      }
    }
    const playerWeekKey = `${season}:${week}:${playerId}`;
    if (!domainKeys.has(playerWeekKey)) {
      throw new Error(`${rowLabel}: (${playerWeekKey}) lies outside the derived subgroup domain - section 6.4a's domain is exact, so an extra row is a defect, never extra evidence`);
    }
    const coordinate = `${playerWeekKey}:${row.salt}`;
    if (byCoordinate.has(coordinate)) throw new Error(`${rowLabel}: duplicate realization coordinate ${coordinate}`);
    byCoordinate.set(coordinate, { season, week, playerId, salt: row.salt, errorOn: row.errorOn, errorOff: row.errorOff });
  }
  const missing = [];
  for (const member of domain) {
    for (const salt of SALTS) {
      if (!byCoordinate.has(`${member.season}:${member.week}:${member.playerId}:${salt}`)) {
        missing.push(`${member.season}:${member.week}:${member.playerId}:${salt}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`${label}: ${missing.length} of ${domain.length * SALTS.length} veto realizations missing (first: ${missing[0]}) - a missing realization is a HARD ERROR (section 6.4a), never a silently smaller veto domain`);
  }

  // Pinned emission order: (season, week, playerId) ascending, then SALTS
  // order - the document is byte-compared downstream, so iteration order is
  // part of the contract, not a style choice.
  const sortedDomain = [...domain].sort((a, b) => (a.season - b.season) || (a.week - b.week) || (a.playerId - b.playerId));
  const realizations = sortedDomain.flatMap((member) => SALTS.map((salt) => {
    const row = byCoordinate.get(`${member.season}:${member.week}:${member.playerId}:${salt}`);
    return {
      season: row.season, week: row.week, playerId: row.playerId, salt,
      incrementalError: Math.abs(row.errorOn) - Math.abs(row.errorOff),
    };
  }));

  // f2's qualifying weeks are the 2025 subgroup weeks, ascending - the
  // identical set the reducer's deriveComponentFOperands re-derives from the
  // same baseline rows (section 6.1a item 1), so the length check it applies
  // holds by construction.
  const qualifyingWeeks = [...new Set(sortedDomain.filter((m) => m.season === 2025).map((m) => m.week))].sort((a, b) => a - b);
  const weekDeltas = qualifyingWeeks.map((week) => {
    const members = sortedDomain.filter((m) => m.season === 2025 && m.week === week);
    const absBias = (field) => Object.fromEntries(SALTS.map((salt) => [salt,
      Math.abs(members.reduce((sum, m) => sum + byCoordinate.get(`2025:${week}:${m.playerId}:${salt}`)[field], 0) / members.length),
    ]));
    return metrics.saltPairedDelta({
      candidateBySalt: absBias('errorOn'),
      comparatorBySalt: absBias('errorOff'),
      label: `${label} f2 D_w week ${week}`,
    });
  });

  return { f2: { weekDeltas }, veto: { realizations } };
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Per-week activation counts and the per-season projection arrays, from ONE
 * record source. Counts come from `arms.activationReport` itself - the same
 * function the reducer's claim path runs over the concatenated arrays - so
 * `activationWeeks`'s sums equal the claim aggregates by construction.
 *
 * A `(cell, season, week, position)` with no record contributes zero counts
 * and an empty slice of the season array: a season the on-cell genuinely
 * never activated in surfaces as `rate: null` -> `inconclusive` downstream,
 * which is the data-dependent verdict, not an assembly failure.
 */
function assembleActivation({ activationRecords, label = 'activationRecords' }) {
  const onCells = arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => cell.name);
  const byCoordinate = new Map();
  for (const [index, record] of (activationRecords || []).entries()) {
    const recordLabel = `${label}[${index}]`;
    assertClosedKeys(record, ACTIVATION_RECORD_KEYS, recordLabel);
    const season = String(record.season);
    const week = Number(record.week);
    if (!onCells.includes(record.cell)) throw new Error(`${recordLabel}.cell: ${JSON.stringify(record.cell)} is not an "on" cell`);
    if (!SEASON_STRINGS.includes(season)) throw new Error(`${recordLabel}.season: must be 2025 or 2024`);
    if (!EVALUATED_WEEKS.includes(week)) throw new Error(`${recordLabel}.week: ${JSON.stringify(record.week)} is outside the evaluated grid`);
    if (!MACRO_POSITIONS.includes(record.position)) throw new Error(`${recordLabel}.position: ${JSON.stringify(record.position)} is not a macro position`);
    if (!Array.isArray(record.projections)) throw new Error(`${recordLabel}.projections: must be an array of projection records`);
    const coordinate = `${record.cell}:${season}:${week}:${record.position}`;
    if (byCoordinate.has(coordinate)) throw new Error(`${recordLabel}: duplicate coordinate ${coordinate}`);
    byCoordinate.set(coordinate, record.projections);
  }
  const projectionsFor = (cell, season, week, position) => byCoordinate.get(`${cell}:${season}:${week}:${position}`) || [];

  const activationWeeks = onCells.flatMap((cell) => SEASON_STRINGS.flatMap((season) => EVALUATED_WEEKS.flatMap((week) => {
    const report = arms.activationReport({
      projectionsByPosition: Object.fromEntries(MACRO_POSITIONS.map((position) => [position, projectionsFor(cell, season, week, position)])),
      label: `${cell} ${season} week ${week} activation`,
    });
    return MACRO_POSITIONS.map((position) => ({
      cell, season, scoringProfile: PRIMARY_PROFILE, week, position,
      eligible: report.byPosition[position].eligible,
      activated: report.byPosition[position].activated,
      excludedIneligible: report.byPosition[position].excludedIneligible,
    }));
  })));

  const activationInputByCell = Object.fromEntries(onCells.map((cell) => [cell, {
    projectionsByPositionBySeason: Object.fromEntries(SEASON_STRINGS.map((season) => [season,
      Object.fromEntries(MACRO_POSITIONS.map((position) => [position,
        EVALUATED_WEEKS.flatMap((week) => projectionsFor(cell, season, week, position)),
      ])),
    ])),
  }]));

  return { activationWeeks, activationInputByCell };
}

// ---------------------------------------------------------------------------
// The evidence document
// ---------------------------------------------------------------------------

/** A finite value, or the explicit nonfinite marker a dropped/undefined week publishes. */
function valueOrMarker(value) {
  return value === null || value === undefined ? { ...NONFINITE_MARKER } : value;
}

/** Absolute per-week value of one arm-week endpoint (docblock determination 1), or the marker. */
function absoluteValue(groups, coordinates) {
  const bySalt = endpointBySalt(groups, coordinates);
  return bySalt ? saltMean(bySalt) : { ...NONFINITE_MARKER };
}

/**
 * The prereg 12.2 attribution composites for one `(u, on)` cell, per week:
 * evaluated per salt over the entering cells, then salt-averaged (docblock
 * determination 3). The two-term main effects reuse `saltPairedDelta`
 * byte-for-byte; the four-cell interaction is evaluated as
 * `((u,on) - (u,off)) - ((0.25,on) - (0.25,off))` per salt. A week missing
 * in ANY entering cell drops the composite for that week (4.6.2: "the
 * candidate and every comparator" is every cell entering the composite).
 */
function attributionValue(groups, { estimand, cellMeta, endpoint, season, week, label }) {
  const armFor = (blendWeight, homeAway) => arms.cellName({ blendWeight, homeAway });
  const sides = {
    'usage-main': [armFor(cellMeta.blendWeight, 'off'), armFor(arms.CONTROL_BLEND_WEIGHT, 'off')],
    'home-away-main': [armFor(arms.CONTROL_BLEND_WEIGHT, 'on'), armFor(arms.CONTROL_BLEND_WEIGHT, 'off')],
    interaction: [
      armFor(cellMeta.blendWeight, 'on'), armFor(cellMeta.blendWeight, 'off'),
      armFor(arms.CONTROL_BLEND_WEIGHT, 'on'), armFor(arms.CONTROL_BLEND_WEIGHT, 'off'),
    ],
  }[estimand];
  const bySaltSides = sides.map((arm) => endpointBySalt(groups, {
    scoringProfile: PRIMARY_PROFILE, arm, season, week, endpoint,
  }));
  if (bySaltSides.some((side) => !side)) return { ...NONFINITE_MARKER };
  if (estimand === 'interaction') {
    const [uOn, uOff, controlOn, controlOff] = bySaltSides;
    return SALTS.reduce((sum, salt) => sum + ((uOn[salt] - uOff[salt]) - (controlOn[salt] - controlOff[salt])), 0) / SALTS.length;
  }
  const [candidateBySalt, comparatorBySalt] = bySaltSides;
  return metrics.saltPairedDelta({
    candidateBySalt, comparatorBySalt, label: `${label} week ${week}`,
  });
}

function assembleEvidence(groups, { componentSeriesByCell, activationWeeks }) {
  const pairedDeltaCache = new Map();
  const pairedDeltaFor = (cell, season, endpoint) => {
    // The regret/pairwise paired deltas ARE the gating series - the same
    // objects components (a)/(e1) carry - so crossCheckClaimInputs compares
    // each number against itself. The five remaining endpoints are contrasts
    // of their own, computed once per coordinate here.
    if (endpoint === 'regret' || endpoint === 'pairwise') {
      const component = season === 2025 ? 'a' : 'e1';
      return componentSeriesByCell[cell][component][endpoint === 'regret' ? 'regretWeekDeltas' : 'pairwiseWeekDeltas'];
    }
    const key = `${cell}:${season}:${endpoint}`;
    if (!pairedDeltaCache.has(key)) {
      pairedDeltaCache.set(key, pairedDeltaSeries(groups, {
        scoringProfile: PRIMARY_PROFILE, candidate: cell, comparator: arms.CONTROL_CELL, endpoint, season,
        label: `evidence paired ${cell} ${season} ${endpoint}`,
      }));
    }
    return pairedDeltaCache.get(key);
  };

  const metricWeeks = SEASON_STRINGS.flatMap((seasonString) => {
    const season = Number(seasonString);
    return CELL_NAMES.flatMap((cell) => ['absolute', 'paired-delta'].flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map((week) => ({
      season: seasonString, scoringProfile: PRIMARY_PROFILE, cell, endpoint, estimand, week,
      value: estimand === 'absolute'
        ? absoluteValue(groups, { scoringProfile: PRIMARY_PROFILE, arm: cell, season, week, endpoint })
        : valueOrMarker(pairedDeltaFor(cell, season, endpoint)[week]),
    })))));
  });

  const movingBlockWeeks = SEASON_STRINGS.flatMap((seasonString) => {
    const season = Number(seasonString);
    return CELL_NAMES.flatMap((cell) => metrics.MOVING_BLOCK_LENGTHS.flatMap((blockLength) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map((week) => ({
      season: seasonString, scoringProfile: PRIMARY_PROFILE, cell, endpoint, estimand: 'absolute',
      sensitivity: `moving-block-${blockLength}`, week,
      // Prereg 10.5's sensitivity re-resamples the SAME absolute week values
      // under its own block construction (reducer-side); the rows carry the
      // identical per-week values under the sensitivity tag.
      value: absoluteValue(groups, { scoringProfile: PRIMARY_PROFILE, arm: cell, season, week, endpoint }),
    })))));
  });

  const attributionWeeks = SEASON_STRINGS.flatMap((seasonString) => {
    const season = Number(seasonString);
    return arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on' && cell.blendWeight !== arms.CONTROL_BLEND_WEIGHT)
      .flatMap((cellMeta) => ['usage-main', 'home-away-main', 'interaction'].flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map((week) => ({
        season: seasonString, scoringProfile: PRIMARY_PROFILE, cell: cellMeta.name, endpoint, estimand, week,
        value: attributionValue(groups, {
          estimand, cellMeta, endpoint, season, week,
          label: `attribution ${cellMeta.name} ${seasonString} ${endpoint} ${estimand}`,
        }),
      })))));
  });

  const diagnosticCache = new Map();
  const controlNaiveFor = (season, endpoint) => {
    const key = `${season}:${endpoint}`;
    if (!diagnosticCache.has(key)) {
      diagnosticCache.set(key, pairedDeltaSeries(groups, {
        scoringProfile: PRIMARY_PROFILE, candidate: arms.CONTROL_CELL, comparator: ARM_NAIVE, endpoint, season,
        label: `diagnostic control-naive ${season} ${endpoint}`,
      }));
    }
    return diagnosticCache.get(key);
  };
  const diagnosticWeeks = SEASON_STRINGS.flatMap((seasonString) => {
    const season = Number(seasonString);
    return ['control-naive', 'usage-signal'].flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map((week) => ({
      season: seasonString, scoringProfile: PRIMARY_PROFILE, endpoint, estimand, week,
      // Docblock determination 2: control-naive is a CONTRAST (4.6.2);
      // usage-signal takes the own-weeks rule as an absolute value.
      value: estimand === 'control-naive'
        ? valueOrMarker(controlNaiveFor(season, endpoint)[week])
        : absoluteValue(groups, { scoringProfile: PRIMARY_PROFILE, arm: ARM_USAGE_SIGNAL, season, week, endpoint }),
    }))));
  });

  const sensitivityWeeks = SENSITIVITY_PROFILES.flatMap((scoringProfile) => CELL_NAMES.flatMap((cell) => sweepEvidence.SENSITIVITY_ENDPOINTS.flatMap((endpoint) => EVALUATED_WEEKS.map((week) => ({
    season: '2025', scoringProfile, cell, endpoint, estimand: 'absolute', week,
    value: absoluteValue(groups, { scoringProfile, arm: cell, season: 2025, week, endpoint }),
  })))));

  return { metricWeeks, movingBlockWeeks, attributionWeeks, diagnosticWeeks, activationWeeks, sensitivityWeeks };
}

// ---------------------------------------------------------------------------
// The permutation-control document
// ---------------------------------------------------------------------------

/**
 * Canonicalize the raw permutation-control artifacts: the observation rows'
 * emission order is LOAD-BEARING (salt -> week -> position -> playerId,
 * strictly ascending - `permutationControl.js` rejects out-of-order input),
 * and the roster rows are sorted the same way minus the salt coordinate so
 * the document's bytes never depend on generation-loop order. Everything
 * else passes through; deep validation is the reducer's preflight's job.
 */
function canonicalizePermutationControl(permutationControl, { label = 'permutationControl' } = {}) {
  assertClosedKeys(permutationControl, PERMUTATION_CONTROL_KEYS, label);
  for (const key of ['observations', 'rosterRows']) {
    if (!Array.isArray(permutationControl[key])) throw new Error(`${label}.${key}: must be an array`);
  }
  const coordinateIndex = (row) => (SALTS.indexOf(row.salt) * EVALUATED_WEEKS.length + EVALUATED_WEEKS.indexOf(Number(row.week))) * MACRO_POSITIONS.length
    + MACRO_POSITIONS.indexOf(row.position);
  const observations = [...permutationControl.observations].sort((a, b) => (coordinateIndex(a) - coordinateIndex(b)) || (Number(a.playerId) - Number(b.playerId)));
  const rosterRows = [...permutationControl.rosterRows].sort((a, b) => (EVALUATED_WEEKS.indexOf(Number(a.week)) - EVALUATED_WEEKS.indexOf(Number(b.week)))
    || (MACRO_POSITIONS.indexOf(a.position) - MACRO_POSITIONS.indexOf(b.position))
    || (Number(a.playerId) - Number(b.playerId)));
  return { ...permutationControl, observations, rosterRows };
}

// ---------------------------------------------------------------------------
// The whole document
// ---------------------------------------------------------------------------

/**
 * Assemble the complete `--inputs` document from raw generation records.
 * Pure and deterministic: the same records produce the same document,
 * byte-for-byte under `canonicalJson`.
 */
function assembleSweepInputs({
  studyId,
  canariesPassed,
  orderingDisagreement,
  deployedPolicyDisagreement,
  armWeekMetrics,
  subgroupErrorRows,
  activationRecords,
  orderingSensitivityByCell,
  preflight,
  permutationControl,
}) {
  if (typeof studyId !== 'string' || studyId.length === 0) throw new Error('assembleSweepInputs: studyId must be a non-empty string');
  for (const [name, value] of [['canariesPassed', canariesPassed], ['orderingDisagreement', orderingDisagreement], ['deployedPolicyDisagreement', deployedPolicyDisagreement]]) {
    if (typeof value !== 'boolean') throw new Error(`assembleSweepInputs: ${name} must be a boolean`);
  }
  assertClosedKeys(preflight, PREFLIGHT_KEYS, 'assembleSweepInputs: preflight');

  const groups = indexArmWeekMetrics(armWeekMetrics);

  // Ordering sensitivity: exactly the 7 candidate cells (prereg 5.2/16; the
  // control receives no verdict to contradict, row 26 ruling).
  const candidateNames = arms.SELECTION_FAMILY.map((cell) => cell.name);
  assertClosedKeys(orderingSensitivityByCell, candidateNames, 'assembleSweepInputs: orderingSensitivityByCell');
  for (const name of candidateNames) {
    const sensitivity = orderingSensitivityByCell[name];
    if (!sensitivity || typeof sensitivity !== 'object' || typeof sensitivity.contradicted !== 'boolean') {
      throw new Error(`assembleSweepInputs: orderingSensitivityByCell.${name} must carry a boolean 'contradicted'`);
    }
  }

  const { activationWeeks, activationInputByCell } = assembleActivation({ activationRecords });

  const componentSeriesByCell = {};
  const cells = {};
  for (const cellMeta of arms.ALL_CELLS) {
    const isOnCell = cellMeta.homeAway === 'on';
    const usageDiffersFromControl = cellMeta.blendWeight !== arms.CONTROL_BLEND_WEIGHT;
    const isControlCell = cellMeta.name === arms.CONTROL_CELL;
    const matchedOffCell = arms.cellName({ blendWeight: cellMeta.blendWeight, homeAway: 'off' });
    const sameSideUsage25 = arms.cellName({ blendWeight: arms.CONTROL_BLEND_WEIGHT, homeAway: cellMeta.homeAway });

    const a = coPrimaryInput(groups, { candidate: cellMeta.name, comparator: arms.CONTROL_CELL, season: 2025, label: `${cellMeta.name} a` });
    const e1 = coPrimaryInput(groups, { candidate: cellMeta.name, comparator: arms.CONTROL_CELL, season: 2024, label: `${cellMeta.name} e1` });
    componentSeriesByCell[cellMeta.name] = { a, e1 };

    const f = isOnCell
      ? assembleComponentF({
        cellName: cellMeta.name,
        domain: deriveSubgroupDomain({
          cohortRosterRows: preflight.cohortRosterRows,
          matchedOffBaselineRows: preflight.matchedOffBaselineRows,
          cellName: cellMeta.name,
        }),
        subgroupErrorRows,
      })
      : null;

    cells[cellMeta.name] = {
      a,
      b: isOnCell
        ? coPrimaryInput(groups, { candidate: cellMeta.name, comparator: matchedOffCell, season: 2025, label: `${cellMeta.name} b` })
        : null,
      c: usageDiffersFromControl
        ? coPrimaryInput(groups, { candidate: cellMeta.name, comparator: sameSideUsage25, season: 2025, label: `${cellMeta.name} c` })
        : null,
      d: coPrimaryInput(groups, { candidate: cellMeta.name, comparator: ARM_NAIVE, season: 2025, label: `${cellMeta.name} d` }),
      e1,
      e2: assembleE2(groups, { cellName: cellMeta.name }),
      f,
      activation: isOnCell ? activationInputByCell[cellMeta.name] : null,
      orderingSensitivity: isControlCell ? null : {
        contradicted: orderingSensitivityByCell[cellMeta.name].contradicted,
        detail: orderingSensitivityByCell[cellMeta.name].detail === undefined ? null : orderingSensitivityByCell[cellMeta.name].detail,
      },
    };
  }

  return {
    studyId,
    canariesPassed,
    preflight,
    permutationControl: canonicalizePermutationControl(permutationControl),
    orderingDisagreement,
    deployedPolicyDisagreement,
    cells,
    evidence: assembleEvidence(groups, { componentSeriesByCell, activationWeeks }),
  };
}

module.exports = {
  ARM_NAIVE,
  ARM_USAGE_SIGNAL,
  BENCHMARK_ARMS,
  E2_SOURCE_BY_KEY,
  indexArmWeekMetrics,
  endpointBySalt,
  saltMean,
  pairedDeltaSeries,
  deriveSubgroupDomain,
  assembleComponentF,
  assembleActivation,
  assembleEvidence,
  canonicalizePermutationControl,
  assembleSweepInputs,
};
