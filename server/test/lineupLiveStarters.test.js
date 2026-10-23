const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { liveStartersHeld, onRosterColumn } = require('../services/lineup.service');

// #2428: the one live-standard-starters filter. On-roster rows (and rows with
// no on_roster field) are kept as they are; only on_roster === false rows (a
// starter spared after kickoff, #627) go through settle's filter.
async function held(t, rows, notHeld = []) {
  const fake = createFakePool([
    [/FROM "nfl_games"/, () => ({ rows: [{ nfl_team: 'KC', kickoff_at: '2026-10-25T17:00:00.000Z' }] })],
    [/FROM unnest/, () => ({ rows: notHeld.map((player_id) => ({ player_id })) })],
  ]).install(t);
  const out = await liveStartersHeld(fake, {
    league: { best_ball: false }, teamId: 10, season: 2026, week: 8, rows,
  });
  return out.map((r) => r.player_id);
}

const row = (player_id, extra = {}) => ({ player_id, nfl_team: 'KC', ...extra });

test('liveStartersHeld: an on-roster row is kept', async (t) => {
  assert.deepEqual(await held(t, [row(1, { on_roster: true })], [1]), [1]);
});

test('liveStartersHeld: an off-roster row is kept when settle holds it', async (t) => {
  assert.deepEqual(await held(t, [row(7, { on_roster: false })]), [7]);
});

test('liveStartersHeld: an off-roster row is dropped when settle takes it off', async (t) => {
  assert.deepEqual(await held(t, [row(7, { on_roster: false })], [7]), []);
});

test('liveStartersHeld: a row with no on_roster field counts as on-roster', async (t) => {
  assert.deepEqual(await held(t, [row(3)], [3]), [3]);
});

test('liveStartersHeld: keeps input order', async (t) => {
  const rows = [row(1, { on_roster: true }), row(7, { on_roster: false }), row(2, { on_roster: true })];
  assert.deepEqual(await held(t, rows), [1, 7, 2]);
});

test('onRosterColumn: is the team_players EXISTS expression', () => {
  assert.match(onRosterColumn(), /^EXISTS \(SELECT 1 FROM "team_players"/);
});
