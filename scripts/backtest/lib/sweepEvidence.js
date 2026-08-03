'use strict';

/**
 * Gate 2's descriptive-evidence boundary.  Inputs are canonical synthetic
 * weekly observations, never caller-computed estimates or intervals.  This
 * module derives every published point/interval/aggregate from those rows.
 */

const { ALL_CELLS } = require('./arms');
const { MACRO_POSITIONS, EVALUATED_WEEKS, MOVING_BLOCK_LENGTHS, PERMUTATION_DRAWS, PERMUTATION_SEED, movingBlockBootstrap } = require('./metrics');

const METRIC_KEYS = Object.freeze(['regret', 'pairwise', 'mae', 'rmse', 'rho', 'wis', 'coverage']);
const SEASONS = Object.freeze(['2025', '2024']);
const SCORING_PROFILES = Object.freeze(['standard']);
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
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
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
  return CELL_NAMES.flatMap((cell) => ESTIMANDS.flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season: '2025', scoringProfile: 'standard', cell, endpoint, estimand, week })
  ))));
}

function expectedMovingWeeks() {
  return CELL_NAMES.flatMap((cell) => MOVING_BLOCK_LENGTHS.flatMap((blockLength) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season: '2025', scoringProfile: 'standard', cell, endpoint, estimand: 'absolute', sensitivity: `moving-block-${blockLength}`, week })
  ))));
}

function expectedAttributionWeeks() {
  return ATTRIBUTION_CELL_NAMES.flatMap((cell) => ATTRIBUTION_ESTIMANDS.flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season: '2025', scoringProfile: 'standard', cell, endpoint, estimand, week })
  ))));
}

function expectedDiagnosticWeeks() {
  return DIAGNOSTIC_ESTIMANDS.flatMap((estimand) => METRIC_KEYS.flatMap((endpoint) => EVALUATED_WEEKS.map(
    (week) => ({ season: '2025', scoringProfile: 'standard', endpoint, estimand, week })
  )));
}

function expectedActivationWeeks() {
  return ON_CELL_NAMES.flatMap((cell) => SEASONS.flatMap((season) => SCORING_PROFILES.flatMap((scoringProfile) => EVALUATED_WEEKS.flatMap((week) => MACRO_POSITIONS.map((position) => ({ cell, season, scoringProfile, week, position }))))));
}

function normalizeMetricRow(row, label, moving = false) {
  closed(row, moving
    ? ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'sensitivity', 'week', 'value']
    : ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week', 'value'], label);
  if (String(row.season) !== '2025' || row.scoringProfile !== 'standard' || !CELL_NAMES.includes(row.cell)
    || !METRIC_KEYS.includes(row.endpoint) || !ESTIMANDS.includes(row.estimand) || !EVALUATED_WEEKS.includes(row.week)) {
    throw new Error(`${label}: invalid season/profile/cell/endpoint/estimand/week coordinate`);
  }
  if (moving && (!MOVING_BLOCK_LENGTHS.some((length) => row.sensitivity === `moving-block-${length}`) || row.estimand !== 'absolute')) {
    throw new Error(`${label}: invalid moving-block sensitivity coordinate`);
  }
  return { ...row, season: String(row.season), value: encodeNumber(row.value) };
}

function normalizeAttributionRow(row, label) {
  closed(row, ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week', 'value'], label);
  if (String(row.season) !== '2025' || row.scoringProfile !== 'standard' || !ATTRIBUTION_CELL_NAMES.includes(row.cell)
    || !METRIC_KEYS.includes(row.endpoint) || !ATTRIBUTION_ESTIMANDS.includes(row.estimand) || !EVALUATED_WEEKS.includes(row.week)) throw new Error(`${label}: invalid attribution coordinate`);
  return { ...row, season: String(row.season), value: encodeNumber(row.value) };
}

function normalizeDiagnosticRow(row, label) {
  closed(row, ['season', 'scoringProfile', 'endpoint', 'estimand', 'week', 'value'], label);
  if (String(row.season) !== '2025' || row.scoringProfile !== 'standard' || !METRIC_KEYS.includes(row.endpoint)
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

function summarizeWeeks(rows, { key, label }) {
  const weeks = rows.map((row) => ({ week: row.week, value: row.value }));
  const values = weeks.map((row) => row.value);
  if (!values.every(finite)) {
    const marker = values.find((value) => !finite(value));
    return { key, status: 'unevaluable', point: marker, lower: marker, upper: marker, weeks, reason: `${label}: nonfinite weekly evidence` };
  }
  const point = mean(values);
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - point) ** 2, 0) / (values.length - 1) : 0;
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return { key, status: 'estimated', point, lower: point - margin, upper: point + margin, weeks, reason: null };
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
  const grouped = group(rows, ['cell', 'estimand', 'endpoint']);
  return CELL_NAMES.map((cell) => ({
    season: '2025', scoringProfile: 'standard', cell,
    absoluteMetrics: METRIC_KEYS.map((key) => summarizeWeeks(grouped.get(`${cell}:absolute:${key}`), { key, label: `absolute ${cell}/${key}` })),
    pairedDeltas: METRIC_KEYS.map((key) => summarizeWeeks(grouped.get(`${cell}:paired-delta:${key}`), { key, label: `paired ${cell}/${key}` })),
  }));
}

function deriveMovingBlock(rows) {
  const grouped = group(rows, ['cell', 'endpoint', 'sensitivity']);
  return CELL_NAMES.flatMap((cell) => METRIC_KEYS.flatMap((key) => MOVING_BLOCK_LENGTHS.map((blockLength) => {
    const summary = summarizeWeeks(grouped.get(`${cell}:${key}:moving-block-${blockLength}`), { key, label: `moving ${cell}/${key}/${blockLength}` });
    const moving = summary.status === 'estimated'
      ? movingBlockBootstrap({ weekValues: summary.weeks.map((week) => week.value), blockLength }) : null;
    return { season: '2025', scoringProfile: 'standard', cell, endpoint: key, estimand: 'absolute', sensitivity: `moving-block-${blockLength}`, blockLength, point: moving ? moving.point : summary.point, lower: moving ? moving.lower : summary.lower, upper: moving ? moving.upper : summary.upper, weeks: summary.weeks, status: summary.status, reason: summary.reason };
  })));
}

function deriveAttribution(rows) {
  const grouped = group(rows, ['cell', 'endpoint', 'estimand']);
  return ATTRIBUTION_CELL_NAMES.flatMap((cell) => METRIC_KEYS.map((key) => ({
    season: '2025', scoringProfile: 'standard', cell, endpoint: key,
    usageMain: summarizeWeeks(grouped.get(`${cell}:${key}:usage-main`), { key, label: `usage ${cell}/${key}` }),
    homeAwayMain: summarizeWeeks(grouped.get(`${cell}:${key}:home-away-main`), { key, label: `homeAway ${cell}/${key}` }),
    interaction: summarizeWeeks(grouped.get(`${cell}:${key}:interaction`), { key, label: `interaction ${cell}/${key}` }),
  })));
}

function deriveDiagnostics(rows, permutation) {
  const grouped = group(rows, ['endpoint', 'estimand']);
  const metricsFor = (estimand) => METRIC_KEYS.map((key) => summarizeWeeks(grouped.get(`${key}:${estimand}`), { key, label: `${estimand}/${key}` }));
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
  closed(evidence, ['metricWeeks', 'movingBlockWeeks', 'attributionWeeks', 'diagnosticWeeks', 'activationWeeks'], 'evidence');
  validatePermutation(permutation);
  const metricWeeks = exactRows(evidence.metricWeeks.map((row, index) => normalizeMetricRow(row, `evidence.metricWeeks[${index}]`)), expectedMetricWeeks(), ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week'], 'evidence.metricWeeks');
  const movingBlockWeeks = exactRows(evidence.movingBlockWeeks.map((row, index) => normalizeMetricRow(row, `evidence.movingBlockWeeks[${index}]`, true)), expectedMovingWeeks(), ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'sensitivity', 'week'], 'evidence.movingBlockWeeks');
  const attributionWeeks = exactRows(evidence.attributionWeeks.map((row, index) => normalizeAttributionRow(row, `evidence.attributionWeeks[${index}]`)), expectedAttributionWeeks(), ['season', 'scoringProfile', 'cell', 'endpoint', 'estimand', 'week'], 'evidence.attributionWeeks');
  const diagnosticWeeks = exactRows(evidence.diagnosticWeeks.map((row, index) => normalizeDiagnosticRow(row, `evidence.diagnosticWeeks[${index}]`)), expectedDiagnosticWeeks(), ['season', 'scoringProfile', 'endpoint', 'estimand', 'week'], 'evidence.diagnosticWeeks');
  const activationWeeks = exactRows(evidence.activationWeeks.map((row, index) => normalizeActivationRow(row, `evidence.activationWeeks[${index}]`)), expectedActivationWeeks(), ['cell', 'season', 'scoringProfile', 'week', 'position'], 'evidence.activationWeeks');
  const activation = deriveActivation(activationWeeks);
  return {
    cells: deriveMetricMatrix(metricWeeks),
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
      const aggregate = evidence.activationAggregates.find((row) => row.cell === cell && row.season === season && row.scoringProfile === 'standard').positions[position];
      const claim = activation.bySeason[season].byPosition[position];
      if (!claim || aggregate.eligible !== claim.eligible || aggregate.activated !== claim.activated || aggregate.excludedIneligible !== claim.excludedIneligible || aggregate.rate !== claim.rate) {
        throw new Error(`evidence activation: aggregate does not match activation gate for ${cell}/${season}/${position}`);
      }
    }
  }
}

function crossCheckClaimInputs(cellInputs, evidence) {
  for (const cell of CELL_NAMES) {
    const source = cellInputs[cell] && cellInputs[cell].a;
    const published = evidence.cells.find((row) => row.cell === cell);
    if (!source || !published) throw new Error(`evidence claims: missing component-(a) input or published row for ${cell}`);
    for (const [endpoint, inputKey] of [['regret', 'regretWeekDeltas'], ['pairwise', 'pairwiseWeekDeltas']]) {
      const weekly = published.pairedDeltas.find((row) => row.key === endpoint).weeks;
      for (const row of weekly) {
        const sourceValue = source[inputKey][row.week];
        const matchesMissing = sourceValue === undefined && !finite(row.value);
        if (!matchesMissing && (!finite(row.value) || row.value !== sourceValue)) {
          throw new Error(`evidence claims: paired ${cell}/${endpoint}/week-${row.week} does not match component-(a) input`);
        }
      }
    }
  }
}

module.exports = {
  METRIC_KEYS, SEASONS, SCORING_PROFILES, ESTIMANDS, CELL_NAMES, ON_CELL_NAMES, ATTRIBUTION_CELL_NAMES,
  encodeNumber, deriveEvidence, crossCheckActivationGate, crossCheckClaimInputs,
};
