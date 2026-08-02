const pool = require('../modules/pool');
const model = require('./projectionModel');
const features = require('./projectionFeatures');
const { rulesForLeague, SCORING_RULES, calculateFantasyPoints, hasTeamDefenseTiers } = require('./scoring.service');
const { expertCoverage } = require('./expertProjection.provider');

class ProjectionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

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
 * `getWeekProjections({ league, playerIds })` is the bridge: given both, it
 * routes through the v2 engine and returns the SAME `Map<playerId,
 * { points, source }>` shape, with the richer fields carried alongside. That
 * is what lets the start/sit path upgrade without touching a single other
 * caller.
 *
 * Rest-of-season projections are a third, separate horizon (see
 * `getRestOfSeasonProjections`) and are deliberately left on the original
 * producer.
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
 * Projections for (season, week) as a Map playerId -> { points, source }.
 *
 * Called with no `league`/`playerIds` (every pre-existing caller) this is the
 * original pool-wide extrapolator, byte-for-byte. Called WITH both, it runs
 * `free_baseline_v2` for exactly those players under that league's scoring
 * rules and returns the same map shape plus the richer per-player fields
 * (`projection`, `confidence`, `factors`, ...), so a consumer can opt in
 * field-by-field instead of all at once.
 */
async function getWeekProjections({ season, week, refresh = false, league = null, playerIds = null }) {
  const ids = Array.isArray(playerIds) ? playerIds : null;
  if (!league || !ids) return getPoolWideProjections({ season, week, refresh });

  const run = await getWeeklyProjections({ season, week, league, playerIds: ids, refresh });
  return toLegacyProjectionMap(run);
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
  for (const [playerId, { points }] of weekly) {
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
    const projection = weekly.get(playerId);
    const projectedPoints = projection && typeof projection === 'object'
      ? projection.points
      : projection;
    const perGameProjection = Number.isFinite(Number(projectedPoints))
      ? Number(projectedPoints)
      : 0;
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
 */
async function getPositionDefense({ season, uptoWeek }) {
  const result = await pool.query(
    `SELECT "nfl_games"."opponent" AS "defense", "players"."position",
            SUM("player_stats"."fantasy_points") AS "points",
            COUNT(DISTINCT "player_stats"."week") AS "games"
     FROM "player_stats"
     JOIN "players" ON "players"."id" = "player_stats"."player_id"
     JOIN "nfl_games" ON "nfl_games"."season" = "player_stats"."season"
       AND "nfl_games"."week" = "player_stats"."week"
       AND "nfl_games"."nfl_team" = "players"."nfl_team"
     WHERE "player_stats"."season" = $1 AND "player_stats"."week" < $2
     GROUP BY "nfl_games"."opponent", "players"."position"`,
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
 * Assemble one player's projection from an already-loaded feature bundle.
 * Pure with respect to the database: everything it reads comes from `bundle`,
 * which is what lets the backtest script replay it over history and the tests
 * exercise it without a connection.
 */
function projectFromBundle({
  playerId, bundle, rules, season, week, hashValue, weatherByGameKey,
  constants = model.MODEL_CONSTANTS,
  // Gate 2 sweep seam (PHASE5_EXECUTION_SPEC.md section 6.5), forwarded
  // unchanged to model.projectPlayer. Validated at the top of the function
  // body, before ANY other logic - including before the `!player` early
  // return below, where it is never actually invoked.
  onPreHomeAwayBaseline,
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
  const opponent = model.opponentEffect({
    allowedPerGame: allowance ? allowance.allowedPerGame : null,
    leagueAveragePerGame: context ? context.leagueAllowedPerGame : null,
    games: allowance ? allowance.games : 0,
    opponentTeam,
    constants: constants.opponent,
  });

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

  const availability = model.availabilityFor({
    injuryStatus: player.injury_status,
    onBye,
  });

  return model.projectPlayer({
    playerId,
    position: player.position,
    season,
    week,
    constants,
    scoringHashValue: hashValue,
    priorGames,
    priorSeasonPerGame: priorSeasonPerGame(bundle.seasonRowsByPlayer.get(playerId), rules, season),
    positionBaselinePerGame: context ? context.baselinePerGame : null,
    // Shrinkage target for the usage component's points-per-opportunity. Null
    // whenever the scan found no rows with computable opportunities, which is
    // every pre-enrichment database and every K/DEF/IDP group.
    positionEfficiencyPerOpportunity: context ? context.efficiencyPerOpportunity : null,
    playerResiduals: playerResidualsFrom(priorGames),
    pooledResiduals: context ? context.residuals : [],
    opponent,
    versusOpponent,
    homeAway,
    weather,
    availability,
    hasRoleData: priorGames.some((g) => g.hasRole),
    onPreHomeAwayBaseline,
  });
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
      latitude: game.latitude,
      longitude: game.longitude,
    });
  }
  return [...games.values()];
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
  // Gate 2 sweep seam (PHASE5_EXECUTION_SPEC.md section 6.5), forwarded
  // unchanged into every per-player projectFromBundle call. Validated at the
  // top of the function body, before ANY other logic - so an empty
  // `playerIds` call still validates and still throws on a bad type even
  // though the per-player loop below never executes.
  onPreHomeAwayBaseline,
}) {
  if (onPreHomeAwayBaseline !== undefined && typeof onPreHomeAwayBaseline !== 'function') {
    throw new Error('generateProjections: onPreHomeAwayBaseline must be undefined or a function');
  }
  const bundle = await features.loadFeatureBundle({ season, week, playerIds, rules, client });

  // Weather is strictly optional context and must never be able to fail the
  // request: any throw or rejection degrades to "no weather".
  let weatherByGameKey = new Map();
  let weatherCoverage = { status: 'unavailable', reason: 'not requested' };
  const weather = weatherService === null ? require('./nwsWeather.service') : weatherService;
  if (weather) {
    try {
      const result = await weather.getForecastsForGames({
        season,
        week,
        games: distinctGamesFor(bundle, playerIds),
        now,
        client,
      });
      weatherByGameKey = result.byGame;
      weatherCoverage = result.coverage;
    } catch (err) {
      console.error('projections: weather lookup failed, continuing without it:', err.message);
      weatherCoverage = { status: 'unavailable', reason: 'lookup failed' };
    }
  }

  const projections = new Map();
  for (const playerId of playerIds) {
    projections.set(
      playerId,
      projectFromBundle({
        playerId, bundle, rules, season, week, hashValue, weatherByGameKey,
        constants: modelConstants,
        onPreHomeAwayBaseline,
      })
    );
  }

  return {
    projections,
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

async function loadCachedRows({ runId, playerIds, client }) {
  const result = await client.query(
    `SELECT "player_id", "mean", "median", "p10", "p25", "p75", "p90",
            "active_probability", "confidence", "sample_size", "factors"
     FROM "player_week_projections"
     WHERE "run_id" = $1 AND "player_id" = ANY($2::int[])`,
    [runId, playerIds]
  );
  const byPlayer = new Map();
  const num = (v) => (v == null ? null : Number(v));
  for (const row of result.rows) {
    byPlayer.set(row.player_id, {
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
    });
  }
  return byPlayer;
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
 */
async function getWeeklyProjections({
  season,
  week,
  league = null,
  playerIds = [],
  refresh = false,
  client = pool,
  now = new Date(),
  weatherService = null,
}) {
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  const rules = league ? rulesForLeague(league) : SCORING_RULES;
  const hashValue = model.scoringHash(rules);
  const empty = {
    season, week, modelVersion: model.MODEL_VERSION, scoringHash: hashValue,
    generatedAt: new Date().toISOString(), inputCutoff: null,
    sourceCoverage: features.emptyCoverage(), projections: new Map(),
  };
  if (ids.length === 0) return empty;

  let run = refresh ? null : await findRun({ season, week, hashValue, client });
  let cached = new Map();
  if (run) {
    cached = await loadCachedRows({ runId: run.id, playerIds: ids, client });
    const missing = ids.filter((id) => !cached.has(id));
    if (missing.length === 0) {
      return {
        season,
        week,
        modelVersion: model.MODEL_VERSION,
        scoringHash: hashValue,
        generatedAt: run.generated_at ? new Date(run.generated_at).toISOString() : null,
        inputCutoff: run.input_cutoff ? new Date(run.input_cutoff).toISOString() : null,
        sourceCoverage: run.source_coverage || {},
        projections: cached,
      };
    }
  }

  const toGenerate = run ? ids.filter((id) => !cached.has(id)) : ids;
  const generated = await generateProjections({
    season, week, rules, playerIds: toGenerate, hashValue, client, now, weatherService,
  });

  const saved = await upsertRun({
    season,
    week,
    hashValue,
    inputCutoff: generated.inputCutoff,
    sourceCoverage: generated.sourceCoverage,
    client,
  });
  run = saved || run;
  try {
    await saveProjections({ runId: run.id, projections: generated.projections, client });
  } catch (err) {
    // A cache write failure must not deny the caller a projection it already
    // computed; the next request simply regenerates.
    console.error('projections: cache write failed:', err.message);
  }

  const merged = new Map(cached);
  for (const [id, projection] of generated.projections) merged.set(id, projection);

  return {
    season,
    week,
    modelVersion: model.MODEL_VERSION,
    scoringHash: hashValue,
    generatedAt: run && run.generated_at ? new Date(run.generated_at).toISOString() : new Date().toISOString(),
    inputCutoff: generated.inputCutoff ? new Date(generated.inputCutoff).toISOString() : null,
    sourceCoverage: generated.sourceCoverage,
    projections: merged,
  };
}

/**
 * Adapter: a v2 run -> the legacy `Map<playerId, { points, source }>` every
 * existing consumer expects, with the new fields carried alongside so callers
 * can adopt them one at a time.
 *
 * `points` is the MEDIAN when we have one (the middle of the simulated
 * outcomes, which is the number a manager should compare) and falls back to
 * the mean. A player with no projection at all reports `points: null` and
 * `source: 'unavailable'` — never a fabricated 0.
 */
function toLegacyProjectionMap(run) {
  const out = new Map();
  for (const [playerId, projection] of run.projections) {
    const point = projection.median != null ? projection.median : projection.mean;
    out.set(playerId, {
      points: point == null ? null : Number(point),
      source: point == null ? 'unavailable' : model.MODEL_VERSION,
      projection,
      confidence: projection.confidence,
      activeProbability: projection.activeProbability,
      factors: projection.factors,
      modelVersion: run.modelVersion,
      generatedAt: run.generatedAt,
      inputCutoff: run.inputCutoff,
    });
  }
  return out;
}

module.exports = {
  ProjectionError,
  MODEL_VERSION: model.MODEL_VERSION,
  extrapolateWeekly,
  getWeekProjections,
  getPoolWideProjections,
  getRestOfSeasonProjections,
  getTradeProjectionMetrics,
  getPositionDefense,
  // free_baseline_v2
  getWeeklyProjections,
  invalidateWeeklyProjectionRuns,
  generateProjections,
  projectFromBundle,
  priorSeasonPerGame,
  playerResidualsFrom,
  buildSourceCoverage,
  distinctGamesFor,
  toLegacyProjectionMap,
};
