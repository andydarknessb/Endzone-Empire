/**
 * Peak-load indexes for weekly scoring, Monte Carlo reads, roster joins, and
 * Tank01 weekly-stat scans.
 *
 * PostgreSQL cannot run CREATE INDEX CONCURRENTLY inside a transaction, so
 * this migration explicitly opts out of Knex's migration transaction.
 * Production deploys should still run one application instance at a time so
 * two migration runners do not compete for the same catalog locks.
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
  await dropInvalidConcurrentIndex(knex, 'idx_matchups_league_season_week_covering');
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_matchups_league_season_week_covering"
    ON "matchups" ("league_id", "season", "week")
    INCLUDE (
      "home_team_id", "away_team_id", "home_score", "away_score",
      "is_playoff", "is_consolation", "final"
    )
  `);

  await dropInvalidConcurrentIndex(knex, 'idx_team_players_league_team_player');
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_team_players_league_team_player"
    ON "team_players" ("league_id", "team_id", "player_id")
  `);

  await dropInvalidConcurrentIndex(knex, 'idx_player_stats_season_week_player');
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_player_stats_season_week_player"
    ON "player_stats" ("season", "week", "player_id")
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS "idx_player_stats_season_week_player"`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS "idx_team_players_league_team_player"`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS "idx_matchups_league_season_week_covering"`);
};
