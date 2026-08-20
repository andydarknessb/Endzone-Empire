const test = require('node:test');
const assert = require('node:assert/strict');
const { teamIndexForPick, draftPlayer, undoDrop } = require('../services/draft.service');
const seasonService = require('../services/season.service');
const lineupService = require('../services/lineup.service');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');

test('teamIndexForPick: 4 teams, round 1 (picks 0-3)', () => {
  assert.equal(teamIndexForPick(0, 4), 0);
  assert.equal(teamIndexForPick(1, 4), 1);
  assert.equal(teamIndexForPick(2, 4), 2);
  assert.equal(teamIndexForPick(3, 4), 3);
});

test('teamIndexForPick: 4 teams, round 2 reversed (picks 4-7)', () => {
  assert.equal(teamIndexForPick(4, 4), 3);
  assert.equal(teamIndexForPick(5, 4), 2);
  assert.equal(teamIndexForPick(6, 4), 1);
  assert.equal(teamIndexForPick(7, 4), 0);
});

test('teamIndexForPick: 4 teams, round 3 (pick 8)', () => {
  assert.equal(teamIndexForPick(8, 4), 0);
});

test('teamIndexForPick: 2 teams snake draft', () => {
  assert.equal(teamIndexForPick(0, 2), 0);
  assert.equal(teamIndexForPick(1, 2), 1);
  assert.equal(teamIndexForPick(2, 2), 1);
  assert.equal(teamIndexForPick(3, 2), 0);
});

test('teamIndexForPick: 1 team always returns 0', () => {
  assert.equal(teamIndexForPick(0, 1), 0);
  assert.equal(teamIndexForPick(1, 1), 0);
  assert.equal(teamIndexForPick(2, 1), 0);
  assert.equal(teamIndexForPick(100, 1), 0);
});

test('teamIndexForPick: 6 teams, full example', () => {
  // Round 0 (even): 0,1,2,3,4,5 → 0,1,2,3,4,5
  assert.equal(teamIndexForPick(0, 6), 0);
  assert.equal(teamIndexForPick(1, 6), 1);
  assert.equal(teamIndexForPick(2, 6), 2);
  assert.equal(teamIndexForPick(3, 6), 3);
  assert.equal(teamIndexForPick(4, 6), 4);
  assert.equal(teamIndexForPick(5, 6), 5);
  // Round 1 (odd): 6,7,8,9,10,11 → 5,4,3,2,1,0
  assert.equal(teamIndexForPick(6, 6), 5);
  assert.equal(teamIndexForPick(7, 6), 4);
  assert.equal(teamIndexForPick(8, 6), 3);
  assert.equal(teamIndexForPick(9, 6), 2);
  assert.equal(teamIndexForPick(10, 6), 1);
  assert.equal(teamIndexForPick(11, 6), 0);
  // Round 2 (even): 12,13,14,15,16,17 → 0,1,2,3,4,5
  assert.equal(teamIndexForPick(12, 6), 0);
  assert.equal(teamIndexForPick(13, 6), 1);
  assert.equal(teamIndexForPick(14, 6), 2);
  assert.equal(teamIndexForPick(15, 6), 3);
  assert.equal(teamIndexForPick(16, 6), 4);
  assert.equal(teamIndexForPick(17, 6), 5);
});

test('teamIndexForPick: 3 teams snake draft', () => {
  // Round 0: 0,1,2 → 0,1,2
  assert.equal(teamIndexForPick(0, 3), 0);
  assert.equal(teamIndexForPick(1, 3), 1);
  assert.equal(teamIndexForPick(2, 3), 2);
  // Round 1: 3,4,5 → 2,1,0
  assert.equal(teamIndexForPick(3, 3), 2);
  assert.equal(teamIndexForPick(4, 3), 1);
  assert.equal(teamIndexForPick(5, 3), 0);
  // Round 2: 6,7,8 → 0,1,2
  assert.equal(teamIndexForPick(6, 3), 0);
  assert.equal(teamIndexForPick(7, 3), 1);
  assert.equal(teamIndexForPick(8, 3), 2);
});

test('teamIndexForPick: 12 teams snake draft', () => {
  // Round 0 (even): first pick → team 0
  assert.equal(teamIndexForPick(0, 12), 0);
  // Round 0 (even): last pick of round → team 11
  assert.equal(teamIndexForPick(11, 12), 11);
  // Round 1 (odd): first pick → team 11
  assert.equal(teamIndexForPick(12, 12), 11);
  // Round 1 (odd): last pick → team 0
  assert.equal(teamIndexForPick(23, 12), 0);
  // Round 2 (even): first pick → team 0
  assert.equal(teamIndexForPick(24, 12), 0);
});

// --- draft completion -------------------------------------------------------

// A draft runs for the draft roster size (starters + bench), not the stored
// IR-inclusive roster_limit: no round is spent on the IR slot (#96).
const completionLeague = {
  id: 1,
  draft_status: 'active',
  draft_paused: false,
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  pickem_only: false,
  roster_limit: 3,
  ir_slots: 1,
  position_caps: {},
  current_pick: 3,
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  waiver_period_hours: 24,
};

function completionPool({ league, picksMade }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [
      { id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false },
      { id: 12, owner_id: 8, draft_position: 2, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: picksMade }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ pick_deadline_at: null }] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

test('draftPlayer: the draft completes at teams x draft roster size, not x roster_limit', async (t) => {
  const fake = completionPool({ league: completionLeague, picksMade: 4 }).install(t);
  recordBenching(t, fake);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  assert.equal(result.nextTeamId, null);
  const leagueUpdate = fake.matching(/^UPDATE "leagues" SET "current_pick"/)[0];
  assert.equal(leagueUpdate.params[1], 'complete');
  fake.assertClean();
});

test('draftPlayer: one pick short of the draft roster size keeps the draft active', async (t) => {
  // Pick 3 of 4: team 12 is on the clock (0-based current_pick 2).
  const league = { ...completionLeague, current_pick: 2 };
  const fake = completionPool({ league, picksMade: 3 }).install(t);
  const benched = recordBenching(t, fake);

  const result = await draftPlayer({ leagueId: 1, userId: 8, playerId: 500 });

  assert.equal(result.draftComplete, false);
  const leagueUpdate = fake.matching(/^UPDATE "leagues" SET "current_pick"/)[0];
  assert.equal(leagueUpdate.params[1], 'active');
  // A draft pick benches too: the lineup screen has no draft guard, so a
  // mid-draft drop can leave a stash row behind like any other drop.
  assert.deepEqual(benched, [{ league, teamId: 12, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});

test('draftPlayer: a zero-IR league still drafts every roster_limit round', async (t) => {
  const league = { ...completionLeague, ir_slots: 0 };
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  // 2 teams x 3 rounds = 6 picks. The 4th pick ends a 1-IR league but not this one.
  const midDraft = completionPool({ league, picksMade: 4 }).install(t);
  assert.equal((await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 })).draftComplete, false);
  midDraft.assertClean();

  const fake = completionPool({ league, picksMade: 6 }).install(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));
  assert.equal((await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 })).draftComplete, true);
  fake.assertClean();
});

// --- roster capacity at the free-agent add site (#97) -----------------------
// Thin: proves the post-draft add consults the IR policy module's roster
// capacity rather than the static roster limit. The capacity formula itself
// is tested at the module seam (irPolicy.service.test.js).

const freeAgencyLeague = {
  ...completionLeague,
  draft_status: 'complete',
  waivers_clear_at: null,
  current_season: 2026,
  current_week: 3,
};

function freeAgencyPool({ rostered, stashed, stashQueries }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [freeAgencyLeague] })],
    [select('teams'), () => ({ rows: [
      { id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, (text, params) => {
      if (stashQueries) stashQueries.push(params);
      return { rows: [{ n: stashed }] };
    }],
    [select('waiver_players'), () => ({ rows: [] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
  ]);
}

/** Mock the bench step and record each call with whether the roster write preceded it. */
function recordBenching(t, fake) {
  const benched = [];
  t.mock.method(lineupService, 'benchAcquiredPlayer', async (client, args) => {
    benched.push({ ...args, afterRosterWrite: fake.matching(/^INSERT INTO "team_players"/).length > 0 });
  });
  return benched;
}

test('draftPlayer free agency: a full team with no stash is rejected at the draft roster size', async (t) => {
  // roster_limit 3, ir_slots 1: draft roster size 2, and an empty stash
  // grants nothing beyond it.
  const fake = freeAgencyPool({ rostered: 2, stashed: 0 }).install(t);

  await assert.rejects(
    draftPlayer({ leagueId: 1, userId: 7, playerId: 500 }),
    { statusCode: 409, message: 'roster capacity of 2 reached' }
  );
  fake.assertClean();
});

test('draftPlayer free agency: an eligible IR stash grants the extra spot', async (t) => {
  const stashQueries = [];
  const fake = freeAgencyPool({ rostered: 2, stashed: 1, stashQueries }).install(t);
  const benched = recordBenching(t, fake);

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.player.id, 500);
  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 1);
  // A free-agent add earns no restored credit and lands on the bench (user
  // story 13), even when the player's old stash rows on this team survive.
  assert.deepEqual(stashQueries[0][3], []);
  assert.deepEqual(benched, [{ league: freeAgencyLeague, teamId: 11, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});

test('undoDrop: consults roster capacity, not the static roster limit', async (t) => {
  const fake = createFakePool([
    [select('leagues'), (text) => {
      assert.match(text, /"ir_slots"/);
      return { rows: [{ roster_limit: 3, ir_slots: 1, position_caps: {} }] };
    }],
    [select('teams'), () => ({ rows: [{ id: 11, owner_id: 7, locked: false }] })],
    [select('waiver_players'), () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 2 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
  ]).install(t);

  await assert.rejects(
    undoDrop({ leagueId: 1, userId: 7, playerId: 500 }),
    { statusCode: 409, message: 'roster capacity of 2 reached' }
  );
  fake.assertClean();
});

const undoLeague = {
  id: 1, roster_limit: 3, ir_slots: 1, position_caps: {}, current_season: 2026, current_week: 4,
};

/** An undo world: `stashed` answers the capacity count, `restorable` the valid-stash probe. */
function undoWorld({ rostered = 2, stashed, restorable, onStashQuery }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [undoLeague] })],
    [select('teams'), () => ({ rows: [{ id: 11, owner_id: 7, locked: false }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, (text, params) => {
      if (onStashQuery) onStashQuery(params);
      return { rows: [{ n: stashed }] };
    }],
    [/^SELECT 1 FROM "lineup_entries"/, () => ({ rows: restorable ? [{ 1: 1 }] : [] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Stash Returner', position: 'RB' }] })],
    [/^DELETE FROM "waiver_players"/, () => ({ rows: [] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
  ]);
}

test('undoDrop: the dropped player\'s own surviving stash still grants its spot on the way back in', async (t) => {
  // Draft roster size 2, ir_slots 1, roster legally 3 with player 500 stashed;
  // he was dropped (roster now 2) and his IR entry survives. The undo
  // restores that exact state, so it must pass at capacity 3 - and, the
  // stash still being valid, it is restored rather than benched.
  let stashParams;
  const fake = undoWorld({ stashed: 1, restorable: true, onStashQuery: (params) => { stashParams = params; } }).install(t);
  const benched = recordBenching(t, fake);

  const result = await undoDrop({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.player.id, 500);
  assert.deepEqual(stashParams[3], [500]);
  assert.deepEqual(benched, []);
  fake.assertClean();
});

test('undoDrop: a stash that stopped being valid while he was off the roster is benched, not restored', async (t) => {
  // Player 500 recovered after the drop: his IR row still exists but grants
  // nothing (stashed 0) and is not a valid stash to return to. With 2 rostered
  // at draft roster size 2 the undo is out of capacity; with room (1 rostered)
  // it lands him on the bench rather than restoring an ungated stash.
  const fake = undoWorld({ rostered: 1, stashed: 0, restorable: false }).install(t);
  const benched = recordBenching(t, fake);

  const result = await undoDrop({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.player.id, 500);
  assert.deepEqual(benched, [{ league: undoLeague, teamId: 11, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});
