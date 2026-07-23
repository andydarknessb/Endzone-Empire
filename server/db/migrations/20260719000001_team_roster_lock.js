/**
 * Phase 7: per-team commissioner lock.
 *
 * - teams.locked: freezes one manager's roster moves (adds, drops, waiver
 *   claims, trade proposals) without affecting the rest of the league. This
 *   is distinct from leagues.transactions_locked, which freezes the whole
 *   league at once.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('teams', (t) => {
    t.boolean('locked').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('teams', (t) => {
    t.dropColumn('locked');
  });
};
