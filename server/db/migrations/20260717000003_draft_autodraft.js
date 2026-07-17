/**
 * Autodraft: per-team auto-pick during the live draft.
 *   teams.autodraft            — server drafts for this team on a short delay
 *   teams.consecutive_timeouts — resets on a manual pick; at 2, autodraft flips on
 *   leagues.autodraft_delay_seconds — how long the server waits before an
 *                                     autodraft pick (league setting, pre-draft)
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('teams', (t) => {
    t.boolean('autodraft').notNullable().defaultTo(false);
    t.smallint('consecutive_timeouts').notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('leagues', (t) => {
    t.smallint('autodraft_delay_seconds').notNullable().defaultTo(10);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('teams', (t) => {
    t.dropColumn('autodraft');
    t.dropColumn('consecutive_timeouts');
  });
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('autodraft_delay_seconds');
  });
};
