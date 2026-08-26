import React, { useState, useEffect } from 'react';
import { createDraftSocket, onReconnect } from '../../api/socket';
import useLeagueChat from './useLeagueChat';
import ChatConversation from './ChatConversation';

/**
 * League chat on the League Dashboard, with unread tracking. The panel stays
 * mounted (and its socket connected) inside a persistent drawer even while the
 * drawer is closed, so it is the natural owner of the unread count:
 *  - closed + someone else's message arrives -> unread goes up
 *  - open (or opening) -> the server-side read marker moves to now and the
 *    count resets, so the badge survives reloads without ever double-counting
 * The parent renders the badge from onUnreadChange.
 *
 * The Dashboard has no live Draft session of its own, so this panel owns the
 * one connection chat rides here: it creates the socket, does `league:join`,
 * and re-joins on reconnect. The viewer's own Team ID arrives on that join
 * acknowledgement - the panel's only per-viewer channel, since a broadcast
 * `chat:message` carries no viewer-relative field (#112, parent #108) - and is
 * handed to useLeagueChat, which owns the conversation itself. The Draft room
 * reuses that same hook over its existing draft:join session instead of a
 * second connection (issue #433); the two surfaces share the conversation, not
 * the socket ownership.
 */
function ChatPanel({ leagueId, open = true, onUnreadChange = null }) {
  const [socket, setSocket] = useState(null);
  const [viewerTeamId, setViewerTeamId] = useState(null);

  useEffect(() => {
    // A fresh Team ID per league room: nothing can match a stale one, but
    // leaving it standing would briefly claim a Team for a league just left.
    setViewerTeamId(null);
    const newSocket = createDraftSocket();
    setSocket(newSocket);

    // The ack is the panel's only per-viewer channel, so it is where the
    // viewer's own Team ID arrives. Re-answered on every join, including the
    // reconnect one, so a rejoin cannot leave a stale answer behind.
    const joinLeagueRoom = () => {
      newSocket.emit('league:join', { leagueId: Number(leagueId) }, (ack) => {
        setViewerTeamId(ack && ack.viewerTeamId != null ? ack.viewerTeamId : null);
      });
    };

    joinLeagueRoom();

    // On reconnect the room re-adds us; useLeagueChat re-syncs history and
    // unread over REST for messages missed while offline.
    const offReconnect = onReconnect(newSocket, joinLeagueRoom);

    return () => {
      offReconnect?.(); // reconnect listener lives on the manager, which outlives the socket
      newSocket.disconnect();
      setSocket(null);
    };
    // Rebuild the socket only when the league room changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const { messages, unread, error, sendMessage, loadOlder, hasMore } = useLeagueChat({
    socket,
    leagueId,
    open,
    viewerTeamId,
  });

  useEffect(() => {
    if (onUnreadChange) onUnreadChange(unread);
  }, [unread, onUnreadChange]);

  return (
    <ChatConversation
      messages={messages}
      error={error}
      onSend={sendMessage}
      hasMore={hasMore}
      onLoadOlder={loadOlder}
    />
  );
}

export default ChatPanel;
