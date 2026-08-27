const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { createSocketHarness } = require('./helpers/socketHarness');
const { signToken } = require('../modules/auth');
const { broadcastDraftActivity } = require('../modules/draftActivityBroadcast');
const { getIo, setIo } = require('../modules/io');
const seasonService = require('../services/season.service');
const lineupService = require('../services/lineup.service');

/**
 * Multi-client delivery of Draft LIFECYCLE activity over the real Socket.IO
 * wiring (#437 AC7). Every lifecycle event - Draft start, pause, resume, reset,
 * completion - reaches every client in the `league:${id}` room as one typed
 * Draft-activity entry on `draft:activity`, so the combined feed shows the state
 * transition beside the conversation. The shared-sequence allocation is proven
 * in draftActivity.pg.test.js; what THIS proves is the wiring.
 */
const SECRET = 'draft-lifecycle-broadcast-secret';
const LEAGUE_ID = 1;
const COMMISH = { userId: 7, username: 'commish', teamId: 11, teamName: 'Gridiron Ghosts' };
const WATCHER = { userId: 8, username: 'watcher', teamId: 12, teamName: 'Sunday Scaries' };

const harness = createSocketHarness({ secret: SECRET });

// ------------------------------------------------------------- the mechanism
// broadcastDraftActivity is the ONE helper every lifecycle emit site calls, so
// proving it here covers the delivery for all five kinds; the route/service
// tests prove each site calls it with the right entry.
test('broadcastDraftActivity emits the entry to the league room on draft:activity', () => {
  const emits = [];
  const rooms = [];
  const prior = getIo();
  setIo({ to: (room) => { rooms.push(room); return { emit: (event, payload) => emits.push({ event, payload }) }; } });
  try {
    const entry = { type: 'draft_activity', kind: 'pause', id: 1, seq: 9, teamId: 11, teamName: 'Gridiron Ghosts', created_at: 'now' };
    broadcastDraftActivity(LEAGUE_ID, entry);
    assert.deepEqual(rooms, [`league:${LEAGUE_ID}`]);
    assert.equal(emits.length, 1);
    assert.equal(emits[0].event, 'draft:activity');
    assert.deepEqual(emits[0].payload, entry);
  } finally {
    setIo(prior);
  }
});

test('broadcastDraftActivity is a no-op on a null entry or when there is no io', () => {
  const prior = getIo();
  let emitted = 0;
  setIo({ to: () => ({ emit: () => { emitted += 1; } }) });
  try {
    broadcastDraftActivity(LEAGUE_ID, null);
    assert.equal(emitted, 0, 'a null entry emits nothing');
    setIo(null);
    broadcastDraftActivity(LEAGUE_ID, { kind: 'pause' });
    assert.equal(emitted, 0, 'no io emits nothing');
  } finally {
    setIo(prior);
  }
});

// The identity reads league:join runs (viewerContext -> lookupTeam +
// isLeagueCommissioner), so BOTH clients hold a team and join the room, and only
// the commissioner passes the commissioner probe.
function identityReads() {
  return [
    [/^SELECT "id", "name" FROM "teams"/, (text, [, userId]) => ({
      rows:
        userId === COMMISH.userId ? [{ id: COMMISH.teamId, name: COMMISH.teamName }]
        : userId === WATCHER.userId ? [{ id: WATCHER.teamId, name: WATCHER.teamName }]
        : [],
    })],
    [/^SELECT 1 FROM "leagues"/, (text, params) => ({ rows: params.includes(COMMISH.userId) ? [{ '?column?': 1 }] : [] })],
  ];
}

// A pending fantasy league the commissioner can start: 2 teams, snake, roster 2,
// keepers off, so startPlan opens pick 0 and the draft goes active (no all-keeper
// completion). Stateful so getDraftState reads back the 'active' status the start
// wrote.
const START_LEAGUE = {
  id: LEAGUE_ID, owner_id: COMMISH.userId, pickem_only: false,
  draft_status: 'pending', draft_type: 'snake', draft_rotation: 'snake', draft_order_overrides: null,
  keepers_enabled: false, keeper_count: 0, min_teams: 1, roster_limit: 2, ir_slots: 0,
  pick_time_seconds: 60, autodraft_delay_seconds: 10, current_pick: 0,
};
const START_TEAMS = [
  { id: COMMISH.teamId, name: COMMISH.teamName, owner_id: COMMISH.userId, draft_position: 1, autodraft: false, locked: false, draft_ready: true },
  { id: WATCHER.teamId, name: WATCHER.teamName, owner_id: WATCHER.userId, draft_position: 2, autodraft: false, locked: false, draft_ready: true },
];

function startWorld(t) {
  const row = { ...START_LEAGUE };
  const fake = createFakePool([
    ...identityReads(),
    [select('leagues'), () => ({ rows: [{ ...row }] })],
    [update('leagues'), (text) => {
      if (/'active'/.test(text)) row.draft_status = 'active';
      else if (/'complete'/.test(text)) row.draft_status = 'complete';
      return { rows: [{ pick_deadline_at: null }], rowCount: 1 };
    }],
    [select('teams'), () => ({ rows: START_TEAMS })],
    [/FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_activity'), (() => { let s = 1; return () => ({ rows: [{ id: s, feed_seq: String(s++), created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 }); })()],
  ]).install(t);
  return fake;
}

test('draft:start reaches every client in the room as a draft_start lifecycle entry', async (t) => {
  startWorld(t);
  const commish = await harness.connectAs(COMMISH, t);
  const watcher = await harness.connectAs(WATCHER, t);
  await harness.emit(commish, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(watcher, 'league:join', { leagueId: LEAGUE_ID });

  const watcherActivity = harness.nextEvent(watcher, 'draft:activity');
  const commishActivity = harness.nextEvent(commish, 'draft:activity');
  await harness.emit(commish, 'draft:start', { leagueId: LEAGUE_ID });

  const seen = await watcherActivity;
  const own = await commishActivity;
  assert.deepEqual(seen, own, 'one room broadcast, identical for every client');
  assert.equal(seen.type, 'draft_activity');
  assert.equal(seen.kind, 'draft_start');
  assert.equal(seen.teamId, COMMISH.teamId, 'attributed to the acting commissioner Team');
  assert.equal(seen.teamName, COMMISH.teamName);
  // A lifecycle entry carries no Pick facts.
  assert.equal('player' in seen, false);
});

// An active league where COMMISH is on the clock and this pick is the LAST one
// (draft_picks count reaches teams x rounds), so draftPlayer completes the draft
// and appends the completion lifecycle entry after the Pick.
const COMPLETING_LEAGUE = {
  id: LEAGUE_ID, pickem_only: false, draft_status: 'active', draft_paused: false,
  draft_type: 'snake', draft_rotation: 'snake', draft_order_overrides: null,
  roster_limit: 3, ir_slots: 1, draft_rounds: 2, position_caps: {},
  current_pick: 3, pick_time_seconds: 60, autodraft_delay_seconds: 10, waiver_period_hours: 24,
};

function completingPickWorld(t) {
  const fake = createFakePool([
    ...identityReads(),
    [select('leagues'), () => ({ rows: [{ ...COMPLETING_LEAGUE }] })],
    [select('teams'), () => ({ rows: START_TEAMS })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Last Pick', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    // 4 picks = 2 teams x 2 rounds: this pick completes the draft.
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: 4 }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_activity'), (() => { let s = 20; return () => ({ rows: [{ id: s, feed_seq: String(s++), created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 }); })()],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ pick_deadline_at: null }], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  t.mock.method(seasonService, 'generateRegularSeason', async () => ({}));
  return fake;
}

test('the Pick that completes the draft broadcasts a complete lifecycle entry to the room (#437 AC4)', async (t) => {
  completingPickWorld(t);
  const commish = await harness.connectAs(COMMISH, t);
  const watcher = await harness.connectAs(WATCHER, t);
  await harness.emit(commish, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(watcher, 'league:join', { leagueId: LEAGUE_ID });

  const watcherActivity = harness.nextEvent(watcher, 'draft:activity');
  await harness.emit(commish, 'draft:pick', { leagueId: LEAGUE_ID, playerId: 500 });

  const seen = await watcherActivity;
  assert.equal(seen.type, 'draft_activity');
  assert.equal(seen.kind, 'complete');
  // Completion is an actor-less state transition (#437 AC5).
  assert.equal(seen.teamId, null);
  assert.equal(seen.teamName, null);
  assert.equal('player' in seen, false);
});

// pause / resume / reset are HTTP routes, not socket events, but they broadcast
// through the SAME getIo() singleton the harness installs, so a supertest
// request against the router reaches the socket clients in the room. This is the
// true end-to-end path for the three commissioner controls.
const httpApp = express();
httpApp.use(express.json());
httpApp.use('/api/draft', require('../routes/draft.router'));
const commishAuth = () => `Bearer ${signToken({ id: COMMISH.userId, username: COMMISH.username })}`;

// The reads getDraftState runs for the post-change draft:state broadcast.
function draftStateReads(leagueRow) {
  return [
    [select('leagues'), () => ({ rows: [{ ...leagueRow }] })],
    [select('teams'), () => ({ rows: START_TEAMS })],
    [/FROM "draft_picks"/, () => ({ rows: [] })],
  ];
}

async function joinBoth(t) {
  const commish = await harness.connectAs(COMMISH, t);
  const watcher = await harness.connectAs(WATCHER, t);
  await harness.emit(commish, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(watcher, 'league:join', { leagueId: LEAGUE_ID });
  return watcher;
}

for (const { paused, kind } of [{ paused: true, kind: 'pause' }, { paused: false, kind: 'resume' }]) {
  test(`POST /pause { paused: ${paused} } broadcasts a ${kind} lifecycle entry to the room`, async (t) => {
    createFakePool([
      [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
      [update('leagues'), () => ({ rows: [{ id: LEAGUE_ID, draft_paused: paused, pick_deadline_at: null }], rowCount: 1 })],
      ...identityReads(), // lookupTeam -> COMMISH team
      [insert('draft_activity'), () => ({ rows: [{ id: 9, feed_seq: '30', created_at: 'now' }], rowCount: 1 })],
      ...draftStateReads({ ...START_LEAGUE, draft_status: 'active', draft_paused: paused }),
    ]).install(t);
    const watcher = await joinBoth(t);

    const watcherActivity = harness.nextEvent(watcher, 'draft:activity');
    const res = await request(httpApp).post(`/api/draft/league/${LEAGUE_ID}/pause`).set('Authorization', commishAuth()).send({ paused });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const seen = await watcherActivity;
    assert.equal(seen.kind, kind);
    assert.equal(seen.teamId, COMMISH.teamId);
    assert.equal(seen.teamName, COMMISH.teamName);
    assert.equal('player' in seen, false);
  });
}

test('POST /reset broadcasts a reset lifecycle entry to the room', async (t) => {
  createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // The reset's guarded league lookup, more specific than getDraftState's SELECT *.
    [/SELECT "id", "current_season" FROM "leagues"/, () => ({ rows: [{ id: LEAGUE_ID, current_season: 2026 }] })],
    [select('matchups'), () => ({ rows: [] })],
    [/^DELETE FROM "team_players"/, () => ({ rows: [], rowCount: 0 })],
    [/^DELETE FROM "lineup_entries"/, () => ({ rows: [], rowCount: 0 })],
    [/^DELETE FROM "draft_picks"/, () => ({ rows: [], rowCount: 0 })],
    [update('teams'), () => ({ rows: [], rowCount: 2 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    ...identityReads(), // lookupTeam -> COMMISH team
    [insert('draft_activity'), () => ({ rows: [{ id: 10, feed_seq: '31', created_at: 'now' }], rowCount: 1 })],
    ...draftStateReads({ ...START_LEAGUE, draft_status: 'pending' }),
  ]).install(t);
  const watcher = await joinBoth(t);

  const watcherActivity = harness.nextEvent(watcher, 'draft:activity');
  const res = await request(httpApp).post(`/api/draft/league/${LEAGUE_ID}/reset`).set('Authorization', commishAuth());
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const seen = await watcherActivity;
  assert.equal(seen.kind, 'reset');
  assert.equal(seen.teamId, COMMISH.teamId);
  assert.equal(seen.teamName, COMMISH.teamName);
});
