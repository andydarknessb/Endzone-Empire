/**
 * leagues.board_version: the order of Draft state as the room hears it (CONTEXT.md,
 * board version; ADR 0025, 2026-11-06 amendment).
 *
 * Additive only: a bigint that defaults to 0, so every existing League starts at 0
 * and no existing row changes meaning. Every Draft-state change advances it in the
 * transaction that makes the change. Ships via the release preDeploy
 * (`npm --prefix server run migrate`); applied by Cory, never by the IC.
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "board_version" bigint NOT NULL DEFAULT 0`);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE "leagues" DROP COLUMN IF EXISTS "board_version"');
};
