const test = require('node:test');
const assert = require('node:assert/strict');
const { planPlayerStatsWrite } = require('../../server/services/playerStatsWrite.service');
const { compareStatLines, emptyWeekProblem } = require('./stat-audit');

const PLAYER = 'p-qb';
const QB_FRESH = { passingYards: 300, passingTDs: 2, interceptions: 1, rushingYards: 12, rushingTDs: 0, fumbles: 0 };

// The row the correction stores for `fresh` over `prior`, shaped as pg returns it.
function storedRowFor(fresh, { prior = null, position = 'QB' } = {}) {
  const plan = planPlayerStatsWrite({ source: 'nflverse-correction', fresh, prior, position });
  return { stats: JSON.parse(JSON.stringify(plan.stats)), fantasy_points: plan.fantasyPoints.toFixed(2) };
}

const compare = (row, { fresh = QB_FRESH, position = 'QB' } = {}) =>
  compareStatLines({
    lines: [{ playerId: PLAYER, fresh, position }],
    storedByPlayer: new Map([[PLAYER, row]]),
    plan: planPlayerStatsWrite,
  });

test('identical stored and expected lines give no difference', () => {
  assert.deepEqual(compare(storedRowFor(QB_FRESH)), []);
});

test('a changed owned key is reported with that key, the stored value and the expected value', () => {
  const row = storedRowFor(QB_FRESH);
  row.stats.passingYards = 290;
  assert.deepEqual(compare(row), [{ playerId: PLAYER, key: 'passingYards', stored: 290, expected: 300 }]);
});

test('a line with no stored row is reported', () => {
  const diffs = compareStatLines({
    lines: [{ playerId: PLAYER, fresh: QB_FRESH, position: 'QB' }],
    storedByPlayer: new Map(),
    plan: planPlayerStatsWrite,
  });
  assert.deepEqual(diffs.map((d) => [d.playerId, d.key]), [[PLAYER, '(no stored row)']]);
});

test('a stored key the correction does not own is carried by the plan, not a difference', () => {
  const row = storedRowFor(QB_FRESH, { prior: { passingTDLengths: [12, 4] } });
  assert.deepEqual(row.stats.passingTDLengths, [12, 4]);
  assert.deepEqual(compare(row), []);
});

test('IDP keys on a non-defender are not a difference', () => {
  const wrFresh = { ...QB_FRESH, idpSack: 2, idpInterception: 1 };
  const row = storedRowFor(wrFresh, { position: 'WR' });
  assert.equal(row.stats.idpSack, undefined, 'the funnel strips a non-defender IDP key');
  assert.deepEqual(compare(row, { fresh: wrFresh, position: 'WR' }), []);
  // The same key stored on a non-defender is the difference: the correction would strip it.
  row.stats.idpSack = 2;
  assert.deepEqual(compare(row, { fresh: wrFresh, position: 'WR' }).map((d) => d.key), ['idpSack']);
});

test('IDP keys on a defender are kept, and a missing one is the only difference', () => {
  const lbFresh = { ...QB_FRESH, idpSack: 2 };
  const row = storedRowFor(lbFresh, { position: 'LB' });
  assert.equal(row.stats.idpSack, 2, 'the funnel keeps an IDP key on an LB');
  assert.deepEqual(compare(row, { fresh: lbFresh, position: 'LB' }), []);
  // The points stay as the plan has them, so the missing key is the only difference.
  delete row.stats.idpSack;
  assert.deepEqual(compare(row, { fresh: lbFresh, position: 'LB' }), [
    { playerId: PLAYER, key: 'idpSack', stored: null, expected: 2 },
  ]);
});

test('a fantasy points value one cent from the plan is a difference, and the same value is not', () => {
  const row = storedRowFor(QB_FRESH);
  const planned = planPlayerStatsWrite({ source: 'nflverse-correction', fresh: QB_FRESH, prior: null, position: 'QB' }).fantasyPoints;
  assert.deepEqual(compare(row), []);
  for (const delta of [0.01, -0.01]) {
    row.fantasy_points = (planned + delta).toFixed(2);
    assert.deepEqual(compare(row).map((d) => [d.key, d.expected]), [['fantasy_points', planned]]);
  }
});

test('a player id with two lines is compared on its last line only', () => {
  const earlier = { ...QB_FRESH, passingYards: 100 };
  const diffs = compareStatLines({
    lines: [
      { playerId: PLAYER, fresh: earlier, position: 'QB' },
      { playerId: PLAYER, fresh: QB_FRESH, position: 'QB' },
    ],
    storedByPlayer: new Map([[PLAYER, storedRowFor(QB_FRESH)]]),
    plan: planPlayerStatsWrite,
  });
  assert.deepEqual(diffs, []);
});

test('a null plan writes nothing, so nothing differs, stored row or not', () => {
  const plan = () => null;
  const lines = [{ playerId: PLAYER, fresh: QB_FRESH, position: 'QB' }];
  const stale = new Map([[PLAYER, { stats: { passingYards: 1 }, fantasy_points: '0.00' }]]);
  assert.deepEqual(compareStatLines({ lines, storedByPlayer: stale, plan }), []);
  assert.deepEqual(compareStatLines({ lines, storedByPlayer: new Map(), plan }), []);
});

test('a settled week with no player lines is a problem, and a week with lines is not', () => {
  assert.match(
    emptyWeekProblem({ season: 2026, week: 9, units: 14, playerLines: 0, dstLines: 28 }),
    /no player lines for 14 units \(28 DST lines\)/
  );
  assert.equal(emptyWeekProblem({ season: 2026, week: 9, units: 14, playerLines: 1, dstLines: 0 }), null);
});
