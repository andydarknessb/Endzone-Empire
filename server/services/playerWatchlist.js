/**
 * The watchlist (#1312, ADR 0040 follow-up, grill ruling Q6): a team's own
 * set of players it wants to keep an eye on. Deliberately not the Draft
 * Queue (CONTEXT.md's Queue: "_Avoid_: watchlist" - the Queue feeds
 * autopick; this table feeds nothing but the Watch/Watching label) and
 * deliberately not Availability (a manager can watch a player in any
 * Availability state, including their own). One row per (team, player) pair
 * in `player_watchlist` (server/db/migrations, a carve-out this IC writes
 * and Cory applies - never run here).
 *
 * `watch`/`unwatch` are the two writes `PUT`/`DELETE
 * /api/players/:id/watch?leagueId=` perform (player.router.js), resolving
 * the caller's own team through `requireMember` before ever reaching here -
 * this module trusts the `teamId` it is given and does no membership check
 * of its own. `isWatching` and `watchingForMany` are the reads the
 * `GET /:id/card` payload (#1306) and the `view=cards` player-list row
 * (#1309) attach `watching: boolean` from.
 */
const pool = require('../modules/pool');

/** Marks `playerId` watched by `teamId`. Idempotent: watching an already-
 * watched player is a no-op, not a duplicate row or a thrown unique
 * violation. */
async function watch({ teamId, playerId }) {
  await pool.query(
    `INSERT INTO "player_watchlist" ("team_id", "player_id")
     VALUES ($1, $2)
     ON CONFLICT ("team_id", "player_id") DO NOTHING`,
    [teamId, playerId]
  );
  return { watching: true };
}

/** Clears `playerId` from `teamId`'s watchlist. Idempotent: unwatching a
 * player never watched matches no row and is not an error. */
async function unwatch({ teamId, playerId }) {
  await pool.query(
    `DELETE FROM "player_watchlist" WHERE "team_id" = $1 AND "player_id" = $2`,
    [teamId, playerId]
  );
  return { watching: false };
}

/** Whether `teamId` is watching `playerId` right now - the single-player
 * read `GET /:id/card` (#1306) attaches `watching` from. */
async function isWatching({ teamId, playerId }) {
  if (teamId == null || playerId == null) return false;
  const result = await pool.query(
    `SELECT 1 FROM "player_watchlist" WHERE "team_id" = $1 AND "player_id" = $2`,
    [teamId, playerId]
  );
  return !!result.rows[0];
}

/** `Map<playerId, boolean>` for every id in `playerIds` - the batch read the
 * `view=cards` player-list page (#1309) attaches `watching` from, one query
 * regardless of page size (the same "batched, not per player" shape
 * `availabilityForMany` already follows). Every id defaults to `false`, so a
 * caller need not guard a missing map entry. */
async function watchingForMany({ teamId, playerIds }) {
  const result = new Map();
  if (!teamId || !Array.isArray(playerIds) || playerIds.length === 0) return result;
  for (const id of playerIds) result.set(id, false);
  const rows = await pool.query(
    `SELECT "player_id" FROM "player_watchlist" WHERE "team_id" = $1 AND "player_id" = ANY($2)`,
    [teamId, playerIds]
  );
  for (const row of rows.rows) result.set(row.player_id, true);
  return result;
}

module.exports = {
  watch,
  unwatch,
  isWatching,
  watchingForMany,
};
