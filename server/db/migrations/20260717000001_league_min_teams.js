/**
 * League size limits: add a configurable minimum team count alongside the
 * existing max_teams. A draft cannot start until min_teams have joined.
 * Existing leagues are backfilled to LEAST(8, max_teams) so the new floor
 * never exceeds a small league's cap.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.integer('min_teams').notNullable().defaultTo(8);
  });
  await knex.raw(`UPDATE "leagues" SET "min_teams" = LEAST(8, "max_teams")`);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('min_teams');
  });
};
