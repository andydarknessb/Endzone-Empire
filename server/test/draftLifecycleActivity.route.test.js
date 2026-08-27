const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');

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

// A world where the acting commissioner owns ACTOR_TEAM, the pause UPDATE
// matches (commissioner + active), and the lifecycle append lands at feed_seq 12.
function pausePool({ paused }) {
  return createFakePool([
    // requireFantasyLeague() middleware on /league/:id.
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [update('leagues'), () => ({ rows: [{ id: LEAGUE_ID, draft_paused: paused, pick_deadline_at: paused ? null : '2026-09-01T00:01:00.000Z' }] })],
    // lookupTeam: the acting commissioner's Team in this league.
    [select('teams'), () => ({ rows: [ACTOR_TEAM] })],
    [insert('draft_activity'), () => ({ rows: [{ id: 3, feed_seq: '12', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
  ]);
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
  // Established clock behavior preserved: pausing clears the deadline.
  const leagueUpdate = fake.matching(update('leagues'))[0];
  assert.match(leagueUpdate.text, /"pick_deadline_at"\s*=\s*CASE/);
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

test('POST pause: not commissioner / not active refuses 403 and appends nothing', async (t) => {
  const fake = createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // The guarded UPDATE matches no row: not commissioner, or not active.
    [update('leagues'), () => ({ rows: [] })],
  ]).install(t);

  const res = await doPause(true);

  assert.equal(res.status, 403);
  assert.equal(fake.matching(insert('draft_activity')).length, 0, 'no activity when the state change did not happen');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the transaction rolled back');
  assert.equal(fake.matching(/^COMMIT$/).length, 0);
  fake.assertClean();
});

test('POST pause: a commissioner with no team in the league records a null actor, not a fabricated one', async (t) => {
  const fake = createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [update('leagues'), () => ({ rows: [{ id: LEAGUE_ID, draft_paused: true, pick_deadline_at: null }] })],
    [select('teams'), () => ({ rows: [] })], // lookupTeam finds no team
    [insert('draft_activity'), () => ({ rows: [{ id: 4, feed_seq: '13', created_at: 'now' }], rowCount: 1 })],
  ]).install(t);

  const res = await doPause(true);

  assert.equal(res.status, 200);
  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended[0].params[1], 'pause');
  assert.equal(appended[0].params[2], null);
  assert.equal(appended[0].params[3], null);
  fake.assertClean();
});
