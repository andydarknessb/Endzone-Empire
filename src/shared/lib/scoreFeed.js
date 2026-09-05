import { createDraftSocket, onReconnect } from '../../api/socket';

/**
 * The read side of the one league-room broadcast adapter (ADR 0025): a live
 * score feed. It joins the league's Socket.IO room, hands every `scores:updated`
 * event to the subscriber whole, re-joins the room on a reconnect and then calls
 * the subscriber's `resync` (a bare room re-join can leave a client's totals
 * drifted from the deltas it missed while disconnected, so the subscriber
 * refetches), and tears the socket down on unsubscribe. It adds no emit path of
 * its own beyond the room join; the write side stays the server's adapter.
 *
 * It lives in `src/shared/lib`, the bottom of the FSD island, and creates its
 * socket through `createDraftSocket`, so a test installs the app's own socket
 * factory hook (`window.__ENDZONE_TEST_SOCKET_FACTORY__`) and drives it.
 *
 *   subscribeToScoreFeed(leagueId, { onScores, resync }) -> unsubscribe
 *
 * @param {number} leagueId
 * @param {object} handlers
 * @param {(event: object) => void} handlers.onScores  the whole `scores:updated` payload
 * @param {() => void} handlers.resync  called after a reconnect re-join
 * @returns {() => void} unsubscribe
 */
export function subscribeToScoreFeed(leagueId, { onScores, resync } = {}) {
  const socket = createDraftSocket();

  const joinLeagueRoom = () => socket.emit('league:join', { leagueId: Number(leagueId) });
  joinLeagueRoom();

  // Re-join on reconnect so the server re-adds us to the room, then resync: the
  // deltas that landed while we were disconnected never arrive, so a re-join
  // alone would leave the client drifted from the authoritative totals.
  const offReconnect = onReconnect(socket, () => {
    joinLeagueRoom();
    if (typeof resync === 'function') resync();
  });

  if (typeof onScores === 'function') {
    socket.on('scores:updated', onScores);
  }

  return () => {
    offReconnect?.();
    socket.disconnect();
  };
}
