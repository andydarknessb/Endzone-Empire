/**
 * Per-user chat read markers, powering the unread-message badge on the league
 * chat. One row per (league, user), upserted whenever the user opens (or is
 * looking at) the chat; unread = other users' messages newer than
 * last_read_at. No retention job needed: rows are single, continuously
 * overwritten markers that cascade away with their league or user.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('chat_reads', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.timestamp('last_read_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['league_id', 'user_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('chat_reads');
};
