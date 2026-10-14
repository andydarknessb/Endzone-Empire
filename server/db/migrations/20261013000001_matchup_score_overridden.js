/**
 * matchups.score_overridden (#2274).
 *
 * A commissioner's manual score (adjustMatchupScore) used to be rewritten by
 * the next re-score: the live tick, the Tue/Wed correction and the advance-week
 * settle all rewrite every matchup row. This flag marks the override so
 * scoreMatchups leaves that row's scores alone.
 *
 * Additive only - this runs against a shared Supabase instance. Ships via the
 * release preDeploy (`npm --prefix server run migrate`); applied by Cory, never
 * by the IC.
 */
exports.up = async function (knex) {
  await knex.raw(
    'ALTER TABLE "matchups" ADD COLUMN IF NOT EXISTS "score_overridden" boolean NOT NULL DEFAULT false'
  );
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE "matchups" DROP COLUMN IF EXISTS "score_overridden"');
};
