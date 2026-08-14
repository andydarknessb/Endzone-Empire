/**
 * League type at creation: `pickem_only` marks a league created without a
 * fantasy side. Such a league has no draft, rosters, lineups, matchups,
 * waivers, trades or fantasy scoring; its members just pick NFL winners each
 * week against the slate.
 *
 * - The flag is CREATE-TIME IMMUTABLE. It stores only the one fact that can
 *   never change: does this league have a fantasy side? No endpoint may
 *   update it after the INSERT that creates the league.
 * - "Both" (a fantasy league with pick'em from day one) is NOT this flag: it
 *   is this flag false plus a `pickem_settings` row written enabled=true at
 *   creation. `pickem_settings` remains the source of truth for whether
 *   pick'em is on and which mode it plays.
 * - Why a boolean and not a three-valued league_kind: a stored
 *   'fantasy'|'pickem'|'both' would drift the moment a fantasy commissioner
 *   toggles the pick'em add-on after creation. The three-way label shown in
 *   the UI is derived from this flag plus pickem_settings, never stored.
 * - Unlike pickem_settings (kept off the hot `leagues` row because most
 *   leagues never enable the side game), this flag belongs ON `leagues`: the
 *   league's type gates nav, routes and draft machinery on nearly every
 *   request that already reads the row.
 *
 * Column-add on an existing table: no backfill (false is correct for every
 * existing league), no index (never queried without the league id), and no
 * RLS work (the repo attaches RLS only to new tables).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.boolean('pickem_only').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('pickem_only');
  });
};
