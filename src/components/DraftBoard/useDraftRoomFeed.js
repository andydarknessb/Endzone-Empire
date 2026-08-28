import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { onReconnect } from '../../api/socket';
import { feedEntryKey } from '../../lib/teamIdentity';
import { newClientMsgId } from '../../lib/clientMessageId';
import { applyHiddenEntry, hidePost } from '../../lib/chatModeration';
import { chatSendAckRevokesMembership, feedErrorRevokesMembership } from './draftMembership';

/**
 * The Draft room's combined feed: League chat and Draft activity in one order
 * (#435, ADR 0012). It is the Draft-room counterpart to useLeagueChat, over a
 * socket the caller already owns (the draft room's single draft:join session,
 * already in the `league:${id}` room). The League Dashboard drawer stays
 * chat-only on useLeagueChat; only here are the two kinds presented together.
 *
 * Every entry - a `league_chat` message or a `draft_activity` Pick - carries the
 * shared per-league `seq`, so the feed is kept in one deterministic order by
 * that sequence for every client and every reconnect (#435 AC4): live entries
 * are merged into their seq position and de-duplicated by seq (a client's own
 * broadcast echo arrives with the same seq it read back), and a reconnect
 * re-syncs the whole feed over REST.
 *
 * Chat is always visible in the draft room, so a human message that arrives is
 * marked read at once, keeping the Dashboard's unread badge honest (only human
 * messages ever count as unread; Draft activity never does).
 *
 * This hook NEVER creates, joins or disconnects a socket; it only listens over
 * the connection handed in, sends chat, and cleans up its own listeners.
 */
const FEED_PAGE = 100;

// Merge one live entry into the feed in its `seq` position, de-duplicated. An
// entry already present (the sender's own echo, or a reconnect overlap) is left
// as-is rather than doubled. feedEntryKey (the same key ChatConversation renders
// with) is the identity, so the dedup and the React keys cannot drift.
function mergeEntry(entries, incoming) {
  const key = feedEntryKey(incoming);
  if (entries.some((e) => feedEntryKey(e) === key)) return entries;
  const next = [...entries, incoming];
  // Order by the shared sequence; entries without a seq keep insertion order at
  // the end (defensive - live entries always carry one).
  next.sort((a, b) => {
    if (a.seq == null) return 1;
    if (b.seq == null) return -1;
    return a.seq - b.seq;
  });
  return next;
}

export default function useDraftRoomFeed({
  socket, leagueId, viewerTeamId = null, onMembershipRevoked = null,
}) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const entriesRef = useRef([]);
  const viewerTeamIdRef = useRef(viewerTeamId);
  // The room owns the membership state; this hook only reports the two channels
  // that can end it (#534 AC4). Held in a ref so the long-lived socket listeners
  // and the memoised callbacks below call the current one without re-subscribing.
  const onMembershipRevokedRef = useRef(onMembershipRevoked);

  useEffect(() => {
    viewerTeamIdRef.current = viewerTeamId;
  }, [viewerTeamId]);
  useEffect(() => {
    onMembershipRevokedRef.current = onMembershipRevoked;
  }, [onMembershipRevoked]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // One place every combined-feed read routes its failure through (#534). A 403
  // from the member-only feed is authoritative: membership ended, so tell the
  // room, which collapses chat to the non-member surface without a reload (AC4).
  // Anything else - a drop, a 500, a timeout - is transient: PRESERVE membership
  // and surface a neutral error so the reader knows the feed is momentarily
  // unavailable (AC5). Matched on the status code, never on message text.
  const handleFeedError = useCallback((err) => {
    if (feedErrorRevokesMembership(err)) {
      onMembershipRevokedRef.current?.();
      return;
    }
    setError('League chat could not be loaded right now.');
  }, []);

  const fetchHistory = useCallback(() => {
    Promise.resolve(apiClient.get(`/api/league/${leagueId}/draft-feed`))
      .then((res) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setEntries(rows);
        setHasMore(rows.length >= FEED_PAGE);
      })
      .catch(handleFeedError);
  }, [leagueId, handleFeedError]);

  // Page back through the combined feed by the oldest held `seq`, prepend deduped.
  const loadOlder = useCallback(() => {
    const current = entriesRef.current;
    const oldest = current[0];
    if (!oldest || oldest.seq == null) return Promise.resolve();
    return Promise.resolve(apiClient.get(`/api/league/${leagueId}/draft-feed?before=${oldest.seq}`))
      .then((res) => {
        const older = Array.isArray(res?.data) ? res.data : [];
        setEntries((prev) => {
          const known = new Set(prev.map(feedEntryKey));
          const fresh = older.filter((e) => !known.has(feedEntryKey(e)));
          return [...fresh, ...prev];
        });
        setHasMore(older.length >= FEED_PAGE);
      })
      .catch(handleFeedError);
  }, [leagueId, handleFeedError]);

  const markRead = useCallback(() => {
    Promise.resolve(apiClient.post(`/api/league/${leagueId}/chat/read`)).catch(() => {});
  }, [leagueId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!socket) return undefined;

    const onChatMessage = (data) => {
      setEntries((prev) => mergeEntry(prev, data));
      // The draft room shows chat live, so reading it clears its unread marker.
      markRead();
    };

    // A commissioner hid a message: rewrite the held chat entry with its neutral
    // tombstone in place (#482), through the one rewrite the Dashboard drawer
    // shares (chatModeration.applyHiddenEntry). Same seq, so the combined feed's
    // order and pagination are untouched; a Pick that shares the chat id is left
    // alone, and an id the feed never held is ignored. The unread badge is not
    // re-derived here - the draft room carries none, and a hide is not new
    // correspondence in any case.
    const onChatHidden = (data) => {
      setEntries((prev) => applyHiddenEntry(prev, data));
    };

    // A committed Pick rides on draft:picked as a typed activity entry beside
    // the board update; the feed appends it (the board consumer ignores it).
    const onPicked = (data) => {
      if (data && data.activity) setEntries((prev) => mergeEntry(prev, data.activity));
    };

    // The rest of the Draft lifecycle - start, pause, resume, reset, completion
    // (#437) - arrives on its own draft:activity event as a typed entry, merged
    // into its shared-sequence position like any other. It is never a human
    // message, so it does not mark chat read or touch the unread badge.
    const onActivity = (entry) => {
      if (entry) setEntries((prev) => mergeEntry(prev, entry));
    };

    socket.on('chat:message', onChatMessage);
    socket.on('chat:hidden', onChatHidden);
    socket.on('draft:picked', onPicked);
    socket.on('draft:activity', onActivity);

    // Reconnect RESUMES from the last acknowledged cursor (#442): the max seq
    // held is what the client last saw, so it asks only for entries newer than
    // it and merges them into their seq position, reproducing the one shared
    // order without refetching the whole feed. Nothing held yet means no cursor
    // to resume from, so it falls back to a full latest-page read.
    const offReconnect = onReconnect(socket, () => {
      const seqs = entriesRef.current
        .map((e) => (e ? e.seq : null))
        .filter((s) => Number.isFinite(s));
      if (seqs.length === 0) {
        fetchHistory();
        return;
      }
      const lastSeq = Math.max(...seqs);
      Promise.resolve(apiClient.get(`/api/league/${leagueId}/draft-feed?after=${lastSeq}`))
        .then((res) => {
          const newer = Array.isArray(res?.data) ? res.data : [];
          if (newer.length === 0) return;
          if (newer.length >= FEED_PAGE) {
            // More than a page accrued while offline: a single resume page would
            // leave the newest entries unfetched. Snap to the latest window
            // instead; the gap behind it is reachable through loadOlder.
            fetchHistory();
            return;
          }
          setEntries((prev) => newer.reduce((acc, entry) => mergeEntry(acc, entry), prev));
          // The draft room shows chat live; a resumed human message keeps the
          // unread badge honest, the same as a live arrival.
          markRead();
        })
        .catch(handleFeedError);
    });

    return () => {
      offReconnect?.();
      socket.off?.('chat:message', onChatMessage);
      socket.off?.('chat:hidden', onChatHidden);
      socket.off?.('draft:picked', onPicked);
      socket.off?.('draft:activity', onActivity);
    };
  }, [socket, leagueId, fetchHistory, markRead, handleFeedError]);

  const sendMessage = useCallback(
    (raw, clientMsgId) => {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) return Promise.resolve(false);
      setError(null);
      return new Promise((resolve) => {
        if (!socket) {
          resolve(false);
          return;
        }
        // Same send contract as the Dashboard chat (useLeagueChat, #440): the
        // compose box owns a stable idempotency key so a retry of the SAME text
        // collapses server-side instead of duplicating; a direct caller that
        // passes none still gets per-call idempotency.
        const key = typeof clientMsgId === 'string' && clientMsgId ? clientMsgId : newClientMsgId();
        socket.emit('chat:send', { leagueId: Number(leagueId), message: trimmed, clientMsgId: key }, (ack) => {
          if (ack && ack.error) {
            // AC4: the server re-validates the author's Team on every send, and a
            // NOT_A_MEMBER refusal means a confirmed member was removed mid-draft.
            // It is authoritative (matched on the code, never the text), so hand
            // it to the room, which collapses chat to the non-member surface - no
            // composer error to show, because the composer is going away.
            if (chatSendAckRevokesMembership(ack)) {
              onMembershipRevokedRef.current?.();
              resolve(false);
              return;
            }
            // A rate-limited refusal carries an explicit retry time (#440 AC5);
            // surface it so the sender knows to wait. The text stays in the
            // composer (cleared only on success), so nothing is dropped.
            const seconds = Number(ack.retryAfterSeconds);
            setError(Number.isFinite(seconds) && seconds > 0
              ? `${ack.error}. Try again in ${seconds}s.`
              : ack.error);
            resolve(false);
            return;
          }
          // On a duplicate ack (a retry the server already stored), the original
          // entry rides back; merge it in its seq position so a client that
          // missed the first broadcast still shows it, deduped like any entry.
          if (ack && ack.entry) setEntries((prev) => mergeEntry(prev, ack.entry));
          resolve(true);
        });
      });
    },
    [socket, leagueId]
  );

  // Send a GIF message from the Draft room (#516). It mirrors useLeagueChat's
  // sendGif exactly - the same chat:send event, the same structured gif payload
  // (a provider + assetId + accessible description + optional caption, never a
  // URL, upload or bytes), the same #440 idempotency key, and the same refusal
  // codes surfaced through the ONE error channel this hook already owns. Only the
  // reconciliation differs by surface: the combined feed dedups by the shared
  // `seq` through mergeEntry (feedEntryKey), exactly as sendMessage above does,
  // so the ack's returned entry and the server's broadcast echo of that same send
  // collapse to ONE entry - the sender never sees their own GIF twice.
  //
  // The description-required, media-not-allowed and disabled-provider rules are
  // enforced SERVER-side (DESCRIPTION_REQUIRED, MEDIA_NOT_ALLOWED,
  // GIF_PROVIDER_DISABLED); a client that never rendered the picker can still
  // emit, so this client mirror is a convenience, not the guarantee. On every
  // refusal the send resolves false and rewrites nothing, so the composer keeps
  // the unsent description and caption (the GifComposer resets only on success).
  const sendGif = useCallback(
    (gif, clientMsgId) => {
      if (!gif || !gif.provider || !gif.assetId) return Promise.resolve(false);
      setError(null);
      return new Promise((resolve) => {
        if (!socket) {
          resolve(false);
          return;
        }
        const key = typeof clientMsgId === 'string' && clientMsgId ? clientMsgId : newClientMsgId();
        socket.emit('chat:send', { leagueId: Number(leagueId), gif, clientMsgId: key }, (ack) => {
          if (ack && ack.error) {
            // AC4, the same as sendMessage: a NOT_A_MEMBER refusal is the author
            // being removed mid-draft, authoritative and matched on the code. Hand
            // it to the room to collapse chat, ahead of any composer-error copy.
            if (chatSendAckRevokesMembership(ack)) {
              onMembershipRevokedRef.current?.();
              resolve(false);
              return;
            }
            // An over-length caption is never shortened server-side, so the
            // sender's own numbers - not the ack's generic text - say how far
            // over they are. The composition stays put either way (resolve
            // false; the composer clears only on success), so nothing is lost.
            if (ack.code === 'MESSAGE_TOO_LONG') {
              const { length, limit } = ack;
              setError(Number.isFinite(length) && Number.isFinite(limit)
                ? `Your caption is ${length} characters. The limit is ${limit}. Shorten it and send again.`
                : ack.error);
              resolve(false);
              return;
            }
            if (ack.code === 'DESCRIPTION_REQUIRED') {
              setError('A GIF needs an accessible description before it can be sent.');
              resolve(false);
              return;
            }
            if (ack.code === 'MEDIA_NOT_ALLOWED') {
              setError('That GIF could not be sent: only a provider GIF is allowed, not a link or an upload.');
              resolve(false);
              return;
            }
            if (ack.code === 'GIF_PROVIDER_DISABLED') {
              setError('GIF messages are not available right now.');
              resolve(false);
              return;
            }
            // A rate-limited refusal carries an explicit retry time (#440 AC5);
            // surface it so the sender knows to wait. The composition stays.
            const seconds = Number(ack.retryAfterSeconds);
            setError(Number.isFinite(seconds) && seconds > 0
              ? `${ack.error}. Try again in ${seconds}s.`
              : ack.error);
            resolve(false);
            return;
          }
          // On success (or a duplicate ack that rides the original entry back),
          // merge the entry into its seq position; mergeEntry dedups on
          // feedEntryKey, so the broadcast echo of this same send - which shares
          // the entry's seq - is never appended a second time.
          if (ack && ack.entry) setEntries((prev) => mergeEntry(prev, ack.entry));
          resolve(true);
        });
      });
    },
    [socket, leagueId]
  );

  // Commissioner-only: hide one abusive message league-wide with a reason
  // (#482), through the one hide REST call the Dashboard drawer shares
  // (chatModeration.hidePost) so the audit row and the `chat:hidden` broadcast
  // are identical whichever surface acted. The live tombstone every member sees,
  // this actor included, arrives back on the broadcast above, so a success here
  // does not optimistically rewrite state. Resolves false on a rejected hide so
  // the presenter can keep its reason form open.
  const hideMessage = useCallback(
    (messageId, reason) => {
      setError(null);
      return hidePost({ leagueId, messageId, reason }).then((res) => {
        if (!res.ok) setError(res.error);
        return res.ok;
      });
    },
    [leagueId]
  );

  return { entries, error, sendMessage, sendGif, loadOlder, hasMore, hideMessage };
}
