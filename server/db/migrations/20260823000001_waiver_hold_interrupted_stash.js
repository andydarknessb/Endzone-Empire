/**
 * The interrupted-stash record (#197): what a drop took the player out of.
 *
 * A lineup entry now follows the roster, so a drop deletes the current-week
 * row it used to leave behind. `undoDrop` read that row to decide whether to
 * put the player back in his IR stash, and the roster-capacity count read it
 * to credit that stash on the way back in. Both now read these two columns
 * instead: the slot and attestation he held in the current week at the
 * moment he was dropped.
 *
 * - On the waiver hold, not a new table: the hold already names the dropping
 *   team (`dropped_by_team_id`), already gates whether an undo is offered at
 *   all, and is deleted when the hold clears - which is exactly when the
 *   record stops meaning anything.
 * - Column-add on an existing table, expand-only. No backfill: NULL is the
 *   correct reading for every existing hold, and it benches on undo, which
 *   is what an undo does for any player who held no current-week row.
 * - `interrupted_slot` is nullable and holds a slot key ('IR', 'BENCH',
 *   'QB', ...), sized like `lineup_entries.slot`. Only 'IR' restores
 *   anything; the others are recorded because "what he was in" is the fact,
 *   and reading it back is the policy.
 * - No index: only ever read alongside the hold row itself, by its primary
 *   (league_id, player_id) key.
 *
 * Effect on existing data: none. It adds two columns and writes no rows.
 * A waiver hold in flight across the deploy keeps its `available_at` and
 * `dropped_by_team_id`; its undo benches the player instead of restoring a
 * stash, for the few hours until the hold clears.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('waiver_players', (t) => {
    t.string('interrupted_slot', 10);
    t.boolean('interrupted_ir_attested').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('waiver_players', (t) => {
    t.dropColumn('interrupted_slot');
    t.dropColumn('interrupted_ir_attested');
  });
};
