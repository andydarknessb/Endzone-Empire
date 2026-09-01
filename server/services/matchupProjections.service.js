const pool = require('../modules/pool');
const projectionService = require('./projection.service');

/**
 * Decorate matchup list rows with each side's projected starter total: the
 * pool-wide week projection (`getWeekProjections({ season, week })`) summed
 * over the team's non-bench, non-IR lineup rows for that week, rounded to
 * two decimals. Same producer, same starter definition and same rounding as
 * the matchup detail route's `projectedTotal`, with one deliberate
 * difference: the detail route materializes a team's lineup before reading
 * it, this reads the lineup as it stands. A list GET must not write a dozen
 * teams' lineup rows on every visit; the week's first score sync (and any
 * lineup or detail view) materializes them, after which the two agree.
 * Game Center reads it off the list so it can show a projection per team
 * without one detail fetch per matchup.
 *
 * Rules:
 *  - A FINAL matchup carries null on both sides and never triggers a
 *    projections fetch. A cache miss on the pool-wide producer writes one
 *    row per NFL player, so the list must not fan out across settled weeks
 *    just to decorate cards whose result is already known.
 *  - A team with no starter rows for the week carries null, never 0: "no
 *    lineup yet" and "a lineup projected to score nothing" must not look
 *    alike on a card. (The detail route reports 0 there.) A best-ball team
 *    never has starter rows, since every one of its entries sits on BENCH
 *    by design, so best-ball cards keep the dash; the detail route's 0 for
 *    the same team is the same limitation wearing a different number.
 *  - Projections are best-effort. A failed starter read or a failed
 *    projections fetch leaves the affected totals null and the list still
 *    answers.
 *
 * Every row comes back with both keys present so the client contract is
 * uniform: `home_projected_total` / `away_projected_total`, number or null.
 */
async function attachProjectedTotals(rows, { db = pool } = {}) {
  const out = rows.map((row) => ({ ...row, home_projected_total: null, away_projected_total: null }));
  const open = out.filter((m) => !m.final);
  if (open.length === 0) return out;
  const openKeys = new Set(open.map((m) => `${m.season}:${m.week}`));

  const teamIds = [...new Set(open.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const seasons = [...new Set(open.map((m) => m.season))];
  const weeks = [...new Set(open.map((m) => m.week))];
  // One query for every open (team, season, week). The season/week filters
  // are a cross product, so a row can come back for a (season, week) no open
  // matchup asked for (an unfinalized old-season matchup puts that season
  // into the filter, and its settled weeks all have lineup rows); both the
  // projections loop and the exact-key lookup below are restricted to
  // openKeys so such a row is never read. The team_players join mirrors the
  // detail route: a lineup row for a player the team no longer holds does
  // not count toward its projection.
  let starters;
  try {
    starters = await db.query(
    `SELECT "lineup_entries"."team_id", "lineup_entries"."season", "lineup_entries"."week",
            array_agg("lineup_entries"."player_id") AS "player_ids"
     FROM "lineup_entries"
     JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
       AND "team_players"."player_id" = "lineup_entries"."player_id"
     WHERE "lineup_entries"."team_id" = ANY($1)
       AND "lineup_entries"."season" = ANY($2)
       AND "lineup_entries"."week" = ANY($3)
       AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')
     GROUP BY "lineup_entries"."team_id", "lineup_entries"."season", "lineup_entries"."week"`,
      [teamIds, seasons, weeks]
    );
  } catch (err) {
    console.error('matchup list starters unavailable', err.message);
    return out;
  }
  const startersByKey = new Map(
    starters.rows.map((r) => [`${r.team_id}:${r.season}:${r.week}`, r.player_ids || []])
  );

  // One projections read per (season, week) that is BOTH open and has at
  // least one starter row, the cached pool-wide map. Requiring starter rows
  // is the cost gate for a fresh schedule: every future week is open, none
  // has a lineup yet, and a projections read for a week nobody has touched
  // would be a cache miss that writes one row per NFL player. Requiring the
  // week to be open keeps the cross product above from reaching a settled
  // week's projections through an old season's lineup rows.
  const projectionsByWeek = new Map();
  const weekKeys = new Set(starters.rows.map((r) => `${r.season}:${r.week}`).filter((k) => openKeys.has(k)));
  for (const key of weekKeys) {
    const [season, week] = key.split(':').map(Number);
    try {
      projectionsByWeek.set(key, await projectionService.getWeekProjections({ season, week }));
    } catch (err) {
      console.error('matchup list projections unavailable', err.message);
    }
  }

  const totalFor = (teamId, season, week) => {
    const projections = projectionsByWeek.get(`${season}:${week}`);
    const playerIds = startersByKey.get(`${teamId}:${season}:${week}`);
    if (!projections || !playerIds) return null;
    const sum = playerIds.reduce((acc, id) => acc + (projections.get(id)?.points || 0), 0);
    return Math.round(sum * 100) / 100;
  };
  for (const m of open) {
    m.home_projected_total = totalFor(m.home_team_id, m.season, m.week);
    m.away_projected_total = totalFor(m.away_team_id, m.season, m.week);
  }
  return out;
}

module.exports = { attachProjectedTotals };
