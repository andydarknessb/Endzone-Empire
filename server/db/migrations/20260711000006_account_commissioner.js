/**
 * Phase 6: account tools and commissioner powers.
 *
 * - auth_tokens: single-use tokens for password reset and email verification
 *   (only a SHA-256 hash of the token is stored).
 * - users.email_verified: set by the verification flow.
 * - leagues.transactions_locked: commissioner switch that freezes adds,
 *   drops, waiver claims, and trades.
 * - league_history: archived final standings per season (season rollover).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('email_verified').notNullable().defaultTo(false);
  });

  await knex.schema.alterTable('leagues', (t) => {
    t.boolean('transactions_locked').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('auth_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('type', 12).notNullable(); // reset | verify
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['user_id', 'type']);
  });

  await knex.schema.createTable('league_history', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('champion_team_id').references('teams.id').onDelete('SET NULL');
    t.jsonb('standings').notNullable().defaultTo('[]');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['league_id', 'season']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('league_history');
  await knex.schema.dropTableIfExists('auth_tokens');
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('transactions_locked');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('email_verified');
  });
};
