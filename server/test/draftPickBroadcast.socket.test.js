const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { createSocketHarness } = require('./helpers/socketHarness');
const pickService = require('../services/pick.service');
const { autoPick } = require('../services/pickClock.service');
const { installAutopickPool } = require('./helpers/autopickFixtures');
const lineupService = require('../services/lineup.service');

/**
 * Multi-client delivery of Pick activity over the real Socket.IO wiring (#435
 * AC4, AC6). Two managers share the `league:${id}` room: one makes a Pick, and
 * this proves EVERY client in the room receives the same typed Draft-activity
 * entry on `draft:picked`, ordered after a human chat message by the shared
 * feed sequence. Both a manual Pick and an autopick are covered.
 *
 * A real socket.io server + clients through createSocketHarness; the DB is a
 * fakePool, so the feed_seq values are the fixtures' (the REAL shared-sequence
 * allocation is proven in draftActivity.pg.test.js). What THIS test proves is
 * the wiring: the entry reaches the whole room, identically, and orders after
 * the chat around it.
 */
const LEAGUE_ID = 1;
const PICKER = { userId: 42, username: 'picker', teamId: 11, teamName: 'Gridiron Ghosts' };
const WATCHER = { userId: 43, username: 'watcher', teamId: 12, teamName: 'Sunday Scaries' };

// A league mid-draft with the PICKER's Team on the clock (current_pick 0,
// draft_position 1), enough for one draftPlayer pick that does not end the draft.
const PICKED_LEAGUE = {
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
  current_pick: 0,
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  waiver_period_hours: 24,
};

const harness = createSocketHarness({ secret: 'draft-activity-broadcast-secret' });

// The narrow identity reads (lookupTeam for chat/join, isLeagueCommissioner)
// go FIRST, then the wide draftPlayer transaction reads - fakePool matches
// overrides before defaults.
function manualPickWorld(t) {
  const fake = createFakePool([
    [/^SELECT "id", "name" FROM "teams"/, (text, [leagueId, userId]) => ({
      rows:
        userId === PICKER.userId ? [{ id: PICKER.teamId, name: PICKER.teamName }]
        : userId === WATCHER.userId ? [{ id: WATCHER.teamId, name: WATCHER.teamName }]
        : [],
    })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [] })],
    [select('leagues'), () => ({ rows: [{ ...PICKED_LEAGUE }] })],
    [select('teams'), () => ({ rows: [
      { id: PICKER.teamId, name: PICKER.teamName, owner_id: PICKER.userId, draft_position: 1, autodraft: false, locked: false },
      { id: WATCHER.teamId, name: WATCHER.teamName, owner_id: WATCHER.userId, draft_position: 2, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    // The chat lands at seq 5, the Pick activity at seq 6: the activity orders
    // AFTER the human message, deterministically, for every client (#435 AC4).
    [insert('chat_messages'), () => ({ rows: [{ id: 9, created_at: '2026-09-01T00:00:00.000Z', feed_seq: '5' }], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 3, feed_seq: '6', created_at: '2026-09-01T00:00:01.000Z' }], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ pick_deadline_at: null }] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
    // The merged chat:send (#440) filters live delivery by the author's
    // blockers and de-dupes by client_msg_id; this world has neither, so both
    // read empty. (No clientMsgId is sent here, so selectChatByKey is skipped.)
    [/^SELECT "blocker_id" FROM "user_blocks"/, () => ({ rows: [] })],
    [/^SELECT "id", "message", "created_at", "feed_seq" FROM "chat_messages"/, () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  return fake;
}

test('a committed Pick reaches every client in the room as one typed activity entry, after the chat', async (t) => {
  manualPickWorld(t);
  const picker = await harness.connectAs(PICKER, t);
  const watcher = await harness.connectAs(WATCHER, t);
  await harness.emit(picker, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(watcher, 'league:join', { leagueId: LEAGUE_ID });

  // The WATCHER is a different client than the picker: it must see both the
  // human message and the Pick activity the picker's actions produce.
  const watcherChat = harness.nextEvent(watcher, 'chat:message');
  const watcherPicked = harness.nextEvent(watcher, 'draft:picked');
  const pickerPicked = harness.nextEvent(picker, 'draft:picked');

  await harness.emit(picker, 'chat:send', { leagueId: LEAGUE_ID, message: 'my pick' });
  await harness.emit(picker, 'draft:pick', { leagueId: LEAGUE_ID, playerId: 500 });

  const chat = await watcherChat;
  const watcherView = await watcherPicked;
  const pickerView = await pickerPicked;

  // Both clients received a draft:picked carrying the activity entry...
  assert.ok(watcherView.activity, 'the watcher received the Pick activity');
  assert.ok(pickerView.activity, 'the picker received the Pick activity');
  // ...and it is the SAME entry for both (one room broadcast).
  assert.deepEqual(watcherView.activity, pickerView.activity);

  const entry = watcherView.activity;
  assert.equal(entry.type, 'draft_activity');
  assert.equal(entry.kind, 'pick');
  assert.equal(entry.teamId, PICKER.teamId);
  assert.equal(entry.teamName, PICKER.teamName);
  assert.deepEqual(entry.player, { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' });
  assert.equal(entry.round, 1);
  assert.equal(entry.pickNumber, 1);
  assert.equal(entry.isAutopick, false);

  // Deterministic order relative to the human message: the activity's shared
  // sequence position is after the chat's, for every client.
  assert.equal(chat.seq, 5);
  assert.equal(entry.seq, 6);
  assert.ok(entry.seq > chat.seq, 'the Pick activity orders after the chat by the shared sequence');
});

test('an autopick reaches every client in the room, labeled isAutopick', async (t) => {
  // Join both clients first, under a small identity fake (installAutopickPool
  // re-mocks pool.query afterward, once the joins are done).
  createFakePool([
    [/^SELECT "id", "name" FROM "teams"/, (text, [leagueId, userId]) => ({
      rows:
        userId === PICKER.userId ? [{ id: PICKER.teamId, name: PICKER.teamName }]
        : userId === WATCHER.userId ? [{ id: WATCHER.teamId, name: WATCHER.teamName }]
        : [],
    })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [] })],
  ]).install(t);
  const picker = await harness.connectAs(PICKER, t);
  const watcher = await harness.connectAs(WATCHER, t);
  await harness.emit(picker, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(watcher, 'league:join', { leagueId: LEAGUE_ID });

  // autoPick reads its own candidates; draftPlayer is mocked to return the
  // outcome an autopick commit would, activity included and labeled auto.
  installAutopickPool(t, {
    candidates: [{ id: 500, name: 'Pick Me', adp: '1.0', queue_rank: null, last_season_points: null }],
  });
  t.mock.method(pickService, 'commitPick', async () => ({
    leagueId: LEAGUE_ID,
    teamId: PICKER.teamId,
    teamName: PICKER.teamName,
    player: { id: 500, name: 'Pick Me', position: 'RB' },
    pickNumber: 1,
    nextTeamId: null,
    draftComplete: false,
    pickDeadlineAt: null,
    activity: {
      type: 'draft_activity', kind: 'pick', id: 7, seq: 4,
      teamId: PICKER.teamId, teamName: PICKER.teamName,
      player: { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' },
      round: 1, pickNumber: 1, isAutopick: true, created_at: '2026-09-01T00:00:02.000Z',
    },
  }));

  const watcherPicked = harness.nextEvent(watcher, 'draft:picked');
  const pickerPicked = harness.nextEvent(picker, 'draft:picked');
  await autoPick({ leagueId: LEAGUE_ID });

  const watcherView = await watcherPicked;
  const pickerView = await pickerPicked;
  assert.deepEqual(watcherView.activity, pickerView.activity);
  assert.equal(watcherView.auto, true, 'the broadcast marks the pick auto');
  assert.equal(watcherView.activity.isAutopick, true, 'the activity entry is labeled an autopick');
  assert.equal(watcherView.activity.kind, 'pick');
});
