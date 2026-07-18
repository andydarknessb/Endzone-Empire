/**
 * Two player-pool fixes for the quick-view dialog:
 *
 * 1. Remove the original seed "shell" rows (external_id IS NULL) for any player
 *    that also has a real synced row (external_id set). The shells carry no
 *    photo and no stats yet sort first (low ids), so stars looked empty and
 *    duplicated in every list. They're unreferenced (no rosters/lineups/picks
 *    point at them). Team-defense seeds have no synced twin and are kept.
 *    Idempotent: on a fresh DB with only seeds (no twins) this deletes nothing.
 *
 * 2. Add players.adp (average draft position) — populated from a free ADP feed
 *    by adp.service (POST /api/scoring/sync-adp); null = undrafted / unmatched.
 */
exports.up = async function (knex) {
  await knex.raw(`
    DELETE FROM "players" p
    WHERE p."external_id" IS NULL
      AND EXISTS (
        SELECT 1 FROM "players" t
        WHERE t."external_id" IS NOT NULL
          AND lower(t."name") = lower(p."name")
      )
  `);

  await knex.schema.alterTable('players', (t) => {
    t.decimal('adp', 6, 2); // average draft position; null until synced
  });
};

exports.down = async function (knex) {
  // The deleted shells are seed data (re-creatable via `npm run seed` on an
  // empty pool); this down only reverses the schema change.
  await knex.schema.alterTable('players', (t) => {
    t.dropColumn('adp');
  });
};
