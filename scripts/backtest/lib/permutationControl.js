'use strict';

const metrics = require('./metrics');

function key(row) { return `${row.season}:${row.week}:${row.position}`; }

function canonicalRosterRows(rosterRows, label) {
  if (!Array.isArray(rosterRows) || rosterRows.length === 0) throw new Error(`${label}: requires canonical raw roster rows`);
  const cells = {};
  const seen = new Set();
  let previousCoordinate = -1;
  let previousPlayerId = null;
  for (const row of rosterRows) {
    if (!row || row.season !== 2025 || !metrics.EVALUATED_WEEKS.includes(row.week)
      || !metrics.MACRO_POSITIONS.includes(row.position) || !Number.isFinite(row.playerId)) {
      throw new Error(`${label}: invalid raw roster row`);
    }
    const coordinateIndex = metrics.EVALUATED_WEEKS.indexOf(row.week) * metrics.MACRO_POSITIONS.length
      + metrics.MACRO_POSITIONS.indexOf(row.position);
    if (coordinateIndex < previousCoordinate
      || (coordinateIndex === previousCoordinate && row.playerId <= previousPlayerId)) {
      throw new Error(`${label}: roster rows must be in canonical week/position/player order`);
    }
    previousCoordinate = coordinateIndex;
    previousPlayerId = row.playerId;
    const cellKey = key(row);
    const rowKey = `${cellKey}:${row.playerId}`;
    if (seen.has(rowKey)) throw new Error(`${label}: duplicate roster player ${rowKey}`);
    seen.add(rowKey);
    if (!cells[cellKey]) cells[cellKey] = [];
    cells[cellKey].push(row.playerId);
  }
  for (const week of metrics.EVALUATED_WEEKS) for (const position of metrics.MACRO_POSITIONS) {
    const cellKey = `2025:${week}:${position}`;
    if (!cells[cellKey] || cells[cellKey].length === 0) throw new Error(`${label}: missing roster cell ${cellKey}`);
  }
  if (Object.keys(cells).length !== metrics.EVALUATED_WEEKS.length * metrics.MACRO_POSITIONS.length) {
    throw new Error(`${label}: extra roster coordinate`);
  }
  return cells;
}

function canonicalObservations(observations, rosterRows, label = 'permutation control') {
  if (!Array.isArray(observations) || observations.length === 0) throw new Error(`${label}: requires canonical raw control observations`);
  const cells = canonicalRosterRows(rosterRows, label);
  const bySaltCell = new Map();
  let previousCoordinate = -1;
  let previousPlayerId = null;
  for (const row of observations) {
    if (!row || row.season !== 2025 || !metrics.EVALUATED_WEEKS.includes(row.week) || !metrics.SALTS.includes(row.salt)
      || !metrics.MACRO_POSITIONS.includes(row.position) || !Number.isFinite(row.playerId)
      || !Number.isFinite(row.actual) || !Number.isFinite(row.projected)) throw new Error(`${label}: invalid raw observation`);
    const coordinateIndex = metrics.SALTS.indexOf(row.salt) * metrics.EVALUATED_WEEKS.length * metrics.MACRO_POSITIONS.length
      + metrics.EVALUATED_WEEKS.indexOf(row.week) * metrics.MACRO_POSITIONS.length
      + metrics.MACRO_POSITIONS.indexOf(row.position);
    if (coordinateIndex < previousCoordinate
      || (coordinateIndex === previousCoordinate && row.playerId <= previousPlayerId)) {
      throw new Error(`${label}: observations must be in canonical salt/week/position/player order`);
    }
    previousCoordinate = coordinateIndex;
    previousPlayerId = row.playerId;
    const coordinate = `${row.salt}:${key(row)}`;
    if (!bySaltCell.has(coordinate)) bySaltCell.set(coordinate, []);
    bySaltCell.get(coordinate).push(row);
  }
  for (const week of metrics.EVALUATED_WEEKS) for (const position of metrics.MACRO_POSITIONS) {
    const cellKey = `2025:${week}:${position}`;
    for (const salt of metrics.SALTS) {
      const rows = bySaltCell.get(`${salt}:${cellKey}`);
      if (!rows || rows.length === 0) throw new Error(`${label}: missing salt/cell ${salt}:${cellKey}`);
      const ids = rows.map((row) => row.playerId);
      if (new Set(ids).size !== ids.length) throw new Error(`${label}: duplicate player in ${salt}:${cellKey}`);
      if (cells[cellKey].length !== ids.length || cells[cellKey].some((id, index) => id !== ids[index])) {
        throw new Error(`${label}: salt player domain differs from the raw roster at ${salt}:${cellKey}`);
      }
    }
  }
  const expected = metrics.SALTS.length * metrics.EVALUATED_WEEKS.length * metrics.MACRO_POSITIONS.length;
  if (bySaltCell.size !== expected) throw new Error(`${label}: extra salt/cell coordinate`);
  return { bySaltCell, cells };
}

/**
 * One sealed RNG stream is consumed in this exact week/position order for
 * every replicate.  The resulting order is shared by all salts and passed to
 * both endpoint calculations; neither endpoint may draw its own randomness.
 */
function nextOrders(cells, rng) {
  const orders = {};
  for (const week of metrics.EVALUATED_WEEKS) for (const position of metrics.MACRO_POSITIONS) {
    const cellKey = `2025:${week}:${position}`;
    const order = Array.from({ length: cells[cellKey].length }, (unused, index) => index);
    for (let index = order.length - 1; index > 0; index--) {
      const other = Math.floor(rng() * (index + 1));
      [order[index], order[other]] = [order[other], order[index]];
    }
    orders[cellKey] = order;
  }
  return orders;
}

function scoreWeek(bySaltCell, orders, week, label) {
  const perSalt = metrics.SALTS.map((salt) => {
    const rowsByPosition = {};
    const regrets = [];
    for (const position of metrics.MACRO_POSITIONS) {
      const cellKey = `2025:${week}:${position}`;
      const rows = bySaltCell.get(`${salt}:${cellKey}`);
      const permuted = orders
        ? metrics.gatherPermutedProjections({ playerIds: rows.map((r) => r.playerId), projections: rows.map((r) => r.projected), order: orders[cellKey], label })
        : rows.map((r) => ({ playerId: r.playerId, projected: r.projected }));
      const assigned = rows.map((row, i) => ({ actual: row.actual, projected: permuted[i].projected }));
      rowsByPosition[position] = assigned;
      regrets.push(...assigned.map((row) => Math.abs(row.projected - row.actual)));
    }
    return { regret: metrics.weekRegret(regrets, { label }), pairwise: metrics.weekPairwise(rowsByPosition, { label }).score };
  });
  return { regret: perSalt.reduce((sum, value) => sum + value.regret, 0) / perSalt.length, pairwise: perSalt.reduce((sum, value) => sum + value.pairwise, 0) / perSalt.length };
}

const resultCache = new Map();

function cloneResult(result) {
  return {
    ...result,
    failures: [...result.failures],
    regret: { ...result.regret },
    pairwise: { ...result.pairwise },
  };
}

function negativeMean(rows, field) {
  const value = -rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
  return value === 0 ? 0 : value;
}

function computePermutationControlFromObservations({ observations, rosterRows, label = 'permutation control' }) {
  const { bySaltCell, cells } = canonicalObservations(observations, rosterRows, label);
  const cacheKey = JSON.stringify({ observations, rosterRows });
  if (resultCache.has(cacheKey)) return cloneResult(resultCache.get(cacheKey));
  const observedWeeks = metrics.EVALUATED_WEEKS.map((week) => scoreWeek(bySaltCell, null, week, `${label}: observed`));
  const observed = { regret: negativeMean(observedWeeks, 'regret'), pairwise: observedWeeks.reduce((sum, row) => sum + row.pairwise, 0) / observedWeeks.length };
  const permuted = { regret: [], pairwise: [] };
  const rng = metrics.makeRng(metrics.PERMUTATION_SEED);
  for (let replicate = 0; replicate < metrics.PERMUTATION_DRAWS; replicate++) {
    const orders = nextOrders(cells, rng);
    const weeks = metrics.EVALUATED_WEEKS.map((week) => scoreWeek(bySaltCell, orders, week, `${label}: replicate ${replicate}`));
    permuted.regret.push(negativeMean(weeks, 'regret'));
    permuted.pairwise.push(weeks.reduce((sum, row) => sum + row.pairwise, 0) / weeks.length);
  }
  const regret = metrics.permutationPValue({ observed: observed.regret, permuted: permuted.regret, label: `${label}: regret` });
  const pairwise = metrics.permutationPValue({ observed: observed.pairwise, permuted: permuted.pairwise, label: `${label}: pairwise` });
  const gate = metrics.assertPermutationControl({ regretP: regret.p, pairwiseP: pairwise.p, label });
  const result = {
    ...gate,
    seed: metrics.PERMUTATION_SEED,
    replicates: metrics.PERMUTATION_DRAWS,
    regret: { observed: observed.regret, ...regret },
    pairwise: { observed: observed.pairwise, ...pairwise },
  };
  if (resultCache.size >= 8) resultCache.delete(resultCache.keys().next().value);
  resultCache.set(cacheKey, result);
  return cloneResult(result);
}

module.exports = { canonicalRosterRows, canonicalObservations, nextOrders, computePermutationControlFromObservations };
