const test = require('node:test');
const assert = require('node:assert/strict');
const { landPick } = require('../services/pick.service');
const pickService = require('../services/pick.service');
const seasonService = require('../services/season.service');
const draftCompletion = require('../services/draftCompletion');
const pickClock = require('../services/pickClock.service');
const lineupService = require('../services/lineup.service');
const draftRoomBroadcast = require('../modules/draftRoomBroadcast');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { installRecordingBroadcast } = require('./helpers/recordingBroadcast');

/**
 * A Pick lands in one place (#782). landPick is the ONE seam every Pick reaches:
 * it commits the Pick (the transaction moved from the old draft.service.draftPlayer)
 * and, after COMMIT, fans the outcome out to the room through the one Draft room
 * adapter (#745). These tests drive landPick against a fakePool and a recording
 * broadcast and assert BOTH halves: the committed outcome (the migrated commit
 * coverage) and the exact fan-out matrix (AC1).
 *
 * The commit half used to live in draft.service.test.js against draftPlayer; it
 * moved here with the body. The free-agent-add half stayed in draft.service.test.js
 * (addFreeAgent), which is the post-draft acquisition that is NOT a Pick.
 */

const LEAGUE_ID = 1;

// A league mid-draft, 2 teams x 2 rounds = 4 total picks. current_pick / picksMade
// vary per fixture. roster_limit 3 - ir_slots 1 = draft roster size 2 = draft_rounds.
const BASE_LEAGUE = {
  id: LEAGUE_ID,
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

const TEAMS = [
  { id: 11, owner_id: 7, name: 'Team Eleven', draft_position: 1, autodraft: false, locked: false },
  { id: 12, owner_id: 8, name: 'Team Twelve', draft_position: 2, autodraft: false, locked: false },
];

/** A world covering the whole commitPick transaction. `commissioner` adds the
 *  `SELECT 1 FROM "leagues"` answer the byCommissioner authority check reads. */
function pickPool({
  league, picksMade, commissioner = false, playerAdp = 3.2, takenPickNumbers = [],
} = {}) {
  // Stateful: the completing Pick's draft_status flip is visible to the
  // precondition read draftCompletion.completeDraft runs on this same client
  // (#789), the way a real client reads back its own write.
  const row = { ...league };
  const handlers = [];
  if (commissioner) {
    handlers.push([/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })]);
  }
  handlers.push(
    [select('leagues'), () => ({ rows: [{ ...row }] })],
    [select('teams'), () => ({ rows: TEAMS.map((t) => ({ ...t })) })],
    // #833: the player read now names `adp`, which rides on the draft:picked
    // outcome. The row carries adp ONLY when the real SELECT names it, so a test
    // asserting outcome.player.adp is a true red-tell against dropping the column.
    [select('players'), (text) => ({
      rows: [{
        id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC',
        ...(/"adp"/.test(text) ? { adp: playerAdp } : {}),
      }],
    })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: picksMade }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: takenPickNumbers.map((pick_number) => ({ pick_number })) })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    // The draft_activity insert is stateful so the Pick (5) and, on completion,
    // the completion entry (6) draw distinct feed_seqs the way the trigger does.
    [insert('draft_activity'), (() => { let s = 5; return () => ({ rows: [{ id: 70 + s, feed_seq: String(s++), created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 }); })()],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), (text, params) => {
      // The clock's advance statement carries the draft_status flip; the waiver
      // window's own UPDATE (#789) leaves the status alone.
      if (/^UPDATE "leagues" SET "current_pick"/.test(text)) {
        row.draft_status = params[1];
        return { rows: [{ pick_deadline_at: null }] };
      }
      return { rows: [], rowCount: 1 };
    }],
    [update('teams'), () => ({ rows: [], rowCount: 1 })]
  );
  return createFakePool(handlers);
}

/** Mock the bench step so no live lineup query runs; return the recorder. */
function withRecorder(t) {
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  return installRecordingBroadcast(t);
}

// --- AC1: the fan-out matrix ------------------------------------------------

test('landPick: a manual Pick records exactly pickLanded with auto:false', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1 }).install(t);
  const recorder = withRecorder(t);

  const outcome = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(recorder.calls.length, 1, 'exactly one adapter call');
  assert.equal(recorder.calls[0].method, 'pickLanded');
  assert.equal(recorder.calls[0].leagueId, LEAGUE_ID);
  assert.equal(recorder.calls[0].payload.auto, false, 'a manual pick is not an autopick');
  assert.deepEqual(recorder.calls[0].payload, { ...outcome, auto: false });
  fake.assertClean();
});

test('landPick: an auto:true Pick records pickLanded with auto:true', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1 }).install(t);
  const recorder = withRecorder(t);

  await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500, auto: true });

  assert.deepEqual(recorder.calls.map((c) => c.method), ['pickLanded']);
  assert.equal(recorder.calls[0].payload.auto, true, 'the broadcast marks the pick auto');
  fake.assertClean();
});

test('landPick: a byCommissioner Pick records the same fan-out as a manual one', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1, commissioner: true }).install(t);
  const recorder = withRecorder(t);

  // userId 999 is the commissioner but owns neither team; the Pick lands on the
  // team the clock resolves, not the caller's team.
  await landPick({ leagueId: LEAGUE_ID, userId: 999, playerId: 500, byCommissioner: true });

  assert.deepEqual(recorder.calls.map((c) => c.method), ['pickLanded']);
  assert.equal(recorder.calls[0].payload.auto, false, 'a commissioner-entered pick is not an autopick');
  assert.equal(recorder.calls[0].payload.teamId, 11, 'the pick landed on the team on the clock');
  fake.assertClean();
});

test('landPick: the Pick that completes the draft fans out pickLanded, activityAppended, rosterChanged, draftCompleted in order', async (t) => {
  const fake = pickPool({ league: BASE_LEAGUE, picksMade: 4 }).install(t);
  const recorder = withRecorder(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const outcome = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(outcome.draftComplete, true);
  assert.deepEqual(
    recorder.calls.map((c) => c.method),
    ['pickLanded', 'activityAppended', 'rosterChanged', 'draftCompleted'],
    'the completing Pick fans all four out, in order'
  );
  // The activityAppended payload is the completion lifecycle entry.
  const appended = recorder.calls.find((c) => c.method === 'activityAppended');
  assert.equal(appended.payload.kind, 'complete');
  assert.equal(appended.payload, outcome.completion);
  // rosterChanged sits BETWEEN the completion activity and draftCompleted: the red
  // tell for AC1 is removing this call, which drops it from the sequence above.
  assert.equal(recorder.calls[2].method, 'rosterChanged');
  fake.assertClean();
});

// --- the commit is authoritative: a fan-out failure never fails the Pick -----

test('landPick: a post-COMMIT room fan-out failure never throws the committed Pick away (commit is authoritative)', async (t) => {
  const outcome = {
    leagueId: LEAGUE_ID, teamId: 11, teamName: 'Team Eleven', player: { id: 500 },
    pickNumber: 1, nextTeamId: null, draftComplete: false, pickDeadlineAt: null,
    activity: {}, completion: null,
  };
  t.mock.method(pickService, 'commitPick', async () => outcome);
  // Unregister the process broadcast so getDraftRoomBroadcast() throws - the #765
  // shape the offline-route regression rode in on. Without landPick's containment
  // this throw escapes and the caller misreports a landed Pick as failed.
  const prior = draftRoomBroadcast.peekDraftRoomBroadcast();
  draftRoomBroadcast.setDraftRoomBroadcast(null);
  t.after(() => draftRoomBroadcast.setDraftRoomBroadcast(prior));

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(result, outcome, 'landPick resolved with the committed outcome despite the fan-out failure');
});

// --- #833 AC2 (the draft:picked half): the outcome carries the player's ADP ---

test('landPick: the committed outcome carries the player market ADP (#833 AC2)', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1, playerAdp: 3.2 }).install(t);
  withRecorder(t);

  const outcome = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  // Present and equal to players.adp. Red-tell: drop `"adp"` from the players
  // SELECT in pick.service.js and outcome.player.adp is undefined, not 3.2.
  assert.equal(outcome.player.adp, 3.2);
  fake.assertClean();
});

test('landPick: the outcome ADP is null when the player has no market ADP (#833 AC2)', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1, playerAdp: null }).install(t);
  withRecorder(t);

  const outcome = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.strictEqual(outcome.player.adp, null);
  fake.assertClean();
});

// --- landPick refuses a non-active draft (the mirror of addFreeAgent's 409) --

test('landPick: a completed draft is a 409, not a Pick (free agency is addFreeAgent)', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{ ...BASE_LEAGUE, draft_status: 'complete' }] })],
  ]).install(t);
  // No broadcast is registered on purpose: a refusal never reaches the fan-out,
  // so getDraftRoomBroadcast() is never called.
  await assert.rejects(
    () => landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 }),
    { statusCode: 409, message: 'the draft is not active' }
  );
  fake.assertClean();
});

// --- migrated commit coverage (was draft.service.test.js against draftPlayer) -

test('landPick: the draft completes at teams x draft roster size, not x roster_limit', async (t) => {
  const fake = pickPool({ league: BASE_LEAGUE, picksMade: 4 }).install(t);
  withRecorder(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  assert.equal(result.nextTeamId, null);
  const leagueUpdate = fake.matching(/^UPDATE "leagues" SET "current_pick"/)[0];
  assert.equal(leagueUpdate.params[1], 'complete');
  fake.assertClean();
});

test('landPick: a committed Pick appends its Draft-activity entry in the same transaction (#435)', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1 }).install(t);
  withRecorder(t);

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(fake.matching(insert('draft_picks')).length, 1, 'one pick recorded');
  assert.equal(fake.matching(insert('draft_activity')).length, 1, 'one activity appended');
  assert.equal(result.activity.type, 'draft_activity');
  assert.equal(result.activity.kind, 'pick');
  assert.equal(result.activity.teamId, 11);
  assert.equal(result.activity.teamName, 'Team Eleven');
  assert.deepEqual(result.activity.player, { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' });
  assert.equal(result.activity.round, 1);
  assert.equal(result.activity.pickNumber, 1);
  assert.equal(result.activity.isAutopick, false);
  fake.assertClean();
});

test('landPick: an autopick labels its activity isAutopick (#435 AC3)', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1 }).install(t);
  withRecorder(t);

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500, auto: true });

  assert.equal(result.activity.isAutopick, true, 'the write knew this pick was an autopick');
  fake.assertClean();
});

test('landPick: the final Pick appends an actor-less completion lifecycle entry (#437)', async (t) => {
  const fake = pickPool({ league: BASE_LEAGUE, picksMade: 4 }).install(t);
  withRecorder(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  assert.equal(fake.matching(insert('draft_activity')).length, 2, 'pick + completion appended');
  assert.equal(result.activity.kind, 'pick');
  assert.ok(result.completion, 'the outcome carries the completion entry');
  assert.equal(result.completion.kind, 'complete');
  assert.equal(result.completion.teamId, null);
  assert.equal(result.completion.teamName, null);
  assert.equal('player' in result.completion, false);
  assert.ok(result.completion.seq > result.activity.seq, 'completion follows the final Pick');
  fake.assertClean();
});

test('landPick: a non-final Pick carries no completion entry', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1 }).install(t);
  withRecorder(t);

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, false);
  assert.equal(result.completion, null, 'no completion entry until the draft actually completes');
  fake.assertClean();
});

test('landPick: one pick short of the draft roster size keeps the draft active', async (t) => {
  // Pick 3 of 4: team 12 is on the clock (0-based current_pick 2).
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 2 }, picksMade: 3 }).install(t);
  withRecorder(t);

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 8, playerId: 500 });

  assert.equal(result.draftComplete, false);
  const leagueUpdate = fake.matching(/^UPDATE "leagues" SET "current_pick"/)[0];
  assert.equal(leagueUpdate.params[1], 'active');
  fake.assertClean();
});

test('landPick: rejects a manual (non-auto) pick in an active autopick-type draft', async (t) => {
  const league = { ...BASE_LEAGUE, current_pick: 0, draft_type: 'autopick' };
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [
      { id: 11, owner_id: 7, draft_position: 1, autodraft: true, locked: false },
      { id: 12, owner_id: 8, draft_position: 2, autodraft: true, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  await assert.rejects(
    () => landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /autopick draft/);
      return true;
    }
  );
  assert.equal(fake.matching(insert('draft_picks')).length, 0, 'no pick was recorded');
  assert.equal(fake.matching(insert('team_players')).length, 0, 'no player was rostered');
  fake.assertClean();
});

test("landPick: still accepts the Pick clock module's own auto:true pick in an autopick-type draft", async (t) => {
  const league = { ...BASE_LEAGUE, draft_type: 'autopick' };
  const fake = pickPool({ league, picksMade: 4 }).install(t);
  withRecorder(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500, auto: true });

  assert.equal(result.draftComplete, true);
  fake.assertClean();
});

test('landPick: completion uses the fixed draft_rounds even when roster_limit/ir_slots would derive something else (ADR 0005)', async (t) => {
  const league = { ...BASE_LEAGUE, roster_limit: 20, ir_slots: 1, draft_rounds: 2 };
  const fake = pickPool({ league, picksMade: 4 }).install(t);
  withRecorder(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  fake.assertClean();
});

test('landPick: a zero-IR league still drafts every roster_limit round', async (t) => {
  const league = { ...BASE_LEAGUE, ir_slots: 0, draft_rounds: 3 };
  withRecorder(t);
  // 2 teams x 3 rounds = 6 picks. The 4th pick ends a 1-IR league but not this one.
  const midDraft = pickPool({ league, picksMade: 4 }).install(t);
  assert.equal((await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 })).draftComplete, false);
  midDraft.assertClean();

  const fake = pickPool({ league, picksMade: 6 }).install(t);
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));
  assert.equal((await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 })).draftComplete, true);
  fake.assertClean();
});

test('landPick: an active league with a null draft_rounds falls back to the live derivation, not `teams.length * null`', async (t) => {
  const league = { ...BASE_LEAGUE, roster_limit: 3, ir_slots: 1, draft_rounds: null, current_pick: 2 };
  const fake = pickPool({ league, picksMade: 3 }).install(t);
  withRecorder(t);

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 8, playerId: 500 });

  // roster_limit 3 - ir_slots 1 = 2 rounds x 2 teams = 4 totalPicks; 3 < 4.
  assert.equal(result.draftComplete, false);
  fake.assertClean();
});

// --- #854: the outcome carries nextPickIndex, the value written to the clock --
// The room reducer follows league.current_pick to this field, so it must be the
// EXACT value the Pick clock was handed as `nextPick` in this same commit, never
// a re-derivation. Each case mocks onPickLanded to capture that argument and
// asserts the outcome's nextPickIndex equals it.

test('landPick: the outcome nextPickIndex equals the clock nextPick on an ordinary pick', async (t) => {
  const fake = pickPool({ league: { ...BASE_LEAGUE, current_pick: 0 }, picksMade: 1 }).install(t);
  withRecorder(t);
  let clockNextPick;
  t.mock.method(pickClock, 'onPickLanded', async (client, { nextPick }) => {
    clockNextPick = nextPick;
    return null;
  });

  const outcome = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  // No keepers taken, so the next open index is current_pick + 1 = 1.
  assert.equal(clockNextPick, 1, 'the clock was advanced to the next open index');
  assert.equal(outcome.nextPickIndex, clockNextPick, 'the outcome carries the exact value written to the clock');
  assert.equal(outcome.draftComplete, false);
  fake.assertClean();
});

test('landPick: the outcome nextPickIndex is the next OPEN index when a keeper occupies the following slot', async (t) => {
  // current_pick 0; index 1 is a pre-inserted keeper (pick_number 2), so the
  // next open index is 2, not current_pick + 1. picks 1 and 2 are taken.
  const fake = pickPool({
    league: { ...BASE_LEAGUE, current_pick: 0 },
    picksMade: 2,
    takenPickNumbers: [1, 2],
  }).install(t);
  withRecorder(t);
  let clockNextPick;
  t.mock.method(pickClock, 'onPickLanded', async (client, { nextPick }) => {
    clockNextPick = nextPick;
    return null;
  });

  const outcome = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(clockNextPick, 2, 'the clock skipped the keeper slot to index 2');
  assert.equal(outcome.nextPickIndex, 2, 'the outcome carries the keeper-skipped index, never current_pick + 1');
  assert.notEqual(outcome.nextPickIndex, 1, 'a naive +1 would be wrong in a keeper league');
  assert.equal(outcome.draftComplete, false);
  fake.assertClean();
});

test('landPick: the completing pick nextPickIndex is the completing pick number, matching the clock', async (t) => {
  const fake = pickPool({ league: BASE_LEAGUE, picksMade: 4 }).install(t);
  withRecorder(t);
  let clockNextPick;
  t.mock.method(pickClock, 'onPickLanded', async (client, { nextPick }) => {
    clockNextPick = nextPick;
    return null;
  });
  t.mock.method(draftCompletion, 'completeDraft', async () => ({ kind: 'complete', id: 78, seq: 6 }));

  const outcome = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(outcome.draftComplete, true);
  // On the last pick the clock is handed the completing pick's own number (4),
  // not a next open index; the outcome carries that same value.
  assert.equal(clockNextPick, 4, 'the completing pick hands its own number to the clock');
  assert.equal(outcome.nextPickIndex, clockNextPick, 'the outcome carries the completing pick number');
  fake.assertClean();
});

// #194 / #789: the completing pick hands off to draftCompletion.completeDraft
// AFTER the clock flips draft_status to 'complete' on this one transaction. The
// handoff's own contract - waiver window, season schedule and completion entry
// in order, and the flip-first precondition - is draftCompletion.test.js's; here
// we pin only that the caller reaches completeDraft after the flip.
test('landPick: the completing pick reaches completeDraft after the status flip (#194, #789)', async (t) => {
  const fake = pickPool({ league: BASE_LEAGUE, picksMade: 4 }).install(t);
  withRecorder(t);
  let callsAtHandoff = null;
  t.mock.method(draftCompletion, 'completeDraft', async (client, { leagueId }) => {
    assert.equal(leagueId, LEAGUE_ID);
    callsAtHandoff = fake.calls.length;
    return { kind: 'complete', id: 78 };
  });

  const result = await landPick({ leagueId: LEAGUE_ID, userId: 7, playerId: 500 });

  assert.equal(result.draftComplete, true);
  assert.equal(result.completion.kind, 'complete', 'the returned handoff entry rode out on the outcome');
  const flipAt = fake.calls.findIndex(
    (c) => /^UPDATE "leagues" SET "current_pick"/.test(c.text) && c.params[1] === 'complete'
  );
  assert.notEqual(flipAt, -1, 'the clock flipped draft_status to complete');
  assert.notEqual(callsAtHandoff, null, 'completeDraft was reached');
  assert.ok(flipAt < callsAtHandoff, 'the flip precedes the completeDraft handoff');
  fake.assertClean();
});
