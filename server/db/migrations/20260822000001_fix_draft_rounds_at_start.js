/**
 * ADR 0005 (docs/adr/0005-fix-draft-rounds-at-start.md): Draft rounds stops
 * being recomputed on every read for an active or completed draft.
 *
 * `draft_rounds` is nullable and, going forward, written exactly once, by
 * draftStart.service.js at the moment a draft transitions from pending to
 * active (or straight to complete, when every roster slot is pre-filled by
 * keepers). A pending draft leaves it null and keeps deriving Draft roster
 * size live from roster_limit/ir_slots via draftRosterSize()
 * (server/services/rosterShape.js) — there is no column to read yet, because
 * nothing has been spent.
 *
 * Existing active and completed drafts predate the column, so they are
 * backfilled once here from their current draftRosterSize() derivation
 * (roster_limit - ir_slots, floored at 0) — the exact same math
 * draftStart.service.js would have run had this column existed when they
 * started. This is a one-time backfill, not a standing recomputation path:
 * after this migration, nothing but draftStart.service.js ever writes
 * draft_rounds again. Without it, draftPlayer's completion check and every
 * other active/completed read (Picks, historical Draft boards, presenter
 * views) would see a null fixed value the moment this ships, truncating
 * drafts that had already run past whatever roster_limit - ir_slots
 * computes to today.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.integer('draft_rounds');
  });

  await knex.raw(`
    UPDATE "leagues"
    SET "draft_rounds" = GREATEST(0, COALESCE("roster_limit", 0) - COALESCE("ir_slots", 0))
    WHERE "draft_status" IN ('active', 'complete')
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('draft_rounds');
  });
};
