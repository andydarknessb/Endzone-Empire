/**
 * Phase 1 (hardening): rotating refresh tokens.
 *
 * Access JWTs drop to ~15 minutes; long-lived sessions ride on refresh tokens
 * stored here (SHA-256 hash only, never the raw token). Tokens are grouped
 * into families: each rotation marks the old row used and inserts a new row
 * in the same family. Presenting a token that is already `used` is reuse —
 * the whole family gets `revoked`, forcing a fresh login.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('family_id', 36).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.boolean('revoked').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['family_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('refresh_tokens');
};
