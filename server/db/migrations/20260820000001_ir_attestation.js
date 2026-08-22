/**
 * Commissioner IR attestation (#100): when the injury feed is wrong about a
 * player, the commissioner force-sets him into the IR slot and the entry
 * records the attestation. An attested stash behaves exactly like an
 * IR-eligible one - it grants roster capacity, the enforcement pass skips
 * it, and weekly materialization carries it forward with the slot. It ends
 * the moment the manager makes any slot move on that player.
 *
 * - Per lineup ENTRY, not per player or per team: the attestation is about
 *   one stash in one week's lineup, and the weekly carry-forward copies it
 *   the same way it copies the slot.
 * - Column-add on an existing table: no backfill (false is correct for every
 *   existing entry - verified zero IR entries in the live DB at design time),
 *   no index (only ever read alongside the entry itself), no RLS work (the
 *   repo attaches RLS only to new tables).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('lineup_entries', (t) => {
    t.boolean('ir_attested').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('lineup_entries', (t) => {
    t.dropColumn('ir_attested');
  });
};
