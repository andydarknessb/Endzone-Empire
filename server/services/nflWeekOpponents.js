const pool = require('../modules/pool');
const { normalizeNflTeam } = require('./nflTeam');

/**
 * THE NFL OPPONENT READ (CONTEXT.md, NFL opponent), once (#1574): the week's
 * schedule as Map<Team code, opponent Team code> for one (season, week), one
 * query however many players the caller annotates.
 *
 * Lifted out of `decision.service` so the Players page can share the read
 * without requiring that whole module (and its optimizer, projection and
 * scoring imports) for one SELECT - and so there is no fourth copy of it
 * (#1136). `decision.service`'s start/sit advice and `readPlayersPage` both
 * read it here; `lineup.service`'s `weekOpponents` still mirrors it inside
 * the caller's transaction, for the reasons its own docblock gives.
 *
 * Keyed by normalizeNflTeam(row.nfl_team), NOT the raw column, so a caller
 * that looks it up with normalizeNflTeam(player.nfl_team) agrees with it even
 * when a DEF unit's team is a full team name (#423). The VALUE is folded too
 * (#1136): every opponent that leaves the server is a Team code. A row whose
 * team folds to no team contributes no entry - absence stays absence, so a
 * bye or an unsynced slate is simply not in the map.
 *
 * `client` is injectable (a test's fake pool, a caller's transaction); it
 * defaults to the shared pool.
 */
async function getWeekOpponents({ season, week }, { client = pool } = {}) {
  const result = await client.query(
    `SELECT "nfl_team", "opponent" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const byTeam = new Map();
  for (const row of result.rows) {
    const team = normalizeNflTeam(row.nfl_team);
    if (team !== null) byTeam.set(team, normalizeNflTeam(row.opponent));
  }
  return byTeam;
}

module.exports = { getWeekOpponents };
