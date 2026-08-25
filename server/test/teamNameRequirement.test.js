const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { joinPublicLeague, decideJoinRequest } = require('../services/discovery.service');
const { MembershipError } = require('../services/leagueMembership.service');
/**
 * Contract tests for #111 (Require explicit Team names and repair legacy
 * email-derived names), the parts leagueJoinability.test.js doesn't cover:
 * the join-request (approval-required public join) branch of
 * joinPublicLeague, which validates and stores a required Team name up
 * front rather than deferring to approval time, and its resubmission path
 * after a request was denied OR cancelled (the migration's outcome for a
 * legacy nameless pending request, per AC3).
 *
 * (leagueMembership.test.js and teamName.test.js already cover joinLeague's
 * own required-name enforcement, which every other path -- create,
 * invite-code join, immediate public join, and join-request approval --
 * runs through.)
 */
// Migrated off this suite's own hand-rolled pool fake and onto the shared
// helper, per the migration rule in helpers/fakePool.js's header: touching a
// suite's bespoke fake means moving it over. #188 touched it, because the
// join-request fan-out now reads one more table, so it moves.
//
// Two things come with the move that the local fake did not have. Its
// `release` was a no-op, so a leaked client or a transaction left open was
// invisible; `assertClean()` proves both now. And the helper answers
// BEGIN/COMMIT/ROLLBACK itself, so the old TXN block is gone.
function installFake(t, handlers) {
  const fake = createFakePool(handlers);
  fake.install(t);
  return fake;
}
// Filing a request now alerts every commissioner rather than the creator
// alone (#188), so the approval branch reads the co-commissioner roster on its
// way out. These leagues have none, so the owner is still the only recipient
// and nothing else about these tests changes. Fan-out itself is covered by
// commissionerAlertFanout.test.js.
// Anchored to listCoCommissioners' own SELECT list, not to a bare
// `FROM "league_commissioners"`: commissionerPredicate embeds that table in an
// EXISTS subquery, so the loose pattern would also swallow decideJoinRequest's
// `SELECT * FROM "leagues" ... AND (... EXISTS ...)` and answer it with no
// league.
const COMMISSIONER_ALERT = [
  [/^SELECT "league_commissioners"\."user_id"/, () => ({ rows: [] })],
  [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
];
const upserted = (calls) => calls.filter((c) => /INSERT INTO "join_requests"/.test(c.text));
const committed = (calls) => calls.some((c) => c.text === 'COMMIT');
const APPROVAL_LEAGUE = {
  id: 7, name: 'Curated League', owner_id: 100, is_public: true, join_approval: true,
  max_teams: 10, pickem_only: false, draft_status: 'pending', season_status: 'regular',
};

test('joinPublicLeague (join_approval): validates and trims the Team name, then upserts a pending request', async (t) => {
  const fake = installFake(t, [
    ...COMMISSIONER_ALERT,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [APPROVAL_LEAGUE] })],
    [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
    [/INSERT INTO "join_requests"/, (_text, params) => ({
      rows: [{ id: 9, league_id: params[0], user_id: params[1], team_name: params[2], status: 'pending' }],
    })],
    [/INSERT INTO "notifications"|INSERT INTO "activity"|notif/i, () => ({ rows: [{ id: 1 }] })],
  ]);
  const result = await joinPublicLeague({ leagueId: 7, userId: 5, username: 'eve', teamName: '  Eve Picks  ' });
  assert.equal(result.pending, true);
  const [insert] = upserted(fake.calls);
  assert.deepEqual(insert.params, [7, 5, 'Eve Picks']);
  assert.equal(committed(fake.calls), true);
  fake.assertClean();
});

test('joinPublicLeague (join_approval): refuses a missing, blank or whitespace-only Team name with 400, before any upsert', async (t) => {
  for (const teamName of [undefined, null, '', '   ']) {
    const fake = installFake(t, [
      ...COMMISSIONER_ALERT,
      [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [APPROVAL_LEAGUE] })],
      [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
      [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
    ]);
    await assert.rejects(
      joinPublicLeague({ leagueId: 7, userId: 5, username: 'eve', teamName }),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, 'Team name is required');
        return true;
      }
    );
    assert.equal(upserted(fake.calls).length, 0, `no upsert for teamName=${JSON.stringify(teamName)}`);
    assert.equal(committed(fake.calls), false);
    fake.assertClean();
  }
});

test('joinPublicLeague (join_approval): refuses a Team name over 120 characters, before any upsert', async (t) => {
  const fake = installFake(t, [
    ...COMMISSIONER_ALERT,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [APPROVAL_LEAGUE] })],
    [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
  ]);
  await assert.rejects(
    joinPublicLeague({ leagueId: 7, userId: 5, username: 'eve', teamName: 'x'.repeat(121) }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Team name must be 120 characters or fewer');
      return true;
    }
  );
  assert.equal(upserted(fake.calls).length, 0);
  fake.assertClean();
});

for (const priorStatus of ['denied', 'cancelled']) {
  test(`joinPublicLeague (join_approval): resubmitting after a '${priorStatus}' request refiles it as pending with the new name`, async (t) => {
    // The ON CONFLICT ... WHERE clause is what the real database evaluates;
    // this mock stands in for it by returning a row only when the prior
    // status is one this path is meant to resurrect from.
    const fake = installFake(t, [
      ...COMMISSIONER_ALERT,
      [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [APPROVAL_LEAGUE] })],
      [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
      [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
      [/INSERT INTO "join_requests"/, (text, params) => {
        assert.match(text, /WHERE "join_requests"\."status" IN \('denied', 'cancelled'\)/);
        return { rows: [{ id: 9, league_id: params[0], user_id: params[1], team_name: params[2], status: 'pending' }] };
      }],
      [/INSERT INTO "notifications"|INSERT INTO "activity"|notif/i, () => ({ rows: [{ id: 1 }] })],
    ]);
    const result = await joinPublicLeague({ leagueId: 7, userId: 5, username: 'eve', teamName: 'Second Try FC' });
    assert.equal(result.pending, true);
    assert.equal(result.joinRequest.status, 'pending');
    assert.equal(result.joinRequest.team_name, 'Second Try FC');
    assert.equal(committed(fake.calls), true);
    fake.assertClean();
  });
}

test('joinPublicLeague (join_approval): a still-pending request is surfaced as-is, refusing a second file', async (t) => {
  const existingPending = { id: 9, league_id: 7, user_id: 5, team_name: 'Already Filed', status: 'pending' };
  const fake = installFake(t, [
    ...COMMISSIONER_ALERT,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [APPROVAL_LEAGUE] })],
    [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
    // No row returned from the upsert: the WHERE clause did not match
    // (status is already 'pending', not 'denied'/'cancelled').
    [/INSERT INTO "join_requests"/, () => ({ rows: [] })],
    [/SELECT \* FROM "join_requests" WHERE "league_id" = \$1 AND "user_id" = \$2/, () => ({ rows: [existingPending] })],
    [/INSERT INTO "notifications"|INSERT INTO "activity"|notif/i, () => ({ rows: [{ id: 1 }] })],
  ]);
  const result = await joinPublicLeague({ leagueId: 7, userId: 5, username: 'eve', teamName: 'Second Try FC' });
  assert.equal(result.pending, true);
  assert.equal(result.joinRequest, existingPending);
  fake.assertClean();
});

test('decideJoinRequest (approve): a nameless join request cannot slip through -- joinLeague refuses it with the same 400', async (t) => {
  const fake = installFake(t, [
    ...COMMISSIONER_ALERT,
    [/FROM "leagues" WHERE "id" = \$1 AND .*FOR UPDATE/, () => ({ rows: [APPROVAL_LEAGUE] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [APPROVAL_LEAGUE] })],
    [/FROM "join_requests" JOIN "users"/, () => ({
      rows: [{ id: 3, user_id: 5, username: 'eve', team_name: null, status: 'pending' }],
    })],
    [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
    // #274: both writes answered, so the counts below observe an absence
    // rather than inherit fakePool's "unexpected query" throw.
    [/^INSERT INTO "teams"/, () => ({ rows: [{ id: 99 }], rowCount: 1 })],
    [/^UPDATE "join_requests"/, () => ({ rows: [], rowCount: 1 })],
  ]);
  await assert.rejects(
    decideJoinRequest({ leagueId: 7, ownerId: 100, requestId: 3, approve: true }),
    (error) => error instanceof MembershipError && error.statusCode === 400 && error.message === 'Team name is required'
  );
  // #274. The two A-class tests above use upserted() for exactly this; this one
  // had no absence evidence at all. An approval that creates the Team and then
  // refuses would leave a nameless Team behind on any path that did not roll
  // back, and mark the request approved to boot.
  assert.equal(fake.matching(/^INSERT INTO "teams"/).length, 0, 'no nameless Team was created');
  assert.equal(
    fake.matching(/^UPDATE "join_requests"/).length,
    0,
    'and the request was not marked approved'
  );
  fake.assertClean();
});
