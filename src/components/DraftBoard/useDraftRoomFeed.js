import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { onReconnect } from '../../api/socket';
import { feedEntryKey } from '../../lib/teamIdentity';
import { newClientMsgId } from '../../lib/clientMessageId';

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

export default function useDraftRoomFeed({ socket, leagueId, viewerTeamId = null }) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const entriesRef = useRef([]);
  const viewerTeamIdRef = useRef(viewerTeamId);

  useEffect(() => {
    viewerTeamIdRef.current = viewerTeamId;
  }, [viewerTeamId]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const fetchHistory = useCallback(() => {
    Promise.resolve(apiClient.get(`/api/league/${leagueId}/draft-feed`))
      .then((res) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setEntries(rows);
        setHasMore(rows.length >= FEED_PAGE);
      })
      .catch(() => {});
  }, [leagueId]);

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
      .catch(() => {});
  }, [leagueId]);

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

    // A committed Pick rides on draft:picked as a typed activity entry beside
    // the board update; the feed appends it (the board consumer ignores it).
    const onPicked = (data) => {
      if (data && data.activity) setEntries((prev) => mergeEntry(prev, data.activity));
    };

    socket.on('chat:message', onChatMessage);
    socket.on('draft:picked', onPicked);

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
        .catch(() => {});
    });

    return () => {
      offReconnect?.();
      socket.off?.('chat:message', onChatMessage);
      socket.off?.('draft:picked', onPicked);
    };
  }, [socket, leagueId, fetchHistory, markRead]);

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

  return { entries, error, sendMessage, loadOlder, hasMore };
}
