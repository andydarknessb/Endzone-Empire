const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const supabaseAdminModule = require('../modules/supabaseAdmin');
const { signToken } = require('../modules/auth');
const commissionerRouter = require('../routes/commissioner.router');
const { createFakePool, insert, update } = require('./helpers/fakePool');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'commissioner-avatar-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/commissioner', commissionerRouter);

/**
 * #274: migrated from a hand-rolled client mock to the shared fakePool.
 *
 * The old fake kept NO call log, so the refusal tests below could assert only
 * a status code - there was literally nothing to count. It also threw on any
 * unregistered statement, which meant a guard moved below the work surfaced as
 * a 500 rather than as a passing test. That is incidental protection, not an
 * assertion: it reports a fixture-completeness error rather than the safety
 * property, and it disappears silently the moment anyone registers a write
 * handler for convenience. The migration rule in helpers/fakePool.js applies
 * the moment such a fake is touched, so it is touched properly.
 *
 * The write handlers are registered in the refusal fixtures ON PURPOSE, so the
 * counts observe an absence rather than inherit a throw.
 */
const WRITES = [
  [update('teams'), () => ({ rows: [] })],
  [insert('transactions'), () => ({ rows: [] })],
  [insert('notifications'), () => ({ rows: [] })],
];

const assertNoAvatarWrite = (fake) => {
  assert.equal(fake.matching(update('teams')).length, 0, 'the avatar was not cleared');
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no activity row claimed it was');
  assert.equal(fake.matching(insert('notifications')).length, 0, 'and nobody was notified');
  // Unusually, the COMMIT count is load-bearing rather than complementary for
  // ONE effect here: commissioner.service.js deletes the storage objects with
  // `void deleteAvatarObjects(priorAvatar)` AFTER the COMMIT, so no COMMIT is
  // the actual precondition for that side effect, not a weak proxy for it.
  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'and no COMMIT, so no storage delete followed');
};

test('DELETE .../teams/:teamId/avatar requires the commissioner', async (t) => {
  const fake = createFakePool([
    [
      /^SELECT \*, \("leagues"\."owner_id" = \$2 OR EXISTS/,
      () => ({ rows: [{ id: 1, owner_id: 999, is_commissioner: false, current_season: 2026, current_week: 1 }] }),
    ],
    [
      /^SELECT "owner_id", "avatar_url", "avatar_static_url" FROM "teams"/,
      () => ({ rows: [{ owner_id: 42, avatar_url: null, avatar_static_url: null }] }),
    ],
    ...WRITES,
  ]).install(t);
  const token = signToken({ id: 7, username: 'not-the-commish' });
  const response = await request(app)
    .delete('/api/commissioner/league/1/teams/5/avatar')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 403);
  assertNoAvatarWrite(fake);
  fake.assertClean();
});

test('DELETE .../teams/:teamId/avatar clears the avatar and privately notifies the owner (not the league)', async (t) => {
  supabaseAdminModule.supabaseAdmin = null; // storage cleanup is best-effort; irrelevant to this assertion
  const notifyInserts = [];
  const fake = createFakePool([
    [
      /^SELECT \*, \("leagues"\."owner_id" = \$2 OR EXISTS/,
      () => ({ rows: [{ id: 1, owner_id: 7, is_commissioner: true, current_season: 2026, current_week: 1 }] }),
    ],
    [
      /^SELECT "owner_id", "avatar_url", "avatar_static_url" FROM "teams"/,
      () => ({ rows: [{ owner_id: 42, avatar_url: null, avatar_static_url: null }] }),
    ],
    [/^UPDATE "teams" SET "avatar_url" = NULL/, () => ({ rows: [] })],
    [
      /^INSERT INTO "transactions"/,
      (text, params) => {
        assert.match(params[3], /remove_team_avatar/); // detail jsonb is bound, not inlined
        return { rows: [] };
      },
    ],
    [
      /^INSERT INTO "notifications"/,
      () => {
        notifyInserts.push('recorded');
        return { rows: [] };
      },
    ],
  ]).install(t);

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .delete('/api/commissioner/league/1/teams/5/avatar')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  // Exactly one notification row — a private notify() to the owner, never a
  // notifyLeague() broadcast (which would insert one row per team owner).
  assert.equal(notifyInserts.length, 1);
  // #274: the baseline for the two refusals. The same matchers they assert are
  // zero return one here, so a zero over there is a real observation.
  assert.equal(fake.matching(update('teams')).length, 1);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});

test('DELETE .../teams/:teamId/avatar 404s when the team is not in that league', async (t) => {
  const fake = createFakePool([
    [
      /^SELECT \*, \("leagues"\."owner_id" = \$2 OR EXISTS/,
      () => ({ rows: [{ id: 1, owner_id: 7, is_commissioner: true, current_season: 2026, current_week: 1 }] }),
    ],
    [/^SELECT "owner_id", "avatar_url", "avatar_static_url" FROM "teams"/, () => ({ rows: [] })],
    ...WRITES,
  ]).install(t);
  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .delete('/api/commissioner/league/1/teams/999/avatar')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 404);
  // The `if (!team) throw 404` sits directly above the UPDATE, so this is the
  // one-statement move the ticket is about.
  assertNoAvatarWrite(fake);
  fake.assertClean();
});
