import apiClient from '../api/apiClient';

// The one League-chat kind that is human correspondence, tagged on the wire by
// leagueFeed.feedEntryOf. Mirrors HUMAN_MESSAGE_TYPE in useLeagueChat by value
// (a client module cannot import server code); Draft activity carries its own
// `draft_activity` type. Kept here so the tombstone rewrite below can tell a
// chat entry from a Pick that happens to share its id (the two come from
// separate stores and their ids can collide, feedEntryKey's docstring).
const LEAGUE_CHAT_TYPE = 'league_chat';

// Whether a combined-feed entry is a League-chat message (the only kind a
// chat:hidden broadcast may tombstone). A legacy entry with no type predates the
// tag and is chat too - the Dashboard drawer holds only chat, so an untyped
// entry there is always a message. A `draft_activity` Pick is never chat.
function isChatEntry(entry) {
  return !entry || entry.type == null || entry.type === LEAGUE_CHAT_TYPE;
}

/**
 * Apply one `chat:hidden` broadcast to a feed, live-tombstoning the held chat
 * message with that id in place (#441 in the drawer, #482 in the Draft room).
 * The one function both useLeagueChat and useDraftRoomFeed call, so the two
 * cannot carry drifting copies of the rewrite.
 *
 * The entry keeps its position and its `seq`, so ordering, pagination and the
 * combined feed's React keys are untouched; only its content is dropped and
 * `hidden` flips true, which is what the shared presenter renders as the neutral
 * "Message hidden by commissioner" tombstone. A broadcast for an id the feed
 * never held changes nothing - there is nothing on screen to tombstone, and a
 * later history read returns it already tombstoned. In the Draft room's combined
 * feed a Pick can share a chat id, so only chat entries are eligible: a
 * `chat:hidden` never rewrites Draft activity.
 */
export function applyHiddenEntry(entries, data) {
  if (!data || data.id == null) return entries;
  return entries.map((entry) =>
    isChatEntry(entry) && entry.id === data.id
      ? { ...entry, ...data, hidden: true, message: null }
      : entry
  );
}

/**
 * Hide one abusive message league-wide with a reason, over the moderation
 * surface (safety.router, #441 AC2). The single hide REST call both the
 * Dashboard drawer and the Draft room route through, so the audit row and the
 * `chat:hidden` broadcast are identical whichever surface a commissioner acted
 * from. REST, not the socket: the live tombstone every member sees, this actor
 * included, arrives back on the `chat:hidden` broadcast, so a success here does
 * NOT optimistically rewrite state.
 *
 * Resolves `{ ok: true }` on success, or `{ ok: false, error }` on a rejected
 * hide (a member calling it, a bad reason), so the caller can surface the reason
 * and keep its reason form open. Never rejects.
 */
export function hidePost({ leagueId, messageId, reason }) {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  return Promise.resolve(
    apiClient.post('/api/safety/hide', { leagueId: Number(leagueId), messageId, reason: trimmed })
  )
    .then(() => ({ ok: true }))
    .catch((err) => ({ ok: false, error: err?.response?.data?.error || 'failed to hide message' }));
}
