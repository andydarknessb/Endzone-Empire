/**
 * Retires the award_weekly_trophies SQL engine (#2767, spec #2736).
 *
 * Nothing calls the function: trophy.service.js reconciles trophy rows in JS. The
 * unique index on trophies that the engine's file also created is not touched.
 * Ships via the release preDeploy (`npm --prefix server run migrate`); applied by
 * Cory, never by the IC.
 */
exports.up = async function (knex) {
  await knex.raw('DROP FUNCTION IF EXISTS public.award_weekly_trophies(integer, integer, integer)');
};

exports.down = async function () {
  // ponytail: down leaves the function dropped (no caller; its body is in git
  // history before this change), restore it from history if a caller returns.
};
