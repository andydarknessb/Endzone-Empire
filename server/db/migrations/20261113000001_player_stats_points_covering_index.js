/**
 * Covering index for the opponent-defense sum (#2900).
 *
 * getPositionDefense adds up fantasy_points for a season's player_stats rows.
 * The defense sum read 74 MB of heap for that one column, because every row
 * carries its stats JSON. With fantasy_points in the index the same sum is an
 * index-only scan. The old index has the same key columns and no reader the new
 * one does not serve, so it is dropped rather than kept beside.
 *
 * Accepted cost: an update that changes fantasy_points can no longer be a
 * heap-only update, so live scoring writes one more index entry for those rows.
 *
 * Carve-out: this ships through a release and is never applied by hand against the shared database.
 */
exports.config = { transaction: false };

async function dropInvalidConcurrentIndex(knex, indexName) {
  const result = await knex.raw(
    `SELECT NOT "pg_index"."indisvalid" AS "invalid"
     FROM "pg_class"
     JOIN "pg_index" ON "pg_index"."indexrelid" = "pg_class"."oid"
     JOIN "pg_namespace" ON "pg_namespace"."oid" = "pg_class"."relnamespace"
     WHERE "pg_namespace"."nspname" = current_schema()
       AND "pg_class"."relname" = ?`,
    [indexName]
  );
  if (result.rows[0] && result.rows[0].invalid) {
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ??`, [indexName]);
  }
}

exports.up = async function (knex) {
  await dropInvalidConcurrentIndex(knex, 'idx_player_stats_season_week_player_points');
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_player_stats_season_week_player_points"
    ON "player_stats" ("season", "week", "player_id")
    INCLUDE ("fantasy_points")
  `);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS "idx_player_stats_season_week_player"`);
};

exports.down = async function (knex) {
  await dropInvalidConcurrentIndex(knex, 'idx_player_stats_season_week_player');
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_player_stats_season_week_player"
    ON "player_stats" ("season", "week", "player_id")
  `);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS "idx_player_stats_season_week_player_points"`);
};
