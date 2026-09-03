const { test } = require('node:test');
const assert = require('node:assert/strict');
// The offline route lands each Pick through the one seam (#782 ruling 3), which
// fans out through the one Draft room adapter (#745); register a recording
// broadcast per test and read back which named events the committed Picks fired.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
const currentRecorder = registerRecordingBroadcast();
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const lineupService = require('../services/lineup.service');
const draftRoomBroadcast = require('../modules/draftRoomBroadcast');

/**
 * POST /api/draft/league/:id/offline-picks - the commissioner bulk-enters an
 * active offline draft's Picks (#782 ruling 3). Each committed offline Pick fans
 * out exactly like a live one through landPick: a `pickLanded` per Pick. The
 * route's old closing `stateChanged` / `rosterChanged` emits are GONE - a
 * completing offline draft's final Pick carries its own `draftCompleted` /
 * `rosterChanged` now, and a non-completing run needs neither.
 *
 * This is the sibling of draftReset.test.js: same supertest-over-fakePool harness,
 * one route over. What it pins is the fan-out (AC3): two posted ids produce two
 * `pickLanded` and zero `stateChanged`.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'offline-picks-route-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const COMMISSIONER = 9;
const LEAGUE_ID = 5;
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

// A mid-offline-draft league: 2 teams x 3 rounds = 6 total picks, so two picks in
// a row never complete it. draft_type offline (no clock ever arms).
const OFFLINE_LEAGUE = {
  id: LEAGUE_ID,
  draft_status: 'active',
  draft_paused: false,
  draft_type: 'offline',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  pickem_only: false,
  roster_limit: 4,
  ir_slots: 1,
  draft_rounds: 3,
  position_caps: {},
  current_pick: 0,
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  waiver_period_hours: 24,
};

const TEAMS = [
  { id: 11, name: 'Team Eleven', owner_id: 7, draft_position: 1, autodraft: false, locked: false },
  { id: 12, name: 'Team Twelve', owner_id: 8, draft_position: 2, autodraft: false, locked: false },
];

/**
 * A fake pool that accepts every offline Pick: the requireFantasyLeague gate, the
 * route's own commissioner/status/type pre-check, then - for each landPick ->
 * commitPick transaction - the byCommissioner commissioner probe, the league row,
 * teams, player, the roster-acquisition reads, and the pick writes. `draftPicks`
 * is a low constant so the draft never completes (a non-completing run fans out
 * only pickLanded, which is exactly what AC3 pins).
 */
function offlinePicksPool() {
  return createFakePool([
    // requireFantasyLeague mount: a fantasy (non-pickem) league.
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // The route's own pre-check: an active offline draft the caller commissions.
    [/^SELECT "draft_status", "draft_type"/, () => ({
      rows: [{ draft_status: 'active', draft_type: 'offline', is_commissioner: true }],
    })],
    // commitPick's byCommissioner authority probe (isLeagueCommissioner).
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    // commitPick's own SELECT * ... FOR UPDATE.
    [select('leagues'), () => ({ rows: [{ ...OFFLINE_LEAGUE }] })],
    [select('teams'), () => ({ rows: TEAMS.map((t) => ({ ...t })) })],
    [select('players'), (text, params) => ({ rows: [{ id: params[0], name: `Player ${params[0]}`, position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    // A low, constant count: 2 teams x 3 rounds = 6 total, so a two-pick run never
    // completes the draft (no draftCompleted / rosterChanged fan-out).
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: 1 }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 3, feed_seq: '2', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ pick_deadline_at: null }] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

test('POST offline-picks: two posted ids produce two pickLanded and no stateChanged (#782 ruling 3)', async (t) => {
  const fake = offlinePicksPool().install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  const res = await request(app)
    .post(`/api/draft/league/${LEAGUE_ID}/offline-picks`)
    .set('Authorization', authed())
    .send({ playerIds: [500, 501] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { applied: 2 }, 'both offline Picks applied, response shape unchanged');

  const recorder = currentRecorder();
  const pickLandeds = recorder.calls.filter((c) => c.method === 'pickLanded');
  assert.equal(pickLandeds.length, 2, 'each committed offline Pick fans out one pickLanded');
  for (const call of pickLandeds) {
    assert.equal(call.leagueId, LEAGUE_ID);
    assert.equal(call.payload.auto, false, 'a commissioner-entered offline Pick is not an autopick');
  }
  // The route no longer emits a closing stateChanged (nor a closing rosterChanged);
  // a non-completing run fans out nothing but the per-Pick pickLanded.
  assert.equal(recorder.calls.some((c) => c.method === 'stateChanged'), false, 'no closing stateChanged');
  assert.equal(recorder.calls.some((c) => c.method === 'rosterChanged'), false, 'no closing rosterChanged either');
  fake.assertClean();
});

test('POST offline-picks: a post-COMMIT fan-out failure does not report a landed Pick as failed (#782 blocking)', async (t) => {
  const fake = offlinePicksPool().install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  // Unregister the room broadcast so landPick's getDraftRoomBroadcast() throws
  // AFTER each Pick has committed (#765). The commit is authoritative, so both
  // Picks must still be counted - not reported as a failedAtIndex that undercounts
  // `applied` and abandons the rest of the list. (registerRecordingBroadcast's
  // afterEach restores the prior registration.)
  draftRoomBroadcast.setDraftRoomBroadcast(null);

  const res = await request(app)
    .post(`/api/draft/league/${LEAGUE_ID}/offline-picks`)
    .set('Authorization', authed())
    .send({ playerIds: [500, 501] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { applied: 2 }, 'both committed Picks are counted despite the fan-out failure');
  fake.assertClean();
});
