const { Server } = require('socket.io');
const pool = require('./pool');
const { setIo } = require('./io');
const { requireSocketAuth } = require('./auth');
const { draftPlayer, DraftError } = require('../services/draft.service');
const { teamForPick } = require('../services/draftOrder.service');

/**
 * Real-time draft room. Clients connect with { auth: { token } }, then:
 *   emit 'draft:join'  { leagueId }            -> joins room, receives 'draft:state'
 *   emit 'draft:pick'  { leagueId, playerId }  -> validated + transactional pick;
 *                                                room receives 'draft:picked'
 * Turn enforcement, roster limits, and double-pick protection all live in
 * draft.service (single source of truth shared with the REST endpoint).
 */
function attachDraftSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });
  io.use(requireSocketAuth);
  setIo(io); // let scoring/scheduler broadcast without a circular require

  io.on('connection', (socket) => {
    // Generic league room join (live scores, chat) — no draft state attached
    socket.on('league:join', async ({ leagueId } = {}, ack) => {
      if (!Number.isInteger(leagueId)) {
        return ack && ack({ error: 'leagueId (integer) required' });
      }
      try {
        const membership = await pool.query(
          `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
          [leagueId, socket.user.id]
        );
        if (!membership.rows[0]) {
          return ack && ack({ error: 'you are not in this league' });
        }
        socket.join(`league:${leagueId}`);
        ack && ack({ ok: true });
      } catch (error) {
        console.error('league:join failed', error);
        ack && ack({ error: 'failed to join league room' });
      }
    });

    socket.on('draft:join', async ({ leagueId } = {}, ack) => {
      if (!Number.isInteger(leagueId)) {
        return ack && ack({ error: 'leagueId (integer) required' });
      }
      try {
        const membership = await pool.query(
          `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
          [leagueId, socket.user.id]
        );
        if (!membership.rows[0]) {
          return ack && ack({ error: 'you are not in this league' });
        }
        socket.join(`league:${leagueId}`);
        const state = await getDraftState(leagueId);
        socket.emit('draft:state', state);
        socket.to(`league:${leagueId}`).emit('draft:presence', {
          userId: socket.user.id,
          username: socket.user.username,
          joined: true,
        });
        ack && ack({ ok: true });
      } catch (error) {
        console.error('draft:join failed', error);
        ack && ack({ error: 'failed to join draft room' });
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
        const result = await pool.query(
          `INSERT INTO "chat_messages" ("league_id", "user_id", "message")
           VALUES ($1, $2, $3) RETURNING "id", "created_at"`,
          [leagueId, socket.user.id, text]
        );
        io.to(`league:${leagueId}`).emit('chat:message', {
          id: result.rows[0].id,
          leagueId,
          userId: socket.user.id,
          username: socket.user.username,
          message: text,
          created_at: result.rows[0].created_at,
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
        io.to(`league:${leagueId}`).emit('draft:picked', {
          ...outcome,
          by: { userId: socket.user.id, username: socket.user.username },
        });
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

/** Full draft-room snapshot: league, teams in draft order, picks so far, on the clock. */
async function getDraftState(leagueId) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) return null;
  delete league.invite_code;

  const teamsResult = await pool.query(
    `SELECT "teams"."id", "teams"."name", "teams"."draft_position", "teams"."autodraft",
            "teams"."draft_ready", "teams"."owner_id", "users"."username" AS "owner"
     FROM "teams" JOIN "users" ON "users"."id" = "teams"."owner_id"
     WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "teams"."id"`,
    [leagueId]
  );
  const picksResult = await pool.query(
    `SELECT "draft_picks"."pick_number", "draft_picks"."team_id", "draft_picks"."is_keeper",
            "players"."id" AS "player_id", "players"."name", "players"."position", "players"."nfl_team"
     FROM "draft_picks" JOIN "players" ON "players"."id" = "draft_picks"."player_id"
     WHERE "draft_picks"."league_id" = $1 ORDER BY "pick_number"`,
    [leagueId]
  );
  const teams = teamsResult.rows;
  const onTheClock = league.draft_status === 'active' && teams.length > 0
    ? teamForPick(league.current_pick, teams, { rotation: league.draft_rotation, overrides: league.draft_order_overrides })
    : null;

  return { league, teams, picks: picksResult.rows, onTheClock };
}

module.exports = { attachDraftSocket, getDraftState };
