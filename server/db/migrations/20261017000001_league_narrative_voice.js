/**
 * leagues.narrative_voice (#2357, ADR 0069).
 *
 * A commissioner's choice of Voice for the league's Recap and Matchup
 * narrative rewrites. NULL is neutral (every existing league); a value names a
 * Voice module under server/services/voices. The stored template and the
 * public game recap and Projection explanation never read it.
 *
 * Additive only - this runs against a shared Supabase instance; no existing
 * row changes. Ships via the release preDeploy (`npm --prefix server run
 * migrate`), never by hand: knex list validation (no disable flag) breaks the
 * next deploy if a row lands before main carries this file.
 */
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "narrative_voice" text');
  await knex.raw('ALTER TABLE "leagues" DROP CONSTRAINT IF EXISTS "leagues_narrative_voice_check"');
  await knex.raw(
    `ALTER TABLE "leagues" ADD CONSTRAINT "leagues_narrative_voice_check"
       CHECK ("narrative_voice" IS NULL OR "narrative_voice" = 'polk_high_legend')`
  );
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE "leagues" DROP CONSTRAINT IF EXISTS "leagues_narrative_voice_check"');
  await knex.raw('ALTER TABLE "leagues" DROP COLUMN IF EXISTS "narrative_voice"');
};
