/**
 * Phase 4: league formats & discovery.
 *
 * - leagues.is_public: listed on the discovery page, joinable without an
 *   invite code.
 * - leagues.join_approval: public joins queue as join_requests for the
 *   commissioner instead of creating a team immediately.
 * - leagues.best_ball: no lineup management — scoring auto-computes each
 *   team's optimal legal lineup every week.
 * - leagues.scoring_preset: which preset seeded scoring_rules ('standard',
 *   'half_ppr', 'ppr', 'custom') — a display/filter label; scoring_rules
 *   stays the source of truth for actual point math.
 * - leagues.draft_date: advertised draft time for discovery filtering (the
 *   draft still starts manually).
 * - join_requests: pending public-league joins awaiting commissioner review.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.boolean('is_public').notNullable().defaultTo(false);
    t.boolean('join_approval').notNullable().defaultTo(false);
    t.boolean('best_ball').notNullable().defaultTo(false);
    t.string('scoring_preset', 16);
    t.timestamp('draft_date', { useTz: true });
  });

  await knex.schema.createTable('join_requests', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('team_name', 100);
    t.string('status', 12).notNullable().defaultTo('pending'); // pending | approved | denied
    t.timestamps(true, true);
    t.unique(['league_id', 'user_id']);
    t.index(['league_id', 'status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('join_requests');
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('draft_date');
    t.dropColumn('scoring_preset');
    t.dropColumn('best_ball');
    t.dropColumn('join_approval');
    t.dropColumn('is_public');
  });
};
