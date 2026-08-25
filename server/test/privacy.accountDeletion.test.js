/**
 * Account deletion: what a successful delete revokes, and what a failed one
 * must leave standing (#275).
 *
 * Deletion is a SOFT delete - eight user-owned tables are hard-deleted and
 * the `users` row is anonymized with an UPDATE - so no foreign-key cascade
 * ever fires. Anything that has to end when the account ends has to be
 * written down in the service, inside the same transaction.
 *
 * These tests live in their own file rather than beside the two privacy
 * tests parked at the bottom of pickem.service.test.js, which is only where
 * the Pick'em suite happens to exercise the same flow.
 *
 * The transaction-boundary test does not reason about where the statement
 * sits in the source. It runs the failure against a fake whose
 * league_commissioners rows are STAGED on the transactional client and
 * become real only at COMMIT, while the same statement arriving off the pool
 * auto-commits. A revocation that commits independently of the deletion
 * therefore survives the rollback and fails the assertion - which is the
 * defect this ticket fixes, reappearing one layer up.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, remove, select, update } = require('./helpers/fakePool');
const privacy = require('../services/privacy.service');

const USER = 9;
const OTHER_USER = 5;

const GRANT_DELETE = remove('league_commissioners');

/**
 * A league_commissioners table with transaction visibility: staged writes on
 * a checked-out client, immediate writes off the pool. Returns handlers to
 * splice in ahead of the generic deletion handlers.
 */
function grantWorld(grants) {
  const state = { committed: grants.map((grant) => ({ ...grant })), staged: null };
  const without = (rows, userId) => rows.filter((row) => row.user_id !== userId);

  const handlers = [
    [/^BEGIN$/, () => {
      state.staged = state.committed.map((grant) => ({ ...grant }));
      return { rows: [] };
    }],
    [/^COMMIT$/, () => {
      if (state.staged) state.committed = state.staged;
      state.staged = null;
      return { rows: [] };
    }],
    [/^ROLLBACK$/, () => {
      state.staged = null;
      return { rows: [] };
    }],
    // Inside the transaction: staged, and real only once COMMIT lands.
    [GRANT_DELETE, (text, params) => {
      // Anchored at BOTH ends on purpose, and the reason generalizes: an
      // unanchored pattern over generated SQL asserts a LOWER BOUND, not an
      // equality. It says the statement CONTAINS this clause, and
      // containment is satisfied by anything more restrictive - so the
      // assertion is weakest in exactly the direction a scoping bug travels,
      // toward doing LESS than intended. That is the direction that matters
      // for a revocation. /WHERE "user_id" = \$1/ unanchored is happily
      // satisfied by `WHERE "user_id" = $1 AND "league_id" = 3`, and the
      // fake removes rows by params[0] whatever the SQL says, so neither
      // half of this test could see the narrowing. The criterion is EVERY
      // grant the account holds; anchoring is what holds the statement to it.
      assert.match(
        text,
        /^DELETE FROM "league_commissioners" WHERE "user_id" = \$1$/,
        'every grant the account holds, keyed on the user alone and nothing else'
      );
      state.staged = without(state.staged, params[0]);
      return { rows: [] };
    }, 'client'],
    // Off the pool: its own auto-committed statement, which survives a
    // rollback. Nothing should ever reach this handler.
    [GRANT_DELETE, (text, params) => {
      state.committed = without(state.committed, params[0]);
      return { rows: [] };
    }, 'pool'],
  ];

  return {
    handlers,
    grantsFor: (userId) => state.committed.filter((row) => row.user_id === userId),
  };
}

/** The happy path every test starts from; overrides go in front of it. */
const deletionHandlers = ({ owned = [], avatars = [] } = {}) => [
  [select('users'), () => ({ rows: [{ id: USER, username: 'me' }] })],
  [select('leagues'), () => ({ rows: owned })],
  [select('teams'), () => ({ rows: avatars })],
  [update('teams'), () => ({ rows: [] })],
  [update('users'), () => ({ rows: [] })],
  [/^DELETE FROM /, () => ({ rows: [] })],
  [insert('data_privacy_requests'), () => ({ rows: [] })],
];

const twoGrants = () => [
  { league_id: 3, user_id: USER },
  { league_id: 7, user_id: USER },
  { league_id: 3, user_id: OTHER_USER },
];

test('a successful deletion revokes every co-commissioner grant the account holds', async (t) => {
  const world = grantWorld(twoGrants());
  const fake = createFakePool([...world.handlers, ...deletionHandlers()]).install(t);

  await privacy.deleteUserAccount({ userId: USER, confirmation: 'me' });

  assert.deepEqual(world.grantsFor(USER), [], 'every grant held by the deleted account is gone');
  assert.equal(world.grantsFor(OTHER_USER).length, 1, 'another commissioner keeps theirs');
  assert.ok(fake.calls.some((call) => call.text === 'COMMIT'));
  assert.equal(fake.matching(GRANT_DELETE).length, 1, 'revoked in one statement');
  assert.equal(fake.matching(GRANT_DELETE)[0].via, 'client', 'issued on the transactional client');
  fake.assertClean();
});

test('a failure after the revocation rolls the grants back with the rest of the deletion', async (t) => {
  const world = grantWorld(twoGrants());
  const fake = createFakePool([
    ...world.handlers,
    // The anonymization runs AFTER the revocation, so a failure here is
    // exactly the window in which a separately-committed revocation would
    // already be permanent.
    [update('users'), () => { throw new Error('deadlock detected'); }],
    ...deletionHandlers(),
  ]).install(t);

  await assert.rejects(
    () => privacy.deleteUserAccount({ userId: USER, confirmation: 'me' }),
    /deadlock detected/
  );

  assert.equal(world.grantsFor(USER).length, 2, 'the grants survive a rolled-back deletion');
  assert.ok(fake.calls.some((call) => call.text === 'ROLLBACK'));
  assert.ok(!fake.calls.some((call) => call.text === 'COMMIT'), 'nothing was committed');
  assert.equal(
    fake.matching(GRANT_DELETE)[0].via,
    'client',
    'the revocation was issued inside the transaction'
  );
  fake.assertClean();
});

test('a co-commissioner who created no league can still delete their account', async (t) => {
  // The creator-only guard finds nothing: this account holds grants but owns
  // no league, and revoking those grants must not trip the guard on the way
  // past.
  const world = grantWorld([{ league_id: 3, user_id: USER }]);
  const fake = createFakePool([...world.handlers, ...deletionHandlers({ owned: [] })]).install(t);

  await privacy.deleteUserAccount({ userId: USER, confirmation: 'me' });

  // The guard really ran and really is creator-shaped: it is the
  // leagues.owner_id comparison, asked about this user, and it found nothing.
  const guardIndex = fake.calls.findIndex((call) => /FROM "leagues"/.test(call.text));
  assert.ok(guardIndex >= 0, 'the creator-only guard ran');
  assert.match(fake.calls[guardIndex].text, /WHERE "leagues"\."owner_id" = \$1/);
  assert.deepEqual(fake.calls[guardIndex].params, [USER]);

  // And it ran BEFORE the revocation. The other order would revoke a live
  // commissioner's powers on the way to refusing their deletion.
  const revokeIndex = fake.calls.findIndex((call) => GRANT_DELETE.test(call.text));
  assert.ok(guardIndex < revokeIndex, 'the guard is consulted before anything is revoked');

  assert.deepEqual(world.grantsFor(USER), []);
  assert.ok(fake.calls.some((call) => call.text === 'COMMIT'));
  fake.assertClean();
});

test('a league creator is still refused, and the message names the leagues they created', async (t) => {
  const world = grantWorld(twoGrants());
  const fake = createFakePool([
    ...world.handlers,
    ...deletionHandlers({ owned: [{ id: 3, name: 'Ballers', team_count: 8 }] }),
  ]).install(t);

  await assert.rejects(
    () => privacy.deleteUserAccount({ userId: USER, confirmation: 'me' }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'ACCOUNT_OWNS_LEAGUES');
      // The rule keys on leagues.owner_id - the creator alone - so the copy
      // says created, not commissioned (#275).
      assert.match(error.message, /leagues you created/);
      assert.doesNotMatch(error.message, /commission/i);
      assert.doesNotMatch(error.message, /[–—]/, 'house style: no em-dashes in user-facing copy');
      assert.deepEqual(error.details, { leagues: [{ id: 3, name: 'Ballers', team_count: 8 }] });
      return true;
    }
  );

  // A refusal writes nothing at all, the grants included.
  assert.deepEqual(fake.calls.filter((call) => /^(DELETE|UPDATE|INSERT)/.test(call.text)), []);
  assert.equal(world.grantsFor(USER).length, 2);
  assert.ok(fake.calls.some((call) => call.text === 'ROLLBACK'));
  fake.assertClean();
});

test('revoking authorization does not delete league history', async (t) => {
  const world = grantWorld(twoGrants());
  const fake = createFakePool([...world.handlers, ...deletionHandlers()]).install(t);

  await privacy.deleteUserAccount({ userId: USER, confirmation: 'me' });

  // Teams, leagues and draft history are the league's record, not the
  // account's own content: the deletion clears a Team's avatar and stops.
  for (const table of ['teams', 'leagues', 'draft_picks', 'transactions', 'rosters']) {
    assert.deepEqual(
      fake.matching(remove(table)),
      [],
      `account deletion must not delete rows from "${table}"`
    );
  }
  assert.equal(
    fake.matching(update('teams')).length,
    1,
    'the Team is kept, only its avatar is cleared'
  );
});
