/**
 * #111 (parent #108): Team names stop being optional. Every join path
 * already writes a `teams` row through the one membership write
 * (server/services/leagueMembership.service.js `joinLeague`, per ADR 0002),
 * and that write now refuses a blank or missing Team name at the server
 * boundary (server/services/teamName.js). This migration makes the database
 * itself enforce the same non-blank rule, and repairs the one legacy shape
 * that leaked an account identifier through a league-shared Team name, per
 * CONTEXT.md's Team identity entry.
 *
 * Three independent things happen here, in dependency order (the backfill
 * runs before the CHECK constraint exists, so it never fights it; not that
 * it could, since it only ever narrows a name, never blanks one):
 *
 * 1. Backfill: before this feature, `joinLeague` defaulted an omitted Team
 *    name to `${username}'s Team`. Nothing has ever forbidden a `username`
 *    that is itself an email address, so any such user got their email
 *    printed into a Team name every league member can see. Only a Team name
 *    that EXACTLY equals that generated pattern for an email-shaped
 *    username is replaced with a neutral `Team <id>` label -- the match is
 *    the whole string against the owner's actual username, never a "contains
 *    @" heuristic, so a custom name is left alone even when it contains an
 *    at-sign, and a non-email-shaped username's default name is left alone
 *    too (there is nothing to leak). See teamNamesBackfill.pg.test.js for
 *    the exact cases.
 *
 * 2. A real DB-level guard: `teams.name` was already NOT NULL but never
 *    forbade '' or all-whitespace. A CHECK constraint closes that gap,
 *    matching the server's own trim-then-require-length-1 rule.
 *
 * 3. `join_requests.team_name` widens to the same 120-character contract
 *    the server enforces (was 100), and every currently-pending request
 *    that predates this requirement (no team_name at all, or a blank one)
 *    is cancelled outright rather than silently defaulted -- the requester
 *    must resubmit with a name. Already-decided (approved/denied) requests
 *    are left as they are: historical record, not a live admission.
 */
exports.up = async function (knex) {
  // 1. Backfill: exact-match the legacy default pattern for an email-shaped
  // username only. The join to "users" resolves the owner's actual
  // username; string concatenation (not a text pattern) makes the match
  // exact rather than "contains @".
  await knex.raw(`
    UPDATE "teams" AS t
    SET "name" = 'Team ' || t."id"
    FROM "users" AS u
    WHERE t."owner_id" = u."id"
      AND t."name" = u."username" || '''s Team'
      AND u."username" ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$'
  `);

  // 2. DB-level non-blank guard, mirroring server/services/teamName.js.
  await knex.raw(`
    ALTER TABLE "teams"
    ADD CONSTRAINT "teams_name_not_blank_check" CHECK (length(btrim("name")) >= 1)
  `);

  // 3. join_requests.team_name widens to 120, and legacy nameless pending
  // requests are cancelled rather than approved with a defaulted name.
  await knex.raw(`ALTER TABLE "join_requests" ALTER COLUMN "team_name" TYPE varchar(120)`);
  await knex.raw(`
    UPDATE "join_requests"
    SET "status" = 'cancelled', "updated_at" = now()
    WHERE "status" = 'pending' AND btrim(coalesce("team_name", '')) = ''
  `);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE "teams" DROP CONSTRAINT IF EXISTS "teams_name_not_blank_check"`);
  await knex.raw(`ALTER TABLE "join_requests" ALTER COLUMN "team_name" TYPE varchar(100)`);
  // The backfilled Team names and cancelled legacy join requests are not
  // restored: like every other data backfill in this migration set (see
  // 20260822000001_fix_draft_rounds_at_start.js), this is a one-time repair,
  // not a reversible transform.
};
