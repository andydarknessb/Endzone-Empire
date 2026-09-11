/**
 * #1236: GET /api/team/lineup/:playerId/context — the Decision card's game
 * and usage context for one rostered player. Covers the acceptance criteria
 * directly: all three of line/weather/usage present, each source absent on
 * its own producing null, the implied team total for a favourite and an
 * underdog, and a not-rostered player refused with a coded 404 (ADR 0032).
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const teamRouter = require('../routes/team.router');
const { PLAYER_NOT_ON_ROSTER } = require('../services/decisionCardContext.service');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'team-lineup-context-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);

const VIEWER = { userId: 42, teamId: 11, leagueId: 1 };
const authed = `Bearer ${signToken({ id: VIEWER.userId, username: 'viewer' })}`;

const PLAYER = { id: 7, name: 'Test Wideout', position: 'WR', nfl_team: 'BUF' };

const leagueRow = (over = {}) => ({
  id: VIEWER.leagueId,
  current_season: 2026,
  current_week: 5,
  scoring_rules: null,
  ...over,
});

const teamRow = () => ({ id: VIEWER.teamId, league_id: VIEWER.leagueId, owner_id: VIEWER.userId });

function baseHandlers({ leagueOverride, rostered = true } = {}) {
  return [
    [select('leagues'), () => ({ rows: [leagueRow(leagueOverride)] })],
    [select('teams'), () => ({ rows: [teamRow()] })],
    [select('team_players'), () => ({ rows: rostered ? [PLAYER] : [] })],
  ];
}

test('GET lineup/:playerId/context: a player not on the caller\'s roster is refused with a coded 404', async (t) => {
  createFakePool(baseHandlers({ rostered: false })).install(t);

  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .query({ leagueId: VIEWER.leagueId })
    .set('Authorization', authed);

  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body.code, PLAYER_NOT_ON_ROSTER);
  assert.ok(res.body.message);
  assert.equal('error' in res.body, false, 'ADR 0032: no bare error field beside a coded refusal');
});

test('GET lineup/:playerId/context: all three of line, weather and usage present', async (t) => {
  createFakePool([
    ...baseHandlers(),
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({
      rows: [{ game_key: '2026_05_BUF_MIA', roof: 'outdoors', home_away: 'away' }],
    })],
    [/^SELECT "total", "spread", "observed_at" FROM "game_odds_snapshots"/, () => ({
      rows: [{ total: '47.00', spread: '-3.00', observed_at: '2026-10-01T12:00:00.000Z' }],
    })],
    [/^SELECT "temperature_f".*FROM "game_weather_snapshots"/, () => ({
      rows: [{
        temperature_f: '45.50', wind_speed_mph: '10.00', wind_gust_mph: '18.00',
        precipitation_probability: 20, short_forecast: 'Partly Cloudy',
      }],
    })],
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [{ week: 4 }, { week: 3 }, { week: 2 }] })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "player_id"/, () => ({
      rows: [
        { week: 4, stats: { usageTargets: 8, usageCarries: 0, usageAirYards: 90, gameTeam: 'BUF' } },
        { week: 2, stats: { usageTargets: 5, usageCarries: 1, usageAirYards: 40, gameTeam: 'BUF' } },
      ],
    })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "season"/, () => ({
      rows: [
        { week: 4, stats: { gameTeam: 'BUF', usagePassAttempts: 20 } },
        { week: 4, stats: { gameTeam: 'BUF', usagePassAttempts: 15 } },
        { week: 2, stats: { gameTeam: 'BUF', usagePassAttempts: 25 } },
      ],
    })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .query({ leagueId: VIEWER.leagueId, week: 5 })
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { line, weather, usage } = res.body;

  // Underdog: BUF is away, spread -3 favours the home team (MIA); away's
  // implied total (22) is lower than home's (25).
  assert.equal(line.spread, -3);
  assert.equal(line.total, 47);
  assert.equal(line.impliedTeamTotal, 22);

  assert.equal(weather.indoor, false);
  assert.equal(weather.temperatureF, 45.5);
  assert.equal(weather.windSpeedMph, 10);
  assert.equal(weather.precipitationProbability, 20);
  assert.equal(weather.shortForecast, 'Partly Cloudy');

  assert.equal(usage.weeks.length, 3);
  const [w4, w3, w2] = usage.weeks;
  assert.equal(w4.week, 4);
  assert.equal(w4.targets, 8);
  assert.equal(w4.targetShare, 0.2286); // round4(8/35)
  // A week his team played but he did not: present, every stat null.
  assert.equal(w3.week, 3);
  assert.equal(w3.targets, null);
  assert.equal(w3.carries, null);
  assert.equal(w3.targetShare, null);
  assert.equal(w2.week, 2);
  assert.equal(w2.targets, 5);
  assert.equal(w2.targetShare, 0.2);

  assert.equal(usage.seasonAverage.targets, 6.5);
  assert.equal(usage.seasonAverage.carries, 0.5);
  assert.equal(usage.seasonAverage.airYards, 65);
});

test('GET lineup/:playerId/context: a favourite (home, negative spread) gets the higher implied total', async (t) => {
  createFakePool([
    ...baseHandlers(),
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({
      rows: [{ game_key: '2026_05_BUF_MIA', roof: 'outdoors', home_away: 'home' }],
    })],
    [/^SELECT "total", "spread", "observed_at" FROM "game_odds_snapshots"/, () => ({
      rows: [{ total: '47.00', spread: '-3.00', observed_at: '2026-10-01T12:00:00.000Z' }],
    })],
    [/^SELECT "temperature_f".*FROM "game_weather_snapshots"/, () => ({ rows: [] })],
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .query({ leagueId: VIEWER.leagueId, week: 5 })
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.line.impliedTeamTotal, 25);
  assert.equal(res.body.usage, null);
});

test('GET lineup/:playerId/context: no snapshot for the game yet, line is null', async (t) => {
  createFakePool([
    ...baseHandlers(),
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({
      rows: [{ game_key: '2026_05_BUF_MIA', roof: 'outdoors', home_away: 'away' }],
    })],
    [/^SELECT "total", "spread", "observed_at" FROM "game_odds_snapshots"/, () => ({ rows: [] })],
    [/^SELECT "temperature_f".*FROM "game_weather_snapshots"/, () => ({ rows: [] })],
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .query({ leagueId: VIEWER.leagueId, week: 5 })
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.line, null);
  // Weather is a fields-null object once a game exists, per the ADR - never
  // bare null when a game was found.
  assert.equal(res.body.weather.indoor, false);
  assert.equal(res.body.weather.temperatureF, null);
});

test('GET lineup/:playerId/context: no game this week (bye/unsynced) - line and weather are both null', async (t) => {
  createFakePool([
    ...baseHandlers(),
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [{ week: 4 }] })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "player_id"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .query({ leagueId: VIEWER.leagueId, week: 5 })
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.line, null);
  assert.equal(res.body.weather, null);
  // His team played, he had no stats row that week: present, nulled.
  assert.equal(res.body.usage.weeks.length, 1);
  assert.equal(res.body.usage.weeks[0].targets, null);
  assert.equal(res.body.usage.seasonAverage, null);
});

test('GET lineup/:playerId/context: an indoor game skips the weather request and reports indoor with no forecast', async (t) => {
  createFakePool([
    ...baseHandlers(),
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({
      rows: [{ game_key: '2026_05_NO_ATL', roof: 'dome', home_away: 'home' }],
    })],
    [/^SELECT "total", "spread", "observed_at" FROM "game_odds_snapshots"/, () => ({ rows: [] })],
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .query({ leagueId: VIEWER.leagueId, week: 5 })
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.weather.indoor, true);
  assert.equal(res.body.weather.shortForecast, null);
});

test('GET lineup/:playerId/context: week defaults to the league\'s current week when omitted', async (t) => {
  const fake = createFakePool([
    ...baseHandlers(),
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .query({ leagueId: VIEWER.leagueId })
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const gameCall = fake.matching(/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/)[0];
  assert.deepEqual(gameCall.params, [2026, 5, PLAYER.nfl_team]); // league.current_week (5)
});

test('GET lineup/:playerId/context: leagueId query param is required', async (t) => {
  createFakePool([]).install(t);
  const res = await request(app)
    .get(`/api/team/lineup/${PLAYER.id}/context`)
    .set('Authorization', authed);
  assert.equal(res.status, 400);
});
