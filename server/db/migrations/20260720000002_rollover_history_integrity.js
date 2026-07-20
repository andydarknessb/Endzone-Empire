/**
 * Preserve immutable season-roster and award snapshots plus the champion's
 * user identity. The team pointer remains for current display compatibility;
 * champion_user_id survives a later team departure from the league.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('league_history', (t) => {
    t.integer('champion_user_id').references('users.id').onDelete('SET NULL');
    t.jsonb('rosters').notNullable().defaultTo('[]');
    t.jsonb('awards').notNullable().defaultTo('[]');
    t.index('champion_user_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('league_history', (t) => {
    t.dropIndex('champion_user_id');
    t.dropColumn('awards');
    t.dropColumn('rosters');
    t.dropColumn('champion_user_id');
  });
};
