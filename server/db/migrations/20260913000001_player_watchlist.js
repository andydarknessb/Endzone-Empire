/**
 * `player_watchlist` (#1312, ADR 0040 follow-up, grill ruling Q6): the table
 * the Watch action on the Decision card and any player row writes to -
 * team-scoped (CONTEXT.md's Team: a manager in two leagues watches per team,
 * not per account, so a manager with two teams keeps two separate watch
 * lists), one row per team+player pair. `added_at` is the table's own
 * timestamp of the watch, not read by this ticket's own surfaces but kept
 * for a future "recently watched" ordering, matching the Ruling's exact
 * column list (`team_id`, `player_id`, `added_at`).
 *
 * CARVE-OUT (server/db/migrations/**): this IC writes it, Cory applies it as
 * its own knex batch (#421 cycle rule) - never run by the IC.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('player_watchlist', (t) => {
    t.increments('id').primary();
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.timestamp('added_at').notNullable().defaultTo(knex.fn.now());
    // Unique on the pair (Ruling): a team either watches a player or does
    // not - there is no second row to collapse.
    t.unique(['team_id', 'player_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('player_watchlist');
};
