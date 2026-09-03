const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
 * Contract tests for the shared identity migration (#112 EXPAND, parent #108),
 * now split by surface as the CONTRACT step lands:
 *
 *  - The authenticated REST surfaces (league detail, chat, pick'em) are
 *    CONTRACTED by #343 (#115 child B): they carry Team identity (`teamId` +
 *    `teamName`) and the viewer-relative fields ONLY, and the account fields
 *    the EXPAND step left beside them are gone. Those tests assert the account
 *    field is ABSENT; the exact key sets are pinned in
 *    leagueSharedPayloadShape.test.js.
 *  - The Draft / chat SOCKET payloads are CONTRACTED by #344 (child C): the
 *    broadcasts (`draft:presence`, `chat:message`, `draft:picked`,
 *    `draft:state`) carry Team identity and the event's non-identity content
 *    only, and the account fields the EXPAND step left beside them are gone.
 *    Those tests assert the account field is ABSENT; the exact key sets are
 *    pinned in socketPayloadShape.test.js.
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
  owner_id: VIEWER.userId, // the creator's OWN account id, stays on `leagues.*`
  invite_code: 'invite',
  ownerTeamId: VIEWER.teamId,
  ownerTeamName: VIEWER.teamName,
};

const teamRow = ({ userId, teamId, teamName }) => ({
  id: teamId,
  name: teamName,
  teamId,
  teamName,
  owner_id: userId, // stays in the SELECT for viewerTeamId; stripped from serialization
  draft_position: 1,
  faab_remaining: 100,
  locked: false,
  draft_ready: true,
  roster_count: 0,
  total_points: '0',
});

function leagueDetailFake(t, { coCommissioners = [] } = {}) {
  return createFakePool([
    [/AS "ownerTeamId"/, () => ({ rows: [{ ...LEAGUE_ROW }] })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "league_commissioners"/, () => ({ rows: coCommissioners })],
    // The market status line (#748): a fresh market by default.
    [select('players'), () => ({ rows: [{ n: 250 }] })],
    [/FROM "data_sync_runs"/, () => ({ rows: [{ finished_at: new Date().toISOString() }] })],
    [/COUNT\("team_players"\."id"\)/, () => ({ rows: [teamRow(VIEWER), teamRow(OTHER)] })],
  ]).install(t);
}

test('league detail: every team carries Team identity and no account fields', async (t) => {
  const fake = leagueDetailFake(t);

  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [mine, theirs] = res.body.teams;
  assert.equal(mine.teamId, VIEWER.teamId);
  assert.equal(mine.teamName, VIEWER.teamName);
  assert.equal(theirs.teamId, OTHER.teamId);
  assert.equal(theirs.teamName, OTHER.teamName);
  // Instead of, not beside: another manager's account id and username are gone
  // from the serialized entry (#343). owner_id still rides on the RAW row so
  // viewerTeamId can resolve, but it is stripped before serialization.
  assert.equal('owner_id' in theirs, false);
  assert.equal('owner' in theirs, false);
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
  assert.equal(res.body.league.owner_id, VIEWER.userId, 'the creator\'s OWN account id survives on leagues.*');
  assert.equal('owner_username' in res.body.league, false, 'the account username alias is gone (#343)');
  // This viewer is a commissioner (the fake answers the EXISTS predicate), so
  // the roster carries the account id that revoke is shaped around beside the
  // Team identity. The account NAME survives nowhere: #324 ruled that role
  // disclosure is no exception to the Team identity rule, so the roster is
  // rendered by Team on every surface and there is no username to render.
  assert.deepEqual(res.body.league.co_commissioners, [
    // grantedAt rides with the id: Team identity does not identify a GRANT on
    // its own, since duplicate Team names are valid identity. Null here
    // because this fixture predates the column, and null rather than absent so
    // a consumer can read it unconditionally.
    { user_id: OTHER.userId, grantedAt: null, teamId: OTHER.teamId, teamName: OTHER.teamName },
  ]);
  // The same fact, told to every member off the Team identity they hold: the
  // grant names OTHER's team, so that team and no other is flagged.
  assert.deepEqual(
    res.body.teams.map((team) => [team.teamId, team.is_co_commissioner]),
    [[VIEWER.teamId, false], [OTHER.teamId, true]]
  );
  const [leagueQuery] = fake.matching(/AS "ownerTeamId"/);
  assert.match(leagueQuery.text, /AS "ownerTeamId"/);
  assert.doesNotMatch(leagueQuery.text, /AS "owner_username"/, 'the username JOIN is gone (#343)');
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

// Mirrors the narrowed getDraftState SELECT after #344: Team identity and the
// team's own draft columns, no manager account fields.
const draftTeamRow = ({ teamId, teamName }, draftPosition) => ({
  id: teamId,
  name: teamName,
  teamId,
  teamName,
  draft_position: draftPosition,
  autodraft: false,
  draft_ready: true,
});

function draftStateFake(t) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ ...DRAFT_LEAGUE }] })],
    [/FROM "teams"\s+WHERE/, () => ({
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

test('Draft snapshot: every team is named by Team identity and no account fields', async (t) => {
  const fake = draftStateFake(t);

  const state = await getDraftState(LEAGUE_ID);

  assert.deepEqual(
    state.teams.map((team) => [team.teamId, team.teamName]),
    [[VIEWER.teamId, VIEWER.teamName], [OTHER.teamId, OTHER.teamName]]
  );
  // The account fields the EXPAND step left beside Team identity are gone from
  // the snapshot (#344): the SELECT no longer projects owner_id or the owner
  // username, and no longer joins users to reach it.
  assert.equal('owner_id' in state.teams[1], false, 'owner_id is off the snapshot (#344)');
  assert.equal('owner' in state.teams[1], false, 'the owner username is off the snapshot (#344)');
  const [teamsQuery] = fake.matching(/FROM "teams"\s+WHERE/);
  assert.match(teamsQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
  assert.doesNotMatch(teamsQuery.text, /"teams"\."owner_id"/, 'owner_id is off the SELECT (#344)');
  assert.doesNotMatch(teamsQuery.text, /JOIN "users"/, 'the owner-username join is gone (#344)');
});

test('Draft snapshot: the team On the clock carries Team identity and no account fields', async (t) => {
  draftStateFake(t);

  const state = await getDraftState(LEAGUE_ID);

  assert.equal(state.onTheClock.teamId, VIEWER.teamId);
  assert.equal(state.onTheClock.teamName, VIEWER.teamName);
  assert.equal('owner_id' in state.onTheClock, false, 'owner_id is off the snapshot (#344)');
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
  // draft:picked is `{ ...outcome, auto }` (#344 dropped the account `by`
  // object), so the Pick's own Team identity has to come off the outcome for
  // the broadcast to attribute it by Team.
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
    [select('players'), () => ({ rows: [{ id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC' }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: 0 }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: [] })],
    [insert('draft_picks'), () => ({ rows: [{ id: 77 }], rowCount: 1 })],
    // The Pick's Draft activity, appended in the same transaction (#435).
    [insert('draft_activity'), () => ({ rows: [{ id: 3, feed_seq: '2', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
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
    gifMessagesEnabled: false,
  });
  assert.deepEqual(joinAck({ viewerTeam: null, isCommissioner: false }), {
    ok: true,
    viewerTeamId: null,
    isCommissioner: false,
    gifMessagesEnabled: false,
  });
});

test('a REFUSED league:join or draft:join carries a code, and no viewer-relative field at all', () => {
  // #230. The two joins refuse in three ways and the client has to tell them
  // apart, because only one of them - NOT_A_MEMBER - says the viewer holds no
  // Team here and is therefore the only one on which the room may clear their
  // Team identity and commissioner flag. The message text cannot carry that:
  // it is copy, and JOIN_FAILED's text names the room it failed to join, so
  // matching on text is two strings for one condition. The code is the
  // contract; these are the three, and there is no fourth.
  //
  // This pins the SHAPE. That each handler emits the right code on the right
  // path is proven through a real connection in socketJoinEndToEnd.test.js,
  // for both joins - the same division of labour as the ack above.
  const refusals = [
    joinError({ code: 'INVALID_REQUEST', message: 'leagueId (integer) required' }),
    joinError({ code: 'NOT_A_MEMBER', message: 'you are not in this league' }),
    joinError({ code: 'JOIN_FAILED', message: 'failed to join draft room' }),
    joinError({ code: 'JOIN_FAILED', message: 'failed to join league room' }),
  ];

  for (const refusal of refusals) {
    // An EXACT key set, not a property check. A refusal that also carried
    // `ok: true`, or a stale `viewerTeamId`, would be read as a partial
    // success by any client that tests the fields rather than the error -
    // and a refusal is precisely when a viewer-relative field is a lie.
    assert.deepEqual(Object.keys(refusal).sort(), ['code', 'error']);
    assert.equal(typeof refusal.error, 'string');
  }
});

test('every join refusal code the handlers emit is one of the three, spelled SCREAMING_SNAKE', () => {
  // #265, and the reason this is a source read rather than a list of literals
  // in a test file. The test above passes its codes INTO joinError and then
  // asserts the key set, so it is green against any spelling - it pins the
  // shape and says so. Nothing at this layer looked at the values, which left
  // "the codes are upper snake" resting entirely on the end-to-end suite.
  //
  // So ask the emitter. Every `code` the join handlers hand joinError is read
  // straight out of the module source, and the EXACT set is asserted, the way
  // unauthenticatedRouteInventory reads the real Express stacks rather than
  // route names. A fourth code, a renamed one, or a lowercase one added by an
  // author who pattern-matched on the wrong example fails here and names
  // itself, instead of being caught only if it happens to reach a socket test.
  //
  // The set cannot pass vacuously: a regex that matched nothing would leave an
  // empty array, and an empty array is not the three.
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'draftSocket.js'), 'utf8');
  const emitted = [...source.matchAll(/joinError\(\{\s*code: '([^']+)'/g)].map(([, code]) => code);

  assert.deepEqual(
    [...new Set(emitted)].sort(),
    ['INVALID_REQUEST', 'JOIN_FAILED', 'NOT_A_MEMBER'],
    'the join handlers emit exactly the three codes #230 defined, uppercase (#265)'
  );
  for (const code of emitted) {
    // The convention itself (ADR 0008), not just these three values: every
    // error code this app emits is upper snake, HTTP body and socket ack alike.
    assert.match(code, /^[A-Z][A-Z0-9_]*$/, `${code} is not SCREAMING_SNAKE`);
  }
});

test('draft:presence names the joining manager by Team and nothing about their account', () => {
  assert.deepEqual(
    presencePayload({ id: VIEWER.userId, username: 'u42' }, { id: VIEWER.teamId, name: VIEWER.teamName }),
    { teamId: VIEWER.teamId, teamName: VIEWER.teamName, joined: true }
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

test('chat history: every message is attributed by Team and no account fields', async (t) => {
  const fake = createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    // The route passes chat rows through verbatim and the SELECT no longer
    // projects the author's account id or username (#343), so this fixture
    // mirrors the narrowed SELECT.
    [/FROM "chat_messages"/, () => ({
      rows: [{
        id: 5,
        message: 'good luck everyone',
        created_at: '2026-09-01T00:00:00.000Z',
        feed_seq: 7,
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
  // A typed feed entry carrying its per-league sequence (#434), still Team-only.
  assert.equal(message.type, 'league_chat');
  assert.equal(message.seq, 7);
  assert.equal('user_id' in message, false, 'the author account id is gone (#343)');
  assert.equal('username' in message, false, 'the author username is gone (#343)');
  const [chatQuery] = fake.matching(/FROM "chat_messages"/);
  assert.match(chatQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
  assert.doesNotMatch(chatQuery.text, /JOIN "users"/, 'the username JOIN is gone (#343)');
  // A LEFT JOIN, so a message from a manager who has since left the league
  // still reads back rather than vanishing from the history.
  assert.match(chatQuery.text, /LEFT JOIN "teams"/);
});

test('chat:message attributes the message by Team and nothing about the author account', () => {
  assert.deepEqual(
    chatMessagePayload({
      id: 5,
      seq: 7,
      leagueId: LEAGUE_ID,
      user: { id: OTHER.userId, username: 'u43' },
      team: { id: OTHER.teamId, name: OTHER.teamName },
      message: 'good luck everyone',
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
    {
      type: 'league_chat',
      id: 5,
      seq: 7,
      leagueId: LEAGUE_ID,
      teamId: OTHER.teamId,
      teamName: OTHER.teamName,
      message: 'good luck everyone',
      // #446: a text message carries no media; the key rides on every entry so
      // a GIF message can carry its structured asset under it.
      media: null,
      // #441: a live send is never hidden; the flag rides on every entry.
      hidden: false,
      // #436: a live send is never legacy; the flag rides on every entry.
      isLegacy: false,
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

test("pick'em week view: another manager's pick is attributed by Team, not by account", async (t) => {
  const fake = pickemFake(t, [
    // user_id stays on the raw row because getWeekView reads it to tell the
    // viewer's own picks from everyone else's; it is not projected onto the
    // othersPicks entry, and the username is no longer selected (#343).
    [/FROM "pickem_picks"/, () => ({
      rows: [{
        user_id: OTHER.userId,
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
  assert.equal('userId' in entry, false, 'the author account id is gone (#343)');
  assert.equal('username' in entry, false, 'the author username is gone (#343)');
  assert.equal(res.body.viewerTeamId, VIEWER.teamId);
  const [picksQuery] = fake.matching(/FROM "pickem_picks"/);
  assert.match(picksQuery.text, /"teams"\."id" AS "teamId", "teams"\."name" AS "teamName"/);
  assert.doesNotMatch(picksQuery.text, /JOIN "users"/, 'the username JOIN is gone (#343)');
});

test("pick'em standings: every row carries Team identity, not the manager account", async (t) => {
  const fake = pickemFake(t, [
    [/FROM "pickem_picks"/, () => ({ rows: [] })],
    // owner_id AS user_id stays on the raw member row as the scoring join key;
    // the username is no longer selected, and the /standings route strips
    // userId before serializing (#343).
    [/FROM "teams"/, () => ({
      rows: [
        {
          user_id: VIEWER.userId,
          team_id: VIEWER.teamId, team_name: VIEWER.teamName,
          avatar_url: null, avatar_static_url: null,
        },
        {
          user_id: OTHER.userId,
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
    res.body.standings.map((row) => [row.teamId, row.teamName]),
    [
      [VIEWER.teamId, VIEWER.teamName],
      [OTHER.teamId, OTHER.teamName],
    ]
  );
  for (const row of res.body.standings) {
    assert.equal('userId' in row, false, 'the manager account id is gone (#343)');
    assert.equal('username' in row, false, 'the manager username is gone (#343)');
  }
  assert.equal(res.body.viewerTeamId, VIEWER.teamId);
  const [membersQuery] = fake.matching(/^SELECT "teams"\."owner_id" AS "user_id"/);
  assert.match(membersQuery.text, /"teams"\."id" AS "team_id"/);
  assert.doesNotMatch(membersQuery.text, /JOIN "users"/, 'the username JOIN is gone (#343)');
});
