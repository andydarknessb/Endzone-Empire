/**
 * `win_probability_shadow` (Home v2 spec, "Win probability v2" board): the
 * record win probability v2's shadow mode writes from the live score pass,
 * so v2 can be scored against v1 and the real results before any surface
 * shows it (the gate: Brier score at or below v1's, reliable bins, exact 0/1
 * once final).
 *
 * One row per open matchup per 15-minute window (`bucket_start`), the first
 * snapshot in the window kept (the writer inserts ON CONFLICT DO NOTHING).
 * Each row carries v2's own figures (mu, sigma, k, the home probability) and
 * every input v1 needs (each side's score and Expected final), so v1 is
 * recomputed exactly at evaluation time by calling the client's own v1
 * function rather than stored twice. The outcome is read from `matchups`
 * once the week settles. `starters_without_interval` counts available
 * starters with game time left but no projection Interval (they add no
 * variance), so the evaluation can flag snapshots more certain than they
 * should be. The probability is a double: a decimal would round values
 * within 5e-7 of 0 or 1 to exactly 0 or 1 and break log loss.
 *
 * down() is a plain drop: the rows are an experiment's measurements, not
 * league history, and nothing on any surface reads them.
 *
 * No grant to `anon` (ADR 0009).
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge, never by an agent.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('win_probability_shadow', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('matchup_id').notNullable().references('matchups.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.timestamp('bucket_start', { useTz: true }).notNullable();
    t.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('status', 12).notNullable();
    t.decimal('home_score', 8, 2);
    t.decimal('away_score', 8, 2);
    t.decimal('home_expected_final', 8, 2).notNullable();
    t.decimal('away_expected_final', 8, 2).notNullable();
    t.integer('home_players_remaining');
    t.integer('away_players_remaining');
    t.integer('starters_without_interval').notNullable().defaultTo(0);
    t.decimal('mu', 8, 3).notNullable();
    t.decimal('sigma', 8, 3).notNullable();
    t.decimal('k', 5, 3).notNullable();
    t.double('home_probability').notNullable();
    t.string('model_version', 16).notNullable();
    t.unique(['matchup_id', 'bucket_start']);
    t.index(['season', 'week']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('win_probability_shadow');
};
