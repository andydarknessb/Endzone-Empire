/**
 * Phase 3: projections & decision support.
 *
 * - player_projections: cached weekly point projections. Source is
 *   'extrapolated' (season-average fallback, the default) or 'external'
 *   (a projections feed, when one is configured). Cached per week so the
 *   fleet of features reading them (start/sit, trade analyzer, waiver
 *   suggestions, Monte Carlo) never recompute mid-week.
 * - league_analytics: per-league computed artifacts keyed by week and type
 *   (power_rankings holds rankings + playoff/title odds from the Monte Carlo
 *   run; later phases may add more types). jsonb because shape iterates fast
 *   and it's read-only display data.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('player_projections', (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.decimal('projected_points', 8, 2).notNullable().defaultTo(0);
    t.string('source', 16).notNullable().defaultTo('extrapolated');
    t.timestamps(true, true);
    t.unique(['player_id', 'season', 'week']);
    t.index(['season', 'week']);
  });

  await knex.schema.createTable('league_analytics', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('type', 32).notNullable();
    t.jsonb('data').notNullable().defaultTo('{}');
    t.timestamps(true, true);
    t.unique(['league_id', 'season', 'week', 'type']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('league_analytics');
  await knex.schema.dropTableIfExists('player_projections');
};
