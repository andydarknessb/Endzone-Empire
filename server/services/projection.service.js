const pool = require('../modules/pool');
const model = require('./projectionModel');
// The Pool projection accessor (#1705) lives in its own pure module; re-exported below.
const { poolPointsFor, poolPointsMap } = require('./poolProjection');
const { unavailableFor: verdictFor, startVerdictOf } = require('./unavailable');
const { loadNflRosterStatusById, nflRosterStatusColumn } = require('./nflRosterStatus');
const { computeByeWeeks } = require('./bye.service');
const { normalizeNflTeam } = require('./nflTeam');
const features = require('./projectionFeatures');
const { rulesForLeague, SCORING_RULES, calculateFantasyPoints, hasTeamDefenseTiers } = require('./scoringRules');
const { lastPlayoffWeek } = require('./season.service');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
const { expertCoverage, getExpertProvider } = require('./expertProjection.provider');
const {
  vegasCoverage, getVegasOddsProvider, impliedTeamPoints,
  // Aliased on import: `projectFromBundle` takes a PARAMETER named
  // `slateAverageImplied` (the computed value for the week), and letting the
  // function and the value share a name inside one module is how someone
  // later calls the wrong one.
  slateAverageImplied: computeSlateAverageImplied,
} = require('./vegasOdds.provider');

/**
 * The stored Availability input (`factors.availability`; ADR 0061) and the
 * verdict behind the Start verdict, from one set of facts. Lineup lock left the
 * verdict, but the stored field keeps the `locked: false, lockedSlot: null` keys
 * it has always carried: the holdout ledger captures the whole `factors` JSON
 * (ADR 0044) and the reconcilers compare stored against fresh, so the shape
 * does not move. Besides the engine's model default, only this module calls `unavailable.js`.
 */
function unavailableFor(facts) {
  return { ...verdictFor(facts), locked: false, lockedSlot: null };
}

class ProjectionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * The `league` a public reader hands `getWeeklyProjections` when it has none
 * by design: standard scoring, no league scope. Passed explicitly so an
 * omitted league stays a refusal rather than a silent standard-rules price.
 */
const PUBLIC = Symbol('PUBLIC');

/**
 * Weekly point projections, the substrate for start/sit advice, the trade
 * analyzer, waiver rankings, and the Monte Carlo simulator.
 *
 * TWO producers live here, and they are not interchangeable:
 *
 * 1. `getWeekProjections` — the ORIGINAL pool-wide extrapolator: a player's
 *    projection is the average of his played weeks' stored `fantasy_points`,
 *    under DEFAULT scoring, cached in `player_projections`. Trade, waiver,
 *    matchup, public-ranking and Monte Carlo consumers all read it, they read
 *    it for the whole NFL player pool at once, and none of them passes a
 *    league. It is preserved verbatim so this change moves none of their
 *    numbers.
 *
 * 2. `getWeeklyProjections` — `free_baseline_v2`: a league-scoring-aware,
 *    explainable, distributional projection for a SPECIFIC set of players
 *    (a roster, not the pool). Recency-weighted recent production shrunk
 *    toward prior-season and positional baselines, adjusted by shrunk and
 *    capped opponent / head-to-head / home-away factors, with a deterministic
 *    bootstrap interval and a per-factor explanation. Cached in
 *    `projection_runs` + `player_week_projections`, keyed by the league's
 *    scoring hash AND the model version, so one league's numbers can never be
 *    served to a league that scores the same stat line differently.
 *
 * Rest of season is a third, separate horizon, and it too has two
 * producers: `getRestOfSeasonProjections` stays on the original pool-wide
 * extrapolator (a flat weekly value x remaining weeks), and `getRestOfSeason`
 * (#1305) is its v2 twin — it sums a SPECIFIC set of players' already-cached
 * `free_baseline_v2` Weekly projections from a league's current week through
 * its last playoff week, the same cache `getWeeklyProjections` reads and
 * fills, so a week the nightly projection run (server/modules/scheduler.js)
 * already generated is never regenerated here.
 */

// ---------------------------------------------------------------------------
// Legacy producer (unchanged behavior)
// ---------------------------------------------------------------------------

/** Pure: average of played weeks' points, rounded to 2dp. Empty -> 0. */
function extrapolateWeekly(pointsByWeek) {
  const played = pointsByWeek.filter((p) => Number.isFinite(Number(p)));
  if (played.length === 0) return 0;
  const total = played.reduce((sum, p) => sum + Number(p), 0);
  return Math.round((total / played.length) * 100) / 100;
}

async function getPoolWideProjections({ season, week, refresh = false }) {
  if (!refresh) {
    const cached = await pool.query(
      `SELECT "player_id", "projected_points", "source"
       FROM "player_projections" WHERE "season" = $1 AND "week" = $2`,
      [season, week]
    );
    if (cached.rows.length > 0) {
      return new Map(
        cached.rows.map((r) => [r.player_id, { points: Number(r.projected_points), source: r.source }])
      );
    }
  }

  const statsResult = await pool.query(
    `SELECT "player_id", array_agg("fantasy_points") AS "points"
     FROM "player_stats" WHERE "season" = $1 AND "week" < $2
     GROUP BY "player_id"`,
    [season, week]
  );
  const projections = new Map();
  for (const row of statsResult.rows) {
    projections.set(row.player_id, {
      points: extrapolateWeekly(row.points),
      source: 'extrapolated',
    });
  }

  for (const [playerId, { points, source }] of projections) {
    await pool.query(
      `INSERT INTO "player_projections" ("player_id", "season", "week", "projected_points", "source")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("player_id", "season", "week")
       DO UPDATE SET "projected_points" = EXCLUDED."projected_points",
                     "source" = EXCLUDED."source", "updated_at" = now()`,
      [playerId, season, week, points, source]
    );
  }
  return projections;
}

/**
 * Pool projections for (season, week) as a Map playerId -> { points, source }:
 * the original pool-wide extrapolator, byte-for-byte. A Weekly projection
 * (the engine's per-league run) is read through `getWeeklyProjections` and its
 * result object's accessors, never through this map (#1704 removed the
 * league-scoped branch that used to hand back a legacy map of a run).
 * Passing `league` or `playerIds` throws rather than silently returning
 * default-scoring pool numbers to a caller that expected a league's.
 */
async function getWeekProjections({ season, week, refresh = false, ...rest }) {
  if ('league' in rest || 'playerIds' in rest) {
    throw new TypeError(
      'getWeekProjections is pool-wide only: read a Weekly projection through getWeeklyProjections'
    );
  }
  return getPoolWideProjections({ season, week, refresh });
}

/**
 * Rest-of-season totals: weekly projection x remaining weeks, as a Map
 * playerId -> total. Under extrapolation the weekly value is flat, so this is
 * a multiply — but callers should treat it as opaque so an external feed with
 * true per-week values can slot in.
 */
async function getRestOfSeasonProjections({ season, fromWeek, throughWeek }) {
  const weekly = await getWeekProjections({ season, week: fromWeek });
  const remaining = Math.max(0, throughWeek - fromWeek + 1);
  const totals = new Map();
  for (const [playerId, points] of poolPointsMap(weekly)) {
    totals.set(playerId, Math.round(points * remaining * 100) / 100);
  }
  return totals;
}

/**
 * Projection and season-to-date metrics used by package-level trade analysis.
 * Every requested player is returned, with zeroes for missing stats or
 * projections, so incomplete feeds cannot poison the fairness calculation.
 */
async function getTradeProjectionMetrics({ playerIds, season, fromWeek, throughWeek }) {
  const ids = [...new Set((playerIds || []).filter(Number.isInteger))];
  if (ids.length === 0) return new Map();

  const [weekly, statsResult] = await Promise.all([
    getWeekProjections({ season, week: fromWeek }),
    pool.query(
      `SELECT "player_id",
              COALESCE(SUM("fantasy_points"), 0) AS "season_total_points",
              COALESCE(AVG("fantasy_points"), 0) AS "historical_weekly_average"
       FROM "player_stats"
       WHERE "player_id" = ANY($1::int[])
         AND "season" = $2
         AND "week" < $3
       GROUP BY "player_id"`,
      [ids, season, fromWeek]
    ),
  ]);

  const statsByPlayer = new Map(statsResult.rows.map((row) => [row.player_id, row]));
  const remainingWeeks = Math.max(0, Number(throughWeek) - Number(fromWeek) + 1);
  return new Map(ids.map((playerId) => {
    const perGameProjection = poolPointsFor(weekly, playerId) ?? 0;
    const stats = statsByPlayer.get(playerId) || {};
    const seasonTotalPoints = Number.isFinite(Number(stats.season_total_points))
      ? Number(stats.season_total_points)
      : 0;
    const historicalWeeklyAverage = Number.isFinite(Number(stats.historical_weekly_average))
      ? Number(stats.historical_weekly_average)
      : 0;

    return [playerId, {
      seasonTotalPoints: Math.round(seasonTotalPoints * 100) / 100,
      perGameProjection: Math.round(perGameProjection * 100) / 100,
      historicalWeeklyAverage: Math.round(historicalWeeklyAverage * 100) / 100,
      restOfSeasonValue: Math.round(perGameProjection * remainingWeeks * 100) / 100,
    }];
  }));
}

/**
 * Positional defense: average fantasy points each NFL team has ALLOWED per
 * game to each position this season (weeks < uptoWeek). Map
 * nflTeam -> { QB: avg, RB: avg, ... }. Powers opponent-difficulty context in
 * start/sit. Teams/positions with no data are simply absent — callers treat
 * missing as neutral.
 *
 * The team join normalises through `fn_normalize_nfl_team` on BOTH sides
 * (#287). This one is an INNER join, so the raw comparison it replaces did
 * not produce a wrong value, it DROPPED the row: every DEF unit (stored by
 * full team name) and every WSH-coded week left the aggregate entirely, with
 * no null anywhere to notice, and the average over the survivors read
 * perfectly plausible. The `defense` key is ALSO folded through
 * `fn_normalize_nfl_team` (#1154, Cory's 2026-09-10 ruling): this map's key
 * is a Team code (CONTEXT.md), never the schedule's raw spelling, matching
 * the vocabulary every opponent code carries once it leaves the server
 * (#1136). CONTEXT.md's glossary never sanctioned a raw key here - its Raw
 * team code entry says such a value is "never joined on or keyed by" - so
 * this brings the code into line with the glossary rather than departing
 * from it. `decision.service.startSitAdvice` reads this map directly with
 * its own already-folded opponent value; there is no second fold on the
 * consumer's side. Contrast projectionFeatures.js's `loadFeatureBundle`
 * league scan, whose equivalent `defense` key was already folded into a Team
 * code the same way, because its `allowedByDefense` map (`buildLeagueContext`)
 * is only ever read against keys already folded on the JS side - the two
 * sites are now consistent instead of being the one remaining raw-keyed
 * exception.
 *
 * Folding the GROUP BY key introduces the same exposure the join fold above
 * already lives with: a legacy `WAS` row sitting beside a `WSH` row for one
 * team-week now combines into one bucket where the raw key would have kept
 * them apart. That is the fix, not a new risk - two aliases for the same
 * defense are MEANT to combine into one arithmetically correct average, not
 * to accidentally double one game's points under two spellings. ADR 0011
 * records `nfl_games_season_week_team_code_unique`, a unique index on
 * `(season, week, fn_normalize_nfl_team(nfl_team))` added for #421 to reject
 * that second spelling at insert - this codebase has no standing to confirm
 * the index is live on the shared database (migrations are a carve-out the
 * maintainer applies), so this docblock cites it as recorded in the ADR, not
 * as an applied fact this fold depends on.
 */
async function getPositionDefense({ season, uptoWeek }) {
  const result = await pool.query(
    `SELECT fn_normalize_nfl_team("nfl_games"."opponent") AS "defense",
            "players"."position",
            SUM("player_stats"."fantasy_points") AS "points",
            COUNT(DISTINCT "player_stats"."week") AS "games"
     FROM "player_stats"
     JOIN "players" ON "players"."id" = "player_stats"."player_id"
     JOIN "nfl_games" ON "nfl_games"."season" = "player_stats"."season"
       AND "nfl_games"."week" = "player_stats"."week"
       AND fn_normalize_nfl_team("nfl_games"."nfl_team")
           = fn_normalize_nfl_team("players"."nfl_team")
     WHERE "player_stats"."season" = $1 AND "player_stats"."week" < $2
     GROUP BY fn_normalize_nfl_team("nfl_games"."opponent"), "players"."position"`,
    [season, uptoWeek]
  );
  const defense = new Map();
  for (const row of result.rows) {
    if (!defense.has(row.defense)) defense.set(row.defense, {});
    const games = Number(row.games) || 1;
    defense.get(row.defense)[row.position] =
      Math.round((Number(row.points) / games) * 100) / 100;
  }
  return defense;
}

// ---------------------------------------------------------------------------
// free_baseline_v2
// ---------------------------------------------------------------------------

/**
 * Pure: the player's most recent COMPLETED season's per-game production under
 * `rules`, or null. A DEF unit's season rollup carries per-game tier stats
 * (pointsAllowed/yardsAllowed), which must never be tier-matched as an
 * aggregate — for those we use the stored weekly-summed total instead, the
 * same accepted deviation scoring.service's projectSeasonPoints makes.
 */
function priorSeasonPerGame(seasonRows, rules, season) {
  const lastCompleted = [...(seasonRows || [])]
    .filter((r) => Number(r.season) < Number(season))
    .sort((a, b) => Number(b.season) - Number(a.season))[0];
  if (!lastCompleted) return null;
  const games = Number(lastCompleted.games_played) || 0;
  if (games <= 0) return null;
  const total = hasTeamDefenseTiers(lastCompleted.stats)
    ? Number(lastCompleted.fantasy_points)
    : calculateFantasyPoints(lastCompleted.stats, rules);
  if (!Number.isFinite(total)) return null;
  return total / games;
}

/** Pure: residuals of a player's own prior games around their unweighted mean. */
function playerResidualsFrom(priorGames) {
  const points = (priorGames || []).map((g) => g.points).filter(Number.isFinite);
  if (points.length < 2) return [];
  const mean = points.reduce((s, p) => s + p, 0) / points.length;
  return points.map((p) => p - mean);
}

/**
 * Pure (#1342 Ruling item 1): this opponent's rank within `allowedByDefense`
 * for the player's position group, 1 = the defense allowing the FEWEST points
 * per game (the toughest matchup — so `24th vs WR` reads as a soft one). Ties
 * share the lower rank (standard competition ranking: values [10, 10, 30]
 * rank as [1, 1, 3], never [1, 1, 2]), and `of` is the size of the map, not a
 * count restricted to opponents with enough games. Returns null only when
 * `opponentTeam` has no entry in the map at all, which does not happen on the
 * caller's only call site (it is only ever called after `opponentEffect`
 * already reported `available`, which itself requires that entry to exist).
 */
function rankOpponentDefense(allowedByDefense, opponentTeam) {
  const target = allowedByDefense.get(opponentTeam);
  if (!target) return null;
  const sorted = [...allowedByDefense.values()]
    .map((v) => v.allowedPerGame)
    .sort((a, b) => a - b);
  return { rank: sorted.indexOf(target.allowedPerGame) + 1, of: allowedByDefense.size };
}

/**
 * Assemble one player's projection from an already-loaded feature bundle.
 * Pure with respect to the database: everything it reads comes from `bundle`,
 * which is what lets the backtest script replay it over history and the tests
 * exercise it without a connection.
 */
function projectFromBundle({
  playerId, bundle, rules, season, week, hashValue, weatherByGameKey,
  // Market context, both optional and both defaulting to "nothing was
  // supplied" rather than to a neutral value: see gameEnvironmentEffect and
  // expertConsensusBlend for why the difference matters downstream.
  oddsByGameKey = null, slateAverageImplied = null, expertByPlayerId = null,
  constants = model.MODEL_CONSTANTS,
  modelVersion = model.MODEL_VERSION,
  // Gate 2 sweep seam (PHASE5_EXECUTION_SPEC.md section 6.5), forwarded
  // unchanged to model.projectPlayer. Validated at the top of the function
  // body, before ANY other logic - including before the `!player` early
  // return below, where it is never actually invoked.
  onPreHomeAwayBaseline,
  // This player's NFL roster status (#1767, nflRosterStatus.js), or null,
  // which reads as Active.
  nflRosterStatus = null,
}) {
  if (onPreHomeAwayBaseline !== undefined && typeof onPreHomeAwayBaseline !== 'function') {
    throw new Error('projectFromBundle: onPreHomeAwayBaseline must be undefined or a function');
  }
  const player = bundle.players.get(playerId);
  if (!player) {
    return {
      playerId,
      position: null,
      modelVersion: model.MODEL_VERSION,
      mean: null, median: null, p10: null, p25: null, p75: null, p90: null,
      activeProbability: null,
      confidence: 'low',
      confidenceReasons: ['player not found'],
      sampleSize: 0,
      factors: {},
      unavailableReason: 'unknown player',
    };
  }

  const group = model.positionGroup(player.position);
  const context = group ? bundle.leagueContext.get(group) : null;
  const priorGames = features.buildPriorGames({
    statRows: bundle.priorStatsByPlayer.get(playerId) || [],
    rules,
    season,
    week,
    opponentByTeamWeek: bundle.opponentByTeamWeek,
    playerTeam: player.team_key,
    // The run's constants, not the module defaults: the feature builders read
    // the stored-history gates (versusOpponent.crossSeason,
    // homeAway.useStoredHistory) out of this object, so a sweep that could not
    // reach here would silently score every arm as `default`. Both gates ship
    // false, so at the shipped constants this changes nothing.
    constants,
  });

  const targetGame = bundle.targetGames.get(player.team_key) || null;
  const opponentTeam = targetGame ? targetGame.opponent_key : null;
  const byeWeek = bundle.byeByTeam.get(player.nfl_team) ?? null;
  const onBye = byeWeek != null && Number(byeWeek) === Number(week);

  const allowance = context && opponentTeam ? context.allowedByDefense.get(opponentTeam) : null;
  // #1485: last season's allowance for this group/opponent, seeding the
  // factor through the weeks the current-season scan has not accrued enough
  // games for yet (week 1 has none at all, since `bundle.leagueContext` is
  // only populated for week > 1). `prior` is null whenever the bundle was not
  // built with a prior-season context (e.g. a hand-built test fixture), which
  // opponentEffect treats identically to "no prior season available".
  const prior = group && bundle.priorSeasonContext ? bundle.priorSeasonContext.get(group) : null;
  const priorAllowance = prior && opponentTeam ? prior.allowedByDefense.get(opponentTeam) : null;
  // #1483: the position floor `simulateDistribution` truncates its draws at -
  // the lowest points any player of this group scored, over whichever of the
  // current-season and prior-season scans actually have rows. Both contexts
  // report `minObservedPoints: null` when they saw no rows at all (week 1's
  // current-season context, or a hand-built fixture with no prior context),
  // so this is the minimum of whichever finite values exist, and null when
  // neither does - never a fabricated 0.
  const observedFloors = [context, prior]
    .map((c) => (c ? c.minObservedPoints : null))
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  const positionFloor = observedFloors.length > 0 ? Math.min(...observedFloors) : null;
  const opponent = model.opponentEffect({
    allowedPerGame: allowance ? allowance.allowedPerGame : null,
    leagueAveragePerGame: context ? context.leagueAllowedPerGame : null,
    games: allowance ? allowance.games : 0,
    opponentTeam,
    constants: constants.opponent,
    priorAllowedPerGame: priorAllowance ? priorAllowance.allowedPerGame : null,
    priorLeagueAveragePerGame: prior ? prior.leagueAllowedPerGame : null,
  });
  // #1342 Ruling item 1: rank is a read-side annotation on the opponent Factor
  // the engine already computed, never a second producer. Only an `available`
  // factor is guaranteed a resolvable entry in `allowedByDefense` (opponentEffect
  // itself gates on `games >= constants.minGames`), so a NEUTRAL factor (no
  // opponent data, insufficient sample) carries neither `rank` nor `of`. #1485
  // adds a second reason rank can be unavailable even on an AVAILABLE factor:
  // at week 1 (or any week the seed alone clears minGames) `context` itself is
  // null, since the current-season league scan never ran, so there is no
  // current-season `allowedByDefense` map to rank within at all.
  if (opponent.available && context) {
    const opponentRank = rankOpponentDefense(context.allowedByDefense, opponentTeam);
    if (opponentRank) {
      opponent.rank = opponentRank.rank;
      opponent.of = opponentRank.of;
    }
  }

  const versusOpponent = model.versusOpponentEffect({
    meetings: features.buildVersusOpponentMeetings({
      priorGames, opponent: opponentTeam, season, constants,
    }),
    constants: constants.versusOpponent,
  });

  // Not a bare `home_away` read: a neutral-site game still stores a nominal
  // home team, and pricing that as home-field advantage would be inventing a
  // crowd. features.scheduleOrientation is the single place that judgement
  // lives, so the target game and the historical schedule map cannot drift.
  const isHome = features.scheduleOrientation(targetGame);
  const homeAway = model.homeAwayEffect({
    isHome,
    sample: context ? context.homeAway : null,
    constants: constants.homeAway,
  });

  const forecast = targetGame && targetGame.game_key && weatherByGameKey
    ? weatherByGameKey.get(targetGame.game_key)
    : null;
  const weather = model.weatherEffect({
    forecast: forecast && !forecast.indoor ? forecast : null,
    roof: targetGame ? targetGame.roof : null,
    constants: constants.weather,
  });

  // Market-implied scoring environment. `isHome` is reused rather than
  // re-derived so a neutral-site game resolves the same way here as it does
  // for the home/away factor: the spread is stored home-relative, so reading
  // the wrong side would invert the whole quote.
  const quote = targetGame && targetGame.game_key && oddsByGameKey
    ? oddsByGameKey.get(targetGame.game_key)
    : null;
  const implied = quote ? impliedTeamPoints(quote) : { home: null, away: null };
  const gameEnvironment = model.gameEnvironmentEffect({
    impliedPoints: isHome === null ? null : (isHome ? implied.home : implied.away),
    opponentImplied: isHome === null ? null : (isHome ? implied.away : implied.home),
    slateAverageImplied,
    position: player.position,
    constants: constants.gameEnvironment,
  });

  const availability = unavailableFor({
    injuryStatus: player.injury_status,
    onBye,
    noTeam: player.nfl_team == null,
    nflRosterStatus,
  });

  // #1924 (Challenger only): a rank-1 player shrinks toward his group's
  // starter baseline; everyone else, and every v3.1/v3.2 run, keeps the
  // all-players baseline. `depthRank` stays undefined unless the key is on.
  const depthRank = constants.baseline && constants.baseline.depthChartStarterPrior === true
    ? (bundle.depthRankByPlayer && bundle.depthRankByPlayer.get(playerId)) ?? null
    : undefined;
  const starterBaseline = depthRank === 1 && context ? context.starterBaselinePerGame : null;

  const projected = model.projectPlayer({
    playerId,
    position: player.position,
    season,
    week,
    constants,
    modelVersion,
    scoringHashValue: hashValue,
    priorGames,
    priorSeasonPerGame: priorSeasonPerGame(bundle.seasonRowsByPlayer.get(playerId), rules, season),
    positionBaselinePerGame: typeof starterBaseline === 'number' ? starterBaseline : (context ? context.baselinePerGame : null),
    // Shrinkage target for the usage component's points-per-opportunity. Null
    // whenever the scan found no rows with computable opportunities, which is
    // every pre-enrichment database and every K/DEF/IDP group.
    positionEfficiencyPerOpportunity: context ? context.efficiencyPerOpportunity : null,
    playerResiduals: playerResidualsFrom(priorGames),
    pooledResiduals: context ? context.residuals : [],
    positionFloor,
    opponent,
    versusOpponent,
    homeAway,
    weather,
    gameEnvironment,
    // `null` when no provider ran at all, which is what keeps
    // factors.expertConsensus byte-identical to what it has always been.
    expert: expertByPlayerId ? expertByPlayerId.get(playerId) || null : null,
    availability,
    hasRoleData: priorGames.some((g) => g.hasRole),
    onPreHomeAwayBaseline,
  });
  if (depthRank !== undefined && projected.factors && projected.factors.dataQuality) {
    projected.factors.dataQuality.depthChartRank = depthRank;
  }
  return projected;
}

/** Pure: the run-level source-coverage descriptor. */
function buildSourceCoverage({ bundle, projections, weatherCoverage }) {
  const values = [...projections.values()];
  const withHistory = values.filter((p) => p.sampleSize > 0).length;
  const withOpponent = values.filter((p) => p.factors && p.factors.opponent && p.factors.opponent.available).length;
  const withHomeAway = values.filter((p) => p.factors && p.factors.homeAway && p.factors.homeAway.available).length;
  const withInjury = values.filter(
    (p) => p.factors && p.factors.availability && p.factors.availability.status
  ).length;
  const describe = (n) => (n === 0 ? 'unavailable' : n === values.length ? 'available' : 'partial');
  return {
    playerStats: { status: describe(withHistory), players: withHistory, of: values.length },
    priorSeason: { status: bundle.seasonRowsByPlayer.size > 0 ? 'available' : 'unavailable' },
    schedule: { status: bundle.targetGames.size > 0 ? 'available' : 'unavailable' },
    opponent: { status: describe(withOpponent), players: withOpponent, of: values.length },
    homeAway: { status: describe(withHomeAway), players: withHomeAway, of: values.length },
    injury: { status: withInjury > 0 ? 'available' : 'none-designated' },
    weather: weatherCoverage || { status: 'unavailable', reason: 'not requested' },
    expertConsensus: expertCoverage(),
    vegasOdds: vegasCoverage(),
    leagueScanTruncated: !!bundle.scanTruncated,
  };
}

/** Distinct games (one per game_key) for the requested players' teams. */
function distinctGamesFor(bundle, playerIds) {
  const games = new Map();
  for (const playerId of playerIds) {
    const player = bundle.players.get(playerId);
    if (!player) continue;
    const game = bundle.targetGames.get(player.team_key);
    if (!game || !game.game_key || games.has(game.game_key)) continue;
    games.set(game.game_key, {
      gameKey: game.game_key,
      kickoffAt: game.kickoff_at,
      roof: game.roof,
      venue: game.venue,
    });
  }
  return [...games.values()];
}

/**
 * #1813: run an OPTIONAL read (weather, odds, expert consensus) so its failure
 * can never leave the caller's transaction aborted. `fn` is awaited and its
 * value returned; a throw is rolled back to the savepoint and RETHROWN for the
 * caller's own degrade-to-nothing catch.
 *
 * On a transaction client a failed query aborts it (25P02 for every later
 * statement) unless the read ran inside its own SAVEPOINT. `client !== pool`
 * (identity) only says the caller did not hand us the pool, not that a
 * transaction is open: an autocommit pool.connect() client refuses a bare
 * SAVEPOINT with 25P01, which means there is no transaction to protect, so the
 * read runs unbracketed (one failed statement cannot abort autocommit). Any
 * other SAVEPOINT failure is a broken connection and is thrown from here like
 * any `fn` failure (each caller's degrade-to-nothing catch then logs it; the
 * next query on the dead connection fails loudly on its own).
 */
async function withOptionalSavepoint(client, name, fn) {
  let savepointOpen = false;
  if (client !== pool) {
    try {
      await client.query(`SAVEPOINT ${name}`);
      savepointOpen = true;
    } catch (err) {
      if (err.code !== '25P01') throw err;
    }
  }
  let value;
  try {
    value = await fn();
  } catch (err) {
    if (savepointOpen) await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw err;
  }
  if (savepointOpen) await client.query(`RELEASE SAVEPOINT ${name}`);
  return value;
}

/** Generate (not cache) projections for a player set. Exported for the backtest script. */
async function generateProjections({
  season,
  week,
  rules,
  playerIds,
  hashValue,
  client = pool,
  now = new Date(),
  weatherService = null,
  // Overridable so scripts/backtest-weekly-projections.js can sweep
  // half-life / shrinkage alternatives against the same weeks.
  modelConstants = model.MODEL_CONSTANTS,
  // The version string stamped on the run and every projection, and part of
  // every draw's seed. A caller running a REGISTERED successor's constants
  // (the #1439 evaluator with MODEL_CONSTANTS_V3_2) passes its version so the
  // rows say which constants produced them and `pointEstimateFor` can read
  // the ranking statistic back off the row. Defaults to what HEAD ships.
  modelVersion = model.MODEL_VERSION,
  // The odds seam's read bound (#1268, ADR 0039): forwarded untouched to
  // `getWeeklyOdds({ observedAtOrBefore })`. It also bounds a Challenger's
  // depth-chart read (#1924), and nothing else. `input_cutoff` (the
  // week's first kickoff) is never this value. `holdout.service.js`'s
  // `snapshotWeek` is the only caller that passes one, its own effective
  // capture cutoff; the live path and the versioned cache path below both
  // pass nothing, so the odds read stays newest-wins with no bound there.
  oddsObservedAtOrBefore = null,
  // Gate 2 sweep seam (PHASE5_EXECUTION_SPEC.md section 6.5), forwarded
  // unchanged into every per-player projectFromBundle call. Validated at the
  // top of the function body, before ANY other logic - so an empty
  // `playerIds` call still validates and still throws on a bad type even
  // though the per-player loop below never executes.
  onPreHomeAwayBaseline,
  // #1439 (ADR 0044's successor gate), both optional and both `null` by
  // default, which is what keeps this function's live behaviour byte
  // -identical: `playerContextOverrideById` forwards straight through to
  // `features.loadFeatureBundle` (see there for its shape and effect).
  // `expertOverrideByPlayerId`, an already-built `Map<playerId, {points,
  // source} | null>`, REPLACES the live expert-provider fetch below entirely
  // rather than merging with it - the successor evaluator's whole point is
  // to freeze the expert quote a ledger row captured, and a fetch that could
  // still run underneath an override would let a live quote drift back in
  // for any player the override happened not to name.
  playerContextOverrideById = null,
  expertOverrideByPlayerId = null,
  // #1767: `Map<playerId, { status, capturedAt }>` from
  // `loadNflRosterStatusById`, passed by the live cache path (`completeRun`)
  // and the holdout capture (`holdout.service.js`). Backtest snapshot replays
  // and the successor evaluator pass nothing, so every player reads as
  // Active there and those runs stay byte-identical (DEVIATIONS entry 4).
  nflRosterStatusById = null,
}) {
  if (onPreHomeAwayBaseline !== undefined && typeof onPreHomeAwayBaseline !== 'function') {
    throw new Error('generateProjections: onPreHomeAwayBaseline must be undefined or a function');
  }
  const bundle = await features.loadFeatureBundle({
    season, week, playerIds, rules, client, playerContextOverrideById,
    // The run's constants decide whether the prior-season scan runs at all
    // (#1485 seeding, #1483 Position floor): under v3.1 no new query is issued.
    constants: modelConstants,
    oddsObservedAtOrBefore,
  });

  // Weather is strictly optional context and must never be able to fail the
  // request: any throw or rejection degrades to "no weather".
  let weatherByGameKey = new Map();
  let weatherCoverage = { status: 'unavailable', reason: 'not requested' };
  const weather = weatherService === null ? require('./nwsWeather.service') : weatherService;
  if (weather) {
    try {
      const result = await withOptionalSavepoint(client, 'projection_weather', () =>
        weather.getForecastsForGames({
          season,
          week,
          games: distinctGamesFor(bundle, playerIds),
          now,
          client,
        }));
      weatherByGameKey = result.byGame;
      weatherCoverage = result.coverage;
    } catch (err) {
      console.error('projections: weather lookup failed, continuing without it:', err.message);
      weatherCoverage = { status: 'unavailable', reason: 'lookup failed' };
    }
  }

  // Market inputs are optional context on exactly the same terms as weather:
  // any throw degrades to "no market data" and the request still succeeds.
  // Both providers ship as no-ops, so at HEAD both loops are empty and every
  // projection is bit-identical to the one this code produced before.
  let oddsByGameKey = new Map();
  let expertByPlayerId = null;
  try {
    const oddsProvider = getVegasOddsProvider();
    if (oddsProvider.available) {
      oddsByGameKey = await withOptionalSavepoint(client, 'projection_odds', () =>
        oddsProvider.getWeeklyOdds({
          season, week, client, observedAtOrBefore: oddsObservedAtOrBefore,
        }));
    }
  } catch (err) {
    console.error('projections: odds lookup failed, continuing without it:', err.message);
    oddsByGameKey = new Map();
  }
  if (expertOverrideByPlayerId) {
    // #1439: a frozen quote replaces the fetch outright - never merged with
    // it, and never falling through to the provider below for a player the
    // override omits, which is why the successor evaluator always builds one
    // entry per requested player (see successorEval.js).
    expertByPlayerId = expertOverrideByPlayerId;
  } else {
    try {
      const expertProvider = getExpertProvider();
      if (expertProvider.available) {
        expertByPlayerId = await withOptionalSavepoint(client, 'projection_expert', () =>
          expertProvider.getWeeklyProjections({
            season, week, playerIds, client,
          }));
      }
    } catch (err) {
      console.error('projections: expert lookup failed, continuing without it:', err.message);
      expertByPlayerId = null;
    }
  }
  const slateAverage = computeSlateAverageImplied(oddsByGameKey);

  const projections = new Map();
  for (const playerId of playerIds) {
    projections.set(
      playerId,
      projectFromBundle({
        playerId, bundle, rules, season, week, hashValue, weatherByGameKey,
        oddsByGameKey, slateAverageImplied: slateAverage, expertByPlayerId,
        constants: modelConstants,
        modelVersion,
        onPreHomeAwayBaseline,
        nflRosterStatus: nflRosterStatusById ? nflRosterStatusById.get(playerId) ?? null : null,
      })
    );
  }

  return {
    projections,
    modelVersion,
    inputCutoff: bundle.inputCutoff,
    sourceCoverage: buildSourceCoverage({ bundle, projections, weatherCoverage }),
  };
}

// --- versioned cache -------------------------------------------------------

const CACHE_INSERT_CHUNK = 200;

async function findRun({ season, week, hashValue, client }) {
  const result = await client.query(
    `SELECT "id", "input_cutoff", "source_coverage", "generated_at"
     FROM "projection_runs"
     WHERE "season" = $1 AND "week" = $2 AND "scoring_hash" = $3 AND "model_version" = $4`,
    [season, week, hashValue, model.MODEL_VERSION]
  );
  return result.rows[0] || null;
}

function projectionFromCachedRow(row) {
  const num = (v) => (v == null ? null : Number(v));
  return {
    playerId: row.player_id,
    modelVersion: model.MODEL_VERSION,
    mean: num(row.mean),
    median: num(row.median),
    p10: num(row.p10),
    p25: num(row.p25),
    p75: num(row.p75),
    p90: num(row.p90),
    activeProbability: num(row.active_probability),
    confidence: row.confidence,
    sampleSize: Number(row.sample_size) || 0,
    factors: row.factors || {},
    cached: true,
  };
}

async function loadCachedRows({ runId, playerIds, client }) {
  const result = await client.query(
    `SELECT "player_id", "mean", "median", "p10", "p25", "p75", "p90",
            "active_probability", "confidence", "sample_size", "factors"
     FROM "player_week_projections"
     WHERE "run_id" = $1 AND "player_id" = ANY($2::int[])`,
    [runId, playerIds]
  );
  const byPlayer = new Map();
  for (const row of result.rows) byPlayer.set(row.player_id, projectionFromCachedRow(row));
  return byPlayer;
}

/**
 * Batch forms of `findRun`/`loadCachedRows` (#1403): every run for a set of
 * weeks in ONE read, and every cached row across those runs in ONE read,
 * keyed back by week / run id. `getWeeklyProjections` keeps its single-week
 * shape above (its callers and fixtures match that literal SQL); these serve
 * `getWeeklyProjectionsForWeeks` only.
 */
async function findRuns({ season, weeks, hashValue, client }) {
  const result = await client.query(
    `SELECT "id", "week", "input_cutoff", "source_coverage", "generated_at"
     FROM "projection_runs"
     WHERE "season" = $1 AND "week" = ANY($2::int[]) AND "scoring_hash" = $3 AND "model_version" = $4`,
    [season, weeks, hashValue, model.MODEL_VERSION]
  );
  return new Map(result.rows.map((r) => [Number(r.week), r]));
}

async function loadCachedRowsForRuns({ runIds, playerIds, client }) {
  const result = await client.query(
    `SELECT "run_id", "player_id", "mean", "median", "p10", "p25", "p75", "p90",
            "active_probability", "confidence", "sample_size", "factors"
     FROM "player_week_projections"
     WHERE "run_id" = ANY($1::int[]) AND "player_id" = ANY($2::int[])`,
    [runIds, playerIds]
  );
  const byRun = new Map();
  for (const row of result.rows) {
    const runId = Number(row.run_id);
    if (!byRun.has(runId)) byRun.set(runId, new Map());
    byRun.get(runId).set(row.player_id, projectionFromCachedRow(row));
  }
  return byRun;
}

async function upsertRun({ season, week, hashValue, inputCutoff, sourceCoverage, client }) {
  const result = await client.query(
    `INSERT INTO "projection_runs"
       ("season", "week", "scoring_hash", "model_version", "input_cutoff", "source_coverage", "generated_at")
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT ("season", "week", "scoring_hash", "model_version")
     DO UPDATE SET "input_cutoff" = EXCLUDED."input_cutoff",
                   "source_coverage" = EXCLUDED."source_coverage",
                   "generated_at" = now(),
                   "updated_at" = now()
     RETURNING "id", "generated_at", "input_cutoff"`,
    [
      season, week, hashValue, model.MODEL_VERSION,
      inputCutoff || new Date(), JSON.stringify(sourceCoverage || {}),
    ]
  );
  return result.rows[0];
}

const PROJECTION_COLUMNS = 12;

/**
 * Batched upsert — ONE statement per chunk of players, never one per player.
 * (The original producer's per-player INSERT loop is exactly the N+1 this
 * engine is not allowed to repeat: a 16-player roster must cost one write.)
 */
async function saveProjections({ runId, projections, client }) {
  const rows = [...projections.values()];
  for (let offset = 0; offset < rows.length; offset += CACHE_INSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + CACHE_INSERT_CHUNK);
    const placeholders = [];
    const params = [];
    chunk.forEach((p, i) => {
      const base = i * PROJECTION_COLUMNS;
      // The last column is `factors`; cast it explicitly rather than relying on
      // Postgres inferring jsonb for an untyped parameter in a multi-row VALUES.
      placeholders.push(
        `(${Array.from({ length: PROJECTION_COLUMNS }, (_, c) =>
          `$${base + c + 1}${c === PROJECTION_COLUMNS - 1 ? '::jsonb' : ''}`).join(', ')})`
      );
      params.push(
        runId, p.playerId, p.mean, p.median, p.p10, p.p25, p.p75, p.p90,
        p.activeProbability, p.confidence, p.sampleSize || 0, JSON.stringify(p.factors || {})
      );
    });
    await client.query(
      `INSERT INTO "player_week_projections"
         ("run_id", "player_id", "mean", "median", "p10", "p25", "p75", "p90",
          "active_probability", "confidence", "sample_size", "factors")
       VALUES ${placeholders.join(', ')}
       ON CONFLICT ("run_id", "player_id")
       DO UPDATE SET "mean" = EXCLUDED."mean", "median" = EXCLUDED."median",
                     "p10" = EXCLUDED."p10", "p25" = EXCLUDED."p25",
                     "p75" = EXCLUDED."p75", "p90" = EXCLUDED."p90",
                     "active_probability" = EXCLUDED."active_probability",
                     "confidence" = EXCLUDED."confidence",
                     "sample_size" = EXCLUDED."sample_size",
                     "factors" = EXCLUDED."factors",
                     "updated_at" = now()`,
      params
    );
  }
}

/**
 * Drop every cached run for `fromWeek` AND EVERY LATER WEEK of one season
 * under the CURRENT model, across all scoring profiles.
 *
 * This exists because a stat correction rewrites the history the following
 * weeks' projections were computed from, which makes every cached row for
 * those weeks a number derived from data that no longer exists. The legacy
 * `player_projections` cache has a `refresh: true` path; the versioned cache
 * did not, so v3 runs survived corrections and were served indefinitely.
 *
 * `>=` rather than `=`, deliberately. A corrected week W is consumed as
 * history by EVERY later target week, not just W+1, and later weeks really do
 * get cached ahead of time: the advice API accepts any future week
 * (lineup.service caps only PAST-week edits), so a run for W+3 requested
 * before the correction would otherwise survive it and be served stale
 * forever. Weeks up to and including W are untouched — their projections were
 * computed from weeks strictly before W and the correction cannot have
 * changed their inputs.
 *
 * DELETE rather than regenerate, deliberately. Regenerating would mean
 * enumerating every league's scoring profile and every league's rosters and
 * recomputing them synchronously inside a scheduled correction job, for weeks
 * that may never be requested. Deleting is one indexed statement, and the next
 * real request rebuilds exactly the players it needs through the normal cache
 * miss. Child `player_week_projections` rows go with the run through the
 * schema's ON DELETE CASCADE, so this must never be "optimized" into deleting
 * children separately.
 *
 * Scoped by model version on purpose: rows belonging to an older version are
 * already unreachable through `findRun` and are somebody else's cleanup, not
 * this function's business.
 *
 * @param {object} args
 * @param {number} args.season
 * @param {number} args.fromWeek       first stale week — this one and every
 *                                     later week of the season are dropped
 * @param {string} [args.modelVersion] defaults to the shipped model
 * @param {object} [args.client]       injectable for tests / transactions
 * @returns {Promise<{ season, fromWeek, modelVersion, deletedRuns }>}
 */
async function invalidateWeeklyProjectionRuns({
  season,
  fromWeek,
  modelVersion = model.MODEL_VERSION,
  client = pool,
} = {}) {
  const result = await client.query(
    `DELETE FROM "projection_runs"
     WHERE "season" = $1 AND "week" >= $2 AND "model_version" = $3`,
    [season, fromWeek, modelVersion]
  );
  return {
    season,
    fromWeek,
    modelVersion,
    deletedRuns: Number(result && result.rowCount) || 0,
  };
}

/**
 * Recompute the ONE availability verdict (`unavailableFor`, unavailable.js)
 * against the player facts as they stand right now, and patch ONLY
 * `factors.availability`, `active_probability` and `updated_at` on the cached
 * `player_week_projections` rows whose verdict has drifted from the one they
 * were generated with (#1789). Never named here, on purpose: `mean`,
 * `median`, `p10`, `p25`, `p75`, `p90`, `confidence`, `sample_size`. The
 * verdict is read-only context for `projectPlayer` (projectionModel.js), not
 * an input any of those numbers derive from, so rewriting it on a stored row
 * moves no number (ADR 0044 holds by construction) - this is the sibling of
 * `invalidateWeeklyProjectionRuns` above for exactly the one fact that can be
 * patched in place instead of thrown away and regenerated.
 *
 * `confidence` keeps its generation-time value on purpose (#1789 ruling item
 * 2): `projectPlayer` demotes confidence one level for an
 * `activeProbability === null` (Questionable/Doubtful) player at generation
 * time, and a later Q -> healthy flip leaves that demotion in place rather
 * than promoting the label back up. It is a label, not a number, the
 * Start/sit surface already reads it beside its own live verdict, and
 * un-demoting it here would mean regenerating the row (option (b), rejected
 * by the triage) rather than patching it.
 *
 * `onBye` is `false` for every player here EXCEPT the one case a week-
 * agnostic verdict cannot express: a No NFL team player's cached rows are
 * generated with `onBye: false` for EVERY week (`byeByTeam.get(null)` at
 * generation time resolves nothing), so none carries `reason: 'bye'` even
 * for what will become his new team's bye week. `reconcileByeAwareSignings`
 * below is the one place `onBye` is ever recomputed - it runs a SECOND,
 * narrowly-scoped pass over exactly the players who are stored `no_team` but
 * now have a real team, looks up that team's bye week
 * (`bye.service.computeByeWeeks`, the same source `projectFromBundle` reads),
 * and writes a genuinely per-week verdict: `bye` on that one week, the
 * ordinary verdict everywhere else (QA f4). A stored `reason: 'bye'` row from
 * ANY other player is left exactly as generated - the WHERE guard below
 * skips it outright - and a mid-season team CHANGE (not a signing) moving an
 * already-rostered player onto a different bye week stays out of scope
 * (triage #1789, "Other stale things", filed separately if wanted): only a
 * player whose stored verdict was actually `no_team` gets the bye-aware
 * treatment, since only that stored value proves the row predates his
 * current team. The other direction (a team clears to null, so a row newly
 * BECOMES `no_team`) is unaffected either way: nothing here ever guards a
 * row FROM turning into `no_team`, only a `no_team` row from turning into
 * anything else without knowing its new team's real bye week.
 *
 * `playerIds: null` sweeps every player (needed for the roster-status 48h
 * expiry and a cleared No NFL team, neither of which has a "who changed" id
 * list); a non-empty list scopes the read to exactly those ids (an injury
 * sync's changed + departed ids). Callers must guard an id-scoped call on a
 * non-empty list themselves - an empty array here is read as "nothing to do"
 * rather than silently widening to a full sweep.
 *
 * One SELECT (players + `nflRosterStatusColumn()`'s correlated roster-status
 * read, never a query per player) and exactly ONE UPDATE for the common case,
 * whatever the player count: the UPDATE's own `IS DISTINCT FROM` guard makes
 * an unchanged verdict a no-op write rather than something decided in JS
 * ahead of time, so a full sweep costs one comparison scan, not a per-player
 * round trip. `reconcileByeAwareSignings` adds ONE more read whenever there is
 * at least one on-team player among the ones just read (almost every sweep) -
 * the only way to learn whether any of them is a signing is to check storage
 * for a stale `no_team` row - but its own further `computeByeWeeks` read and
 * its second UPDATE run only when that check actually finds one; an ordinary
 * sweep with no mid-week signing in scope pays for the one extra read and
 * nothing else.
 *
 * @param {object} args
 * @param {number} args.season
 * @param {number} args.fromWeek        first live week - this one and every
 *                                       later week of the season are checked
 * @param {number[]|null} [args.playerIds] a specific id set, or `null` for
 *                                       every player
 * @param {string} [args.modelVersion]  defaults to the shipped model
 * @param {object} [args.client]        injectable for tests / transactions
 * @param {Date} [args.now]             injectable clock, read by the
 *                                       verdict's own 48h freshness check and
 *                                       stamped as every patched row's
 *                                       `updated_at`
 * @returns {Promise<{ checked: number, updated: number }>}
 */
async function reconcileAvailability({
  season,
  fromWeek,
  playerIds = null,
  modelVersion = model.MODEL_VERSION,
  client = pool,
  now = new Date(),
} = {}) {
  const ids = playerIds ? [...new Set(playerIds.map(Number).filter(Number.isInteger))] : null;
  if (ids && ids.length === 0) return { checked: 0, updated: 0 };

  const playersResult = await client.query(
    `SELECT "id", "injury_status", "nfl_team", ${nflRosterStatusColumn()}
       FROM "players"${ids ? ` WHERE "id" = ANY($1::int[])` : ''}`,
    ids ? [ids] : []
  );
  if (playersResult.rows.length === 0) return { checked: 0, updated: 0 };

  const patchedIds = [];
  const availabilityJson = [];
  const activeProbabilities = [];
  // Players currently on a real team, keyed by id - the candidate pool
  // `reconcileByeAwareSignings` narrows to "stored no_team" below. A player
  // with no team can never be a signing, so he is never in this map.
  const onTeamById = new Map();
  for (const row of playersResult.rows) {
    const verdict = unavailableFor({
      injuryStatus: row.injury_status,
      onBye: false,
      noTeam: row.nfl_team == null,
      nflRosterStatus: row.nfl_roster_status,
      now,
    });
    patchedIds.push(row.id);
    availabilityJson.push(JSON.stringify(verdict));
    activeProbabilities.push(verdict.activeProbability);
    if (row.nfl_team != null) onTeamById.set(row.id, { row, verdict });
  }

  // A subquery against `projection_runs` for the run scope, rather than a
  // JOIN alongside the unnest set: a JOIN's ON clause cannot reach back to
  // the UPDATE target (`p`) from inside the FROM list, so the run filter has
  // to land in the WHERE clause instead. Still one statement, one scan.
  const result = await client.query(
    `UPDATE "player_week_projections" p
        SET "factors" = p."factors" || jsonb_build_object('availability', v."availability"),
            "active_probability" = v."active_probability",
            "updated_at" = $7
       FROM (SELECT * FROM unnest($1::int[], $2::jsonb[], $3::numeric[])
               AS v("player_id", "availability", "active_probability")) v
      WHERE p."player_id" = v."player_id"
        AND p."run_id" IN (
          SELECT "id" FROM "projection_runs"
           WHERE "season" = $4 AND "week" >= $5 AND "model_version" = $6
        )
        AND p."factors"->'availability'->>'reason' IS DISTINCT FROM 'bye'
        -- QA f1 (was NULL-unsafe): a healthy stored row has reason NULL, and
        -- NULL = 'no_team' is SQL NULL, not FALSE - NOT (NULL AND x) is
        -- itself NULL, and a NULL WHERE term drops the row exactly like
        -- FALSE would, so the old NOT (a = 'no_team' AND b IS DISTINCT
        -- FROM 'no_team') form silently excluded EVERY healthy row, not
        -- just the no_team ones it meant to guard. Rewritten by De Morgan
        -- into an OR whose second arm uses IS NOT DISTINCT FROM (itself
        -- NULL-safe, never NULL) instead of negating an IS DISTINCT FROM:
        -- true when the stored reason was never no_team (ordinary rows,
        -- unaffected either way), or when the freshly computed reason IS
        -- STILL no_team (still no team - the guard is a no-op, and the
        -- change-detection term below already skips it as unchanged). False,
        -- correctly, ONLY for a stored no_team row whose new verdict is no
        -- longer no_team - deferred to reconcileByeAwareSignings below
        -- rather than written here without knowing the new team's bye week.
        AND (
          p."factors"->'availability'->>'reason' IS DISTINCT FROM 'no_team'
          OR v."availability"->>'reason' IS NOT DISTINCT FROM 'no_team'
        )
        AND p."factors"->'availability' IS DISTINCT FROM v."availability"`,
    [patchedIds, availabilityJson, activeProbabilities, season, fromWeek, modelVersion, now]
  );

  // #1813: the second pass is a refinement of the main pass, never a
  // precondition of it. Injury sync brackets this whole function in
  // `SAVEPOINT reconcile_availability`, so a throw escaping here would roll
  // back the main pass's correct patches too. It therefore runs in its own
  // nested savepoint (a failed query on a transaction client aborts it, and
  // only a rollback to a savepoint opened AFTER the main UPDATE clears that
  // without losing it), and its failure is logged and degraded to "no
  // signings reconciled" - those rows stay deferred to regeneration, the
  // same safe direction an unresolvable bye week already takes.
  let byeAware = { updated: 0 };
  try {
    byeAware = await withOptionalSavepoint(client, 'reconcile_bye_aware', () =>
      reconcileByeAwareSignings({ client, season, fromWeek, modelVersion, now, onTeamById }));
  } catch (err) {
    console.error('projections: bye-aware availability reconcile failed, keeping the main pass result:', err.message);
  }

  return {
    checked: playersResult.rows.length,
    updated: (Number(result && result.rowCount) || 0) + byeAware.updated,
  };
}

/**
 * QA f4: the bye-aware half of `reconcileAvailability`, for players whose
 * cached rows predate a signing. Returns `{ updated: 0 }` immediately, no
 * query at all, when `onTeamById` is empty (no player in this call currently
 * has a team). Otherwise ONE query checks `onTeamById`'s candidates (players
 * `reconcileAvailability` just read who currently have a real team) for
 * whoever ALSO has at least one stored `no_team` row in this exact (season,
 * fromWeek, modelVersion) window - that stored value is the only proof a row
 * predates the player's current team, since `onTeamById` alone would also
 * match every player who has simply always been rostered. With no such row
 * found, this returns `{ updated: 0 }` right there - `computeByeWeeks` and
 * the second UPDATE below run only when that check actually finds a
 * candidate.
 *
 * For each one, `bye.service.computeByeWeeks` resolves his CURRENT team's
 * bye week for `season` - the same source `projectFromBundle`
 * (projection.service.js, generation time) reads via `bundle.byeByTeam`, so
 * this can never disagree with what a fresh generation would compute. A
 * team with no resolvable bye (`computeByeWeeks` returns `null` - no
 * schedule synced yet, or an incomplete/ambiguous one) is logged and left
 * alone: his rows stay exactly as `reconcileAvailability`'s main UPDATE left
 * them (deferred, the safe direction) rather than guessing.
 *
 * The write is a SECOND UPDATE, not folded into the first: every OTHER
 * player gets one week-agnostic verdict applied to every one of his rows,
 * but a signing needs two DIFFERENT verdicts (bye week vs. every other
 * week) picked per row by that row's own `week` - which only exists once
 * `player_week_projections` is joined to `projection_runs`, so this
 * statement carries that join itself (as a comma-joined FROM item, not a
 * `JOIN ... ON` clause - the same target-table-visibility reason the first
 * UPDATE above uses a subquery instead of a join).
 */
async function reconcileByeAwareSignings({ client, season, fromWeek, modelVersion, now, onTeamById }) {
  if (onTeamById.size === 0) return { updated: 0 };

  const candidateIds = [...onTeamById.keys()];
  const staleResult = await client.query(
    `SELECT DISTINCT "p"."player_id" FROM "player_week_projections" "p"
       JOIN "projection_runs" "r" ON "r"."id" = "p"."run_id"
      WHERE "r"."season" = $1 AND "r"."week" >= $2 AND "r"."model_version" = $3
        AND "p"."player_id" = ANY($4::int[])
        AND "p"."factors"->'availability'->>'reason' = 'no_team'`,
    [season, fromWeek, modelVersion, candidateIds]
  );
  if (staleResult.rows.length === 0) return { updated: 0 };

  const teams = [...new Set(staleResult.rows.map((r) => onTeamById.get(r.player_id).row.nfl_team))];
  const byeByTeam = await computeByeWeeks(teams, season, { client });

  const outPlayerIds = [];
  const outByeWeeks = [];
  const outByeAvailability = [];
  const outByeActiveProbability = [];
  const outOtherAvailability = [];
  const outOtherActiveProbability = [];
  for (const { player_id: playerId } of staleResult.rows) {
    const { row, verdict } = onTeamById.get(playerId);
    const byeWeek = byeByTeam.get(row.nfl_team);
    if (byeWeek == null) {
      console.error(
        'projections: availability reconcile could not resolve a bye week for player %s\'s team %s ' +
        '(no synced schedule, or an incomplete one) - his no_team rows stay deferred to regeneration',
        playerId, row.nfl_team
      );
      continue;
    }
    const byeVerdict = unavailableFor({
      injuryStatus: row.injury_status,
      onBye: true,
      noTeam: false,
      nflRosterStatus: row.nfl_roster_status,
      now,
    });
    outPlayerIds.push(playerId);
    outByeWeeks.push(byeWeek);
    outByeAvailability.push(JSON.stringify(byeVerdict));
    outByeActiveProbability.push(byeVerdict.activeProbability);
    // The SAME week-agnostic verdict `reconcileAvailability` already
    // computed for this player (onBye: false) - recomputing it here would
    // just repeat that call for an identical result.
    outOtherAvailability.push(JSON.stringify(verdict));
    outOtherActiveProbability.push(verdict.activeProbability);
  }
  if (outPlayerIds.length === 0) return { updated: 0 };

  const result = await client.query(
    `UPDATE "player_week_projections" p
        SET "factors" = p."factors" || jsonb_build_object('availability',
              CASE WHEN r."week" = v."bye_week" THEN v."bye_availability" ELSE v."other_availability" END),
            "active_probability" =
              CASE WHEN r."week" = v."bye_week" THEN v."bye_active_probability" ELSE v."other_active_probability" END,
            "updated_at" = $10
       FROM (SELECT * FROM unnest($1::int[], $2::int[], $3::jsonb[], $4::numeric[], $5::jsonb[], $6::numeric[])
               AS v("player_id", "bye_week", "bye_availability", "bye_active_probability",
                    "other_availability", "other_active_probability")) v,
            "projection_runs" r
      WHERE p."player_id" = v."player_id"
        AND p."run_id" = r."id"
        AND r."season" = $7 AND r."week" >= $8 AND r."model_version" = $9
        AND p."factors"->'availability' IS DISTINCT FROM (
          CASE WHEN r."week" = v."bye_week" THEN v."bye_availability" ELSE v."other_availability" END
        )`,
    [
      outPlayerIds, outByeWeeks, outByeAvailability, outByeActiveProbability,
      outOtherAvailability, outOtherActiveProbability, season, fromWeek, modelVersion, now,
    ]
  );
  return { updated: Number(result && result.rowCount) || 0 };
}

/**
 * `{ season, fromWeek } | null` for a full-sweep `reconcileAvailability`
 * call: the (current_season, current_week) of whichever live fantasy league
 * (`fantasySeasonLiveWhereSql`, leaguePhase.js) sits on the LOWEST current
 * week right now, one query - `null` when no league is live, since there is
 * then no live week to reconcile from. Mirrors `invalidateWeeklyProjectionRuns`'s
 * own callers' "min live current_week" query (correction.service.js,
 * scheduler.js) so the #1789 ruling's scope rule ("fromWeek = lowest live
 * league current_week, season likewise") is decided once rather than at each
 * of the three trigger sites.
 *
 * `ORDER BY "current_season" DESC, "current_week" ASC` (QA f5): season is
 * decided FIRST, week second, both explicit - never an arbitrary row off a
 * week-only sort. A rollover overlap (an old season's league still live
 * alongside a new season's) is the case this guards: without the season
 * tiebreak, which of the two seasons won was whichever row Postgres
 * happened to return first for a tied or lower current_week, an ordering
 * this query never actually promised. `DESC` on season picks the NEWEST
 * live season on purpose - the one every later reconcile call should be
 * reasoning about - and `fromWeek` is read off that SAME winning row, so the
 * two can never disagree about which season they describe. Two leagues
 * tied on both columns are interchangeable by construction: `season` and
 * `fromWeek` are identical either way, so no further tiebreak is needed.
 * Production carries only one live season today, so this has no observable
 * effect yet - it is here so a rollover overlap resolves the same way on
 * day one rather than being found live.
 */
async function liveReconcileScope(client = pool) {
  const result = await client.query(
    `SELECT "current_season", "current_week" FROM "leagues"
      WHERE ${fantasySeasonLiveWhereSql()}
      ORDER BY "current_season" DESC, "current_week" ASC LIMIT 1`
  );
  const row = result.rows[0];
  return row ? { season: row.current_season, fromWeek: row.current_week } : null;
}

/**
 * `free_baseline_v2` projections for a specific player set under a specific
 * league's scoring rules.
 *
 * Cache correctness rules, all of which have tests:
 *  - the run is keyed by (season, week, scoring_hash, model_version), so a
 *    different scoring profile or a model bump can never read these rows;
 *  - a cache HIT requires EVERY requested player to have a row. One row is not
 *    a hit. A partially-populated run is completed in place (the missing
 *    players are generated and inserted into the same run) rather than
 *    returned partial or thrown away wholesale;
 *  - `refresh: true` regenerates the requested players unconditionally.
 *
 * `league` is required: the league row, or `PUBLIC` (standard scoring, no
 * league scope) for a reader that has no league by design.
 */
async function getWeeklyProjections({
  season,
  week,
  league,
  playerIds = [],
  refresh = false,
  client = pool,
  now = new Date(),
  weatherService = null,
}) {
  // A projection is priced under a league's rules (ADR 0024), so an omitted
  // league is a caller bug, never a quiet fall back to standard scoring. The
  // public readers say so out loud with `league: PUBLIC`.
  if (!league) {
    throw new ProjectionError(500, 'getWeeklyProjections requires a league: pass the league row, or PUBLIC for standard scoring');
  }
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  const rules = league === PUBLIC ? SCORING_RULES : rulesForLeague(league);
  const hashValue = model.scoringHash(rules);
  const empty = {
    season, week, modelVersion: model.MODEL_VERSION, scoringHash: hashValue,
    generatedAt: new Date().toISOString(), inputCutoff: null,
    sourceCoverage: features.emptyCoverage(), projections: new Map(),
  };
  if (ids.length === 0) return toWeeklyProjectionResult(empty);

  const backupIds = await loadBackupQuarterbackIds({ client, playerIds: ids, now });
  const practiceById = await loadPracticeFacts({ client, season, week, playerIds: ids });
  let run = refresh ? null : await findRun({ season, week, hashValue, client });
  let cached = new Map();
  if (run) {
    cached = await loadCachedRows({ runId: run.id, playerIds: ids, client });
    const missing = ids.filter((id) => !cached.has(id));
    if (missing.length === 0) return cachedRunResult({ season, week, hashValue, run, cached, backupIds, practiceById });
  }

  const toGenerate = run ? ids.filter((id) => !cached.has(id)) : ids;
  return completeRun({
    season, week, rules, hashValue, run, cached, playerIds: toGenerate, client, now, weatherService, backupIds, practiceById,
  });
}

/** The result shape for a week every requested player already had cached. */
function cachedRunResult({ season, week, hashValue, run, cached, backupIds, practiceById }) {
  return toWeeklyProjectionResult({
    season,
    week,
    modelVersion: model.MODEL_VERSION,
    scoringHash: hashValue,
    generatedAt: run.generated_at ? new Date(run.generated_at).toISOString() : null,
    inputCutoff: run.input_cutoff ? new Date(run.input_cutoff).toISOString() : null,
    sourceCoverage: run.source_coverage || {},
    projections: cached,
    backupIds,
    practiceById,
  });
}

/**
 * An optional read that degrades to `fallback` instead of failing the request
 * (the NFL roster status read, #1767; the QB depth chart read, ADR 0057). The
 * SAVEPOINT bracket (#1790) is what keeps a caller's transaction usable after
 * a failed read; the long note in `completeRun` explains why it is issued
 * inside the guarded path.
 */
async function degradingRead({ client, savepoint, label, read, fallback }) {
  let savepointOpen = false;
  if (client !== pool) {
    try {
      await client.query(`SAVEPOINT ${savepoint}`);
      savepointOpen = true;
    } catch (err) {
      if (err.code !== '25P01') throw err;
    }
  }
  try {
    const value = await read();
    if (savepointOpen) await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return value;
  } catch (err) {
    console.error('projections: %s read failed, continuing without it:', label, err.message);
    if (savepointOpen) await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    return fallback;
  }
}

/**
 * Generates `playerIds` for one week, writes the run and its rows, and merges
 * the new projections over `cached` (the rows the run already held). Shared by
 * the single-week and multi-week readers so a partial run is completed the
 * same way from either path.
 */
async function completeRun({
  season, week, rules, hashValue, run, cached, playerIds, client, now, weatherService, backupIds, practiceById,
}) {
  // The NFL roster status is optional context on the same terms as weather:
  // a failed read degrades to "every player Active" rather than failing the
  // request (#1767). On a TRANSACTION client (the pool has none) a failed
  // query aborts it - Postgres refuses every later statement with 25P02 until
  // the transaction ends - so the degrade above is not real there unless the
  // read is wrapped in its own SAVEPOINT: rolling back to it clears the abort
  // and leaves the caller's transaction, and every query after this one,
  // usable (#1790) - the same SAVEPOINT/ROLLBACK TO SAVEPOINT isolation
  // holdout.service.js's Challenger loop uses to isolate one arm's failure.
  //
  // `client !== pool` (identity, not `instanceof`) only says the caller did
  // not hand us the pool - it does NOT prove a transaction is open. A
  // pool.connect() client used in autocommit (no BEGIN) is exactly this
  // shape, and Postgres refuses a bare SAVEPOINT outside a transaction block
  // with 25P01. So the SAVEPOINT itself is issued INSIDE the guarded path,
  // not before it: a 25P01 there means there is no transaction to protect
  // (autocommit cannot be left aborted by one failed statement, so the plain
  // catch in `degradingRead` is already the correct degrade with no bracket
  // at all) and capture proceeds with `savepointOpen` false; any OTHER failure to open
  // the savepoint is a broken connection and propagates, exactly as
  // holdout.service.js's own SAVEPOINT loop treats that case.
  const nflRosterStatusById = await degradingRead({
    client, savepoint: 'nfl_roster_status', label: 'NFL roster status', fallback: null,
    read: () => loadNflRosterStatusById(client, playerIds),
  });
  const generated = await generateProjections({
    season, week, rules, playerIds, hashValue, client, now, weatherService, nflRosterStatusById,
  });

  const saved = await upsertRun({
    season,
    week,
    hashValue,
    inputCutoff: generated.inputCutoff,
    sourceCoverage: generated.sourceCoverage,
    client,
  });
  const effectiveRun = saved || run;
  try {
    await saveProjections({ runId: effectiveRun.id, projections: generated.projections, client });
  } catch (err) {
    // A cache write failure must not deny the caller a projection it already
    // computed; the next request simply regenerates.
    console.error('projections: cache write failed:', err.message);
  }

  const merged = new Map(cached);
  for (const [id, projection] of generated.projections) merged.set(id, projection);

  return toWeeklyProjectionResult({
    season,
    week,
    modelVersion: model.MODEL_VERSION,
    scoringHash: hashValue,
    generatedAt: effectiveRun && effectiveRun.generated_at
      ? new Date(effectiveRun.generated_at).toISOString()
      : new Date().toISOString(),
    inputCutoff: generated.inputCutoff ? new Date(generated.inputCutoff).toISOString() : null,
    sourceCoverage: generated.sourceCoverage,
    projections: merged,
    backupIds,
    practiceById,
  });
}

/**
 * `getWeeklyProjections` for several weeks at once (#1403): `Map<week, run>`,
 * each run the exact object the single-week reader returns for that week.
 *
 * The cache read is TWO queries for the whole set (every run, then every
 * cached row across those runs), whatever the number of weeks or players,
 * instead of two per week. The hit rule is unchanged and decided per week:
 * a week whose run holds every requested player's row is returned as cached;
 * any other week is completed in place through the same `completeRun` the
 * single-week reader uses (generation is per week by construction, one
 * feature bundle per week, so only the weeks with a missing row pay for it).
 *
 * The Players list (view=cards, #1309) and `getRestOfSeason` read every
 * remaining week of the season for every row on a page; before this they
 * did so one week at a time, each, and a page of 25 cost ~70 cache reads
 * warm and ~350 queries cold (#1403).
 */
async function getWeeklyProjectionsForWeeks({
  season,
  weeks = [],
  league,
  playerIds = [],
  client = pool,
  now = new Date(),
  weatherService = null,
}) {
  // Same contract as getWeeklyProjections (#2144): no league is a caller bug,
  // refused before any read and before the empty-weeks return.
  if (!league) {
    throw new ProjectionError(500, 'getWeeklyProjectionsForWeeks requires a league: pass the league row, or PUBLIC for standard scoring');
  }
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  const wks = [...new Set((weeks || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const rules = league === PUBLIC ? SCORING_RULES : rulesForLeague(league);
  const hashValue = model.scoringHash(rules);
  const out = new Map();
  if (wks.length === 0) return out;
  if (ids.length === 0) {
    for (const week of wks) {
      out.set(week, toWeeklyProjectionResult({
        season, week, modelVersion: model.MODEL_VERSION, scoringHash: hashValue,
        generatedAt: new Date().toISOString(), inputCutoff: null,
        sourceCoverage: features.emptyCoverage(), projections: new Map(),
      }));
    }
    return out;
  }

  const backupIds = await loadBackupQuarterbackIds({ client, playerIds: ids, now });
  const runs = await findRuns({ season, weeks: wks, hashValue, client });
  const runIds = [...runs.values()].map((r) => Number(r.id));
  const rowsByRun = runIds.length > 0
    ? await loadCachedRowsForRuns({ runIds, playerIds: ids, client })
    : new Map();

  for (const week of wks) {
    const run = runs.get(week) || null;
    const cached = run ? (rowsByRun.get(Number(run.id)) || new Map()) : new Map();
    const missing = ids.filter((id) => !cached.has(id));
    if (run && missing.length === 0) {
      out.set(week, cachedRunResult({ season, week, hashValue, run, cached, backupIds }));
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- one generation per week
    // that is actually missing a row; cached weeks never reach here.
    out.set(week, await completeRun({
      season, week, rules, hashValue, run, cached, playerIds: missing, client, now, weatherService, backupIds,
    }));
  }
  return out;
}

/**
 * `free_baseline_v2` rest-of-season totals for a specific set of players in
 * one league: the sum of their already-cached Weekly projections (see
 * `getWeeklyProjections` above) from the league's current week through its
 * last playoff week (`season.service.lastPlayoffWeek`), with an Unavailable
 * week (CONTEXT.md: bye, Out, IR) contributing zero. Reads the SAME cache the
 * nightly projection run fills (server/modules/scheduler.js,
 * `runNightlyProjectionFill`, #1305): a week that run already generated here
 * is never regenerated, and a week this call generates is cached for the
 * next one — `getWeeklyProjections` owns that cache-hit/miss decision, this
 * function never duplicates it.
 *
 * Returns `Map<playerId, { total, perGame, positionRank, groupSize }>`.
 * `perGame` averages over the player's AVAILABLE covered weeks only (an
 * Unavailable week does not dilute it, the same rule `total` follows); a
 * player with no available covered week yet reports 0 in both, never a
 * division by zero. `positionRank`/`groupSize` rank `total` within THIS
 * pool, among players sharing the same position — the same RANK() shape
 * (ties share a rank) `scoring.service.getSeasonPositionRank` uses — never a
 * league- or pool-wide rank, because this pool is whatever `playerIds` asked
 * about.
 */
async function getRestOfSeason(playerIds, leagueId, { client = pool, runsByWeek = null } = {}) {
  const ids = [...new Set((Array.isArray(playerIds) ? playerIds : []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return new Map();

  const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new ProjectionError(404, 'league not found');

  const playersResult = await client.query(
    `SELECT "id", "position" FROM "players" WHERE "id" = ANY($1::int[])`,
    [ids]
  );
  const positionById = new Map(playersResult.rows.map((r) => [r.id, r.position]));

  const totals = new Map(ids.map((id) => [id, 0]));
  const coveredGames = new Map(ids.map((id) => [id, 0]));

  const fromWeek = Number(league.current_week) || 0;
  const throughWeek = lastPlayoffWeek(league);
  const weeks = [];
  for (let week = fromWeek; week <= throughWeek; week++) weeks.push(week);
  // #1403: every covered week in one batched read. A caller that already
  // holds these runs (the Players list reads current..18 for the weeks bar)
  // passes them in and no projection read happens here at all; a passed map
  // missing a covered week has just that week read.
  const missingWeeks = weeks.filter((week) => !(runsByWeek && runsByWeek.has(week)));
  const fetched = missingWeeks.length > 0
    ? await getWeeklyProjectionsForWeeks({
      season: league.current_season, weeks: missingWeeks, league, playerIds: ids, client,
    })
    : new Map();
  for (const week of weeks) {
    const run = (runsByWeek && runsByWeek.get(week)) || fetched.get(week);
    if (!run) continue;
    for (const id of ids) {
      const projection = run.projections.get(id);
      if (!projection) continue;
      const unavailable = !!(projection.factors
        && projection.factors.availability
        && projection.factors.availability.available === false);
      if (unavailable) continue; // bye/Out/IR: zero, and never counted toward perGame
      const point = pointEstimateFor(projection);
      if (point == null) continue;
      totals.set(id, Math.round((totals.get(id) + Number(point)) * 100) / 100);
      coveredGames.set(id, coveredGames.get(id) + 1);
    }
  }

  // positionRank/groupSize: RANK() semantics (ties share a rank), scoped to
  // THIS pool only, partitioned by each player's own position code.
  const byPosition = new Map();
  for (const id of ids) {
    const position = positionById.get(id) ?? null;
    if (!byPosition.has(position)) byPosition.set(position, []);
    byPosition.get(position).push(id);
  }
  const rankById = new Map();
  for (const group of byPosition.values()) {
    const sorted = [...group].sort((a, b) => totals.get(b) - totals.get(a));
    let rank = 0;
    let lastTotal = null;
    sorted.forEach((id, index) => {
      const total = totals.get(id);
      if (lastTotal === null || total !== lastTotal) rank = index + 1;
      lastTotal = total;
      rankById.set(id, rank);
    });
  }

  const out = new Map();
  for (const id of ids) {
    const games = coveredGames.get(id);
    const total = totals.get(id);
    const position = positionById.get(id) ?? null;
    out.set(id, {
      total,
      perGame: games > 0 ? Math.round((total / games) * 100) / 100 : 0,
      positionRank: rankById.get(id) ?? null,
      groupSize: (byPosition.get(position) || []).length,
    });
  }
  return out;
}

/**
 * Pure: the ONE point estimate every manager-facing surface reads (#1482's
 * consistency, #1483) - whichever statistic `constants.decision.lineupRanking`
 * says the optimizer ranks lineups by, so the number on the row is the number
 * the rule ranked on. 'mean' (the v3.2 default) reads `projection.mean`,
 * falling back to `median` when a distribution had no mean (there is no such
 * case today, but the fallback costs nothing and matches the median arm's own
 * fallback); anything else (v3.1's 'median') reads `projection.median`,
 * falling back to `mean`. A projection with neither reports `null`, never a
 * fabricated 0.
 */
function pointEstimateFor(
  projection,
  // The RUN's constants, read back off the row's own `modelVersion` through
  // the registry (#1483: the display follows the ranking statistic of the
  // constants that produced the number, never the module default). A row
  // stamped with a version this checkout cannot run falls back to HEAD's.
  constants = model.constantsForVersion(projection && projection.modelVersion) || model.MODEL_CONSTANTS
) {
  const meanFirst = constants && constants.decision && constants.decision.lineupRanking === 'mean';
  const primary = meanFirst ? projection.mean : projection.median;
  const fallback = meanFirst ? projection.median : projection.mean;
  return primary != null ? primary : fallback;
}

/**
 * Pure: classifies one raw run entry for one week — unavailable plus a
 * reason code ('bye' | 'out' | 'ir' | 'no_team'), or the Point estimate
 * (`pointEstimateFor`) — exactly what the Decision card module's own copy
 * (`playerCard.service.js`'s `classifyWeekProjection`) used to compute
 * before the migrate ticket (#1703) pointed every caller at `classify`
 * below instead and deleted it. Kept as its own function rather than
 * imported from that module, so this file gains no new dependency.
 */
function classifyProjectionEntry(projection) {
  const unavailable = !!(projection
    && projection.factors
    && projection.factors.availability
    && projection.factors.availability.available === false);
  if (unavailable) {
    return { unavailable: true, reason: projection.factors.availability.reason || 'out' };
  }
  const point = projection ? pointEstimateFor(projection) : null;
  return { unavailable: false, points: point == null ? null : Number(point) };
}

// The data-quality reason the engine (projectionModel.confidenceFor) attaches to
// a Position-baseline projection. Named once so the read path and its tests agree.
const POSITION_BASELINE_REASON = 'position baseline';

/**
 * Pure: true exactly when a projection entry's data-quality reasons contain
 * `POSITION_BASELINE_REASON`. The one definition of the marker: production's
 * `positionBaselineFor` and the backtest drivers (which inject it, because
 * nothing in `scripts/backtest` may require `server/services`) both use it.
 * Anything that is not an entry carrying the reasons (null, a bare number)
 * reads false.
 */
function isPositionBaselineEntry(entry) {
  const dataQuality = entry && entry.factors ? entry.factors.dataQuality : null;
  return !!(dataQuality
    && Array.isArray(dataQuality.reasons)
    && dataQuality.reasons.includes(POSITION_BASELINE_REASON));
}

const BACKUP_CHART_FRESH_MS = 48 * 60 * 60 * 1000;

/**
 * Pure: the ids of Backup quarterbacks (ADR 0057 rule 1) from QB depth-chart
 * rows `{ player_id, rank, team_code, captured_date, nfl_team, injury_status }`.
 * Per team only the newest `captured_date` counts, and a chart older than 48
 * hours of `now` counts for nothing. A QB is a Backup when another QB on that
 * same chart ranks better, is still on that NFL team and is not Out or IR (a
 * Questionable or Doubtful QB ahead still counts as ahead).
 */
function backupQuarterbackIds(rows, now = new Date()) {
  // `captured_date` arrives as 'YYYY-MM-DD' text (the read casts it) and ages
  // from UTC midnight, so freshness does not depend on the server's timezone.
  const at = (row) => {
    const [y, m, d] = String(row.captured_date).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  // ESPN's chart spells Washington WAS and Tank01's players.nfl_team WSH: both
  // sides fold through `normalizeNflTeam`.
  const teamOf = (row) => normalizeNflTeam(row.team_code);
  const newest = new Map();
  for (const row of rows) {
    const team = teamOf(row);
    if (team != null && at(row) > (newest.get(team) ?? -Infinity)) newest.set(team, at(row));
  }
  const backups = new Set();
  for (const [teamCode, capturedAt] of newest) {
    if (new Date(now).getTime() - capturedAt > BACKUP_CHART_FRESH_MS) continue;
    const chart = rows.filter((r) => teamOf(r) === teamCode && at(r) === capturedAt && r.rank != null);
    const available = chart.filter((r) => normalizeNflTeam(r.nfl_team) === teamCode
      && !['O', 'IR'].includes(String(r.injury_status || '').toUpperCase()));
    for (const r of chart) {
      if (available.some((a) => a.rank < r.rank)) backups.add(Number(r.player_id));
    }
  }
  return backups;
}

/**
 * The QB depth charts of every team a requested player is charted on (the last
 * 3 days, a coarse bound: `backupQuarterbackIds` applies the 48 hour rule), in
 * one query, reduced to the Set the Weekly projection result answers
 * `startVerdictFor`'s Backup fact from. Read path only (ADR 0057): nothing is stored.
 */
async function loadBackupQuarterbackIds({ client, playerIds, now }) {
  // A failed read degrades to "nobody is a Backup", as the NFL roster status
  // read degrades to "every player Active": the number and every other
  // verdict still serve.
  return degradingRead({
    client, savepoint: 'backup_chart', label: 'QB depth chart', fallback: new Set(),
    read: async () => {
      const result = await client.query(
        `SELECT "dc"."player_id", "dc"."rank", "dc"."team_code", "dc"."captured_date"::text AS "captured_date",
                "p"."nfl_team", "p"."injury_status"
         FROM "player_depth_chart" "dc" JOIN "players" "p" ON "p"."id" = "dc"."player_id"
         WHERE "dc"."position_group" = 'QB' AND "p"."position" = 'QB' AND "dc"."captured_date" >= $2::date - 3
           AND "dc"."team_code" IN (
             SELECT "team_code" FROM "player_depth_chart"
             WHERE "player_id" = ANY($1::int[]) AND "position_group" = 'QB' AND "captured_date" >= $2::date - 3)`,
        [playerIds, new Date(now).toISOString().slice(0, 10)]
      );
      return backupQuarterbackIds(result.rows, now);
    },
  });
}

/**
 * This week's Practice participation for the requested players, as the
 * `Map<playerId, { observations, kickoffAt }>` the Start verdict reads (ADR
 * 0056): one batched observations read, then one kickoff read only for players
 * that have an observation (coverage is anchored on his game's kickoff). A
 * failed read degrades to "nobody has practice facts", the status quo verdict,
 * as the QB depth chart read does. Read path only: nothing is stored.
 */
async function loadPracticeFacts({ client, season, week, playerIds }) {
  // Required here, not at the top: practiceParticipation.service reaches the
  // sync services, which reach this module, so a top-level require changes the
  // load order of that cycle (settleFollowUp.service's `computeLeagueOdds`).
  const practiceParticipation = require('./practiceParticipation.service');
  return degradingRead({
    client, savepoint: 'practice_facts', label: 'Practice participation', fallback: new Map(),
    read: async () => {
      const observed = await practiceParticipation.loadWeekObservations(client, { season, week, playerIds });
      if (observed.size === 0) return new Map();
      const kickoffs = await client.query(
        `SELECT "p"."id" AS "player_id", MIN("g"."kickoff_at") AS "kickoff_at"
         FROM "players" "p" JOIN "nfl_games" "g"
           ON "g"."season" = $1 AND "g"."week" = $2
          AND fn_normalize_nfl_team("g"."nfl_team") = fn_normalize_nfl_team("p"."nfl_team")
         WHERE "p"."id" = ANY($3::int[]) GROUP BY "p"."id"`,
        [season, week, [...observed.keys()]]
      );
      const kickoffById = new Map(kickoffs.rows.map((r) => [Number(r.player_id), r.kickoff_at]));
      return new Map([...observed].map(([id, observations]) => [id, { observations, kickoffAt: kickoffById.get(id) ?? null }]));
    },
  });
}

/**
 * The Weekly projection result (#1702, unparked #1495): wraps a
 * `getWeeklyProjections` / `getWeeklyProjectionsForWeeks` run with the
 * accessors (six at #1702, plus `positionBaselineFor` from #1775 and
 * `startVerdictFor` from #2042) the Decision card module and the decision service each used to
 * hand-roll for themselves - three private helpers in
 * `playerCard.service.js` and one in `decision.service.js`, all retired by
 * the migrate ticket (#1703) in favor of these - so a caller reads the SAME
 * answer every other reader of the run already does. Every accessor is
 * defined over the raw run entry the engine emits (mean, median, p10, p90,
 * factors, confidence, activeProbability) — no producer emits a bare number,
 * so there is no number branch here either.
 *
 * `run`'s own fields (`season`, `week`, `modelVersion`, `scoringHash`,
 * `generatedAt`, `inputCutoff`, `sourceCoverage`, `projections`) are carried
 * through unchanged, so every existing reader of a `getWeeklyProjections` /
 * `getWeeklyProjectionsForWeeks` run keeps working untouched. The legacy
 * `{ points, source, ... }` map that used to be reachable from the result
 * (`toLegacyMap()`) was removed by the contract ticket (#1704) once the
 * migrate ticket (#1703) had moved every caller onto the accessors.
 */
function toWeeklyProjectionResult(run) {
  const entryFor = (playerId) => run.projections.get(playerId) || null;
  const isPositionBaseline = (playerId) => isPositionBaselineEntry(entryFor(playerId));
  // ADR 0057: the loaders attach the read's chart verdict as `run.backupIds`.
  const isBackup = (playerId) => !!(run.backupIds && run.backupIds.has(Number(playerId)));

  return {
    ...run,

    /**
     * The Point estimate (`pointEstimateFor`) for `playerId`; `null` when
     * there is none. Never coerces to 0 — a caller that wants that keeps its
     * own `|| 0`, the same coercion `playerCard.service.js`'s deleted
     * `pointsOf` used to apply.
     */
    pointsFor(playerId) {
      const entry = entryFor(playerId);
      const point = entry ? pointEstimateFor(entry) : null;
      return point == null ? null : Number(point);
    },

    /** Unavailable plus reason code, or the Point estimate — what the deleted `classifyWeekProjection` used to compute. */
    classify(playerId) {
      return classifyProjectionEntry(entryFor(playerId));
    },

    /**
     * `{ rank, of } | null` from the engine's opponent factor
     * (`rankOpponentDefense`'s convention: rank 1 = toughest matchup).
     * `null` whenever the factor carries no `rank` (no opponent data, an
     * insufficient sample, or no entry for `playerId` at all) — never the
     * `decisionCardContext.opponentEntries` rank, a different convention
     * with no sample gate that this accessor never merges with.
     */
    opponentRankFor(playerId) {
      const entry = entryFor(playerId);
      const opponent = entry && entry.factors ? entry.factors.opponent : null;
      if (!opponent || opponent.rank == null) return null;
      return { rank: opponent.rank, of: opponent.of };
    },

    /** `factors.opponent.available` — the flag behind the "context only" label. */
    opponentAppliedFor(playerId) {
      const entry = entryFor(playerId);
      return !!(entry && entry.factors && entry.factors.opponent && entry.factors.opponent.available);
    },

    /**
     * `factors.weather.scored` (#1853): whether the Model version actually let
     * the forecast move this player's number. The weather Factor is `available`
     * whenever a forecast exists, so `available` (the opponent flag's source)
     * would read "applied" for a forecast v3.1 multiplies by zero; `scored` is
     * the flag that says the effect can reach the output. `weatherEffect`
     * hard-codes `scored: false` today, so a Model version that applies weather
     * must also change that function; raising `constants.weather.maxEffect`
     * alone would leave this flag, and the "context only" label, false.
     */
    weatherAppliedFor(playerId) {
      const entry = entryFor(playerId);
      return !!(entry && entry.factors && entry.factors.weather && entry.factors.weather.scored === true);
    },

    /** `factors.gameEnvironment.scored` (#1853): the market (Line) Factor's applied flag, on the same terms as `weatherAppliedFor`. */
    marketAppliedFor(playerId) {
      const entry = entryFor(playerId);
      return !!(entry && entry.factors && entry.factors.gameEnvironment && entry.factors.gameEnvironment.scored === true);
    },

    /** The factors object exactly as the engine produced it, or `null` for no entry. */
    factorsFor(playerId) {
      const entry = entryFor(playerId);
      return entry ? entry.factors : null;
    },

    /**
     * True when the stored row is a Position-baseline projection: its
     * data-quality reasons contain `position baseline` (#1775), which the
     * engine adds for every row built on the position average alone (no games,
     * no prior season). Read-path only: feed it to `unavailableFor` as
     * `positionBaseline`. The stored row and the engine are untouched.
     */
    positionBaselineFor(playerId) {
      return isPositionBaseline(playerId);
    },

    /**
     * The Start verdict (CONTEXT.md; spec #2042): `{ outcome, reason,
     * numberTrusted }`, the one verdict per player for this run's week, with
     * every fact the read holds: the stored designation, Position-baseline, the
     * Backup chart (ADR 0057: a Backup quarterback is behind an available
     * teammate on his team's fresh QB Depth chart; his number is his own
     * evidence and stays) and this week's Practice participation
     * (`run.practiceById`, `{ observations, kickoffAt }` per player; only the
     * single-week reader loads it, so a multi-week run never reads
     * `no_practice`). A stored Unavailable verdict (bye, No NFL team, Practice
     * squad, Out, IR) is taken as stored; every other precedence step is
     * `unavailableFor`'s. Derived on read, never stored: the engine, the stored
     * rows and every holdout capture are unchanged.
     */
    startVerdictFor(playerId) {
      const entry = entryFor(playerId);
      const stored = ((entry && entry.factors) || {}).availability || {};
      if (stored.available === false) return startVerdictOf(stored);
      return startVerdictOf(unavailableFor({
        injuryStatus: stored.status || null,
        positionBaseline: isPositionBaseline(playerId),
        backup: isBackup(playerId),
        practice: (run.practiceById && run.practiceById.get(Number(playerId))) || null,
      }));
    },

    /** `{ mean, median, p10, p90, confidence, activeProbability } | null`. */
    detailFor(playerId) {
      const entry = entryFor(playerId);
      if (!entry) return null;
      const { mean, median, p10, p90, confidence, activeProbability } = entry;
      return { mean, median, p10, p90, confidence, activeProbability };
    },
  };
}

module.exports = {
  ProjectionError,
  PUBLIC,
  MODEL_VERSION: model.MODEL_VERSION,
  extrapolateWeekly,
  getWeekProjections,
  getPoolWideProjections,
  getRestOfSeasonProjections,
  getTradeProjectionMetrics,
  getPositionDefense,
  // free_baseline_v2
  getWeeklyProjections,
  getWeeklyProjectionsForWeeks,
  getRestOfSeason,
  // Re-exported for playerCard.service.js (#1306 Ruling item 4): `throughWeek`
  // and `seasonEnd` are both the league's last playoff week.
  lastPlayoffWeek,
  invalidateWeeklyProjectionRuns,
  // #1789: cached availability reconcile
  reconcileAvailability,
  liveReconcileScope,
  generateProjections,
  projectFromBundle,
  priorSeasonPerGame,
  playerResidualsFrom,
  buildSourceCoverage,
  distinctGamesFor,
  pointEstimateFor,
  isPositionBaselineEntry,
  backupQuarterbackIds,
  toWeeklyProjectionResult,
};
