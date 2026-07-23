/**
 * Tracks which team's drop put a player on waivers, so that team (and only
 * that team) can undo the drop while the waiver hold is still in effect —
 * powers the "Undo" action on the drop-player snackbar.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('waiver_players', (t) => {
    t.integer('dropped_by_team_id').references('teams.id').onDelete('SET NULL');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('waiver_players', (t) => {
    t.dropColumn('dropped_by_team_id');
  });
};
