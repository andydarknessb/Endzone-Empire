const test = require('node:test');
const assert = require('node:assert/strict');
const { teamIndexForPick, addFreeAgent, undoDrop } = require('../services/draft.service');
const lineupService = require('../services/lineup.service');
const { createFakePool, select, insert, remove } = require('./helpers/fakePool');
const { installRecordingBroadcast } = require('./helpers/recordingBroadcast');

/**
 * draft.service after #782: the Pick commit and its room fan-out moved to
 * pick.service (landPick, tested in pick.service.test.js). What stays here is the
 * snake-index helper, the POST-draft free-agent add (addFreeAgent, which is NOT a
 * Pick - CONTEXT.md), and the drop-undo path.
 */

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
  assert.equal(teamIndexForPick(0, 12), 0);
  assert.equal(teamIndexForPick(11, 12), 11);
  assert.equal(teamIndexForPick(12, 12), 11);
  assert.equal(teamIndexForPick(23, 12), 0);
  assert.equal(teamIndexForPick(24, 12), 0);
});

// --- addFreeAgent: the post-draft free-agent add (#782 ruling 2) -------------
// Not a Pick: it refuses unless the draft is complete, shares the Pick path's
// roster-capacity / position-cap / on-waivers checks, and fans out rosterChanged
// only. The capacity formula itself is tested at irPolicy.service.test.js.

const freeAgencyLeague = {
  id: 1,
  draft_status: 'complete',
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  pickem_only: false,
  roster_limit: 3,
  ir_slots: 1,
  draft_rounds: 2,
  position_caps: {},
  waivers_clear_at: null,
  current_season: 2026,
  current_week: 3,
};

function freeAgencyPool({ rostered, stashed, stashQueries, onWaivers = false }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [freeAgencyLeague] })],
    [select('teams'), () => ({ rows: [
      { id: 11, name: 'Team Eleven', owner_id: 7, draft_position: 1, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, (text, params) => {
      if (stashQueries) stashQueries.push(params);
      return { rows: [{ n: stashed }] };
    }],
    [select('waiver_players'), () => ({ rows: onWaivers ? [{ 1: 1 }] : [] })],
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

test('addFreeAgent: an active draft is a 409 - a Pick is not a free-agent add (#782 ruling 2)', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{ ...freeAgencyLeague, draft_status: 'active' }] })],
  ]).install(t);
  const recorder = installRecordingBroadcast(t);

  await assert.rejects(
    addFreeAgent({ leagueId: 1, userId: 7, playerId: 500 }),
    { statusCode: 409, message: 'the draft is not complete' }
  );
  assert.deepEqual(recorder.calls, [], 'a refusal emits nothing');
  fake.assertClean();
});

test('addFreeAgent: a complete league with the player on waivers gets the existing waivers 409', async (t) => {
  const fake = freeAgencyPool({ rostered: 0, stashed: 0, onWaivers: true }).install(t);
  const recorder = installRecordingBroadcast(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  await assert.rejects(
    addFreeAgent({ leagueId: 1, userId: 7, playerId: 500 }),
    { statusCode: 409, message: 'player is on waivers; submit a waiver claim instead' }
  );
  assert.equal(fake.matching(insert('team_players')).length, 0, 'the player was not rostered');
  assert.deepEqual(recorder.calls, [], 'a refusal emits nothing');
  fake.assertClean();
});

test('addFreeAgent: a complete league with a free player records exactly one rosterChanged and no pickLanded', async (t) => {
  const fake = freeAgencyPool({ rostered: 0, stashed: 0 }).install(t);
  const recorder = installRecordingBroadcast(t);
  recordBenching(t, fake);

  const outcome = await addFreeAgent({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(outcome.player.id, 500);
  assert.equal(outcome.teamId, 11);
  assert.deepEqual(recorder.calls.map((c) => c.method), ['rosterChanged'], 'exactly one rosterChanged, and no pickLanded');
  assert.equal(recorder.calls[0].leagueId, 1);
  fake.assertClean();
});

test('addFreeAgent: a full team with no stash is rejected at the draft roster size', async (t) => {
  // roster_limit 3, ir_slots 1: draft roster size 2, and an empty stash grants
  // nothing beyond it.
  const fake = freeAgencyPool({ rostered: 2, stashed: 0 }).install(t);
  const recorder = installRecordingBroadcast(t);

  await assert.rejects(
    addFreeAgent({ leagueId: 1, userId: 7, playerId: 500 }),
    { statusCode: 409, message: 'roster capacity of 2 reached' }
  );
  assert.equal(fake.matching(insert('team_players')).length, 0, 'the player was not rostered');
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no transaction was logged');
  assert.deepEqual(recorder.calls, [], 'a refusal emits nothing');
  fake.assertClean();
});

test('addFreeAgent: an eligible IR stash grants the extra spot', async (t) => {
  const stashQueries = [];
  const fake = freeAgencyPool({ rostered: 2, stashed: 1, stashQueries }).install(t);
  installRecordingBroadcast(t);
  const benched = recordBenching(t, fake);

  const result = await addFreeAgent({ leagueId: 1, userId: 7, playerId: 500 });

  assert.equal(result.player.id, 500);
  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 1);
  // A free-agent add earns no restored credit and lands on the bench (user story
  // 13): it passes no restored ids, so the capacity query carries no fourth
  // parameter and no interrupted-stash record is read at all.
  assert.equal(stashQueries[0].length, 3);
  assert.equal(fake.matching(/FROM "waiver_players"/).length, 1, 'only the on-waivers check');
  assert.deepEqual(benched, [{ league: freeAgencyLeague, teamId: 11, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});

// --- undoDrop ----------------------------------------------------------------

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
  assert.equal(fake.matching(remove('waiver_players')).length, 0, 'the waiver row survived');
  assert.equal(fake.matching(insert('team_players')).length, 0, 'the player was not re-rostered');
  fake.assertClean();
});

const undoLeague = {
  id: 1, roster_limit: 3, ir_slots: 1, position_caps: {}, current_season: 2026, current_week: 4,
};

/**
 * An undo world. `stashed` answers the capacity count for the players still on
 * the roster; `interrupted` is the record the drop left on the waiver hold, which
 * is what an undo replays now that the stale lineup row it used to read is deleted
 * by the drop (#197).
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

  assert.deepEqual(benched, []);
  assert.deepEqual(restored[0].irAttested, true);
  fake.assertClean();
});

test('undoDrop: a designation that cleared while he was on waivers benches him', async (t) => {
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

  assert.deepEqual(restored, []);
  assert.deepEqual(benched, [{ league: undoLeague, teamId: 11, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});
