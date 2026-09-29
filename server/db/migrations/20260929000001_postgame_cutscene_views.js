/**
 * `postgame_cutscene_views` (ADR 0052): one row records that a Manager has
 * seen (or skipped) a Matchup's Postgame cutscene, so it plays once across
 * every device the Manager uses. The due list is "final Matchup of one of my
 * Teams with no row here that has not expired"; expiry is derived from the
 * NFL schedule, so there is no timestamp column beyond `seen_at`.
 *
 * Both foreign keys cascade: deleting an account or a league (and its
 * Matchups) takes the rows with it, and the rows hold nothing else.
 *
 * down() is a plain drop: the rows are a convenience ("do not replay"), not
 * league history.
 *
 * No grant to `anon` (ADR 0009).
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge, never by an agent.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('postgame_cutscene_views', (t) => {
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.integer('matchup_id').notNullable().references('matchups.id').onDelete('CASCADE');
    t.timestamp('seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'matchup_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('postgame_cutscene_views');
};
