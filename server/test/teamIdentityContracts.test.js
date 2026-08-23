const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const {
  getDraftState,
  joinAck,
  joinError,
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

test('league detail: viewerTeamId is present and null rather than absent when no team matches', async (t) => {
  // Membership already gates this route, so a reader always holds a team
  // here in practice. The contract still answers null rather than omitting
  // the field, so a consumer can read `viewerTeamId` unconditionally instead
  // of branching on whether the key exists.
  leagueDetailFake(t);

  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(999));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal('viewerTeamId' in res.body, true);
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

test('league:join and draft:join both acknowledge the viewer with their own Team ID', () => {
  // The chat panel joins with league:join and never reads league detail, so
  // this ack is the only per-viewer channel chat has; the draft room's is the
  // same ack. One shape answers both.
  // `isCommissioner` rides beside it on the same ack for the same reason
  // (#178): both are facts about the one socket being answered. This test
  // owns the viewerTeamId half; draftJoinCommissioner.test.js owns the other.
  assert.deepEqual(joinAck({ viewerTeam: { id: VIEWER.teamId, name: VIEWER.teamName }, isCommissioner: false }), {
    ok: true,
    viewerTeamId: VIEWER.teamId,
    isCommissioner: false,
  });
  assert.deepEqual(joinAck({ viewerTeam: null, isCommissioner: false }), {
    ok: true,
    viewerTeamId: null,
    isCommissioner: false,
  });
});

test('a REFUSED league:join or draft:join carries a code, and no viewer-relative field at all', () => {
  // #230. The two joins refuse in three ways and the client has to tell them
  // apart, because only one of them - not_a_member - says the viewer holds no
  // Team here and is therefore the only one on which the room may clear their
  // Team identity and commissioner flag. The message text cannot carry that:
  // it is copy, and join_failed's text names the room it failed to join, so
  // matching on text is two strings for one condition. The code is the
  // contract; these are the three, and there is no fourth.
  //
  // This pins the SHAPE. That each handler emits the right code on the right
  // path is proven through a real connection in socketJoinEndToEnd.test.js,
  // for both joins - the same division of labour as the ack above.
  const refusals = [
    joinError('invalid_request', 'leagueId (integer) required'),
    joinError('not_a_member', 'you are not in this league'),
    joinError('join_failed', 'failed to join draft room'),
    joinError('join_failed', 'failed to join league room'),
  ];

  for (const refusal of refusals) {
    // An EXACT key set, not a property check. A refusal that also carried
    // `ok: true`, or a stale `viewerTeamId`, would be read as a partial
    // success by any client that tests the fields rather than the error -
    // and a refusal is precisely when a viewer-relative field is a lie.
    assert.deepEqual(Object.keys(refusal).sort(), ['code', 'error']);
    assert.equal(typeof refusal.error, 'string');
  }
  assert.deepEqual(refusals.map((r) => r.code), [
    'invalid_request', 'not_a_member', 'join_failed', 'join_failed',
  ]);
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

// ------------------------------------------------------------------------ chat

test('chat history: every message is attributed by Team beside its account fields', async (t) => {
  const fake = createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "chat_messages"/, () => ({
      rows: [{
        id: 5,
        message: 'good luck everyone',
        created_at: '2026-09-01T00:00:00.000Z',
        user_id: OTHER.userId,
        username: `u${OTHER.userId}`,
        teamId: OTHER.teamId,
        teamName: OTHER.teamName,
      }],
    })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/chat`)
    .set('Authorization', authed(VIEWER.userId));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [message] = res.body;
  assert.equal(message.teamId, OTHER.teamId);
  assert.equal(message.teamName, OTHER.teamName);
  assert.equal(message.user_id, OTHER.userId, 'the legacy author account fields survive');
  assert.equal(message.username, `u${OTHER.userId}`);
  const [chatQuery] = fake.matching(/FROM "chat_messages"/);
  assert.match(chatQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
  // A LEFT JOIN, so a message from a manager who has since left the league
  // still reads back rather than vanishing from the history.
  assert.match(chatQuery.text, /LEFT JOIN "teams"/);
});

test('chat:message carries the author\'s Team identity beside their account', () => {
  assert.deepEqual(
    chatMessagePayload({
      id: 5,
      leagueId: LEAGUE_ID,
      user: { id: OTHER.userId, username: 'u43' },
      team: { id: OTHER.teamId, name: OTHER.teamName },
      message: 'good luck everyone',
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
    {
      id: 5,
      leagueId: LEAGUE_ID,
      userId: OTHER.userId,
      username: 'u43',
      teamId: OTHER.teamId,
      teamName: OTHER.teamName,
      message: 'good luck everyone',
      created_at: '2026-09-01T00:00:00.000Z',
    }
  );
});

// -------------------------------------------------------------------- pick'em

const pickemApp = express();
pickemApp.use(express.json());
pickemApp.use('/api/pickem', require('../routes/pickem.router'));

const KICKED_OFF = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const PICKEM_LEAGUE = { id: LEAGUE_ID, current_season: 2026, pickem_only: false };

function pickemFake(t, entries) {
  return createFakePool([
    // requireMember answers with the viewer's own team row.
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({
      rows: [{ id: VIEWER.teamId, name: VIEWER.teamName, league_id: LEAGUE_ID, owner_id: VIEWER.userId }],
    })],
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    [/FROM "leagues"/, () => ({ rows: [PICKEM_LEAGUE] })],
    [/FROM "nfl_games"/, () => ({
      rows: [
        { week: 1, nfl_team: 'BUF', opponent: 'MIA', kickoff_at: KICKED_OFF, home_away: 'home' },
        { week: 1, nfl_team: 'MIA', opponent: 'BUF', kickoff_at: KICKED_OFF, home_away: 'away' },
      ],
    })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/"game_recaps"/, () => ({ rows: [] })],
    ...entries,
  ]).install(t);
}

test("pick'em week view: another manager's pick is attributed by Team", async (t) => {
  const fake = pickemFake(t, [
    [/FROM "pickem_picks"/, () => ({
      rows: [{
        user_id: OTHER.userId,
        username: `u${OTHER.userId}`,
        teamId: OTHER.teamId,
        teamName: OTHER.teamName,
        team_pair: 'BUF|MIA',
        picked_team: 'BUF',
        confidence: null,
      }],
    })],
  ]);

  const res = await request(pickemApp)
    .get(`/api/pickem/league/${LEAGUE_ID}/week/1`)
    .set('Authorization', authed(VIEWER.userId));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [entry] = res.body.othersPicks['BUF|MIA'];
  assert.equal(entry.teamId, OTHER.teamId);
  assert.equal(entry.teamName, OTHER.teamName);
  assert.equal(entry.userId, OTHER.userId, 'the legacy account fields survive');
  assert.equal(entry.username, `u${OTHER.userId}`);
  assert.equal(res.body.viewerTeamId, VIEWER.teamId);
  const [picksQuery] = fake.matching(/FROM "pickem_picks"/);
  assert.match(picksQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
});

test("pick'em standings: every row carries Team ID beside its Team name and account", async (t) => {
  const fake = pickemFake(t, [
    [/FROM "pickem_picks"/, () => ({ rows: [] })],
    [/FROM "teams"/, () => ({
      rows: [
        {
          user_id: VIEWER.userId, username: `u${VIEWER.userId}`,
          team_id: VIEWER.teamId, team_name: VIEWER.teamName,
          avatar_url: null, avatar_static_url: null,
        },
        {
          user_id: OTHER.userId, username: `u${OTHER.userId}`,
          team_id: OTHER.teamId, team_name: OTHER.teamName,
          avatar_url: null, avatar_static_url: null,
        },
      ],
    })],
  ]);

  const res = await request(pickemApp)
    .get(`/api/pickem/league/${LEAGUE_ID}/standings`)
    .set('Authorization', authed(VIEWER.userId));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.standings.map((row) => [row.teamId, row.teamName, row.userId, row.username]),
    [
      [VIEWER.teamId, VIEWER.teamName, VIEWER.userId, `u${VIEWER.userId}`],
      [OTHER.teamId, OTHER.teamName, OTHER.userId, `u${OTHER.userId}`],
    ]
  );
  assert.equal(res.body.viewerTeamId, VIEWER.teamId);
  const [membersQuery] = fake.matching(/^SELECT "teams"\."owner_id" AS "user_id"/);
  assert.match(membersQuery.text, /"teams"\."id" AS "team_id"/);
});
