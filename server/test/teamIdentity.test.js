const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const {
  teamIdentityOf,
  withTeamIdentity,
  teamIdentityColumns,
  teamIdentityJoin,
  lookupTeam,
  viewerTeamIdOf,
} = require('../services/teamIdentity');

/**
 * Unit tests for the Team identity primitive shared by every league-shared
 * contract expanded in #112 (parent #108). The per-surface contract tests
 * live in teamIdentityContracts.test.js; this file pins the helper itself.
 */

test('teamIdentityOf shapes a teams row as Team ID and Team name', () => {
  assert.deepEqual(
    teamIdentityOf({ id: 11, name: 'Gridiron Ghosts', owner_id: 5 }),
    { teamId: 11, teamName: 'Gridiron Ghosts' }
  );
});

test('teamIdentityOf answers with nulls when there is no team row', () => {
  for (const absent of [null, undefined]) {
    assert.deepEqual(teamIdentityOf(absent), { teamId: null, teamName: null });
  }
});

test('teamIdentityOf never invents identity from a partial row', () => {
  assert.deepEqual(teamIdentityOf({ id: 11 }), { teamId: 11, teamName: null });
  assert.deepEqual(teamIdentityOf({ name: 'Nameless Id' }), { teamId: null, teamName: 'Nameless Id' });
});

test('withTeamIdentity adds Team identity beside the fields an entry already carries', () => {
  const entry = { userId: 5, username: 'eve', message: 'hi' };
  assert.deepEqual(withTeamIdentity(entry, { id: 11, name: 'Eve Picks' }), {
    userId: 5,
    username: 'eve',
    message: 'hi',
    teamId: 11,
    teamName: 'Eve Picks',
  });
  assert.deepEqual(entry, { userId: 5, username: 'eve', message: 'hi' }, 'the input entry is not mutated');
});

test('teamIdentityColumns aliases the wire field names, whatever the table alias is', () => {
  assert.equal(teamIdentityColumns(), '"teams"."id" AS "teamId", "teams"."name" AS "teamName"');
  assert.equal(teamIdentityColumns('author_team'), '"author_team"."id" AS "teamId", "author_team"."name" AS "teamName"');
});

test('teamIdentityColumns mints the prefixed names too, so they cannot drift by hand', () => {
  assert.equal(
    teamIdentityColumns('owner_team', 'owner'),
    '"owner_team"."id" AS "ownerTeamId", "owner_team"."name" AS "ownerTeamName"'
  );
});

test('teamIdentityJoin always carries both legs, so identity cannot cross leagues', () => {
  const sql = teamIdentityJoin('"chat_messages"."league_id"', '"chat_messages"."user_id"');
  assert.match(sql, /^LEFT JOIN "teams" AS "teams"/, 'LEFT, so an author who left the league still reads back');
  assert.match(sql, /"teams"\."league_id" = "chat_messages"\."league_id"/);
  assert.match(sql, /"teams"\."owner_id" = "chat_messages"\."user_id"/);
  assert.match(
    teamIdentityJoin('"leagues"."id"', '"leagues"."owner_id"', 'owner_team'),
    /^LEFT JOIN "teams" AS "owner_team"/
  );
});

test('lookupTeam reads one manager\'s team in one league', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ text: String(sql).replace(/\s+/g, ' ').trim(), params });
    return { rows: [{ id: 11, name: 'Gridiron Ghosts' }] };
  });
  assert.deepEqual(await lookupTeam(pool, { leagueId: 7, userId: 5 }), { id: 11, name: 'Gridiron Ghosts' });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/);
  assert.deepEqual(queries[0].params, [7, 5]);
});

test('lookupTeam answers null for a non-member without querying on missing arguments', async (t) => {
  let queried = 0;
  t.mock.method(pool, 'query', async () => {
    queried += 1;
    return { rows: [] };
  });
  assert.equal(await lookupTeam(pool, { leagueId: 7, userId: 5 }), null);
  assert.equal(queried, 1);
  assert.equal(await lookupTeam(pool, { leagueId: null, userId: 5 }), null);
  assert.equal(await lookupTeam(pool, { leagueId: 7, userId: null }), null);
  assert.equal(queried, 1, 'no query is issued without both a league and a manager');
});

test('viewerTeamIdOf finds the viewer\'s own Team in a list of teams rows', () => {
  const teams = [
    { id: 11, owner_id: 5, name: 'Eve Picks' },
    { id: 12, owner_id: 6, name: 'Bob Ballers' },
  ];
  assert.equal(viewerTeamIdOf(teams, 6), 12);
  assert.equal(viewerTeamIdOf(teams, 99), null, 'a non-member has no viewer Team');
  assert.equal(viewerTeamIdOf(teams, null), null);
  assert.equal(viewerTeamIdOf(null, 5), null);
});
