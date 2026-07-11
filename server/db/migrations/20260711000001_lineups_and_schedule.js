/**
 * Phase 1: starting lineups vs. bench.
 *
 * - leagues gain per-league lineup configuration (slot counts, position caps,
 *   IR slots) plus a current season/week pointer that later scheduling code
 *   advances. Defaults keep every existing league working unchanged.
 * - lineup_entries stores each team's weekly lineup: one row per rostered
 *   player per (season, week), slot = QB/RB/WR/TE/FLEX/K/DEF/BENCH/IR.
 *   Rows are materialized lazily (copy-forward from the previous week), so
 *   no backfill is needed for existing data.
 * - nfl_games holds the synced real-world schedule, one row per NFL team per
 *   week; lineup locks compare its kickoff_at against now().
 */
const DEFAULT_LINEUP_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };

exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.jsonb('lineup_slots').notNullable().defaultTo(JSON.stringify(DEFAULT_LINEUP_SLOTS));
    t.jsonb('position_caps').notNullable().defaultTo('{}'); // e.g. {"RB":4}; empty = no caps
    t.integer('ir_slots').notNullable().defaultTo(1);
    t.integer('current_season').notNullable().defaultTo(2026);
    t.integer('current_week').notNullable().defaultTo(1);
  });

  await knex.schema.createTable('lineup_entries', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('slot', 10).notNullable().defaultTo('BENCH');
    t.timestamps(true, true);
    t.unique(['team_id', 'season', 'week', 'player_id']);
    t.index(['league_id', 'season', 'week']);
  });

  await knex.schema.createTable('nfl_games', (t) => {
    t.increments('id').primary();
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('nfl_team', 60).notNullable();
    t.string('opponent', 60);
    t.timestamp('kickoff_at', { useTz: true }).notNullable();
    t.unique(['season', 'week', 'nfl_team']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('nfl_games');
  await knex.schema.dropTableIfExists('lineup_entries');
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('lineup_slots');
    t.dropColumn('position_caps');
    t.dropColumn('ir_slots');
    t.dropColumn('current_season');
    t.dropColumn('current_week');
  });
};
