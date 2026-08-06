'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');
const evidence = require('../../scripts/backtest/lib/sweepEvidence');

const permutation = {
  seed: metrics.PERMUTATION_SEED, replicates: metrics.PERMUTATION_DRAWS,
  regret: { observed: 0, p: 1 / 10001 }, pairwise: { observed: 1, p: 1 / 10001 },
};

const P = evidence.PRIMARY_PROFILE;

function fixture() {
  const weekly = (point) => metrics.EVALUATED_WEEKS.map((week) => ({ week, value: point + (week - 2) * 0.001 }));
  return {
    metricWeeks: evidence.SEASONS.flatMap((season) => arms.ALL_CELLS.flatMap((cell, cellIndex) => ['absolute', 'paired-delta'].flatMap((estimand) => evidence.METRIC_KEYS.flatMap((endpoint, index) => weekly(cellIndex + index / 100).map(({ week, value }) => ({ season, scoringProfile: P, cell: cell.name, endpoint, estimand, week, value })))))),
    movingBlockWeeks: evidence.SEASONS.flatMap((season) => arms.ALL_CELLS.flatMap((cell) => metrics.MOVING_BLOCK_LENGTHS.flatMap((blockLength) => evidence.METRIC_KEYS.flatMap((endpoint) => weekly(0).map(({ week, value }) => ({ season, scoringProfile: P, cell: cell.name, endpoint, estimand: 'absolute', sensitivity: `moving-block-${blockLength}`, week, value })))))),
    attributionWeeks: evidence.SEASONS.flatMap((season) => evidence.ATTRIBUTION_CELL_NAMES.flatMap((cell) => ['usage-main', 'home-away-main', 'interaction'].flatMap((estimand, estimateIndex) => evidence.METRIC_KEYS.flatMap((endpoint) => weekly(estimateIndex / 100).map(({ week, value }) => ({ season, scoringProfile: P, cell, endpoint, estimand, week, value })))))),
    diagnosticWeeks: evidence.SEASONS.flatMap((season) => ['control-naive', 'usage-signal'].flatMap((estimand, estimateIndex) => evidence.METRIC_KEYS.flatMap((endpoint) => weekly(estimateIndex / 10).map(({ week, value }) => ({ season, scoringProfile: P, endpoint, estimand, week, value }))))),
    activationWeeks: evidence.ON_CELL_NAMES.flatMap((cell) => evidence.SEASONS.flatMap((season) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.map((position) => ({ cell, season, scoringProfile: P, week, position, eligible: 1, activated: 1, excludedIneligible: 0 }))))),
    sensitivityWeeks: evidence.SENSITIVITY_SEASONS.flatMap((season) => evidence.SENSITIVITY_PROFILES.flatMap((scoringProfile) => arms.ALL_CELLS.flatMap((cell, cellIndex) => evidence.SENSITIVITY_ENDPOINTS.flatMap((endpoint, index) => weekly(cellIndex + index / 100).map(({ week, value }) => ({ season, scoringProfile, cell: cell.name, endpoint, estimand: 'absolute', week, value })))))),
  };
}

test('evidence derives complete estimates, intervals, sensitivities, composites, diagnostics, and activation aggregates from raw weekly coordinates', () => {
  const result = evidence.deriveEvidence(fixture(), { permutation });
  // Section 4.6.1: the descriptive families carry a SEASON coordinate and
  // publish rows for BOTH 2024 and 2025.
  assert.equal(result.cells.length, 8 * evidence.SEASONS.length);
  assert.deepEqual([...new Set(result.cells.map((row) => row.season))].sort(), ['2024', '2025']);
  // Section 8.7 rules 1-3 and 5: the unqualified families are the formal primary.
  assert.equal(result.cells[0].scoringProfile, 'half_ppr');
  assert.equal(result.cells[0].absoluteMetrics[0].point, 0.008);
  assert.ok(result.cells[0].absoluteMetrics[0].lower < 0.008);
  assert.ok(result.cells[0].absoluteMetrics[0].upper > 0.008);
  assert.equal(result.movingBlock.length, 8 * evidence.METRIC_KEYS.length * 2 * evidence.SEASONS.length);
  assert.equal(result.attribution.length, evidence.ATTRIBUTION_CELL_NAMES.length * evidence.METRIC_KEYS.length * evidence.SEASONS.length);
  assert.equal(result.activationProfiles.length, evidence.ON_CELL_NAMES.length * 2 * 17 * 6);
  assert.equal(result.activationAggregates[0].positions.QB.eligible, 17);
  assert.equal(result.diagnostics.permutation.replicates, 10000);
});

test('section 8.7 rule 4 publishes the prereg 16 sensitivity family as standard and ppr, absolute metrics only, 2025 only', () => {
  const result = evidence.deriveEvidence(fixture(), { permutation });
  // 8 cells x 2 endpoints x 2 profiles, fixed at revision 22.
  assert.equal(result.sensitivity.length, 8 * 2 * 2);
  assert.deepEqual([...new Set(result.sensitivity.map((row) => row.scoringProfile))].sort(), ['ppr', 'standard']);
  assert.deepEqual([...new Set(result.sensitivity.map((row) => row.endpoint))].sort(), ['pairwise', 'regret']);
  // 2025 only: prereg 9.7 evaluates the scoring-profile inequalities on 2025 alone.
  assert.deepEqual([...new Set(result.sensitivity.map((row) => row.season))], ['2025']);
  assert.ok(result.sensitivity.every((row) => row.estimand === 'absolute'));
  // The primary profile never appears in the sensitivity family, and the
  // sensitivity profiles never appear in the primary families.
  assert.ok(result.sensitivity.every((row) => row.scoringProfile !== 'half_ppr'));
  assert.ok(result.cells.every((row) => row.scoringProfile === 'half_ppr'));
  assert.ok(result.attribution.every((row) => row.scoringProfile === 'half_ppr'));
});

test('section 4.6 publishes a percentile cluster bootstrap with mandatory self-description, never a normal approximation', () => {
  const result = evidence.deriveEvidence(fixture(), { permutation });
  const row = result.cells[0].absoluteMetrics[0];
  assert.equal(row.method, 'percentile-cluster-bootstrap');
  assert.equal(row.draws, 100000);
  assert.equal(row.seed, 1499811874);
  assert.equal(row.season, '2025');
  assert.equal(row.scoringProfile, 'half_ppr');
  assert.equal(row.clusters, 17);
  assert.equal(row.status, 'estimated');
  // alpha/7 = 0.0071428571 one-sided in both directions (section 4.6 item 3).
  assert.ok(Math.abs(row.alpha - 0.05 / 7) < 1e-12);
  // Every bound is a mean of observed values, so it stays inside the data's
  // convex hull - which a symmetric 1.96 margin does not guarantee.
  const values = row.weeks.map((week) => week.value);
  assert.ok(row.lower >= Math.min(...values) && row.upper <= Math.max(...values));
});

test('evidence rejects empty, missing, duplicate, extra, and reordered raw coordinates before publication', () => {
  assert.throws(() => evidence.deriveEvidence({ ...fixture(), metricWeeks: [] }, { permutation }), /non-empty complete row set/);
  const missing = fixture();
  missing.metricWeeks.pop();
  assert.throws(() => evidence.deriveEvidence(missing, { permutation }), /incomplete coordinate set; missing 1/);
  const duplicate = fixture();
  duplicate.movingBlockWeeks.push({ ...duplicate.movingBlockWeeks[0] });
  assert.throws(() => evidence.deriveEvidence(duplicate, { permutation }), /duplicate coordinate/);
  const extra = fixture();
  extra.diagnosticWeeks.push({ ...extra.diagnosticWeeks[0], week: 1 });
  assert.throws(() => evidence.deriveEvidence(extra, { permutation }), /invalid diagnostic coordinate/);
  const reordered = fixture();
  reordered.metricWeeks.reverse();
  assert.deepEqual(evidence.deriveEvidence(fixture(), { permutation }), evidence.deriveEvidence(reordered, { permutation }));
});

test('a prereg 16 sensitivity row may not carry the primary profile, a paired delta, or a 2024 season', () => {
  const wrongProfile = fixture();
  wrongProfile.sensitivityWeeks[0].scoringProfile = 'half_ppr';
  assert.throws(() => evidence.deriveEvidence(wrongProfile, { permutation }), /invalid prereg 16 sensitivity coordinate/);
  const wrongSeason = fixture();
  wrongSeason.sensitivityWeeks[0].season = '2024';
  assert.throws(() => evidence.deriveEvidence(wrongSeason, { permutation }), /invalid prereg 16 sensitivity coordinate/);
  // The primary families reject the sensitivity profiles symmetrically.
  const wrongPrimary = fixture();
  wrongPrimary.metricWeeks[0].scoringProfile = 'standard';
  assert.throws(() => evidence.deriveEvidence(wrongPrimary, { permutation }), /invalid season\/profile\/cell\/endpoint\/estimand\/week coordinate/);
});

test('section 4.6.2 drops a sparse week from the whole absolute family but leaves contrasts on their own weeks', () => {
  // metricWeeks[0] is cell 0 / absolute / regret / week 2 in the 2025 block.
  const input = fixture();
  input.metricWeeks[0].value = Infinity;
  const result = evidence.deriveEvidence(input, { permutation });
  const seasonRows = result.cells.filter((row) => row.season === '2025');
  // The union is taken across all eight cells, so week 2 leaves every cell's
  // absolute regret row - not just the one that was sparse.
  for (const cell of seasonRows) {
    const absolute = cell.absoluteMetrics.find((row) => row.key === 'regret');
    assert.equal(absolute.clusters, 16, `${cell.cell} absolute regret should drop week 2`);
    assert.equal(absolute.status, 'estimated');
    assert.ok(!absolute.weeks.some((week) => week.week === 2 && Number.isFinite(week.value) === false && cell.cell !== seasonRows[0].cell));
  }
  // A different endpoint in the same family is untouched: the union is per
  // (season, scoringProfile, endpoint), never pooled.
  assert.equal(seasonRows[0].absoluteMetrics.find((row) => row.key === 'pairwise').clusters, 17);
  // Paired deltas are contrasts and keep prereg 10.4's own-weeks rule.
  assert.equal(seasonRows[0].pairedDeltas.find((row) => row.key === 'regret').clusters, 17);
  // And 2024 is a separate season with its own clusters.
  assert.equal(result.cells.find((row) => row.season === '2024').absoluteMetrics.find((row) => row.key === 'regret').clusters, 17);
});

test('a moving-block series too short to form its block publishes unevaluable instead of throwing', () => {
  // Section 4.6.4 forbids a descriptive row from throwing. `movingBlockBootstrap`
  // rejects n < blockLength, and the 4.6.4 reducer calls a 2-cluster series
  // `estimated`, so an unguarded call aborts the whole derivation over a
  // sensitivity that gates nothing.
  const input = fixture();
  const target = input.movingBlockWeeks[0];
  const survivors = [2, 3];
  for (const row of input.movingBlockWeeks) {
    if (row.season === target.season && row.cell === target.cell && row.endpoint === target.endpoint
      && row.sensitivity === 'moving-block-3' && !survivors.includes(row.week)) row.value = { nonfinite: 'NaN' };
  }
  let result;
  assert.doesNotThrow(() => { result = evidence.deriveEvidence(input, { permutation }); });
  const row = result.movingBlock.find((candidate) => candidate.season === target.season && candidate.cell === target.cell
    && candidate.endpoint === target.endpoint && candidate.blockLength === 3);
  assert.equal(row.clusters, 2);
  assert.equal(row.status, 'unevaluable');
  assert.equal(row.point, null);
  assert.equal(row.lower, null);
  assert.equal(row.upper, null);
  assert.match(row.reason, /cannot form a block of 3/);
});

test('a moving-block series with exactly blockLength survivors is refused rather than published as a zero-width interval', () => {
  // At n === blockLength the only admissible start index is 0, so every draw is
  // the identical block and lower === upper === point.
  const input = fixture();
  const target = input.movingBlockWeeks[0];
  const survivors = [2, 3];
  for (const row of input.movingBlockWeeks) {
    if (row.season === target.season && row.cell === target.cell && row.endpoint === target.endpoint
      && row.sensitivity === 'moving-block-2' && !survivors.includes(row.week)) row.value = { nonfinite: 'NaN' };
  }
  const result = evidence.deriveEvidence(input, { permutation });
  const row = result.movingBlock.find((candidate) => candidate.season === target.season && candidate.cell === target.cell
    && candidate.endpoint === target.endpoint && candidate.blockLength === 2);
  assert.equal(row.clusters, 2);
  assert.equal(row.status, 'unevaluable');
  assert.equal(row.lower, null);
  assert.equal(row.upper, null);
});

test('a moving-block row discloses whether the series it ran on was contiguous', () => {
  // Survivors are compacted before blocking, so a dropped week makes two
  // non-adjacent weeks adjacent in the drawn block. A sensitivity whose purpose
  // is to probe serial structure must not hide that silently.
  const clean = evidence.deriveEvidence(fixture(), { permutation });
  assert.equal(clean.movingBlock.every((row) => row.contiguous === true), true);

  const input = fixture();
  const target = input.movingBlockWeeks[0];
  for (const row of input.movingBlockWeeks) {
    if (row.season === target.season && row.cell === target.cell && row.endpoint === target.endpoint
      && row.sensitivity === 'moving-block-2' && [9, 10].includes(row.week)) row.value = { nonfinite: 'NaN' };
  }
  const result = evidence.deriveEvidence(input, { permutation });
  const row = result.movingBlock.find((candidate) => candidate.season === target.season && candidate.cell === target.cell
    && candidate.endpoint === target.endpoint && candidate.blockLength === 2);
  assert.equal(row.clusters, 15);
  assert.equal(row.status, 'estimated');
  assert.equal(row.contiguous, false);
});

test('each season\'s descriptive paired delta is cross-checked against the gating component that owns that season', () => {
  // Section 4.6.1: the 2024 delta versus control is simultaneously an (e1)
  // gating endpoint and a prereg 12.1 descriptive row, so one number must not
  // carry two different values. (a) owns 2025, (e1) owns 2024 (prereg 9.6).
  const weekMap = (base) => Object.fromEntries(metrics.EVALUATED_WEEKS.map((week) => [week, base + (week - 2) * 0.001]));
  const cellInputs = Object.fromEntries(evidence.CELL_NAMES.map((cell, index) => [cell, {
    a: { regretWeekDeltas: weekMap(index * 0.01), pairwiseWeekDeltas: weekMap(index * 0.01) },
    e1: { regretWeekDeltas: weekMap(index * 0.01), pairwiseWeekDeltas: weekMap(index * 0.01) },
  }]));
  const input = fixture();
  for (const row of input.metricWeeks) {
    if (row.estimand === 'paired-delta' && ['regret', 'pairwise'].includes(row.endpoint)) {
      const component = row.season === '2024' ? 'e1' : 'a';
      row.value = cellInputs[row.cell][component][row.endpoint === 'regret' ? 'regretWeekDeltas' : 'pairwiseWeekDeltas'][row.week];
    }
  }
  const derived = evidence.deriveEvidence(input, { permutation });
  assert.doesNotThrow(() => evidence.crossCheckClaimInputs(cellInputs, derived));

  // Corrupting ONLY the 2024 side must be caught - before this check existed it
  // was not, because nothing looked at 2024 at all.
  const drifted = JSON.parse(JSON.stringify(cellInputs));
  drifted[evidence.CELL_NAMES[0]].e1.regretWeekDeltas[5] = 99;
  assert.throws(() => evidence.crossCheckClaimInputs(drifted, derived), /2024\/regret\/week-5 does not match component-\(e1\) input/);
});

test('section 4.6.4 total reducer publishes unevaluable and degenerate rows without an interval and never throws', () => {
  // Every week of one contrast nonfinite -> zero surviving clusters.
  const allGone = fixture();
  for (const row of allGone.metricWeeks) {
    if (row.season === '2025' && row.estimand === 'paired-delta' && row.endpoint === 'regret' && row.cell === allGone.metricWeeks[0].cell) row.value = Infinity;
  }
  const unevaluable = evidence.deriveEvidence(allGone, { permutation });
  const dead = unevaluable.cells.find((row) => row.season === '2025' && row.cell === allGone.metricWeeks[0].cell).pairedDeltas.find((row) => row.key === 'regret');
  assert.equal(dead.status, 'unevaluable');
  assert.equal(dead.point, null);
  assert.equal(dead.lower, null);
  assert.equal(dead.upper, null);
  assert.equal(dead.clusters, 0);
  assert.match(dead.reason, /no surviving clusters/);

  // Exactly one surviving cluster -> degenerate, point published, no interval.
  const one = fixture();
  const target = one.metricWeeks[0];
  for (const row of one.metricWeeks) {
    if (row.season === '2025' && row.estimand === 'paired-delta' && row.endpoint === 'regret' && row.cell === target.cell && row.week !== 2) row.value = Infinity;
  }
  const degenerate = evidence.deriveEvidence(one, { permutation });
  const single = degenerate.cells.find((row) => row.season === '2025' && row.cell === target.cell).pairedDeltas.find((row) => row.key === 'regret');
  assert.equal(single.status, 'degenerate');
  assert.equal(single.clusters, 1);
  assert.equal(single.lower, null);
  assert.equal(single.upper, null);
  assert.ok(Number.isFinite(single.point));
});
