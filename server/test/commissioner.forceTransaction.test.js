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

// --- the commissioner override as an EXPLICIT bypass set (#964) -------------
//
// forceTransaction runs through the one write gate with COMMISSIONER_OVERRIDE.
// The set is {freeze, team lock, waiver hold, position cap}, and roster
// capacity is deliberately absent. It was read out of this path's CODE, not out
// of the comment that used to sit above it: that comment named the waiver hold,
// the league-wide lock and the per-team lock and never mentioned the position
// cap, which the path also did not enforce. There is one assertion per entry
// below, plus the proof that capacity still binds - which is what makes the set
// a reproduction of today's behaviour rather than a restatement of the comment.

const overrideLeague = {
  ...league,
  transactions_locked: true,
  draft_status: 'complete',
  position_caps: { RB: 1 },
  waivers_clear_at: null,
};

/**
 * A forced-transaction world in which EVERY gate the override is supposed to
 * bypass is tripped at once: the league is frozen, the team is locked, the
 * player is on waivers, and the position cap for his position is already met.
 * `rostered` is the only dial left, because capacity is the one gate the
 * override does not cover.
 */
function overrideWorld({ rostered = 0, stashed = 0, positionCount = 1 } = {}) {
  return createFakePool([
    // The gate's own reads, with their own explicit column lists. Registered
    // first, since handlers are tried in order.
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [overrideLeague] })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ id: 31, locked: true }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" JOIN "players"/,
      () => ({ rows: [{ n: positionCount }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [{ 1: 1 }] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [overrideLeague] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: true }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: stashed }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [remove('team_players'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [] })],
    [update('waiver_claims'), () => ({ rows: [] })],
    // placeOnWaiversUndoable, on the forced-drop path.
    [/^SELECT "slot", "ir_attested" FROM "lineup_entries"/, () => ({ rows: [] })],
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [{ nfl_team: 'MIN' }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [remove('lineup_entries'), () => ({ rows: [], rowCount: 1 })],
    [insert('waiver_players'), () => ({ rows: [] })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]);
}

const forceAdd = () => forceTransaction({ leagueId: 1, userId: 100, teamId: 31, action: 'add', playerId: 500 });
const forceDrop = () => forceTransaction({ leagueId: 1, userId: 100, teamId: 31, action: 'drop', playerId: 500 });

test('forceTransaction add: succeeds against a frozen league, a locked team, a waiver hold and a met position cap', async (t) => {
  const fake = overrideWorld().install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  const result = await forceAdd();

  assert.equal(result.playerName, 'Pick Me');
  assert.equal(fake.matching(insert('team_players')).length, 1, 'the override still adds');
  fake.assertClean();
});

test('forceTransaction add: the FREEZE bypass is what carries it past a frozen league', async (t) => {
  // One assertion per override entry. Each isolates its gate by leaving the
  // other three clear, so a set that lost this entry fails here and only here.
  const fake = createFakePool([
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ ...overrideLeague, position_caps: {} }] })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ id: 31, locked: false }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [overrideLeague] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [] })],
    [update('waiver_claims'), () => ({ rows: [] })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  await forceAdd();
  assert.equal(fake.matching(insert('team_players')).length, 1);
  fake.assertClean();
});

test('forceTransaction add: the TEAM_LOCK bypass is what carries it past a locked team', async (t) => {
  const fake = createFakePool([
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ ...overrideLeague, transactions_locked: false, position_caps: {} }] })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ id: 31, locked: true }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [overrideLeague] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: true }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [] })],
    [update('waiver_claims'), () => ({ rows: [] })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  await forceAdd();
  assert.equal(fake.matching(insert('team_players')).length, 1);
  fake.assertClean();
});

test('forceTransaction add: the WAIVER_HOLD bypass is what carries it past a player on waivers', async (t) => {
  const fake = createFakePool([
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ ...overrideLeague, transactions_locked: false, position_caps: {} }] })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ id: 31, locked: false }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [{ 1: 1 }] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [overrideLeague] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [] })],
    [update('waiver_claims'), () => ({ rows: [] })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  await forceAdd();
  assert.equal(fake.matching(insert('team_players')).length, 1);
  fake.assertClean();
});

test('forceTransaction add: the POSITION_CAP bypass, the entry the old comment did not mention', async (t) => {
  // This is the entry that had to be read out of the code. The path's own
  // comment listed the waiver hold and the two locks and stopped there;
  // reproducing the comment would have added a position cap this path has
  // never enforced. A met cap of one RB must still let a forced add through.
  const fake = createFakePool([
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ ...overrideLeague, transactions_locked: false }] })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ id: 31, locked: false }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" JOIN "players"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [overrideLeague] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [] })],
    [update('waiver_claims'), () => ({ rows: [] })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  await forceAdd();
  assert.equal(fake.matching(insert('team_players')).length, 1, 'a met position cap does not stop a forced add');
  fake.assertClean();
});

test('forceTransaction add: CAPACITY is NOT in the override, so a full roster still refuses', async (t) => {
  // The complement of the four above, and what makes them mean something: the
  // set is exactly four entries, not five. roster_limit 16 with ir_slots 2 and
  // no stash puts capacity at 14.
  const fake = overrideWorld({ rostered: 14, stashed: 0 }).install(t);
  const benched = [];
  t.mock.method(lineupService, 'benchAcquiredPlayer', async (client, args) => { benched.push(args); });

  await assert.rejects(forceAdd(), { statusCode: 409, message: 'roster capacity of 14 reached' });

  assert.equal(fake.matching(insert('team_players')).length, 0, 'the player was not rostered');
  assert.equal(fake.matching(remove('waiver_players')).length, 0, 'his waiver row survived');
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no transaction was logged');
  assert.equal(benched.length, 0, 'the bench step never ran');
  fake.assertClean();
});

test('forceTransaction drop: succeeds against a frozen league and a locked team', async (t) => {
  const fake = overrideWorld().install(t);

  const result = await forceDrop();

  assert.equal(result.action, 'drop');
  assert.equal(fake.matching(remove('team_players')).length, 1, 'the forced drop still removed the row');
  assert.equal(fake.matching(insert('waiver_players')).length, 1, 'and it is still undoable');
  fake.assertClean();
});
