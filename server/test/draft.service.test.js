const test = require('node:test');
const assert = require('node:assert/strict');
const { teamIndexForPick, draftPlayer, undoDrop } = require('../services/draft.service');
const seasonService = require('../services/season.service');
const lineupService = require('../services/lineup.service');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');

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
      { id: 11, owner_id: 7, name: 'Team Eleven', draft_position: 1, autodraft: false, locked: false },
      { id: 12, owner_id: 8, name: 'Team Twelve', draft_position: 2, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: picksMade }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    // The Pick's Draft activity, written in the same transaction (#435). The
    // BEFORE INSERT trigger allocates feed_seq; the fake returns it on RETURNING.
    [insert('draft_activity'), () => ({ rows: [{ id: 77, feed_seq: '5', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
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

test('draftPlayer: a committed Pick appends its Draft-activity entry in the same transaction (#435)', async (t) => {
  const fake = completionPool({ league: { ...completionLeague, current_pick: 0 }, picksMade: 1 }).install(t);
  recordBenching(t, fake);

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 });

  // Exactly one activity row, written alongside the one Pick row.
  assert.equal(fake.matching(insert('draft_picks')).length, 1, 'one pick recorded');
  assert.equal(fake.matching(insert('draft_activity')).length, 1, 'one activity appended');
  // The outcome carries the typed entry the broadcast will hand the feed.
  assert.equal(result.activity.type, 'draft_activity');
  assert.equal(result.activity.kind, 'pick');
  assert.equal(result.activity.seq, 5);
  assert.equal(result.activity.teamId, 11);
  assert.equal(result.activity.teamName, 'Team Eleven');
  assert.deepEqual(result.activity.player, { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' });
  assert.equal(result.activity.round, 1);
  assert.equal(result.activity.pickNumber, 1);
  assert.equal(result.activity.isAutopick, false);
  fake.assertClean();
});

test('draftPlayer: an autopick labels its activity isAutopick (#435 AC3)', async (t) => {
  const fake = completionPool({ league: { ...completionLeague, current_pick: 0 }, picksMade: 1 }).install(t);
  recordBenching(t, fake);

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500, auto: true });

  assert.equal(result.activity.isAutopick, true, 'the write knew this pick was an autopick');
  fake.assertClean();
});

// A completion-aware pool: the draft_activity insert is stateful so the Pick
// and the completion draw DISTINCT feed_seqs (5 then 6), the way the shared
// trigger allocates them.
function completionActivityPool({ league, picksMade }) {
  let seq = 5;
  return createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [
      { id: 11, owner_id: 7, name: 'Team Eleven', draft_position: 1, autodraft: false, locked: false },
      { id: 12, owner_id: 8, name: 'Team Twelve', draft_position: 2, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: picksMade }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 70 + seq, feed_seq: String(seq++), created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ pick_deadline_at: null }] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

test('draftPlayer: the final Pick appends an actor-less completion lifecycle entry (#437)', async (t) => {
  const fake = completionActivityPool({ league: completionLeague, picksMade: 4 }).install(t);
  recordBenching(t, fake);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  // Two activity rows: the Pick and the completion, both in this transaction.
  assert.equal(fake.matching(insert('draft_activity')).length, 2, 'pick + completion appended');
  // The Pick entry is unchanged (#435).
  assert.equal(result.activity.kind, 'pick');
  // The completion is a state transition no manager performed: it carries no
  // actor Team (not fabricated, #437 AC5) and no Pick facts.
  assert.ok(result.completion, 'the outcome carries the completion entry');
  assert.equal(result.completion.type, 'draft_activity');
  assert.equal(result.completion.kind, 'complete');
  assert.equal(result.completion.teamId, null);
  assert.equal(result.completion.teamName, null);
  assert.equal('player' in result.completion, false);
  // It orders AFTER the Pick by the shared sequence.
  assert.ok(result.completion.seq > result.activity.seq, 'completion follows the final Pick');
  fake.assertClean();
});

test('draftPlayer: a non-final Pick carries no completion entry', async (t) => {
  const fake = completionActivityPool({ league: { ...completionLeague, current_pick: 0 }, picksMade: 1 }).install(t);
  recordBenching(t, fake);

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, false);
  assert.equal(result.completion, null, 'no completion entry until the draft actually completes');
  assert.equal(fake.matching(insert('draft_activity')).length, 1, 'only the Pick activity');
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

// --- autopick-type drafts have no manual Pick, server-side too (#120) -----

test('draftPlayer: rejects a manual (non-auto) pick in an active autopick-type draft', async (t) => {
  const league = { ...completionLeague, draft_type: 'autopick' };
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [
      { id: 11, owner_id: 7, draft_position: 1, autodraft: true, locked: false },
      { id: 12, owner_id: 8, draft_position: 2, autodraft: true, locked: false },
    ] })],
    // #274: the reads and writes a manual pick would need past this guard, so
    // the counts below observe an absence rather than inherit fakePool's
    // "unexpected query" throw.
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [select('draft_picks'), () => ({ rows: [] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [select('waiver_players'), () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  await assert.rejects(
    () => draftPlayer({ leagueId: 1, userId: 7, playerId: 500 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /autopick draft/);
      return true;
    }
  );
  // #274. This fixture used to register no write handlers, so a guard moved
  // below the writes died on fakePool's "unexpected query" rather than on an
  // assertion. That protection was incidental to the fixture being
  // incomplete, it reported the wrong thing, and it would have evaporated the
  // moment someone added a handler for convenience. The writes are answered
  // above now, so these counts are the assertion.
  assert.equal(fake.matching(insert('draft_picks')).length, 0, 'no pick was recorded');
  assert.equal(fake.matching(insert('team_players')).length, 0, 'no player was rostered');
  assert.equal(fake.matching(update('leagues')).length, 0, 'the clock did not advance');
  fake.assertClean();
});

test('draftPlayer: still accepts the Pick clock module\'s own auto: true pick in an autopick-type draft', async (t) => {
  const league = { ...completionLeague, draft_type: 'autopick' };
  const fake = completionPool({ league, picksMade: 4 }).install(t);
  recordBenching(t, fake);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500, auto: true });

  assert.equal(result.draftComplete, true);
  fake.assertClean();
});

test('draftPlayer: a zero-IR league still drafts every roster_limit round', async (t) => {
  const league = { ...completionLeague, ir_slots: 0, draft_rounds: 3 };
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

// ADR 0005: an active draft's completion check reads the fixed draft_rounds,
// never re-derives it from roster_limit/ir_slots. roster_limit/ir_slots below
// would derive 9 rounds live (a settings edit long after the draft roster
// size was already frozen) if draftPlayer still called draftRosterSize(); the
// fixed draft_rounds of 2 is what must actually govern completion.
test('draftPlayer: completion uses the fixed draft_rounds even when roster_limit/ir_slots would derive something else', async (t) => {
  const league = { ...completionLeague, roster_limit: 20, ir_slots: 1, draft_rounds: 2 };
  const fake = completionPool({ league, picksMade: 4 }).install(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

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
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  const result = await draftPlayer({ leagueId: 1, userId: 8, playerId: 500 });

  // roster_limit 3 - ir_slots 1 = 2 rounds x 2 teams = 4 totalPicks; 3 < 4.
  assert.equal(result.draftComplete, false);
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
  // #274, and this one has no accidental protection at all: freeAgencyPool
  // registers live insert('team_players') and insert('transactions')
  // handlers, so moving the capacity guard below the roster write rosters
  // the player, throws, rolls back, and answers the same 409 with the same
  // message. Without these counts nothing in this test could tell.
  assert.equal(fake.matching(insert('team_players')).length, 0, 'the player was not rostered');
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no transaction was logged');
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
  // story 13): it passes no restored ids, so the capacity query carries no
  // fourth parameter and no interrupted-stash record is read at all.
  assert.equal(stashQueries[0].length, 3);
  assert.equal(fake.matching(/FROM "waiver_players"/).length, 1, 'only the on-waivers check');
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
  // #274. undoDrop restores by clearing the waiver row and re-rostering, so
  // a guard below that work would consume the undo and still refuse. As
  // above, this fixture's silence about the writes is not an assertion.
  assert.equal(fake.matching(remove('waiver_players')).length, 0, 'the waiver row survived');
  assert.equal(fake.matching(insert('team_players')).length, 0, 'the player was not re-rostered');
  fake.assertClean();
});

const undoLeague = {
  id: 1, roster_limit: 3, ir_slots: 1, position_caps: {}, current_season: 2026, current_week: 4,
};

/**
 * An undo world. `stashed` answers the capacity count for the players still
 * on the roster; `interrupted` is the record the drop left on the waiver
 * hold, which is what an undo replays now that the stale lineup row it used
 * to read is deleted by the drop (#197).
 */
function undoWorld({ rostered = 2, stashed, interrupted = null, onStashQuery }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [undoLeague] })],
    [select('teams'), () => ({ rows: [{ id: 11, owner_id: 7, locked: false }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT "waiver_players"\."interrupted_slot"/, () => ({
      rows: interrupted ? [interrupted] : [],
    })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, (text, params) => {
      if (onStashQuery) onStashQuery(params);
      return { rows: [{ n: stashed }] };
    }],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Stash Returner', position: 'RB' }] })],
    [/^DELETE FROM "waiver_players"/, () => ({ rows: [] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
  ]);
}

/** Mock the stash restore and record each call, like recordBenching. */
function recordRestoring(t) {
  const restored = [];
  t.mock.method(lineupService, 'restoreInterruptedStash', async (client, args) => {
    restored.push(args);
  });
  return restored;
}

test('undoDrop: the stash his drop interrupted still grants its spot on the way back in', async (t) => {
  // Draft roster size 2, ir_slots 1, roster legally 3 with player 500
  // stashed; he was dropped (roster now 2, and his IR row went with the drop)
  // and the hold recorded the stash. The undo restores that exact state, so
  // it must pass at capacity 3 - and, the stash still being valid, he is put
  // back in it rather than benched.
  let stashParams;
  const fake = undoWorld({
    stashed: 0,
    interrupted: { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
    onStashQuery: (params) => { stashParams = params; },
  }).install(t);
  const benched = recordBenching(t, fake);
  const restored = recordRestoring(t);

  const result = await undoDrop({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.player.id, 500);
  // The count itself no longer carries a restored-player list; the credit is
  // the separate record read.
  assert.equal(stashParams.length, 3);
  assert.deepEqual(benched, []);
  assert.deepEqual(restored, [{
    league: undoLeague, teamId: 11, playerId: 500, slot: 'IR', irAttested: false,
  }]);
  fake.assertClean();
});

test('undoDrop: the interrupted-stash record is read twice, deliberately', async (t) => {
  const fake = undoWorld({
    stashed: 0,
    interrupted: { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
  }).install(t);
  recordBenching(t, fake);
  recordRestoring(t);

  await undoDrop({ leagueId: 1, userId: 7, playerId: 500 });

  // Once inside rosterCapacity (through restoredPlayerIds) and once in
  // undoDrop for the restore decision. Kept on purpose (#222): passing the
  // record INTO rosterCapacity gives up its re-derivation property, and
  // handing it BACK widens a return value four other call sites read as a
  // bare number. The reasoning, and the one axis on which the two reads can
  // genuinely disagree, is at the second read in draft.service.js.
  //
  // If you are here to remove one of them, that is the trade to argue with.
  assert.equal(fake.matching(/^SELECT "waiver_players"\."interrupted_slot"/).length, 2);
  fake.assertClean();
});

test('undoDrop: an attested stash comes back attested', async (t) => {
  const fake = undoWorld({
    stashed: 0,
    interrupted: { interrupted_slot: 'IR', interrupted_ir_attested: true, injury_status: 'Q' },
  }).install(t);
  const benched = recordBenching(t, fake);
  const restored = recordRestoring(t);

  await undoDrop({ leagueId: 1, userId: 7, playerId: 500 });

  // The commissioner's override (#100) rides the undo: a drop is not the
  // manager slot move that ends an attestation.
  assert.deepEqual(benched, []);
  assert.deepEqual(restored[0].irAttested, true);
  fake.assertClean();
});

test('undoDrop: a designation that cleared while he was on waivers benches him', async (t) => {
  // Player 500 recovered after the drop: the hold still records the IR slot,
  // but he is only questionable now and nothing attested it. With 2 rostered
  // at draft roster size 2 the undo would be out of capacity; with room
  // (1 rostered) it lands him on the bench rather than restoring an ungated
  // stash past the placement gate.
  const fake = undoWorld({
    rostered: 1,
    stashed: 0,
    interrupted: { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'Q' },
  }).install(t);
  const benched = recordBenching(t, fake);
  const restored = recordRestoring(t);

  const result = await undoDrop({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.player.id, 500);
  assert.deepEqual(restored, []);
  assert.deepEqual(benched, [{ league: undoLeague, teamId: 11, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});

test('undoDrop: a player who had no current-week row when he was dropped benches', async (t) => {
  const fake = undoWorld({ rostered: 1, stashed: 0, interrupted: null }).install(t);
  const benched = recordBenching(t, fake);
  const restored = recordRestoring(t);

  await undoDrop({ leagueId: 1, userId: 7, playerId: 500 });

  // Nothing was recorded, so there is nothing to replay. This is also the
  // shape of every pre-#197 hold: an old row with null columns benches, it
  // does not throw.
  assert.deepEqual(restored, []);
  assert.deepEqual(benched, [{ league: undoLeague, teamId: 11, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});

// #194: the final live pick completes the draft and generates the season
// schedule on ONE transaction, and season operations now refuse a league that
// is still pre-draft or drafting. This path survives the gate only because the
// UPDATE setting draft_status = 'complete' runs before generateRegularSeason is
// called on that same client. The other completion tests above mock season
// operations out, so nothing there would notice a reordering; this one runs the
// real generateRegularSeason against a fake that honours the transaction's own
// write.
test('draftPlayer: the completing pick schedules the season for real, gate and all (#194)', async (t) => {
  const row = { ...completionLeague, current_season: 2026, regular_season_weeks: 1 };
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{ ...row }] })],
    [select('teams'), () => ({ rows: [
      { id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false },
      { id: 12, owner_id: 8, draft_position: 2, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: 4 }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 78, feed_seq: '9', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [select('matchups'), () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), (text, params) => {
      // A real client reads back its own uncommitted write; the gate depends on it.
      if (/^UPDATE "leagues" SET "current_pick"/.test(text)) row.draft_status = params[1];
      return { rows: [{ pick_deadline_at: null }] };
    }],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
  recordBenching(t, fake);
  // generateRegularSeason is deliberately NOT mocked here.

  const result = await draftPlayer({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  // The schedule exists: 2 teams over 1 regular-season week is one matchup.
  assert.equal(fake.matching(insert('matchups')).length, 1);

  const completedAt = fake.calls.findIndex(
    (c) => /^UPDATE "leagues" SET "current_pick"/.test(c.text) && c.params[1] === 'complete'
  );
  const scheduledAt = fake.calls.findIndex((c) => /"matchups"/.test(c.text));
  assert.ok(completedAt !== -1 && scheduledAt !== -1);
  assert.ok(
    completedAt < scheduledAt,
    'draft_status must be set to complete before generateRegularSeason is called'
  );
  fake.assertClean();
});
