/**
 * `llm_usage` (ADR 0063): one row per Claude call, the ledger the monthly
 * `ANTHROPIC_MONTHLY_BUDGET` guard sums (server/services/claude.js). `usd` is
 * computed at write time from the token counts and the price table in that
 * module, so a later price change does not rewrite history.
 *
 * Index on created_at: the guard sums the current billing cycle on every call.
 *
 * No grant to `anon` (ADR 0009).
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge and before the release that needs it, never by an agent.
 */

const TABLE = 'llm_usage';

exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id').primary();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('feature').notNullable();
    t.text('model').notNullable();
    t.integer('input_tokens').notNullable().defaultTo(0);
    t.integer('output_tokens').notNullable().defaultTo(0);
    t.integer('cache_read_tokens').notNullable().defaultTo(0);
    t.integer('cache_write_tokens').notNullable().defaultTo(0);
    t.decimal('usd', 10, 6).notNullable().defaultTo(0);
    t.index(['created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable(TABLE);
};
