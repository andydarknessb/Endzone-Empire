const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const {
  LEAGUE_CHAT,
  FEED_PAGE_SIZE,
  feedEntryOf,
  listLeagueChatFeed,
  listCombinedDraftFeed,
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
    'created_at', 'id', 'message', 'seq', 'teamId', 'teamName', 'type',
  ]);
  assert.equal(entry.type, LEAGUE_CHAT);
  assert.equal(entry.type, 'league_chat');
  assert.equal(entry.seq, 7);
  assert.equal(typeof entry.seq, 'number');
  assert.equal(entry.id, 5);
  assert.equal(entry.teamId, 12);
  assert.equal(entry.teamName, 'Sunday Scaries');
  assert.equal(entry.message, 'good luck everyone');
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

  // Both arms of the union advance past the cursor...
  assert.match(seenSql, /"chat_messages"\."feed_seq" > \$3/);
  assert.match(seenSql, /"draft_activity"\."feed_seq" > \$3/);
  // ...and the resume read is ascending, not the newest-first-then-flip window.
  assert.doesNotMatch(seenSql, /"feed_seq" < \$/);
  assert.deepEqual(seenParams, [12, 9, 7, 100]);
});
