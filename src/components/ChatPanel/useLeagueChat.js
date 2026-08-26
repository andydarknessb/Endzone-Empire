import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { onReconnect } from '../../api/socket';

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
export default function useLeagueChat({ socket, leagueId, open = true, viewerTeamId = null }) {
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(null);

  // Refs mirror the state the long-lived socket handler needs: it is bound
  // once per (socket, league), and reading a stale `open` or viewer Team ID
  // from its closure would count messages wrong after the drawer toggles or
  // the join ack lands.
  const openRef = useRef(open);
  const viewerTeamIdRef = useRef(viewerTeamId);

  // These three are fire-and-forget over the REST client. `Promise.resolve`
  // wraps every call so the chat never throws on the client's return value:
  // a mocked or stubbed client can hand back undefined, and `open` chat marks
  // read the instant it mounts (the Draft room, where it is always visible),
  // so an unguarded `.catch`/`.then` on a non-thenable would surface as an
  // uncaught render error rather than a swallowed no-op.
  const fetchHistory = useCallback(() => {
    Promise.resolve(apiClient.get(`/api/league/${leagueId}/chat`))
      .then((res) => setMessages(Array.isArray(res?.data) ? res.data : []))
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
      setMessages((prev) => [...prev, data]);
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

    socket.on('chat:message', onChatMessage);

    // On reconnect the socket's OWNER re-joins the room; this hook's job is to
    // re-sync the conversation over REST so anything sent while offline appears.
    const offReconnect = onReconnect(socket, () => {
      fetchHistory();
      fetchUnread();
    });

    return () => {
      offReconnect?.();
      // The hook owns this listener, not the socket, so it must take it back:
      // on the shared Draft session the socket outlives this hook (a tab
      // switch unmounts the chat while the draft connection stays), and a
      // listener left behind would keep appending after unmount.
      socket.off?.('chat:message', onChatMessage);
    };
  }, [socket, fetchHistory, fetchUnread, markRead]);

  const sendMessage = useCallback(
    (raw) => {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) return Promise.resolve(false);
      setError(null);
      return new Promise((resolve) => {
        if (!socket) {
          resolve(false);
          return;
        }
        socket.emit('chat:send', { leagueId: Number(leagueId), message: trimmed }, (ack) => {
          if (ack && ack.error) {
            setError(ack.error);
            resolve(false);
            return;
          }
          resolve(true);
        });
      });
    },
    [socket, leagueId]
  );

  return { messages, unread, error, sendMessage };
}
