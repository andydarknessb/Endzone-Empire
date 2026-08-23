/**
 * Public read-model for the no-login "Public Layer".
 *
 * Everything the unauthenticated /api/public/* router serves flows through
 * here. Two hard rules keep this safe (guardrail #2):
 *
 *  1. It reads ONLY global, league-free NFL tables: players, player_stats,
 *     player_season_stats, player_projections, nfl_games, live_game_states,
 *     private.game_recaps. It NEVER touches a user- or league-scoped table
 *     (matchups, teams, team_players, league_analytics, lineup_entries, …).
 *  2. Every value returned to the client passes through an explicit
 *     serializer below that names each field. There is no `SELECT *`
 *     passthrough to the response, so a `user_id`/`league_id` column can't
 *     leak even if a future query accidentally selects one.
 *
 * Fantasy points are recomputed from global stat lines under the three public
 * presets. Half-PPR remains the scalar default for backwards compatibility.
 */
const pool = require('../modules/pool');
const {
  RECAPS_TABLE_SQL,
  isMissingRecapStorage,
} = require('../modules/recapStorage');
const { getWeekProjections } = require('./projection.service');
const { computeByeWeeks } = require('./bye.service');
const { upcomingNflSeason } = require('./nflSeason.service');
const bestAvailable = require('./bestAvailable.service');
const {
  calculateFantasyPoints, SCORING_PRESETS, IDP_POSITIONS, getSeasonPositionRank,
  projectSeasonPoints,
} = require('./scoring.service');

const POSITION_WHITELIST = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', ...IDP_POSITIONS];
const MAX_RANKINGS_LIMIT = 100;

// Draft-pool membership (CONTEXT.md "Draft pool"): every offense/K/DEF player
// who has an ADP or produced last completed season, in best-available order —
// a RULE, not a count. DRAFT_POOL_LIMIT is a safety ceiling far above that
// rule's expected size (~660 as of 2026-08-22), not the cap it used to be.
const DRAFT_POOL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const DRAFT_POOL_LIMIT = 5000;
const DRAFT_POOL_IDP_LIMIT = 90;

// A compact "key stat line" for a weekly/game row: the handful of normalized
// stat keys worth showing, in a stable order, skipping zeros. Keys match
// scoring.service.normalizeTank01Stats / normalizeTank01DstStats /
// normalizeTank01IdpStats output. Offensive and defensive keys never co-occur
// on one row, so a single ordered list serves every position.
// Keep in sync with src/components/PlayerQuickView/statLine.js.
const STAT_LINE_FIELDS = [
  ['passingYards', 'pass yds'],
  ['passingTDs', 'pass TD'],
  ['interceptions', 'INT'],
  ['rushingYards', 'rush yds'],
  ['rushingTDs', 'rush TD'],
  ['receptions', 'rec'],
  ['receivingYards', 'rec yds'],
  ['receivingTDs', 'rec TD'],
  ['fieldGoal', 'FG'],
  ['extraPoint', 'XP'],
  // Team defense
  ['sack', 'Sk'],
  ['interceptionReturn', 'INT'],
  ['fumbleRecovery', 'FR'],
  ['defensiveTD', 'TD'],
  ['safety', 'Sfty'],
  ['blockedKick', 'Blk'],
  ['pointsAllowed', 'PA'],
  ['yardsAllowed', 'YdA'],
  // Individual defenders (IDP). Sack/TFL/fumble-return YARDAGE keys are
  // deliberately omitted — they're opt-in bonus inputs, not headline stats.
  ['soloTackle', 'Solo'],
  ['assistedTackle', 'Ast'],
  ['idpSack', 'Sk'],
  ['idpInterception', 'INT'],
  ['forcedFumble', 'FF'],
  ['idpFumbleRecovery', 'FR'],
  ['passDeflection', 'PD'],
  ['qbHit', 'QBH'],
  ['tacklesForLoss', 'TFL'],
  ['idpSafety', 'Sfty'],
  ['idpDefensiveTD', 'TD'],
  ['twoPointReturn', '2pt Ret'],
];

// Stats whose zero is itself the story — a defense that pitched a shutout
// should read "0 PA", not drop the field entirely.
const ALWAYS_SHOW_STATS = new Set(['pointsAllowed']);

function statLine(stats) {
  if (!stats || typeof stats !== 'object') return '';
  const parts = [];
  for (const [key, label] of STAT_LINE_FIELDS) {
    const value = Number(stats[key]);
    if (!Number.isFinite(value)) continue;
    if (value !== 0 || ALWAYS_SHOW_STATS.has(key)) parts.push(`${value} ${label}`);
  }
  return parts.join(', ');
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

/**
 * Fantasy points for one stat line under all three public scoring formats.
 * The presets differ ONLY in receptions-per-point (0 / 0.5 / 1), so kickers
 * and defenses (no receptions) come out identical across formats — no special
 * casing needed. Reuses the canonical scoring engine so there is a single
 * source of truth; the client just picks a number, it never re-scores.
 */
function pointsByFormat(stats) {
  return {
    standard: round1(calculateFantasyPoints(stats, SCORING_PRESETS.standard)),
    halfPpr: round1(calculateFantasyPoints(stats, SCORING_PRESETS.half_ppr)),
    ppr: round1(calculateFantasyPoints(stats, SCORING_PRESETS.ppr)),
  };
}

/** Sum per-format points across a season's weekly stat lines. Used when no
 * player_season_stats rollup exists, and ALWAYS for team defenses: the
 * teamDefense pointsAllowed/yardsAllowed rules are per-game tier tables, so
 * scoring a season aggregate would tier-match the season total once instead of
 * once per game. Summing per week is the only correct DEF computation. */
function sumPointsByFormat(statsList) {
  const totals = { standard: 0, halfPpr: 0, ppr: 0 };
  for (const stats of statsList) {
    totals.standard += calculateFantasyPoints(stats, SCORING_PRESETS.standard);
    totals.halfPpr += calculateFantasyPoints(stats, SCORING_PRESETS.half_ppr);
    totals.ppr += calculateFantasyPoints(stats, SCORING_PRESETS.ppr);
  }
  return { standard: round1(totals.standard), halfPpr: round1(totals.halfPpr), ppr: round1(totals.ppr) };
}

/** Per-game average of a per-format points object. */
function perGamePoints(points, games) {
  const div = (v) => (games > 0 ? round1(Number(v) / games) : 0);
  return { standard: div(points.standard), halfPpr: div(points.halfPpr), ppr: div(points.ppr) };
}

/**
 * Latest season/week actually present in weekly stats, so callers can default
 * to "now" without hardcoding a year. Returns { season, week } or nulls when
 * there is no stat data at all.
 */
async function latestSeasonWeek() {
  const seasonRes = await pool.query(`SELECT MAX("season")::int AS season FROM "player_stats"`);
  const season = seasonRes.rows[0] && seasonRes.rows[0].season;
  if (season == null) return { season: null, week: null };
  const weekRes = await pool.query(
    `SELECT MAX("week")::int AS week FROM "player_stats" WHERE "season" = $1`,
    [season]
  );
  return { season, week: (weekRes.rows[0] && weekRes.rows[0].week) || null };
}

/** Trend from a player's played weeks: compare the last two played weeks. */
function trendFromWeeks(weekRows) {
  if (!weekRows || weekRows.length < 2) return 'flat';
  const sorted = [...weekRows].sort((a, b) => a.week - b.week);
  const last = Number(sorted[sorted.length - 1].fantasy_points);
  const prev = Number(sorted[sorted.length - 2].fantasy_points);
  if (last > prev) return 'up';
  if (last < prev) return 'down';
  return 'flat';
}

/**
 * Ranked player rows for the rankings page. Ranks by season total points
 * (desc), tie-broken by projected points, then name. Totals are the ranking
 * key on purpose: projections here are bare per-game averages with no
 * minimum-games floor, so a two-game hot streak would outrank a full-season
 * performer. Caps at 100.
 */
async function getRankings({ position = 'ALL', season, week, limit = 50 } = {}) {
  const resolvedLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_RANKINGS_LIMIT);

  let targetSeason = season;
  let targetWeek = week;
  if (targetSeason == null || targetWeek == null) {
    const latest = await latestSeasonWeek();
    if (targetSeason == null) targetSeason = latest.season;
    if (targetWeek == null) targetWeek = latest.week;
  }
  if (targetSeason == null || targetWeek == null) {
    return { season: null, week: null, rankings: [] };
  }

  const positionFilter = position && position !== 'ALL' ? position : null;

  // Global projection map (playerId -> {points, source}) for the target week.
  let projections;
  try {
    projections = await getWeekProjections({ season: targetSeason, week: targetWeek });
  } catch (err) {
    console.error('public rankings: projection lookup failed', err.message);
    projections = new Map();
  }

  // Candidate pool: players (optionally by position) with their season points
  // aggregated from weekly rows (always accurate for the in-progress season,
  // unlike the lagging player_season_stats rollup).
  const params = [targetSeason];
  let positionClause = '';
  if (positionFilter) {
    params.push(positionFilter);
    positionClause = `WHERE "p"."position" = $${params.length}`;
  }
  const candidatesRes = await pool.query(
    `SELECT "p"."id", "p"."name", "p"."position", "p"."nfl_team", "p"."photo_url", "p"."injury_status",
            COALESCE("agg"."season_points", 0) AS "season_points"
     FROM "players" "p"
     LEFT JOIN (
       SELECT "player_id", SUM("fantasy_points") AS "season_points"
       FROM "player_stats" WHERE "season" = $1 GROUP BY "player_id"
     ) "agg" ON "agg"."player_id" = "p"."id"
     ${positionClause}`,
    params
  );

  // Rank by season points, tie-break on projected points then name. A
  // missing projection stays null (rendered as a dash), never a fake 0.0.
  const ranked = candidatesRes.rows
    .map((row) => ({
      row,
      projected: projections.has(row.id) ? Number(projections.get(row.id).points) : null,
      seasonPoints: Number(row.season_points) || 0,
    }))
    .sort((a, b) =>
      b.seasonPoints - a.seasonPoints ||
      (b.projected ?? 0) - (a.projected ?? 0) ||
      String(a.row.name).localeCompare(String(b.row.name))
    )
    .slice(0, resolvedLimit);

  // Recent weekly points for just the ranked players: last-week points and
  // trend (last two played weeks) in one bounded query.
  const ids = ranked.map((r) => r.row.id);
  const weeksByPlayer = new Map();
  if (ids.length > 0) {
    const weeklyRes = await pool.query(
      `SELECT "player_id", "week", "fantasy_points"
       FROM "player_stats"
       WHERE "season" = $1 AND "player_id" = ANY($2) AND "week" <= $3
       ORDER BY "player_id", "week"`,
      [targetSeason, ids, targetWeek]
    );
    for (const wr of weeklyRes.rows) {
      if (!weeksByPlayer.has(wr.player_id)) weeksByPlayer.set(wr.player_id, []);
      weeksByPlayer.get(wr.player_id).push({ week: Number(wr.week), fantasy_points: Number(wr.fantasy_points) });
    }
  }

  // Bye weeks are always the UPCOMING/current NFL season's (the draft-prep
  // fact a reader needs), even while the ranked stats are last season's.
  // Soft-fail like projections: a bye lookup error degrades to dashes, never
  // a 500 on the whole rankings page.
  let byeByTeam = new Map();
  try {
    const byeSeason = await upcomingNflSeason();
    if (byeSeason != null) {
      byeByTeam = await computeByeWeeks(ranked.map((r) => r.row.nfl_team), byeSeason);
    }
  } catch (err) {
    console.error('public rankings: bye lookup failed', err.message);
  }

  const rankings = ranked.map((entry, index) => {
    const weekRows = weeksByPlayer.get(entry.row.id) || [];
    const lastWeekRow = weekRows.find((w) => w.week === targetWeek - 1);
    return serializeRankingRow({
      rank: index + 1,
      row: entry.row,
      projectedPoints: entry.projected,
      seasonPoints: entry.seasonPoints,
      lastWeekPoints: lastWeekRow ? lastWeekRow.fantasy_points : null,
      trend: trendFromWeeks(weekRows),
      byeWeek: byeByTeam.get(entry.row.nfl_team) ?? null,
    });
  });

  return { season: targetSeason, week: targetWeek, rankings };
}

function serializeRankingRow({ rank, row, projectedPoints, seasonPoints, lastWeekPoints, trend, byeWeek = null }) {
  return {
    rank,
    // `?? null` on every raw passthrough, so the key set is a property of THIS
    // serializer rather than of whatever columns the row happened to carry: a
    // query that stops selecting a column answers null here instead of
    // silently dropping the key from a payload clients read unconditionally.
    // Same rule as the invite preview (#181) and the presenter board (#199).
    playerId: row.id ?? null,
    name: row.name ?? null,
    position: row.position ?? null,
    nflTeam: row.nfl_team ?? null,
    photoUrl: row.photo_url ?? null,
    injuryStatus: row.injury_status ?? null,
    projectedPoints: projectedPoints == null ? null : round1(projectedPoints),
    lastWeekPoints: lastWeekPoints == null ? null : round1(lastWeekPoints),
    seasonPoints: round1(seasonPoints),
    trend,
    byeWeek: byeWeek == null ? null : Number(byeWeek),
  };
}

/**
 * Whitelisted public profile for one player, or null when the id doesn't
 * exist. Identity + a season dimension (complete seasons plus the upcoming
 * season as a "pending" placeholder) + the selected season's summary and last
 * ~6 game lines, every points value carried in all three public scoring
 * formats so the client can toggle without a refetch.
 *
 * Season summary is sourced from the complete player_season_stats rollup when
 * present, so totals stay correct even while the weekly player_stats table for
 * that season is only partially ingested; `weeklyLogPartial` flags that gap.
 */
async function getPlayerProfile(playerId, { season } = {}) {
  const id = Number(playerId);
  const playerRes = await pool.query(
    `SELECT "id", "name", "position", "nfl_team", "photo_url", "jersey_number",
            "injury_status", "injury_detail", "news", "adp"
     FROM "players" WHERE "id" = $1`,
    [id]
  );
  const player = playerRes.rows[0];
  if (!player) return null;

  // Seasons this player has any data for (complete), newest first.
  const seasonsRes = await pool.query(
    `SELECT DISTINCT "season" FROM "player_season_stats" WHERE "player_id" = $1
     UNION SELECT DISTINCT "season" FROM "player_stats" WHERE "player_id" = $1`,
    [id]
  );
  const completeSeasons = seasonsRes.rows
    .map((r) => Number(r.season))
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => b - a);

  // The current NFL season is a "pending" placeholder until it has player data.
  const upcoming = await upcomingNflSeason();

  const seasons = completeSeasons.map((s) => ({ season: s, status: 'complete' }));
  if (upcoming != null && !completeSeasons.includes(upcoming)) {
    seasons.push({ season: upcoming, status: 'pending' });
  }

  // Resolve target. An explicit ?season= is ALWAYS echoed back — never silently
  // swapped for the default — so a season this player lacks (past or upcoming)
  // returns a clean not-available contract instead of another season's numbers.
  // Only an absent request defaults to the latest season with data, else upcoming.
  const requested = season == null ? null : Number(season);
  const requestValid = requested != null && Number.isFinite(requested);
  const targetSeason = requestValid
    ? requested
    : completeSeasons.length ? completeSeasons[0] : upcoming;

  // Status of the target season for this player: complete (has data), pending
  // (the known upcoming season), or unavailable (any other requested season).
  const targetStatus =
    targetSeason != null && completeSeasons.includes(targetSeason) ? 'complete'
    : targetSeason != null && targetSeason === upcoming ? 'pending'
    : 'unavailable';

  // Ensure the resolved season is represented in seasons[] (an explicitly
  // requested no-data season won't already be there).
  if (targetSeason != null && !seasons.some((s) => s.season === targetSeason)) {
    seasons.push({ season: targetSeason, status: targetStatus });
  }
  seasons.sort((a, b) => b.season - a.season);

  // Non-complete season (upcoming "pending" or a season with no data for this
  // player) → an empty, not-available contract echoing the requested season.
  if (targetStatus !== 'complete') {
    return serializePlayerProfile({
      player, season: targetSeason, seasons, seasonSummary: null,
      weeklyLogPartial: false, recentRows: [],
    });
  }

  // Season summary — prefer the complete player_season_stats rollup, EXCEPT for
  // team defenses, whose points can only be summed per week (their
  // pointsAllowed/yardsAllowed rules are per-game tiers, so scoring the season
  // aggregate is wrong). DEF weekly coverage is complete, so the weekly path
  // below yields the same games count the rollup would.
  const isTeamDefense = player.position === 'DEF';
  const rollupRes = isTeamDefense
    ? { rows: [] }
    : await pool.query(
        `SELECT "games_played", "stats" FROM "player_season_stats"
         WHERE "player_id" = $1 AND "season" = $2`,
        [id, targetSeason]
      );
  let seasonSummary = null;
  if (rollupRes.rows[0]) {
    const games = Number(rollupRes.rows[0].games_played) || 0;
    const points = pointsByFormat(rollupRes.rows[0].stats);
    seasonSummary = { season: targetSeason, gamesPlayed: games, points,
      pointsPerGame: perGamePoints(points, games), fantasyPoints: points.halfPpr };
  } else {
    // Fallback: aggregate this season's weekly rows directly.
    const aggRes = await pool.query(
      `SELECT "agg"."stats" FROM "player_stats" "agg"
       WHERE "agg"."player_id" = $1 AND "agg"."season" = $2`,
      [id, targetSeason]
    );
    const statsList = aggRes.rows.map((r) => r.stats);
    if (statsList.length) {
      const points = sumPointsByFormat(statsList);
      seasonSummary = { season: targetSeason, gamesPlayed: statsList.length, points,
        pointsPerGame: perGamePoints(points, statsList.length), fantasyPoints: points.halfPpr };
    }
  }

  // Partial-weekly flag: fewer weekly rows on file than games the summary counts.
  const weeklyCountRes = await pool.query(
    `SELECT COUNT(*)::int AS "n" FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2`,
    [id, targetSeason]
  );
  const weeklyCount = Number(weeklyCountRes.rows[0] && weeklyCountRes.rows[0].n) || 0;
  const weeklyLogPartial = weeklyCount < (seasonSummary ? seasonSummary.gamesPlayed : 0);

  // Game log: every weekly row for the target season (18 rows at most —
  // an uncapped fetch is still a tiny payload), opponent via schedule. The
  // serialized field keeps its historical name `recentGames`.
  const recentRes = await pool.query(
    `SELECT "ps"."season", "ps"."week", "ps"."fantasy_points", "ps"."stats", "ng"."opponent"
     FROM "player_stats" "ps"
     LEFT JOIN "nfl_games" "ng"
       ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
      AND fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team($2)
     WHERE "ps"."player_id" = $1 AND "ps"."season" = $3
     ORDER BY "ps"."season" DESC, "ps"."week" DESC`,
    // nfl_games keys teams by Tank01 abbreviation, but a DEF unit's nfl_team
    // holds the full team name ("Denver Broncos"), so a raw string match leaves
    // every DEF game log without an opponent. fn_normalize_nfl_team collapses
    // full names AND alias codes (notably Tank01's WSH vs. WAS) to one
    // canonical abbreviation on both sides.
    [id, player.nfl_team, targetSeason]
  );

  const posRank = await getSeasonPositionRank(id, player.position, targetSeason);

  return serializePlayerProfile({
    player, season: targetSeason, seasons, seasonSummary, weeklyLogPartial,
    recentRows: recentRes.rows, posRank,
  });
}

function serializePlayerProfile({ player, season, seasons, seasonSummary, weeklyLogPartial, recentRows, posRank }) {
  return {
    // `?? null` on every raw passthrough - see serializeRankingRow.
    playerId: player.id ?? null,
    name: player.name ?? null,
    position: player.position ?? null,
    nflTeam: player.nfl_team ?? null,
    photoUrl: player.photo_url ?? null,
    jerseyNumber: player.jersey_number ?? null,
    injuryStatus: player.injury_status ?? null,
    injuryDetail: player.injury_detail ?? null,
    news: player.news ?? null,
    adp: player.adp == null ? null : Number(player.adp),
    // Rank within the same position code by the viewed season's stored points
    // (null for pending/unavailable seasons). posRankOf = peers with a rollup.
    posRank: posRank ? posRank.rank : null,
    posRankOf: posRank ? posRank.groupSize : null,
    season: season == null ? null : Number(season),
    seasons,
    seasonSummary,
    weeklyLogPartial,
    recentGames: recentRows.map((r) => {
      const points = pointsByFormat(r.stats);
      return {
        season: Number(r.season),
        week: Number(r.week),
        opponent: r.opponent || null,
        fantasyPoints: points.halfPpr,
        points,
        statLine: statLine(r.stats),
      };
    }),
  };
}

/**
 * The bulk player pool the client-side Draft Simulator drafts from: every
 * offense/K/DEF player the "Draft pool" glossary rule admits (an ADP or last
 * completed season's production — CONTEXT.md), in best-available order, plus
 * an optional IDP tranche.
 *
 * Deliberately a single bulk read rather than a paginated one — the simulator
 * is a pure client-side engine that needs the whole board in memory before the
 * first pick, and the payload (~660 thin rows) is still smaller than one page
 * of the authed player list once stats are attached.
 *
 * IDP rows carry `adp: null` ON PURPOSE. No free redraft IDP market exists (see
 * adp.service.js), so instead of inventing a number here the client owns the
 * fallback (see src/lib/draftSim/cpuBrain.js effAdp) and the report labels those
 * picks `no-market` instead of grading them as steals/reaches.
 */
async function getDraftPool({ includeIdp = false } = {}) {
  // Season context: the upcoming NFL season drives both the projection's
  // "which season is complete" cut and the bye-week schedule lookup.
  const upcoming = await upcomingNflSeason();
  const currentSeasonYear = upcoming == null ? new Date().getUTCFullYear() : upcoming;
  const lastSeasonYear = currentSeasonYear - 1;

  // Market position rank as a single window function over the whole players
  // table. RANK() is exactly `1 + peers with a lower ADP`, matching the
  // correlated-subquery definition player.router.js uses, without running
  // hundreds of correlated subqueries. last_season_points feeds the
  // best-available membership rule and tie-break below — no LIMIT here:
  // membership is a rule (CONTEXT.md "Draft pool"), not a count.
  const mainRes = await pool.query(
    `WITH "market_ranks" AS (
       SELECT "id", RANK() OVER (PARTITION BY "position" ORDER BY "adp")::int AS "rank"
       FROM "players" WHERE "adp" IS NOT NULL
     )
     SELECT "p"."id", "p"."name", "p"."position", "p"."nfl_team", "p"."photo_url",
            "p"."injury_status", "p"."adp", "market_ranks"."rank" AS "position_rank",
            "season_points"."fantasy_points" AS "last_season_points"
     FROM "players" "p"
     LEFT JOIN "market_ranks" ON "market_ranks"."id" = "p"."id"
     LEFT JOIN "player_season_stats" "season_points"
       ON "season_points"."player_id" = "p"."id" AND "season_points"."season" = $2
     WHERE "p"."position" = ANY($1)`,
    [DRAFT_POOL_POSITIONS, lastSeasonYear]
  );

  // Best available (CONTEXT.md): ADP, then last completed season's points,
  // then name — never database id. The exact same exports
  // autopick.service.js's fallback sorts through (bestAvailable.service.js);
  // DRAFT_POOL_LIMIT is a safety ceiling, not the rule.
  const mainRows = mainRes.rows
    .filter(bestAvailable.isBestAvailableEligible)
    .sort(bestAvailable.compareBestAvailable)
    .slice(0, DRAFT_POOL_LIMIT);

  let idpRows = [];
  if (includeIdp) {
    // Individual defenders have no market, so they're ordered by last completed
    // season's production rank within their own position code.
    const idpRes = await pool.query(
      `WITH "idp_ranks" AS (
         SELECT "pss"."player_id",
                RANK() OVER (
                  PARTITION BY "p"."position" ORDER BY "pss"."fantasy_points" DESC
                )::int AS "rank"
         FROM "player_season_stats" "pss"
         JOIN "players" "p" ON "p"."id" = "pss"."player_id"
         WHERE "pss"."season" = $1
           AND "p"."position" = ANY($2)
           AND "pss"."fantasy_points" IS NOT NULL
       )
       SELECT "p"."id", "p"."name", "p"."position", "p"."nfl_team", "p"."photo_url",
              "p"."injury_status", "idp_ranks"."rank" AS "position_rank"
       FROM "players" "p"
       JOIN "idp_ranks" ON "idp_ranks"."player_id" = "p"."id"
       ORDER BY "idp_ranks"."rank" ASC, "p"."id"
       LIMIT $3`,
      [currentSeasonYear - 1, IDP_POSITIONS, DRAFT_POOL_IDP_LIMIT]
    );
    idpRows = idpRes.rows;
  }

  const rows = [...mainRows, ...idpRows];
  if (rows.length === 0) return { season: currentSeasonYear, includeIdp, players: [] };

  // Full-season projection from the last completed season's rollup — the same
  // projectSeasonPoints call the authed player list makes, under default rules
  // (a mock draft has no league scoring settings to read).
  const ids = rows.map((r) => r.id);
  const seasonByPlayer = new Map();
  const seasonRes = await pool.query(
    `SELECT "player_id", "season", "games_played", "stats", "fantasy_points"
     FROM "player_season_stats" WHERE "player_id" = ANY($1)`,
    [ids]
  );
  for (const row of seasonRes.rows) {
    if (!seasonByPlayer.has(row.player_id)) seasonByPlayer.set(row.player_id, []);
    seasonByPlayer.get(row.player_id).push(row);
  }

  // Byes degrade to nulls rather than 500ing the whole pool (same soft-fail
  // posture as the rankings page).
  let byeByTeam = new Map();
  try {
    byeByTeam = await computeByeWeeks(rows.map((r) => r.nfl_team), currentSeasonYear);
  } catch (err) {
    console.error('public draft pool: bye lookup failed', err.message);
  }

  const players = rows.map((row) => serializeDraftPoolRow({
    row,
    projectedPoints: projectSeasonPoints({
      seasonRows: seasonByPlayer.get(row.id) || [],
      currentSeasonYear,
    }),
    byeWeek: byeByTeam.get(row.nfl_team) ?? null,
  }));

  return { season: currentSeasonYear, includeIdp, players };
}

function serializeDraftPoolRow({ row, projectedPoints, byeWeek }) {
  return {
    playerId: row.id ?? null,
    name: row.name,
    position: row.position,
    nflTeam: row.nfl_team,
    photoUrl: row.photo_url == null ? null : String(row.photo_url),
    injuryStatus: row.injury_status == null ? null : String(row.injury_status),
    adp: row.adp == null ? null : Number(row.adp),
    positionRank: row.position_rank == null ? null : Number(row.position_rank),
    projectedPoints: projectedPoints == null ? null : round1(projectedPoints),
    byeWeek: byeWeek == null ? null : Number(byeWeek),
  };
}

/** First sentence of a narrative, for one-line list hooks. */
function firstSentence(text) {
  if (!text || typeof text !== 'string') return '';
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

/** Recap list rows (most recent first). */
async function listRecaps({ season, week, limit = 20 } = {}) {
  const resolvedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const params = [];
  const where = [];
  if (season != null) {
    params.push(season);
    where.push(`"season" = $${params.length}`);
  }
  if (week != null) {
    params.push(week);
    where.push(`"week" = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(resolvedLimit);

  let res;
  try {
    res = await pool.query(
      `SELECT "tank01_game_id", "season", "week", "home_team", "away_team",
              "home_score", "away_score", "final_at", "data", "data_version",
              "generator_version", "generated_at"
       FROM ${RECAPS_TABLE_SQL}
       ${whereSql}
       ORDER BY "final_at" DESC NULLS LAST, "season" DESC, "week" DESC
       LIMIT $${params.length}`,
      params
    );
  } catch (err) {
    if (isMissingRecapStorage(err)) return []; // schema/table not migrated yet -> "no data"
    throw err;
  }
  return res.rows.map(serializeRecapListRow);
}

function serializeRecapListRow(row) {
  const data = row.data || {};
  return {
    gameId: row.tank01_game_id ?? null,
    season: Number(row.season),
    week: Number(row.week),
    homeTeam: row.home_team ?? null,
    awayTeam: row.away_team ?? null,
    homeScore: Number(row.home_score),
    awayScore: Number(row.away_score),
    finalAt: row.final_at ?? null,
    hook: firstSentence(data.narrative),
    topPerformer: Array.isArray(data.topPerformers) && data.topPerformers[0] && typeof data.topPerformers[0] === 'object'
      ? serializeTopPerformer(data.topPerformers[0])
      : null,
    generatedAt: row.generated_at || null,
    dataVersion: row.data_version == null ? null : Number(row.data_version),
    generatorVersion: row.generator_version || null,
  };
}

function serializeLineScore(value) {
  if (!value || typeof value !== 'object') return null;
  const side = (periods) => (
    Array.isArray(periods)
      ? periods.map((score) => Number(score)).map((score) => (Number.isFinite(score) ? score : 0))
      : []
  );
  return { home: side(value.home), away: side(value.away) };
}

function serializeScoringPlay(play) {
  return {
    quarter: play.quarter == null ? null : String(play.quarter),
    clock: play.clock == null ? null : String(play.clock),
    team: play.team == null ? null : String(play.team),
    description: play.description == null ? '' : String(play.description),
    homeScore: Number(play.homeScore) || 0,
    awayScore: Number(play.awayScore) || 0,
  };
}

function serializeTopPerformer(player) {
  return {
    playerId: player.playerId == null ? null : Number(player.playerId),
    name: player.name == null ? '' : String(player.name),
    position: player.position == null ? null : String(player.position),
    nflTeam: player.nflTeam == null ? null : String(player.nflTeam),
    photoUrl: player.photoUrl == null ? null : String(player.photoUrl),
    fantasyPoints: Number(player.fantasyPoints) || 0,
    statLine: player.statLine == null ? '' : String(player.statLine),
  };
}

/** Full recap for one game (incl. structured `data`), or null when missing. */
async function getRecap(gameId) {
  let res;
  try {
    res = await pool.query(
      `SELECT "tank01_game_id", "season", "week", "home_team", "away_team",
              "home_score", "away_score", "final_at", "data", "data_version",
              "generator_version", "generated_at"
       FROM ${RECAPS_TABLE_SQL} WHERE "tank01_game_id" = $1`,
      [gameId]
    );
  } catch (err) {
    if (isMissingRecapStorage(err)) return null; // schema/table not migrated yet -> clean 404
    throw err;
  }
  const row = res.rows[0];
  if (!row) return null;
  return serializeRecapDetail(row);
}

function serializeRecapDetail(row) {
  const data = row.data || {};
  return {
    gameId: row.tank01_game_id ?? null,
    season: Number(row.season),
    week: Number(row.week),
    homeTeam: row.home_team ?? null,
    awayTeam: row.away_team ?? null,
    homeScore: Number(row.home_score),
    awayScore: Number(row.away_score),
    finalAt: row.final_at ?? null,
    lineScore: serializeLineScore(data.lineScore),
    scoringPlays: Array.isArray(data.scoringPlays)
      ? data.scoringPlays.filter((play) => play && typeof play === 'object').map(serializeScoringPlay)
      : [],
    topPerformers: Array.isArray(data.topPerformers)
      ? data.topPerformers.filter((player) => player && typeof player === 'object').map(serializeTopPerformer)
      : [],
    narrative: typeof data.narrative === 'string' ? data.narrative : '',
    generatedAt: row.generated_at || null,
    dataVersion: row.data_version == null ? null : Number(row.data_version),
    generatorVersion: row.generator_version || null,
  };
}

module.exports = {
  POSITION_WHITELIST,
  MAX_RANKINGS_LIMIT,
  DRAFT_POOL_POSITIONS,
  DRAFT_POOL_LIMIT,
  DRAFT_POOL_IDP_LIMIT,
  getRankings,
  getPlayerProfile,
  getDraftPool,
  listRecaps,
  getRecap,
  // exported for unit tests
  statLine,
  trendFromWeeks,
  firstSentence,
  serializeRankingRow,
  serializeDraftPoolRow,
  serializePlayerProfile,
  serializeRecapListRow,
  serializeRecapDetail,
  serializeLineScore,
  serializeScoringPlay,
  serializeTopPerformer,
};
