const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select } = require('./helpers/fakePool');
const {
  commissionerPredicate,
  isLeagueCommissioner,
  isLeagueOwner,
  listCoCommissioners,
} = require('../services/leagueRole.service');

/**
 * Stands in for Postgres over a tiny fixture: league 1 owned by user 7 with
 * user 42 as a co-commissioner. Only understands the shapes this module
 * emits (the commissioner EXISTS predicate sits before the plain owner
 * lookup because both are SELECTs from leagues to the shape matcher); the
 * membership reads are covered in leagueMembership.test.js.
 */
function fakeDb({ ownerId = 7, coCommissioners = [42] } = {}) {
  const one = { rows: [{ '?column?': 1 }] };
  const none = { rows: [] };
  const isCommissioner = (userId) => userId === ownerId || coCommissioners.includes(userId);
  return createFakePool([
    [/FROM "league_commissioners" JOIN "users"/, () => ({
      rows: coCommissioners.map((id) => ({ user_id: id, username: `u${id}` })),
    })],
    [/EXISTS/, (_text, [leagueId, userId]) => (leagueId === 1 && isCommissioner(userId) ? one : none)],
    [select('leagues'), (_text, [leagueId, userId]) => (leagueId === 1 && userId === ownerId ? one : none)],
  ]);
}

test('commissionerPredicate parameterizes the user id at the requested index', () => {
  const sql = commissionerPredicate(3);
  assert.match(sql, /"leagues"\."owner_id" = \$3/);
  assert.match(sql, /"league_commissioners"\."user_id" = \$3/);
  // It must correlate to the outer leagues row, not re-select one.
  assert.match(sql, /"league_commissioners"\."league_id" = "leagues"\."id"/);
});

test('isLeagueCommissioner accepts the owner and co-commissioners, rejects everyone else', async () => {
  const db = fakeDb();
  assert.equal(await isLeagueCommissioner(db, 1, 7), true, 'owner');
  assert.equal(await isLeagueCommissioner(db, 1, 42), true, 'co-commissioner');
  assert.equal(await isLeagueCommissioner(db, 1, 55), false, 'plain member');
  assert.equal(await isLeagueCommissioner(db, 2, 7), false, 'different league');
});

test('isLeagueCommissioner short-circuits on missing ids without querying', async () => {
  const db = fakeDb();
  assert.equal(await isLeagueCommissioner(db, 1, undefined), false);
  assert.equal(await isLeagueCommissioner(db, null, 7), false);
  assert.equal(db.calls.length, 0);
});

test('isLeagueOwner stays strict — a co-commissioner is not the owner', async () => {
  const db = fakeDb();
  assert.equal(await isLeagueOwner(db, 1, 7), true);
  assert.equal(await isLeagueOwner(db, 1, 42), false);
});

test('listCoCommissioners returns user ids with usernames', async () => {
  const db = fakeDb({ coCommissioners: [42, 43] });
  assert.deepEqual(await listCoCommissioners(db, 1), [
    { user_id: 42, username: 'u42' },
    { user_id: 43, username: 'u43' },
  ]);
});
