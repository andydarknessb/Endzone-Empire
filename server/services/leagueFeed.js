/**
 * The League chat feed: typed entries over one per-league chronology (#434).
 *
 * ADR 0012 keeps League chat and Draft activity as SEPARATE record types that
 * are PRESENTED as one chronologically ordered feed, sharing a single
 * transactional per-league sequence. This module is the League-chat half of
 * that feed: it reads `chat_messages` rows and shapes each as a typed feed
 * entry carrying its authoritative sequence position (`seq`, the row's
 * `feed_seq`). Draft activity will add its own kind against the same sequence
 * in a later slice; the `type` field is what lets one ordered read distinguish
 * them without inventing a fake chat author for a Draft event.
 *
 * The feed is a READ over the source table, never a copy of it. Nothing here
 * denormalises a message into a second store, so when retention or account
 * deletion removes a `chat_messages` row (server/services/retention.service.js,
 * privacy.service.js) the entry simply leaves the feed and its `seq` becomes a
 * gap - exactly ADR 0012's "removed rather than a retained copy", achieved by
 * having no copy to leave behind.
 *
 * Identity is Team-only (CONTEXT.md: Team identity; teamIdentity.js): an entry
 * carries `teamId` / `teamName` and never the author's account. A message from
 * a manager who has since left the league reads back with null Team identity
 * rather than dropping out, because the join behind the read is LEFT.
 */
const {
  TEAM_IDENTITY_FIELDS,
  teamIdentityColumns,
  teamIdentityJoin,
} = require('./teamIdentity');

/**
 * The typed feed-entry kinds that share one per-league chronology. League chat
 * is the only kind #434 delivers; Draft activity will add its own constant
 * here against the same sequence (ADR 0012).
 */
const LEAGUE_CHAT = 'league_chat';

/**
 * THE ONE PLACE that decides whether a feed entry is subject to per-viewer
 * blocking (#440, AC6/AC7). Blocking is a tool for muting another MANAGER's
 * human messages; it must never hide authoritative Draft activity involving the
 * blocked Team (AC7), because a Pick is a shared fact of the draft, not that
 * manager talking. So the decision is made on the entry's KIND, not on which
 * socket event happened to carry it: only human-authored kinds are blockable.
 *
 * This is deliberately a named set rather than an inline check at the delivery
 * site. When Draft activity gains its own kind here (ADR 0012, #435), whoever
 * adds it must look at this set and leave it out - the coupling is one obvious
 * line, not an assumption spread through a broadcast path. If a Draft-activity
 * kind is ever added here, AC7 breaks.
 */
const BLOCKABLE_FEED_TYPES = new Set([LEAGUE_CHAT]);

/** Whether entries of this kind may be withheld from a viewer who blocked the
 *  author. Only human-authored League chat is; Draft activity never is (AC7). */
function isBlockableFeedType(type) {
  return BLOCKABLE_FEED_TYPES.has(type);
}

/**
 * THE ONE PLACE that decides whether a feed entry may be HIDDEN by a
 * commissioner (#441, AC6). The reasoning is identical to blockability above,
 * and deliberately kept as its own named set so the coupling stays one obvious
 * line: hiding is a tool for moderating another MANAGER's human message, so it
 * must never touch authoritative Draft activity - a Pick is a shared fact of
 * the draft, not that manager talking, and moderation may not edit, hide or
 * delete it (AC6). Only human-authored kinds are moderatable.
 *
 * When Draft activity gains its own kind (ADR 0012, #435), whoever adds it must
 * look here and leave it OUT. If a Draft-activity kind is ever added to this
 * set, AC6 breaks. The two sets happen to be equal today because League chat is
 * the only human-authored kind; they are named separately because they answer
 * different questions (who may I hide from view for myself, vs. what may a
 * commissioner hide for everyone) and a future kind could be one but not the
 * other.
 */
const MODERATABLE_FEED_TYPES = new Set([LEAGUE_CHAT]);

/** Whether a commissioner may hide entries of this kind league-wide. Only
 *  human-authored League chat; Draft activity never is (AC6). */
function isModeratableFeedType(type) {
  return MODERATABLE_FEED_TYPES.has(type);
}

/**
 * The set of user ids who have blocked `authorId`, for filtering a LIVE
 * broadcast per recipient (#440, AC6). History and the unread badge filter with
 * the same `user_blocks` relation from the viewer's side; live delivery has to
 * ask it from the author's side, once per send, so the room broadcast can skip
 * exactly the viewers who would never see this message on a later history read.
 */
async function listBlockersOf(db, authorId) {
  if (!Number.isInteger(authorId)) return new Set();
  const result = await db.query(
    `SELECT "blocker_id" FROM "user_blocks" WHERE "blocked_id" = $1`,
    [authorId]
  );
  return new Set(result.rows.map((row) => row.blocker_id));
}

/**
 * The default and maximum number of entries one feed read returns. The initial
 * read returns the latest 100 visible entries (#434 acceptance criteria), and
 * a cursor page is bounded by the same ceiling so no caller can ask the server
 * for an unbounded scan.
 */
const FEED_PAGE_SIZE = 100;

/**
 * Shape one projected `chat_messages` row as a typed League-chat feed entry.
 * The row is expected to carry the Team identity aliases (`teamId`/`teamName`,
 * from teamIdentityColumns) and its `feed_seq`.
 *
 * `feed_seq` is a bigint, which pg returns as a string; `seq` is coerced to a
 * JSON number so the client can hand it straight back as `?before=<seq>`. Per
 * league the value stays far below the safe-integer ceiling.
 */
function feedEntryOf(row) {
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  // A commissioner-hidden message reads back as a neutral tombstone (#441,
  // AC3): its content never rides on the member feed, and the reason and the
  // moderator who acted are not projected here AT ALL - only the
  // authorized-reviewer history (safety.router) exposes those (AC4). The entry
  // keeps its seq and Team identity so ordering, pagination and "is this mine"
  // are unchanged; only the content becomes a tombstone.
  const hidden = row.hidden_at != null;
  return {
    type: LEAGUE_CHAT,
    id: row.id,
    seq: Number(row.feed_seq),
    // Read the Team identity back under the SAME frozen keys teamIdentityOf
    // and teamIdentityColumns write it as, so the entry's identity fields
    // cannot drift from the wire contract (teamIdentity.js, rule 1). A missing
    // value reads as null so the keys are always present.
    [idField]: row[idField] ?? null,
    [nameField]: row[nameField] ?? null,
    message: hidden ? null : row.message,
    hidden,
    created_at: row.created_at,
  };
}

/**
 * The latest page of visible League-chat entries for a league, oldest-first,
 * or the page just older than `before` (a `seq` cursor).
 *
 * Ordering is by `feed_seq`, the authoritative per-league chronology, not by
 * `created_at`: the sequence is the tie-free order two entries are read back
 * in, and it is the cursor a reconnecting client pages from. The window is
 * taken newest-first with the cursor and page limit, then flipped to ascending
 * display order. Blocked authors are filtered with the same predicate the
 * unread badge uses, so the feed never shows what the badge would never count.
 */
async function listLeagueChatFeed(db, { leagueId, viewerId, before = null, limit = FEED_PAGE_SIZE } = {}) {
  const capped = Math.min(Math.max(1, Number(limit) || FEED_PAGE_SIZE), FEED_PAGE_SIZE);
  const cursor = Number.isInteger(before) ? before : null;

  const params = [leagueId, viewerId];
  let cursorClause = '';
  if (cursor !== null) {
    params.push(cursor);
    cursorClause = `AND "chat_messages"."feed_seq" < $${params.length}`;
  }
  params.push(capped);
  const limitClause = `LIMIT $${params.length}`;

  const result = await db.query(
    `SELECT * FROM (
       SELECT "chat_messages"."id", "chat_messages"."message", "chat_messages"."created_at",
              "chat_messages"."feed_seq", "chat_messages"."hidden_at",
              ${teamIdentityColumns()}
       FROM "chat_messages"
       ${teamIdentityJoin('"chat_messages"."league_id"', '"chat_messages"."user_id"')}
       WHERE "chat_messages"."league_id" = $1
         AND NOT EXISTS (
           SELECT 1 FROM "user_blocks"
           WHERE "user_blocks"."blocker_id" = $2
             AND "user_blocks"."blocked_id" = "chat_messages"."user_id"
         )
         ${cursorClause}
       ORDER BY "chat_messages"."feed_seq" DESC
       ${limitClause}
     ) recent ORDER BY "feed_seq" ASC`,
    params
  );
  return result.rows.map(feedEntryOf);
}

module.exports = {
  LEAGUE_CHAT,
  BLOCKABLE_FEED_TYPES,
  isBlockableFeedType,
  MODERATABLE_FEED_TYPES,
  isModeratableFeedType,
  listBlockersOf,
  FEED_PAGE_SIZE,
  feedEntryOf,
  listLeagueChatFeed,
};
