/**
 * Deliver one typed Draft LIFECYCLE activity entry to a league's Draft room
 * (#437, ADR 0012).
 *
 * A committed Pick already rides to the room on `draft:picked` (#435). The rest
 * of the lifecycle - Draft start, pause, resume, reset, completion - is emitted
 * on its own `draft:activity` event so the combined-feed client (useDraftRoomFeed)
 * merges it into the same per-league `feed_seq` order as Picks and chat, without
 * overloading the Pick broadcast or the whole-state `draft:state` refresh.
 *
 * The entry is the typed shape appendLifecycleActivity returned: Team identity
 * only, never an account identifier, so it is safe to broadcast to the whole
 * league room. This is written once, and every lifecycle emit site (startDraft,
 * the pause/resume and reset routes, and the completion side of a committed
 * Pick) calls it, so the event name and the room cannot drift between them.
 *
 * io is looked up here and a missing io (no socket server, e.g. a unit test or
 * the scheduler outside a live server) is a silent no-op, mirroring
 * broadcastDraftState: the durable record is the committed row, and the next
 * feed fetch or reconnect re-reads it regardless.
 */
function broadcastDraftActivity(leagueId, entry) {
  if (!entry) return;
  const { getIo } = require('./io');
  const io = getIo();
  if (!io) return;
  io.to(`league:${leagueId}`).emit('draft:activity', entry);
}

module.exports = { broadcastDraftActivity };
