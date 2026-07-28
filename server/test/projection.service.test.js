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
    if (text.includes('FROM "nfl_games"') && text.includes('"week" < $2')) return { rows: priorSchedule };
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
    priorSchedule: Array.from({ length: 5 }, (_, i) => ({ week: i + 1, team_key: 'BUF', opponent_key: 'NYJ', home_away: 'home' })),
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
