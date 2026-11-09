import { onReconnect } from '../../api/socket';

/**
 * Owns "joined" for the Draft room (#2696): the first connect, a reconnect and a
 * revive each join once and resync the feed cursor and the board reads; a
 * draft:state refreshes the reads only. Attached, not a hook, so it subscribes in
 * the same tick the socket is created. Returns the detach.
 */
export function openDraftRoomSession(socket, { join, refreshFeed, refreshReads }) {
  const resync = () => {
    join();
    refreshFeed();
    refreshReads();
  };

  let connectedBefore = false;
  const onConnect = () => {
    if (connectedBefore) return;
    connectedBefore = true;
    resync();
  };

  // A snapshot older than the board the session already refreshed for changes
  // nothing, the same rule the board model applies (draftModel.applyBoardSnapshot).
  // An equal version refreshes again, as an autodraft toggle re-arms the clock.
  let heldBoardVersion = null;
  const onDraftState = (data) => {
    const version = data?.boardVersion;
    if (Number.isFinite(version)) {
      if (heldBoardVersion != null && version < heldBoardVersion) return;
      heldBoardVersion = version;
    }
    refreshReads();
  };

  socket.on('connect', onConnect);
  socket.on('draft:state', onDraftState);
  const offReconnect = onReconnect(socket, resync);

  return () => {
    socket.off?.('connect', onConnect);
    socket.off?.('draft:state', onDraftState);
    offReconnect?.();
  };
}
