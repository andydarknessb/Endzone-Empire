import React from 'react';
import { useSelector } from 'react-redux';
import useDraftRoomFeed from './useDraftRoomFeed';
import ChatConversation from '../ChatPanel/ChatConversation';
import FeedAnnouncer from './FeedAnnouncer';

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
 * `canModerate` is the room's commissioner status, answered on the same
 * draft:join ack useDraftSocket already reads (#482): a commissioner in the
 * Draft room may hide a message from here, with the same reason prompt and the
 * same audit path as the Dashboard drawer. It defaults off, so a member (or any
 * caller that does not pass it) sees no hide affordance. The hide itself rides
 * useDraftRoomFeed.hideMessage, which posts through the one shared moderation
 * route; Draft activity is never a manager message and the presenter never
 * offers a hide control on it.
 *
 * `gifEnabled` is the room's GIF-message capability (#516), answered on the same
 * draft:join ack useDraftSocket already reads (gifMessagesEnabled) and threaded
 * through DraftBoard. It defaults off, so a room whose server has not enabled the
 * capability (the production state) shows no GIF picker while text and emoji
 * composition stay complete (AC1). When on, the composer sends through
 * useDraftRoomFeed.sendGif, which mirrors useLeagueChat.sendGif over this same
 * shared session (payload, idempotency key, acknowledgement and reconciliation).
 * The picker itself (GifComposer, inside ChatConversation) is unchanged by this
 * surface; only the two props reach it.
 *
 * `onMembershipRevoked` is how a member removed mid-draft loses chat without a
 * reload (#534 AC4). This component mounts ONLY for a confirmed member (DraftBoard
 * gates it on the membership tri-state), so its mere presence issues the
 * combined-feed request a non-member must never send (#534 AC1). If the server
 * later reports the viewer's Team is gone - a NOT_A_MEMBER chat:send ack or a 403
 * from the member-only feed - useDraftRoomFeed calls this, and the room swaps in
 * its explicit non-member surface.
 *
 * Full Pick history still lives in the Draft board; this feed shows recent Pick
 * activity, it does not replace the board (#435 AC5, CONTEXT.md: Draft board).
 */
function DraftRoomChat({
  socket, leagueId, viewerTeamId = null, canModerate = false, gifEnabled = false, onMembershipRevoked = null,
}) {
  const { entries, error, sendMessage, sendGif, loadOlder, hasMore, hideMessage } = useDraftRoomFeed({
    socket,
    leagueId,
    viewerTeamId,
    // The two mid-draft revocation channels (#534 AC4): the feed hook watches a
    // NOT_A_MEMBER chat:send ack and a 403 from the member-only feed, and hands
    // the result up to the room, which unmounts this whole subtree in place.
    onMembershipRevoked,
  });
  // The account scopes the composer draft (#442 AC5/AC6); Team identity stays
  // the actor on the wire, the account id never leaves the client.
  const viewerUserId = useSelector((store) => (store.user && store.user.id != null ? store.user.id : null));

  return (
    <>
      {/* The combined-feed announcer (#445 AC2) lives here, beside the feed it
          describes, because this is where the entries are. It is scoped to the
          Draft room on purpose: the League Dashboard drawer draws the same
          ChatConversation but is chat-only and adds no announcer, so only the
          Draft room's combined feed speaks its arrivals. On a narrow container
          only the selected tab is mounted, so when the manager is not on the
          Chat tab this (and the feed hook) unmount; that matches what a sighted
          manager sees (chat is not on screen), and on return the backlog is
          re-seeded silently rather than replayed. */}
      <FeedAnnouncer entries={entries} viewerTeamId={viewerTeamId} />
      <ChatConversation
        messages={entries}
        error={error}
        onSend={sendMessage}
        hasMore={hasMore}
        onLoadOlder={loadOlder}
        canModerate={canModerate}
        onHide={hideMessage}
        leagueId={leagueId}
        viewerUserId={viewerUserId}
        gifEnabled={gifEnabled}
        onSendGif={sendGif}
        fillHeight
      />
    </>
  );
}

export default DraftRoomChat;
