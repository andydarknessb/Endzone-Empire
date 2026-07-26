const pool = require('../modules/pool');

const REG_SEASON_WEEKS = 18;

/**
 * Pure: given the regular-season weeks a team HAS a game in (a Set or an
 * iterable of week numbers), return the team's bye week when exactly one week
 * in 1..18 has no game. Returns null when the schedule is unknown, incomplete
 * (multiple gaps), or complete (no gap). Extracted so the derivation is
 * unit-testable without a database.
 */
function byeWeekFromPlayedWeeks(playedWeeks) {
  if (!playedWeeks) return null;
  const played = playedWeeks instanceof Set
    ? playedWeeks
    : new Set([...playedWeeks].map(Number));
  const missing = [];
  for (let week = 1; week <= REG_SEASON_WEEKS; week++) {
    if (!played.has(week)) missing.push(week);
  }
  return missing.length === 1 ? missing[0] : null;
}

/**
 * Batched bye-week lookup. Resolves the bye week for many NFL teams in a
 * single query, so a caller annotating a whole roster or lineup doesn't fan
 * out one query per player. Returns a Map<nflTeam, week|null>; a team with no
 * schedule rows (unsynced), multiple gaps (incomplete), or no gap maps to
 * null. Unknown/blank team codes are ignored.
 */
async function computeByeWeeks(nflTeams, season) {
  const teams = [...new Set((nflTeams || []).filter(Boolean))];
  const byTeam = new Map(teams.map((team) => [team, null]));
  if (teams.length === 0) return byTeam;

  // nfl_games keys teams by Tank01 abbreviation (WSH, LAR, ...), but callers
  // pass players.nfl_team values, which for DEF units are full team names
  // ("Denver Broncos") — a raw equality match left every DEF bye null.
  // fn_normalize_nfl_team collapses full names AND alias codes (notably
  // Tank01's WSH vs. WAS) on both sides; the SELECT returns the caller's
  // original string so the result map stays keyed by caller vocabulary.
  const result = await pool.query(
    `SELECT "t"."nfl_team", "ng"."week"
     FROM "nfl_games" "ng"
     JOIN unnest($2::text[]) AS "t"("nfl_team")
       ON fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("t"."nfl_team")
     WHERE "ng"."season" = $1 AND "ng"."week" BETWEEN 1 AND $3`,
    [season, teams, REG_SEASON_WEEKS]
  );

  const weeksByTeam = new Map();
  for (const row of result.rows) {
    if (!weeksByTeam.has(row.nfl_team)) weeksByTeam.set(row.nfl_team, new Set());
    weeksByTeam.get(row.nfl_team).add(Number(row.week));
  }
  for (const team of teams) {
    byTeam.set(team, byeWeekFromPlayedWeeks(weeksByTeam.get(team)));
  }
  return byTeam;
}

/**
 * A single team's bye week for a season (thin wrapper over computeByeWeeks).
 * Returns the sole regular-season week (1..18) with no nfl_games row, or null
 * when the schedule is unknown, incomplete, or has no gap.
 */
async function computeByeWeek(nflTeam, season) {
  if (!nflTeam) return null;
  return (await computeByeWeeks([nflTeam], season)).get(nflTeam) ?? null;
}

module.exports = {
  byeWeekFromPlayedWeeks,
  computeByeWeeks,
  computeByeWeek,
  REG_SEASON_WEEKS,
};
