/**
 * Push ledger (#2104).
 *
 * One row per push a user was sent about a subject, so a repeat of the same
 * event is skipped even across restarts and instances. The unique index is the
 * dedupe: sendPushOnce inserts with ON CONFLICT DO NOTHING and sends only to
 * the users whose row went in.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('push_events', (t) => {
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('kind').notNullable(); // e.g. 'lineup-reminder'
    t.text('subject').notNullable(); // what the push is about, e.g. '<teamId>:<season>:<week>'
    t.text('fingerprint').notNullable(); // the state sent; a changed state is a new push
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'kind', 'subject', 'fingerprint']);
    t.index(['user_id', 'kind', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('push_events');
};
