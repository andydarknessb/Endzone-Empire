const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');
const { createFakePool } = require('./helpers/fakePool');
const { LEAGUE_CHAT } = require('../services/leagueFeed');
const { TEXT } = require('../modules/gifMessage');

/**
 * Old-client compatibility (issue #447 AC5). The chat storage and socket
 * contract were expanded over #435/#440/#442/#446 with a client_msg_id, a
 * content_kind discriminator, and cursor pagination. A client built before those
 * landed sends NONE of them: no clientMsgId, no content_kind, and it reads the
 * feed with no cursor. This proves such a client still joins the room, sends
 * text, and has its message stored - the server supplies every field the old
 * client omits.
 *
 * The content_kind default is the load-bearing one and the mutation target the
 * ticket names: the server DERIVES content_kind (draftSocket.js: `let contentKind
 * = TEXT`), it is never read from the client, so removing that default must turn
 * at least one assertion here red. The "reads the feed with no cursor" half is
 * already proven for the same shape by server/test/leagueFeed.service.test.js
 * (listCombinedDraftFeed with no before/after, and listLeagueChatFeed's "latest
 * page ... no cursor"), so it is cited in the matrix rather than rewritten here.
 *
 * The fake pool mirrors the same INSERT parameter order the real handler uses
 * ([league, user, caption, client_msg_id, content_kind, gif_provider,
 * gif_asset_id, gif_description]), so content_kind is param index 4 - the value
 * the mutation changes.
 */

const harness = createSocketHarness({ secret: 'old-client-contract-secret' });

const OLD = { userId: 21, username: 'legacy-client' };
const WATCH = { userId: 22, username: 'watcher' };

// A minimal chat world: who holds a Team (membership, read on join and again per
// send), and a fake chat_messages INSERT that echoes the content_kind it was
// given back on the RETURNING row, the way Postgres would.
function chatWorld({ leagueId, teams }) {
  const state = { teams: new Map(Object.entries(teams).map(([uid, t]) => [Number(uid), t])), stored: new Map(), seq: 0, nextId: 1000 };
  const fake = createFakePool([
    // lookupTeam - the join membership read AND the per-send revalidation.
    [/^SELECT "id", "name" FROM "teams"/, (t, [lg, uid]) => {
      const team = lg === leagueId ? state.teams.get(uid) : undefined;
      return { rows: team ? [{ id: team.teamId, name: team.teamName }] : [] };
    }],
    // isLeagueCommissioner (join only): this world has no commissioners.
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [] })],
    // selectChatByKey - only reached when a key is present; an old client sends
    // none, so this must NOT fire. Answer empty if it ever does.
    [/^SELECT "id", "message", "created_at", "feed_seq"/, () => ({ rows: [] })],
    // INSERT ... RETURNING. Param order matches the real handler exactly.
    [/^INSERT INTO "chat_messages"/, (t, [lg, uid, caption, key, contentKind, gifProvider, gifAssetId, gifDescription]) => {
      const row = {
        id: state.nextId++,
        message: caption,
        created_at: '2026-08-27T00:00:00.000Z',
        feed_seq: ++state.seq,
        content_kind: contentKind,
        gif_provider: gifProvider,
        gif_asset_id: gifAssetId,
        gif_description: gifDescription,
      };
      return { rows: [{ id: row.id, created_at: row.created_at, feed_seq: row.feed_seq, content_kind: row.content_kind, gif_provider: row.gif_provider, gif_asset_id: row.gif_asset_id, gif_description: row.gif_description }] };
    }],
    // listBlockersOf - nobody has blocked anyone here.
    [/^SELECT "blocker_id" FROM "user_blocks"/, () => ({ rows: [] })],
  ]);
  return { fake, state };
}

function eventOrSilence(client, event, ms = 300) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    client.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

test('an old client with no clientMsgId and no content_kind joins, sends text, and the server supplies both (AC5)', async (t) => {
  const leagueId = 4470;
  const world = chatWorld({
    leagueId,
    teams: { [OLD.userId]: { teamId: 61, teamName: 'Legacy' }, [WATCH.userId]: { teamId: 62, teamName: 'Watcher' } },
  });
  world.fake.install(t);
  const sender = await harness.connectAs(OLD, t);
  const watcher = await harness.connectAs(WATCH, t);

  // JOINS with the old-client payload: just { leagueId }, no versioned fields.
  const joinAck = await harness.emit(sender, 'league:join', { leagueId });
  assert.equal(joinAck.ok, true, 'the old client joins the room');
  await harness.emit(watcher, 'league:join', { leagueId });

  const heard = eventOrSilence(watcher, 'chat:message');
  // SENDS TEXT the old way: no clientMsgId, no content_kind, no gif.
  const ack = await harness.emit(sender, 'chat:send', { leagueId, message: 'hi from an old build' });
  assert.deepEqual(ack, { ok: true }, 'the send is accepted without a clientMsgId');

  const entry = await heard;
  assert.ok(entry, 'the room received the message');
  assert.equal(entry.type, LEAGUE_CHAT);
  assert.equal(entry.message, 'hi from an old build', 'the text rides on the entry unchanged');

  const inserts = world.fake.matching(/^INSERT INTO "chat_messages"/);
  assert.equal(inserts.length, 1, 'exactly one row was stored');

  // THE MUTATION TARGET (AC5). content_kind is param index 4. The server derives
  // it - the client sends none - and defaults it to TEXT. Delete the default in
  // draftSocket.js and the stored value is undefined instead of 'text', turning
  // the two assertions below red.
  const storedContentKind = inserts[0].params[4];
  assert.equal(storedContentKind, TEXT, 'the server defaults content_kind for a client that sends none');
  assert.equal(storedContentKind, 'text', 'and the default IS the text discriminator');

  // The keyless send stores a null client_msg_id (param index 3), and never
  // reached the idempotency lookup - a keyless old client is not deduped, just
  // stored.
  assert.equal(inserts[0].params[3], null, 'a keyless send stores a null client_msg_id');
});
