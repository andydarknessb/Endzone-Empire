import React from 'react';
import useLeagueChat from '../ChatPanel/useLeagueChat';
import ChatConversation from '../ChatPanel/ChatConversation';

/**
 * League chat as it appears inside the Draft room (issue #433). Named for the
 * room it renders in, not for a conversation of its own: it is the SAME League
 * chat managers see on the Dashboard (CONTEXT.md: League chat, which lists
 * "Draft chat" among the terms to avoid precisely because it is not a separate
 * conversation), brought here over the draft room's own authenticated session.
 * `draft:join` already put that socket in the `league:${id}` room chat
 * broadcasts to, so this rides it rather than opening a second connection
 * (acceptance criterion 3).
 *
 * It therefore takes the session and the viewer's own Team ID as props - both
 * owned by useDraftSocket, the one place the draft:join acknowledgement is read
 * - and never creates, joins or disconnects a socket itself. Chat is always
 * visible here, so it opens `open`: there is no unread badge to keep, and
 * messages are marked read as they arrive.
 *
 * Draft activity (start, each Pick, pause, correction) is a separate record and
 * a separate feed (CONTEXT.md: Draft activity; ADR 0012); this is chat alone.
 */
function DraftRoomChat({ socket, leagueId, viewerTeamId = null }) {
  const { messages, error, sendMessage } = useLeagueChat({
    socket,
    leagueId,
    open: true,
    viewerTeamId,
  });

  return <ChatConversation messages={messages} error={error} onSend={sendMessage} />;
}

export default DraftRoomChat;
