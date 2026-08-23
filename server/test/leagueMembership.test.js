const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const {
  MembershipError,
  isMember,
  requireMember,
  assertAdmissible,
  joinLeague,
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

/* ------------------------------------------------------------------ *
 * Admission and the membership write                                  *
 * ------------------------------------------------------------------ */

const FANTASY_PRE_DRAFT = {
  id: 7, name: 'Sunday Ballers', owner_id: 100, max_teams: 10,
  pickem_only: false, draft_status: 'pending', season_status: 'regular',
};
const FANTASY_DRAFTING = { ...FANTASY_PRE_DRAFT, draft_status: 'active' };
const PICKEM_IN_SEASON = {
  id: 8, name: 'Office Pool', owner_id: 100, max_teams: 50,
  pickem_only: true, draft_status: 'complete', season_status: 'regular',
};
const PICKEM_COMPLETE = { ...PICKEM_IN_SEASON, season_status: 'complete' };

const COUNT_TEAMS = /^SELECT COUNT\(\*\)::int AS n FROM "teams" WHERE "league_id" = \$1$/;
const LOCK_LEAGUE = /^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE$/;
const TX = /^(BEGIN|COMMIT|ROLLBACK)$/;

/**
 * One league, its members and its team count, behind a checked-out client.
 * The COUNT matcher sits before the generic teams SELECT because both are
 * "SELECT ... FROM teams" to the shape matcher.
 */
async function world({ league, members = [], teamCount = members.length, onInsert } = {}) {
  const fake = createFakePool([
    [select('leagues'), (_text, [id]) => ({ rows: league && league.id === id ? [league] : [] })],
    [COUNT_TEAMS, () => ({ rows: [{ n: teamCount }] })],
    [select('teams'), (_text, [, userId]) => ({ rows: members.includes(userId) ? [{ id: 1 }] : [] })],
    [insert('teams'), onInsert || ((_text, params) => ({
      rows: [{ id: 99, league_id: params[0], owner_id: params[1], name: params[2], draft_position: params[3] }],
    }))],
  ]);
  return { fake, client: await fake.connect() };
}

const refusal = (statusCode, message, reason) => (error) => {
  assert.ok(error instanceof MembershipError, `expected MembershipError, got ${error && error.constructor.name}: ${error && error.message}`);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.message, message);
  if (reason) assert.equal(error.reason, reason);
  else assert.equal('reason' in error, false, 'no reason on a per-manager refusal');
  return true;
};

test('assertAdmissible: a fantasy league whose draft has started refuses 409 draft-started before any membership read', async () => {
  const { fake, client } = await world({ league: FANTASY_DRAFTING });
  await assert.rejects(
    assertAdmissible(client, FANTASY_DRAFTING, 5),
    refusal(409, 'league draft already started', 'draft-started')
  );
  assert.equal(fake.calls.length, 0, 'joinability is pure; nothing was queried');
});

test("assertAdmissible: a completed pick'em-only league refuses 409 season-complete", async () => {
  const { client } = await world({ league: PICKEM_COMPLETE });
  await assert.rejects(
    assertAdmissible(client, PICKEM_COMPLETE, 5),
    refusal(409, 'league season is complete', 'season-complete')
  );
});

test("assertAdmissible: a pick'em-only league in season is admissible whatever draft_status says", async () => {
  // 'active' is the value that refuses a fantasy league; a pick'em-only
  // league has no draft, so it must not.
  for (const draftStatus of ['pending', 'active', 'complete']) {
    const league = { ...PICKEM_IN_SEASON, draft_status: draftStatus };
    const { client } = await world({ league, teamCount: 3 });
    assert.deepEqual(await assertAdmissible(client, league, 5), { teamCount: 3 }, draftStatus);
  }
});

test('assertAdmissible: already a member refuses 409 before counting', async () => {
  const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, members: [5] });
  await assert.rejects(
    assertAdmissible(client, FANTASY_PRE_DRAFT, 5),
    refusal(409, 'already has a team in this league')
  );
  assert.equal(fake.matching(COUNT_TEAMS).length, 0, 'no count once membership refused');
  assert.deepEqual(fake.calls[0].params, [7, 5], 'the membership read is scoped to this league and manager');
});

test('assertAdmissible: a member of a full league hears already-a-member, not full (member is asked before full)', async () => {
  const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, members: [5], teamCount: 10 });
  await assert.rejects(
    assertAdmissible(client, FANTASY_PRE_DRAFT, 5),
    refusal(409, 'already has a team in this league')
  );
  assert.equal(fake.matching(COUNT_TEAMS).length, 0);
});

test('assertAdmissible: a full league refuses 409 league is full; one slot short of full admits', async () => {
  const full = await world({ league: FANTASY_PRE_DRAFT, teamCount: 10 });
  await assert.rejects(assertAdmissible(full.client, FANTASY_PRE_DRAFT, 5), refusal(409, 'league is full'));

  const open = await world({ league: FANTASY_PRE_DRAFT, teamCount: 9 });
  assert.deepEqual(await assertAdmissible(open.client, FANTASY_PRE_DRAFT, 5), { teamCount: 9 });
});

test('joinLeague: a missing league is 404 (before any team-name check)', async () => {
  const { fake, client } = await world({ league: null });
  await assert.rejects(
    joinLeague(client, { leagueId: 404, userId: 5, username: 'eve' }),
    refusal(404, 'league not found')
  );
  assert.equal(fake.matching(insert('teams')).length, 0);
});

test('joinLeague: locks the league, trims the given name, inserts draft_position = teamCount + 1, returns { league, team }', async () => {
  const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, teamCount: 3 });
  const result = await joinLeague(client, { leagueId: 7, userId: 5, username: 'eve', teamName: '  Eve Picks  ' });
  assert.equal(fake.matching(LOCK_LEAGUE).length, 1, 'the league row is locked FOR UPDATE');
  const [inserted] = fake.matching(insert('teams'));
  assert.match(inserted.text, /RETURNING \*$/);
  assert.deepEqual(inserted.params, [7, 5, 'Eve Picks', 4]);
  assert.deepEqual(result, {
    league: FANTASY_PRE_DRAFT,
    team: { id: 99, league_id: 7, owner_id: 5, name: 'Eve Picks', draft_position: 4 },
  });
  assert.equal(fake.calls.some((c) => TX.test(c.text)), false, 'the caller owns the transaction');
});

test('joinLeague: a given team name is used as is (once trimmed)', async () => {
  const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, teamCount: 3 });
  const { team } = await joinLeague(client, { leagueId: 7, userId: 5, username: 'eve', teamName: 'Eve Picks' });
  assert.equal(team.name, 'Eve Picks');
  assert.deepEqual(fake.matching(insert('teams'))[0].params, [7, 5, 'Eve Picks', 4]);
});

test('joinLeague: on a just-created league (the create path) the count is 0 and the position 1', async () => {
  const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, teamCount: 0 });
  const { team } = await joinLeague(client, { leagueId: 7, userId: 100, username: 'commish', teamName: "Commish's Crew" });
  assert.equal(team.draft_position, 1);
  assert.deepEqual(fake.matching(insert('teams'))[0].params, [7, 100, "Commish's Crew", 1]);
});

test('joinLeague: the admission rules apply on the way in (member, full, not joinable), before any team-name check', async () => {
  const member = await world({ league: FANTASY_PRE_DRAFT, members: [5] });
  await assert.rejects(joinLeague(member.client, { leagueId: 7, userId: 5, username: 'eve' }), refusal(409, 'already has a team in this league'));
  const full = await world({ league: FANTASY_PRE_DRAFT, teamCount: 10 });
  await assert.rejects(joinLeague(full.client, { leagueId: 7, userId: 5, username: 'eve' }), refusal(409, 'league is full'));
  const drafting = await world({ league: FANTASY_DRAFTING });
  await assert.rejects(joinLeague(drafting.client, { leagueId: 7, userId: 5, username: 'eve' }), refusal(409, 'league draft already started', 'draft-started'));
  for (const w of [member, full, drafting]) assert.equal(w.fake.matching(insert('teams')).length, 0);
});

test('joinLeague: a 23505 from the insert (a racing join) surfaces as the already-a-member 409', async () => {
  const { client } = await world({
    league: FANTASY_PRE_DRAFT,
    onInsert: () => { throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }); },
  });
  await assert.rejects(
    joinLeague(client, { leagueId: 7, userId: 5, username: 'eve', teamName: 'Eve Picks' }),
    refusal(409, 'already has a team in this league')
  );
});

test('joinLeague: any other insert error is rethrown untouched', async () => {
  const boom = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const { client } = await world({ league: FANTASY_PRE_DRAFT, onInsert: () => { throw boom; } });
  await assert.rejects(joinLeague(client, { leagueId: 7, userId: 5, username: 'eve', teamName: 'Eve Picks' }), (error) => error === boom);
});

/* ------------------------------------------------------------------ *
 * Required Team name (#111): the same rule on every join path, checked  *
 * after admission and before the insert.                                *
 * ------------------------------------------------------------------ */

test('joinLeague: refuses a missing, blank or whitespace-only team name with 400, and inserts nothing', async () => {
  for (const teamName of [undefined, null, '', '   ', '\t']) {
    const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, teamCount: 3 });
    await assert.rejects(
      joinLeague(client, { leagueId: 7, userId: 5, username: 'eve', teamName }),
      refusal(400, 'Team name is required')
    );
    assert.equal(fake.matching(insert('teams')).length, 0, `no insert for teamName=${JSON.stringify(teamName)}`);
  }
});

test('joinLeague: refuses a team name over 120 characters, and inserts nothing', async () => {
  const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, teamCount: 3 });
  await assert.rejects(
    joinLeague(client, { leagueId: 7, userId: 5, username: 'eve', teamName: 'x'.repeat(121) }),
    refusal(400, 'Team name must be 120 characters or fewer')
  );
  assert.equal(fake.matching(insert('teams')).length, 0);
});

test('joinLeague: accepts a team name at exactly the 120-character boundary', async () => {
  const { fake, client } = await world({ league: FANTASY_PRE_DRAFT, teamCount: 3 });
  const name = 'x'.repeat(120);
  await joinLeague(client, { leagueId: 7, userId: 5, username: 'eve', teamName: name });
  assert.deepEqual(fake.matching(insert('teams'))[0].params, [7, 5, name, 4]);
});
