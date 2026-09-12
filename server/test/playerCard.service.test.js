const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const byeService = require('../services/bye.service');
const decisionCardContextService = require('../services/decisionCardContext.service');
const irPolicy = require('../services/irPolicy.service');
const { getPlayerCard } = require('../services/playerCard.service');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEAGUE = {
  id: 3,
  current_season: 2026,
  current_week: 1,
  best_ball: false,
  waiver_type: 'faab',
  regular_season_weeks: 14,
  playoff_teams: 4,
  waivers_clear_at: null,
};

const PLAYER = {
  id: 55,
  name: 'Test Player',
  position: 'WR',
  nfl_team: 'BUF',
  jersey_number: '17',
  photo_url: null,
  injury_status: null,
  injury_detail: null,
  news: null,
  adp: null,
};

const TEAM = {
  id: 10, league_id: 3, owner_id: 7, name: 'My Team', faab_remaining: 50, waiver_priority: 3,
};

/**
 * The full set of `pool`/client queries `getPlayerCard` issues, each matched
 * on its distinctive leading clause so two different queries against the
 * same table never collide (`fakePool.js`'s own `select()` helper matches on
 * the first FROM table alone, which `players` and `team_players` each hit
 * twice here with different columns).
 */
function buildHandlers({
  league = LEAGUE,
  player = PLAYER,
  team = TEAM,
  rosteredBy = null, // { team_id, team_name } | null
  waiverRow = null, // { available_at } | null
  rosterCount = 0,
} = {}) {
  return [
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({ rows: [league] })],
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2$/, () => ({ rows: [team] })],
    [/^SELECT \* FROM "players" WHERE "id" = \$1$/, () => ({ rows: [player] })],
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [] })],
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: [] })],
    [/^SELECT "id", "position" FROM "players" WHERE "id" = ANY/, () => ({ rows: [{ id: player.id, position: player.position }] })],
    [/^SELECT "team_players"\."team_id", "teams"\."name"/, () => ({ rows: rosteredBy ? [rosteredBy] : [] })],
    [/^SELECT "available_at" FROM "waiver_players"/, () => ({ rows: waiverRow ? [waiverRow] : [] })],
    [/^SELECT COUNT\(\*\)::int AS "roster_count" FROM "team_players"/, () => ({ rows: [{ roster_count: rosterCount }] })],
    [/^SELECT "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "games_played", "stats" FROM "player_season_stats"/, () => ({ rows: [] })],
  ];
}

/** Mocks every cross-module seam `getPlayerCard` reads through, so a test can
 * fix each one's answer instead of exercising the real projection engine,
 * lineup materialization, or bye/usage lookups. Returns the spy call logs the
 * tests need. */
function mockServices(t, {
  weekPoints = new Map(),
  weeklyProjection = () => ({ median: 5, factors: { availability: { available: true } } }),
  byeWeek = null,
  restOfSeason = { total: 0, perGame: 0 },
  rosterCapacity = 16,
} = {}) {
  const weekProjectionCalls = [];
  t.mock.method(projectionService, 'getWeekProjections', async (options) => {
    weekProjectionCalls.push(options);
    const map = new Map();
    for (const id of options.playerIds) map.set(id, { points: weekPoints.get(id) ?? 0 });
    return map;
  });
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ week, playerIds }) => {
    const projections = new Map(playerIds.map((id) => [id, weeklyProjection(week, id)]));
    return { projections };
  });
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds) => {
    return new Map(playerIds.map((id) => [id, restOfSeason]));
  });
  t.mock.method(byeService, 'computeByeWeek', async () => byeWeek);
  t.mock.method(decisionCardContextService, 'loadUsage', async () => null);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(irPolicy, 'rosterCapacity', async () => rosterCapacity);
  return { weekProjectionCalls };
}

// ---------------------------------------------------------------------------
// getPlayerCard
// ---------------------------------------------------------------------------

test('getPlayerCard: a best_ball league yields upgrade: null', async (t) => {
  createFakePool(buildHandlers({ league: { ...LEAGUE, best_ball: true } })).install(t);
  mockServices(t, { weekPoints: new Map([[PLAYER.id, 12]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.decision.upgrade, null);
});

test('getPlayerCard: a player on bye in week N yields weeks[N-1].kind === "bye" with no points', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, { byeWeek: 5 });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.weeks.length, 18);
  assert.equal(card.weeks[4].week, 5);
  assert.equal(card.weeks[4].kind, 'bye');
  assert.equal('points' in card.weeks[4], false);
});

test('getPlayerCard: a rostered player yields availability.teamId and teamName', async (t) => {
  createFakePool(buildHandlers({ rosteredBy: { team_id: 77, team_name: 'Rival Team' } })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.availability.state, 'rostered');
  assert.equal(card.availability.teamId, 77);
  assert.equal(card.availability.teamName, 'Rival Team');
});

test('getPlayerCard: seasonEnd equals the league\'s last playoff week', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.seasonEnd, projectionService.lastPlayoffWeek(LEAGUE));
  assert.equal(card.decision.ros.throughWeek, card.seasonEnd);
});

test('getPlayerCard: projWeek.points is the one getWeekProjections call for the current week', async (t) => {
  createFakePool(buildHandlers()).install(t);
  const { weekProjectionCalls } = mockServices(t, { weekPoints: new Map([[PLAYER.id, 14.5]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(weekProjectionCalls.length, 1);
  assert.equal(weekProjectionCalls[0].season, LEAGUE.current_season);
  assert.equal(weekProjectionCalls[0].week, LEAGUE.current_week);
  assert.equal(card.decision.projWeek.week, LEAGUE.current_week);
  assert.equal(card.decision.projWeek.points, 14.5);
});
