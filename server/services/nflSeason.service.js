const pool = require('../modules/pool');
const clock = require('../modules/clock');
const { REG_SEASON_WEEKS } = require('./bye.service');

/**
 * The current NFL season by calendar, resolved in SQL to stay on DB time:
 * Jan/Feb still belong to the prior NFL season; March begins the next league
 * year. This preserves the public read-model's global-data-only boundary
 * (no league-scoped current_season lookups) and gives every caller — public
 * reads, best-available resolution — the same notion of "now".
 */
async function upcomingNflSeason() {
  const res = await pool.query(
    `SELECT CASE
       WHEN EXTRACT(MONTH FROM CURRENT_DATE) <= 2
         THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - 1
       ELSE EXTRACT(YEAR FROM CURRENT_DATE)::int
     END AS "season"`
  );
  return res.rows[0] && res.rows[0].season != null ? Number(res.rows[0].season) : null;
}

/**
 * The most recently completed NFL season: the one before the upcoming one.
 * This is the season "Best available" (CONTEXT.md) and the IDP tranche rank
 * production off of.
 */
async function lastCompletedNflSeason() {
  const upcoming = await upcomingNflSeason();
  return upcoming == null ? null : upcoming - 1;
}

/** Pure: a week number an NFL regular season has. */
function isNflWeek(week) {
  return Number.isInteger(week) && week >= 1 && week <= REG_SEASON_WEEKS;
}

/** A season that can be on file: 2000 through next year. */
function isNflSeason(season) {
  return Number.isInteger(season) && season >= 2000 && season <= clock.now().getFullYear() + 1;
}

module.exports = { upcomingNflSeason, lastCompletedNflSeason, isNflWeek, isNflSeason, REG_SEASON_WEEKS };
