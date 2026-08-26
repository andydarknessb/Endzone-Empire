/**
 * Audited commissioner content moderation for League chat (#441, parent #429).
 *
 * A commissioner (or co-commissioner) can HIDE an abusive League-chat message
 * league-wide, and every authorized reviewer can later read back what was
 * hidden, by whom, why and when. This migration adds the three facts that a
 * hide records, directly on `chat_messages`:
 *
 *   hidden_at      the instant the message was hidden; NULL means "not hidden",
 *                  so it is both the flag the member feed tombstones on and the
 *                  audit timestamp the reviewer reads.
 *   hidden_by      the moderator's account id (FK users, ON DELETE SET NULL):
 *                  the ACTOR the audit preserves. SET NULL rather than CASCADE
 *                  because a deleted moderator must not erase the hide - the
 *                  tombstone and the reason outlive the account that acted.
 *   hidden_reason  the required reason. A hide is refused without one (AC2), so
 *                  a hidden row always carries it; a member never sees it, only
 *                  an authorized reviewer does (AC4).
 *
 * WHY ON `chat_messages` AND NOT A SEPARATE AUDIT TABLE. Hiding is a state of
 * the message, not a deletion of it: the original content stays in `message`
 * and is what the authorized-reviewer history returns (AC4). Keeping the hide
 * facts on the same row means retention and account deletion
 * (retention.service, privacy.service) remove the content, the tombstone AND
 * the audit together when they delete the row - ADR 0012's "removed rather than
 * a retained copy", with nothing left behind to leak. A side audit table would
 * be a second copy of the very content the deletion exists to remove, and would
 * have to be purged in lockstep; there is no such second copy to keep honest.
 *
 * WHY THIS TOUCHES ONLY `chat_messages`. Moderation acts on human-authored
 * League chat alone. Draft activity is a separate, append-only record type
 * (ADR 0012) that this feature must never edit, hide or delete (AC6); it has no
 * hide columns here and the hide path is scoped to `chat_messages` by id, so a
 * Draft event is structurally unreachable by a hide.
 *
 * EXPAND-ONLY, LOCKS BRIEFLY. Adds three nullable columns and one partial
 * index; no backfill, no table rewrite. The ADD COLUMN takes a brief ACCESS
 * EXCLUSIVE lock and the CREATE INDEX (plain, not CONCURRENTLY, because knex
 * runs migrations transactionally in this repo) a SHARE lock that conflicts
 * with a chat insert's ROW EXCLUSIVE - both milliseconds while `chat_messages`
 * is small (see the same note in 20260826000003). The partial index backs the
 * one read that scans by hidden state, the reviewer's moderation history, and
 * indexes only the few hidden rows.
 *
 * A schema rollback is safe: `down` drops the index and the columns, which is
 * only lossy for hides that exist, exactly the ADR-0012 "rollback while empty"
 * shape. Once hides exist, recovery is a forward migration, not this down.
 */

const CHAT = 'chat_messages';
const INDEX = 'chat_messages_hidden_league';

exports.up = async function (knex) {
  await knex.schema.alterTable(CHAT, (t) => {
    t.timestamp('hidden_at', { useTz: true });
    t.integer('hidden_by').references('users.id').onDelete('SET NULL');
    // 500 matches the reason bound the report workflow already enforces
    // (content_reports.reason), so a hide reason and a report reason are the
    // same shape of text.
    t.string('hidden_reason', 500);
  });

  // The reviewer's moderation history reads WHERE league_id = $1 AND
  // hidden_at IS NOT NULL; the partial index carries only hidden rows.
  await knex.raw(
    `CREATE INDEX "${INDEX}"
     ON "${CHAT}" ("league_id", "hidden_at")
     WHERE "hidden_at" IS NOT NULL`
  );
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS "${INDEX}"`);
  await knex.schema.alterTable(CHAT, (t) => {
    t.dropColumn('hidden_reason');
    t.dropColumn('hidden_by');
    t.dropColumn('hidden_at');
  });
};
