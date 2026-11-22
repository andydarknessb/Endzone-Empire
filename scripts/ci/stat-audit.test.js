const test = require('node:test');
const assert = require('node:assert/strict');
const { planPlayerStatsWrite } = require('../../server/services/playerStatsWrite.service');
const { compareStatLines } = require('./stat-audit');

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

test('a fantasy points gap above 0.005 is reported even when the stats match, and a half cent is not a gap', () => {
  // Planned 12.345 is stored as 12.35 (decimal(8,2) rounds half away from zero).
  const plan = () => ({ stats: {}, fantasyPoints: 12.345 });
  const cmp = (fantasy_points) => compareStatLines({
    lines: [{ playerId: PLAYER, fresh: {}, position: 'QB' }],
    storedByPlayer: new Map([[PLAYER, { stats: {}, fantasy_points }]]),
    plan,
  });
  assert.deepEqual(cmp('12.35'), []);
  assert.deepEqual(cmp('12.30'), [{ playerId: PLAYER, key: 'fantasy_points', stored: 12.3, expected: 12.35 }]);
});
