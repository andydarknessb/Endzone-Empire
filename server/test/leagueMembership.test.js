const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select } = require('./helpers/fakePool');
const {
  MembershipError,
  isMember,
  requireMember,
} = require('../services/leagueMembership.service');

/**
 * Membership reads over a tiny fixture: league 1 has Teams for users 7, 42
 * and 55; nobody holds a Team anywhere else. The fake answers both shapes the
 * module emits (`SELECT 1` for isMember, `SELECT *` for requireMember).
 */
const MEMBERS = [7, 42, 55];

function fakeDb() {
  return createFakePool([
    [select('teams'), (_text, [leagueId, userId]) => {
      if (leagueId !== 1 || !MEMBERS.includes(userId)) return { rows: [] };
      return { rows: [{ id: 100 + userId, league_id: leagueId, owner_id: userId, name: `Team ${userId}` }] };
    }],
  ]);
}

const forUpdate = (call) => /FOR UPDATE$/.test(call.text);

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
  assert.equal(forUpdate(db.calls[0]), false, 'not locked unless asked');
});

test('requireMember locks the Team row when forUpdate is requested', async () => {
  const db = fakeDb();
  const team = await requireMember(db, { leagueId: 1, userId: 55, forUpdate: true });
  assert.equal(team.id, 155);
  assert.equal(db.calls.length, 1);
  assert.equal(forUpdate(db.calls[0]), true);
});

test('requireMember refuses a non-member with the coded 403', async () => {
  const db = fakeDb();
  await assert.rejects(
    requireMember(db, { leagueId: 1, userId: 99 }),
    (error) => error instanceof MembershipError
      && error.statusCode === 403
      && error.message === 'not a member of this league'
      && !('reason' in error)
  );
});

test('requireMember refuses missing ids without querying', async () => {
  const db = fakeDb();
  await assert.rejects(requireMember(db, { leagueId: 1, userId: undefined }), { statusCode: 403 });
  await assert.rejects(requireMember(db, { leagueId: null, userId: 55 }), { statusCode: 403 });
  assert.equal(db.calls.length, 0);
});

test('MembershipError carries a reason only when given one', () => {
  const plain = new MembershipError(409, 'league is full');
  assert.equal(plain.statusCode, 409);
  assert.equal('reason' in plain, false);
  const reasoned = new MembershipError(409, 'league draft already started', { reason: 'draft-started' });
  assert.equal(reasoned.reason, 'draft-started');
});
