'use strict';

/**
 * Gate 2 descriptive evidence contract. This module is deliberately pure:
 * it validates and canonicalizes already-computed per-week evidence, never
 * generates a candidate projection or reads a snapshot.
 */

const { ALL_CELLS } = require('./arms');
const { MACRO_POSITIONS, EVALUATED_WEEKS, MOVING_BLOCK_LENGTHS, PERMUTATION_DRAWS, PERMUTATION_SEED } = require('./metrics');

const METRIC_KEYS = Object.freeze(['regret', 'pairwise', 'mae', 'rmse', 'rho', 'wis', 'coverage']);
const SEASONS = Object.freeze(['2025', '2024']);
const CELL_NAMES = Object.freeze(ALL_CELLS.map((cell) => cell.name));
const ON_CELL_NAMES = Object.freeze(ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => cell.name));
const ATTRIBUTION_CELL_NAMES = Object.freeze(ALL_CELLS
  .filter((cell) => cell.homeAway === 'on' && cell.blendWeight !== 0.25)
  .map((cell) => cell.name));
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
  throw new Error(`evidence number: must be finite or an explicit nonfinite marker`);
}

function isFiniteEncoded(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeEstimate(row, label) {
  closed(row, ['key', 'status', 'point', 'lower', 'upper', 'weeks', 'reason'], label);
  if (!METRIC_KEYS.includes(row.key)) throw new Error(`${label}.key: unrecognized metric ${row.key}`);
  if (!['estimated', 'unevaluable'].includes(row.status)) throw new Error(`${label}.status: must be estimated or unevaluable`);
  const point = encodeNumber(row.point);
  const lower = encodeNumber(row.lower);
  const upper = encodeNumber(row.upper);
  if (!Array.isArray(row.weeks)) throw new Error(`${label}.weeks: must be an array`);
  const weeks = row.weeks.map((week, index) => {
    closed(week, ['week', 'value'], `${label}.weeks[${index}]`);
    if (!Number.isInteger(week.week) || !EVALUATED_WEEKS.includes(week.week)) throw new Error(`${label}.weeks[${index}].week: must be an evaluated week`);
    return { week: week.week, value: encodeNumber(week.value) };
  }).sort((a, b) => a.week - b.week);
  if (new Set(weeks.map((week) => week.week)).size !== weeks.length) throw new Error(`${label}.weeks: duplicate week`);
  if (row.status === 'estimated' && (![point, lower, upper].every(isFiniteEncoded) || typeof row.reason !== 'object' || row.reason !== null)) {
    throw new Error(`${label}: estimated evidence requires finite point/CI and null reason`);
  }
  if (row.status === 'unevaluable' && (typeof row.reason !== 'string' || row.reason.length === 0)) {
    throw new Error(`${label}: unevaluable evidence requires a reason`);
  }
  return { key: row.key, status: row.status, point, lower, upper, weeks, reason: row.reason };
}

function completeMetricRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label}: must be an array`);
  const normalized = rows.map((row, index) => normalizeEstimate(row, `${label}[${index}]`)).sort((a, b) => METRIC_KEYS.indexOf(a.key) - METRIC_KEYS.indexOf(b.key));
  const keys = normalized.map((row) => row.key);
  if (keys.length !== METRIC_KEYS.length || new Set(keys).size !== keys.length || METRIC_KEYS.some((key) => !keys.includes(key))) {
    throw new Error(`${label}: requires each of the ${METRIC_KEYS.length} metric keys exactly once`);
  }
  return normalized;
}

function normalizeCells(rows) {
  if (!Array.isArray(rows)) throw new Error('evidence.cells: must be an array');
  const normalized = rows.map((row, index) => {
    closed(row, ['cell', 'absoluteMetrics', 'pairedDeltas'], `evidence.cells[${index}]`);
    if (!CELL_NAMES.includes(row.cell)) throw new Error(`evidence.cells[${index}].cell: unrecognized cell`);
    return { cell: row.cell, absoluteMetrics: completeMetricRows(row.absoluteMetrics, `evidence.cells[${index}].absoluteMetrics`), pairedDeltas: completeMetricRows(row.pairedDeltas, `evidence.cells[${index}].pairedDeltas`) };
  }).sort((a, b) => CELL_NAMES.indexOf(a.cell) - CELL_NAMES.indexOf(b.cell));
  if (normalized.length !== CELL_NAMES.length || new Set(normalized.map((row) => row.cell)).size !== normalized.length || CELL_NAMES.some((cell) => !normalized.some((row) => row.cell === cell))) {
    throw new Error('evidence.cells: requires all eight cells exactly once');
  }
  return normalized;
}

function normalizeMovingBlock(rows) {
  if (!Array.isArray(rows)) throw new Error('evidence.movingBlock: must be an array');
  const normalized = rows.map((row, index) => {
    closed(row, ['cell', 'key', 'blockLength', 'point', 'lower', 'upper'], `evidence.movingBlock[${index}]`);
    if (!CELL_NAMES.includes(row.cell) || !METRIC_KEYS.includes(row.key) || !MOVING_BLOCK_LENGTHS.includes(row.blockLength)) throw new Error(`evidence.movingBlock[${index}]: invalid coordinate`);
    return { cell: row.cell, key: row.key, blockLength: row.blockLength, point: encodeNumber(row.point), lower: encodeNumber(row.lower), upper: encodeNumber(row.upper) };
  }).sort((a, b) => CELL_NAMES.indexOf(a.cell) - CELL_NAMES.indexOf(b.cell) || METRIC_KEYS.indexOf(a.key) - METRIC_KEYS.indexOf(b.key) || a.blockLength - b.blockLength);
  const expected = CELL_NAMES.length * METRIC_KEYS.length * MOVING_BLOCK_LENGTHS.length;
  const keys = new Set(normalized.map((row) => `${row.cell}:${row.key}:${row.blockLength}`));
  if (normalized.length !== expected || keys.size !== expected) throw new Error(`evidence.movingBlock: requires ${expected} complete cell x metric x block rows`);
  return normalized;
}

function normalizeAttribution(rows) {
  if (!Array.isArray(rows)) throw new Error('evidence.attribution: must be an array');
  const normalized = rows.map((row, index) => {
    closed(row, ['cell', 'key', 'usageMain', 'homeAwayMain', 'interaction'], `evidence.attribution[${index}]`);
    if (!ATTRIBUTION_CELL_NAMES.includes(row.cell) || !METRIC_KEYS.includes(row.key)) throw new Error(`evidence.attribution[${index}]: invalid coordinate`);
    return { cell: row.cell, key: row.key, usageMain: normalizeEstimate({ key: row.key, ...row.usageMain }, `evidence.attribution[${index}].usageMain`), homeAwayMain: normalizeEstimate({ key: row.key, ...row.homeAwayMain }, `evidence.attribution[${index}].homeAwayMain`), interaction: normalizeEstimate({ key: row.key, ...row.interaction }, `evidence.attribution[${index}].interaction`) };
  }).sort((a, b) => ATTRIBUTION_CELL_NAMES.indexOf(a.cell) - ATTRIBUTION_CELL_NAMES.indexOf(b.cell) || METRIC_KEYS.indexOf(a.key) - METRIC_KEYS.indexOf(b.key));
  const expected = ATTRIBUTION_CELL_NAMES.length * METRIC_KEYS.length;
  if (normalized.length !== expected || new Set(normalized.map((row) => `${row.cell}:${row.key}`)).size !== expected) throw new Error(`evidence.attribution: requires ${expected} descriptive composite rows`);
  return normalized;
}

function normalizeDiagnostics(value) {
  closed(value, ['controlNaive', 'usageSignal', 'permutation'], 'evidence.diagnostics');
  const controlNaive = completeMetricRows(value.controlNaive, 'evidence.diagnostics.controlNaive');
  const usageSignal = completeMetricRows(value.usageSignal, 'evidence.diagnostics.usageSignal');
  closed(value.permutation, ['seed', 'replicates', 'regretStatistic', 'regretPValue', 'pairwiseStatistic', 'pairwisePValue'], 'evidence.diagnostics.permutation');
  if (value.permutation.seed !== PERMUTATION_SEED || value.permutation.replicates !== PERMUTATION_DRAWS) throw new Error('evidence.diagnostics.permutation: must carry the preregistered seed and 10,000 replicates');
  for (const key of ['regretStatistic', 'pairwiseStatistic', 'regretPValue', 'pairwisePValue']) {
    if (typeof value.permutation[key] !== 'number' || !Number.isFinite(value.permutation[key])) throw new Error(`evidence.diagnostics.permutation.${key}: must be finite`);
  }
  return { controlNaive, usageSignal, permutation: { ...value.permutation } };
}

function normalizeActivationProfiles(rows) {
  if (!Array.isArray(rows)) throw new Error('evidence.activationProfiles: must be an array');
  const normalized = rows.map((row, index) => {
    closed(row, ['cell', 'season', 'week', 'positions'], `evidence.activationProfiles[${index}]`);
    if (!ON_CELL_NAMES.includes(row.cell) || !SEASONS.includes(String(row.season)) || !EVALUATED_WEEKS.includes(row.week)) throw new Error(`evidence.activationProfiles[${index}]: invalid coordinate`);
    const positions = {};
    for (const position of MACRO_POSITIONS) {
      closed(row.positions[position], ['eligible', 'activated', 'excludedIneligible', 'rate'], `evidence.activationProfiles[${index}].positions.${position}`);
      positions[position] = { ...row.positions[position] };
    }
    if (Object.keys(row.positions).length !== MACRO_POSITIONS.length) throw new Error(`evidence.activationProfiles[${index}].positions: requires all positions`);
    return { cell: row.cell, season: String(row.season), week: row.week, positions };
  }).sort((a, b) => ON_CELL_NAMES.indexOf(a.cell) - ON_CELL_NAMES.indexOf(b.cell) || SEASONS.indexOf(a.season) - SEASONS.indexOf(b.season) || a.week - b.week);
  const expected = ON_CELL_NAMES.length * SEASONS.length * EVALUATED_WEEKS.length;
  if (normalized.length !== expected || new Set(normalized.map((row) => `${row.cell}:${row.season}:${row.week}`)).size !== expected) throw new Error(`evidence.activationProfiles: requires ${expected} complete on-cell x season x week rows`);
  return normalized;
}

function normalizeActivationAggregates(rows) {
  if (!Array.isArray(rows)) throw new Error('evidence.activationAggregates: must be an array');
  const normalized = rows.map((row, index) => {
    closed(row, ['cell', 'season', 'positions'], `evidence.activationAggregates[${index}]`);
    if (!ON_CELL_NAMES.includes(row.cell) || !SEASONS.includes(String(row.season))) throw new Error(`evidence.activationAggregates[${index}]: invalid coordinate`);
    const positions = {};
    for (const position of MACRO_POSITIONS) {
      closed(row.positions[position], ['eligible', 'activated', 'excludedIneligible', 'rate'], `evidence.activationAggregates[${index}].positions.${position}`);
      positions[position] = { ...row.positions[position] };
    }
    if (Object.keys(row.positions).length !== MACRO_POSITIONS.length) throw new Error(`evidence.activationAggregates[${index}].positions: requires all positions`);
    return { cell: row.cell, season: String(row.season), positions };
  }).sort((a, b) => ON_CELL_NAMES.indexOf(a.cell) - ON_CELL_NAMES.indexOf(b.cell) || SEASONS.indexOf(a.season) - SEASONS.indexOf(b.season));
  const expected = ON_CELL_NAMES.length * SEASONS.length;
  if (normalized.length !== expected || new Set(normalized.map((row) => `${row.cell}:${row.season}`)).size !== expected) throw new Error(`evidence.activationAggregates: requires ${expected} complete on-cell x season rows`);
  return normalized;
}

function validateEvidence(evidence) {
  closed(evidence, ['cells', 'movingBlock', 'attribution', 'diagnostics', 'activationProfiles', 'activationAggregates'], 'evidence');
  return { cells: normalizeCells(evidence.cells), movingBlock: normalizeMovingBlock(evidence.movingBlock), attribution: normalizeAttribution(evidence.attribution), diagnostics: normalizeDiagnostics(evidence.diagnostics), activationProfiles: normalizeActivationProfiles(evidence.activationProfiles), activationAggregates: normalizeActivationAggregates(evidence.activationAggregates) };
}

module.exports = { METRIC_KEYS, CELL_NAMES, ON_CELL_NAMES, ATTRIBUTION_CELL_NAMES, encodeNumber, validateEvidence };
