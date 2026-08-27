/**
 * Give draft_activity a `reason` column so a Commissioner correction can record
 * its justification (#439, ADR 0012).
 *
 * 20260826000004 created draft_activity for Picks; 20260826000006 relaxed it for
 * the lifecycle kinds (#437). #439 adds the Commissioner correction: a
 * commissioner records a reason, then pauses the Draft and reverses its latest
 * non-keeper Pick as one atomic act (CONTEXT.md: Commissioner correction). The
 * correction is written to this SAME append-only feed and table (ADR 0012's
 * event list names commissioner correction), snapshotting the reversed Pick's
 * facts into the existing Pick-snapshot columns and its reason into this new
 * column, so the feed self-describes what was corrected and why without ever
 * rewriting the original Pick entry.
 *
 * WHY A KIND-SCOPED CHECK, NOT A BARE nullable COLUMN. The reason is meaningful
 * ONLY for a correction. Every other kind - a Pick, a start/pause/resume/reset/
 * completion - has no reason, and a stray reason on one of them would be noise a
 * reader (and the public presenter feed) could not place. So the column is
 * nullable, and a single CHECK ties its presence to the kind: a 'correction' row
 * MUST carry a 10-200 character reason (the same bound the client dialog and the
 * service enforce, #439 AC4), and every other kind MUST leave it null. Stating
 * the bound in the schema makes "a correction always has a bounded reason" an
 * enforced invariant this table owns, not merely a convention the service is
 * trusted to keep - the same posture 20260826000004 took with its feed_seq guard
 * and 20260826000006 took with its Pick-fields CHECK.
 *
 * WHY down() REFUSES WHEN A CORRECTION EXISTS. ADR 0012's guarded-rollback
 * stance: a committed correction is append-only Draft history, and dropping this
 * column would erase the recorded reason that history carries. On the
 * migration-smoke path (a fresh, empty CI database: migrate -> rollback ->
 * migrate) the table holds no correction rows, so the guard passes and the drop
 * is clean. Once corrections exist, recovery is a forward migration or the
 * rollout flag, never this down().
 *
 * MIGRATIONS ARE A CARVE-OUT (fleet policy): written here, applied and verified
 * by the maintainer against `knex_migrations`. An IC does not run it.
 */

const ACTIVITY = 'draft_activity';
const REASON_CHECK = 'draft_activity_correction_reason_shape';

exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE "${ACTIVITY}" ADD COLUMN "reason" text`);

  // A correction carries a bounded reason; nothing else carries one.
  await knex.raw(`ALTER TABLE "${ACTIVITY}"
    ADD CONSTRAINT "${REASON_CHECK}" CHECK (
      CASE
        WHEN "kind" = 'correction'
          THEN "reason" IS NOT NULL AND char_length("reason") BETWEEN 10 AND 200
        ELSE "reason" IS NULL
      END
    )`);
};

exports.down = async function (knex) {
  // ADR 0012 guarded rollback: refuse to erase a recorded correction reason.
  const present = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM "${ACTIVITY}" WHERE "kind" = 'correction') AS present`
  );
  if (present.rows[0].present) {
    throw new Error(
      'refusing to drop draft_activity.reason: committed corrections carry append-only ' +
        'justification (ADR 0012). Recover with a forward migration or the rollout flag.'
    );
  }
  await knex.raw(`ALTER TABLE "${ACTIVITY}" DROP CONSTRAINT IF EXISTS "${REASON_CHECK}"`);
  await knex.raw(`ALTER TABLE "${ACTIVITY}" DROP COLUMN IF EXISTS "reason"`);
};
