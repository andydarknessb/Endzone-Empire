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
} = require('../services/leagueFeed');

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
    'created_at', 'hidden', 'id', 'message', 'seq', 'teamId', 'teamName', 'type',
  ]);
  assert.equal(entry.type, LEAGUE_CHAT);
  assert.equal(entry.type, 'league_chat');
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
    'created_at', 'hidden', 'id', 'message', 'seq', 'teamId', 'teamName', 'type',
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
