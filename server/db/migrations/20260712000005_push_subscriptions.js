/**
 * Phase 6: web push.
 *
 * One row per browser subscription. A user can have several (phone, laptop);
 * the endpoint URL is unique per browser registration. Having any active
 * subscription is the opt-in — unsubscribe deletes the row.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('push_subscriptions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('endpoint').notNullable().unique();
    t.jsonb('keys').notNullable(); // { p256dh, auth } from the browser
    t.timestamps(true, true);
    t.index(['user_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('push_subscriptions');
};
