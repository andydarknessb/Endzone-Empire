/**
 * Relax draft_activity so it can hold Draft LIFECYCLE events, not only Picks
 * (#437, ADR 0012).
 *
 * 20260826000004 created draft_activity for #435, which writes ONLY committed
 * Picks. Every Pick carries a Team, a player, a round and an overall Pick
 * number, so those columns landed NOT NULL. #437 adds the rest of the
 * authoritative lifecycle - Draft start, pause, resume, reset and completion -
 * to the SAME table and sequence. A lifecycle event has an acting Team (or none:
 * a scheduler auto-start, or a completion transition no manager performed) and
 * an instant, but NO player, round or Pick number. Fabricating those to satisfy
 * NOT NULL would invent Pick facts the event never had (#437 AC5), so this
 * migration makes them nullable.
 *
 * WHY A CHECK REPLACES THE DROPPED NOT NULLs. The Pick contract must not weaken:
 * a 'pick' row still has to carry its Team, player, round and Pick number, and a
 * client reads them back unconditionally (activityEntryOf). Dropping the column
 * NOT NULLs alone would let a future writer insert a Pick with a null player. So
 * the relaxation is scoped by kind: a single CHECK keeps team_name, player_name,
 * round and pick_number NOT NULL FOR A PICK, while allowing them null for the
 * lifecycle kinds. The invariant #435 relied on is preserved exactly, only now
 * stated as "for a Pick" instead of "for every row".
 *
 * WHY NOT team_id. team_id was already nullable (ON DELETE SET NULL, so a
 * removed team does not erase the append-only record); only team_NAME was NOT
 * NULL. A lifecycle event with no actor needs team_name nullable too, so the
 * CHECK requires it only for a Pick.
 *
 * WHY down() RE-ADDS THE NOT NULLs. The reverse restores 20260826000004's
 * shape. On the migration-smoke path (a fresh, empty CI database: migrate ->
 * rollback -> migrate) the table holds no rows, so re-adding NOT NULL is clean.
 * On a table that already holds lifecycle rows with null Pick columns the
 * re-add would (correctly) fail: that is ADR 0012's guarded-rollback stance -
 * a destructive rollback that would strand append-only history refuses rather
 * than silently dropping it. Recovery after lifecycle rows exist is a forward
 * migration or the rollout flag, never this down().
 *
 * MIGRATIONS ARE A CARVE-OUT (ADR 0012): written here, applied and verified by
 * the maintainer against `knex_migrations`. An IC does not run it.
 */

const ACTIVITY = 'draft_activity';
const PICK_FIELDS_CHECK = 'draft_activity_pick_fields_present';

exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE "${ACTIVITY}"
    ALTER COLUMN "team_name" DROP NOT NULL,
    ALTER COLUMN "player_name" DROP NOT NULL,
    ALTER COLUMN "round" DROP NOT NULL,
    ALTER COLUMN "pick_number" DROP NOT NULL`);

  // A Pick still carries every snapshot fact; a lifecycle kind may leave them
  // null. Stated as "not a pick, OR all present" so the whole non-Pick space is
  // free and the Pick contract is unchanged.
  await knex.raw(`ALTER TABLE "${ACTIVITY}"
    ADD CONSTRAINT "${PICK_FIELDS_CHECK}" CHECK (
      "kind" <> 'pick'
      OR (
        "team_name" IS NOT NULL
        AND "player_name" IS NOT NULL
        AND "round" IS NOT NULL
        AND "pick_number" IS NOT NULL
      )
    )`);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE "${ACTIVITY}" DROP CONSTRAINT IF EXISTS "${PICK_FIELDS_CHECK}"`);
  // Restores 20260826000004's NOT NULLs. Fails by design if lifecycle rows with
  // null Pick columns exist (ADR 0012 guarded rollback); clean on an empty CI DB.
  await knex.raw(`ALTER TABLE "${ACTIVITY}"
    ALTER COLUMN "team_name" SET NOT NULL,
    ALTER COLUMN "player_name" SET NOT NULL,
    ALTER COLUMN "round" SET NOT NULL,
    ALTER COLUMN "pick_number" SET NOT NULL`);
};
