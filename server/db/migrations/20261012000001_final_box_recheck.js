/**
 * live_game_states.final_stats_rechecked_at (#2223, ADR 0035 amendment).
 *
 * The Final box is read once and stamped (final_stats_synced_at). One recheck
 * runs ~2h after that stamp (FINAL_BOX_RECHECK_MS) because a one-shot read can
 * carry a transient value (#2219: SF DEF defTD 2, true value 1) that nothing
 * else corrects until the Tue/Wed nflverse pass. This column marks the recheck
 * as done, so each game is re-read at most once.
 *
 * Additive only - this runs against a shared Supabase instance. Ships via the
 * release preDeploy (`npm --prefix server run migrate`); applied by Cory, never
 * by the IC.
 */
exports.up = async function (knex) {
  await knex.raw(
    'ALTER TABLE "live_game_states" ADD COLUMN IF NOT EXISTS "final_stats_rechecked_at" timestamptz NULL'
  );
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE "live_game_states" DROP COLUMN IF EXISTS "final_stats_rechecked_at"');
};
