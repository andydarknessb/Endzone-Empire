const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

/**
 * Contract tests for #112 (parent #108): the EXPAND step of the shared
 * identity migration. Every league-shared contract carries Team identity
 * (`teamId` + `teamName`) for each participant or author, and every
 * per-viewer channel carries `viewerTeamId`, BESIDE the account fields that
 * are still there. Nothing is removed here, so every assertion comes in
 * pairs: the new Team identity is present, and the legacy account field is
 * still present so no consumer is forced to migrate in this change (#115
 * removes them, once #113 and #114 have moved the consumers).
 *
 * Four surfaces, in the order the issue names them: league detail, Draft
 * snapshots and events, chat, and pick'em.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'team-identity-contract-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const LEAGUE_ID = 1;
const VIEWER = { userId: 42, teamId: 11, teamName: 'Gridiron Ghosts' };
const OTHER = { userId: 43, teamId: 12, teamName: 'Sunday Scaries' };
const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

// ---------------------------------------------------------------- league detail

const LEAGUE_ROW = {
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  owner_id: VIEWER.userId,
  invite_code: 'invite',
  owner_username: 'u42',
  ownerTeamId: VIEWER.teamId,
  ownerTeamName: VIEWER.teamName,
};

const teamRow = ({ userId, teamId, teamName }) => ({
  id: teamId,
  name: teamName,
  teamId,
  teamName,
  owner_id: userId,
  owner: `u${userId}`,
  draft_position: 1,
  faab_remaining: 100,
  locked: false,
  draft_ready: true,
  roster_count: 0,
  total_points: '0',
});

function leagueDetailFake(t, { coCommissioners = [] } = {}) {
  return createFakePool([
    [/AS "owner_username"/, () => ({ rows: [{ ...LEAGUE_ROW }] })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "league_commissioners"/, () => ({ rows: coCommissioners })],
    [/COUNT\("team_players"\."id"\)/, () => ({ rows: [teamRow(VIEWER), teamRow(OTHER)] })],
  ]).install(t);
}

test('league detail: every team carries Team identity beside its account fields', async (t) => {
  const fake = leagueDetailFake(t);

  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [mine, theirs] = res.body.teams;
  assert.equal(mine.teamId, VIEWER.teamId);
  assert.equal(mine.teamName, VIEWER.teamName);
  assert.equal(theirs.teamId, OTHER.teamId);
  assert.equal(theirs.teamName, OTHER.teamName);
  // Beside, not instead of: the account fields a consumer reads today survive.
  assert.equal(theirs.owner_id, OTHER.userId);
  assert.equal(theirs.owner, `u${OTHER.userId}`);
  // The wire names come from the shared aliases, so they cannot drift.
  const [teamsQuery] = fake.matching(/COUNT\("team_players"\."id"\)/);
  assert.match(teamsQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
});

test('league detail: the response names the viewer\'s own Team explicitly', async (t) => {
  leagueDetailFake(t);

  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.viewerTeamId, VIEWER.teamId);
  // "Which of these is me" is now teamId === viewerTeamId, so a consumer
  // never has to hold another manager's account ID to answer it.
  assert.deepEqual(
    res.body.teams.filter((team) => team.teamId === res.body.viewerTeamId).map((team) => team.teamName),
    [VIEWER.teamName]
  );
});

test('league detail: viewerTeamId is null for a viewer who holds no team in the league', async (t) => {
  leagueDetailFake(t);

  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(999));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.viewerTeamId, null);
});

test('league detail: the league creator and the co-commissioners carry Team identity', async (t) => {
  const fake = leagueDetailFake(t, {
    coCommissioners: [{ user_id: OTHER.userId, username: 'u43', teamId: OTHER.teamId, teamName: OTHER.teamName }],
  });

  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.league.ownerTeamId, VIEWER.teamId);
  assert.equal(res.body.league.ownerTeamName, VIEWER.teamName);
  assert.equal(res.body.league.owner_id, VIEWER.userId, 'the legacy creator account field survives');
  assert.equal(res.body.league.owner_username, 'u42');
  assert.deepEqual(res.body.league.co_commissioners, [
    { user_id: OTHER.userId, username: 'u43', teamId: OTHER.teamId, teamName: OTHER.teamName },
  ]);
  const [leagueQuery] = fake.matching(/AS "owner_username"/);
  assert.match(leagueQuery.text, /AS "ownerTeamId"/);
  const [coCommissionerQuery] = fake.matching(/^SELECT "league_commissioners"\."user_id"/);
  assert.match(coCommissionerQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
});
