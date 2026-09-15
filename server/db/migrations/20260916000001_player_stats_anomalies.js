/**
 * `player_stats_anomalies` + `player_stats_integrity_scans` (week 1 2026
 * Endzone Forecast audit, 2026-09-15): the record the nightly integrity scan
 * (playerStatsIntegrity.service) writes when a stored `fantasy_points`
 * disagrees with the default-rules score of its `stats`, and the log of each
 * scan the health route reads for freshness.
 *
 * An anomaly is keyed by (player, season, week, kind) so a rescan updates
 * the one row rather than duplicating it; `resolved_at` is set when a later
 * scan finds the row correct. Both tables are fully re-derivable from
 * `player_stats` by running the scan again, so down() is a plain drop (no
 * ADR 0012 guard: nothing here is history that cannot be recomputed).
 *
 * No grant to `anon` (ADR 0009).
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge, never by an agent.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('player_stats_anomalies', (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('kind', 40).notNullable();
    t.jsonb('detail').notNullable().defaultTo('{}');
    t.timestamp('detected_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true });
    t.unique(['player_id', 'season', 'week', 'kind']);
    t.index(['resolved_at']);
  });
  await knex.schema.createTable('player_stats_integrity_scans', (t) => {
    t.increments('id').primary();
    t.specificType('seasons', 'integer[]').notNullable();
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at', { useTz: true });
    t.integer('scanned_rows');
    t.integer('open_anomalies');
    t.index(['finished_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('player_stats_integrity_scans');
  await knex.schema.dropTable('player_stats_anomalies');
};
