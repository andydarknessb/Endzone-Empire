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
const {
  activityEntryOf,
  DRAFT_ACTIVITY,
  PICK,
  DRAFT_START,
  PAUSE,
  RESUME,
  RESET,
  COMPLETE,
  STALLED,
  CORRECTION,
  USER_VISIBLE_KINDS,
} = require('./draftActivity');
// The content_kind discriminator value for a GIF message (#446). A GIF message
// is a chat_messages row like any other, so it flows through this same feed;
// feedEntryOf reads its content_kind to decide whether to project `media`.
const { GIF } = require('../modules/gifMessage');

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
 * The set of feed kinds a commissioner may HIDE league-wide (#441, AC6). It is
 * the EXPLICIT, machine-checked form of the AC6 invariant "Draft activity
 * cannot be hidden through moderation": hiding is a tool for moderating another
 * MANAGER's human message, and a Pick is a shared fact of the draft, not that
 * manager talking, so only human-authored kinds are moderatable.
 *
 * WHY THIS EXISTS ALONGSIDE A STRUCTURAL GUARD. Today the hide path
 * (safety.router POST /hide) also enforces AC6 structurally - its UPDATE is
 * scoped to `chat_messages` by id, so a Draft-activity id reaches nothing. This
 * set is the second, explicit barrier: it states the invariant where the feed
 * kinds are defined, so "Draft activity is not moderatable" lives in the
 * repository as a checked fact rather than only as the shape of a WHERE clause -
 * the same two-barrier philosophy as the #378 allowlist (SQL AND JS). It stops
 * being merely explanatory the moment Draft activity gains its own feed kind
 * (ADR 0012, its filed sibling #435 appends Picks to this same feed): a
 * hide-by-feed-entry path added then MUST consult this set and leave that kind
 * out, and `isModeratableFeedType` is the one line it calls. If a Draft-activity
 * kind is ever ADDED to this set, AC6 breaks.
 *
 * It mirrors BLOCKABLE_FEED_TYPES because both answer "human-authored only", and
 * the service test pins them equal so the parallel cannot silently diverge; they
 * are named apart because they answer different questions (what may I mute for
 * myself vs. what may a commissioner hide for everyone) and a future kind could
 * be one but not the other.
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
  // A GIF message (content_kind='gif', #446) carries a structured `media` object
  // alongside its optional caption (which rides on `message`, the same key text
  // uses). A text message carries media:null. On a hide, `media` is suppressed
  // to null exactly as the caption is: the asset, the caption and the
  // description are all author-authored content, so a hidden GIF reads back as
  // the SAME neutral tombstone as a hidden text message (the moderation
  // decision, #446 AC3). The reviewer history (safety.router) is the only place
  // the original GIF content survives. This is DISTINCT from AC5 unavailable
  // media, which is not hidden and keeps its caption and description in the tile.
  const isGif = row.content_kind === GIF;
  const media = hidden || !isGif
    ? null
    : { provider: row.gif_provider, assetId: row.gif_asset_id, description: row.gif_description };
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
    message: hidden ? null : (row.message ?? null),
    media,
    hidden,
    // Whether this message predates the cutover boundary and was backfilled as a
    // legacy fact (#436). Live messages read false; a message from before the
    // column existed reads false too, so the key is always present.
    isLegacy: row.is_legacy ?? false,
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
 *
 * `after` is the reconnect-resume cursor (#442): given the last `seq` a client
 * acknowledged, it returns the entries just NEWER than it (`feed_seq > after`)
 * in ascending order, so a reconnecting client resumes from where it left off
 * and reproduces the same chronology without refetching the whole conversation.
 * It walks forward from the cursor, so it takes the OLDEST page after it and is
 * already ascending - no newest-first window to flip. `after` takes precedence
 * over `before`; a caller uses one direction at a time.
 */
async function listLeagueChatFeed(db, { leagueId, viewerId, before = null, after = null, limit = FEED_PAGE_SIZE } = {}) {
  const capped = Math.min(Math.max(1, Number(limit) || FEED_PAGE_SIZE), FEED_PAGE_SIZE);
  // One query, two directions - the same parameterization the sibling
  // listCombinedDraftFeed uses. `after` resumes forward (feed_seq > cursor),
  // walking the oldest page after it, already ascending; the default/`before`
  // window takes the newest page (feed_seq < cursor) descending then flips to
  // ascending display order. `after` takes precedence; a caller pages one way.
  const resumeFrom = Number.isInteger(after) ? after : null;
  const cursor = resumeFrom !== null ? resumeFrom : (Number.isInteger(before) ? before : null);
  const cmp = resumeFrom !== null ? '>' : '<';
  const windowOrder = resumeFrom !== null ? 'ASC' : 'DESC';

  const params = [leagueId, viewerId];
  let cursorClause = '';
  if (cursor !== null) {
    params.push(cursor);
    cursorClause = `AND "chat_messages"."feed_seq" ${cmp} $${params.length}`;
  }
  params.push(capped);
  const limitClause = `LIMIT $${params.length}`;

  const result = await db.query(
    `SELECT * FROM (
       SELECT "chat_messages"."id", "chat_messages"."message", "chat_messages"."created_at",
              "chat_messages"."feed_seq", "chat_messages"."hidden_at", "chat_messages"."is_legacy",
              "chat_messages"."content_kind", "chat_messages"."gif_provider",
              "chat_messages"."gif_asset_id", "chat_messages"."gif_description",
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
       ORDER BY "chat_messages"."feed_seq" ${windowOrder}
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
 * Pick committed in the same instant. That the two kinds never hold the SAME
 * `feed_seq` in a league is produced by the shared counter (both allocate under
 * its row lock), not enforced across the two tables - each has only its own
 * per-table unique index. Enforcing it across records is tracked as #471; it
 * becomes reachable only when a writer supplies an explicit position (legacy
 * backfill, #436), which nothing here does.
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
 *
 * Commissioner moderation is CHAT ONLY for the same reason (#441, AC6): the chat
 * arm projects `hidden_at` so a hidden message reads back here as the same
 * neutral tombstone the chat-only feed produces (combinedEntryOf -> feedEntryOf),
 * while the Draft-activity arm carries a NULL `hidden_at` placeholder and routes
 * to activityEntryOf - a Pick is never moderatable and never a tombstone.
 *
 * The Draft-activity arm restricts `kind` to USER_VISIBLE_KINDS - the positive
 * member allowlist - INSIDE its WHERE, so the internal CUTOVER boundary (#436)
 * is excluded BEFORE the per-arm LIMIT and can never consume a visible page slot
 * (#540 AC4). (The presenter reader filters on its own independent
 * PRESENTER_ACTIVITY_KINDS, holding the same kinds today but declared apart,
 * #619.) Filtering after the limit would let a
 * page that happened to hold a cutover row come back short, an intermittent gap
 * with no error; filtering before it cannot. Unlike the presenter reader, the
 * activity arm DOES project `reason`: a Commissioner correction's recorded
 * justification is authored FOR league members (#540 AC1), so combinedEntryOf ->
 * activityEntryOf shapes a member correction with its reason. The chat arm
 * carries the aligned NULL::text reason placeholder for the union.
 */
async function listCombinedDraftFeed(db, { leagueId, viewerId, before = null, after = null, limit = FEED_PAGE_SIZE } = {}) {
  const capped = Math.min(Math.max(1, Number(limit) || FEED_PAGE_SIZE), FEED_PAGE_SIZE);
  // `after` is the reconnect-resume cursor (#442): walk FORWARD from the last
  // acknowledged seq, taking the oldest page NEWER than it so a reconnecting
  // client resumes in the same chronology without refetching the whole feed.
  // It takes precedence over `before`; a caller pages one direction at a time.
  // Forward resume compares `>` and reads ascending on each arm; the default
  // newest-first window compares `<` and reads descending then flips.
  const resumeFrom = Number.isInteger(after) ? after : null;
  const cursor = resumeFrom !== null ? resumeFrom : (Number.isInteger(before) ? before : null);
  const cmp = resumeFrom !== null ? '>' : '<';
  // Both union arms and the merge share one direction: resume walks forward
  // ascending, the default/before window takes the newest page descending.
  const windowOrder = resumeFrom !== null ? 'ASC' : 'DESC';

  // $1 league, $2 viewer, $3 the positive user-visible kind allowlist. The
  // allowlist is bound BEFORE any cursor so its placeholder is stable ($3)
  // whether or not a cursor is present; the activity arm filters on it INSIDE
  // its WHERE, so an internal kind (the CUTOVER boundary, #436) is excluded
  // before the per-arm LIMIT and never consumes a visible page slot (#540 AC4).
  const params = [leagueId, viewerId, USER_VISIBLE_KINDS];
  const visible = `$${params.length}`;
  let chatCursor = '';
  let activityCursor = '';
  if (cursor !== null) {
    params.push(cursor);
    const p = `$${params.length}`;
    chatCursor = `AND "chat_messages"."feed_seq" ${cmp} ${p}`;
    activityCursor = `AND "draft_activity"."feed_seq" ${cmp} ${p}`;
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
                 "chat_messages"."hidden_at" AS hidden_at,
                 "chat_messages"."content_kind" AS content_kind,
                 "chat_messages"."gif_provider" AS gif_provider,
                 "chat_messages"."gif_asset_id" AS gif_asset_id,
                 "chat_messages"."gif_description" AS gif_description,
                 ${teamIdentityColumns()},
                 NULL::text AS kind,
                 NULL::int AS player_id,
                 NULL::text AS player_name,
                 NULL::text AS player_position,
                 NULL::text AS player_nfl_team,
                 NULL::int AS round,
                 NULL::int AS pick_number,
                 NULL::boolean AS is_autopick,
                 NULL::text AS reason,
                 "chat_messages"."is_legacy" AS is_legacy
            FROM "chat_messages"
            ${teamIdentityJoin('"chat_messages"."league_id"', '"chat_messages"."user_id"')}
           WHERE "chat_messages"."league_id" = $1
             AND NOT EXISTS (
               SELECT 1 FROM "user_blocks"
                WHERE "user_blocks"."blocker_id" = $2
                  AND "user_blocks"."blocked_id" = "chat_messages"."user_id"
             )
             ${chatCursor}
           ORDER BY "chat_messages"."feed_seq" ${windowOrder}
           LIMIT ${lim})
         UNION ALL
         (SELECT '${DRAFT_ACTIVITY}' AS source,
                 "draft_activity"."id" AS id,
                 "draft_activity"."feed_seq" AS feed_seq,
                 "draft_activity"."created_at" AS created_at,
                 NULL::text AS message,
                 NULL::timestamptz AS hidden_at,
                 NULL::text AS content_kind,
                 NULL::text AS gif_provider,
                 NULL::text AS gif_asset_id,
                 NULL::text AS gif_description,
                 "draft_activity"."team_id" AS "teamId",
                 "draft_activity"."team_name" AS "teamName",
                 "draft_activity"."kind" AS kind,
                 "draft_activity"."player_id" AS player_id,
                 "draft_activity"."player_name" AS player_name,
                 "draft_activity"."player_position" AS player_position,
                 "draft_activity"."player_nfl_team" AS player_nfl_team,
                 "draft_activity"."round" AS round,
                 "draft_activity"."pick_number" AS pick_number,
                 "draft_activity"."is_autopick" AS is_autopick,
                 "draft_activity"."reason" AS reason,
                 "draft_activity"."is_legacy" AS is_legacy
            FROM "draft_activity"
           WHERE "draft_activity"."league_id" = $1
             AND "draft_activity"."kind" = ANY(${visible})
             ${activityCursor}
           ORDER BY "draft_activity"."feed_seq" ${windowOrder}
           LIMIT ${lim})
       ) merged
       ORDER BY feed_seq ${windowOrder}
       LIMIT ${lim}
     ) page
     ORDER BY feed_seq ASC`,
    params
  );
  return result.rows.map(combinedEntryOf);
}

/**
 * The PRESENTER-safe Draft-activity feed (#438): the Draft-activity half of the
 * combined feed with NO chat arm, read for an anonymous presenter-link viewer.
 *
 * The SEPARATION from listCombinedDraftFeed IS the privacy boundary, not a
 * convenience. This reader queries `draft_activity` and nothing else, so League
 * chat, the unread relation, commissioner moderation (`hidden_at`) and
 * per-viewer blocking (`user_blocks`) are absent BY CONSTRUCTION - there is no
 * filter for a later edit to weaken and no chat table to accidentally re-join
 * (#438 AC2). There is no `viewerId`, because a presenter is not a member with a
 * block list; the feed is scoped by `leagueId` alone, resolved from the presenter
 * token by the route.
 *
 * draft_activity is inherently account-free: it carries Team identity and Pick /
 * lifecycle snapshots, never a `user_id` (draftActivity.js), so every entry is
 * Team-only (#438 AC4) without a serializer having to strip anything. The one
 * column deliberately NOT projected is `reason`: a Commissioner correction's
 * free-text (#439) is authored for league members, not vetted for an anonymous
 * public link, so a presenter reads a correction as its Team-only Pick snapshot
 * with `reason` null (#438 AC3, "approved public facts"). Every projected field
 * shapes through the SAME activityEntryOf a member reads, so the presenter and
 * the Draft room agree on the authoritative record.
 *
 * The KINDS a presenter may see are an explicit ALLOWLIST (#438 AC3, "approved
 * public Pick and lifecycle facts"), not everything in draft_activity. A Pick,
 * each lifecycle transition named below and a Commissioner correction are
 * approved public facts; the CUTOVER boundary marker (#436) is an internal
 * backfill artifact that carries no Team or Pick fact and reads as noise, so it
 * is left out. Because this is a positive list, a NEW kind added upstream does
 * not reach an anonymous board until it is added here on purpose - publication
 * by decision, the same stance the board's field allowlist takes.
 *
 * That promise holds only because every approved kind is spelled out LITERALLY
 * below - the list does NOT spread LIFECYCLE_KINDS (#619). Under the old spread a
 * new lifecycle kind reached this open-internet surface with no SOURCE edit to
 * this array: #602's `stalled` arrived exactly that way. A test did fire - the
 * literal kind-list assertion in presenterDraftActivity.service.test.js went from
 * seven kinds to eight (PR #618) - but that only bumped a downstream assertion to
 * match a decision already taken elsewhere; the array that governs the anonymous
 * board was itself never reviewed. Enumerating each kind makes exposing one here
 * a DELIBERATE edit to this array, never an inherited default.
 *
 * The literal form is itself enforced (#633). A value-comparing test cannot see
 * it - a re-spread of `[PICK, ...LIFECYCLE_KINDS, CORRECTION]` yields a
 * byte-identical array and the whole suite still passes - so the guard reads the
 * SOURCE FORM instead: presenterDraftActivity.service.test.js extracts this
 * initialiser expression (its `Object.freeze([ ... ])`, scoped off this comment)
 * and asserts it holds no spread token, failing loudly if the declaration is ever
 * renamed rather than matching nothing. That is the consumer of the "literal,
 * never a spread" rule; a future edit that silently restores the spread turns it
 * red. What IS enforced complementarily (below): an append to LIFECYCLE_KINDS
 * turns the #540 equality pin red.
 *
 * It holds the SAME kinds as the member feed's USER_VISIBLE_KINDS today, but is
 * declared INDEPENDENTLY (#540), NOT aliased to it and no longer sharing its
 * LIFECYCLE_KINDS spread. The presenter link is anonymous and shareable, so the
 * two surfaces must be able to diverge on purpose. Because this list is literal
 * while USER_VISIBLE_KINDS still spreads LIFECYCLE_KINDS, a future lifecycle
 * kind added to LIFECYCLE_KINDS flows into the member set automatically but not
 * into this list: the #540 contract test that pins the two equal then FIRES on
 * that difference, turning the divergence into a conscious, reviewed decision
 * rather than a silent leak. (The reason FIELD is protected structurally - a
 * member sees it, a presenter never does, below.)
 *
 * Cursors mirror the sibling readers: the default/`before` window takes the
 * newest page descending then flips to ascending display order; `after` resumes
 * forward (feed_seq > cursor) ascending. `after` takes precedence; a caller
 * pages one direction at a time.
 */
const PRESENTER_ACTIVITY_KINDS = Object.freeze([
  PICK,
  DRAFT_START,
  PAUSE,
  RESUME,
  RESET,
  COMPLETE,
  STALLED,
  CORRECTION,
]);

async function listPresenterDraftActivity(db, { leagueId, before = null, after = null, limit = FEED_PAGE_SIZE } = {}) {
  const capped = Math.min(Math.max(1, Number(limit) || FEED_PAGE_SIZE), FEED_PAGE_SIZE);
  const resumeFrom = Number.isInteger(after) ? after : null;
  const cursor = resumeFrom !== null ? resumeFrom : (Number.isInteger(before) ? before : null);
  const cmp = resumeFrom !== null ? '>' : '<';
  const windowOrder = resumeFrom !== null ? 'ASC' : 'DESC';

  // $1 league, $2 the kind allowlist. The cursor (if any) and the page cap are
  // appended after, so their placeholder numbers follow.
  const params = [leagueId, PRESENTER_ACTIVITY_KINDS];
  let cursorClause = '';
  if (cursor !== null) {
    params.push(cursor);
    cursorClause = `AND "draft_activity"."feed_seq" ${cmp} $${params.length}`;
  }
  params.push(capped);
  const limitClause = `LIMIT $${params.length}`;

  // No `reason` column: the correction free-text never rides a presenter payload
  // (see the doc above). Aliases match activityEntryOf's frozen keys so the read
  // shapes identically to the member combined feed's Draft-activity arm.
  const result = await db.query(
    `SELECT * FROM (
       SELECT "draft_activity"."id" AS id,
              "draft_activity"."feed_seq" AS feed_seq,
              "draft_activity"."created_at" AS created_at,
              "draft_activity"."kind" AS kind,
              "draft_activity"."team_id" AS "teamId",
              "draft_activity"."team_name" AS "teamName",
              "draft_activity"."player_id" AS player_id,
              "draft_activity"."player_name" AS player_name,
              "draft_activity"."player_position" AS player_position,
              "draft_activity"."player_nfl_team" AS player_nfl_team,
              "draft_activity"."round" AS round,
              "draft_activity"."pick_number" AS pick_number,
              "draft_activity"."is_autopick" AS is_autopick,
              "draft_activity"."is_legacy" AS is_legacy
         FROM "draft_activity"
        WHERE "draft_activity"."league_id" = $1
          AND "draft_activity"."kind" = ANY($2)
          ${cursorClause}
        ORDER BY "draft_activity"."feed_seq" ${windowOrder}
        ${limitClause}
     ) page ORDER BY feed_seq ASC`,
    params
  );
  // activityEntryOf shapes a CORRECTION with a `reason` key (null here, since
  // the column is unselected). Drop it so the presenter payload carries no
  // correction free-text SURFACE at all - not even a null placeholder for a
  // member-moderation field an anonymous board has no business showing (#438).
  return result.rows.map(activityEntryOf).map(({ reason, ...entry }) => entry);
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
  combinedEntryOf,
  listCombinedDraftFeed,
  listPresenterDraftActivity,
  PRESENTER_ACTIVITY_KINDS,
};
