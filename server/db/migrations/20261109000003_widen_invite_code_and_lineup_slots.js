/**
 * Widens three columns the League create and the draft outgrew (#2746).
 *
 * - `leagues.invite_code` held 12 characters; a new League's code has 16, so
 *   POST /api/league fails on insert.
 * - `lineup_entries.slot` and `waiver_players.interrupted_slot` held 10; a custom
 *   slot name may be 20, so the final Pick's lineup seed fails on a long name and
 *   the draft can never finish.
 *
 * Widening a varchar changes no row. Carve-out: this ships through a release and
 * is never applied by hand against the shared database.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.string('invite_code', 16).notNullable().alter();
  });
  await knex.schema.alterTable('lineup_entries', (t) => {
    t.string('slot', 20).notNullable().defaultTo('BENCH').alter();
  });
  await knex.schema.alterTable('waiver_players', (t) => {
    t.string('interrupted_slot', 20).nullable().alter();
  });
};

// No undo: narrowing would cast 16- and 20-character values down silently
// (a `::varchar(12)` cast truncates), corrupting invite codes and slot keys.
exports.down = async function () {};
