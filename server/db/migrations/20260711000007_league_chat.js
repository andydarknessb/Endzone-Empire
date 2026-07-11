/** Phase 7: per-league real-time chat (delivered over the existing socket). */
exports.up = async function (knex) {
  await knex.schema.createTable('chat_messages', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('message', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['league_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('chat_messages');
};
