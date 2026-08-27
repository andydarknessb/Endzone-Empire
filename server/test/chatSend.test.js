const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');
const { createFakePool } = require('./helpers/fakePool');
const { deliverFeedEntry, normalizeClientMsgId, MAX_CHAT_CHARS } = require('../modules/draftSocket');
const { LEAGUE_CHAT } = require('../services/leagueFeed');
const { setGifMessagesEnabledForTests } = require('../modules/gifCapability');

// A well-formed GIF payload the client would send: one provider asset named by
// (provider, assetId), a required accessible description and an optional caption
// (#446 AC1). Never a URL and never an upload (AC2).
const GIF_OK = {
  provider: 'fake',
  assetId: 'abc123',
  description: 'a cat knocking a cup off a table',
  caption: 'this is me at 3pm',
};

/**
 * #440: League chat send, hardened, proven through a real socket.io server and
 * real clients (the socketHarness), plus a focused unit for the AC7 delivery
 * discrimination that a live test cannot make visible on its own.
 *
 * FLOOD ISOLATION. The chat flood store lives on the one io instance the
 * harness reuses across this file, so every test takes its OWN leagueId (and,
 * where it matters, its own user ids): a bucket is keyed by (league, user), so
 * distinct leagues never share flood capacity and the tests do not interfere.
 */

const harness = createSocketHarness({ secret: 'chat-send-hardening-secret' });

const A = { userId: 7, username: 'author' };
const B = { userId: 8, username: 'blocker' };
const C = { userId: 9, username: 'neutral' };

/**
 * A small chat world: who holds a Team (membership, mutable so a member can be
 * removed mid-test), who has blocked whom, and a stored-message map that makes
 * the idempotency index behave like Postgres (a second insert of a key already
 * stored returns no row, the way ON CONFLICT DO NOTHING does).
 */
function chatWorld({ leagueId, teams, commissioners = [], blocks = [] }) {
  const state = {
    teams: new Map(Object.entries(teams).map(([uid, t]) => [Number(uid), t])),
    blocks: [...blocks],
    stored: new Map(),
    seq: 0,
    nextId: 1000,
  };
  const commish = new Set(commissioners);
  const fake = createFakePool([
    // lookupTeam — the join membership read AND the per-send revalidation.
    [/^SELECT "id", "name" FROM "teams"/, (t, [lg, uid]) => {
      const team = lg === leagueId ? state.teams.get(uid) : undefined;
      return { rows: team ? [{ id: team.teamId, name: team.teamName }] : [] };
    }],
    // isLeagueCommissioner (join only).
    [/^SELECT 1 FROM "leagues"/, (t, [lg, uid]) => ({
      rows: lg === leagueId && commish.has(uid) ? [{ '?column?': 1 }] : [],
    })],
    // selectChatByKey — the idempotency lookup (now also projects the gif
    // columns, #446, so a keyed retry of a GIF send re-reads its media).
    [/^SELECT "id", "message", "created_at", "feed_seq"/, (t, [uid, key]) => {
      const row = state.stored.get(`${uid}:${key}`);
      return { rows: row ? [row] : [] };
    }],
    // INSERT ... ON CONFLICT DO NOTHING RETURNING. Params, #446:
    // [league, user, caption, key, content_kind, gif_provider, gif_asset_id, gif_description].
    [/^INSERT INTO "chat_messages"/, (t, [lg, uid, caption, key, contentKind, gifProvider, gifAssetId, gifDescription]) => {
      if (key != null && state.stored.has(`${uid}:${key}`)) return { rows: [] };
      const row = {
        id: state.nextId++,
        message: caption,
        created_at: '2026-08-26T00:00:00.000Z',
        feed_seq: ++state.seq,
        content_kind: contentKind,
        gif_provider: gifProvider,
        gif_asset_id: gifAssetId,
        gif_description: gifDescription,
      };
      if (key != null) state.stored.set(`${uid}:${key}`, row);
      return {
        rows: [{
          id: row.id,
          created_at: row.created_at,
          feed_seq: row.feed_seq,
          content_kind: row.content_kind,
          gif_provider: row.gif_provider,
          gif_asset_id: row.gif_asset_id,
          gif_description: row.gif_description,
        }],
      };
    }],
    // listBlockersOf — who has blocked this author.
    [/^SELECT "blocker_id" FROM "user_blocks"/, (t, [blockedId]) => ({
      rows: state.blocks.filter((b) => b.blocked === blockedId).map((b) => ({ blocker_id: b.blocker })),
    })],
  ]);
  return { fake, state };
}

/** Resolve once `event` arrives on `client`, or after `ms` with `null`. Lets a
 *  test assert an event did NOT arrive without waiting out a long deadline. */
function eventOrSilence(client, event, ms = 150) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// ---------------------------------------------------------------------------
// AC1: membership is revalidated per send, not trusted from the room.
// ---------------------------------------------------------------------------

test('a member removed after joining is refused NOT_A_MEMBER and nothing is stored', async (t) => {
  const leagueId = 4401;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const client = await harness.connectAs(A, t);
  await harness.emit(client, 'league:join', { leagueId });

  // The commissioner removes their Team AFTER they joined the room.
  world.state.teams.delete(A.userId);

  const ack = await harness.emit(client, 'chat:send', { leagueId, message: 'still here?' });

  assert.deepEqual(ack, { error: 'you are not in this league', code: 'NOT_A_MEMBER' });
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 0, 'a non-member never inserts');
});

// ---------------------------------------------------------------------------
// AC2: idempotency keys collapse a retry onto the first row, no duplicate.
// ---------------------------------------------------------------------------

test('a retry with the same clientMsgId stores one row and broadcasts once', async (t) => {
  const leagueId = 4402;
  const world = chatWorld({
    leagueId,
    teams: { [A.userId]: { teamId: 71, teamName: 'Founders' }, [C.userId]: { teamId: 91, teamName: 'Neutral' } },
  });
  world.fake.install(t);
  const sender = await harness.connectAs(A, t);
  const watcher = await harness.connectAs(C, t);
  await harness.emit(sender, 'league:join', { leagueId });
  await harness.emit(watcher, 'league:join', { leagueId });

  let watcherMessages = 0;
  watcher.on('chat:message', () => { watcherMessages++; });

  const first = await harness.emit(sender, 'chat:send', { leagueId, message: 'gg', clientMsgId: 'key-abc' });
  assert.deepEqual(first, { ok: true });

  const retry = await harness.emit(sender, 'chat:send', { leagueId, message: 'gg', clientMsgId: 'key-abc' });
  assert.equal(retry.ok, true, 'a retry is a success, never a silent drop (AC5)');
  assert.equal(retry.duplicate, true);
  assert.ok(retry.entry && retry.entry.type === LEAGUE_CHAT, 'the retry carries the original entry');

  // Give any stray second broadcast time to arrive before asserting it did not.
  await eventOrSilence(watcher, 'chat:message');
  assert.equal(watcherMessages, 1, 'the room saw the message exactly once');
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 1, 'one stored row');
});

// ---------------------------------------------------------------------------
// AC3/AC5: per-member rate limit, explicit retry, nothing dropped.
// ---------------------------------------------------------------------------

test('a burst past five in ten seconds is refused with a retry time and stores nothing extra', async (t) => {
  const leagueId = 4403;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const client = await harness.connectAs(A, t);
  await harness.emit(client, 'league:join', { leagueId });

  const acks = [];
  for (let i = 0; i < 6; i++) {
    acks.push(await harness.emit(client, 'chat:send', { leagueId, message: `m${i}` }));
  }

  for (let i = 0; i < 5; i++) assert.deepEqual(acks[i], { ok: true }, `send ${i} under the limit`);
  const blocked = acks[5];
  assert.equal(blocked.code, 'RATE_LIMITED');
  assert.ok(blocked.retryAfterMs > 0, 'the refusal names when to retry');
  assert.equal(blocked.retryAfterSeconds, Math.ceil(blocked.retryAfterMs / 1000));
  assert.ok(!('ok' in blocked), 'a blocked send is not acked ok');
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 5, 'the blocked send persisted nothing');
});

// ---------------------------------------------------------------------------
// AC6: blocking filters human messages in LIVE delivery, consistently with
// history (which already filters).
// ---------------------------------------------------------------------------

test('a blocker does not receive the blocked author live, while others do', async (t) => {
  const leagueId = 4404;
  const world = chatWorld({
    leagueId,
    teams: {
      [A.userId]: { teamId: 71, teamName: 'Founders' },
      [B.userId]: { teamId: 81, teamName: 'Blocker' },
      [C.userId]: { teamId: 91, teamName: 'Neutral' },
    },
    blocks: [{ blocker: B.userId, blocked: A.userId }],
  });
  world.fake.install(t);
  const author = await harness.connectAs(A, t);
  const blocker = await harness.connectAs(B, t);
  const neutral = await harness.connectAs(C, t);
  await harness.emit(author, 'league:join', { leagueId });
  await harness.emit(blocker, 'league:join', { leagueId });
  await harness.emit(neutral, 'league:join', { leagueId });

  let blockerGot = false;
  blocker.on('chat:message', () => { blockerGot = true; });
  const authorEcho = eventOrSilence(author, 'chat:message', 300);
  const neutralGot = eventOrSilence(neutral, 'chat:message', 300);

  await harness.emit(author, 'chat:send', { leagueId, message: 'hello all' });

  const neutralPayload = await neutralGot;
  assert.ok(neutralPayload, 'a non-blocker receives the live message');
  const echo = await authorEcho;
  assert.ok(echo, 'the author receives their own echo (nobody blocks themselves)');
  assert.equal(blockerGot, false, 'the blocker never receives the blocked author live');
});

// ---------------------------------------------------------------------------
// AC7: the block filter keys on the entry KIND, so Draft activity involving a
// blocked Team is never hidden. Proven at the delivery seam directly, because a
// live event-based test would pass whether or not the negative case is guarded
// (pl-endzone's concern re: #435 landing Draft activity beside this).
// ---------------------------------------------------------------------------

test('deliverFeedEntry hides a blocked author\'s chat but never a non-blockable kind', async (t) => {
  const world = chatWorld({ leagueId: 4405, teams: {}, blocks: [{ blocker: B.userId, blocked: A.userId }] });
  world.fake.install(t);

  // A fake io that records what each recipient received, whether by room
  // broadcast (io.to(room).emit) or per-socket (member.emit).
  const roomEmits = [];
  const socketEmits = [];
  const members = [
    { data: { userId: A.userId }, emit: (e, p) => socketEmits.push([A.userId, e, p]) },
    { data: { userId: B.userId }, emit: (e, p) => socketEmits.push([B.userId, e, p]) },
    { data: { userId: C.userId }, emit: (e, p) => socketEmits.push([C.userId, e, p]) },
  ];
  const io = {
    to: () => ({ emit: (e, p) => roomEmits.push([e, p]) }),
    in: () => ({ fetchSockets: async () => members }),
  };

  // A League-chat entry authored by A: blockable, so B is skipped.
  await deliverFeedEntry(io, world.fake, {
    leagueId: 4405,
    event: 'chat:message',
    entry: { type: LEAGUE_CHAT, id: 1, teamId: 71 },
    authorUserId: A.userId,
  });
  const chatRecipients = socketEmits.filter(([, e]) => e === 'chat:message').map(([uid]) => uid);
  assert.deepEqual(chatRecipients.sort(), [A.userId, C.userId], 'chat reaches all but the blocker');
  assert.equal(roomEmits.length, 0, 'a blocked-author chat is delivered per socket, not room-wide');

  // A Draft-activity-shaped entry (a kind NOT in BLOCKABLE_FEED_TYPES) authored
  // by the SAME blocked Team: it must reach the whole room, blocker included.
  await deliverFeedEntry(io, world.fake, {
    leagueId: 4405,
    event: 'draft:activity',
    entry: { type: 'draft_activity', id: 2, teamId: 71 },
    authorUserId: A.userId,
  });
  assert.deepEqual(
    roomEmits,
    [['draft:activity', { type: 'draft_activity', id: 2, teamId: 71 }]],
    'a non-blockable kind is broadcast to the whole room, hiding nothing from the blocker'
  );
});

// ---------------------------------------------------------------------------
// Input validation for the idempotency key.
// ---------------------------------------------------------------------------

test('normalizeClientMsgId: absent is null, a bounded string passes, anything else is rejected', () => {
  const { deepEqual, equal } = assert;
  equal(normalizeClientMsgId(undefined), null);
  equal(normalizeClientMsgId(null), null);
  equal(normalizeClientMsgId('abc-123'), 'abc-123');
  // Rejected shapes come back as a sentinel (not null, not the value), so the
  // handler can tell "no key" from "bad key".
  const rejected = normalizeClientMsgId('x'.repeat(65));
  assert.notEqual(rejected, null);
  assert.notEqual(rejected, 'x'.repeat(65));
  assert.notEqual(normalizeClientMsgId(42), null);
  assert.notEqual(normalizeClientMsgId(''), null);
  void deepEqual;
});

test('a malformed clientMsgId is refused before any database work', async (t) => {
  const leagueId = 4406;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const client = await harness.connectAs(A, t);
  await harness.emit(client, 'league:join', { leagueId });
  const callsBefore = world.fake.calls.length;

  const ack = await harness.emit(client, 'chat:send', { leagueId, message: 'hi', clientMsgId: 42 });

  assert.deepEqual(ack, { error: 'clientMsgId must be a string of at most 64 characters', code: 'INVALID_REQUEST' });
  assert.equal(world.fake.calls.length, callsBefore, 'a malformed key reaches no query');
});

// ---------------------------------------------------------------------------
// #443/#502: the 500 limit is counted in CHARACTERS (code points, via the
// string iterator), so an astral emoji - two UTF-16 code units but one
// character - is never mis-measured against the limit either way: exactly at
// it, it is accepted whole; one character past it, the whole send is refused.
// ---------------------------------------------------------------------------

const THUMBS = '\u{1F44D}'; // one character, two UTF-16 code units

// A lone (unpaired) surrogate is not representable in UTF-8; encoding one to
// UTF-8 and back replaces it, so a stable round-trip proves the string holds
// only whole characters - exactly what Postgres would need to store it.
const isValidUtf8 = (s) => Buffer.from(s, 'utf8').toString('utf8') === s;

test('a message at exactly the limit, straddling a UTF-16 boundary, is stored and broadcast whole (#443)', async (t) => {
  const leagueId = 4407;
  const world = chatWorld({
    leagueId,
    teams: { [A.userId]: { teamId: 71, teamName: 'Founders' }, [C.userId]: { teamId: 91, teamName: 'Neutral' } },
  });
  world.fake.install(t);
  const sender = await harness.connectAs(A, t);
  const watcher = await harness.connectAs(C, t);
  await harness.emit(sender, 'league:join', { leagueId });
  await harness.emit(watcher, 'league:join', { leagueId });

  const received = eventOrSilence(watcher, 'chat:message', 300);
  // 499 filler + one emoji = 500 characters, 501 UTF-16 code units: the emoji
  // itself straddles the 500-code-unit mark, which is exactly the case a
  // `.length` count would over-count and wrongly refuse.
  const message = 'a'.repeat(499) + THUMBS;
  assert.equal(Array.from(message).length, 500, 'exactly at the character limit');
  const ack = await harness.emit(sender, 'chat:send', { leagueId, message });
  assert.deepEqual(ack, { ok: true }, 'exactly MAX_CHAT_CHARS characters is accepted');
  const entry = await received;

  assert.ok(entry, 'the room saw the message');
  assert.equal(Array.from(entry.message).length, 500, 'delivered at the character limit');
  assert.ok(entry.message.endsWith(THUMBS), 'the boundary emoji arrives whole, never truncated');
  assert.ok(isValidUtf8(entry.message), 'no lone surrogate reached the room');
});

test('500 astral emoji (1000 UTF-16 code units, 500 code points) is accepted and delivered whole (#502)', async (t) => {
  const leagueId = 4408;
  const world = chatWorld({
    leagueId,
    teams: { [A.userId]: { teamId: 71, teamName: 'Founders' }, [C.userId]: { teamId: 91, teamName: 'Neutral' } },
  });
  world.fake.install(t);
  const sender = await harness.connectAs(A, t);
  const watcher = await harness.connectAs(C, t);
  await harness.emit(sender, 'league:join', { leagueId });
  await harness.emit(watcher, 'league:join', { leagueId });

  // 500 code points, but 1000 UTF-16 code units: `message.length` would read
  // 1000 and wrongly refuse this as over the limit. Counting with the string
  // iterator (Array.from) reads the true 500 and accepts it.
  const message = THUMBS.repeat(500);
  assert.equal(message.length, 1000, 'UTF-16 code units: double the character count');
  assert.equal(Array.from(message).length, 500, 'code points: exactly at the limit');

  const received = eventOrSilence(watcher, 'chat:message', 300);
  const ack = await harness.emit(sender, 'chat:send', { leagueId, message });
  assert.deepEqual(ack, { ok: true });
  const entry = await received;

  assert.ok(entry, 'the room saw the message');
  assert.equal(entry.message, message, 'delivered whole, not truncated');
});

// ---------------------------------------------------------------------------
// #502: an over-length send is refused with MESSAGE_TOO_LONG before any
// database work, and never shortened - the same footing as INVALID_REQUEST.
// ---------------------------------------------------------------------------

test('a 501-code-point message is refused MESSAGE_TOO_LONG, persists nothing, and is never broadcast', async (t) => {
  const leagueId = 4409;
  const world = chatWorld({
    leagueId,
    teams: { [A.userId]: { teamId: 71, teamName: 'Founders' }, [C.userId]: { teamId: 91, teamName: 'Neutral' } },
  });
  world.fake.install(t);
  const sender = await harness.connectAs(A, t);
  const watcher = await harness.connectAs(C, t);
  await harness.emit(sender, 'league:join', { leagueId });
  await harness.emit(watcher, 'league:join', { leagueId });
  const callsBefore = world.fake.calls.length;

  const overLong = 'a'.repeat(MAX_CHAT_CHARS + 1);
  assert.equal(Array.from(overLong).length, 501);

  const watcherHeard = eventOrSilence(watcher, 'chat:message');
  const ack = await harness.emit(sender, 'chat:send', { leagueId, message: overLong });

  assert.deepEqual(ack, {
    error: 'message must be at most 500 characters',
    code: 'MESSAGE_TOO_LONG',
    limit: MAX_CHAT_CHARS,
    length: 501,
  });
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 0, 'nothing was stored');
  assert.equal(world.fake.calls.length, callsBefore, 'the refusal reaches no query at all');
  assert.equal(await watcherHeard, null, 'no chat:message was broadcast');
});

// ---------------------------------------------------------------------------
// #446: GIF messages. A GIF message is a chat_messages row like any other, so
// it reuses the whole hardened send path (membership, idempotency, flood, the
// #502 length check) and adds only the provider-asset contract on top.
// ---------------------------------------------------------------------------

test('a GIF send is refused GIF_PROVIDER_DISABLED while the capability is off, and stores nothing (AC7/AC9)', async (t) => {
  const leagueId = 4460;
  // The capability is off by default; assert that default rather than setting it.
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const client = await harness.connectAs(A, t);
  await harness.emit(client, 'league:join', { leagueId });

  const ack = await harness.emit(client, 'chat:send', { leagueId, gif: GIF_OK });
  assert.equal(ack.code, 'GIF_PROVIDER_DISABLED');
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 0, 'a disabled GIF send stores nothing');
});

test('an enabled well-formed GIF send stores a gif row and broadcasts media + caption (AC1)', async (t) => {
  setGifMessagesEnabledForTests(true);
  t.after(() => setGifMessagesEnabledForTests(null));
  const leagueId = 4461;
  const world = chatWorld({
    leagueId,
    teams: { [A.userId]: { teamId: 71, teamName: 'Founders' }, [C.userId]: { teamId: 91, teamName: 'Neutral' } },
  });
  world.fake.install(t);
  const sender = await harness.connectAs(A, t);
  const watcher = await harness.connectAs(C, t);
  await harness.emit(sender, 'league:join', { leagueId });
  await harness.emit(watcher, 'league:join', { leagueId });

  const heard = eventOrSilence(watcher, 'chat:message');
  const ack = await harness.emit(sender, 'chat:send', { leagueId, gif: GIF_OK, clientMsgId: 'gif-key-1' });
  assert.deepEqual(ack, { ok: true });

  const entry = await heard;
  assert.equal(entry.type, LEAGUE_CHAT);
  assert.equal(entry.message, 'this is me at 3pm', 'the optional caption rides on message');
  assert.deepEqual(entry.media, {
    provider: 'fake',
    assetId: 'abc123',
    description: 'a cat knocking a cup off a table',
  });
  assert.equal(entry.hidden, false);
  const inserts = world.fake.matching(/^INSERT INTO "chat_messages"/);
  assert.equal(inserts.length, 1);
  assert.deepEqual(
    inserts[0].params.slice(2),
    ['this is me at 3pm', 'gif-key-1', 'gif', 'fake', 'abc123', 'a cat knocking a cup off a table']
  );
});

test('an enabled GIF send with a missing description is refused DESCRIPTION_REQUIRED and stores nothing (AC3)', async (t) => {
  setGifMessagesEnabledForTests(true);
  t.after(() => setGifMessagesEnabledForTests(null));
  const leagueId = 4462;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const client = await harness.connectAs(A, t);
  await harness.emit(client, 'league:join', { leagueId });

  const ack = await harness.emit(client, 'chat:send', { leagueId, gif: { ...GIF_OK, description: '   ' } });
  assert.equal(ack.code, 'DESCRIPTION_REQUIRED');
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 0, 'a description-less GIF stores nothing');
});

test('an enabled GIF send naming a URL asset is refused MEDIA_NOT_ALLOWED and stores nothing (AC2)', async (t) => {
  setGifMessagesEnabledForTests(true);
  t.after(() => setGifMessagesEnabledForTests(null));
  const leagueId = 4463;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const client = await harness.connectAs(A, t);
  await harness.emit(client, 'league:join', { leagueId });

  const ack = await harness.emit(client, 'chat:send', {
    leagueId,
    gif: { ...GIF_OK, assetId: 'https://media.giphy.com/x.gif' },
  });
  assert.equal(ack.code, 'MEDIA_NOT_ALLOWED');
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 0, 'a URL asset stores nothing');
});

test('an enabled GIF send with NO caption succeeds and never throws in the length path (#502 integration)', async (t) => {
  setGifMessagesEnabledForTests(true);
  t.after(() => setGifMessagesEnabledForTests(null));
  const leagueId = 4464;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const sender = await harness.connectAs(A, t);
  await harness.emit(sender, 'league:join', { leagueId });

  const heard = eventOrSilence(sender, 'chat:message');
  const ack = await harness.emit(sender, 'chat:send', { leagueId, gif: { ...GIF_OK, caption: undefined } });
  assert.deepEqual(ack, { ok: true }, 'a captionless GIF is accepted, not a MESSAGE_TOO_LONG throw');
  const entry = await heard;
  assert.equal(entry.message, null, 'no caption reads back as null');
  assert.equal(entry.media.description, 'a cat knocking a cup off a table', 'the description still rides');
});

test('an enabled GIF CAPTION is still length-checked with MESSAGE_TOO_LONG (#502 integration)', async (t) => {
  setGifMessagesEnabledForTests(true);
  t.after(() => setGifMessagesEnabledForTests(null));
  const leagueId = 4465;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const client = await harness.connectAs(A, t);
  await harness.emit(client, 'league:join', { leagueId });

  const overLong = 'a'.repeat(MAX_CHAT_CHARS + 1);
  const ack = await harness.emit(client, 'chat:send', { leagueId, gif: { ...GIF_OK, caption: overLong } });
  assert.equal(ack.code, 'MESSAGE_TOO_LONG');
  assert.equal(ack.length, 501);
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 0, 'an over-long caption stores nothing');
});

test('a keyed GIF retry re-reads the original media (idempotency + reconnect survival, AC8)', async (t) => {
  setGifMessagesEnabledForTests(true);
  t.after(() => setGifMessagesEnabledForTests(null));
  const leagueId = 4466;
  const world = chatWorld({ leagueId, teams: { [A.userId]: { teamId: 71, teamName: 'Founders' } } });
  world.fake.install(t);
  const sender = await harness.connectAs(A, t);
  await harness.emit(sender, 'league:join', { leagueId });

  const first = await harness.emit(sender, 'chat:send', { leagueId, gif: GIF_OK, clientMsgId: 'gif-key-9' });
  assert.deepEqual(first, { ok: true });

  const retry = await harness.emit(sender, 'chat:send', { leagueId, gif: GIF_OK, clientMsgId: 'gif-key-9' });
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.entry.media, {
    provider: 'fake',
    assetId: 'abc123',
    description: 'a cat knocking a cup off a table',
  }, 'the retry reproduces the media and description, never a bare success');
  assert.equal(world.fake.matching(/^INSERT INTO "chat_messages"/).length, 1, 'the retry stores no second row');
});
