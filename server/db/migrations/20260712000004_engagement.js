/**
 * Phase 5: engagement features.
 *
 * - trophies: awards a team earned (season champion, weekly high score,
 *   longest win streak, best draft grade, biggest comeback). `data` holds
 *   type-specific detail (week, points, streak length, grade...). The unique
 *   key includes `week` (0 for season-level awards) so weekly awards recur
 *   without duplicating and re-runs stay idempotent.
 * - notification_prefs: per-user delivery preferences consulted by digests
 *   and (Phase 6) web push. One row per user; jsonb so new toggles don't
 *   need migrations. Missing row = all defaults (everything on).
 *
 * Weekly recaps and draft grades live in league_analytics (types
 * 'weekly_recap' and 'draft_grades') — no new table needed.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('trophies', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable().defaultTo(0); // 0 = season-level award
    t.string('type', 24).notNullable();
    t.string('label', 120).notNullable();
    t.jsonb('data').notNullable().defaultTo('{}');
    t.timestamp('awarded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['league_id', 'season', 'week', 'type']);
    t.index(['team_id']);
  });

  await knex.schema.createTable('notification_prefs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE').unique();
    t.jsonb('prefs').notNullable().defaultTo('{}');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('notification_prefs');
  await knex.schema.dropTableIfExists('trophies');
};
