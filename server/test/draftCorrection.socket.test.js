const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const { createSocketHarness } = require('./helpers/socketHarness');

/**
 * Real-time delivery of a Commissioner correction over the production Socket.IO
 * wiring (#439, AC8 socket coverage). The correction is an HTTP act, but its
 * effect is broadcast: every client in the `league:${id}` room must receive the
 * append-only correction entry on `draft:activity` (the same combined-feed event
 * pause/resume/reset use), so the room's feed shows the correction beside the
 * now-paused draft. A real socket.io server + clients through createSocketHarness
 * (which installs the io singleton the HTTP route's getIo() reads); the DB is a
 * fakePool, so the feed_seq is the fixture's - the real shared-sequence
 * allocation is proven in draftActivity.pg.test.js.
 */

const LEAGUE_ID = 1;
const COMMISSIONER = { userId: 9, username: 'commish', teamId: 30, teamName: 'Gridiron Ghosts' };
const WATCHER = { userId: 43, username: 'watcher', teamId: 12, teamName: 'Sunday Scaries' };
const REASON = 'entered against the wrong team; correcting this before we resume play';

const harness = createSocketHarness({ secret: 'draft-correction-socket-secret' });

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

function correctionWorld(t) {
  return createFakePool([
    // join identity reads (lookupTeam + a commissioner check) - kept ahead of
    // the correction's own leagues/teams handlers, which they would otherwise
    // shadow.
    [/^SELECT "id", "name" FROM "teams"/, (text, [, userId]) => ({
      rows:
        userId === COMMISSIONER.userId ? [{ id: COMMISSIONER.teamId, name: COMMISSIONER.teamName }]
        : userId === WATCHER.userId ? [{ id: WATCHER.teamId, name: WATCHER.teamName }]
        : [],
    })],
    [/SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({ rows: [{ ok: 1 }] })],
    // requireFantasyLeague middleware.
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // The correction's own league lock.
    [/FROM "leagues"[\s\S]*FOR UPDATE/, () => ({
      rows: [{
        id: LEAGUE_ID, draft_status: 'active', current_pick: 3, draft_paused: false,
        current_season: 2026, current_week: 1, draft_rotation: 'snake', draft_order_overrides: null,
      }],
    })],
    [select('teams'), () => ({ rows: [{ id: COMMISSIONER.teamId, name: COMMISSIONER.teamName, owner_id: COMMISSIONER.userId, draft_position: 1, autodraft: false }] })],
    [select('draft_picks'), () => ({ rows: [{ pick_number: 3, team_id: COMMISSIONER.teamId, player_id: 500, is_keeper: false }] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Wrong Guy', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [select('matchups'), () => ({ rows: [] })],
    [remove('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [remove('team_players'), () => ({ rows: [], rowCount: 1 })],
    [remove('lineup_entries'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ id: LEAGUE_ID }], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 30, feed_seq: '18', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
    // getDraftState after commit: no league returned -> null draft:state, which
    // keeps this test off the whole-state read and on the activity broadcast.
    [select('leagues'), () => ({ rows: [] })],
  ]).install(t);
}

test('a correction reaches every client in the league room on draft:activity, kind correction', async (t) => {
  correctionWorld(t);
  const commissioner = await harness.connectAs(COMMISSIONER, t);
  const watcher = await harness.connectAs(WATCHER, t);
  await harness.emit(commissioner, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(watcher, 'league:join', { leagueId: LEAGUE_ID });

  const commissionerActivity = harness.nextEvent(commissioner, 'draft:activity');
  const watcherActivity = harness.nextEvent(watcher, 'draft:activity');

  const res = await request(app)
    .post(`/api/draft/league/${LEAGUE_ID}/correct-pick`)
    .set('Authorization', `Bearer ${signToken({ id: COMMISSIONER.userId, username: COMMISSIONER.username })}`)
    .send({ pickNumber: 3, reason: REASON });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const commissionerView = await commissionerActivity;
  const watcherView = await watcherActivity;

  // Every client in the room received the SAME correction entry (one broadcast).
  assert.deepEqual(commissionerView, watcherView);
  assert.equal(watcherView.type, 'draft_activity');
  assert.equal(watcherView.kind, 'correction');
  assert.equal(watcherView.teamName, COMMISSIONER.teamName);
  assert.equal(watcherView.pickNumber, 3);
  assert.equal(watcherView.reason, REASON);
});
