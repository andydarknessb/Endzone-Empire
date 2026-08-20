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
  roster_limit: 16, ir_slots: 2,
};

function forceAddWorld({ rostered, stashed }) {
  return createFakePool([
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8 }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: stashed }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
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
  const fake = forceAddWorld({ rostered: 14, stashed: 1 }).install(t);

  const result = await forceTransaction({
    leagueId: 1, userId: 100, teamId: 31, action: 'add', playerId: 500,
  });

  assert.equal(result.playerName, 'Pick Me');
  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 1);
  fake.assertClean();
});
