/**
 * `projection_explanations` (ADR 0063, CONTEXT.md "Projection explanation"):
 * one Narrative per player per week under the pool-wide DEFAULT scoring rules,
 * written once by the nightly projection fill and read by the Decision card.
 * `narrative_source` is 'template' until Claude's rewrite replaces the text
 * ('llm'); the template is always stored first.
 *
 * No grant to `anon` (ADR 0009).
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge and before the release that needs it, never by an agent.
 */

const TABLE = 'projection_explanations';

exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('id').inTable('players').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.text('narrative').notNullable();
    t.text('narrative_source').notNullable();
    t.text('model_version');
    t.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['player_id', 'season', 'week']);
  });
  await knex.raw(
    `ALTER TABLE "${TABLE}" ADD CONSTRAINT "projection_explanations_source_check"
       CHECK ("narrative_source" IN ('template', 'llm'))`
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTable(TABLE);
};
