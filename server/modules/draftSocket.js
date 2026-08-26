const { Server } = require('socket.io');
const pool = require('./pool');
const { setIo } = require('./io');
const { requireSocketAuth } = require('./auth');
const { draftPlayer, DraftError } = require('../services/draft.service');
const { teamForPick } = require('../services/draftOrder.service');
const {
  teamIdentityColumns,
  teamIdentityOf,
  lookupTeam,
} = require('../services/teamIdentity');
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

  io.on('connection', (socket) => {
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

    // League chat: sender must be in the league room (i.e. passed league:join
    // or draft:join membership checks); messages persist and broadcast.
    socket.on('chat:send', async ({ leagueId, message } = {}, ack) => {
      if (!Number.isInteger(leagueId) || typeof message !== 'string' || !message.trim()) {
        return ack && ack({ error: 'leagueId (integer) and message (string) required' });
      }
      if (!socket.rooms.has(`league:${leagueId}`)) {
        return ack && ack({ error: 'join the league room first' });
      }
      const text = message.trim().slice(0, 500);
      try {
        // Read the author's Team BEFORE the insert: a lookup that failed
        // after it would leave the message persisted but never broadcast,
        // and tell the sender it failed.
        const authorTeam = await lookupTeam(pool, { leagueId, userId: socket.user.id });
        const result = await pool.query(
          `INSERT INTO "chat_messages" ("league_id", "user_id", "message")
           VALUES ($1, $2, $3) RETURNING "id", "created_at"`,
          [leagueId, socket.user.id, text]
        );
        io.to(`league:${leagueId}`).emit('chat:message', chatMessagePayload({
          id: result.rows[0].id,
          leagueId,
          user: socket.user,
          team: authorTeam,
          message: text,
          createdAt: result.rows[0].created_at,
        }));
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
function chatMessagePayload({ id, leagueId, team, message, createdAt }) {
  return {
    id,
    leagueId,
    ...teamIdentityOf(team),
    message,
    created_at: createdAt,
  };
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
};
