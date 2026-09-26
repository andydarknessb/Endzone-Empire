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
  identityIds = [player.id], // every players row loadIdentityIds resolves for this player
  ownRosterRows = [], // rows for the caller's OWN team_players (own-roster Upgrade check)
} = {}) {
  return [
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({ rows: [league] })],
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2$/, () => ({ rows: [team] })],
    [/^SELECT \* FROM "players" WHERE "id" = \$1$/, () => ({ rows: [player] })],
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [] })],
    // #1667: the player's own game this week (line/weather); no game by default.
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [] })],
    [/^WITH "target" AS \(/, () => ({ rows: identityIds.map((id) => ({ id })) })],
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: ownRosterRows })],
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({ rows: [{ id: player.id, position: player.position }] })],
    [/^SELECT "team_players"\."team_id", "teams"\."name"/, () => ({ rows: rosteredBy ? [rosteredBy] : [] })],
    [/^SELECT "available_at" FROM "waiver_players"/, () => ({ rows: waiverRow ? [waiverRow] : [] })],
    [/^SELECT COUNT\(\*\)::int AS "roster_count" FROM "team_players"/, () => ({ rows: [{ roster_count: rosterCount }] })],
    [/^SELECT "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "games_played", "stats" FROM "player_season_stats"/, () => ({ rows: [] })],
    // #1356 seasons[]: getRescoredPositionRank's position-group read, for the
    // current season entry every card now builds (Cory's ruling on #1356) -
    // no rows by default; the seasons[]-specific tests override this.
    [/^SELECT "pss"\."player_id"/, () => ({ rows: [] })],
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
  realUsage = false, // leave loadUsage to the fake pool (the IDP side case)
} = {}) {
  const weekProjectionCalls = [];
  t.mock.method(projectionService, 'getWeekProjections', async (options) => {
    weekProjectionCalls.push(options);
    const map = new Map();
    for (const id of options.playerIds) {
      const value = weekPoints.get(id) ?? 0;
      // #1342: a fixture may hand a bare number (every pre-existing test) or a
      // full `{ points, factors }` entry (the opponentRankVsPosition cases),
      // the same two shapes `toLegacyProjectionMap` actually produces.
      map.set(id, typeof value === 'object' ? value : { points: value });
    }
    return map;
  });
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ week, playerIds }) => {
    const projections = new Map(playerIds.map((id) => [id, weeklyProjection(week, id)]));
    return { projections };
  });
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async ({ weeks, playerIds }) => new Map(
    weeks.map((week) => [week, { week, projections: new Map(playerIds.map((id) => [id, weeklyProjection(week, id)])) }]),
  ));
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds) => {
    return new Map(playerIds.map((id) => [id, restOfSeason]));
  });
  t.mock.method(byeService, 'computeByeWeek', async () => byeWeek);
  if (!realUsage) t.mock.method(decisionCardContextService, 'loadUsage', async () => null);
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

test('getPlayerCard: a past, non-bye week with no player_stats row ships kind "actual" with points null (formal review f3, open interpretation)', async (t) => {
  const league = { ...LEAGUE, current_week: 3 };
  createFakePool(buildHandlers({ league })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.weeks[0].kind, 'actual');
  assert.equal(card.weeks[0].points, null);
  assert.equal(card.weeks[1].kind, 'actual');
  assert.equal(card.weeks[1].points, null);
});

test('getPlayerCard: a player on bye in week N yields weeks[N-1].kind === "bye" with no points', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, { byeWeek: 5 });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.weeks.length, 18);
  assert.equal(card.weeks[4].week, 5);
  assert.equal(card.weeks[4].kind, 'bye');
  assert.equal('points' in card.weeks[4], false);
  // f2: opponentRankVsPosition is a `kind: 'projected'` field (Ruling item 3);
  // a bye row carries no such key, not even a null one.
  assert.equal('opponentRankVsPosition' in card.weeks[4], false);
});

test('getPlayerCard (#1675): weeks[].reason is the Unavailable reason CODE - bye reads bye, a released player reads no_team, IR reads ir', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    byeWeek: 5,
    weeklyProjection: (week) => {
      if (week === 7) return { median: null, factors: { availability: { available: false, reason: 'no_team' } } };
      if (week === 8) return { median: null, factors: { availability: { available: false, reason: 'ir' } } };
      if (week === 9) return { median: null, factors: { availability: { available: false, reason: 'out' } } };
      return { median: 5, factors: { availability: { available: true } } };
    },
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });
  assert.equal(card.weeks[4].reason, 'bye');
  assert.equal(card.weeks[6].kind, 'unavailable');
  assert.equal(card.weeks[6].reason, 'no_team');
  assert.equal(card.weeks[7].reason, 'ir');
  assert.equal(card.weeks[8].reason, 'out');
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

test('getPlayerCard: projWeek.points is the one getWeekProjections call for the current week, under the league\'s own scoring', async (t) => {
  createFakePool(buildHandlers()).install(t);
  const { weekProjectionCalls } = mockServices(t, { weekPoints: new Map([[PLAYER.id, 14.5]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(weekProjectionCalls.length, 1);
  assert.equal(weekProjectionCalls[0].season, LEAGUE.current_season);
  assert.equal(weekProjectionCalls[0].week, LEAGUE.current_week);
  // formal review f2: the ticket exists because waiverSuggestions calls
  // getWeekProjections with no `league` (routes to default-scoring pool
  // extrapolation) - assert the actual call carries the league object and
  // the player, not just that A call happened, so dropping `league` here
  // goes red.
  assert.equal(weekProjectionCalls[0].league, LEAGUE);
  assert.ok(weekProjectionCalls[0].playerIds.includes(PLAYER.id));
  assert.equal(card.decision.projWeek.week, LEAGUE.current_week);
  assert.equal(card.decision.projWeek.points, 14.5);
});

// ---------------------------------------------------------------------------
// #1342: decision.projWeek.opponentRankVsPosition (the opponent Factor is the
// one producer, ranked - see projection.service.js's rankOpponentDefense)
// ---------------------------------------------------------------------------

test('getPlayerCard: projWeek.opponentRankVsPosition is { rank, of } read off the opponent Factor', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    weekPoints: new Map([[PLAYER.id, {
      points: 14.5,
      factors: { opponent: { available: true, rank: 24, of: 32 } },
    }]]),
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.decision.projWeek.opponentRankVsPosition, { rank: 24, of: 32 });
});

test('getPlayerCard: projWeek.opponentRankVsPosition is null when the opponent Factor is not available (never 0)', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    weekPoints: new Map([[PLAYER.id, {
      points: 14.5,
      factors: { opponent: { available: false } },
    }]]),
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.decision.projWeek.opponentRankVsPosition, null);
});

test('getPlayerCard: weeks[] projected rows carry their OWN run\'s opponentRankVsPosition (Ruling item 3, the canvas hover)', async (t) => {
  createFakePool(buildHandlers()).install(t);
  mockServices(t, {
    weeklyProjection: (week) => ({
      median: 5,
      factors: {
        availability: { available: true },
        opponent: week === 1 ? { available: true, rank: 3, of: 32 } : { available: false },
      },
    }),
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.weeks[0].week, 1);
  assert.equal(card.weeks[0].kind, 'projected');
  assert.deepEqual(card.weeks[0].opponentRankVsPosition, { rank: 3, of: 32 });
  assert.equal(card.weeks[1].kind, 'projected');
  assert.equal(card.weeks[1].opponentRankVsPosition, null);
});

// ---------------------------------------------------------------------------
// formal review f1: identity resolution (a plain `players` row never carries
// `identity_ids` - that only exists as player.router.js's list CTE alias)
// ---------------------------------------------------------------------------

test('getPlayerCard: the caller\'s roster holding a SIBLING identity row (not the requested id itself) still reads my_team and upgrade: null', async (t) => {
  const SIBLING_ID = 999; // same real athlete as PLAYER.id, a duplicate players row
  createFakePool(buildHandlers({
    identityIds: [PLAYER.id, SIBLING_ID],
    ownRosterRows: [{ player_id: SIBLING_ID }],
    rosteredBy: { team_id: TEAM.id, team_name: TEAM.name },
  })).install(t);
  mockServices(t, { weekPoints: new Map([[PLAYER.id, 12]]) });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.availability.state, 'my_team');
  assert.equal(card.decision.upgrade, null);
});

// ---------------------------------------------------------------------------
// #1356: seasons[] - league-scored season summary, weeks and game log per
// season on record for the player.
// ---------------------------------------------------------------------------

// Full PPR (reception: 1) rather than the app-default half-PPR (0.5) that
// player_season_stats.fantasy_points is stored under - every points/rank
// assertion below that leans on "differs from the stored column" needs the
// league's rules to actually diverge from that default.
const FULL_PPR_LEAGUE = { ...LEAGUE, scoring_rules: { receiving: { reception: 1 } } };

/** One week's raw player_stats.stats: `receptions` receptions for `yards` receiving yards. */
function receivingStats(receptions, yards) {
  return { receptions, receivingYards: yards };
}

/**
 * Extends `buildHandlers` with the season-scoped queries `seasons[]` adds:
 * a per-season nfl_games schedule read and one player_season_stats
 * position-group read per season (`getRescoredPositionRank`). `weeklyRows`
 * and `seasonRows` seed the two base player_stats/player_season_stats
 * reads. `scheduleRows` (`{ season, team, week, opponent }`) seeds the
 * per-season schedule read - `team` is checked (formal review f2: a past
 * season's schedule query must use THAT season's played team, not today's
 * `player.nfl_team`) via a raw-value match; every fixture's team code (`KC`,
 * `DEN`, ...) is left untouched by `normalizeNflTeam`, so a plain equality
 * check is exact. `positionSeasonRows` (`{ player_id, position, season,
 * stats, fantasy_points }`, every position/season together) seeds the
 * position-rank read, filtered on BOTH `position` and `season` params
 * (formal review f3: the fake must actually check `position`, not just
 * `season`, or dropping the position filter from the real query would stay
 * green).
 */
function buildSeasonHandlers({
  league = LEAGUE,
  player = PLAYER,
  weeklyRows = [], // { season, week, stats } across every season, newest first
  seasonRows = [], // { season, games_played, stats } across every season
  scheduleRows = [], // { season, team, week, opponent }
  positionSeasonRows = [], // { player_id, position, season, stats, fantasy_points }
} = {}) {
  return [
    // Overrides first: `handlers.find` takes the FIRST match, and
    // `buildHandlers` below already answers the plain player_stats/
    // player_season_stats/nfl_games patterns these seasons[] tests need to
    // seed with real data instead.
    [/^SELECT "season", "week", "stats" FROM "player_stats"/, () => ({ rows: weeklyRows })],
    [/^SELECT "season", "games_played", "stats" FROM "player_season_stats"/, () => ({ rows: seasonRows })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "player_id" = \$1 AND "season" = \$2/, (text, params) => ({
      rows: weeklyRows.filter((r) => r.season === params[1] && r.week < params[2]).map((r) => ({ week: r.week, stats: r.stats })),
    })],
    // Both the top-level (current-season) and the per-past-season schedule
    // reads share this exact SQL shape (`getPlayerCard`'s own design: a past
    // season reuses the current season's query, just with that season's own
    // team) - $1 is season, $2 is team.
    [/^SELECT "week", "opponent" FROM "nfl_games" WHERE "season" = \$1/, (text, params) => ({
      rows: scheduleRows.filter((r) => r.season === params[0] && r.team === params[1]),
    })],
    [/^SELECT "pss"\."player_id"/, (text, params) => ({
      rows: positionSeasonRows.filter((r) => r.position === params[0] && r.season === params[1]),
    })],
    ...buildHandlers({ league, player }),
  ];
}

test('getPlayerCard: a player with 2024, 2025 and 2026 (current) rows returns three seasons entries newest first', async (t) => {
  const league = { ...FULL_PPR_LEAGUE, current_season: 2026, current_week: 3 };
  const weeklyRows = [
    { season: 2026, week: 1, stats: receivingStats(4, 40) },
    { season: 2026, week: 2, stats: receivingStats(3, 30) },
    { season: 2025, week: 1, stats: receivingStats(5, 50) },
    { season: 2025, week: 2, stats: receivingStats(6, 60) },
    { season: 2024, week: 1, stats: receivingStats(2, 20) },
  ];
  // f4: the rollup `stats`/`fantasy_points` deliberately DON'T match the sum
  // of the seeded weekly rows - an implementation that rescored the rollup
  // aggregate instead of the weekly rows would produce a different number
  // than the assertion below expects, catching that substitution.
  const seasonRows = [
    { season: 2025, games_played: 2, stats: receivingStats(99, 999), fantasy_points: 16.5 },
    { season: 2024, games_played: 1, stats: receivingStats(50, 500), fantasy_points: 3 },
  ];
  createFakePool(buildSeasonHandlers({ league, weeklyRows, seasonRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.seasons.map((s) => s.season), [2026, 2025, 2024]);

  // 2024: full-PPR points over its own weekly rows (2 receptions * 1 + 20 * 0.1 = 4)
  // - not the rollup's aggregate stats (which would score very differently), and
  // that differs from the stored (half-PPR) fantasy_points column (3) too.
  const y2024 = card.seasons.find((s) => s.season === 2024);
  assert.equal(y2024.points, 4);
  assert.notEqual(y2024.points, seasonRows[1].fantasy_points);
  assert.equal(y2024.games, 1);
  assert.equal(y2024.adp, null);
  assert.ok(y2024.weeks.every((w) => w.kind !== 'projected'));
});

// ---------------------------------------------------------------------------
// formal review f1 (Cory's ruling on #1356, 2026-09-13): seasons[0] is ALWAYS
// league.current_season, built from the top-level weeks/log.current - even
// with zero current-season rows on file.
// ---------------------------------------------------------------------------

test('getPlayerCard: seasons[0] is the current season (built from the top-level weeks/log.current) even when the player has only PAST-season rows', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 1 };
  const weeklyRows = [{ season: 2025, week: 1, stats: receivingStats(5, 50) }];
  createFakePool(buildSeasonHandlers({ league, weeklyRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.seasons.map((s) => s.season), [2026, 2025]);
  assert.equal(card.seasons[0].season, 2026);
  assert.deepEqual(card.seasons[0].weeks, card.weeks);
  assert.deepEqual(card.seasons[0].log, card.log.current);
  assert.equal(card.seasons[0].games, 0);
  assert.equal(card.seasons[0].points, 0);
  assert.equal(card.seasons[0].posRank, null);
});

test('getPlayerCard: a player with no stats rows at all returns ONE seasons entry (the current season), never [] and never a throw', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 1 };
  createFakePool(buildSeasonHandlers({ league })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.deepEqual(card.seasons.map((s) => s.season), [2026]);
  assert.equal(card.seasons[0].games, 0);
  assert.equal(card.seasons[0].points, 0);
  assert.equal(card.seasons[0].pointsPerGame, 0);
  assert.equal(card.seasons[0].posRank, null);
  assert.deepEqual(card.seasons[0].log, []);
});

test('getPlayerCard: adp is a number on the current-season entry and null on every past season', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 3 };
  const player = { ...PLAYER, adp: 12.4 };
  const weeklyRows = [
    { season: 2026, week: 1, stats: receivingStats(4, 40) },
    { season: 2025, week: 1, stats: receivingStats(5, 50) },
  ];
  createFakePool(buildSeasonHandlers({ league, player, weeklyRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: player.id });

  assert.equal(card.seasons.find((s) => s.season === 2026).adp, 12.4);
  assert.equal(card.seasons.find((s) => s.season === 2025).adp, null);
});

test('getPlayerCard: posRank ranks a seeded position of three players by the RESCORED points under a TE-premium rule, not the stored column, and excludes a different position (formal review f3)', async (t) => {
  // TE-premium: a 2-point-per-reception bonus on top of the reception rate
  // reorders a high-reception, low-yardage player above a low-reception,
  // high-yardage one relative to the stored half-PPR ranking.
  const league = { ...LEAGUE, current_season: 2026, current_week: 1, scoring_rules: { receiving: { reception: 2.5 } } };
  const weeklyRows = [
    { season: 2025, week: 1, stats: receivingStats(10, 40) }, // PLAYER (55): rescores highest
  ];
  const positionSeasonRows = [
    { player_id: 55, position: 'WR', season: 2025, stats: receivingStats(10, 40), fantasy_points: 24 }, // PLAYER: stored half-PPR rank 2nd
    { player_id: 56, position: 'WR', season: 2025, stats: receivingStats(2, 120), fantasy_points: 28 }, // stored half-PPR rank 1st
    { player_id: 57, position: 'WR', season: 2025, stats: receivingStats(1, 10), fantasy_points: 3.5 },
    // A different position in the SAME season: if the fake (or the real
    // query) dropped the position filter, this would inflate posRankOf to 4
    // and could shift PLAYER's rank.
    { player_id: 58, position: 'TE', season: 2025, stats: receivingStats(20, 200), fantasy_points: 60 },
  ];
  createFakePool(buildSeasonHandlers({ league, weeklyRows, positionSeasonRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  const y2025 = card.seasons.find((s) => s.season === 2025);
  // Rescored under reception: 2.5 -> PLAYER: 10*2.5 + 40*0.1 = 29; id56: 2*2.5 + 120*0.1 = 17.
  // PLAYER now ranks 1st, reversing the stored (half-PPR) order where id56 led.
  assert.equal(y2025.posRank, 1);
  // Only the 3 WRs count - the TE (id 58) is excluded from posRankOf.
  assert.equal(y2025.posRankOf, 3);
});

test('getPlayerCard: a rookie with only the current season returns one seasons entry', async (t) => {
  const league = { ...LEAGUE, current_season: 2026, current_week: 2 };
  const weeklyRows = [{ season: 2026, week: 1, stats: receivingStats(3, 30) }];
  createFakePool(buildSeasonHandlers({ league, weeklyRows })).install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.seasons.length, 1);
  assert.equal(card.seasons[0].season, 2026);
});

// ---------------------------------------------------------------------------
// formal review f2: a past season's schedule and bye week come from the team
// the player actually played THAT season (stats.gameTeam), not today's
// player.nfl_team - and a log row prefers its own stats.gameOpponent.
// ---------------------------------------------------------------------------

test('getPlayerCard: a traded player\'s past-season bye/schedule come from that season\'s OWN team, not today\'s player.nfl_team', async (t) => {
  const player = { ...PLAYER, nfl_team: 'DEN' }; // today's team
  const league = { ...LEAGUE, current_season: 2026, current_week: 1 };
  // 2025: the player was on KC (every weekly row's stats.gameTeam), not DEN.
  const weeklyRows = [
    { season: 2025, week: 5, stats: { ...receivingStats(6, 60), gameTeam: 'KC', gameOpponent: 'LV' } },
    { season: 2025, week: 6, stats: { ...receivingStats(4, 40), gameTeam: 'KC', gameOpponent: 'DEN' } },
  ];
  const scheduleRows = [
    // The KC schedule's own week-6 opponent ('SF') deliberately differs from
    // that week's row-level stats.gameOpponent ('DEN') below, so the log
    // assertion can tell which one actually won.
    { season: 2025, team: 'KC', week: 5, opponent: 'LV' },
    { season: 2025, team: 'KC', week: 6, opponent: 'SF' },
  ];
  createFakePool(buildSeasonHandlers({ league, player, weeklyRows, scheduleRows })).install(t);
  const byeCallTeams = [];
  mockServices(t);
  t.mock.method(byeService, 'computeByeWeek', async (team, s) => {
    byeCallTeams.push([team, s]);
    // DEN's 2025 bye happens to land on week 5, the week the player actually
    // played (for KC) - the wrong-team lookup this reproduces.
    if (team === 'DEN' && s === 2025) return 5;
    if (team === 'KC' && s === 2025) return 9;
    return null;
  });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: player.id });

  // The bye/schedule lookups for 2025 ran against KC (the season's own
  // team), never DEN (today's).
  assert.ok(byeCallTeams.some(([team, s]) => team === 'KC' && s === 2025));
  assert.ok(!byeCallTeams.some(([team, s]) => team === 'DEN' && s === 2025));

  const y2025 = card.seasons.find((s) => s.season === 2025);
  const week5 = y2025.weeks.find((w) => w.week === 5);
  // The played week still ships 'actual' with points, not 'bye'.
  assert.equal(week5.kind, 'actual');
  assert.equal(week5.opponent, 'LV');
  assert.ok(week5.points > 0);

  // A log row prefers its OWN stats.gameOpponent ('DEN') over the derived
  // KC schedule's own week-6 opponent ('SF') - the bars use the schedule.
  const logWeek6 = y2025.log.find((w) => w.week === 6);
  assert.equal(logWeek6.opponent, 'DEN');
  const week6Bar = y2025.weeks.find((w) => w.week === 6);
  assert.equal(week6Bar.opponent, 'SF');
});

// ---------------------------------------------------------------------------
// #1667: the one read carries line, weather, usage (by side) and opponents
// ---------------------------------------------------------------------------

test('getPlayerCard: IDP usage reads the defense snap keys, not the offense ones (#1667)', async (t) => {
  const league = { ...LEAGUE, current_week: 5 };
  const lb = { ...PLAYER, id: 61, position: 'LB' };
  createFakePool([
    [/^SELECT "week" FROM "nfl_games"/, () => ({ rows: [{ week: 4 }] })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "player_id"/, () => ({
      rows: [{ week: 4, stats: {
        gameTeam: 'BUF', usageDefenseSnaps: 60, usageDefenseSnapPct: 0.9, usageOffenseSnaps: 3, usageOffenseSnapPct: 0.05,
      } }],
    })],
    [/^SELECT "week", "stats" FROM "player_stats" WHERE "season"/, () => ({ rows: [] })],
    ...buildHandlers({ league, player: lb }),
  ]).install(t);
  mockServices(t, { realUsage: true });

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: lb.id });

  assert.equal(card.decision.usage.weeks[0].snaps, 60);
  assert.equal(card.decision.usage.weeks[0].snapShare, 0.9);
});

test('getPlayerCard: a free agent gets line, weather, usage and opponents (#1667)', async (t) => {
  const league = { ...LEAGUE, current_week: 5 };
  decisionCardContextService.clearLeagueContextMemo();
  createFakePool([
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [{ week: 5, opponent: 'DAL' }] })],
    [/^SELECT "game_key", "roof", "home_away" FROM "nfl_games"/, () => ({
      rows: [{ game_key: '2026_05_BUF_DAL', roof: 'outdoors', home_away: 'away' }],
    })],
    [/^SELECT "total", "spread", "observed_at" FROM "game_odds_snapshots"/, () => ({
      rows: [{ total: '47.00', spread: '-3.00', observed_at: '2026-10-01T12:00:00.000Z' }],
    })],
    [/^SELECT "temperature_f".*FROM "game_weather_snapshots"/, () => ({
      rows: [{ temperature_f: '45.5', wind_speed_mph: '10', wind_gust_mph: '18', precipitation_probability: 20, short_forecast: 'Cloudy' }],
    })],
    [/FROM "player_stats" "ps"/, () => ({
      rows: [{ player_id: 21, week: 1, position: 'WR', defense: 'DAL', stats: { receivingYards: 150 } }],
    })],
    [/COUNT\(\*\)::int AS "games"/, () => ({ rows: [{ team: 'DAL', games: 4 }] })],
    ...buildHandlers({ league }),
  ]).install(t);
  mockServices(t);
  t.mock.method(decisionCardContextService, 'loadUsage', async () => ({ weeks: [], seasonAverage: null }));

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  assert.equal(card.availability.state, 'free_agent');
  assert.equal(card.line.total, 47);
  assert.equal(card.line.impliedTeamTotal, 22);
  assert.equal(card.weather.temperatureF, 45.5);
  assert.deepEqual(card.decision.usage, { weeks: [], seasonAverage: null });
  assert.equal(card.opponents.length, 1);
  assert.equal(card.opponents[0].opponent, 'DAL');
});

test('getPlayerCard: opponents cover the next three weeks, binding [week, week + 2] (#1667)', async (t) => {
  const league = { ...LEAGUE, current_week: 5 };
  decisionCardContextService.clearLeagueContextMemo();
  const fake = createFakePool([
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({
      rows: [{ week: 5, opponent: 'DAL' }, { week: 6, opponent: 'NYG' }, { week: 7, opponent: 'DAL' }],
    })],
    [/FROM "player_stats" "ps"/, () => ({
      rows: [
        { player_id: 21, week: 1, position: 'WR', defense: 'DAL', stats: { receivingYards: 150 } },
        { player_id: 23, week: 1, position: 'WR', defense: 'NYG', stats: { receivingYards: 20 } },
      ],
    })],
    [/COUNT\(\*\)::int AS "games"/, () => ({ rows: [{ team: 'DAL', games: 4 }, { team: 'NYG', games: 4 }] })],
    ...buildHandlers({ league }),
  ]);
  fake.install(t);
  mockServices(t);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: PLAYER.id });

  const windowCall = fake.calls.find((c) => /^SELECT "week", "opponent" FROM "nfl_games" WHERE "season" = \$1 AND "week" >= \$2/.test(c.text));
  assert.deepEqual(windowCall.params, [2026, 5, 7, 'BUF']);
  assert.deepEqual(card.opponents.map((o) => [o.week, o.opponent, o.rankVsPosition]), [
    [5, 'DAL', 1], [6, 'NYG', 2], [7, 'DAL', 1],
  ]);
});

/** A memo fixture: counts season scans, with one game in the window. */
function memoFixture(t, { league = { ...LEAGUE, current_week: 5 } } = {}) {
  decisionCardContextService.clearLeagueContextMemo();
  const fake = createFakePool([
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [{ week: 5, opponent: 'DAL' }] })],
    [/FROM "player_stats" "ps"/, () => ({
      rows: [{ player_id: 21, week: 1, position: 'WR', defense: 'DAL', stats: { receivingYards: 150 } }],
    })],
    [/COUNT\(\*\)::int AS "games"/, () => ({ rows: [{ team: 'DAL', games: 4 }] })],
    [/^SELECT \* FROM "players" WHERE "id" = \$1$/, (text, params) => ({
      rows: [{ ...PLAYER, id: params[0], position: params[0] === 99 ? 'RB' : 'WR' }],
    })],
    ...buildHandlers({ league }),
  ]);
  fake.install(t);
  mockServices(t);
  const scans = () => fake.calls.filter((c) => /FROM "player_stats" "ps"/.test(c.text)).length;
  return { scans };
}

test('getPlayerCard: two reads at one position, league and week run the season scan once; another position runs it again (#1667)', async (t) => {
  const { scans } = memoFixture(t);

  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });
  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 56 });
  assert.equal(scans(), 1);

  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 99 });
  assert.equal(scans(), 2);
});

test('getPlayerCard: a read after the ten-minute lifetime runs the season scan again (#1667)', async (t) => {
  const { scans } = memoFixture(t);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);

  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });
  now += decisionCardContextService.LEAGUE_CONTEXT_TTL_MS - 1;
  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 56 });
  assert.equal(scans(), 1);

  now += 2;
  await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });
  assert.equal(scans(), 2);
});
