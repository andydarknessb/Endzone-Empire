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
const { activityEntryOf, DRAFT_ACTIVITY } = require('./draftActivity');

/**
 * The typed feed-entry kinds that share one per-league chronology. League chat
 * is the only kind #434 delivers; Draft activity will add its own constant
 * here against the same sequence (ADR 0012).
 */
const LEAGUE_CHAT = 'league_chat';

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
    message: row.message,
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
              "chat_messages"."feed_seq",
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

/**
 * Shape one row of the COMBINED feed read by its `source` discriminator. Chat
 * rows go through feedEntryOf (LEAGUE_CHAT), Draft-activity rows through
 * activityEntryOf (DRAFT_ACTIVITY). Both read Team identity under the same
 * frozen TEAM_IDENTITY_FIELDS aliases, so one union can carry either.
 */
function combinedEntryOf(row) {
  return row.source === DRAFT_ACTIVITY ? activityEntryOf(row) : feedEntryOf(row);
}

/**
 * The combined Draft-room feed for a league: League chat and Draft activity
 * interleaved into ONE order by the shared per-league `feed_seq` (#435, ADR
 * 0012), oldest-first, or the page just older than `before` (a `seq` cursor).
 *
 * This is the Draft room's feed. The League Dashboard drawer stays chat-only
 * (listLeagueChatFeed); ADR 0012 keeps the two records apart and presents them
 * together only here.
 *
 * Ordering is by `feed_seq`, the authoritative chronology both kinds share, so
 * every client and every reconnecting client reproduces the same interleaving
 * (#435 AC4) - not by `created_at`, which cannot tie-break a chat message and a
 * Pick committed in the same instant.
 *
 * EACH branch is bounded to the page size before the union, not just the union
 * afterwards: the latest N overall are within the latest N of each branch (a
 * row with N-1 entries above it overall has at most N-1 above it in its own
 * table), so `(chat DESC LIMIT n) UNION ALL (activity DESC LIMIT n)` then a
 * final `DESC LIMIT n` returns the same page without materializing a whole
 * league's chat and Picks first - each arm is an index-only walk of the unique
 * `(league_id, feed_seq)` index. The outermost `ORDER BY feed_seq ASC` gives the
 * oldest-first display order, matching listLeagueChatFeed's idiom.
 *
 * The block predicate applies to CHAT ONLY: a blocked manager's messages are
 * hidden (the same predicate the unread badge and the chat feed use), but their
 * authoritative Draft activity stays visible, because blocking must never hide
 * shared Draft state (CONTEXT.md; ADR 0012; spec user story 83).
 */
async function listCombinedDraftFeed(db, { leagueId, viewerId, before = null, limit = FEED_PAGE_SIZE } = {}) {
  const capped = Math.min(Math.max(1, Number(limit) || FEED_PAGE_SIZE), FEED_PAGE_SIZE);
  const cursor = Number.isInteger(before) ? before : null;

  const params = [leagueId, viewerId];
  let chatCursor = '';
  let activityCursor = '';
  if (cursor !== null) {
    params.push(cursor);
    const p = `$${params.length}`;
    chatCursor = `AND "chat_messages"."feed_seq" < ${p}`;
    activityCursor = `AND "draft_activity"."feed_seq" < ${p}`;
  }
  params.push(capped);
  // One bound parameter, referenced by all three LIMITs (per-branch and outer).
  const lim = `$${params.length}`;

  // The two branches carry the SAME columns in the SAME order so the UNION is
  // well-typed; the NULL placeholders are cast so Postgres can resolve each
  // column's type from either branch. combinedEntryOf then reads only the ones
  // its kind needs. Each arm is parenthesized so it can carry its own ORDER
  // BY / LIMIT.
  const result = await db.query(
    `SELECT * FROM (
       SELECT * FROM (
         (SELECT '${LEAGUE_CHAT}' AS source,
                 "chat_messages"."id" AS id,
                 "chat_messages"."feed_seq" AS feed_seq,
                 "chat_messages"."created_at" AS created_at,
                 "chat_messages"."message" AS message,
                 ${teamIdentityColumns()},
                 NULL::text AS kind,
                 NULL::int AS player_id,
                 NULL::text AS player_name,
                 NULL::text AS player_position,
                 NULL::text AS player_nfl_team,
                 NULL::int AS round,
                 NULL::int AS pick_number,
                 NULL::boolean AS is_autopick
            FROM "chat_messages"
            ${teamIdentityJoin('"chat_messages"."league_id"', '"chat_messages"."user_id"')}
           WHERE "chat_messages"."league_id" = $1
             AND NOT EXISTS (
               SELECT 1 FROM "user_blocks"
                WHERE "user_blocks"."blocker_id" = $2
                  AND "user_blocks"."blocked_id" = "chat_messages"."user_id"
             )
             ${chatCursor}
           ORDER BY "chat_messages"."feed_seq" DESC
           LIMIT ${lim})
         UNION ALL
         (SELECT '${DRAFT_ACTIVITY}' AS source,
                 "draft_activity"."id" AS id,
                 "draft_activity"."feed_seq" AS feed_seq,
                 "draft_activity"."created_at" AS created_at,
                 NULL::text AS message,
                 "draft_activity"."team_id" AS "teamId",
                 "draft_activity"."team_name" AS "teamName",
                 "draft_activity"."kind" AS kind,
                 "draft_activity"."player_id" AS player_id,
                 "draft_activity"."player_name" AS player_name,
                 "draft_activity"."player_position" AS player_position,
                 "draft_activity"."player_nfl_team" AS player_nfl_team,
                 "draft_activity"."round" AS round,
                 "draft_activity"."pick_number" AS pick_number,
                 "draft_activity"."is_autopick" AS is_autopick
            FROM "draft_activity"
           WHERE "draft_activity"."league_id" = $1
             ${activityCursor}
           ORDER BY "draft_activity"."feed_seq" DESC
           LIMIT ${lim})
       ) merged
       ORDER BY feed_seq DESC
       LIMIT ${lim}
     ) page
     ORDER BY feed_seq ASC`,
    params
  );
  return result.rows.map(combinedEntryOf);
}

module.exports = {
  LEAGUE_CHAT,
  FEED_PAGE_SIZE,
  feedEntryOf,
  listLeagueChatFeed,
  combinedEntryOf,
  listCombinedDraftFeed,
};
