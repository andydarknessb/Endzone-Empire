/**
 * Season summary: aggregate a player's weekly stats into a season total,
 * build the player quick-view summary payload, the guarded 17-game pace
 * projection, and a player's season position rank. Split out of
 * scoring.service.js (#1504, spec #1492) as one of the six modules the old
 * scoring module now re-exports whole.
 */
const pool = require('../modules/pool');
const { SCORING_RULES, calculateFantasyPoints, hasTeamDefenseTiers } = require('./scoringRules');

/**
 * Pure: sum an array of weekly stat objects into one season total. Every
 * numeric stat key is added up; `games` counts the rows (weeks played).
 * Non-numeric / unknown values are ignored.
 */
function aggregateSeasonStats(weeklyStats) {
  const totals = {};
  let games = 0;
  for (const raw of weeklyStats || []) {
    let stats = raw;
    if (typeof stats === 'string') {
      try { stats = JSON.parse(stats); } catch { stats = null; }
    }
    if (!stats || typeof stats !== 'object') continue;
    games += 1;
    for (const [key, value] of Object.entries(stats)) {
      const n = Number(value);
      if (Number.isFinite(n)) totals[key] = Math.round(((totals[key] || 0) + n) * 100) / 100;
    }
  }
  return { games, stats: totals };
}

/**
 * Pure: assemble the player quick-view summary payload from already-fetched
 * rows. Kept free of DB access so it's unit-testable.
 *   - player:      the players row
 *   - weeklyRows:  player_stats rows [{ season, week, stats }] (any order)
 *   - seasonRows:  player_season_stats rows [{ season, games_played, stats }]
 *   - rules:       scoring rules to price every stat line under
 *   - byeWeek:     precomputed bye week (number) or null
 *   - currentSeasonYear: the league's current season (default 2026)
 * currentSeason holds this-season weekly lines (null before any are played);
 * previousSeasons lists every completed season (< current) from the rollups,
 * newest first, points RE-SCORED under `rules`. `fantasy` is the draft-facing
 * summary: ADP, last completed season's total, and a projected point total for
 * the upcoming season (that season's per-game pace over a 17-game slate).
 */
// Fewest completed-season games we'll extrapolate a projection from — below
// this the per-game pace is too noisy to scale to a full season.
const MIN_PROJECTION_GAMES = 4;

/**
 * Guarded full-season projection: the most recent completed season's per-game
 * pace under `rules`, extrapolated over a 17-game slate. Returns null when the
 * sample is too small (< MIN_PROJECTION_GAMES) or there's no prior season, so
 * the draft board and the quick-view report the same number for a player.
 */
function projectSeasonPoints({ seasonRows = [], rules = SCORING_RULES, currentSeasonYear = 2026 }) {
  const currentYear = Number(currentSeasonYear) || 2026;
  const lastCompleted = [...seasonRows]
    .filter((r) => r.season < currentYear)
    .sort((a, b) => b.season - a.season)[0];
  if (!lastCompleted) return null;
  const games = Number(lastCompleted.games_played) || 0;
  if (games < MIN_PROJECTION_GAMES) return null;
  // DEF rollups can't be scored as aggregates (see hasTeamDefenseTiers) — use
  // the stored weekly-summed season total instead. Accepted deviation: that
  // total is under default rules, so custom league DEF tiers don't move it.
  const seasonTotal = hasTeamDefenseTiers(lastCompleted.stats)
    ? Number(lastCompleted.fantasy_points)
    : calculateFantasyPoints(lastCompleted.stats, rules);
  const perGame = seasonTotal / games;
  if (!perGame || !Number.isFinite(perGame)) return null;
  return Math.round(perGame * 17 * 10) / 10;
}

function buildPlayerSummary({
  player,
  weeklyRows = [],
  seasonRows = [],
  rules = SCORING_RULES,
  byeWeek = null,
  currentSeasonYear = 2026,
  // { season, rank, groupSize } from getSeasonPositionRank, or null. Passed in
  // (not queried here) so this builder stays pure over its row inputs.
  posRank = null,
}) {
  const currentYear = Number(currentSeasonYear) || 2026;

  const weekly = [...weeklyRows]
    .filter((r) => r.season === currentYear)
    .sort((a, b) => a.week - b.week)
    .map((r) => ({
      week: r.week,
      stats: r.stats,
      fantasy_points: calculateFantasyPoints(r.stats, rules),
    }));
  const currentPoints = Math.round(weekly.reduce((s, w) => s + w.fantasy_points, 0) * 100) / 100;
  const currentSeason = weekly.length === 0 ? null : {
    season: currentYear,
    weekly,
    games: weekly.length,
    points: currentPoints,
    perGame: Math.round((currentPoints / weekly.length) * 10) / 10,
  };

  const previousSeasons = [...seasonRows]
    .filter((r) => r.season < currentYear)
    .sort((a, b) => b.season - a.season)
    .map((r) => {
      // A DEF rollup can't be scored as an aggregate (see hasTeamDefenseTiers);
      // price its weekly lines individually so the per-game tiers land once per
      // game, under this league's own rules. Falls back to aggregate scoring
      // only when we hold no weeklies for that season.
      const seasonWeeklies = hasTeamDefenseTiers(r.stats)
        ? weeklyRows.filter((w) => w.season === r.season)
        : [];
      const points = seasonWeeklies.length
        ? Math.round(seasonWeeklies.reduce((sum, w) => sum + calculateFantasyPoints(w.stats, rules), 0) * 100) / 100
        : calculateFantasyPoints(r.stats, rules);
      const games = Number(r.games_played) || 0;
      return {
        season: r.season,
        games,
        stats: r.stats,
        points,
        perGame: games ? Math.round((points / games) * 10) / 10 : 0,
      };
    });

  // Draft-facing fantasy summary. Projection extrapolates the most recent
  // completed season's per-game pace across a full 17-game slate — but only
  // from a large enough sample; a 1-2 game season would inflate wildly, so we
  // report no projection there rather than a misleading one.
  const lastCompleted = previousSeasons[0] || null;
  const adp = player.adp != null && Number.isFinite(Number(player.adp)) ? Number(player.adp) : null;
  const canProject = lastCompleted && lastCompleted.games >= MIN_PROJECTION_GAMES && lastCompleted.perGame;
  const fantasy = {
    adp,
    posRank: posRank ? posRank.rank : null,
    posRankOf: posRank ? posRank.groupSize : null,
    posRankSeason: posRank ? posRank.season : null,
    previousSeasonYear: lastCompleted ? lastCompleted.season : null,
    previousSeasonTotal: lastCompleted ? lastCompleted.points : null,
    projectionSeason: currentYear,
    projectedPoints: canProject ? Math.round(lastCompleted.perGame * 17 * 10) / 10 : null,
  };

  return {
    player: {
      id: player.id,
      name: player.name,
      position: player.position,
      nfl_team: player.nfl_team,
      jersey_number: player.jersey_number,
      external_id: player.external_id,
      injury_status: player.injury_status,
      injury_detail: player.injury_detail,
      news: player.news,
      photo_url: player.photo_url,
      adp,
      bye_week: byeWeek,
    },
    fantasy,
    currentSeason,
    previousSeasons,
  };
}

/**
 * A player's rank among the same literal position code (CB ranks against CB,
 * not the DB group) by stored season fantasy_points, from player_season_stats.
 * The stored points are the app-default (half-PPR) values — for DEF they're
 * weekly-summed, so ranking on them never re-scores a season aggregate against
 * the per-game pointsAllowed/yardsAllowed tiers. One number regardless of any
 * client scoring-format toggle.
 *
 * Returns { rank, groupSize } or null when the player has no rollup row for
 * that season. Ties share a rank (RANK(), not ROW_NUMBER()).
 */
async function getSeasonPositionRank(playerId, position, season) {
  if (!position || !Number.isInteger(Number(season))) return null;
  const result = await pool.query(
    `SELECT "rank", "group_size" FROM (
       SELECT "pss"."player_id",
              RANK() OVER (ORDER BY "pss"."fantasy_points" DESC) AS "rank",
              COUNT(*) OVER ()::int AS "group_size"
       FROM "player_season_stats" "pss"
       JOIN "players" "p" ON "p"."id" = "pss"."player_id"
       WHERE "p"."position" = $2 AND "pss"."season" = $3
     ) "ranked" WHERE "player_id" = $1`,
    [playerId, position, season]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { rank: Number(row.rank), groupSize: Number(row.group_size) };
}

module.exports = {
  aggregateSeasonStats,
  buildPlayerSummary,
  projectSeasonPoints,
  getSeasonPositionRank,
};
