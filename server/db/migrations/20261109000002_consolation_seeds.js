/**
 * consolation_seeds: a Consolation bracket seed, fixed when the bracket is created (#2744).
 *
 * One row per consolation-field Team per League and season, bye Teams included. Each
 * consolation round after the first pairs and checks byes from these rows, never from
 * live standings, so a stat correction can change records but never a seed. Shaped like
 * playoff_seeds, kept apart so the championship's readers never see a consolation seed.
 *
 * Additive only: a new table, no existing row changes. A League already in its playoffs
 * when this ships has no rows and plays no consolation round past the first.
 * Carve-out: applied by Cory through the release preDeploy (`npm --prefix server run
 * migrate`), never by the IC.
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS "consolation_seeds" (
      "league_id" integer NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
      "season" integer NOT NULL,
      "team_id" integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
      "seed" integer NOT NULL CHECK ("seed" >= 1),
      PRIMARY KEY ("league_id", "season", "team_id"),
      UNIQUE ("league_id", "season", "seed")
    )
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS "consolation_seeds"');
};
