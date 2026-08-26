import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { onReconnect } from '../../api/socket';
import { newClientMsgId } from '../../lib/clientMessageId';

/**
 * The League chat conversation over a socket the caller already owns.
 *
 * League chat is one conversation shown wherever managers gather, the League
 * Dashboard and the Draft room alike (CONTEXT.md: League chat), so its data
 * behaviour - history, live append, unread, sending, and re-sync on reconnect
 * - is one thing, factored out of the surface that draws it. The caller hands
 * in the connection: the Dashboard's own `league:join` socket, or the Draft
 * room's single `draft:join` session, which is already in the same
 * `league:${id}` room and so already carries chat (issue #433 acceptance
 * criterion 3). This hook therefore NEVER creates, joins or disconnects a
 * socket; it only listens, sends and cleans up its own listener.
 *
 * An author is a Team and never an account (#114, parent #108):
 *  - messages are attributed by `teamName` (a departed author reads back null,
 *    which the surface renders as a former manager);
 *  - "is this mine" is `message.teamId === viewerTeamId`, and `viewerTeamId` is
 *    handed in from the per-viewer join acknowledgement the socket's owner
 *    holds, because a broadcast `chat:message` carries no viewer-relative field.
 */
// One feed read returns at most this many entries (server FEED_PAGE_SIZE). A
// read that comes back full is the signal there may be more to page back to;
// a short read is the end of the conversation. Kept in step with the server by
// value, the way the client Team-identity fields mirror the server's.
const CHAT_PAGE = 100;

// The one feed kind that is human correspondence. Mirrors the server's
// leagueFeed.LEAGUE_CHAT by value (a client module cannot import server code),
// and useLeagueChat.humanType.parity.test.js pins the two equal so a rename on
// either side is a test failure rather than a silent miscount.
export const HUMAN_MESSAGE_TYPE = 'league_chat';

// Whether a feed entry is a HUMAN League-chat message, the only kind the unread
// badge counts (#442; spec #429: "Count unread human messages only"). The live
// broadcast tags a message `type: 'league_chat'` (leagueFeed.feedEntryOf), so
// that is a human message; a legacy row with no type predates the tag and is
// also human (the default is human on purpose: failing closed there would
// under-count real messages). Draft activity, the cutover boundary and
// moderation tombstones carry their own types and are correspondence to no one,
// so they never count. The invariant the default leans on - every typed path
// tags, so untyped means legacy - is what the parity test guards.
function isHumanMessage(entry) {
  return !entry || entry.type == null || entry.type === HUMAN_MESSAGE_TYPE;
}

export default function useLeagueChat({ socket, leagueId, open = true, viewerTeamId = null }) {
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(null);
  // Whether an older page may exist behind the oldest entry currently held.
  const [hasMore, setHasMore] = useState(false);

  // Refs mirror the state the long-lived socket handler needs: it is bound
  // once per (socket, league), and reading a stale `open` or viewer Team ID
  // from its closure would count messages wrong after the drawer toggles or
  // the join ack lands.
  const openRef = useRef(open);
  const viewerTeamIdRef = useRef(viewerTeamId);
  // The current messages, for loadOlder to read the oldest seq to page from
  // without being re-created on every append.
  const messagesRef = useRef([]);

  // These three are fire-and-forget over the REST client. `Promise.resolve`
  // wraps every call so the chat never throws on the client's return value:
  // a mocked or stubbed client can hand back undefined, and `open` chat marks
  // read the instant it mounts (the Draft room, where it is always visible),
  // so an unguarded `.catch`/`.then` on a non-thenable would surface as an
  // uncaught render error rather than a swallowed no-op.
  const fetchHistory = useCallback(() => {
    Promise.resolve(apiClient.get(`/api/league/${leagueId}/chat`))
      .then((res) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setMessages(rows);
        // A full latest page means there is probably history behind it.
        setHasMore(rows.length >= CHAT_PAGE);
      })
      .catch(() => {});
  }, [leagueId]);

  // Page back through the conversation: fetch the entries just older than the
  // oldest one currently held, keyed by its `seq` cursor, and prepend them.
  // A no-op when nothing is loaded yet, or when the oldest entry has no seq
  // (an old client shape) to page from.
  const loadOlder = useCallback(() => {
    const current = messagesRef.current;
    const oldest = current[0];
    if (!oldest || oldest.seq == null) return Promise.resolve();
    return Promise.resolve(apiClient.get(`/api/league/${leagueId}/chat?before=${oldest.seq}`))
      .then((res) => {
        const older = Array.isArray(res?.data) ? res.data : [];
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const fresh = older.filter((m) => !known.has(m.id));
          return [...fresh, ...prev];
        });
        setHasMore(older.length >= CHAT_PAGE);
      })
      .catch(() => {});
  }, [leagueId]);

  // Server-persisted unread count (the badge survives reloads). Only meaningful
  // while closed - opening resets it via markRead below.
  const fetchUnread = useCallback(() => {
    if (openRef.current) return;
    Promise.resolve(apiClient.get(`/api/league/${leagueId}/chat/unread`))
      .then((res) => {
        const count = Number(res && res.data && res.data.unread);
        if (Number.isFinite(count) && !openRef.current) setUnread(count);
      })
      .catch(() => {});
  }, [leagueId]);

  const markRead = useCallback(() => {
    Promise.resolve(apiClient.post(`/api/league/${leagueId}/chat/read`)).catch(() => {});
  }, [leagueId]);

  useEffect(() => {
    viewerTeamIdRef.current = viewerTeamId;
  }, [viewerTeamId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Initial load for this league. Independent of the socket: history is REST,
  // and it must be there whether or not a live connection has arrived yet.
  useEffect(() => {
    fetchHistory();
    fetchUnread();
  }, [fetchHistory, fetchUnread]);

  // Opening the surface reads everything currently in it.
  useEffect(() => {
    openRef.current = open;
    if (open) {
      setUnread(0);
      markRead();
    }
  }, [open, markRead]);

  useEffect(() => {
    if (!socket) return undefined;

    const onChatMessage = (data) => {
      // Idempotent append: the same entry can reach the client twice - a live
      // broadcast and then a reconnect history refetch that re-includes it (#440)
      // - so an entry already held is never appended or counted again.
      if (data && messagesRef.current.some((m) => m.id === data.id)) return;
      setMessages((prev) => [...prev, data]);
      // Only human League chat is correspondence: Draft activity, the cutover
      // boundary and moderation tombstones appear in the feed but never move the
      // read marker or the unread badge (#442).
      if (!isHumanMessage(data)) return;
      if (openRef.current) {
        // Reading live: keep the server-side marker current so a later reload
        // doesn't resurrect these as unread.
        markRead();
      } else if (viewerTeamIdRef.current == null || data.teamId !== viewerTeamIdRef.current) {
        // The viewer's own broadcast echo is recognised by Team, because the
        // broadcast carries no viewer-relative field. The null guard is the
        // #188 two-nulls-match trap: a departed author (teamId null) seen
        // before the viewer's own Team is known (viewerTeamId null) must still
        // count, not be swallowed as an echo.
        setUnread((count) => count + 1);
      }
    };

    // A commissioner hid a message: replace the held entry with its neutral
    // tombstone in place (#441). Same id, so ordering and pagination are
    // untouched; the content is dropped and `hidden` flips true, which is what
    // the surface renders as "Message hidden by commissioner". An entry the
    // client never held is ignored - there is nothing on screen to tombstone,
    // and a later history read returns it already tombstoned.
    const onChatHidden = (data) => {
      if (!data || data.id == null) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.id ? { ...m, ...data, hidden: true, message: null } : m))
      );
    };

    socket.on('chat:message', onChatMessage);
    socket.on('chat:hidden', onChatHidden);

    // On reconnect the socket's OWNER re-joins the room; this hook's job is to
    // re-sync the conversation over REST so anything sent while offline appears.
    // It RESUMES from the last acknowledged cursor (#442): the max seq held is
    // what the client last saw, so it asks only for entries newer than it and
    // appends them, reproducing the same seq order without refetching the whole
    // conversation. With nothing held yet there is no cursor, so it falls back
    // to a full latest-page read (the first-load path).
    const offReconnect = onReconnect(socket, () => {
      const seqs = messagesRef.current
        .map((m) => (m ? m.seq : null))
        .filter((s) => Number.isFinite(s));
      if (seqs.length === 0) {
        fetchHistory();
      } else {
        const lastSeq = Math.max(...seqs);
        Promise.resolve(apiClient.get(`/api/league/${leagueId}/chat?after=${lastSeq}`))
          .then((res) => {
            const newer = Array.isArray(res?.data) ? res.data : [];
            if (newer.length === 0) return;
            if (newer.length >= CHAT_PAGE) {
              // More than a page accrued while offline: a single resume page
              // would leave the newest entries unfetched. Snap to the latest
              // window instead; the gap behind it is reachable through loadOlder.
              fetchHistory();
              return;
            }
            setMessages((prev) => {
              const known = new Set(prev.map((m) => m.id));
              const fresh = newer.filter((m) => !known.has(m.id));
              return fresh.length ? [...prev, ...fresh] : prev;
            });
            // Resumed entries are visible if the surface is open; keep the read
            // marker honest, the same as a live arrival while open.
            if (openRef.current) markRead();
          })
          .catch(() => {});
      }
      fetchUnread();
    });

    return () => {
      offReconnect?.();
      // The hook owns this listener, not the socket, so it must take it back:
      // on the shared Draft session the socket outlives this hook (a tab
      // switch unmounts the chat while the draft connection stays), and a
      // listener left behind would keep appending after unmount.
      socket.off?.('chat:message', onChatMessage);
      socket.off?.('chat:hidden', onChatHidden);
    };
  }, [socket, leagueId, fetchHistory, fetchUnread, markRead]);

  // Commissioner-only: hide one abusive message league-wide with a reason
  // (#441, AC2). REST over the moderation surface (safety.router), not the
  // socket: the live tombstone every member sees, this actor included, arrives
  // back on the `chat:hidden` broadcast above, so a success here does not
  // optimistically rewrite state - the broadcast is the single source of the
  // tombstone. Resolves false on a rejected hide (a member calling it, a bad
  // reason) so the caller can keep the reason form open.
  const hideMessage = useCallback(
    (messageId, reason) => {
      const trimmed = typeof reason === 'string' ? reason.trim() : '';
      setError(null);
      return Promise.resolve(
        apiClient.post('/api/safety/hide', { leagueId: Number(leagueId), messageId, reason: trimmed })
      )
        .then(() => true)
        .catch((err) => {
          const serverError = err?.response?.data?.error;
          setError(serverError || 'failed to hide message');
          return false;
        });
    },
    [leagueId]
  );

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
        // The caller (the compose box) owns the key so it stays stable across a
        // retry of the SAME message; a direct caller that passes none still gets
        // idempotency, just per-call. See ChatConversation for the stable-key
        // ownership and src/lib/clientMessageId.
        const key = typeof clientMsgId === 'string' && clientMsgId ? clientMsgId : newClientMsgId();
        socket.emit('chat:send', { leagueId: Number(leagueId), message: trimmed, clientMsgId: key }, (ack) => {
          if (ack && ack.error) {
            // A rate-limited refusal carries an explicit retry time (#440 AC5);
            // surface it so the sender knows to wait rather than assuming their
            // message vanished. The text stays in the composer either way -
            // the presenter clears it only on success - so nothing is dropped.
            const seconds = Number(ack.retryAfterSeconds);
            setError(Number.isFinite(seconds) && seconds > 0
              ? `${ack.error}. Try again in ${seconds}s.`
              : ack.error);
            resolve(false);
            return;
          }
          // On a duplicate ack (a retry the server already stored), the original
          // entry rides back so a client that missed the first broadcast can
          // still show it; append only if it is not already held.
          if (ack && ack.entry && !messagesRef.current.some((m) => m.id === ack.entry.id)) {
            setMessages((prev) => [...prev, ack.entry]);
          }
          resolve(true);
        });
      });
    },
    [socket, leagueId]
  );

  return { messages, unread, error, sendMessage, hideMessage, loadOlder, hasMore };
}
