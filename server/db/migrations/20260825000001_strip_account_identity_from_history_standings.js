/**
 * Strip manager account identity out of the frozen season archive and forbid
 * it forever (#342, #115).
 *
 * `league_history.standings` is a JSONB array frozen at season rollover and
 * served verbatim to every league member. A pick'em-only rollover used to
 * spread each standings row into the snapshot, freezing the manager account
 * join key (`userId`) - and, historically, `username` - into a member-visible
 * blob. This migration rewrites every existing archive to drop those account
 * keys, then adds a CHECK so no future write can freeze one again, in the style
 * of the `league_history_pickem_result_check` guard on the neighbouring column.
 *
 * The account keys stripped here are the ones a survey of real rows can carry:
 * `userId` (the live leak), plus `username`, `user_id`, `email`, `owner_id`
 * from older shapes. Team identity (`teamId`, `name`), scoring totals and
 * per-week points are kept. `champion_user_id` is a separate column, never part
 * of `standings`, so it is out of scope here (it is simply not served).
 *
 * The rewrite is destructive by design: an account id must not be recoverable
 * from a snapshot. So `down` is a documented no-op. The rewrite is the only
 * place this happens; nothing cleans on read.
 */

// The jsonpath that finds an account-identity key on ANY element of the
// standings array. `\\?` is a LITERAL question mark escaped for knex.raw, which
// otherwise reads the jsonpath filter operator `?` as a positional binding and
// corrupts the SQL. The predicate is a fixed constant (no user input), so it is
// inlined into a string literal in both statements below; keeping a single
// source keeps the strip and the CHECK in lockstep, so a row can never be
// rewritten into a shape the constraint would still reject.
const FORBIDDEN_KEY_PREDICATE =
  '$[*].keyvalue() \\? (' +
  '@.key == "userId" || @.key == "username" || @.key == "user_id"' +
  ' || @.key == "email" || @.key == "owner_id")';

exports.up = async function (knex) {
  // 1. Rewrite existing archives. Only rows that actually carry a forbidden key
  //    are touched, so the statement is idempotent (a second run matches
  //    nothing) and safe on an empty table. Element order is preserved.
  await knex.raw(
    `
    UPDATE "league_history" AS "history"
       SET "standings" = COALESCE((
             SELECT jsonb_agg(
                      ("element" - 'userId' - 'username' - 'user_id' - 'email' - 'owner_id')
                      ORDER BY "ordinality"
                    )
               FROM jsonb_array_elements("history"."standings")
                 WITH ORDINALITY AS "elements"("element", "ordinality")
           ), '[]'::jsonb)
     WHERE jsonb_typeof("history"."standings") = 'array'
       AND jsonb_path_exists("history"."standings", '${FORBIDDEN_KEY_PREDICATE}')
    `
  );

  // 2. Guard the column. Added AFTER the rewrite so no stale row can survive it,
  //    and turns any future write that freezes an account id into a 23514 error
  //    rather than a silent leak. DROP IF EXISTS keeps `up` re-runnable.
  await knex.raw(
    `ALTER TABLE "league_history"
       DROP CONSTRAINT IF EXISTS "league_history_standings_no_account_identity_check"`
  );
  await knex.raw(
    `
    ALTER TABLE "league_history"
      ADD CONSTRAINT "league_history_standings_no_account_identity_check"
        CHECK (
          "standings" IS NULL
          OR NOT jsonb_path_exists("standings", '${FORBIDDEN_KEY_PREDICATE}')
        )
    `
  );
};

exports.down = async function () {
  // Intentional no-op. `up` deletes account identifiers out of frozen
  // snapshots; those values are not recoverable and must not be. Dropping the
  // CHECK on rollback would also re-open the leak the migration exists to
  // close, so the guard is left in place. There is nothing safe to undo.
};
