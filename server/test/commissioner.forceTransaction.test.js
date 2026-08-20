const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, remove, select, update } = require('./helpers/fakePool');
const { forceTransaction } = require('../services/commissioner.service');

// --- roster capacity at the commissioner add site (#97) ---------------------
// Thin: proves the forced add consults the IR policy module's roster
// capacity, not the static roster limit — the override bypasses locks and
// holds, but never grants extra room. The capacity formula itself is tested
// at the module seam (irPolicy.service.test.js).

const league = {
  id: 1, owner_id: 100, is_commissioner: true,
  roster_limit: 16, ir_slots: 2, current_season: 2026, current_week: 4,
};

function forceAddWorld({ rostered, stashed, stashQueries }) {
  return createFakePool([
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8 }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, (text, params) => {
      if (stashQueries) stashQueries.push(params);
      return { rows: [{ n: stashed }] };
    }],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('lineup_entries'), () => ({ rows: [] })],
    [update('lineup_entries'), () => ({ rows: [], rowCount: 0 })],
    [remove('waiver_players'), () => ({ rows: [] })],
    [update('waiver_claims'), () => ({ rows: [] })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]);
}

test('forceTransaction add: a full team with no stash is rejected at the draft roster size', async (t) => {
  const fake = forceAddWorld({ rostered: 14, stashed: 0 }).install(t);

  await assert.rejects(
    forceTransaction({ leagueId: 1, userId: 100, teamId: 31, action: 'add', playerId: 500 }),
    { statusCode: 409, message: 'roster capacity of 14 reached' }
  );
  fake.assertClean();
});

test('forceTransaction add: an eligible IR stash grants the extra spot', async (t) => {
  const stashQueries = [];
  const fake = forceAddWorld({ rostered: 14, stashed: 1, stashQueries }).install(t);

  const result = await forceTransaction({
    leagueId: 1, userId: 100, teamId: 31, action: 'add', playerId: 500,
  });

  assert.equal(result.playerName, 'Pick Me');
  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 1);
  // The added player earns no restored credit and lands on the bench (user
  // story 13): a forced add is still an add, never a way back into a stash.
  assert.deepEqual(stashQueries[0][3], []);
  const benched = fake.matching(/^INSERT INTO "lineup_entries"/);
  assert.deepEqual(benched.map((call) => call.params), [[1, 31, 500, 2026, 4]]);
  fake.assertClean();
});
