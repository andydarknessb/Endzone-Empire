const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, insert, update } = require('./helpers/fakePool');
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
const { appendLifecycleActivity, activityEntryOf, STALLED } = require('../services/draftActivity');

// The pause/resume/reset routes now refresh the board and append the lifecycle
// entry through the one Draft room adapter (#745), which throws with no
// transport. Register a recording broadcast around every test so these route
// tests exercise the DB writes and responses without a live socket.
registerRecordingBroadcast();

/**
 * The pause/resume route appends Draft LIFECYCLE activity from the SAME
 * transaction that flips draft_paused (#437 AC2), attributed to the acting
 * commissioner's Team, while preserving the established pick-clock behavior
 * (deadline cleared on pause, re-armed on resume). A fakePool route test: the
 * shared-sequence allocation and real interleaving are draftActivity.pg.test.js.
 */
const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-lifecycle-activity-route-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const COMMISSIONER = 9;
const LEAGUE_ID = 5;
const ACTOR_TEAM = { id: 30, name: 'Commish FC' };
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

// A world for the pause/resume route now that it runs on the Draft act module
// (#947). The act module opens the transaction, takes the serializing League-row
// lock, loads Teams in rotation order, then resolves the acting Team; the act
// body authorizes (isLeagueCommissioner + draft_status), flips draft_paused, and
// arms/clears the deadline through the Pick clock module (ADR 0018) - the
// draft_paused flip and the module's deadline UPDATE both match update('leagues')
// and are told apart by text. `active`/`commissioner`/`hasActorTeam` shape the
// three refusal reasons the old guarded UPDATE fused into one empty result.
function pausePool({ paused, active = true, commissioner = true, hasActorTeam = true }) {
  const handlers = [
    // requireFantasyLeague() middleware on /league/:id.
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // The act module's serializing lock on the League row. `active: null` models
    // a missing league (empty lock result).
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({
      rows: active === null ? [] : [{ id: LEAGUE_ID, draft_status: active ? 'active' : 'pending' }],
    })],
    // The act module loads Teams in rotation order (draft_position seed order).
    [/^SELECT "id", "owner_id", "autodraft", "draft_position" FROM "teams"/, () => ({
      rows: [{ id: ACTOR_TEAM.id, owner_id: COMMISSIONER, autodraft: false, draft_position: 1 }],
    })],
    // lookupTeam: the acting commissioner's Team in this league, or none.
    [/^SELECT "id", "name" FROM "teams"/, () => ({ rows: hasActorTeam ? [ACTOR_TEAM] : [] })],
    // isLeagueCommissioner probe, reproducing commissionerPredicate(3) in the body.
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: commissioner ? [{ '?column?': 1 }] : [] })],
  ];
  if (!paused) {
    // onResumed resolves the on-clock team, then arms the policy clock.
    handlers.push([/^SELECT "current_pick", "draft_type"/, () => ({ rows: [{
      current_pick: 0, draft_type: 'snake', draft_rotation: 'snake', draft_order_overrides: null,
      pick_time_seconds: 60, autodraft_delay_seconds: 10,
    }] })]);
    handlers.push([/^SELECT "id", "autodraft", "draft_position" FROM "teams"/, () => ({ rows: [{ id: ACTOR_TEAM.id, autodraft: false, draft_position: 1 }] })]);
  }
  // The draft_paused flip and the Pick clock module's deadline write both match
  // update('leagues'); tell them apart by which column each sets.
  handlers.push([update('leagues'), (text) => {
    if (/"draft_paused"/.test(text)) return { rows: [{ id: LEAGUE_ID, draft_paused: paused }], rowCount: 1 };
    return { rows: [{ pick_deadline_at: paused ? null : '2026-09-01T00:01:00.000Z' }], rowCount: 1 };
  }]);
  handlers.push([insert('draft_activity'), () => ({ rows: [{ id: 3, feed_seq: '12', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })]);
  return createFakePool(handlers);
}

const doPause = (paused) => request(app)
  .post(`/api/draft/league/${LEAGUE_ID}/pause`)
  .set('Authorization', authed())
  .send({ paused });

test('POST pause: appends a pause activity with the commissioner Team, in one transaction, clock cleared', async (t) => {
  const fake = pausePool({ paused: true }).install(t);

  const res = await doPause(true);

  assert.equal(res.status, 200);
  assert.equal(res.body.draft_paused, true);
  // One append, in the same transaction (BEGIN ... COMMIT) as the UPDATE.
  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended.length, 1);
  assert.deepEqual(appended[0].params, [LEAGUE_ID, 'pause', ACTOR_TEAM.id, ACTOR_TEAM.name]);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 0);
  // Established clock behavior preserved: pausing clears the deadline, now
  // through the Pick clock module's own UPDATE rather than the flip's CASE.
  assert.ok(
    fake.matching(update('leagues')).some((c) => /"pick_deadline_at" = NULL/.test(c.text)),
    'pausing cleared the deadline'
  );
  assert.equal(res.body.pick_deadline_at, null);
  fake.assertClean();
});

test('POST pause paused:false appends a resume activity and re-arms the clock', async (t) => {
  const fake = pausePool({ paused: false }).install(t);

  const res = await doPause(false);

  assert.equal(res.status, 200);
  assert.equal(res.body.draft_paused, false);
  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended.length, 1);
  assert.equal(appended[0].params[1], 'resume');
  assert.deepEqual([appended[0].params[2], appended[0].params[3]], [ACTOR_TEAM.id, ACTOR_TEAM.name]);
  // Resuming re-arms the deadline (the UPDATE's CASE), not this test's concern
  // to recompute, only that the route returns it and appended a resume.
  assert.ok(res.body.pick_deadline_at, 'resume returns a re-armed deadline');
  fake.assertClean();
});

// The old guarded UPDATE collapsed three refusal reasons into one empty result
// and one 403 body. The act-module split (lock, then check, then update) must
// keep that exact shape: each reason returns the IDENTICAL status and body, rolls
// back, and appends nothing. Pin all three so a split that leaks a 404 or a
// distinct body (the refusal set "changing shape") turns this red.
const REFUSAL_BODY = 'league not found, not commissioner, or draft not active';
for (const { reason, opts } of [
  { reason: 'league not found', opts: { active: null } },
  { reason: 'not commissioner', opts: { commissioner: false } },
  { reason: 'draft not active', opts: { active: false } },
]) {
  test(`POST pause: ${reason} refuses 403 with the one fused body and appends nothing`, async (t) => {
    const fake = pausePool({ paused: true, ...opts }).install(t);

    const res = await doPause(true);

    assert.equal(res.status, 403, reason);
    assert.equal(res.body.error, REFUSAL_BODY, 'the same fused refusal body for every reason');
    assert.equal(fake.matching(insert('draft_activity')).length, 0, 'no activity when the state change did not happen');
    assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the transaction rolled back');
    assert.equal(fake.matching(/^COMMIT$/).length, 0);
    fake.assertClean();
  });
}

test('the nothing-draftable escalation entry (#602) is a readable lifecycle entry naming the stuck team', async (t) => {
  // The escalation (#602) is not driven by this route - it fires from the Pick
  // clock module's expiry path - but its entry rides the SAME Draft-activity
  // feed as pause and resume, appended through the SAME appendLifecycleActivity
  // and shaped by the SAME activityEntryOf that the pause/resume route entries
  // above use. This pins that a STALLED entry is a first-class, feed-readable
  // lifecycle entry: it NAMES the stuck team and carries no Pick facts (no Pick
  // was committed), exactly like a pause. If STALLED were not a lifecycle kind
  // this append would throw; if activityEntryOf fabricated Pick fields for it the
  // client renderer would draw a broken Pick line instead of the event line.
  const STUCK_TEAM = { id: 44, name: 'MinneApple' };
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [{ id: 7, feed_seq: '21', created_at: '2026-09-01T00:02:00.000Z' }] };
    },
  };

  const entry = await appendLifecycleActivity(client, { leagueId: LEAGUE_ID, kind: STALLED, team: STUCK_TEAM });

  // One INSERT, kind 'stalled', the stuck team named, no Pick columns.
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO "draft_activity"/);
  assert.deepEqual(calls[0].params, [LEAGUE_ID, 'stalled', STUCK_TEAM.id, STUCK_TEAM.name]);
  const [columnList] = calls[0].text.split('RETURNING');
  assert.doesNotMatch(columnList, /player_name|pick_number|"round"|is_autopick/i, 'a stalled entry carries no Pick facts');

  // The typed entry the feed broadcasts and renders: a bare lifecycle shape.
  assert.equal(entry.kind, STALLED);
  assert.equal(entry.teamId, STUCK_TEAM.id);
  assert.equal(entry.teamName, STUCK_TEAM.name);
  assert.equal('player' in entry, false, 'no fabricated Pick snapshot on a stalled entry');

  // And activityEntryOf shapes a stalled row read back from the feed the same
  // bare way (the combined-feed read path), so it renders as an event line.
  const readBack = activityEntryOf({
    kind: STALLED, id: 7, feed_seq: '21', teamId: STUCK_TEAM.id, teamName: STUCK_TEAM.name,
    created_at: '2026-09-01T00:02:00.000Z',
  });
  assert.equal(readBack.kind, STALLED);
  assert.equal(readBack.teamName, 'MinneApple');
  assert.equal('player' in readBack, false);
});

test('POST pause: a commissioner with no team in the league records a null actor, not a fabricated one', async (t) => {
  const fake = pausePool({ paused: true, hasActorTeam: false }).install(t);

  const res = await doPause(true);

  assert.equal(res.status, 200);
  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended[0].params[1], 'pause');
  assert.equal(appended[0].params[2], null);
  assert.equal(appended[0].params[3], null);
  fake.assertClean();
});
