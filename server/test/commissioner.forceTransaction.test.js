const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, remove, select, update } = require('./helpers/fakePool');
const { forceTransaction } = require('../services/commissioner.service');
const lineupService = require('../services/lineup.service');

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
    [remove('waiver_players'), () => ({ rows: [] })],
    [update('waiver_claims'), () => ({ rows: [] })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]);
}

test('forceTransaction add: a full team with no stash is rejected at the draft roster size', async (t) => {
  const fake = forceAddWorld({ rostered: 14, stashed: 0 }).install(t);
  // #274: the bench step is an injected collaborator, so its call count is the
  // closest seam for that side effect. Stubbed here so the refusal path cannot
  // silently reach the real one.
  const benched = [];
  t.mock.method(lineupService, 'benchAcquiredPlayer', async (client, args) => {
    benched.push(args);
  });

  await assert.rejects(
    forceTransaction({ leagueId: 1, userId: 100, teamId: 31, action: 'add', playerId: 500 }),
    { statusCode: 409, message: 'roster capacity of 14 reached' }
  );
  // #274. forceAddWorld answers EVERY write this path performs, so a capacity
  // guard moved below them rosters the player, clears his waiver row, logs a
  // transaction, notifies the manager, then throws the identical 409 and rolls
  // back. Nothing in the response can tell the two apart. The sibling test
  // below asserts the same team_players matcher returns exactly 1 on the
  // success path, which is the baseline that makes this zero mean something.
  assert.equal(fake.matching(insert('team_players')).length, 0, 'the player was not rostered');
  assert.equal(fake.matching(remove('waiver_players')).length, 0, 'his waiver row survived');
  assert.equal(fake.matching(update('waiver_claims')).length, 0, 'no claim was settled');
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no transaction was logged');
  assert.equal(fake.matching(insert('notifications')).length, 0, 'nobody was told it happened');
  assert.equal(benched.length, 0, 'the bench step never ran');
  assert.equal(fake.matching(/^COMMIT$/).length, 0); // complementary only
  fake.assertClean();
});

test('forceTransaction add: an eligible IR stash grants the extra spot', async (t) => {
  const stashQueries = [];
  const fake = forceAddWorld({ rostered: 14, stashed: 1, stashQueries }).install(t);
  const benched = [];
  t.mock.method(lineupService, 'benchAcquiredPlayer', async (client, args) => {
    benched.push({ ...args, afterRosterWrite: fake.matching(/^INSERT INTO "team_players"/).length > 0 });
  });

  const result = await forceTransaction({
    leagueId: 1, userId: 100, teamId: 31, action: 'add', playerId: 500,
  });

  assert.equal(result.playerName, 'Pick Me');
  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 1);
  // The added player earns no restored credit and lands on the bench (user
  // story 13): a forced add is still an add, never a way back into a stash.
  // Passing no restored ids means the capacity query carries no fourth
  // parameter and no interrupted-stash record is read (#197).
  assert.equal(stashQueries[0].length, 3);
  assert.equal(fake.matching(/^SELECT "waiver_players"\."interrupted_slot"/).length, 0);
  assert.deepEqual(benched, [{ league, teamId: 31, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});
