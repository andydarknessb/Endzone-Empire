/**
 * Player quick-view dialog support.
 *
 * - players gain a resolved headshot URL and jersey number (both populated
 *   during syncPlayers from the provider feed; null until synced, so the UI
 *   always falls back to an initials avatar).
 * - player_season_stats stores season-level totals per player (one row per
 *   player per season) so the dialog can show prior-season lines without
 *   re-aggregating weekly rows on every open. `stats` holds the same flat
 *   stat keys as player_stats (summed over the season); fantasy_points is a
 *   scoring-agnostic fallback computed under the default rules — the summary
 *   API recomputes points from `stats` under the viewing league's rules.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('players', (t) => {
    t.string('photo_url', 500);
    t.string('jersey_number', 8);
  });

  await knex.schema.createTable('player_season_stats', (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('games_played').notNullable().defaultTo(0);
    t.jsonb('stats').notNullable().defaultTo('{}');
    t.decimal('fantasy_points', 8, 2).notNullable().defaultTo(0);
    t.unique(['player_id', 'season']);
    t.index('player_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('player_season_stats');
  await knex.schema.alterTable('players', (t) => {
    t.dropColumn('photo_url');
    t.dropColumn('jersey_number');
  });
};
