/**
 * playoff_seeds: a Playoff seed, fixed when the bracket is created (#2547).
 *
 * One row per championship-bracket Team per League and season, bye Teams
 * included. Later rounds, the bye check and the standings' `playoffSeed` read
 * these rows instead of re-deriving seeds from current standings, so a stat
 * correction to a regular-season week can change records but never who is in
 * the bracket, who has a bye, or the seed order.
 *
 * Additive only: a new table, no existing row changes. A League already in its
 * playoffs when this ships has no rows and keeps deriving seeds from standings
 * until its season ends. Ships via the release preDeploy
 * (`npm --prefix server run migrate`); applied by Cory, never by the IC.
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS "playoff_seeds" (
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
  await knex.raw('DROP TABLE IF EXISTS "playoff_seeds"');
};
