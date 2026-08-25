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
const decisionService = require('../services/decision.service');

/**
 * The absence tripwire for the shared-identity contraction (#341, #115 child A).
 *
 * CONTEXT.md's Team identity rule is that a surface shared with other managers
 * names a participant by Team (`teamId` / `teamName`) and never by their account
 * (`owner_id`, `owner`, `owner_username`, `user_id`, `username`, the roster's
 * `ownerId`, and the matchup row's `home_owner_id` / `away_owner_id`). The
 * EXPAND step (#112) put Team identity BESIDE those account fields and left them
 * in place. They are removed by the sibling tickets:
 *
 *   #343 (child B) — the REST payloads guarded here.
 *   #344 (child C) — the Draft / chat Socket.IO payloads (not this file).
 *
 * Before this file the authenticated league-shared payloads had NO exact-key-set
 * pin, so a removal could land with nothing proving the field was gone and
 * nothing catching it come back (the ordering constraint #334 was split around).
 *
 * Each payload here has a PAIR of guards, and the pair is the mechanism:
 *
 *   1. A `todo` guard that asserts the key set the payload will carry AFTER #343.
 *      It fails today (the account field is still there), so it is marked `todo`
 *      naming #343: `node --test` runs it, prints the red diff, and still exits
 *      0. #343 turns it into a live guard by deleting the `todo` marker.
 *
 *   2. A NORMAL (non-todo) guard that asserts the account field is STILL PRESENT
 *      today. This is the loud half. A `todo` guard alone can go inert silently:
 *      a failing todo and a passing todo both roll into "todo N, exit 0", so if
 *      #343 removed the field and FORGOT its marker, CI would stay green and a
 *      later re-addition would too. The present-today guard closes that: the
 *      moment #343 removes the field this guard goes RED (a real failure, not a
 *      todo), which drags the author into THIS file to flip the paired todo. A
 *      forgotten marker is no longer a process promise; it is a red build.
 *
 * Two response ROOTS are pinned as well, and their comments carry the rule the
 * whole tripwire depends on: an account field may leave the SERIALIZATION but
 * never the PROJECTION, because `viewerTeamId` is computed server-side from the
 * raw `owner_id` on the rows. If #343 narrows the SQL instead of the serializer,
 * `viewerTeamId` goes null for every viewer AND these fixtures (which carry the
 * account field on the raw row) would still show it on the wire, so the tripwire
 * would miss the change. The root guards pin `viewerTeamId` present so #343
 * cannot drop it, which is what forces the removal into the serializer.
 *
 * The one guard with no `todo` and no present-today pair is the co-commissioner
 * roster as a plain member sees it: #324 already made that view Team-identity
 * only, so it is clean today and this pins that win against the sibling removals.
 *
 * Caveat this narrows itself on: the guards drive the real routes against
 * hand-built fixtures declared to mirror each SELECT, not the live database, so
 * a column the real query adds but the fixture omits is not caught. That is
 * inherent to the exact-key-set pattern here (authPayloadShape, invitePreview
 * Shape, draftPresenterBoard all share it).
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

/** The exact-key-set assertion (#343's post-removal contract for the object). */
const assertExactKeys = (obj, cleanKeys) => assert.deepEqual(Object.keys(obj).sort(), [...cleanKeys].sort());

/** The present-today assertion: the account field(s) #343 removes are here NOW. */
function assertStillPresent(obj, fields) {
  for (const field of fields) {
    assert.equal(field in obj, true, `${field} is still on the wire today; #343 removing it must turn this guard red`);
  }
}

// ============================================================ league detail
// GET /api/league/:id  ->  { viewerTeamId, league, teams }

// A `teams` row exactly as the league-detail query projects it: the team's
// own columns and Team identity. `owner_id` stays in the SELECT (and so on
// this raw row) because viewerTeamIdOf() resolves the caller's team from it;
// the route strips it from the serialized entry. The `owner` username alias is
// no longer selected at all (#343, #115). The route spreads this row and adds
// `is_co_commissioner`.
const teamRow = ({ userId, teamId, teamName }) => ({
  id: teamId,
  name: teamName,
  draft_position: 1,
  faab_remaining: 100,
  locked: false,
  draft_ready: true,
  avatar_url: null,
  avatar_static_url: null,
  owner_id: userId, // stays in SELECT for viewerTeamId; stripped from serialization
  teamId,
  teamName,
  roster_count: 0,
  total_points: '0',
});

// A `leagues` row as the league-detail query projects it: a representative set
// of the league's own columns and the creator's Team identity. The account
// username alias (`owner_username`) is gone (#343). `owner_id` is the creator's
// OWN account id and stays (#334's survey removed only `owner_username` here).
const LEAGUE_ROW = {
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  owner_id: VIEWER.userId, // the creator's OWN account id, on `leagues.*`; stays
  current_season: 2026,
  invite_code: 'invite',
  ownerTeamId: VIEWER.teamId,
  ownerTeamName: VIEWER.teamName,
};

// The fake is keyed on `AS "ownerTeamId"` for the detail query, NOT on
// `AS "owner_username"`: #343 deletes the owner_username alias (and with it the
// now-unused users JOIN), so a matcher on that alias would stop matching and
// misreport the change as a 500. The creator's Team-identity alias is the part
// that survives #343, so it is the stable anchor.
function leagueDetailFake(t, { isCommissioner = false, coCommissioners = [] } = {}) {
  return createFakePool([
    [/AS "ownerTeamId"/, () => ({ rows: [{ ...LEAGUE_ROW }] })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: isCommissioner ? [{ '?column?': 1 }] : [] })],
    [/FROM "league_commissioners"/, () => ({ rows: coCommissioners })],
    [/COUNT\("team_players"\."id"\)/, () => ({ rows: [teamRow(VIEWER), teamRow(OTHER)] })],
  ]).install(t);
}

async function getLeagueDetail(t, opts = {}) {
  leagueDetailFake(t, opts);
  const res = await request(app).get(`/api/league/${LEAGUE_ID}`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

// The response ROOT. This is GREEN and pins `viewerTeamId` present so #343
// cannot drop it. `viewerTeamId` is `viewerTeamIdOf(teamsResult.rows, userId)`,
// which reads `owner_id` off the RAW rows - one of the two keys the teams[]
// guard removes. So #343 must strip `owner_id` from the SERIALIZED array while
// leaving it on the projected rows; narrowing the SELECT would null viewerTeamId
// for every viewer. Removing it from serialization is the only correct move, and
// that is exactly the change the teams[] guards below are shaped to catch.
test('league detail: the response root is { viewerTeamId, league, teams } and viewerTeamId resolves from the raw rows', async (t) => {
  const body = await getLeagueDetail(t);
  assertExactKeys(body, ['league', 'teams', 'viewerTeamId']);
  assert.equal(body.viewerTeamId, VIEWER.teamId, 'computed from owner_id on the raw rows, not from the serialized array');
});

// --- teams[] entry -------------------------------------------------------
const TEAM_ENTRY_CLEAN = [
  'avatar_static_url', 'avatar_url', 'draft_position', 'draft_ready', 'faab_remaining',
  'id', 'is_co_commissioner', 'locked', 'name', 'roster_count', 'teamId', 'teamName', 'total_points',
];
// owner_id stays in the SELECT (viewerTeamId reads it off the raw rows) and is
// stripped from the serialization; owner is no longer selected (#343, #115).
test('league detail: a teams[] entry is Team identity and team attributes, no account fields', async (t) => {
  const body = await getLeagueDetail(t);
  for (const team of body.teams) assertExactKeys(team, TEAM_ENTRY_CLEAN);
});

// --- league object (as a plain member sees it) ---------------------------
const LEAGUE_OBJECT_CLEAN = [
  'co_commissioners', 'current_season', 'id', 'is_commissioner', 'name',
  'owner_id', 'ownerTeamId', 'ownerTeamName',
];
test('league detail: the league object names the creator by Team, not by account name', async (t) => {
  const body = await getLeagueDetail(t, { isCommissioner: false });
  assertExactKeys(body.league, LEAGUE_OBJECT_CLEAN);
});

// --- co-commissioner roster, member view (GREEN: pins #324, no removal) ---
const COCOMM_MEMBER_CLEAN = ['teamId', 'teamName'];
const COCOMM_MEMBER_FORBIDDEN = ['user_id', 'username', 'grantedAt', 'created_at', 'owner_id'];

test('league detail: the co-commissioner roster a member sees is Team identity only (#324)', async (t) => {
  const body = await getLeagueDetail(t, {
    isCommissioner: false,
    coCommissioners: [{ user_id: OTHER.userId, username: 'u43', created_at: '2026-08-01T00:00:00.000Z', teamId: OTHER.teamId, teamName: OTHER.teamName }],
  });
  assert.equal(body.league.is_commissioner, false);
  assert.equal(body.league.co_commissioners.length, 1);
  for (const entry of body.league.co_commissioners) {
    assertExactKeys(entry, COCOMM_MEMBER_CLEAN);
    for (const field of COCOMM_MEMBER_FORBIDDEN) assert.equal(field in entry, false, `${field} must not reach a member`);
  }
});

// ================================================================== chat
// GET /api/league/:id/chat  ->  the rows verbatim.

async function getChat(t) {
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    // The chat SELECT no longer projects the author's account id or username,
    // and the route passes its rows through verbatim, so this fixture mirrors
    // the narrowed SELECT (#343). `chat_messages.user_id` is still read inside
    // the query for the block filter, but never reaches the wire.
    [/FROM "chat_messages"/, () => ({
      rows: [{
        id: 5,
        message: 'good luck everyone',
        created_at: '2026-09-01T00:00:00.000Z',
        teamId: OTHER.teamId,
        teamName: OTHER.teamName,
      }],
    })],
  ]).install(t);
  const res = await request(app).get(`/api/league/${LEAGUE_ID}/chat`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

const CHAT_ENTRY_CLEAN = ['created_at', 'id', 'message', 'teamId', 'teamName'];

test('chat history: a message is attributed by Team, not by the author account', async (t) => {
  for (const message of await getChat(t)) assertExactKeys(message, CHAT_ENTRY_CLEAN);
});

// ================================================================ pick'em
// The week view and standings build their entries from explicit object literals,
// so #343 removes the account fields by deleting those lines.

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

async function getPickemWeek(t) {
  pickemFake(t, [
    [/FROM "pickem_picks"/, () => ({
      rows: [{
        user_id: OTHER.userId, username: `u${OTHER.userId}`,
        teamId: OTHER.teamId, teamName: OTHER.teamName,
        team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null,
      }],
    })],
  ]);
  const res = await request(pickemApp).get(`/api/pickem/league/${LEAGUE_ID}/week/1`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.othersPicks['BUF|MIA'];
}

const OTHERS_PICK_CLEAN = ['confidence', 'gameKey', 'pickedTeam', 'teamId', 'teamName'];
const OTHERS_PICK_FORBIDDEN = ['userId', 'username'];

test("pick'em week view: another manager's pick STILL carries userId / username today", async (t) => {
  for (const entry of await getPickemWeek(t)) assertStillPresent(entry, OTHERS_PICK_FORBIDDEN);
});

test("pick'em week view: another manager's pick is Team identity only", { todo: '#343 removes othersPicks userId / username' }, async (t) => {
  for (const entry of await getPickemWeek(t)) assertExactKeys(entry, OTHERS_PICK_CLEAN);
});

async function getPickemStandings(t) {
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
  return res.body.standings;
}

const STANDINGS_ROW_CLEAN = [
  'avatarStaticUrl', 'avatarUrl', 'correct', 'incorrect', 'made', 'pending',
  'points', 'pushes', 'rank', 'teamId', 'teamName', 'weekly',
];
const STANDINGS_ROW_FORBIDDEN = ['userId', 'username'];

test("pick'em standings: a row STILL carries userId / username today", async (t) => {
  for (const row of await getPickemStandings(t)) assertStillPresent(row, STANDINGS_ROW_FORBIDDEN);
});

// NOTE for #343: the standings rows sort by `comparePickemStandingScore(a,b) ||
// String(a.username||'').localeCompare(...)` (pickem.service.js), and the
// docstring there promises "total points desc, then correct picks desc, then
// username". The row is `{ ...member, ...total }`, so removing `username` from
// the wire also removes it from that comparator, and tied groups then order
// arbitrarily. That may well be the right call - the tiebreak arguably wants to
// be Team name now - but it is a documented guarantee, so #343 must decide it
// deliberately (re-point the tiebreak at teamName), not drop it by omission.
test("pick'em standings: a row is Team identity and score, not the manager account", { todo: '#343 removes standings userId / username; re-point the username tiebreak at teamName' }, async (t) => {
  for (const row of await getPickemStandings(t)) assertExactKeys(row, STANDINGS_ROW_CLEAN);
});

// ================================================================= rosters
// GET /api/league/:id/rosters  ->  [{ teamId, teamName, avatarUrl, avatarStaticUrl, players }]
// Built from an explicit literal; the `ownerId` line (the roster's camelCase
// spelling of another manager's `owner_id`) is gone (#343), and `owner_id`
// leaves the SELECT too - this endpoint has no viewer-relative field to feed.

async function getRosters(t) {
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
  return res.body;
}

const ROSTER_ENTRY_CLEAN = ['avatarStaticUrl', 'avatarUrl', 'players', 'teamId', 'teamName'];

test('rosters: a team entry is Team identity and its players, not the manager account', async (t) => {
  for (const team of await getRosters(t)) assertExactKeys(team, ROSTER_ENTRY_CLEAN);
});

// =========================================================== matchup detail
// GET /api/league/:id/matchups/:matchupId  ->  { viewerTeamId, viewerWhatIf, matchup, home, away }
// The `matchup` object is `SELECT "matchups".*` plus join aliases, and carries
// the two owner ids the route reads to find the viewer's team.

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

async function getMatchupDetail(t) {
  t.mock.method(scoringService, 'rulesForLeague', () => ({}));
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr' }] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/FROM "lineup_entries"/, () => ({ rows: [] })],
  ]).install(t);
  // The viewer owns the home team, so viewerTeamId resolves from the raw row's
  // home_owner_id - the same raw-rows-vs-serialization coupling as league detail.
  const res = await request(app).get(`/api/league/${LEAGUE_ID}/matchups/7`).set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

// GREEN root pin: viewerTeamId is read from matchup.home_owner_id / away_owner_id
// on the raw row, so #343 must delete those two keys from the wire object AFTER
// computing viewerTeamId, never stop selecting them.
test('matchup detail: the response root is { viewerTeamId, viewerWhatIf, matchup, home, away } and viewerTeamId resolves from the raw owner ids', async (t) => {
  const body = await getMatchupDetail(t);
  assertExactKeys(body, ['away', 'home', 'matchup', 'viewerTeamId', 'viewerWhatIf']);
  assert.equal(body.viewerTeamId, VIEWER.teamId, 'computed from home_owner_id on the raw matchup row');
});

const MATCHUP_OBJECT_CLEAN = [
  'away_score', 'away_team_avatar_static_url', 'away_team_avatar_url', 'away_team_id', 'away_team_name',
  'home_score', 'home_team_avatar_static_url', 'home_team_avatar_url', 'home_team_id', 'home_team_name',
  'id', 'league_id', 'season', 'status', 'week',
];
// home_owner_id / away_owner_id stay in the SELECT (viewerTeamId reads them off
// the raw row) and are stripped from the serialized matchup object (#343, #115).
test('matchup detail: the matchup object names both teams by Team, not by owner account', async (t) => {
  assertExactKeys((await getMatchupDetail(t)).matchup, MATCHUP_OBJECT_CLEAN);
});
