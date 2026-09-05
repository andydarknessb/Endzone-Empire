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
 * #425: GET /api/league/:id/matchups/:matchupId keys its `nfl_team -> opponent`
 * schedule map off raw `nfl_games.nfl_team` and looks it up with raw
 * `players.nfl_team`. That agrees for a skill player (both Tank01 codes) but
 * not for a DEF unit, whose `players.nfl_team` is a full team name
 * (`syncTeamDefenses` seeds it that way) - so every DEF's `opponent` came back
 * null. The fix (`decision.service`'s #423 pattern) normalizes both sides of
 * the JS-side comparison through `normalizeNflTeam`, leaving the map's VALUE
 * (`nfl_games.opponent`) raw, since ADR 0011 keeps the schedule in Tank01's
 * own vocabulary on purpose.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'matchup-detail-opponent-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const LEAGUE_ID = 1;
const VIEWER = { userId: 42, teamId: 11 };
const OTHER = { userId: 43, teamId: 12 };
const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

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
  home_team_name: 'Gridiron Ghosts',
  away_team_name: 'Sunday Scaries',
  home_owner_id: VIEWER.userId,
  away_owner_id: OTHER.userId,
  home_team_avatar_url: null,
  away_team_avatar_url: null,
  home_team_avatar_static_url: null,
  away_team_avatar_static_url: null,
};

/**
 * Drives the real route with one starter row on the home team (`starterRow`)
 * and one week of schedule (`scheduleRows`); everything else (bench, the away
 * team's lineup) comes back empty. Returns the home team's lone starter.
 */
async function getHomeStarter(t, { starterRow, scheduleRows }) {
  t.mock.method(scoringService, 'rulesForLeague', () => ({}));
  // The route reads the weekly (league-aware) run through expectedFinal.service
  // and for bench rows; neither matters to the opponent question.
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: new Map() }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr' }] })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    [/FROM "nfl_games"/, () => ({ rows: scheduleRows })],
    [/"lineup_entries"\."slot" = \$4/, () => ({ rows: [] })], // BENCH, both teams
    [/"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === VIEWER.teamId ? [starterRow] : [], // starters; only the home team has one
    })],
    // The producer's own read (every non-IR row for both teams)
    // read; it does not matter to the opponent question.
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [starter] = res.body.home.starters;
  assert.ok(starter, 'expected exactly one home starter');
  return starter;
}

test('a DEF unit resolves its real-game opponent even though players.nfl_team is a full team name (#425)', async (t) => {
  const starterRow = {
    id: 101, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos',
    injury_status: null, slot: 'DST', stats: null,
  };
  const scheduleRows = [{ nfl_team: 'DEN', opponent: 'KC' }];
  const starter = await getHomeStarter(t, { starterRow, scheduleRows });
  assert.equal(starter.opponent, 'KC');
});

test('a skill player raw-coded WSH still resolves against a raw-coded WSH schedule row (#425)', async (t) => {
  const starterRow = {
    id: 102, name: 'Some Wideout', position: 'WR', nfl_team: 'WSH',
    injury_status: null, slot: 'WR', stats: null,
  };
  const scheduleRows = [{ nfl_team: 'WSH', opponent: 'DAL' }];
  const starter = await getHomeStarter(t, { starterRow, scheduleRows });
  assert.equal(starter.opponent, 'DAL');
});

test("the opponent value stays raw ('WSH' does not fold to 'WAS') (#425)", async (t) => {
  const starterRow = {
    id: 103, name: 'Some Runner', position: 'RB', nfl_team: 'DAL',
    injury_status: null, slot: 'RB', stats: null,
  };
  const scheduleRows = [{ nfl_team: 'DAL', opponent: 'WSH' }];
  const starter = await getHomeStarter(t, { starterRow, scheduleRows });
  assert.equal(starter.opponent, 'WSH');
});
