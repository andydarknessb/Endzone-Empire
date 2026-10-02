/**
 * The gameTeam backfill planner (DEVIATIONS entry 6): pure, no DB. Team and
 * opponent come only from the nflverse stats_player_week row for that player's
 * (season, week), in nflverse spelling; everything else is skipped and listed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { planGameTeamBackfill, parseArgs } = require('../../scripts/backfill-stats-gameteam');

const gsisToEspn = new Map([['G1', '101'], ['G2', '102'], ['G3', '103']]);
const row = (id, externalId, week, stats = { soloTackle: 1 }) => ({
  id, playerId: id * 10, name: `P${id}`, externalId, season: 2026, week, stats,
});
const nv = (player_id, week, team, opponent_team, season_type = 'REG') => ({
  player_id, season: '2026', week: String(week), season_type, team, opponent_team,
});

test('plans the nflverse row for that (season, week), in nflverse spelling, never the current team', () => {
  const { changes, skipped } = planGameTeamBackfill({
    rows: [row(1, '101', 2)],
    nflverseRows: [nv('G1', 1, 'KC', 'DEN'), nv('G1', 2, 'WAS', 'DAL')],
    gsisToEspn,
  });
  assert.deepEqual(skipped, []);
  assert.deepEqual(changes, [{ rowId: 1, playerId: 10, name: 'P1', season: 2026, week: 2, gameTeam: 'WAS', gameOpponent: 'DAL' }]);
});

test('skips and lists a row with no nflverse row, a blank team, or a duplicate', () => {
  const { changes, skipped } = planGameTeamBackfill({
    rows: [row(1, '101', 2), row(2, '102', 2), row(3, '103', 2), row(4, '999', 2)],
    nflverseRows: [nv('G2', 2, '', 'DAL'), nv('G3', 2, 'KC', 'DEN'), nv('G3', 2, 'KC', 'DEN')],
    gsisToEspn,
  });
  assert.deepEqual(changes, []);
  assert.deepEqual(skipped.map((s) => [s.rowId, s.reason]), [
    [1, 'no nflverse stats_player_week row'],
    [2, 'blank team in nflverse row'],
    [3, 'more than one nflverse row'],
    [4, 'no nflverse stats_player_week row'],
  ]);
});

test('ignores a postseason row, another week, and rows that already have a gameTeam', () => {
  const { changes, skipped } = planGameTeamBackfill({
    rows: [row(1, '101', 2), row(2, '102', 2, { gameTeam: 'KC', gameOpponent: 'DEN' })],
    nflverseRows: [nv('G1', 2, 'WAS', 'DAL', 'POST'), nv('G1', 3, 'WAS', 'DAL'), nv('G2', 2, 'NYG', 'DAL')],
    gsisToEspn,
  });
  assert.deepEqual(changes, []);
  assert.deepEqual(skipped.map((s) => s.rowId), [1]);
});

test('fills gameOpponent only when it is missing, and leaves a blank opponent out', () => {
  const { changes } = planGameTeamBackfill({
    rows: [row(1, '101', 2, { gameOpponent: 'DAL' }), row(2, '102', 2)],
    nflverseRows: [nv('G1', 2, 'WAS', 'NYG'), nv('G2', 2, 'KC', '')],
    gsisToEspn,
  });
  assert.deepEqual(changes.map((c) => [c.rowId, c.gameTeam, c.gameOpponent]), [[1, 'WAS', null], [2, 'KC', null]]);
});

test('--apply refuses to run without --pre-correction-out; dry run is the default', () => {
  assert.equal(parseArgs([]).apply, false);
  assert.throws(() => parseArgs(['--apply']), /pre-correction-out/);
  assert.equal(parseArgs(['--apply', '--pre-correction-out', 'x.json']).apply, true);
});
