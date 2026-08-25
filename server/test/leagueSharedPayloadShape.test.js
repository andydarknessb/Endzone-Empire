const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const scoringService = require('../services/scoring.service');

/**
 * The absence tripwire for the shared-identity contraction (#341, #115 child A).
 *
 * CONTEXT.md's Team identity rule is that a surface shared with other managers
 * names a participant by Team (`teamId` / `teamName`) and never by their
 * account (`owner_id`, `owner`, `owner_username`, `user_id`, `username`, and the
 * matchup row's `home_owner_id` / `away_owner_id`). The EXPAND step (#112) put
 * Team identity BESIDE those account fields and left them in place;
 * teamIdentityContracts.test.js pins that both are present today. The account
 * fields are removed by the sibling tickets:
 *
 *   #343 (child B) — the REST payloads guarded here.
 *   #344 (child C) — the Draft / chat Socket.IO payloads (not this file).
 *
 * Before this file, only the anonymous presenter board and the invite preview
 * had an exact-key-set pin; the authenticated league-shared payloads had NONE,
 * so a removal could land with nothing proving the field was gone and nothing
 * catching it come back (the ordering constraint #334 was split around). These
 * guards ARE that proof. Each asserts the exact key set the payload will carry
 * AFTER #343, in the `Object.keys(x).sort()` style of authPayloadShape.test.js,
 * with the forbidden account fields named so a re-addition fails loudly.
 *
 * They therefore describe a contract that does NOT hold yet, so every one FAILS
 * against today's payload. That is deliberate: a guard that already passed would
 * prove nothing (the defect three tickets were returned for). Each is marked
 * `todo` with the sibling ticket named, so `node --test` runs the assertion,
 * prints its red diff, and still exits 0 (proven: a failing `todo` counts as
 * `todo`, not `fail`). When #343 removes the field, the assertion goes green and
 * that PR turns the guard on by deleting the `todo` marker (and, where it trims
 * a SELECT rather than the serializer, updating the co-located fixture).
 *
 * The one guard that is NOT `todo` is the co-commissioner roster as a plain
 * member sees it: #324 already made that view Team-identity-only, so its guard
 * passes today and pins that win against the sibling removals.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-shared-payload-shape-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const pickemApp = express();
pickemApp.use(express.json());
pickemApp.use('/api/pickem', require('../routes/pickem.router'));

const LEAGUE_ID = 1;
const VIEWER = { userId: 42, teamId: 11, teamName: 'Gridiron Ghosts' };
const OTHER = { userId: 43, teamId: 12, teamName: 'Sunday Scaries' };
const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

/** Assert `obj`'s key set is exactly `cleanKeys`, and that none of `forbidden` remain. */
function assertCleanShape(obj, cleanKeys, forbidden) {
  assert.deepEqual(Object.keys(obj).sort(), [...cleanKeys].sort());
  for (const key of forbidden) {
    assert.equal(key in obj, false, `${key} is another manager's account identity and must not ride`);
  }
}

// ============================================================ league detail
// GET /api/league/:id  ->  { viewerTeamId, league, teams }

// A `teams` row exactly as the league-detail query projects it today: the
// team's own columns and Team identity, plus the two account fields #343
// removes. The route spreads this row and adds `is_co_commissioner`.
const teamRow = ({ userId, teamId, teamName }) => ({
  id: teamId,
  name: teamName,
  draft_position: 1,
  faab_remaining: 100,
  locked: false,
  draft_ready: true,
  avatar_url: null,
  avatar_static_url: null,
  owner_id: userId, // #343 removes
  teamId,
  teamName,
  owner: `u${userId}`, // #343 removes
  roster_count: 0,
  total_points: '0',
});

// A `leagues` row as the league-detail query projects it: a representative set
// of the league's own columns, the creator's Team identity, and the one account
// field #343 removes (`owner_username`). `owner_id` is the creator's own and
// stays (#334's survey removes only `owner_username` from this object).
const LEAGUE_ROW = {
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  owner_id: VIEWER.userId,
  current_season: 2026,
  invite_code: 'invite',
  owner_username: 'u42', // #343 removes
  ownerTeamId: VIEWER.teamId,
  ownerTeamName: VIEWER.teamName,
};

function leagueDetailFake(t, { isCommissioner = false, coCommissioners = [] } = {}) {
  return createFakePool([
    [/AS "owner_username"/, () => ({ rows: [{ ...LEAGUE_ROW }] })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: isCommissioner ? [{ '?column?': 1 }] : [] })],
    [/FROM "league_commissioners"/, () => ({ rows: coCommissioners })],
    [/COUNT\("team_players"\."id"\)/, () => ({ rows: [teamRow(VIEWER), teamRow(OTHER)] })],
  ]).install(t);
}

// The team entry, once #343 removes the two account fields.
const TEAM_ENTRY_CLEAN = [
  'avatar_static_url', 'avatar_url', 'draft_position', 'draft_ready', 'faab_remaining',
  'id', 'is_co_commissioner', 'locked', 'name', 'roster_count', 'teamId', 'teamName', 'total_points',
];
const TEAM_ENTRY_FORBIDDEN = ['owner_id', 'owner'];

test('league detail: a teams[] entry is Team identity and team attributes, no account fields', { todo: '#343 removes teams[].owner_id / owner' }, async (t) => {
  leagueDetailFake(t);
  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const team of res.body.teams) assertCleanShape(team, TEAM_ENTRY_CLEAN, TEAM_ENTRY_FORBIDDEN);
});

// The league object a plain MEMBER sees: the invite code is already stripped for
// a non-commissioner, so the only account field left to remove is owner_username.
const LEAGUE_OBJECT_CLEAN = [
  'co_commissioners', 'current_season', 'id', 'is_commissioner', 'name',
  'owner_id', 'ownerTeamId', 'ownerTeamName',
];
const LEAGUE_OBJECT_FORBIDDEN = ['owner_username'];

test('league detail: the league object carries the creator by Team, not by account name', { todo: '#343 removes league.owner_username' }, async (t) => {
  leagueDetailFake(t, { isCommissioner: false });
  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assertCleanShape(res.body.league, LEAGUE_OBJECT_CLEAN, LEAGUE_OBJECT_FORBIDDEN);
});

// The co-commissioner roster as a plain MEMBER reads it. This is GREEN, not
// todo: #324 already made the member view Team-identity-only. It pins that win
// so a sibling removal cannot regress the roster back to carrying an account.
const COCOMM_MEMBER_CLEAN = ['teamId', 'teamName'];
const COCOMM_MEMBER_FORBIDDEN = ['user_id', 'username', 'grantedAt', 'created_at', 'owner_id'];

test('league detail: the co-commissioner roster a member sees is Team identity only (#324)', async (t) => {
  leagueDetailFake(t, {
    isCommissioner: false,
    coCommissioners: [{ user_id: OTHER.userId, username: 'u43', created_at: '2026-08-01T00:00:00.000Z', teamId: OTHER.teamId, teamName: OTHER.teamName }],
  });
  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.league.is_commissioner, false);
  assert.equal(res.body.league.co_commissioners.length, 1);
  for (const entry of res.body.league.co_commissioners) assertCleanShape(entry, COCOMM_MEMBER_CLEAN, COCOMM_MEMBER_FORBIDDEN);
});

// ================================================================== chat
// GET /api/league/:id/chat  ->  the rows verbatim.

const CHAT_ENTRY_CLEAN = ['created_at', 'id', 'message', 'teamId', 'teamName'];
const CHAT_ENTRY_FORBIDDEN = ['user_id', 'username'];

test('chat history: a message is attributed by Team, not by the author account', { todo: '#343 removes chat user_id / username' }, async (t) => {
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "chat_messages"/, () => ({
      rows: [{
        id: 5,
        message: 'good luck everyone',
        created_at: '2026-09-01T00:00:00.000Z',
        user_id: OTHER.userId, // #343 removes
        username: `u${OTHER.userId}`, // #343 removes
        teamId: OTHER.teamId,
        teamName: OTHER.teamName,
      }],
    })],
  ]).install(t);
  const res = await request(app).get(`/api/league/${LEAGUE_ID}/chat`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const message of res.body) assertCleanShape(message, CHAT_ENTRY_CLEAN, CHAT_ENTRY_FORBIDDEN);
});

// ================================================================ pick'em
// The week view and standings both build their entries from explicit object
// literals, so #343 removes the account fields by deleting those lines.

const KICKED_OFF = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const PICKEM_LEAGUE = { id: LEAGUE_ID, current_season: 2026, pickem_only: false };

function pickemFake(t, entries) {
  return createFakePool([
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

const OTHERS_PICK_CLEAN = ['confidence', 'gameKey', 'pickedTeam', 'teamId', 'teamName'];
const OTHERS_PICK_FORBIDDEN = ['userId', 'username'];

test("pick'em week view: another manager's pick is Team identity only", { todo: "#343 removes othersPicks userId / username" }, async (t) => {
  pickemFake(t, [
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
  const res = await request(pickemApp).get(`/api/pickem/league/${LEAGUE_ID}/week/1`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const entries = res.body.othersPicks['BUF|MIA'];
  assert.equal(entries.length, 1);
  for (const entry of entries) assertCleanShape(entry, OTHERS_PICK_CLEAN, OTHERS_PICK_FORBIDDEN);
});

const STANDINGS_ROW_CLEAN = [
  'avatarStaticUrl', 'avatarUrl', 'correct', 'incorrect', 'made', 'pending',
  'points', 'pushes', 'rank', 'teamId', 'teamName', 'weekly',
];
const STANDINGS_ROW_FORBIDDEN = ['userId', 'username'];

test("pick'em standings: a row is Team identity and score, not the manager account", { todo: '#343 removes standings userId / username' }, async (t) => {
  pickemFake(t, [
    [/FROM "pickem_picks"/, () => ({ rows: [] })],
    [/FROM "teams"/, () => ({
      rows: [
        { user_id: VIEWER.userId, username: `u${VIEWER.userId}`, team_id: VIEWER.teamId, team_name: VIEWER.teamName, avatar_url: null, avatar_static_url: null },
        { user_id: OTHER.userId, username: `u${OTHER.userId}`, team_id: OTHER.teamId, team_name: OTHER.teamName, avatar_url: null, avatar_static_url: null },
      ],
    })],
  ]);
  const res = await request(pickemApp).get(`/api/pickem/league/${LEAGUE_ID}/standings`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.standings.length, 2);
  for (const row of res.body.standings) assertCleanShape(row, STANDINGS_ROW_CLEAN, STANDINGS_ROW_FORBIDDEN);
});

// ================================================================= rosters
// GET /api/league/:id/rosters  ->  [{ teamId, teamName, ownerId, avatarUrl, avatarStaticUrl, players }]
// Built from an explicit literal; #343 removes the `ownerId` line (the roster's
// camelCase spelling of another manager's `owner_id`).

const ROSTER_ENTRY_CLEAN = ['avatarStaticUrl', 'avatarUrl', 'players', 'teamId', 'teamName'];
const ROSTER_ENTRY_FORBIDDEN = ['ownerId'];

test('rosters: a team entry is Team identity and its players, not the manager account', { todo: '#343 removes rosters ownerId' }, async (t) => {
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());
  t.mock.method(projectionService, 'getRestOfSeasonProjections', async () => new Map());
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT "current_season", "current_week"/, () => ({ rows: [{ current_season: 2026, current_week: 1, regular_season_weeks: 14 }] })],
    [/AS "team_id", "teams"\."name" AS "team_name"/, () => ({
      rows: [
        { team_id: VIEWER.teamId, team_name: VIEWER.teamName, owner_id: VIEWER.userId, avatar_url: null, avatar_static_url: null, id: null, name: null, position: null, nfl_team: null },
        { team_id: OTHER.teamId, team_name: OTHER.teamName, owner_id: OTHER.userId, avatar_url: null, avatar_static_url: null, id: null, name: null, position: null, nfl_team: null },
      ],
    })],
  ]).install(t);
  const res = await request(app).get(`/api/league/${LEAGUE_ID}/rosters`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 2);
  for (const team of res.body) assertCleanShape(team, ROSTER_ENTRY_CLEAN, ROSTER_ENTRY_FORBIDDEN);
});

// =========================================================== matchup detail
// GET /api/league/:id/matchups/:matchupId  ->  { viewerTeamId, viewerWhatIf, matchup, home, away }
// The `matchup` object is `SELECT "matchups".*` plus join aliases, and carries
// the two owner ids the route reads to find the viewer's team. #343 removes them
// from the wire while still computing viewerTeamId from the row server-side.

const MATCHUP_ROW = {
  id: 7,
  league_id: LEAGUE_ID,
  season: 2026,
  week: 1,
  home_team_id: VIEWER.teamId,
  away_team_id: OTHER.teamId,
  home_score: '0',
  away_score: '0',
  status: 'scheduled',
  home_team_name: VIEWER.teamName,
  away_team_name: OTHER.teamName,
  home_owner_id: VIEWER.userId, // #343 removes
  away_owner_id: OTHER.userId, // #343 removes
  home_team_avatar_url: null,
  away_team_avatar_url: null,
  home_team_avatar_static_url: null,
  away_team_avatar_static_url: null,
};

const MATCHUP_OBJECT_CLEAN = [
  'away_score', 'away_team_avatar_static_url', 'away_team_avatar_url', 'away_team_id', 'away_team_name',
  'home_score', 'home_team_avatar_static_url', 'home_team_avatar_url', 'home_team_id', 'home_team_name',
  'id', 'league_id', 'season', 'status', 'week',
];
const MATCHUP_OBJECT_FORBIDDEN = ['home_owner_id', 'away_owner_id'];

test('matchup detail: the matchup object names both teams by Team, not by owner account', { todo: '#343 removes matchup home_owner_id / away_owner_id' }, async (t) => {
  t.mock.method(scoringService, 'rulesForLeague', () => ({}));
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  createFakePool([
    // The viewer (999) is a member but owns neither team, so the route never
    // reaches liveWhatIf and viewerTeamId stays null.
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr' }] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/FROM "lineup_entries"/, () => ({ rows: [] })],
  ]).install(t);
  const res = await request(app).get(`/api/league/${LEAGUE_ID}/matchups/7`).set('Authorization', authed(999));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assertCleanShape(res.body.matchup, MATCHUP_OBJECT_CLEAN, MATCHUP_OBJECT_FORBIDDEN);
});
