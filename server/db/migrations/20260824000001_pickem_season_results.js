/**
 * An immutable declaration of a completed pick'em-only season.
 *
 * One row distinguishes an explicit no-champion result from an absent result.
 * Champion identity is a JSON snapshot on purpose: there are no Team or user
 * foreign keys whose cascade could rewrite the historical answer. Recipient
 * trophies remain projections and are not this table's source of truth.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('pickem_season_results', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.string('outcome', 16).notNullable();
    t.string('scoring_mode', 12).notNullable();
    t.jsonb('champions').notNullable();
    t.timestamp('declared_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['league_id', 'season']);
  });

  await knex.raw(`
    ALTER TABLE "pickem_season_results"
      ADD CONSTRAINT "pickem_season_results_season_positive"
        CHECK ("season" > 0),
      ADD CONSTRAINT "pickem_season_results_outcome_check"
        CHECK ("outcome" IN ('champions', 'no_champion')),
      ADD CONSTRAINT "pickem_season_results_mode_check"
        CHECK ("scoring_mode" IN ('straight', 'confidence')),
      ADD CONSTRAINT "pickem_season_results_champions_array"
        CHECK (jsonb_typeof("champions") = 'array'),
      ADD CONSTRAINT "pickem_season_results_outcome_matches_champions"
        CHECK (
          ("outcome" = 'champions' AND jsonb_array_length("champions") > 0)
          OR ("outcome" = 'no_champion' AND jsonb_array_length("champions") = 0)
        )
  `);

  // The application owns the table and bypasses RLS. Other shared-project
  // roles receive deny-by-default behavior because no policies are installed.
  await knex.raw('ALTER TABLE "pickem_season_results" ENABLE ROW LEVEL SECURITY');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('pickem_season_results');
};
