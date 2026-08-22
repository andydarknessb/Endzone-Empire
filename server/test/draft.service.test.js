const test = require('node:test');
const assert = require('node:assert/strict');
const { teamIndexForPick, draftPlayer } = require('../services/draft.service');
const seasonService = require('../services/season.service');
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
// IR-inclusive roster_limit: no round is spent on the IR slot (#96). Once a
// draft is active, that round count is the FIXED draft_rounds (ADR 0005),
// not a live draftRosterSize() recomputation — roster_limit/ir_slots below
// still happen to agree with draft_rounds (3 - 1 = 2) so the completion math
// in these tests reads the same either way; the test further down proves the
// fixed value, not roster_limit/ir_slots, is what actually drives it.
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
  draft_rounds: 2,
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

  const result = await draftPlayer({ leagueId: 1, userId: 8, playerId: 500 });

  assert.equal(result.draftComplete, false);
  const leagueUpdate = fake.matching(/^UPDATE "leagues" SET "current_pick"/)[0];
  assert.equal(leagueUpdate.params[1], 'active');
  fake.assertClean();
});

test('draftPlayer: a zero-IR league still drafts every roster_limit round', async (t) => {
  const league = { ...completionLeague, ir_slots: 0, draft_rounds: 3 };
  // 2 teams x 3 rounds = 6 picks. The 4th pick ends a 1-IR league but not this one.
  const midDraft = completionPool({ league, picksMade: 4 }).install(t);
  assert.equal((await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 })).draftComplete, false);
  midDraft.assertClean();

  const fake = completionPool({ league, picksMade: 6 }).install(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));
  assert.equal((await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 })).draftComplete, true);
  fake.assertClean();
});

// ADR 0005: an active draft's completion check reads the fixed draft_rounds,
// never re-derives it from roster_limit/ir_slots. roster_limit/ir_slots below
// would derive 9 rounds live (a settings edit long after the draft roster
// size was already frozen) if draftPlayer still called draftRosterSize(); the
// fixed draft_rounds of 2 is what must actually govern completion.
test('draftPlayer: completion uses the fixed draft_rounds even when roster_limit/ir_slots would derive something else', async (t) => {
  const league = { ...completionLeague, roster_limit: 20, ir_slots: 1, draft_rounds: 2 };
  const fake = completionPool({ league, picksMade: 4 }).install(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  fake.assertClean();
});

// Defensive fallback: an active league whose draft_rounds is unexpectedly
// null (a legacy row the one-time backfill migration has not reached yet)
// must not silently coerce into `teams.length * null === 0` (a totalPicks of
// 0, which would report every draft complete after its very first pick); it
// falls back to the live draftRosterSize() derivation, exactly like every
// other draftRounds() consumer (rosterShape.js, client components). Picked 3
// of the fallback-derived 4 total picks: the buggy `* null` path would
// already read complete (3 >= 0) where the fallback correctly reads active
// (3 < 4), so this asserts false, not true — a true result on either path
// would prove nothing.
test('draftPlayer: an active league with a null draft_rounds falls back to the live derivation, not `teams.length * null`', async (t) => {
  const league = { ...completionLeague, roster_limit: 3, ir_slots: 1, draft_rounds: null, current_pick: 2 };
  const fake = completionPool({ league, picksMade: 3 }).install(t);

  const result = await draftPlayer({ leagueId: 1, userId: 8, playerId: 500 });

  // roster_limit 3 - ir_slots 1 = 2 rounds x 2 teams = 4 totalPicks; 3 < 4.
  assert.equal(result.draftComplete, false);
  fake.assertClean();
});
