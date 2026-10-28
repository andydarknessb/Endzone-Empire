const pool = require('../modules/pool');

/**
 * `Map<playerId, identityIds[]>` for every id in `playerIds`, under the SAME
 * partition `player.router.js`'s `player_identities` CTE uses (normalized
 * name + position + Team code): every `players` row a duplicate-source sync
 * could have produced for one real athlete. Every requested id is present in
 * the map even when it has no duplicate (falling back to itself). A plain
 * `players` row never carries `identity_ids` (that field only exists as the
 * CTE's window alias), so `availabilityForMany` and the own-roster Upgrade
 * check both resolve it here rather than reading a field that was never on
 * the row (formal review f1).
 *
 * The single-id case (the Decision card's own call, always N=1) runs the
 * exact scalar-`WHERE "id" = $1` query this function has always run - not
 * the `= ANY($1)` batch form - so `getPlayerCard`'s query shape and count are
 * unchanged (`server/test/playerCard.service.test.js`'s fakePool mocks match
 * on that literal SQL prefix, and its fixtures return `{ id }` rows with no
 * `requested_id` column, which only the single-id shape produces).
 */
async function loadIdentityIdsFor(playerIds) {
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  const map = new Map();
  if (ids.length === 0) return map;

  if (ids.length === 1) {
    const [id] = ids;
    const result = await pool.query(
      `WITH "target" AS (
         SELECT LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', ' ', 'g')) AS "name_key",
                "position",
                COALESCE(fn_normalize_nfl_team("nfl_team"), '') AS "team_key"
         FROM "players" WHERE "id" = $1
       )
       SELECT "players"."id" FROM "players", "target"
       WHERE LOWER(REGEXP_REPLACE(TRIM("players"."name"), '\\s+', ' ', 'g')) = "target"."name_key"
         AND "players"."position" = "target"."position"
         AND COALESCE(fn_normalize_nfl_team("players"."nfl_team"), '') = "target"."team_key"`,
      [id]
    );
    const found = result.rows.map((r) => r.id);
    map.set(id, found.length > 0 ? found : [id]);
    return map;
  }

  const result = await pool.query(
    `WITH "target" AS (
       SELECT "id" AS "requested_id",
              LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', ' ', 'g')) AS "name_key",
              "position",
              COALESCE(fn_normalize_nfl_team("nfl_team"), '') AS "team_key"
       FROM "players" WHERE "id" = ANY($1::int[])
     )
     SELECT "target"."requested_id" AS "requested_id", "players"."id" AS "identity_id"
     FROM "target"
     JOIN "players"
       ON LOWER(REGEXP_REPLACE(TRIM("players"."name"), '\\s+', ' ', 'g')) = "target"."name_key"
      AND "players"."position" = "target"."position"
      AND COALESCE(fn_normalize_nfl_team("players"."nfl_team"), '') = "target"."team_key"`,
    [ids]
  );
  for (const row of result.rows) {
    if (!map.has(row.requested_id)) map.set(row.requested_id, []);
    map.get(row.requested_id).push(row.identity_id);
  }
  for (const id of ids) {
    if (!map.has(id) || map.get(id).length === 0) map.set(id, [id]);
  }
  return map;
}

/** Single-id convenience wrapper over `loadIdentityIdsFor` - always the
 * one-query scalar form above. */
async function loadIdentityIds(playerId) {
  const map = await loadIdentityIdsFor([playerId]);
  return map.get(playerId) || [playerId];
}

module.exports = { loadIdentityIdsFor, loadIdentityIds };
