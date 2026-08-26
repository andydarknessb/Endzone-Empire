import React from 'react';
import { useSelector } from 'react-redux';
import useDraftRoomFeed from './useDraftRoomFeed';
import ChatConversation from '../ChatPanel/ChatConversation';

/**
 * The Draft room's combined feed (issue #435, ADR 0012): the SAME League chat
 * managers see on the Dashboard, now interleaved with authoritative Draft
 * activity - each committed Pick appears as an event line beside the
 * conversation, in one order the whole room shares. It rides the draft room's
 * own authenticated session: `draft:join` already put that socket in the
 * `league:${id}` room chat and pick broadcasts reach, so this opens no second
 * connection (issue #433).
 *
 * League chat and Draft activity remain SEPARATE records (ADR 0012); this
 * component only PRESENTS them together, through useDraftRoomFeed. It takes the
 * session and the viewer's own Team ID as props - both owned by useDraftSocket,
 * the one place the draft:join acknowledgement is read - and never creates,
 * joins or disconnects a socket itself.
 *
 * Full Pick history still lives in the Draft board; this feed shows recent Pick
 * activity, it does not replace the board (#435 AC5, CONTEXT.md: Draft board).
 */
function DraftRoomChat({ socket, leagueId, viewerTeamId = null }) {
  const { entries, error, sendMessage, loadOlder, hasMore } = useDraftRoomFeed({
    socket,
    leagueId,
    viewerTeamId,
  });
  // The account scopes the composer draft (#442 AC5/AC6); Team identity stays
  // the actor on the wire, the account id never leaves the client.
  const viewerUserId = useSelector((store) => (store.user && store.user.id != null ? store.user.id : null));

  return (
    <ChatConversation
      messages={entries}
      error={error}
      onSend={sendMessage}
      hasMore={hasMore}
      onLoadOlder={loadOlder}
      leagueId={leagueId}
      viewerUserId={viewerUserId}
    />
  );
}

export default DraftRoomChat;
