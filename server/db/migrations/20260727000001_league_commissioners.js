/**
 * Co-commissioners: league members the owner has granted commissioner powers.
 *
 * The commissioner has always been `leagues.owner_id` alone. This table adds a
 * second tier: every co-commissioner can do what the commissioner can, except
 * delete the league and manage the co-commissioner list — both stay with the
 * owner. Authorization reads it through leagueRole.service's
 * commissionerPredicate(), so a row here is the only thing that grants power.
 *
 * Modeled as its own table rather than a column on `teams` so "has a team in
 * this league" (membership) stays separate from "has commissioner powers".
 * Composite primary key gives the one-row-per-(league, user) constraint.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('league_commissioners', (t) => {
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.integer('granted_by').references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.primary(['league_id', 'user_id']);
    t.index('user_id');
  });
  // Defense in depth on the shared Supabase project: the app connects as the
  // table's owner and bypasses RLS, so enabling it costs nothing here while
  // denying anon/authenticated PostgREST access by default.
  await knex.raw('ALTER TABLE "league_commissioners" ENABLE ROW LEVEL SECURITY');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('league_commissioners');
};
