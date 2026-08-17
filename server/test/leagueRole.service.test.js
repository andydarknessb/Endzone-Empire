const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LeagueRoleError,
  commissionerPredicate,
  isLeagueCommissioner,
  isLeagueOwner,
  listCoCommissioners,
  isMember,
  requireMember,
} = require('../services/leagueRole.service');

/**
 * Stands in for Postgres over a tiny fixture: a league owned by user 7 with
 * user 42 as a co-commissioner and user 55 as a plain member (each of the
 * three holds a Team there). Only understands the shapes this module emits.
 */
function fakeDb({ ownerId = 7, coCommissioners = [42], members = [7, 42, 55] } = {}) {
  return {
    calls: [],
    async query(sql, params) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      this.calls.push({ sql: text, params, forUpdate: /FOR UPDATE$/.test(text) });
      if (text.includes('FROM "league_commissioners" JOIN "users"')) {
        return { rows: coCommissioners.map((id) => ({ user_id: id, username: `u${id}` })) };
      }
      const [leagueId, userId] = params;
      if (leagueId !== 1) return { rows: [] };
      if (text.includes('FROM "teams"')) {
        if (!members.includes(userId)) return { rows: [] };
        return { rows: [{ id: 100 + userId, league_id: leagueId, owner_id: userId, name: `Team ${userId}` }] };
      }
      if (text.includes('EXISTS')) {
        const allowed = userId === ownerId || coCommissioners.includes(userId);
        return { rows: allowed ? [{ '?column?': 1 }] : [] };
      }
      return { rows: userId === ownerId ? [{ '?column?': 1 }] : [] };
    },
  };
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

test('isMember is true for anyone holding a Team in the league, false otherwise', async () => {
  const db = fakeDb();
  assert.equal(await isMember(db, 1, 7), true, 'owner');
  assert.equal(await isMember(db, 1, 42), true, 'co-commissioner');
  assert.equal(await isMember(db, 1, 55), true, 'plain member');
  assert.equal(await isMember(db, 1, 99), false, 'not in the league');
  assert.equal(await isMember(db, 2, 55), false, 'different league');
});

test('isMember short-circuits on missing ids without querying', async () => {
  const db = fakeDb();
  assert.equal(await isMember(db, 1, undefined), false);
  assert.equal(await isMember(db, null, 55), false);
  assert.equal(db.calls.length, 0);
});

test('requireMember returns the whole Team row of a member', async () => {
  const db = fakeDb();
  const team = await requireMember(db, { leagueId: 1, userId: 55 });
  assert.deepEqual(team, { id: 155, league_id: 1, owner_id: 55, name: 'Team 55' });
  assert.equal(db.calls[0].forUpdate, false, 'not locked unless asked');
});

test('requireMember locks the Team row when forUpdate is requested', async () => {
  const db = fakeDb();
  const team = await requireMember(db, { leagueId: 1, userId: 55, forUpdate: true });
  assert.equal(team.id, 155);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].forUpdate, true);
});

test('requireMember refuses a non-member with the coded 403', async () => {
  const db = fakeDb();
  await assert.rejects(
    requireMember(db, { leagueId: 1, userId: 99 }),
    (error) => error instanceof LeagueRoleError
      && error.statusCode === 403
      && error.message === 'not a member of this league'
  );
});

test('requireMember refuses missing ids without querying', async () => {
  const db = fakeDb();
  await assert.rejects(requireMember(db, { leagueId: 1, userId: undefined }), { statusCode: 403 });
  await assert.rejects(requireMember(db, { leagueId: null, userId: 55 }), { statusCode: 403 });
  assert.equal(db.calls.length, 0);
});
