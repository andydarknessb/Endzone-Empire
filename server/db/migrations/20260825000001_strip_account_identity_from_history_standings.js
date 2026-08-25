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
 *
 * Shape: `standings` is contractually an array of objects (the write path only
 * ever produces one). The strip and the CHECK are deliberately aligned on that
 * assumption - both act only on ARRAY values and only on OBJECT elements, and
 * both leave any non-array value (object, scalar, JSON null) untouched. This is
 * what makes the migration abort-proof on a hand-apply: strip and CHECK agree
 * on every pre-existing shape, so no row is skipped by the rewrite yet rejected
 * by the constraint. A non-array `standings` value is not this ticket's concern
 * (it would already break the array-shaped read path); enforcing that shape is a
 * separate constraint, out of scope here.
 */

// The account-identity keys forbidden inside every standings element. This one
// array is the single source for BOTH the removal (the `-` chain that deletes
// them) and the detection (the jsonpath that finds them, used by the strip
// WHERE and the CHECK). Deriving all three from it keeps them in genuine
// lockstep: a key added here is removed, detected and rejected together, so a
// row can never be rewritten into a shape the constraint would still reject.
const FORBIDDEN_ACCOUNT_KEYS = ['userId', 'username', 'user_id', 'email', 'owner_id'];

// e.g. `- 'userId' - 'username' - ...`: subtracts each key from a jsonb object.
const REMOVE_KEYS_SQL = FORBIDDEN_ACCOUNT_KEYS.map((key) => `- '${key}'`).join(' ');

// The jsonpath that matches an account-identity key on a direct OBJECT element
// of the standings array. Both `\\?` are LITERAL question marks escaped for
// knex.raw, which otherwise reads the jsonpath filter operator `?` as a
// positional binding and corrupts the SQL. No user input, so it is inlined
// below. Every clause is load-bearing; all four behaviours were measured on a
// real postgres:17 so the strip and the CHECK agree on EVERY shape and the
// migration can never abort on a pre-existing row (see the header note):
//   - `strict` stops lax mode from flattening a NESTED ARRAY element. Under lax
//     `$[*]`, `[[{"userId":1}]]` descends into the inner array and MATCHES,
//     while the shallow `-` removal cannot touch an array element - detection
//     and removal disagree, the row survives the strip and then fails the CHECK.
//     `strict $[*]` yields the direct element only, so it does not match; both
//     leave it alone.
//   - `? (@.type() == "object")` filters to object elements BEFORE .keyvalue().
//     Without it, `.keyvalue()` on a scalar element raises a hard 2203C error
//     ("keyvalue() can only be applied to an object"), not a false - and under
//     `strict` a bare scalar element would raise too.
//   - detection is over TOP-LEVEL element keys only, exactly as shallow as the
//     `-` removal chain, so the two never disagree: a key nested inside a value
//     (e.g. {"meta":{"userId":1}}) is matched by neither and stripped by
//     neither. Standings elements DO nest one object today - `weekly`, which is
//     week -> points and carries no account keys - so top-level-only is both
//     deliberate and sufficient for every shape this code writes.
const FORBIDDEN_KEY_PREDICATE =
  'strict $[*] \\? (@.type() == "object").keyvalue() \\? (' +
  FORBIDDEN_ACCOUNT_KEYS.map((key) => `@.key == "${key}"`).join(' || ') +
  ')';

exports.up = async function (knex) {
  // 1. Rewrite existing archives. Only rows that actually carry a forbidden key
  //    are touched, so the statement is idempotent (a second run matches
  //    nothing) and safe on an empty table. Element order is preserved.
  await knex.raw(
    `
    UPDATE "league_history" AS "history"
       SET "standings" = COALESCE((
             SELECT jsonb_agg(
                      CASE WHEN jsonb_typeof("element") = 'object'
                           THEN ("element" ${REMOVE_KEYS_SQL})
                           ELSE "element" END
                      ORDER BY "ordinality"
                    )
               FROM jsonb_array_elements("history"."standings")
                 WITH ORDINALITY AS "elements"("element", "ordinality")
           ), '[]'::jsonb)
     WHERE CASE
             WHEN jsonb_typeof("history"."standings") = 'array'
               THEN jsonb_path_exists("history"."standings", '${FORBIDDEN_KEY_PREDICATE}')
             ELSE false
           END
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
          OR CASE
               WHEN jsonb_typeof("standings") = 'array'
                 THEN NOT jsonb_path_exists("standings", '${FORBIDDEN_KEY_PREDICATE}')
               ELSE true
             END
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
