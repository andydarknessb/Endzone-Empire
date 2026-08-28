const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const {
  LEAGUE_CHAT,
  FEED_PAGE_SIZE,
  BLOCKABLE_FEED_TYPES,
  MODERATABLE_FEED_TYPES,
  isModeratableFeedType,
  feedEntryOf,
  listLeagueChatFeed,
  combinedEntryOf,
  listCombinedDraftFeed,
  listPresenterDraftActivity,
} = require('../services/leagueFeed');
const { DRAFT_ACTIVITY, USER_VISIBLE_KINDS } = require('../services/draftActivity');

// A chat_messages row as the feed SELECT projects it: the Team identity join
// has already aliased owner -> teamId/teamName, and feed_seq is the row's
// authoritative per-league chronological position (#434).
const row = (over = {}) => ({
  id: 5,
  message: 'good luck everyone',
  created_at: '2026-09-01T00:00:00.000Z',
  feed_seq: 7,
  teamId: 12,
  teamName: 'Sunday Scaries',
  ...over,
});

test('feedEntryOf is a typed League-chat entry attributed by Team alone', () => {
  const entry = feedEntryOf(row());
  assert.deepEqual(Object.keys(entry).sort(), [
    'created_at', 'hidden', 'id', 'isLegacy', 'media', 'message', 'seq', 'teamId', 'teamName', 'type',
  ]);
  assert.equal(entry.type, LEAGUE_CHAT);
  assert.equal(entry.type, 'league_chat');
  // A plain text message carries no media (AC1: media is the GIF shape).
  assert.equal(entry.media, null);
  assert.equal(entry.seq, 7);
  assert.equal(typeof entry.seq, 'number');
  assert.equal(entry.id, 5);
  assert.equal(entry.teamId, 12);
  assert.equal(entry.teamName, 'Sunday Scaries');
  assert.equal(entry.message, 'good luck everyone');
  // A message nobody hid carries hidden:false and its real content.
  assert.equal(entry.hidden, false);
});

test('feedEntryOf tombstones a hidden message: neutral, no content, no moderator or reason', () => {
  // hidden_at set (the moderator, reason and instant live on the row too), as
  // the feed SELECT projects it.
  const entry = feedEntryOf(row({
    hidden_at: '2026-09-01T01:00:00.000Z',
    hidden_by: 99,
    hidden_reason: 'targeted harassment',
  }));
  // The content is gone from the member feed (AC3); the entry keeps its place
  // (seq) and its Team identity so ordering and "is this mine" still hold.
  assert.equal(entry.hidden, true);
  assert.equal(entry.message, null);
  assert.equal(entry.seq, 7);
  assert.equal(entry.teamId, 12);
  assert.equal(entry.type, LEAGUE_CHAT);
  // The reason and moderator NEVER reach a member: they are not even keys on
  // the entry, so no client can render them (AC4 keeps them to the reviewer
  // history alone).
  assert.equal('hidden_reason' in entry, false);
  assert.equal('hidden_by' in entry, false);
  assert.equal('hidden_at' in entry, false);
  assert.deepEqual(Object.keys(entry).sort(), [
    'created_at', 'hidden', 'id', 'isLegacy', 'media', 'message', 'seq', 'teamId', 'teamName', 'type',
  ]);
});

// A chat_messages row for a GIF message, as the feed SELECT projects it: the
// content_kind discriminator plus the three gif_* columns the migration added.
const gifRow = (over = {}) => ({
  id: 8,
  message: 'this is me at 3pm', // the OPTIONAL caption (AC1)
  created_at: '2026-09-01T02:00:00.000Z',
  feed_seq: 9,
  teamId: 12,
  teamName: 'Sunday Scaries',
  content_kind: 'gif',
  gif_provider: 'fake',
  gif_asset_id: 'abc123',
  gif_description: 'a cat knocking a cup off a table',
  ...over,
});

test('feedEntryOf shapes a GIF message with one provider asset, caption and description (AC1)', () => {
  const entry = feedEntryOf(gifRow());
  assert.equal(entry.type, LEAGUE_CHAT);
  assert.equal(entry.hidden, false);
  // The caption rides on `message`, the same key text uses, so one wire shape
  // carries both kinds.
  assert.equal(entry.message, 'this is me at 3pm');
  assert.deepEqual(entry.media, {
    provider: 'fake',
    assetId: 'abc123',
    description: 'a cat knocking a cup off a table',
  });
  assert.deepEqual(Object.keys(entry).sort(), [
    'created_at', 'hidden', 'id', 'isLegacy', 'media', 'message', 'seq', 'teamId', 'teamName', 'type',
  ]);
});

test('feedEntryOf: a GIF with no caption carries message:null and still carries its media (AC1)', () => {
  const entry = feedEntryOf(gifRow({ message: null }));
  assert.equal(entry.message, null);
  assert.equal(entry.media.description, 'a cat knocking a cup off a table');
});

test('feedEntryOf tombstones a hidden GIF: caption AND media both suppressed (AC3, moderation decision)', () => {
  // The commissioner-hidden GIF reads back as the SAME neutral tombstone as a
  // hidden text message: the asset, the caption and the description are all
  // author-authored content and are all suppressed on the member feed. The
  // authorized-reviewer history (safety.router) is the only place the original
  // content survives.
  const entry = feedEntryOf(gifRow({ hidden_at: '2026-09-01T03:00:00.000Z', hidden_reason: 'slur in alt text' }));
  assert.equal(entry.hidden, true);
  assert.equal(entry.message, null);
  assert.equal(entry.media, null);
  // Indistinguishable from a hidden text tombstone: same keys, same null content.
  assert.deepEqual(Object.keys(entry).sort(), [
    'created_at', 'hidden', 'id', 'isLegacy', 'media', 'message', 'seq', 'teamId', 'teamName', 'type',
  ]);
});

test('MODERATABLE_FEED_TYPES is human League chat only, never Draft activity (AC6)', () => {
  // Only human-authored League chat may be hidden. This mirrors the blockable
  // set exactly for the same reason (#440): a Draft event is a shared fact, not
  // a manager talking, so it can be neither blocked nor moderated.
  assert.deepEqual([...MODERATABLE_FEED_TYPES], [LEAGUE_CHAT]);
  assert.deepEqual([...MODERATABLE_FEED_TYPES], [...BLOCKABLE_FEED_TYPES]);
  assert.equal(isModeratableFeedType(LEAGUE_CHAT), true);
  assert.equal(isModeratableFeedType('draft_activity'), false);
  assert.equal(isModeratableFeedType('draft_pick'), false);
});

test('feedEntryOf coerces a bigint feed_seq string to a number cursor', () => {
  // pg returns int8 as a string; the seq travels on the wire as a JSON number
  // so the client can hand it straight back as ?before=<seq>.
  const entry = feedEntryOf(row({ feed_seq: '42' }));
  assert.equal(entry.seq, 42);
  assert.equal(typeof entry.seq, 'number');
});

test('feedEntryOf reads a departed author back as null Team identity', () => {
  const entry = feedEntryOf(row({ teamId: null, teamName: null }));
  assert.equal(entry.teamId, null);
  assert.equal(entry.teamName, null);
  // The entry is still present (a gap only ever comes from a deleted row).
  assert.equal(entry.type, LEAGUE_CHAT);
});

test('listLeagueChatFeed reads the latest page ordered by feed_seq, no cursor', async () => {
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => {
      seenSql = text;
      seenParams = params;
      return { rows: [row({ id: 5, feed_seq: 7 }), row({ id: 6, feed_seq: 8, message: 'gl' })] };
    }],
  ]);

  const entries = await listLeagueChatFeed(fake, { leagueId: 12, viewerId: 9 });

  // Newest-first window, flipped to ascending display order.
  assert.match(seenSql, /ORDER BY "chat_messages"\."feed_seq" DESC/);
  assert.match(seenSql, /ORDER BY "feed_seq" ASC/);
  // The default page is the latest 100 (AC: initial read returns latest 100).
  assert.equal(FEED_PAGE_SIZE, 100);
  assert.deepEqual(seenParams, [12, 9, 100]);
  // No cursor predicate when reading the latest page.
  assert.doesNotMatch(seenSql, /"feed_seq" < \$/);
  // Block filter is preserved from the original history endpoint.
  assert.match(seenSql, /NOT EXISTS \(\s*SELECT 1 FROM "user_blocks"/);
  // Typed entries out.
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, LEAGUE_CHAT);
  assert.equal(entries[0].seq, 7);
});

test('listLeagueChatFeed projects hidden_at and keeps hidden rows in place as tombstones', async () => {
  let seenSql = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text) => {
      seenSql = text;
      return {
        rows: [
          row({ id: 5, feed_seq: 7 }),
          row({ id: 6, feed_seq: 8, message: 'abuse', hidden_at: '2026-09-01T01:00:00.000Z', hidden_reason: 'r' }),
        ],
      };
    }],
  ]);

  const entries = await listLeagueChatFeed(fake, { leagueId: 12, viewerId: 9 });

  // The read must SELECT hidden_at so feedEntryOf can tombstone.
  assert.match(seenSql, /"chat_messages"\."hidden_at"/);
  // Hidden rows are NOT filtered out - the tombstone stays so ordering and
  // pagination are coherent (unlike a deleted row, which is a gap).
  assert.doesNotMatch(seenSql, /hidden_at" IS NULL/);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].hidden, false);
  assert.equal(entries[1].hidden, true);
  assert.equal(entries[1].message, null);
});

// The combined Draft-room feed (#435) meets moderation (#441) in one union.
// combinedEntryOf must tombstone a hidden CHAT row the same way the chat-only
// feed does, and must never turn Draft activity into a tombstone (AC6).
test('combinedEntryOf tombstones a hidden chat row and never a Draft-activity row', () => {
  const chat = combinedEntryOf({
    source: LEAGUE_CHAT,
    id: 5, feed_seq: 7, message: 'abuse', created_at: 'x',
    teamId: 12, teamName: 'Scaries', hidden_at: '2026-09-01T01:00:00.000Z',
  });
  assert.equal(chat.type, LEAGUE_CHAT);
  assert.equal(chat.hidden, true);
  assert.equal(chat.message, null);

  // A Pick reaches activityEntryOf, which has no `hidden` concept at all: a
  // Draft event is not moderatable and can never read back as a tombstone.
  const activity = combinedEntryOf({
    source: DRAFT_ACTIVITY,
    id: 9, feed_seq: 8, kind: 'pick', created_at: 'x',
    teamId: 12, teamName: 'Scaries', player_id: 1, player_name: 'QB1',
    round: 1, pick_number: 1, is_autopick: false, hidden_at: null,
  });
  assert.equal(activity.type, DRAFT_ACTIVITY);
  assert.equal('hidden' in activity, false, 'Draft activity is never a tombstone');
});

test('listCombinedDraftFeed projects hidden_at in the CHAT arm only, and blocks chat only', async () => {
  let seenSql = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text) => { seenSql = text; return { rows: [] }; }],
  ]);
  await listCombinedDraftFeed(fake, { leagueId: 12, viewerId: 9 });

  // The chat arm carries the real hidden_at so a hidden message tombstones here
  // too; the activity arm carries a NULL placeholder for column alignment.
  assert.match(seenSql, /"chat_messages"\."hidden_at" AS hidden_at/);
  assert.match(seenSql, /NULL::timestamptz AS hidden_at/);
  // The block filter is on the CHAT arm and NOT on the draft_activity arm - a
  // Pick by a blocked Team stays visible (AC7 / ADR 0012).
  // Everything from UNION ALL onward is the activity arm (its SELECT list, FROM
  // and WHERE) - the chat arm and its block filter sit before it.
  const activityArm = seenSql.slice(seenSql.indexOf('UNION ALL'));
  assert.doesNotMatch(activityArm, /"user_blocks"/, 'the activity arm never filters on blocks');
  assert.match(seenSql, /NOT EXISTS \(\s*SELECT 1 FROM "user_blocks"/);
  // By CONSTRUCTION the tombstone path cannot reach a Pick: the activity arm
  // never projects a hidden_at FROM chat_messages, only the aligned NULL
  // placeholder. So moderation is unreachable for Draft activity in the SQL
  // itself, not merely because activityEntryOf chooses to ignore the column.
  assert.doesNotMatch(activityArm, /"chat_messages"\."hidden_at"/, 'the activity arm carries no chat hidden_at');
  assert.match(activityArm, /NULL::timestamptz AS hidden_at/, 'the activity arm hidden_at is the aligned NULL');
});

// #447 AC5, the combined-feed half of an old client's cursorless read. The Draft
// room reads the COMBINED feed (useDraftRoomFeed.fetchHistory -> GET /draft-feed
// -> listCombinedDraftFeed), so a pre-cursor client that pages without a cursor
// must get the latest page with NO cursor predicate on either arm. This mirrors
// the chat-feed proof above (listLeagueChatFeed ... no cursor) for the combined
// feed, and it is falsifiable: the same function DOES emit `"..."."feed_seq" > $`
// when given an `after` cursor (the resume test below), so a cursorless read that
// wrongly added a predicate would turn this red.
test('listCombinedDraftFeed reads the latest page with no cursor predicate on either arm (#447 AC5)', async () => {
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => { seenSql = text; seenParams = params; return { rows: [] }; }],
  ]);

  await listCombinedDraftFeed(fake, { leagueId: 12, viewerId: 9 });

  // No older-page predicate and no resume predicate: this is the latest window.
  assert.doesNotMatch(seenSql, /"feed_seq" < \$/, 'no older-page cursor predicate on a cursorless read');
  assert.doesNotMatch(seenSql, /"feed_seq" > \$/, 'no resume cursor predicate on a cursorless read');
  // Exactly the no-cursor params. #540 adds the user-visible kind allowlist as a
  // stable $3 bound param (the activity arm filters the internal CUTOVER boundary
  // out before pagination); the shape is now league, viewer, allowlist, page size
  // - still NO cursor value. This is the DELIBERATE update to the #447 pin: the
  // only change is the inserted $3 allowlist, and the "no cursor predicate on a
  // cursorless read" invariant it guards is unchanged.
  assert.deepEqual(seenParams, [12, 9, USER_VISIBLE_KINDS, FEED_PAGE_SIZE]);
});

// #540 AC4. The internal CUTOVER boundary must be excluded from the member feed
// BEFORE pagination, so an internal row can never consume a visible page slot.
// Proven here at the SQL level: the activity arm restricts kind to the positive
// USER_VISIBLE_KINDS allowlist INSIDE its own WHERE, ahead of its ORDER BY and
// LIMIT. Falsifiable by construction - move the filter to the outer merge (after
// the per-arm LIMIT) or drop it and these ordering assertions go red. The
// behavioral proof that a full visible page still returns with a cutover row
// seeded inside the first-page window lives in draftActivity.pg.test.js, where a
// real Postgres actually executes the WHERE and LIMIT.
test('listCombinedDraftFeed filters the activity arm to visible kinds BEFORE pagination (#540 AC4)', async () => {
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => { seenSql = text; seenParams = params; return { rows: [] }; }],
  ]);

  await listCombinedDraftFeed(fake, { leagueId: 12, viewerId: 9 });

  // The allowlist is the positive user-visible set, bound as $3, and it EXCLUDES
  // the internal cutover boundary.
  assert.deepEqual(seenParams[2], USER_VISIBLE_KINDS, 'the visible-kind allowlist rides as $3');
  assert.ok(!USER_VISIBLE_KINDS.includes('cutover'), 'the cutover boundary is not a visible kind');

  // Everything from UNION ALL onward is the activity arm.
  const activityArm = seenSql.slice(seenSql.indexOf('UNION ALL'));
  const kindIdx = activityArm.search(/"draft_activity"\."kind" = ANY\(\$3\)/);
  const orderIdx = activityArm.search(/ORDER BY "draft_activity"\."feed_seq"/);
  const limitIdx = activityArm.search(/LIMIT \$/);
  assert.ok(kindIdx > -1, 'the activity arm restricts kind to the visible allowlist');
  assert.ok(orderIdx > kindIdx, 'the kind filter precedes the arm ORDER BY');
  assert.ok(limitIdx > kindIdx, 'the kind filter precedes the arm LIMIT - filtered before pagination');
});

// #540 AC1 / AC3, the privacy asymmetry proven as a PAIR in one run. The member
// combined feed MUST carry a correction's recorded reason; the anonymous
// presenter feed MUST NOT, and the presenter negative is proven AT THE SOURCE
// (the SQL omits the column, the entry has no reason key), not merely in a DOM.
// The member positive control is what gives the presenter negative meaning: it
// rules out "no reason in the presenter payload" being an artifact of a fixture
// that never had a reason, or of the correction being absent entirely.
test('a member sees the correction reason; a presenter payload carries none (#540 AC1/AC3)', async () => {
  const REASON = 'entered against the wrong team; correcting before we resume';
  const correctionRow = (over = {}) => ({
    source: DRAFT_ACTIVITY,
    kind: 'correction',
    id: 30,
    feed_seq: '18',
    teamId: 11,
    teamName: 'Gridiron Ghosts',
    player_id: 500,
    player_name: 'Wrong Guy',
    player_position: 'RB',
    player_nfl_team: 'KC',
    round: 2,
    pick_number: 13,
    is_autopick: null,
    reason: REASON,
    is_legacy: false,
    created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  });

  // MEMBER (positive control): the reason reaches the member payload, and the
  // member SQL actually projects the reason column.
  let memberSql = null;
  const memberPool = createFakePool([
    [/FROM "chat_messages"/, (text) => { memberSql = text; return { rows: [correctionRow()] }; }],
  ]);
  const [memberEntry] = await listCombinedDraftFeed(memberPool, { leagueId: 12, viewerId: 9 });
  assert.equal(memberEntry.kind, 'correction');
  assert.equal(memberEntry.reason, REASON, 'the member correction carries the recorded reason');
  assert.match(memberSql, /"draft_activity"\."reason" AS reason/, 'the member activity arm projects reason');

  // PRESENTER (the negative, at the source): the reader queries draft_activity
  // WITHOUT the reason column, so no free-text can ride the payload, and the
  // shaped entry has no reason key at all - not even a null placeholder.
  let presenterSql = null;
  const presenterPool = createFakePool([
    [/FROM "draft_activity"/, (text) => { presenterSql = text; return { rows: [correctionRow()] }; }],
  ]);
  const [presenterEntry] = await listPresenterDraftActivity(presenterPool, { leagueId: 12 });
  assert.equal(presenterEntry.kind, 'correction', 'the correction IS present on the presenter payload');
  assert.ok(!/reason/i.test(presenterSql), 'the presenter SELECT omits the reason column entirely');
  assert.ok(!('reason' in presenterEntry), 'the presenter payload carries no reason field');
  // The corrected Pick facts a presenter MAY see are still there (#540 AC3).
  assert.deepEqual(presenterEntry.player, { id: 500, name: 'Wrong Guy', position: 'RB', nflTeam: 'KC' });
  assert.equal(presenterEntry.pickNumber, 13);
});

test('listLeagueChatFeed pages older than a cursor with feed_seq < before', async () => {
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => {
      seenSql = text;
      seenParams = params;
      return { rows: [] };
    }],
  ]);

  await listLeagueChatFeed(fake, { leagueId: 12, viewerId: 9, before: 7 });

  assert.match(seenSql, /AND "chat_messages"\."feed_seq" < \$3/);
  assert.deepEqual(seenParams, [12, 9, 7, 100]);
});

test('listLeagueChatFeed clamps limit to the page maximum', async () => {
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => {
      seenParams = params;
      return { rows: [] };
    }],
  ]);

  await listLeagueChatFeed(fake, { leagueId: 12, viewerId: 9, limit: 5000 });
  assert.equal(seenParams[seenParams.length - 1], FEED_PAGE_SIZE);
});

test('listLeagueChatFeed ignores a non-integer before cursor', async () => {
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => {
      seenSql = text;
      seenParams = params;
      return { rows: [] };
    }],
  ]);

  await listLeagueChatFeed(fake, { leagueId: 12, viewerId: 9, before: 'not-a-number' });
  assert.doesNotMatch(seenSql, /"feed_seq" < \$/);
  assert.deepEqual(seenParams, [12, 9, 100]);
});

test('listLeagueChatFeed resumes AFTER a cursor with feed_seq > after, ascending (#442)', async () => {
  // Reconnect recovery: the client hands back the last seq it acknowledged, and
  // the read returns the entries just NEWER than it, in ascending order, so the
  // same chronology is reproduced without refetching the whole conversation.
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => {
      seenSql = text;
      seenParams = params;
      return { rows: [row({ id: 8, feed_seq: 9 }), row({ id: 9, feed_seq: 10 })] };
    }],
  ]);

  const entries = await listLeagueChatFeed(fake, { leagueId: 12, viewerId: 9, after: 7 });

  assert.match(seenSql, /AND "chat_messages"\."feed_seq" > \$3/);
  // Ascending straight out - no newest-first window to flip for a resume read.
  assert.match(seenSql, /ORDER BY "chat_messages"\."feed_seq" ASC/);
  assert.doesNotMatch(seenSql, /"feed_seq" < \$/);
  assert.deepEqual(seenParams, [12, 9, 7, 100]);
  assert.deepEqual(entries.map((e) => e.seq), [9, 10]);
});

test('listLeagueChatFeed ignores a non-integer after cursor', async () => {
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => {
      seenSql = text;
      seenParams = params;
      return { rows: [] };
    }],
  ]);

  await listLeagueChatFeed(fake, { leagueId: 12, viewerId: 9, after: 'not-a-number' });
  assert.doesNotMatch(seenSql, /"feed_seq" > \$/);
  assert.deepEqual(seenParams, [12, 9, 100]);
});

test('listCombinedDraftFeed resumes AFTER a cursor on both kinds with feed_seq > after (#442)', async () => {
  let seenSql = null;
  let seenParams = null;
  const fake = createFakePool([
    [/FROM "chat_messages"/, (text, params) => {
      seenSql = text;
      seenParams = params;
      return { rows: [] };
    }],
  ]);

  await listCombinedDraftFeed(fake, { leagueId: 12, viewerId: 9, after: 7 });

  // Both arms of the union advance past the cursor. #540 inserts the visible-kind
  // allowlist as the stable $3 param, so the cursor is now $4 (was $3) - a
  // DELIBERATE param-number shift, not a change to the resume predicate itself.
  assert.match(seenSql, /"chat_messages"\."feed_seq" > \$4/);
  assert.match(seenSql, /"draft_activity"\."feed_seq" > \$4/);
  // ...and the resume read is ascending, not the newest-first-then-flip window.
  assert.doesNotMatch(seenSql, /"feed_seq" < \$/);
  assert.deepEqual(seenParams, [12, 9, USER_VISIBLE_KINDS, 7, 100]);
});
