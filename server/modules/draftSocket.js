const { Server } = require('socket.io');
const pool = require('./pool');
const { setIo } = require('./io');
const { broadcastDraftActivity } = require('./draftActivityBroadcast');
const { requireSocketAuth } = require('./auth');
const { draftPlayer, DraftError } = require('../services/draft.service');
const { teamForPick } = require('../services/draftOrder.service');
const {
  teamIdentityColumns,
  teamIdentityOf,
  lookupTeam,
} = require('../services/teamIdentity');
const { feedEntryOf, isBlockableFeedType, listBlockersOf } = require('../services/leagueFeed');
const { checkChatSend } = require('./chatFlood');
const { MAX_CHAT_CHARS } = require('./chatLimits');
const { GIF, validateGifSend } = require('./gifMessage');
const { isGifMessagesEnabled } = require('./gifCapability');
const { isLeagueCommissioner } = require('../services/leagueRole.service');
const { getCorsOptions } = require('./clientOrigins');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createRedisSubscriber, getRedisClient } = require('./redis');

/**
 * Real-time draft room. Clients connect with { auth: { token } }, then:
 *   emit 'draft:join'  { leagueId }            -> joins room, receives 'draft:state'
 *   emit 'draft:pick'  { leagueId, playerId }  -> validated + transactional pick;
 *                                                room receives 'draft:picked'
 * Turn enforcement, roster limits, and double-pick protection all live in
 * draft.service (single source of truth shared with the REST endpoint).
 *
 * A REFUSED 'league:join' or 'draft:join' acknowledges { error, code }, where
 * code is one of 'INVALID_REQUEST', 'NOT_A_MEMBER' or 'JOIN_FAILED' (#230).
 * The code is the discriminator, never the message text; joinError below says
 * why, and which single code a client may act on.
 */
function attachDraftSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: getCorsOptions(),
  });
  io.redisReady = (async () => {
    const publisher = await getRedisClient();
    if (!publisher) return;
    const subscriber = await createRedisSubscriber();
    io.adapter(createAdapter(publisher, subscriber));
    io.redisSubscriber = subscriber;
  })();
  io.use(requireSocketAuth);
  setIo(io); // let scoring/scheduler broadcast without a circular require

  // Per-instance flood-control store for chat sends (#440). socket.io sessions
  // are sticky to one instance, so a process-local store sees all of a member's
  // sends; this mirrors modules/rateLimit.js's local fallback.
  const chatFloodStore = new Map();

  io.on('connection', (socket) => {
    // Expose the authenticated user id on socket.data so a per-recipient chat
    // broadcast can identify a REMOTE socket (one on another instance behind the
    // Redis adapter), which carries only `data`, not the local `user` object.
    socket.data.userId = socket.user.id;

    // Generic league room join (live scores, chat) — no draft state attached
    socket.on('league:join', async ({ leagueId } = {}, ack) => {
      if (!Number.isInteger(leagueId)) {
        return ack && ack(joinError({ code: 'INVALID_REQUEST', message: 'leagueId (integer) required' }));
      }
      try {
        const viewer = await viewerContext(pool, { leagueId, userId: socket.user.id });
        if (!viewer) {
          return ack && ack(joinError({ code: 'NOT_A_MEMBER', message: 'you are not in this league' }));
        }
        socket.join(`league:${leagueId}`);
        ack && ack(joinAck(viewer));
      } catch (error) {
        console.error('league:join failed', error);
        ack && ack(joinError({ code: 'JOIN_FAILED', message: 'failed to join league room' }));
      }
    });

    socket.on('draft:join', async ({ leagueId } = {}, ack) => {
      if (!Number.isInteger(leagueId)) {
        return ack && ack(joinError({ code: 'INVALID_REQUEST', message: 'leagueId (integer) required' }));
      }
      try {
        // The viewer's team IS their membership (ADR 0002), so the team read
        // inside this one is also the "may they join the room" answer: no
        // team, no context, no join.
        const viewer = await viewerContext(pool, { leagueId, userId: socket.user.id });
        if (!viewer) {
          return ack && ack(joinError({ code: 'NOT_A_MEMBER', message: 'you are not in this league' }));
        }
        socket.join(`league:${leagueId}`);
        const state = await getDraftState(leagueId);
        // Acknowledge before the first snapshot, so a client knows which Team
        // is its own, and whether it may act as commissioner, before it has
        // any Team identity or draft state to apply either answer to.
        ack && ack(joinAck(viewer));
        socket.emit('draft:state', state);
        socket.to(`league:${leagueId}`).emit('draft:presence', presencePayload(socket.user, viewer.viewerTeam));
      } catch (error) {
        console.error('draft:join failed', error);
        ack && ack(joinError({ code: 'JOIN_FAILED', message: 'failed to join draft room' }));
      }
    });

    // League chat send, hardened (#440). Layered, in order, because each layer
    // assumes the ones before it held:
    //   AC1  membership is REVALIDATED from the source of truth on every send,
    //        not trusted from the room the socket joined earlier;
    //   AC2  a client idempotency key collapses retries onto one stored row and
    //        answers a retry with the ORIGINAL message, never a silent nothing;
    //   AC3/AC5 flood control refuses an over-rate send with an explicit retry
    //        time and persists nothing, so the sender keeps their text;
    //   AC6/AC7 the live broadcast is delivered per recipient, skipping viewers
    //        who blocked the author - but only for a BLOCKABLE feed kind, so
    //        Draft activity involving a blocked Team is never hidden.
    //
    // A message over MAX_CHAT_CHARS is refused with code MESSAGE_TOO_LONG (#502),
    // on the same footing as the malformed-key INVALID_REQUEST below: it is a
    // request-shape check, decided before any query, and it never shortens an
    // accepted message to fit - the handler used to clamp the text here and no
    // longer does, so what a client sends is exactly what a client gets. Length
    // is counted in Unicode code points (Array.from(text).length), the same
    // unit MAX_CHAT_CHARS, the chat_messages.message column and the client's
    // composer counter all agree on (#443).
    socket.on('chat:send', async ({ leagueId, message, clientMsgId, gif } = {}, ack) => {
      // A GIF message (#446) is a chat_messages row like any other; it differs
      // only in what it carries. A text send still requires a non-empty message;
      // a GIF send does not, because its `message` is only the OPTIONAL caption
      // (AC1), so the non-empty rule applies to the text branch alone.
      const isGif = gif !== undefined && gif !== null;
      if (!Number.isInteger(leagueId) || (!isGif && (typeof message !== 'string' || !message.trim()))) {
        return ack && ack({ error: 'leagueId (integer) and message (string) required' });
      }
      if (!socket.rooms.has(`league:${leagueId}`)) {
        return ack && ack({ error: 'join the league room first' });
      }
      const key = normalizeClientMsgId(clientMsgId);
      if (key === INVALID_KEY) {
        // A client can branch on the code, per the room's refusal convention
        // (#230, ADR 0008): a malformed key is a bad request, not a rejection of
        // the message's content.
        return ack && ack({ error: 'clientMsgId must be a string of at most 64 characters', code: 'INVALID_REQUEST' });
      }

      // Resolve the stored shape. A text message stores its trimmed body in
      // `message`; a GIF message stores a validated (provider, assetId,
      // description) and an OPTIONAL caption in `message`. A GIF send is refused
      // SERVER-SIDE (a client that never rendered the picker can still emit the
      // event) with a SCREAMING_SNAKE code (ADR 0008): GIF_PROVIDER_DISABLED
      // when the capability is off (AC7/AC9), MEDIA_NOT_ALLOWED for a url/upload
      // asset (AC2), DESCRIPTION_REQUIRED for a missing description (AC3).
      let contentKind = 'text';
      let caption = null; // the text body, or the GIF's optional caption
      let gifValue = null;
      if (isGif) {
        const validated = validateGifSend(gif, { enabled: isGifMessagesEnabled() });
        if (!validated.ok) {
          const { ok, value, ...refusal } = validated; // eslint-disable-line no-unused-vars
          return ack && ack(refusal);
        }
        contentKind = GIF;
        gifValue = validated.value;
        caption = validated.value.caption; // trimmed, or null for a captionless GIF
      } else {
        caption = message.trim();
      }

      // #502: length is counted in Unicode CODE POINTS and refused, never
      // shortened. A captionless GIF has length 0 and cannot trip this; a GIF
      // WITH a caption is length-checked on exactly the same footing as a text
      // message, so there is one length rule, not two, and a null caption never
      // throws here.
      const length = caption == null ? 0 : Array.from(caption).length;
      if (length > MAX_CHAT_CHARS) {
        // MESSAGE_TOO_LONG (#502): refused, never shortened. `limit` and `length`
        // let the client render exact copy without re-deriving either number.
        return ack && ack({
          error: `message must be at most ${MAX_CHAT_CHARS} characters`,
          code: 'MESSAGE_TOO_LONG',
          limit: MAX_CHAT_CHARS,
          length,
        });
      }
      try {
        // AC1. The sender's CURRENT Team is their membership (ADR 0002): a
        // manager removed after joining holds none and may no longer speak,
        // even though their socket is still in the room. Reading it here, per
        // send, is the revalidation - and it is also the author identity the
        // broadcast needs, so it is not an extra round trip.
        const authorTeam = await lookupTeam(pool, { leagueId, userId: socket.user.id });
        if (!authorTeam) {
          return ack && ack(joinError({ code: 'NOT_A_MEMBER', message: 'you are not in this league' }));
        }

        // AC2, common case. A keyed retry that the server already stored is
        // answered from the stored row - success carrying the original entry,
        // no second insert, no second broadcast, and crucially not counted
        // against the flood limit below (a retry is not new content).
        if (key) {
          const prior = await selectChatByKey(pool, { userId: socket.user.id, key });
          if (prior) {
            return ack && ack(duplicateAck(chatEntryFrom({ row: prior, leagueId, team: authorTeam })));
          }
        }

        // AC3/AC5. Over-rate: tell the sender when they may retry and persist
        // nothing. The content is not dropped - it stays in their composer.
        const decision = checkChatSend(chatFloodStore, {
          leagueId,
          userId: socket.user.id,
          kind: contentKind,
          now: Date.now(),
        });
        if (!decision.allowed) {
          return ack && ack({
            error: 'you are sending too quickly',
            code: 'RATE_LIMITED',
            retryAfterMs: decision.retryAfterMs,
            retryAfterSeconds: decision.retryAfterSeconds,
          });
        }

        // AC2, race case. Two sends of one key arriving concurrently both pass
        // the SELECT above (neither is committed yet); the unique index lets
        // exactly one INSERT win and the other DO NOTHING. The BEFORE INSERT
        // trigger allocates feed_seq (#434), so the winner's chronological
        // position returns straight back.
        const inserted = await pool.query(
          `INSERT INTO "chat_messages"
             ("league_id", "user_id", "message", "client_msg_id",
              "content_kind", "gif_provider", "gif_asset_id", "gif_description")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT ("user_id", "client_msg_id") WHERE "client_msg_id" IS NOT NULL DO NOTHING
           RETURNING "id", "created_at", "feed_seq",
                     "content_kind", "gif_provider", "gif_asset_id", "gif_description"`,
          [
            leagueId,
            socket.user.id,
            caption, // text body, or the GIF's optional caption (null when absent)
            key,
            contentKind,
            gifValue ? gifValue.provider : null,
            gifValue ? gifValue.assetId : null,
            gifValue ? gifValue.description : null,
          ]
        );
        if (inserted.rows.length === 0) {
          // The concurrent duplicate that lost the unique-index race. It already
          // consumed a flood slot above (it passed the SELECT before the winner
          // committed), which is the one case a duplicate is charged - rare, and
          // never for a sequential retry, which the SELECT short-circuits before
          // the flood check. Answer success from the winner's stored row.
          const prior = await selectChatByKey(pool, { userId: socket.user.id, key });
          return ack && ack(duplicateAck(prior ? chatEntryFrom({ row: prior, leagueId, team: authorTeam }) : undefined));
        }

        const entry = chatEntryFrom({ row: inserted.rows[0], leagueId, team: authorTeam, message: caption });
        // AC6/AC7. Blockable kind -> deliver per recipient; skip only viewers
        // who blocked THIS author. Draft activity is not a blockable kind, so
        // this path never withholds it.
        await deliverFeedEntry(io, pool, {
          leagueId,
          event: 'chat:message',
          entry,
          authorUserId: socket.user.id,
        });
        ack && ack({ ok: true });
      } catch (error) {
        console.error('chat:send failed', error);
        ack && ack({ error: 'failed to send message' });
      }
    });

    socket.on('draft:pick', async ({ leagueId, playerId } = {}, ack) => {
      if (!Number.isInteger(leagueId) || !Number.isInteger(playerId)) {
        return ack && ack({ error: 'leagueId and playerId (integers) required' });
      }
      try {
        const outcome = await draftPlayer({ leagueId, userId: socket.user.id, playerId });
        // Attributed by Team at the root (`teamId` / `teamName` off the
        // outcome), so the old `by: { userId, username }` account object is
        // gone from the broadcast (#344, #115 child C). `auto` is the one
        // non-identity fact the room still needs about how the pick was made;
        // a manual pick is not an autopick. autopick.service is the other emit
        // site; socketPayloadShape.test.js pins both to one key set.
        io.to(`league:${leagueId}`).emit('draft:picked', { ...outcome, auto: false });
        if (outcome.draftComplete) {
          // The Pick that ended the draft also appended a completion lifecycle
          // entry (#437); deliver it to the room's combined feed on draft:activity
          // through the one shared helper (null-safe), beside the draft:complete
          // board signal.
          broadcastDraftActivity(leagueId, outcome.completion);
          io.to(`league:${leagueId}`).emit('draft:complete', { leagueId });
        }
        ack && ack({ ok: true, outcome });
      } catch (error) {
        if (error instanceof DraftError || error.statusCode) {
          return ack && ack({ error: error.message });
        }
        console.error('draft:pick failed', error);
        ack && ack({ error: 'pick failed' });
      }
    });

    socket.on('draft:start', async ({ leagueId } = {}, ack) => {
      if (!Number.isInteger(leagueId)) {
        return ack && ack({ error: 'leagueId (integer) required' });
      }
      try {
        const { startDraft } = require('../services/draftStart.service');
        await startDraft({ leagueId, userId: socket.user.id });
        ack && ack({ ok: true });
      } catch (error) {
        if (error.statusCode) return ack && ack({ error: error.message });
        console.error('draft:start failed', error);
        ack && ack({ error: 'failed to start draft' });
      }
    });
  });

  return io;
}

async function closeDraftSocket(io) {
  if (!io) return;
  await new Promise((resolve) => io.close(resolve));
  if (io.redisSubscriber?.isOpen) await io.redisSubscriber.quit();
}

/**
 * The acknowledgement to `league:join` and `draft:join`. It is answered to
 * one socket, so it is where this room's viewer-relative field lives: every
 * `draft:state`, `draft:picked`, `draft:presence` and `chat:message` payload
 * after it is broadcast to the whole league room and cannot say anything
 * true about one recipient (#112, parent #108). A client holds this
 * `viewerTeamId` and compares it against the `teamId` on everything that
 * follows.
 *
 * `isCommissioner` is here for the same reason and no other: it is a fact
 * about the one manager this ack is answered to (#178). Both fields travel
 * together so a viewer-relative field never has to be invented anywhere
 * else in this room.
 *
 * Both joins answer it, because both rooms have a viewer: the chat panel
 * joins with `league:join` and never reads league detail, so this ack is its
 * only route to knowing which Team is its own.
 */
function joinAck({ viewerTeam, isCommissioner }) {
  return {
    ok: true,
    viewerTeamId: teamIdentityOf(viewerTeam).teamId,
    isCommissioner: !!isCommissioner,
    // The GIF-message capability (#446, AC7): server-authoritative, off by
    // default (AC9), delivered on the same per-viewer ack as isCommissioner so
    // the client renders the picker only when it is on and never infers it.
    gifMessagesEnabled: isGifMessagesEnabled(),
  };
}

/**
 * The refusal both joins answer with, and the only part of it a client may
 * branch on: the `code` (#230).
 *
 *   INVALID_REQUEST  the payload carried no integer leagueId; nothing was read
 *   NOT_A_MEMBER     the viewer holds no Team in this league (ADR 0002)
 *   JOIN_FAILED      the attempt threw
 *
 * The spelling is the repository convention and not a local choice: every
 * error code this app emits is SCREAMING_SNAKE, HTTP body and socket ack
 * alike (ADR 0008). These three shipped lowercase in #230 and were renamed in
 * #265; a client reading an unknown code changes no state on it, which is
 * what made renaming a shipped wire contract cost one stale deploy window.
 *
 * The message text is deliberately unchanged - it is copy, and clients already
 * render it - but it is not the contract, and it could never have been:
 * JOIN_FAILED's text names the room it failed to join ('failed to join draft
 * room' against 'failed to join league room'), so matching on text means
 * matching two strings for one condition, and a copy edit silently changes
 * behaviour.
 *
 * Only NOT_A_MEMBER is a statement about the viewer's STANDING in the league,
 * so it is the only refusal on which a client clears their Team identity or
 * commissioner flag. The other two say the ATTEMPT failed, not that the viewer
 * lost anything - as does an acknowledgement from a server older than this
 * change, which carries no code at all. A client that cleared on those would
 * strip a manager's own controls off the screen on a reconnect blip, which is
 * worse than a stale display: it is a wrong answer that arrives repeatedly.
 */
function joinError({ code, message }) {
  return { error: message, code };
}

/**
 * Everything the ack above needs to say about ONE viewer of one league, or
 * null when they hold no Team in it. Membership IS the Team (ADR 0002), so
 * the null is also the join handlers' "you are not in this league" answer
 * and a non-member is never asked the role question at all.
 *
 * `isCommissioner` is decided here, on the server, through the same
 * `isLeagueCommissioner` predicate every commissioner-gated route
 * authorizes with, so the owner and a `league_commissioners` row answer
 * alike (#178). The Draft room used to derive it from the snapshot's
 * `league` row with an `owner_id` comparison as a fallback; that row is a
 * bare `SELECT *` on `leagues` and carries no per-viewer field, so a
 * co-commissioner silently got no controls. It cannot be computed on the
 * client from anything the room holds, and it cannot ride on `draft:state`,
 * so it rides here.
 */
async function viewerContext(db, { leagueId, userId } = {}) {
  const viewerTeam = await lookupTeam(db, { leagueId, userId });
  if (!viewerTeam) return null;
  return { viewerTeam, isCommissioner: await isLeagueCommissioner(db, leagueId, userId) };
}

/**
 * The `draft:presence` payload: who joined the room, by Team and nothing about
 * their account (#344, #115 child C). A broadcast reaches the whole league
 * room, so it names the joining manager by their Team only; the room's one
 * per-viewer channel is the join ack (`viewerTeamId` / `isCommissioner`). The
 * `user` argument is no longer read - the account id and username it carried
 * left the wire here - but the signature is kept so the emit call site and the
 * contract tests do not have to change shape.
 */
function presencePayload(user, team) {
  return { ...teamIdentityOf(team), joined: true };
}

/**
 * The `chat:message` payload: one message, attributed by Team and nothing about
 * the author account (#344). The author's `user_id` is still the stored row's
 * key (it is the LEFT-join key that lets history read back "Former manager"),
 * but neither it nor the username rides on this broadcast.
 */
// The live broadcast of a League-chat entry: the same typed feed entry a REST
// read returns (leagueFeed.feedEntryOf: type, id, seq, Team-only identity,
// message, created_at), plus `leagueId` so a client in more than one league
// room can route it. `seq` is the entry's per-league sequence position, its
// stable cursor; a reconnecting client compares it against what it last saw.
// The `team` is a teams row ({ id, name }); feedEntryOf reads Team identity
// off the aliased teamId/teamName, so it is normalised here first.
function chatMessagePayload({
  id, seq, leagueId, team, message, createdAt,
  contentKind, gifProvider, gifAssetId, gifDescription,
}) {
  return {
    ...feedEntryOf({
      id,
      feed_seq: seq,
      message,
      created_at: createdAt,
      // A GIF message (#446) carries its shape through the same feed entry: a
      // text broadcast passes content_kind undefined/'text' and yields
      // media:null, a GIF broadcast passes 'gif' plus the three gif_* fields and
      // yields the structured media object. Absent for legacy callers, which
      // then read as text with no media.
      content_kind: contentKind,
      gif_provider: gifProvider,
      gif_asset_id: gifAssetId,
      gif_description: gifDescription,
      ...teamIdentityOf(team),
    }),
    leagueId,
  };
}

/**
 * A rejected client idempotency key, told apart from "no key supplied" (null)
 * so the handler can answer a malformed key with an error rather than silently
 * sending unprotected.
 */
const INVALID_KEY = Symbol('invalid-client-msg-id');

/** A client-supplied idempotency key, or null when none was sent, or the
 *  INVALID_KEY sentinel when one was sent but is not a bounded string. */
function normalizeClientMsgId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return INVALID_KEY;
  return value;
}

/** The stored chat row for one author's idempotency key, or null. Reads only
 *  what building a feed entry needs; the author's Team is supplied separately by
 *  the live per-send membership read, never re-derived here. */
async function selectChatByKey(db, { userId, key }) {
  const result = await db.query(
    `SELECT "id", "message", "created_at", "feed_seq",
            "content_kind", "gif_provider", "gif_asset_id", "gif_description"
       FROM "chat_messages"
      WHERE "user_id" = $1 AND "client_msg_id" = $2`,
    [userId, key]
  );
  return result.rows[0] || null;
}

/** The acknowledgement for a send the server already stored under this key: a
 *  success (never a silent nothing, #440 AC5) carrying the original entry so a
 *  client that missed the first broadcast can reconcile. `entry` may be
 *  undefined if the stored row could not be re-read; the client tolerates it. */
function duplicateAck(entry) {
  return { ok: true, duplicate: true, entry };
}

/** Shape a stored or freshly inserted chat row as the typed feed entry the room
 *  broadcasts. `message` overrides the row's own text only on the insert path,
 *  where the trimmed text is already in hand. */
function chatEntryFrom({ row, leagueId, team, message }) {
  return chatMessagePayload({
    id: row.id,
    seq: row.feed_seq,
    leagueId,
    team,
    message: message !== undefined ? message : row.message,
    createdAt: row.created_at,
    // Carried straight off the row (the INSERT ... RETURNING and selectChatByKey
    // both project them), so a GIF broadcast and a GIF idempotent-retry re-read
    // reproduce the same media and description - which is what lets a GIF
    // message survive a reconnect without losing its description (#446 AC8).
    contentKind: row.content_kind,
    gifProvider: row.gif_provider,
    gifAssetId: row.gif_asset_id,
    gifDescription: row.gif_description,
  });
}

/**
 * Deliver a feed entry to a league room, honouring per-viewer blocking for
 * blockable kinds only (#440, AC6/AC7).
 *
 * A non-blockable kind (Draft activity) is broadcast to the whole room
 * untouched: a blocked Team's Pick is a shared draft fact, never hidden. A
 * blockable kind (League chat) with no blockers of its author is also a plain
 * broadcast - the per-socket path is taken only when someone actually blocked
 * the author, so the common case stays a single room emit. The author is never
 * among their own blockers (the user_blocks CHECK forbids it), so they always
 * receive their own echo.
 */
async function deliverFeedEntry(io, db, { leagueId, event, entry, authorUserId }) {
  const room = `league:${leagueId}`;
  if (!isBlockableFeedType(entry.type)) {
    io.to(room).emit(event, entry);
    return;
  }
  const blockers = await listBlockersOf(db, authorUserId);
  if (blockers.size === 0) {
    io.to(room).emit(event, entry);
    return;
  }
  const sockets = await io.in(room).fetchSockets();
  for (const member of sockets) {
    const uid = member.data?.userId;
    if (uid != null && blockers.has(uid)) continue;
    member.emit(event, entry);
  }
}

/** Full draft-room snapshot: league, teams in draft order, picks so far, on the clock. */
async function getDraftState(leagueId) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) return null;
  delete league.invite_code;

  // Team identity only, no manager account: the snapshot is broadcast to the
  // whole league room, so it names each team by Team and never by its owner's
  // account (#344, #115 child C). The `owner_id` column and the
  // `"users"."username" AS "owner"` join that fed the old `owner` field are
  // gone; the join is dropped with them, which also lets a team whose owner
  // has left the league appear rather than being filtered out.
  const teamsResult = await pool.query(
    `SELECT "teams"."id", "teams"."name", "teams"."draft_position", "teams"."autodraft",
            "teams"."draft_ready", ${teamIdentityColumns()}
     FROM "teams"
     WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "teams"."id"`,
    [leagueId]
  );
  // A pick's own `name` is the PLAYER's, so the Team that made it needs its
  // own contract fields rather than a second bare `name` (#112, parent #108).
  const picksResult = await pool.query(
    `SELECT "draft_picks"."pick_number", "draft_picks"."team_id", "draft_picks"."is_keeper",
            ${teamIdentityColumns()},
            "players"."id" AS "player_id", "players"."name", "players"."position", "players"."nfl_team"
     FROM "draft_picks" JOIN "players" ON "players"."id" = "draft_picks"."player_id"
     LEFT JOIN "teams" ON "teams"."id" = "draft_picks"."team_id"
     WHERE "draft_picks"."league_id" = $1 ORDER BY "pick_number"`,
    [leagueId]
  );
  const teams = teamsResult.rows;
  const onTheClock = league.draft_status === 'active' && teams.length > 0
    ? teamForPick(league.current_pick, teams, { rotation: league.draft_rotation, overrides: league.draft_order_overrides })
    : null;

  return { league, teams, picks: picksResult.rows, onTheClock };
}

module.exports = {
  attachDraftSocket,
  closeDraftSocket,
  getDraftState,
  viewerContext,
  joinAck,
  joinError,
  presencePayload,
  chatMessagePayload,
  deliverFeedEntry,
  normalizeClientMsgId,
  MAX_CHAT_CHARS,
};
