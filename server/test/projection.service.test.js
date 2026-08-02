const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const projection = require('../services/projection.service');
const features = require('../services/projectionFeatures');
const model = require('../services/projectionModel');
const { SCORING_PRESETS, SCORING_RULES } = require('../services/scoring.service');

/**
 * These tests drive the real engine against a mocked `pool`, so the SQL the
 * engine actually issues (the input-cutoff filter, the batched reads, the
 * versioned cache lookup) is part of what is under test rather than something
 * re-implemented in the test file.
 */

const SEASON = 2026;

/** A league row; `scoring_rules` null means the app defaults (half-PPR). */
const league = (scoringRules = null, id = 1) => ({ id, scoring_rules: scoringRules, best_ball: false });

const player = (id, position, overrides = {}) => ({
  id,
  name: `p${id}`,
  position,
  nfl_team: 'BUF',
  team_key: 'BUF',
  injury_status: null,
  injury_detail: null,
  adp: null,
  ...overrides,
});

const weeklyRow = (playerId, week, stats, season = SEASON) => ({
  player_id: playerId, season, week, stats,
});

/**
 * Dispatch pool.query by SQL fragment. Every table the engine touches has an
 * entry, so an unexpected query fails loudly instead of silently returning
 * empty rows and making a broken feature look like a missing-data case.
 */
function mockPool(t, {
  players = [],
  weeklyStats = [],
  seasonStats = [],
  targetSchedule = [],
  priorSchedule = [],
  leagueScan = [],
  defenseGames = [],
  byeRows = [],
  runRow = null,
  cachedRows = [],
  onQuery = null,
} = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    calls.push({ text, params });
    if (onQuery) onQuery(text, params);
    if (text.includes('FROM "projection_runs"')) return { rows: runRow ? [runRow] : [] };
    if (text.includes('INSERT INTO "projection_runs"')) {
      return { rows: [{ id: 99, generated_at: new Date('2026-09-10T00:00:00Z'), input_cutoff: params[4] }] };
    }
    if (text.includes('FROM "player_week_projections"')) return { rows: cachedRows };
    if (text.includes('INSERT INTO "player_week_projections"')) return { rows: [], rowCount: 1 };
    if (text.includes('FROM "players" WHERE "id" = ANY')) return { rows: players };
    if (text.includes('FROM "player_season_stats"')) return { rows: seasonStats };
    if (text.includes('FROM "player_stats" "ps"')) return { rows: leagueScan };
    if (text.includes('FROM "player_stats"')) return { rows: weeklyStats };
    if (text.includes('COUNT(*)::int AS "games"')) return { rows: defenseGames };
    if (text.includes('JOIN unnest(')) return { rows: byeRows };
    if (text.includes('FROM "nfl_games"') && text.includes('"week" = $2')) return { rows: targetSchedule };
    // The completed-week schedule read spans the whole history window, so it is
    // the one bounded by "season" >= $1 rather than by a bare week comparison.
    if (text.includes('FROM "nfl_games"') && text.includes('"season" >= $1')) return { rows: priorSchedule };
    if (text.includes('FROM "game_weather_snapshots"')) return { rows: [] };
    throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  });
  return calls;
}

const run = (options) =>
  projection.getWeeklyProjections({ weatherService: false, ...options });

// ---------------------------------------------------------------------------
// Baseline, fallbacks, and the "missing is not zero" rule
// ---------------------------------------------------------------------------

test('Week 1 veteran falls back to prior-season production instead of an empty map', async (t) => {
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [], // nothing played yet this season
    seasonStats: [{
      player_id: 1, season: 2025, games_played: 16,
      stats: { rushingYards: 1280, rushingTDs: 8, receptions: 40, receivingYards: 300 },
      fantasy_points: null,
    }],
  });

  const result = await run({ season: SEASON, week: 1, league: league(), playerIds: [1] });
  const projected = result.projections.get(1);
  assert.ok(projected.mean > 0, 'a veteran must project in Week 1');
  assert.equal(projected.sampleSize, 0);
  assert.equal(projected.factors.recentProduction.usedPriorSeason, true);
  assert.equal(projected.confidence, 'low', 'prior-season-only evidence is not a strong sample');
});

test('a player with no history at all projects null, never zero', async (t) => {
  mockPool(t, { players: [player(1, 'WR')], weeklyStats: [], seasonStats: [] });

  const result = await run({ season: SEASON, week: 1, league: league(), playerIds: [1] });
  const projected = result.projections.get(1);
  assert.equal(projected.mean, null);
  assert.equal(projected.median, null);
  assert.equal(projected.unavailableReason, 'no evidence');
  assert.equal(projected.confidence, 'low');

  const legacy = projection.toLegacyProjectionMap(result);
  assert.equal(legacy.get(1).points, null, 'the legacy adapter must not invent a 0');
  assert.equal(legacy.get(1).source, 'unavailable');
});

// ---------------------------------------------------------------------------
// League scoring
// ---------------------------------------------------------------------------

test('league scoring rules can change the ORDER of two players', async (t) => {
  // A possession receiver (lots of catches, modest yards) against a deep
  // threat (few catches, big yards). PPR should flip them.
  const possession = Array.from({ length: 4 }, (_, i) =>
    weeklyRow(1, i + 1, { receptions: 10, receivingYards: 70 }));
  const deep = Array.from({ length: 4 }, (_, i) =>
    weeklyRow(2, i + 1, { receptions: 3, receivingYards: 110 }));
  const setup = () => ({
    players: [player(1, 'WR'), player(2, 'WR')],
    weeklyStats: [...possession, ...deep],
    seasonStats: [],
  });

  mockPool(t, setup());
  const standard = await run({
    season: SEASON, week: 5, league: league(SCORING_PRESETS.standard), playerIds: [1, 2],
  });
  t.mock.restoreAll();

  mockPool(t, setup());
  const ppr = await run({
    season: SEASON, week: 5, league: league(SCORING_PRESETS.ppr, 2), playerIds: [1, 2],
  });

  assert.ok(
    standard.projections.get(2).mean > standard.projections.get(1).mean,
    'standard scoring favors the deep threat'
  );
  assert.ok(
    ppr.projections.get(1).mean > ppr.projections.get(2).mean,
    'full PPR favors the possession receiver'
  );
  assert.notEqual(standard.scoringHash, ppr.scoringHash);
});

test('IDP production is priced under the league IDP rules, not the defaults', async (t) => {
  const stats = { soloTackle: 8, assistedTackle: 4, idpSack: 1 };
  const setup = () => ({
    players: [player(1, 'ILB')],
    weeklyStats: Array.from({ length: 4 }, (_, i) => weeklyRow(1, i + 1, stats)),
    seasonStats: [],
  });

  mockPool(t, setup());
  const base = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });
  t.mock.restoreAll();

  mockPool(t, setup());
  const bigTackleLeague = await run({
    season: SEASON, week: 5, league: league({ idp: { soloTackle: 3 } }, 2), playerIds: [1],
  });

  // 8 solo tackles at 1 -> 3 points each is +16 per game before any factor.
  assert.ok(
    bigTackleLeague.projections.get(1).mean > base.projections.get(1).mean + 15,
    'tripling the solo-tackle rate must move an IDP projection'
  );
});

test('team-defense tier scoring is applied per game under the league rules', async (t) => {
  const stats = { sack: 3, interceptionReturn: 1, pointsAllowed: 10, yardsAllowed: 280 };
  const setup = () => ({
    players: [player(1, 'DEF', { nfl_team: 'Buffalo Bills', team_key: 'BUF' })],
    weeklyStats: Array.from({ length: 4 }, (_, i) => weeklyRow(1, i + 1, stats)),
    seasonStats: [],
  });

  mockPool(t, setup());
  const base = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });
  t.mock.restoreAll();

  mockPool(t, setup());
  const generous = await run({
    season: SEASON,
    week: 5,
    league: league({ teamDefense: { pointsAllowed: [{ min: 0, max: 13, points: 20 }, { min: 14, max: null, points: 0 }] } }, 2),
    playerIds: [1],
  });

  assert.ok(generous.projections.get(1).mean > base.projections.get(1).mean + 10);
});

// ---------------------------------------------------------------------------
// Input cutoff
// ---------------------------------------------------------------------------

test('the stats query can only ever select weeks before the target week', async (t) => {
  let statsParams = null;
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [weeklyRow(1, 3, { rushingYards: 80, rushingTDs: 1 })],
    onQuery: (text, params) => {
      if (text.includes('FROM "player_stats"') && !text.includes('"ps"')) statsParams = { text, params };
    },
  });

  await run({ season: SEASON, week: 7, league: league(), playerIds: [1] });
  assert.ok(statsParams, 'the engine must read prior weekly stats');
  assert.match(statsParams.text, /"season" < \$3 OR \("season" = \$3 AND "week" < \$4\)/);
  assert.deepEqual(statsParams.params.slice(2), [SEASON, 7]);
});

test('a future stat row leaking into the feature set is a hard error, not a silent leak', async (t) => {
  mockPool(t, {
    players: [player(1, 'RB')],
    // A row for the very week being predicted: this must never be usable.
    weeklyStats: [weeklyRow(1, 7, { rushingYards: 200, rushingTDs: 3 })],
  });

  await assert.rejects(
    () => run({ season: SEASON, week: 7, league: league(), playerIds: [1] }),
    /input cutoff violated/
  );
});

test('the widened schedule read spans earlier seasons but never the target week', async (t) => {
  let scheduleQuery = null;
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [weeklyRow(1, 3, { rushingYards: 80 })],
    onQuery: (text, params) => {
      if (text.includes('FROM "nfl_games"') && text.includes('"season" >= $1')) {
        scheduleQuery = { text, params };
      }
    },
  });

  await run({ season: SEASON, week: 7, league: league(), playerIds: [1] });
  assert.ok(scheduleQuery, 'the engine must read the completed-week schedule');
  // Same cutoff clause the stats query uses, so the window can be widened
  // backwards without a second, weaker spelling of "before week W".
  assert.match(scheduleQuery.text, /"season" < \$2 OR \("season" = \$2 AND "week" < \$3\)/);
  assert.deepEqual(
    scheduleQuery.params,
    [SEASON - features.HISTORY_SEASONS, SEASON, 7],
    'the window starts at the history horizon and stops strictly before week 7'
  );
});

test('the opponent scan and defense-game counts are also limited to earlier weeks', async (t) => {
  const seen = [];
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [weeklyRow(1, 1, { rushingYards: 60 })],
    onQuery: (text, params) => {
      if (text.includes('FROM "player_stats" "ps"')) seen.push({ kind: 'scan', params });
      if (text.includes('COUNT(*)::int AS "games"')) seen.push({ kind: 'defense', params });
    },
  });

  await run({ season: SEASON, week: 6, league: league(), playerIds: [1] });
  const scan = seen.find((s) => s.kind === 'scan');
  assert.deepEqual(scan.params.slice(0, 2), [SEASON, 6], 'scan is bounded by week < 6');
});

test('the league scan orders deterministically BEFORE its LIMIT', async (t) => {
  // The scan's row order is not cosmetic: it becomes the pooled residual array,
  // and simulateDistribution samples residuals by index. Postgres promises no
  // order without an ORDER BY, so an unordered LIMIT makes both WHICH rows
  // survive truncation and WHAT ORDER they arrive in a property of the query
  // plan. Two identical databases could then serve two different medians.
  let scanSql = null;
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [weeklyRow(1, 1, { rushingYards: 60 })],
    onQuery: (text) => {
      if (text.includes('FROM "player_stats" "ps"')) scanSql = text;
    },
  });

  await run({ season: SEASON, week: 6, league: league(), playerIds: [1] });

  assert.ok(scanSql, 'the league scan ran');
  const orderAt = scanSql.indexOf('ORDER BY');
  const limitAt = scanSql.indexOf('LIMIT');
  assert.notEqual(orderAt, -1, 'the scan must carry an ORDER BY');
  assert.notEqual(limitAt, -1, 'the scan is still bounded');
  assert.ok(orderAt < limitAt, 'ORDER BY must precede LIMIT or the limit truncates an arbitrary subset');
  // The exact key, not merely "some ordering": (player_id, week) is a unique
  // key of this scan, so it is a TOTAL order. Ordering by week alone would
  // leave players within a week free to permute, which is the same bug.
  assert.match(
    scanSql.slice(orderAt, limitAt),
    /ORDER BY\s+"ps"\."player_id",\s*"ps"\."week"/,
    'ordering must be total, not just by week'
  );
});

// ---------------------------------------------------------------------------
// Opponent / schedule factors through the full engine
// ---------------------------------------------------------------------------

test('a soft opponent raises the projection and appears in the explanation', async (t) => {
  const target = [
    { team_key: 'BUF', opponent_key: 'NYJ', nfl_team: 'BUF', opponent: 'NYJ', kickoff_at: '2026-10-11T17:00:00Z', game_key: '2026_06_NYJ_BUF', home_away: 'home', roof: 'outdoors', latitude: null, longitude: null },
  ];
  // Five weeks of results, in which every RB torched NYJ and nobody else.
  const leagueScan = [];
  for (let week = 1; week <= 5; week++) {
    leagueScan.push({ player_id: 1, week, stats: { rushingYards: 90, rushingTDs: 1 }, position: 'RB', defense: 'NYJ', home_away: 'home' });
    leagueScan.push({ player_id: 2, week, stats: { rushingYards: 20 }, position: 'RB', defense: 'MIA', home_away: 'away' });
  }
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: Array.from({ length: 5 }, (_, i) => weeklyRow(1, i + 1, { rushingYards: 60, rushingTDs: 0 })),
    targetSchedule: target,
    priorSchedule: Array.from({ length: 5 }, (_, i) => ({ season: SEASON, week: i + 1, team_key: 'BUF', opponent_key: 'NYJ', home_away: 'home' })),
    leagueScan,
    defenseGames: [{ team: 'NYJ', games: 5 }, { team: 'MIA', games: 5 }],
  });

  const result = await run({ season: SEASON, week: 6, league: league(), playerIds: [1] });
  const factors = result.projections.get(1).factors;
  assert.equal(factors.opponent.available, true);
  assert.equal(factors.opponent.opponentTeam, 'NYJ');
  assert.ok(factors.opponent.pointsContribution > 0);
  assert.ok(
    factors.opponent.effect <= model.MODEL_CONSTANTS.opponent.maxEffect,
    'the opponent effect stays capped even against an extreme sample'
  );
});

test('home/away stays neutral while the schedule carries no orientation', async (t) => {
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: Array.from({ length: 4 }, (_, i) => weeklyRow(1, i + 1, { rushingYards: 70 })),
    // Existing nfl_games rows predate the game-context columns: home_away null.
    targetSchedule: [{ team_key: 'BUF', opponent_key: 'NYJ', home_away: null, kickoff_at: '2026-10-11T17:00:00Z', game_key: null, roof: null, latitude: null, longitude: null }],
  });

  const result = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });
  const homeAway = result.projections.get(1).factors.homeAway;
  assert.equal(homeAway.available, false);
  assert.equal(homeAway.pointsContribution, null, 'unknown must not render as an evaluated zero');
  // This is the branch every live projection takes, and the exact payload it
  // has always carried. A change here is a change to every cached factor blob
  // in production for a factor that did not move.
  assert.equal(homeAway.reason, 'home/away unknown');
});

// ---------------------------------------------------------------------------
// Neutral-site games
// ---------------------------------------------------------------------------

test('scheduleOrientation reads a neutral-site game as having no orientation', () => {
  // nflverse designates a nominal home team for London and Munich too, so the
  // bare home_away read would price a crowd that was never there. Kills the
  // "trust home_away on its own" mutant.
  assert.equal(features.scheduleOrientation({ home_away: 'home', neutral_site: true }), null);
  assert.equal(features.scheduleOrientation({ home_away: 'away', neutral_site: true }), null);
  // null is UNKNOWN, and unknown is not neutral: this is the shape of every
  // production row today, and it has to keep resolving exactly as it did.
  assert.equal(features.scheduleOrientation({ home_away: 'home', neutral_site: null }), true);
  assert.equal(features.scheduleOrientation({ home_away: 'away', neutral_site: null }), false);
  assert.equal(features.scheduleOrientation({ home_away: 'home', neutral_site: false }), true);
  assert.equal(features.scheduleOrientation({ home_away: 'away', neutral_site: false }), false);
  assert.equal(features.scheduleOrientation({ home_away: null, neutral_site: false }), null);
  assert.equal(features.scheduleOrientation(null), null);
});

test('a neutral-site target game reports unknown orientation, not the nominal home side', async (t) => {
  // One mock, one mutable schedule row: the engine re-reads it on every run, so
  // the three cases differ in exactly one column and nothing else.
  const targetSchedule = [{
    team_key: 'BUF', opponent_key: 'NYJ', home_away: 'home', neutral_site: null,
    kickoff_at: '2026-10-11T17:00:00Z', game_key: '2026_05_NYJ_BUF', roof: null,
    latitude: null, longitude: null,
  }];
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: Array.from({ length: 4 }, (_, i) => weeklyRow(1, i + 1, { rushingYards: 70 })),
    targetSchedule,
  });
  const factorFor = async (neutralSite) => {
    targetSchedule[0].neutral_site = neutralSite;
    const result = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });
    return result.projections.get(1).factors.homeAway;
  };

  // The two reason strings are what makes this test discriminating: a neutral
  // game must land in "we do not know which side you are on", NOT in the gate.
  // Kills the "ignore neutral_site" mutant, which would report 'home/away
  // gated off' here because orientation would have resolved to home.
  assert.equal((await factorFor(true)).reason, 'home/away unknown');
  assert.equal((await factorFor(false)).reason, 'home/away gated off');
  assert.equal((await factorFor(null)).reason, 'home/away gated off');
  for (const neutral of [true, false, null]) {
    const factor = await factorFor(neutral);
    assert.equal(factor.available, false, `neutral_site=${neutral}`);
    assert.equal(factor.pointsContribution, null, `neutral_site=${neutral}`);
  }
});

test('neutral rows leave the home/away sample but stay in every other aggregate', () => {
  // One neutral blowout, deliberately far from the rest: if it leaked into a
  // side it would drag that side's mean visibly, and if it were dropped
  // outright the baseline and the residual pool would move too. Both mutants
  // are caught by the same fixture.
  const rows = [
    { player_id: 1, week: 1, position: 'RB', stats: { rushingYards: 100 }, defense: 'NYJ', home_away: 'home', neutral_site: false },
    { player_id: 1, week: 2, position: 'RB', stats: { rushingYards: 20 }, defense: 'MIA', home_away: 'away', neutral_site: null },
    { player_id: 1, week: 3, position: 'RB', stats: { rushingYards: 600 }, defense: 'NE', home_away: 'home', neutral_site: true },
  ];
  const context = features.buildLeagueContext({
    rows,
    rules: SCORING_RULES,
    defenseGamesByTeam: new Map([['NYJ', 1], ['MIA', 1], ['NE', 1]]),
  }).get('RB');

  assert.equal(context.homeAway.homeGames, 1, 'the neutral game is not a home game');
  assert.equal(context.homeAway.awayGames, 1);
  assert.equal(context.homeAway.homeMean, 10, 'the 60-point neutral blowout never touched the home side');
  assert.equal(context.homeAway.awayMean, 2);
  // Everything that is indifferent to WHERE the game was played still counts
  // it: the position baseline, the defense's allowance and the residual pool.
  assert.equal(context.playerGames, 3);
  assert.equal(context.baselinePerGame, (10 + 2 + 60) / 3);
  assert.deepEqual(context.allowedByDefense.get('NE'), { allowedPerGame: 60, games: 1 });
  assert.equal(context.residuals.length, 3, 'a neutral game still contributes dispersion');
});

test('both schedule reads carry neutral_site out of the database', () => {
  // A column that is not SELECTed arrives as undefined, and undefined is not
  // true, so dropping either one would silently restore the nominal-home
  // reading with every guard above still passing. Kills the "forgot the
  // column" mutant at the only place it can be caught: the SQL text.
  const sql = String(features.loadFeatureBundle);
  // The league scan is the only query that aliases nfl_games as "ng".
  assert.match(sql, /"ng"\."neutral_site"/, 'the league scan must select neutral_site');
  // The prior-schedule read is the one bounded by "season" >= $1.
  const priorAt = sql.indexOf('"season" >= $1');
  assert.notEqual(priorAt, -1, 'the prior-schedule read is still there');
  const priorSelectAt = sql.lastIndexOf('SELECT', priorAt);
  assert.match(
    sql.slice(priorSelectAt, priorAt),
    /"home_away", "neutral_site"/,
    'the prior-schedule read must select neutral_site alongside home_away'
  );
});

test('a neutral prior-season game resolves an opponent but no orientation', async (t) => {
  // The orientation map is inert today (homeAway.useStoredHistory ships false),
  // so this asserts on the MAP the bundle builds rather than on a projection.
  // WHO he faced survives a neutral site; WHERE does not.
  mockPool(t, {
    players: [player(1, 'RB')],
    priorSchedule: [
      { season: SEASON, week: 1, team_key: 'BUF', opponent_key: 'NYJ', home_away: 'home', neutral_site: true },
      { season: SEASON, week: 2, team_key: 'BUF', opponent_key: 'MIA', home_away: 'away', neutral_site: null },
      { season: SEASON, week: 3, team_key: 'BUF', opponent_key: 'NE', home_away: 'home', neutral_site: false },
    ],
  });

  const bundle = await features.loadFeatureBundle({
    season: SEASON, week: 5, playerIds: [1], rules: SCORING_RULES,
  });
  assert.deepEqual(bundle.opponentByTeamWeek.get(`${SEASON}:1:BUF`), { opponent: 'NYJ', isHome: null });
  assert.deepEqual(bundle.opponentByTeamWeek.get(`${SEASON}:2:BUF`), { opponent: 'MIA', isHome: false });
  assert.deepEqual(bundle.opponentByTeamWeek.get(`${SEASON}:3:BUF`), { opponent: 'NE', isHome: true });
});

// ---------------------------------------------------------------------------
// Usage / opportunity features
// ---------------------------------------------------------------------------

test('buildPriorGames carries usage counts through, preserving null as null and 0 as 0', () => {
  const games = features.buildPriorGames({
    statRows: [
      // Enriched: an explicit 0 is a real measurement and must survive.
      { season: SEASON, week: 1, stats: { rushingYards: 50, usageCarries: 0, usageTargets: 4, usagePassAttempts: null } },
      // Pre-enrichment: the keys simply are not there.
      { season: SEASON, week: 2, stats: { rushingYards: 40 } },
      // Junk that a naive Number() would turn into a confident zero.
      { season: SEASON, week: 3, stats: { rushingYards: 60, usageCarries: '', usageTargets: false, usagePassAttempts: 'x' } },
      // A QB line: attempts present, no touch counts at all.
      { season: SEASON, week: 4, stats: { passingYards: 250, usagePassAttempts: 31 } },
    ],
    rules: SCORING_RULES,
    season: SEASON,
    week: 5,
    opponentByTeamWeek: new Map(),
    playerTeam: 'BUF',
  });
  // Newest first: week 4 is one week ago, week 1 is four.
  const byWeek = new Map(games.map((g) => [g.week, g]));
  assert.deepEqual(byWeek.get(1).usage, { passAttempts: null, carries: 0, targets: 4 });
  assert.deepEqual(byWeek.get(2).usage, { passAttempts: null, carries: null, targets: null });
  assert.deepEqual(byWeek.get(3).usage, { passAttempts: null, carries: null, targets: null },
    'empty string, false and non-numeric text are missing, never zero');
  assert.deepEqual(byWeek.get(4).usage, { passAttempts: 31, carries: null, targets: null });
  // The 0 really is distinguishable from the absence, which is the whole point.
  assert.notEqual(byWeek.get(1).usage.carries, byWeek.get(2).usage.carries);
  assert.equal(model.opportunitiesForGame(byWeek.get(1).usage, 'RB'), 4);
  assert.equal(model.opportunitiesForGame(byWeek.get(2).usage, 'RB'), null);
});

// ---------------------------------------------------------------------------
// Stored per-week game context (gameTeam / gameOpponent)
// ---------------------------------------------------------------------------

/**
 * The two flags that gate reading the backfilled per-week team keys. Both ship
 * false, so every combination below is a hypothetical the code has to answer
 * for before the sweep decides which, if any, to turn on.
 */
const historyConstants = ({ crossSeason = false, useStoredHistory = false } = {}) => ({
  ...model.MODEL_CONSTANTS,
  versusOpponent: { ...model.MODEL_CONSTANTS.versusOpponent, crossSeason },
  homeAway: { ...model.MODEL_CONSTANTS.homeAway, useStoredHistory },
});

const FLAG_COMBINATIONS = [
  { crossSeason: false, useStoredHistory: false },
  { crossSeason: true, useStoredHistory: false },
  { crossSeason: false, useStoredHistory: true },
  { crossSeason: true, useStoredHistory: true },
];

/** A schedule map shaped exactly as loadFeatureBundle builds it. */
const scheduleMap = (rows) => new Map(rows.map((r) => [
  `${r.season}:${r.week}:${r.team}`,
  { opponent: r.opponent, isHome: r.isHome },
]));

const priorGamesFor = (statRows, opponentByTeamWeek, flags, overrides = {}) =>
  features.buildPriorGames({
    statRows,
    rules: SCORING_RULES,
    season: SEASON,
    week: 5,
    opponentByTeamWeek,
    playerTeam: 'BUF',
    constants: historyConstants(flags),
    ...overrides,
  });

test('both stored-history gates ship off', () => {
  assert.equal(model.MODEL_CONSTANTS.versusOpponent.crossSeason, false);
  assert.equal(model.MODEL_CONSTANTS.homeAway.useStoredHistory, false);
});

test('with both gates off, stored per-week team keys change nothing', () => {
  // Enriched rows in BOTH seasons, and a schedule that could resolve every one
  // of them: the point is that the shipped configuration declines to look.
  const statRows = [
    { season: SEASON, week: 1, stats: { rushingYards: 50, gameTeam: 'BUF', gameOpponent: 'NYJ' } },
    { season: SEASON - 1, week: 9, stats: { rushingYards: 70, gameTeam: 'MIA', gameOpponent: 'NE' } },
  ];
  const schedule = scheduleMap([
    { season: SEASON, week: 1, team: 'BUF', opponent: 'NYJ', isHome: true },
    { season: SEASON - 1, week: 9, team: 'MIA', opponent: 'NE', isHome: false },
  ]);

  const games = priorGamesFor(statRows, schedule, {});
  const byKey = new Map(games.map((g) => [`${g.season}:${g.week}`, g]));
  // Pre-change behavior, spelled out rather than diffed against a copy of the
  // old code: the current season resolves through the player's team, and a
  // prior season is simply unknown.
  assert.deepEqual(
    { opponent: byKey.get(`${SEASON}:1`).opponent, isHome: byKey.get(`${SEASON}:1`).isHome },
    { opponent: 'NYJ', isHome: true }
  );
  assert.deepEqual(
    { opponent: byKey.get(`${SEASON - 1}:9`).opponent, isHome: byKey.get(`${SEASON - 1}:9`).isHome },
    { opponent: null, isHome: null }
  );
  // And the default-argument path (no constants at all) must agree with it,
  // since that is what the engine calls today.
  const shipped = features.buildPriorGames({
    statRows, rules: SCORING_RULES, season: SEASON, week: 5, opponentByTeamWeek: schedule, playerTeam: 'BUF',
  });
  assert.deepEqual(shipped, games);
});

test('a prior-season row with no stored team stays unknown under every flag combination', () => {
  // The mutant this kills: resolving a prior-season row through the player's
  // CURRENT team, which is a plausible-looking opponent for a game he may not
  // even have played for that franchise.
  const statRows = [{ season: SEASON - 1, week: 4, stats: { rushingYards: 90 } }];
  const schedule = scheduleMap([
    { season: SEASON - 1, week: 4, team: 'BUF', opponent: 'KC', isHome: true },
  ]);
  for (const flags of FLAG_COMBINATIONS) {
    const [game] = priorGamesFor(statRows, schedule, flags);
    assert.equal(game.opponent, null, JSON.stringify(flags));
    assert.equal(game.isHome, null, JSON.stringify(flags));
  }
});

test('a stored prior-season team resolves the opponent and orientation once its gate is on', () => {
  const statRows = [
    { season: SEASON - 1, week: 4, stats: { rushingYards: 90, gameTeam: 'MIA' } },
    { season: SEASON - 1, week: 6, stats: { rushingYards: 40, gameTeam: 'MIA' } },
  ];
  const schedule = scheduleMap([
    { season: SEASON - 1, week: 4, team: 'MIA', opponent: 'KC', isHome: true },
    { season: SEASON - 1, week: 6, team: 'MIA', opponent: 'NYJ', isHome: false },
  ]);

  const orientation = priorGamesFor(statRows, schedule, { useStoredHistory: true });
  const byWeek = new Map(orientation.map((g) => [g.week, g]));
  assert.equal(byWeek.get(4).isHome, true);
  assert.equal(byWeek.get(6).isHome, false, 'away must be false, not merely not-true');
  // The orientation gate says nothing about who he faced, which is the other
  // flag's question: the two arms of the sweep have to stay separable.
  assert.equal(byWeek.get(4).opponent, null);

  const meetings = priorGamesFor(statRows, schedule, { crossSeason: true });
  const byWeekMeetings = new Map(meetings.map((g) => [g.week, g]));
  assert.equal(byWeekMeetings.get(4).opponent, 'KC');
  assert.equal(byWeekMeetings.get(6).opponent, 'NYJ');
  assert.equal(byWeekMeetings.get(4).isHome, null);

  const both = priorGamesFor(statRows, schedule, { crossSeason: true, useStoredHistory: true });
  const byWeekBoth = new Map(both.map((g) => [g.week, g]));
  assert.deepEqual(
    { opponent: byWeekBoth.get(4).opponent, isHome: byWeekBoth.get(4).isHome },
    { opponent: 'KC', isHome: true }
  );
});

test('a stored opponent that contradicts the schedule nulls both fields, at any flag setting', () => {
  // Two records of who he played, disagreeing. Neither is trustworthy, so the
  // assertion is on the NULL: trusting the stored key would give NE, trusting
  // the schedule would give KC, and both of those are mutants this kills.
  const statRows = [
    { season: SEASON - 1, week: 4, stats: { rushingYards: 90, gameTeam: 'MIA', gameOpponent: 'NE' } },
    { season: SEASON, week: 2, stats: { rushingYards: 55, gameTeam: 'BUF', gameOpponent: 'DEN' } },
  ];
  const schedule = scheduleMap([
    { season: SEASON - 1, week: 4, team: 'MIA', opponent: 'KC', isHome: true },
    { season: SEASON, week: 2, team: 'BUF', opponent: 'NYJ', isHome: false },
  ]);

  for (const flags of FLAG_COMBINATIONS) {
    const games = priorGamesFor(statRows, schedule, flags);
    for (const game of games) {
      const where = `${game.season} week ${game.week} @ ${JSON.stringify(flags)}`;
      assert.equal(game.opponent, null, where);
      assert.equal(game.isHome, null, where);
    }
  }
});

test('a contradiction is a real disagreement, not a spelling of one', () => {
  // nflverse writes WAS, the schedule may hold WSH, and fn_normalize_nfl_team
  // folds them together in SQL. Reading the stored key without the same fold
  // would turn every Washington game into a contradiction and silently delete
  // the feature.
  assert.equal(features.normalizeTeamKey('WSH'), features.normalizeTeamKey('WAS'));
  assert.equal(features.normalizeTeamKey('LA'), 'LAR');
  assert.equal(features.normalizeTeamKey('Kansas City Chiefs'), 'KC');
  assert.equal(features.normalizeTeamKey(''), null);
  assert.equal(features.normalizeTeamKey(null), null);

  const [game] = priorGamesFor(
    [{ season: SEASON - 1, week: 4, stats: { rushingYards: 90, gameTeam: 'MIA', gameOpponent: 'WAS' } }],
    scheduleMap([{ season: SEASON - 1, week: 4, team: 'MIA', opponent: 'WSH', isHome: true }]),
    { crossSeason: true, useStoredHistory: true }
  );
  assert.equal(game.opponent, 'WSH', 'the schedule spelling is what the rest of the engine joins on');
  assert.equal(game.isHome, true);
});

test('cross-season meetings enter the head-to-head set only when the gate is on', () => {
  const statRows = [
    { season: SEASON, week: 1, stats: { rushingYards: 100, gameTeam: 'BUF', gameOpponent: 'NYJ' } },
    { season: SEASON, week: 2, stats: { rushingYards: 50, gameTeam: 'BUF', gameOpponent: 'MIA' } },
    { season: SEASON, week: 3, stats: { rushingYards: 70, gameTeam: 'BUF', gameOpponent: 'MIA' } },
    // No schedule row: this week's opponent is unknown either way.
    { season: SEASON, week: 4, stats: { rushingYards: 200 } },
    { season: SEASON - 1, week: 9, stats: { rushingYards: 120, gameTeam: 'BUF', gameOpponent: 'NYJ' } },
  ];
  const schedule = scheduleMap([
    { season: SEASON, week: 1, team: 'BUF', opponent: 'NYJ', isHome: true },
    { season: SEASON, week: 2, team: 'BUF', opponent: 'MIA', isHome: false },
    { season: SEASON, week: 3, team: 'BUF', opponent: 'MIA', isHome: true },
    { season: SEASON - 1, week: 9, team: 'BUF', opponent: 'NYJ', isHome: false },
  ]);
  const pointsFor = (games, season, week) =>
    games.find((g) => g.season === season && g.week === week).points;

  const closed = priorGamesFor(statRows, schedule, {});
  const closedMeetings = features.buildVersusOpponentMeetings({
    priorGames: closed, opponent: 'NYJ', season: SEASON, constants: historyConstants({}),
  });
  assert.equal(closedMeetings.length, 1, 'only this season counts by default');
  assert.deepEqual(closedMeetings.map((m) => m.seasonsAgo), [0]);
  // Baseline excludes the meeting and nothing else, including the week whose
  // opponent is unknown.
  const closedBaseline = (pointsFor(closed, SEASON, 2) + pointsFor(closed, SEASON, 3)
    + pointsFor(closed, SEASON, 4)) / 3;
  assert.ok(Math.abs(closedMeetings[0].baseline - closedBaseline) < 1e-9);

  const open = priorGamesFor(statRows, schedule, { crossSeason: true });
  const openMeetings = features.buildVersusOpponentMeetings({
    priorGames: open, opponent: 'NYJ', season: SEASON, constants: historyConstants({ crossSeason: true }),
  });
  assert.equal(openMeetings.length, 2, 'the prior-season meeting now counts');
  assert.deepEqual(
    openMeetings.map((m) => m.seasonsAgo), [0, 1],
    'seasonsAgo has to survive, or versusOpponentEffect cannot decay the old meeting'
  );
  // The exclusion baseline moved with the pool: opponent-known games only, so
  // the unknown-opponent week 4 drops out of it.
  const openBaseline = (pointsFor(open, SEASON, 2) + pointsFor(open, SEASON, 3)) / 2;
  assert.ok(Math.abs(openMeetings[0].baseline - openBaseline) < 1e-9);
  assert.notEqual(openMeetings[0].baseline, closedMeetings[0].baseline);

  // Default arguments must reproduce the closed set exactly.
  assert.deepEqual(
    features.buildVersusOpponentMeetings({ priorGames: closed, opponent: 'NYJ', season: SEASON }),
    closedMeetings
  );
});

/**
 * The wiring proof for the gates, in the same spirit as the efficiency-prior
 * test below: the flags live in MODEL_CONSTANTS, but they are READ inside the
 * feature builders, so a run's constants have to travel all the way there. A
 * build that dropped the argument would still project happily, just always at
 * the shipped defaults, and every sweep arm would score an identical row while
 * looking like it had been evaluated.
 */
test('the run constants reach both feature builders, not just projectPlayer', async (t) => {
  const seen = { priorGames: [], meetings: [] };
  const realBuildPriorGames = features.buildPriorGames;
  const realBuildMeetings = features.buildVersusOpponentMeetings;
  t.mock.method(features, 'buildPriorGames', (args) => {
    seen.priorGames.push(args);
    return realBuildPriorGames(args);
  });
  t.mock.method(features, 'buildVersusOpponentMeetings', (args) => {
    seen.meetings.push(args);
    return realBuildMeetings(args);
  });
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [1, 2, 3].map((week) => weeklyRow(1, week, {
      rushingYards: 60, gameTeam: 'BUF', gameOpponent: 'NYJ',
    })),
    targetSchedule: [{
      team_key: 'BUF', opponent_key: 'NYJ', nfl_team: 'BUF', opponent: 'NYJ',
      kickoff_at: '2026-10-11T17:00:00Z', game_key: null, home_away: 'home', roof: null,
      latitude: null, longitude: null,
    }],
    priorSchedule: [1, 2, 3].map((week) => ({
      season: SEASON, week, team_key: 'BUF', opponent_key: 'NYJ', home_away: 'home',
    })),
  });
  const generate = (modelConstants) => projection.generateProjections({
    season: SEASON, week: 5, rules: SCORING_RULES, playerIds: [1],
    hashValue: 'h', weatherService: false, modelConstants,
  });

  await generate(undefined);
  assert.equal(seen.priorGames.at(-1).constants, model.MODEL_CONSTANTS,
    'a run with no override must build features under the shipped constants');
  assert.equal(seen.meetings.at(-1).constants, model.MODEL_CONSTANTS);

  const swept = historyConstants({ crossSeason: true, useStoredHistory: true });
  await generate(swept);
  assert.equal(seen.priorGames.at(-1).constants, swept,
    'a swept arm that never reaches buildPriorGames is an arm that was never evaluated');
  assert.equal(seen.meetings.at(-1).constants, swept);
});

// ---------------------------------------------------------------------------
// onPreHomeAwayBaseline (PHASE5_EXECUTION_SPEC.md section 6.5): full
// threading through generateProjections -> projectFromBundle -> projectPlayer
// ---------------------------------------------------------------------------

test('onPreHomeAwayBaseline threads unchanged from generateProjections through to projectPlayer', async (t) => {
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [1, 2, 3].map((week) => weeklyRow(1, week, {
      rushingYards: 60, gameTeam: 'BUF', gameOpponent: 'NYJ',
    })),
    targetSchedule: [{
      team_key: 'BUF', opponent_key: 'NYJ', nfl_team: 'BUF', opponent: 'NYJ',
      kickoff_at: '2026-10-11T17:00:00Z', game_key: null, home_away: 'home', roof: null,
      latitude: null, longitude: null,
    }],
    priorSchedule: [1, 2, 3].map((week) => ({
      season: SEASON, week, team_key: 'BUF', opponent_key: 'NYJ', home_away: 'home',
    })),
  });
  const calls = [];
  const result = await projection.generateProjections({
    season: SEASON, week: 5, rules: SCORING_RULES, playerIds: [1],
    hashValue: 'h', weatherService: false,
    onPreHomeAwayBaseline: (args) => calls.push(args),
  });
  assert.equal(calls.length, 1, 'exactly one qualifying player-week reached the semantic point');
  assert.equal(calls[0].playerId, 1);
  assert.equal(Number.isFinite(calls[0].baseline), true);
  assert.ok(result.projections.get(1).mean > 0, 'the projection is otherwise unaffected by the seam existing');

  // An empty playerIds list still validates the type, before the (empty) loop.
  await assert.rejects(
    projection.generateProjections({
      season: SEASON, week: 5, rules: SCORING_RULES, playerIds: [],
      hashValue: 'h', weatherService: false, onPreHomeAwayBaseline: 'nope',
    }),
    /onPreHomeAwayBaseline must be undefined or a function/
  );

  // Every production call site omits the parameter, so behavior for them is unchanged.
  const unaffected = await projection.generateProjections({
    season: SEASON, week: 5, rules: SCORING_RULES, playerIds: [1], hashValue: 'h', weatherService: false,
  });
  assert.equal(unaffected.projections.get(1).mean, result.projections.get(1).mean);
});

test('projectFromBundle validates onPreHomeAwayBaseline before its own !player early return, and never invokes it there', () => {
  const bundle = {
    players: new Map(), leagueContext: new Map(), priorStatsByPlayer: new Map(),
    opponentByTeamWeek: new Map(), targetGames: new Map(), byeByTeam: new Map(),
    seasonRowsByPlayer: new Map(),
  };
  assert.throws(
    () => projection.projectFromBundle({
      playerId: 999, bundle, rules: SCORING_RULES, season: SEASON, week: 5, hashValue: 'h',
      onPreHomeAwayBaseline: 'nope',
    }),
    /onPreHomeAwayBaseline must be undefined or a function/
  );
  const calls = [];
  const result = projection.projectFromBundle({
    playerId: 999, bundle, rules: SCORING_RULES, season: SEASON, week: 5, hashValue: 'h',
    onPreHomeAwayBaseline: (args) => calls.push(args),
  });
  assert.equal(result.unavailableReason, 'unknown player');
  assert.equal(calls.length, 0, 'the !player early return never reaches the semantic point');
});

/**
 * And the same wiring end to end, with no builder mocked: a prior-season
 * meeting has to be able to change a FACTOR, which is the only reason the
 * `xseason-vs` sweep arm is worth running. Shipped constants must leave that
 * factor exactly where it was before the stored keys existed.
 */
test('a cross-season meeting reaches the head-to-head factor only under the swept constants', async (t) => {
  const setup = () => ({
    players: [player(1, 'RB')],
    weeklyStats: [
      weeklyRow(1, 1, { rushingYards: 100, gameTeam: 'BUF', gameOpponent: 'NYJ' }),
      weeklyRow(1, 2, { rushingYards: 60, gameTeam: 'BUF', gameOpponent: 'MIA' }),
      weeklyRow(1, 3, { rushingYards: 55, gameTeam: 'BUF', gameOpponent: 'NE' }),
      weeklyRow(1, 9, { rushingYards: 120, gameTeam: 'BUF', gameOpponent: 'NYJ' }, SEASON - 1),
    ],
    targetSchedule: [{
      team_key: 'BUF', opponent_key: 'NYJ', nfl_team: 'BUF', opponent: 'NYJ',
      kickoff_at: '2026-10-11T17:00:00Z', game_key: null, home_away: 'home', roof: null,
      latitude: null, longitude: null,
    }],
    priorSchedule: [
      { season: SEASON, week: 1, team_key: 'BUF', opponent_key: 'NYJ', home_away: 'home' },
      { season: SEASON, week: 2, team_key: 'BUF', opponent_key: 'MIA', home_away: 'away' },
      { season: SEASON, week: 3, team_key: 'BUF', opponent_key: 'NE', home_away: 'home' },
      { season: SEASON - 1, week: 9, team_key: 'BUF', opponent_key: 'NYJ', home_away: 'away' },
    ],
  });
  const generate = (modelConstants) => projection.generateProjections({
    season: SEASON, week: 5, rules: SCORING_RULES, playerIds: [1],
    hashValue: 'h', weatherService: false, modelConstants,
  });

  mockPool(t, setup());
  const shipped = await generate(model.MODEL_CONSTANTS);
  const sweptRun = await generate(historyConstants({ crossSeason: true }));

  const shippedFactor = shipped.projections.get(1).factors.versusOpponent;
  const sweptFactor = sweptRun.projections.get(1).factors.versusOpponent;
  // One current-season meeting is below minMeetings, so the shipped engine has
  // no head-to-head factor here at all, exactly as before this phase.
  assert.equal(shippedFactor.available, false);
  assert.equal(shippedFactor.meetings, 1);
  assert.equal(shippedFactor.pointsContribution, null);
  // The prior-season meeting, resolved through the stored per-week team, is the
  // second one.
  assert.equal(sweptFactor.available, true);
  assert.equal(sweptFactor.meetings, 2);
  assert.notEqual(shipped.projections.get(1).mean, sweptRun.projections.get(1).mean);
});

test('buildLeagueContext derives points per opportunity from the rows that have both halves', () => {
  const context = features.buildLeagueContext({
    rows: [
      // 100 rushing yards = 10 points on 15 + 5 = 20 opportunities.
      { player_id: 1, week: 1, position: 'RB', stats: { rushingYards: 100, usageCarries: 15, usageTargets: 5 }, defense: 'NYJ', home_away: 'home' },
      // 200 rushing yards = 20 points on 20 + 0 = 20 opportunities.
      { player_id: 2, week: 1, position: 'RB', stats: { rushingYards: 200, usageCarries: 20, usageTargets: 0 }, defense: 'MIA', home_away: 'away' },
      // Half-known: excluded from BOTH sides of the ratio, so its 50 points
      // cannot inflate the rate against the other rows' opportunities.
      { player_id: 3, week: 1, position: 'RB', stats: { rushingYards: 500, usageTargets: 6 }, defense: 'BUF', home_away: 'home' },
    ],
    rules: SCORING_RULES,
    defenseGamesByTeam: new Map(),
  });
  const rb = context.get('RB');
  assert.equal(rb.opportunityGames, 2);
  assert.equal(rb.efficiencyPerOpportunity, 30 / 40, '(10 + 20) points over (20 + 20) opportunities');
  // The points-per-GAME baseline still sees all three rows: the opportunity
  // gate narrows the efficiency rate, not the rest of the context.
  assert.equal(rb.playerGames, 3);
});

test('buildLeagueContext reports no efficiency at all when no row qualifies', () => {
  const context = features.buildLeagueContext({
    rows: [
      // A pre-enrichment database: real rows, no usage keys anywhere.
      { player_id: 1, week: 1, position: 'WR', stats: { receivingYards: 90, receptions: 6 }, defense: 'NYJ', home_away: 'home' },
      // Groups with no opportunity denominator, stray keys and all.
      { player_id: 2, week: 1, position: 'K', stats: { extraPoint: 3, fieldGoalDistances: [42], usageCarries: 4, usageTargets: 4 }, defense: 'MIA', home_away: 'away' },
      { player_id: 3, week: 1, position: 'DEF', stats: { sack: 4, usageCarries: 2, usageTargets: 2 }, defense: 'BUF', home_away: 'home' },
    ],
    rules: SCORING_RULES,
    defenseGamesByTeam: new Map(),
  });
  for (const group of ['WR', 'K', 'DEF']) {
    assert.equal(context.get(group).efficiencyPerOpportunity, null, `${group} must report no rate, not 0`);
    assert.equal(context.get(group).opportunityGames, 0);
    assert.ok(context.get(group).baselinePerGame > 0, `${group} still has a points baseline`);
  }
});

test('the shipped engine prices enriched usage and leaves bare rows on the points baseline', async (t) => {
  // Steady 17 touches a week, but wildly varying yardage on them. That is the
  // case the component exists for: the volume is the stable signal and the
  // efficiency is the noise, so the two estimators cannot agree and the blend
  // has something to do. (A perfectly flat fixture would make them identical
  // and this test would prove nothing.)
  const yards = { 1: 30, 2: 50, 3: 70, 4: 110 };
  const setup = (enriched) => ({
    players: [player(1, 'RB')],
    weeklyStats: [1, 2, 3, 4].map((week) => weeklyRow(1, week, enriched
      ? { rushingYards: yards[week], rushingTDs: 0, usageCarries: 14, usageTargets: 3 }
      : { rushingYards: yards[week], rushingTDs: 0 })),
  });

  mockPool(t, setup(true));
  const withUsage = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });
  t.mock.restoreAll();
  mockPool(t, setup(false));
  const withoutUsage = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });

  const enrichedProjection = withUsage.projections.get(1);
  const bareProjection = withoutUsage.projections.get(1);
  const enrichedRecent = enrichedProjection.factors.recentProduction;
  const bareRecent = bareProjection.factors.recentProduction;

  assert.equal(model.MODEL_CONSTANTS.usage.blendWeight, 0.25, 'the component ships enabled at v3');
  // Enriched: the component fires end to end, through the real feature builder.
  assert.equal(enrichedRecent.usageBlendWeight, 0.25);
  assert.equal(enrichedRecent.usageGames, 4, 'all four stored weeks carry both halves');
  assert.equal(enrichedRecent.expectedOpportunities, 17, '14 carries plus 3 targets, every week');
  assert.notEqual(enrichedProjection.mean, bareProjection.mean);

  // Bare: an un-enriched row is NOT blended against a fabricated stand-in. It
  // keeps the points baseline whole, which is the property that lets v3 ship
  // against a partially enriched table.
  assert.equal(bareRecent.opportunityValue, null);
  assert.equal(bareRecent.usageGames, 0);
  assert.equal(bareRecent.usageBlendWeight, 0, 'no opportunities means no weight applied');
  assert.equal(bareRecent.perGame, bareRecent.pointsBaselinePerGame);

  // Both still report the same evidence: the blend changes the estimate, not
  // the sample behind it.
  for (const field of ['sampleSize', 'effectiveGames', 'confidence']) {
    assert.equal(enrichedProjection[field], bareProjection[field], field);
  }
  // Usage keys are ALSO role signal (projectionFeatures.ROLE_KEYS), which
  // predates this component: that is why the bare row has no role factor.
  assert.equal(enrichedProjection.factors.role.available, true);
  assert.equal(bareProjection.factors.role, null);
});

/**
 * The wiring proof: the league-context efficiency prior must genuinely reach
 * `opportunityBaseline`. If it were dropped somewhere between
 * buildLeagueContext and projectPlayer the component would still produce a
 * number, just an unshrunk one, and no other test here would notice.
 *
 * Also the backtest's contract, from the other direction: `modelConstants`
 * alone has to be able to turn the component back OFF, which is the arm every
 * usage-* config was compared against.
 */
test('the league efficiency prior reaches the component, and modelConstants can switch it off', async (t) => {
  const weeklyStats = [1, 2, 3, 4, 5].map((week) =>
    weeklyRow(1, week, { rushingYards: 60, rushingTDs: 0, usageCarries: 14, usageTargets: 3 }));
  // Two league backdrops that differ ONLY in how efficient everyone else is:
  // 10 points per 20 touches against 10 points per 5 touches.
  const scan = (touches) => Array.from({ length: 5 }, (_, i) => ({
    player_id: 2, week: i + 1, position: 'RB',
    stats: { rushingYards: 100, usageCarries: touches, usageTargets: 0 },
    defense: 'MIA', home_away: 'away',
  }));
  const setup = (touches) => ({
    players: [player(1, 'RB')],
    weeklyStats,
    leagueScan: scan(touches),
    defenseGames: [{ team: 'MIA', games: 5 }],
  });
  const withUsage = (weight) => ({
    ...model.MODEL_CONSTANTS,
    usage: { ...model.MODEL_CONSTANTS.usage, blendWeight: weight },
  });
  const generate = (modelConstants) => projection.generateProjections({
    season: SEASON, week: 6, rules: SCORING_RULES, playerIds: [1],
    hashValue: 'h', weatherService: false, modelConstants,
  });

  mockPool(t, setup(20));
  const offInefficientLeague = await generate(withUsage(0));
  const onInefficientLeague = await generate(model.MODEL_CONSTANTS);
  t.mock.restoreAll();
  mockPool(t, setup(5));
  const offEfficientLeague = await generate(withUsage(0));
  const onEfficientLeague = await generate(model.MODEL_CONSTANTS);

  const meanOf = (result) => result.projections.get(1).mean;
  const recent = (result) => result.projections.get(1).factors.recentProduction;

  // Switched off by an override: the league's efficiency becomes irrelevant,
  // because nothing consults it, and the explanation says nothing about it.
  assert.equal(meanOf(offInefficientLeague), meanOf(offEfficientLeague));
  assert.equal('opportunityValue' in recent(offEfficientLeague), false);

  // Shipped: the component fires, and the prior it shrinks toward is the one
  // the scan produced, so a more efficient league moves the projection up.
  assert.equal(recent(onEfficientLeague).usageBlendWeight, 0.25);
  assert.equal(recent(onEfficientLeague).usageGames, 5, 'all five enriched weeks carry opportunities');
  assert.equal(recent(onEfficientLeague).expectedOpportunities, 17, '14 carries plus 3 targets, every week');
  assert.notEqual(meanOf(onEfficientLeague), meanOf(offEfficientLeague), 'the blend must move the number');
  assert.ok(
    recent(onEfficientLeague).opportunityEfficiency > recent(onInefficientLeague).opportunityEfficiency,
    'the league efficiency prior is not reaching opportunityBaseline: ' +
    `${recent(onEfficientLeague).opportunityEfficiency} vs ${recent(onInefficientLeague).opportunityEfficiency}`
  );
  assert.ok(meanOf(onEfficientLeague) > meanOf(onInefficientLeague));
});

// ---------------------------------------------------------------------------
// Cache correctness
// ---------------------------------------------------------------------------

test('a run generated for another scoring profile is never reused', async (t) => {
  const lookups = [];
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [weeklyRow(1, 1, { rushingYards: 70 })],
    onQuery: (text, params) => {
      if (text.includes('FROM "projection_runs"')) lookups.push(params);
    },
  });

  await run({ season: SEASON, week: 5, league: league(SCORING_PRESETS.standard), playerIds: [1] });
  await run({ season: SEASON, week: 5, league: league(SCORING_PRESETS.ppr, 2), playerIds: [1] });

  assert.equal(lookups.length, 2);
  assert.notEqual(lookups[0][2], lookups[1][2], 'the scoring hash is part of the cache key');
  assert.equal(lookups[0][3], model.MODEL_VERSION, 'so is the model version');
});

test('the shipped model version is exactly free_baseline_v3.1', () => {
  // Pinned in the service too, not only in the model: this is the string the
  // cache key is built from, and the service re-exports it to callers.
  assert.equal(model.MODEL_VERSION, 'free_baseline_v3.1');
  assert.equal(projection.MODEL_VERSION, 'free_baseline_v3.1');
  assert.notEqual(model.MODEL_VERSION, 'free_baseline_v3', 'v3 rows were drawn from unordered residuals');
});

test('a v3 cached run cannot satisfy a v3.1 lookup', async (t) => {
  // v3 rows sampled their residuals in whatever order Postgres returned them,
  // so their medians and quantiles are numbers this code will not necessarily
  // reproduce. Serving one would be serving a different model under the
  // current model's name.
  const lookups = [];
  let regenerated = false;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "projection_runs"')) {
      lookups.push(params);
      // The database still holds a v3 run for this exact (season, week, hash).
      const stale = { id: 7, input_cutoff: new Date(), source_coverage: {}, generated_at: new Date() };
      return { rows: params[3] === 'free_baseline_v3' ? [stale] : [] };
    }
    if (text.includes('INSERT INTO "projection_runs"')) {
      return { rows: [{ id: 8, generated_at: new Date(), input_cutoff: params[4] }] };
    }
    if (text.includes('FROM "player_week_projections"')) {
      throw new Error('a v3.1 request must never read v3 child rows');
    }
    if (text.includes('INSERT INTO "player_week_projections"')) return { rows: [], rowCount: 1 };
    if (text.includes('FROM "players" WHERE "id" = ANY')) {
      regenerated = true;
      return { rows: [player(1, 'RB')] };
    }
    if (text.includes('FROM "player_season_stats"')) return { rows: [] };
    if (text.includes('FROM "player_stats" "ps"')) return { rows: [] };
    if (text.includes('FROM "player_stats"')) return { rows: [weeklyRow(1, 1, { rushingYards: 70 })] };
    if (text.includes('COUNT(*)::int AS "games"')) return { rows: [] };
    if (text.includes('JOIN unnest(')) return { rows: [] };
    if (text.includes('FROM "nfl_games"')) return { rows: [] };
    if (text.includes('FROM "game_weather_snapshots"')) return { rows: [] };
    throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  });

  const result = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });

  assert.equal(lookups.length, 1);
  assert.equal(lookups[0][3], 'free_baseline_v3.1', 'the lookup asks for the CURRENT version');
  assert.equal(regenerated, true, 'the stale v3 run must be ignored and the week regenerated');
  assert.equal(result.projections.get(1).cached, undefined, 'nothing was served from the v3 cache');
  assert.equal(result.projections.get(1).modelVersion, 'free_baseline_v3.1');
});

test('one cached row is NOT a cache hit for a multi-player request', async (t) => {
  let generated = false;
  mockPool(t, {
    players: [player(1, 'RB'), player(2, 'WR')],
    weeklyStats: [
      weeklyRow(1, 1, { rushingYards: 70 }),
      weeklyRow(2, 1, { receivingYards: 80, receptions: 5 }),
    ],
    runRow: { id: 42, input_cutoff: new Date(), source_coverage: {}, generated_at: new Date() },
    // Only player 1 is cached; player 2's row is missing entirely.
    cachedRows: [{
      player_id: 1, mean: '11.00', median: '11.00', p10: '4.00', p25: '8.00', p75: '14.00',
      p90: '18.00', active_probability: '1.000', confidence: 'medium', sample_size: 4, factors: {},
    }],
    onQuery: (text) => {
      if (text.includes('FROM "players" WHERE "id" = ANY')) generated = true;
    },
  });

  const result = await run({ season: SEASON, week: 5, league: league(), playerIds: [1, 2] });
  assert.equal(generated, true, 'the partial run must be completed, not returned partial');
  assert.equal(result.projections.size, 2);
  assert.equal(result.projections.get(1).cached, true, 'the cached player is reused as-is');
  assert.ok(result.projections.has(2));
});

test('a complete cached run is served without regenerating anything', async (t) => {
  let touchedPlayers = false;
  mockPool(t, {
    players: [player(1, 'RB')],
    runRow: { id: 42, input_cutoff: new Date('2026-10-11T17:00:00Z'), source_coverage: { weather: { status: 'unavailable' } }, generated_at: new Date('2026-10-08T00:00:00Z') },
    cachedRows: [{
      player_id: 1, mean: '11.00', median: '11.50', p10: '4.00', p25: '8.00', p75: '14.00',
      p90: '18.00', active_probability: '1.000', confidence: 'high', sample_size: 6, factors: { opponent: { available: true } },
    }],
    onQuery: (text) => {
      if (text.includes('FROM "players" WHERE "id" = ANY')) touchedPlayers = true;
    },
  });

  const result = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });
  assert.equal(touchedPlayers, false);
  assert.equal(result.projections.get(1).median, 11.5);
  assert.equal(result.sourceCoverage.weather.status, 'unavailable');
});

test('refresh regenerates even when a complete run exists', async (t) => {
  let touchedPlayers = false;
  mockPool(t, {
    players: [player(1, 'RB')],
    weeklyStats: [weeklyRow(1, 1, { rushingYards: 70 })],
    runRow: { id: 42, input_cutoff: new Date(), source_coverage: {}, generated_at: new Date() },
    cachedRows: [{
      player_id: 1, mean: '1.00', median: '1.00', p10: null, p25: null, p75: null,
      p90: null, active_probability: '1.000', confidence: 'low', sample_size: 1, factors: {},
    }],
    onQuery: (text) => {
      if (text.includes('FROM "players" WHERE "id" = ANY')) touchedPlayers = true;
    },
  });

  await run({ season: SEASON, week: 5, league: league(), playerIds: [1], refresh: true });
  assert.equal(touchedPlayers, true);
});

// ---------------------------------------------------------------------------
// Batching and determinism
// ---------------------------------------------------------------------------

test('a 12-player request is batched, not one query per player', async (t) => {
  const ids = Array.from({ length: 12 }, (_, i) => i + 1);
  const calls = mockPool(t, {
    players: ids.map((id) => player(id, 'RB')),
    weeklyStats: ids.flatMap((id) => [weeklyRow(id, 1, { rushingYards: 50 + id })]),
  });

  await run({ season: SEASON, week: 5, league: league(), playerIds: ids });

  const statsReads = calls.filter(
    (c) => c.text.includes('FROM "player_stats"') && !c.text.includes('"ps"')
  );
  const writes = calls.filter((c) => c.text.includes('INSERT INTO "player_week_projections"'));
  assert.equal(statsReads.length, 1, 'one batched stats read for the whole roster');
  assert.equal(writes.length, 1, 'one batched cache write for the whole roster');
  assert.ok(calls.length < ids.length, `expected fewer queries than players, got ${calls.length}`);
});

test('the same request twice produces identical numbers', async (t) => {
  const setup = () => ({
    players: [player(1, 'RB')],
    weeklyStats: [
      weeklyRow(1, 1, { rushingYards: 70, rushingTDs: 1 }),
      weeklyRow(1, 2, { rushingYards: 45 }),
      weeklyRow(1, 3, { rushingYards: 110, rushingTDs: 2 }),
      weeklyRow(1, 4, { rushingYards: 30 }),
    ],
  });
  mockPool(t, setup());
  const first = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });
  t.mock.restoreAll();
  mockPool(t, setup());
  const second = await run({ season: SEASON, week: 5, league: league(), playerIds: [1] });

  assert.deepEqual(first.projections.get(1), second.projections.get(1));
});

test('an empty player list short-circuits without touching the database', async (t) => {
  const calls = mockPool(t, {});
  const result = await run({ season: SEASON, week: 5, league: league(), playerIds: [] });
  assert.equal(calls.length, 0);
  assert.equal(result.projections.size, 0);
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

test('getWeekProjections without a league keeps the original pool-wide behavior', async (t) => {
  const calls = mockPool(t, {});
  t.mock.restoreAll();
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    calls.push({ text });
    if (text.includes('FROM "player_projections"')) {
      return { rows: [{ player_id: 5, projected_points: '12.34', source: 'extrapolated' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const result = await projection.getWeekProjections({ season: SEASON, week: 5 });
  assert.deepEqual([...result], [[5, { points: 12.34, source: 'extrapolated' }]]);
  assert.equal(
    calls.some((c) => c.text.includes('projection_runs')),
    false,
    'legacy callers must not be routed through the new engine'
  );
});

test('toLegacyProjectionMap keeps the { points, source } contract and adds fields', () => {
  const legacy = projection.toLegacyProjectionMap({
    modelVersion: model.MODEL_VERSION,
    generatedAt: '2026-10-08T00:00:00.000Z',
    inputCutoff: '2026-10-11T17:00:00.000Z',
    projections: new Map([
      [1, { playerId: 1, mean: 12.2, median: 11.8, confidence: 'high', activeProbability: 1, factors: {} }],
      [2, { playerId: 2, mean: null, median: null, confidence: 'low', activeProbability: null, factors: {} }],
    ]),
  });
  assert.equal(legacy.get(1).points, 11.8, 'the median is the headline number');
  assert.equal(legacy.get(1).source, model.MODEL_VERSION);
  assert.equal(legacy.get(1).confidence, 'high');
  assert.equal(legacy.get(2).points, null);
  assert.equal(legacy.get(2).source, 'unavailable');
});

// ---------------------------------------------------------------------------
// Cache invalidation after a stat correction
// ---------------------------------------------------------------------------

/**
 * A fake client that ACTUALLY APPLIES the delete predicate to an in-memory
 * table. It reads the `"column" <op> $n` pairs (`=` and `>=`) out of the
 * statement's WHERE clause and matches rows against the corresponding
 * parameters, so dropping or weakening a condition really does delete the
 * wrong rows here rather than merely changing a string this test would have
 * to know the exact spelling of. A statement with no WHERE at all matches
 * every row, which is precisely the mutant worth catching.
 */
function fakeRunStore(rows) {
  const table = rows.map((r) => ({ ...r }));
  const statements = [];
  return {
    table,
    statements,
    async query(sql, params = []) {
      const text = String(sql);
      statements.push({ text, params });
      assert.match(text, /DELETE FROM "projection_runs"/, 'the helper deletes runs, not something else');
      const whereAt = text.indexOf('WHERE');
      const where = whereAt === -1 ? '' : text.slice(whereAt);
      const conditions = [...where.matchAll(/"(\w+)"\s*(>=|=)\s*\$(\d+)/g)].map(([, column, op, index]) => ({
        column,
        op,
        value: params[Number(index) - 1],
      }));
      const matches = (row, c) => (c.op === '>='
        ? Number(row[c.column]) >= Number(c.value)
        : String(row[c.column]) === String(c.value));
      const survivors = table.filter((row) => !conditions.every((c) => matches(row, c)));
      const rowCount = table.length - survivors.length;
      table.length = 0;
      table.push(...survivors);
      return { rowCount, rows: [] };
    },
  };
}

const runRowFor = (season, week, hash, version = model.MODEL_VERSION) =>
  ({ season, week, scoring_hash: hash, model_version: version });

test('invalidation clears every scoring profile from the stale week onward, and nothing else', async () => {
  const store = fakeRunStore([
    // Target: fromWeek and later, current model, three different scoring hashes.
    runRowFor(2026, 4, 'hash-half-ppr'),
    runRowFor(2026, 4, 'hash-standard'),
    runRowFor(2026, 4, 'hash-idp'),
    // ALSO targets: later weeks. The advice API caches arbitrary future weeks
    // (only past-week EDITS are rejected), so a run for week 7 requested before
    // the correction is exactly as stale as week 4's and must not survive it.
    runRowFor(2026, 5, 'hash-half-ppr'),
    runRowFor(2026, 7, 'hash-standard'),
    // Must survive: the corrected week and earlier (their inputs predate the
    // correction), another season, an older model.
    runRowFor(2026, 3, 'hash-half-ppr'),
    runRowFor(2025, 4, 'hash-half-ppr'),
    runRowFor(2026, 4, 'hash-half-ppr', 'free_baseline_v2.2'),
  ]);

  const out = await projection.invalidateWeeklyProjectionRuns({
    season: 2026, fromWeek: 4, client: store,
  });

  assert.equal(out.deletedRuns, 5, 'every profile for the stale week AND every later week');
  assert.equal(out.season, 2026);
  assert.equal(out.fromWeek, 4);
  assert.equal(out.modelVersion, model.MODEL_VERSION);
  assert.deepEqual(
    store.table.map((r) => `${r.season}:${r.week}:${r.scoring_hash}:${r.model_version}`).sort(),
    [
      '2025:4:hash-half-ppr:free_baseline_v3.1',
      '2026:3:hash-half-ppr:free_baseline_v3.1',
      '2026:4:hash-half-ppr:free_baseline_v2.2',
    ],
    'earlier weeks, other seasons and other model versions are untouched'
  );
});

test('invalidation is one parameterized statement that leans on ON DELETE CASCADE', async () => {
  const store = fakeRunStore([runRowFor(2026, 4, 'hash-a')]);
  await projection.invalidateWeeklyProjectionRuns({ season: 2026, fromWeek: 4, client: store });

  assert.equal(store.statements.length, 1, 'one indexed delete, not a per-profile loop');
  const { text, params } = store.statements[0];
  assert.deepEqual(params, [2026, 4, model.MODEL_VERSION], 'season, fromWeek and model version, in order');
  assert.match(
    text, /"week"\s*>=\s*\$2/,
    'the week predicate must be >= — an exact match would let stale future-week runs survive'
  );
  assert.equal(text.includes('2026'), false, 'values are bound, never interpolated into the SQL');
  assert.equal(text.includes('scoring_hash'), false, 'the hash is deliberately NOT in the predicate');
  // Child rows go through the schema's ON DELETE CASCADE. Deleting them here
  // instead would be a second statement that could silently drift out of sync
  // with the parent predicate.
  assert.equal(
    text.includes('player_week_projections'), false,
    'children must cascade, not be deleted separately'
  );
});

test('invalidation defaults to the shipped model version but accepts an explicit one', async () => {
  const store = fakeRunStore([
    runRowFor(2026, 4, 'hash-a'),
    runRowFor(2026, 4, 'hash-a-old', 'free_baseline_v3'),
  ]);

  const current = await projection.invalidateWeeklyProjectionRuns({ season: 2026, fromWeek: 4, client: store });
  assert.equal(current.deletedRuns, 1, 'the default scope is the CURRENT model only');
  assert.equal(store.statements[0].params[2], 'free_baseline_v3.1');

  const older = await projection.invalidateWeeklyProjectionRuns({
    season: 2026, fromWeek: 4, modelVersion: 'free_baseline_v3', client: store,
  });
  assert.equal(older.deletedRuns, 1, 'an explicit version reaches the predicate');
  assert.equal(store.table.length, 0);
});

test('invalidation reports zero rather than throwing when there is nothing cached', async () => {
  const store = fakeRunStore([]);
  const out = await projection.invalidateWeeklyProjectionRuns({ season: 2026, fromWeek: 9, client: store });
  assert.equal(out.deletedRuns, 0);
});

test('invalidation uses the injected client and never the ambient pool', async (t) => {
  t.mock.method(pool, 'query', async () => {
    throw new Error('the injected client must be used');
  });
  const store = fakeRunStore([runRowFor(2026, 4, 'hash-a')]);
  const out = await projection.invalidateWeeklyProjectionRuns({ season: 2026, fromWeek: 4, client: store });
  assert.equal(out.deletedRuns, 1);
});
