'use strict';

/**
 * NFL roster status (CONTEXT.md, #1766): the latest `player_nfl_roster_status`
 * row for a player, as the fact the Weekly projection read passes to
 * `unavailableFor` (#1767; ADR 0061: every other reader gets the Start verdict
 * from that read), so no reader decides Practice squad on its own.
 *
 * The value is `{ status, capturedAt } | null`: `status` is 'active',
 * 'practice_squad', 'reserve' or 'suspended';`capturedAt` is the row's `updated_at`. The
 * 48-hour staleness rule lives in the verdict, not here, so a stale row still
 * comes back and `unavailableFor` reads it as Active. Both reads skip rows
 * captured before CURRENT_DATE - 3, which can never be fresh even so: 48
 * hours of staleness plus a day of slack because espnFactsSync stamps
 * `captured_date` with the syncing node's LOCAL date (#1792 f12), which can
 * read a calendar day earlier than the read's own CURRENT_DATE (UTC) - a
 * CURRENT_DATE - 2 bound could cut off a row that is still within the 48-hour
 * rule. Neither read scans a player's whole history.
 */

const LATEST_ROW = `json_build_object('status', "nrs"."roster_status", 'capturedAt', "nrs"."updated_at")`;

/**
 * SQL select-list expression for a query that reads `players` (or an alias of
 * it, passed as `playersRef`, already quoted). Served by the table's unique
 * (player_id, captured_date) index.
 */
function nflRosterStatusColumn(playersRef = '"players"') {
  return `(SELECT ${LATEST_ROW}
           FROM "player_nfl_roster_status" "nrs"
           WHERE "nrs"."player_id" = ${playersRef}."id" AND "nrs"."captured_date" >= CURRENT_DATE - 3
           ORDER BY "nrs"."captured_date" DESC LIMIT 1) AS "nfl_roster_status"`;
}

/**
 * `Map<playerId, { status, capturedAt }>` for the projection engine's live
 * cache path, which cannot widen its own player read: that text is pinned by
 * the backtest snapshot surface (scripts/backtest/lib/sqlSurface.js), so the
 * fact arrives as a separate read instead. A player with no row is absent.
 */
async function loadNflRosterStatusById(client, playerIds) {
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return new Map();
  const result = await client.query(
    `SELECT DISTINCT ON ("nrs"."player_id") "nrs"."player_id", ${LATEST_ROW} AS "nfl_roster_status"
     FROM "player_nfl_roster_status" "nrs"
     WHERE "nrs"."player_id" = ANY($1::int[]) AND "nrs"."captured_date" >= CURRENT_DATE - 3
     ORDER BY "nrs"."player_id", "nrs"."captured_date" DESC`,
    [ids]
  );
  return new Map(result.rows.map((row) => [row.player_id, row.nfl_roster_status]));
}

module.exports = { nflRosterStatusColumn, loadNflRosterStatusById };
