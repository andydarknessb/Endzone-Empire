const test = require('node:test');
const assert = require('node:assert/strict');

const metrics = require('../../scripts/backtest/lib/metrics');
const permutationControl = require('../../scripts/backtest/lib/permutationControl');

function rawControl({ fail = false } = {}) {
  const rosterRows = metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, position, playerId: 1 },
    { season: 2025, week, position, playerId: 2 },
  ]));
  const observations = metrics.SALTS.flatMap((salt) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, salt, position, playerId: 1, actual: fail ? 0 : 1, projected: 1 },
    { season: 2025, week, salt, position, playerId: 2, actual: fail ? 1 : 0, projected: 0 },
  ])));
  return { observations, rosterRows };
}

test('permutation control derives both published endpoints from one sealed 10,000-replicate raw stream', () => {
  const result = metrics.computePermutationControl(rawControl());
  assert.deepEqual(
    { seed: result.seed, replicates: result.replicates, regret: result.regret.observed, pairwise: result.pairwise.observed },
    { seed: 940227589, replicates: 10000, regret: 0, pairwise: 1 }
  );
  assert.equal(result.regret.p, 1 / 10001);
  assert.equal(result.pairwise.p, 1 / 10001);
  assert.equal(result.void, false);
  assert.equal(result.regret.draws, 10000);
  assert.equal(result.pairwise.draws, 10000);
});

test('permutation raw domains reject missing, extra, duplicate, and reordered coordinates before reduction', () => {
  const valid = rawControl();
  assert.doesNotThrow(() => permutationControl.canonicalObservations(valid.observations, valid.rosterRows));

  const missingSalt = rawControl();
  missingSalt.observations = missingSalt.observations.filter((row) => row.salt !== metrics.SALTS[0]);
  assert.throws(() => permutationControl.canonicalObservations(missingSalt.observations, missingSalt.rosterRows), /missing salt\/cell/);

  const missingRosterWeek = rawControl();
  missingRosterWeek.rosterRows = missingRosterWeek.rosterRows.filter((row) => row.week !== 2);
  assert.throws(() => permutationControl.canonicalObservations(missingRosterWeek.observations, missingRosterWeek.rosterRows), /missing roster cell/);

  const missingPosition = rawControl();
  missingPosition.rosterRows = missingPosition.rosterRows.filter((row) => !(row.week === 2 && row.position === 'QB'));
  assert.throws(() => permutationControl.canonicalObservations(missingPosition.observations, missingPosition.rosterRows), /missing roster cell/);

  const missingPlayer = rawControl();
  missingPlayer.observations = missingPlayer.observations.filter((row) => !(row.salt === metrics.SALTS[0] && row.week === 2 && row.position === 'QB' && row.playerId === 2));
  assert.throws(() => permutationControl.canonicalObservations(missingPlayer.observations, missingPlayer.rosterRows), /salt player domain differs/);

  const extraPlayer = rawControl();
  extraPlayer.observations.push({ season: 2025, week: 18, salt: metrics.SALTS.at(-1), position: 'DEF', playerId: 3, actual: 0, projected: 0 });
  assert.throws(() => permutationControl.canonicalObservations(extraPlayer.observations, extraPlayer.rosterRows), /salt player domain differs/);

  const duplicate = rawControl();
  duplicate.observations.splice(1, 0, { ...duplicate.observations[0] });
  assert.throws(() => permutationControl.canonicalObservations(duplicate.observations, duplicate.rosterRows), /canonical salt\/week\/position\/player order/);

  const reordered = rawControl();
  [reordered.observations[0], reordered.observations[1]] = [reordered.observations[1], reordered.observations[0]];
  assert.throws(() => permutationControl.canonicalObservations(reordered.observations, reordered.rosterRows), /canonical salt\/week\/position\/player order/);
});

test('the pinned permutation stream has fixed RNG consumption and canonical week-position order', () => {
  const control = rawControl();
  const { cells } = permutationControl.canonicalObservations(control.observations, control.rosterRows);
  const orders = permutationControl.nextOrders(cells, metrics.makeRng(metrics.PERMUTATION_SEED));
  assert.deepEqual(
    Object.fromEntries(['2025:2:QB', '2025:2:RB', '2025:9:WR', '2025:18:DEF'].map((key) => [key, orders[key]])),
    { '2025:2:QB': [1, 0], '2025:2:RB': [0, 1], '2025:9:WR': [1, 0], '2025:18:DEF': [0, 1] }
  );
});
