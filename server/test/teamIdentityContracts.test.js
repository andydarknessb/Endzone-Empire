const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const {
  getDraftState,
  draftJoinAck,
  presencePayload,
  chatMessagePayload,
} = require('../modules/draftSocket');
const { draftPlayer } = require('../services/draft.service');
const lineupService = require('../services/lineup.service');

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

// ------------------------------------------- Draft snapshot and Draft events

const DRAFT_LEAGUE = {
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  draft_status: 'active',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  current_pick: 0, // 0-based: the first slot in the Draft order
  invite_code: 'invite',
};

const draftTeamRow = ({ userId, teamId, teamName }, draftPosition) => ({
  id: teamId,
  name: teamName,
  teamId,
  teamName,
  draft_position: draftPosition,
  autodraft: false,
  draft_ready: true,
  owner_id: userId,
  owner: `u${userId}`,
});

function draftStateFake(t) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ ...DRAFT_LEAGUE }] })],
    [/FROM "teams" JOIN "users"/, () => ({
      rows: [draftTeamRow(VIEWER, 1), draftTeamRow(OTHER, 2)],
    })],
    [/FROM "draft_picks"/, () => ({
      rows: [{
        pick_number: 1,
        team_id: OTHER.teamId,
        teamId: OTHER.teamId,
        teamName: OTHER.teamName,
        is_keeper: false,
        player_id: 900,
        name: 'Justin Jefferson',
        position: 'WR',
        nfl_team: 'MIN',
      }],
    })],
  ]).install(t);
}

test('Draft snapshot: every team carries Team identity beside its account fields', async (t) => {
  const fake = draftStateFake(t);

  const state = await getDraftState(LEAGUE_ID);

  assert.deepEqual(
    state.teams.map((team) => [team.teamId, team.teamName]),
    [[VIEWER.teamId, VIEWER.teamName], [OTHER.teamId, OTHER.teamName]]
  );
  assert.equal(state.teams[1].owner_id, OTHER.userId, 'the legacy account fields survive');
  assert.equal(state.teams[1].owner, `u${OTHER.userId}`);
  const [teamsQuery] = fake.matching(/FROM "teams" JOIN "users"/);
  assert.match(teamsQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
});

test('Draft snapshot: the team On the clock carries Team identity', async (t) => {
  draftStateFake(t);

  const state = await getDraftState(LEAGUE_ID);

  assert.equal(state.onTheClock.teamId, VIEWER.teamId);
  assert.equal(state.onTheClock.teamName, VIEWER.teamName);
  assert.equal(state.onTheClock.owner_id, VIEWER.userId);
});

test('Draft snapshot: every Pick names the Team that made it, not just its id', async (t) => {
  const fake = draftStateFake(t);

  const state = await getDraftState(LEAGUE_ID);

  const [pick] = state.picks;
  assert.equal(pick.teamId, OTHER.teamId);
  assert.equal(pick.teamName, OTHER.teamName);
  assert.equal(pick.team_id, OTHER.teamId, 'the legacy pick field survives');
  // `name` on a pick row is the PLAYER's name, which is exactly why the Team
  // needs its own contract field rather than another bare `name`.
  assert.equal(pick.name, 'Justin Jefferson');
  const [picksQuery] = fake.matching(/FROM "draft_picks"/);
  assert.match(picksQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
});

test('draft:picked: the Pick outcome names the Team that made it', async (t) => {
  // draft:picked is `{ ...outcome, by }`, so the Pick's own Team identity has
  // to come off the outcome for the broadcast to attribute it by Team.
  const league = {
    id: LEAGUE_ID,
    draft_status: 'active',
    draft_paused: false,
    draft_type: 'snake',
    draft_rotation: 'snake',
    draft_order_overrides: null,
    pickem_only: false,
    roster_limit: 3,
    ir_slots: 1,
    draft_rounds: 2,
    position_caps: {},
    current_pick: 0, // 0-based: the viewer's Team holds the first slot
    pick_time_seconds: 60,
    autodraft_delay_seconds: 10,
    waiver_period_hours: 24,
  };
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [
      { id: VIEWER.teamId, name: VIEWER.teamName, owner_id: VIEWER.userId, draft_position: 1, autodraft: false, locked: false },
      { id: OTHER.teamId, name: OTHER.teamName, owner_id: OTHER.userId, draft_position: 2, autodraft: false, locked: false },
    ] })],
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ pick_deadline_at: null }] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  const outcome = await draftPlayer({ leagueId: LEAGUE_ID, userId: VIEWER.userId, playerId: 500 });

  assert.equal(outcome.teamId, VIEWER.teamId, 'the legacy Team id field survives');
  assert.equal(outcome.teamName, VIEWER.teamName);
  fake.assertClean();
});

test('draft:join acknowledges the viewer with their own Team ID', () => {
  assert.deepEqual(draftJoinAck({ id: VIEWER.teamId, name: VIEWER.teamName }), {
    ok: true,
    viewerTeamId: VIEWER.teamId,
  });
  assert.deepEqual(draftJoinAck(null), { ok: true, viewerTeamId: null });
});

test('draft:presence carries the joining manager\'s Team identity beside their account', () => {
  assert.deepEqual(
    presencePayload({ id: VIEWER.userId, username: 'u42' }, { id: VIEWER.teamId, name: VIEWER.teamName }),
    { userId: VIEWER.userId, username: 'u42', teamId: VIEWER.teamId, teamName: VIEWER.teamName, joined: true }
  );
});

test('a broadcast Draft payload never carries a viewer-relative field', () => {
  // One draft:presence payload reaches the whole league room, so no field on
  // it can be true for every recipient. viewerTeamId lives on the join ack,
  // which is answered to one socket.
  const payload = presencePayload(
    { id: VIEWER.userId, username: 'u42' },
    { id: VIEWER.teamId, name: VIEWER.teamName }
  );
  assert.equal('viewerTeamId' in payload, false);
  assert.equal('isViewer' in payload, false);
});
