/**
 * Phase 5: player injury status and news blurbs.
 * injury_status: Q (questionable), D (doubtful), O (out), IR — null = healthy.
 * Projections are computed from player_stats (season average), so no column.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('players', (t) => {
    t.string('injury_status', 8);
    t.string('injury_detail', 255);
    t.string('news', 500);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('players', (t) => {
    t.dropColumn('injury_status');
    t.dropColumn('injury_detail');
    t.dropColumn('news');
  });
};
