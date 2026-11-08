const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
// The clock change fans out stateChanged after commit; register a recording
// broadcast so the success path has an adapter to call.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
registerRecordingBroadcast();
const { createFakePool } = require('./helpers/fakePool');

/**
 * POST /api/draft/league/:id/clock - commissioner changes the pick clock.
 *
 * The commissioner and draft-status refusal is decided in the Draft act body,
 * on the locked League row, before the pick_time_seconds write. Each refusal is
 * pinned twice: its status and message, and the zero count of pick clock writes
 * (docs/agents/refusal-tests.md: a refusal that protects a mutation asserts the
 * forbidden write did not run). The success path is the baseline that proves the
 * count can see the write.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-clock-route-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const LEAGUE_ID = 5;
const COMMISSIONER = 9;
const OUTSIDER = 42;
const bearer = (id) => `Bearer ${signToken({ id, username: `u${id}` })}`;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

const REFUSAL = 'league not found, not commissioner, or the draft has already finished';

/**
 * `status` is the League's draft_status on the locked row; `isCommissioner`
 * whether the caller passes the commissioner probe.
 */
function clockPool({ status = 'active', isCommissioner = true } = {}) {
  return createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // The League write's lock (ADR 0070) returns the row the body authorizes against.
    [/^UPDATE "leagues" SET "board_version" = "board_version" \+ 1 WHERE "id" = \$1 RETURNING \*$/, () => ({
      rows: [{
        id: LEAGUE_ID, draft_status: status, draft_paused: false, current_pick: 1,
        current_season: 2026, draft_rotation: 'snake', draft_order_overrides: null,
      }],
    })],
    [/^SELECT "id", "owner_id", "autodraft", "draft_position" FROM "teams"/, () => ({ rows: [] })],
    [/FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({ rows: [] })],
    // isLeagueCommissioner's probe, the JS twin of commissionerPredicate.
    [/^SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({ rows: isCommissioner ? [{ '?column?': 1 }] : [] })],
    [/^UPDATE "leagues" SET "pick_time_seconds"/, () => ({ rows: [], rowCount: 1 })],
  ]);
}

const setClock = (user) => request(app)
  .post(`/api/draft/league/${LEAGUE_ID}/clock`)
  .set('Authorization', bearer(user))
  .send({ pickTimeSeconds: 90 });

const clockWrites = (fake) => fake.matching(/^UPDATE "leagues" SET "pick_time_seconds"/);

test('POST clock: the commissioner of an active draft sets the clock (success baseline)', async (t) => {
  const fake = clockPool().install(t);

  const res = await setClock(COMMISSIONER);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { leagueId: LEAGUE_ID, pickTimeSeconds: 90 });
  assert.equal(clockWrites(fake).length, 1, 'the baseline sees the clock write');
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});

test('POST clock: a non-commissioner is refused with 403 and the refusal message', async (t) => {
  clockPool({ isCommissioner: false }).install(t);

  const res = await setClock(OUTSIDER);

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.error, REFUSAL);
});

test('POST clock: a non-commissioner refusal writes no pick clock', async (t) => {
  const fake = clockPool({ isCommissioner: false }).install(t);

  const res = await setClock(OUTSIDER);

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(clockWrites(fake).length, 0, 'the refused caller reaches no pick_time_seconds write');
  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'nothing committed');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the lock is rolled back');
  fake.assertClean();
});

test('POST clock: a completed draft is refused with 403 and the refusal message', async (t) => {
  clockPool({ status: 'complete' }).install(t);

  const res = await setClock(COMMISSIONER);

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.error, REFUSAL);
});

test('POST clock: a completed draft refusal writes no pick clock', async (t) => {
  const fake = clockPool({ status: 'complete' }).install(t);

  const res = await setClock(COMMISSIONER);

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(clockWrites(fake).length, 0, 'a finished draft takes no clock write');
  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'nothing committed');
  fake.assertClean();
});
