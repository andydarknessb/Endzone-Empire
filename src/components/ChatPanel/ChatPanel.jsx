import React, { useState, useEffect, useRef } from 'react';
import { Paper, Typography, Box, TextField, Button, Alert } from '@mui/material';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';

/**
 * League chat with unread tracking. The panel stays mounted (and its socket
 * connected) inside a persistent drawer even while the drawer is closed, so
 * it is the natural owner of the unread count:
 *  - closed + someone else's message arrives -> unread goes up
 *  - open (or opening) -> the server-side read marker moves to now and the
 *    count resets, so the badge survives reloads without ever double-counting
 * The parent renders the badge from onUnreadChange.
 */
function ChatPanel({ leagueId, open = true, currentUserId = null, onUnreadChange = null }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [unread, setUnread] = useState(0);
  const socketRef = useRef(null);
  // Refs mirror props the socket handler needs: the handler is bound once per
  // league, and reading stale `open`/`currentUserId` from its closure would
  // count messages wrong after the drawer toggles or the user finishes loading.
  const openRef = useRef(open);
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const fetchHistory = () => {
    apiClient
      .get(`/api/league/${leagueId}/chat`)
      .then((res) => setMessages(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  };

  // Server-persisted unread count (badge survives reloads). Only meaningful
  // while closed — opening resets it via markRead below.
  const fetchUnread = () => {
    if (openRef.current) return;
    apiClient
      .get(`/api/league/${leagueId}/chat/unread`)
      .then((res) => {
        const count = Number(res.data && res.data.unread);
        if (Number.isFinite(count) && !openRef.current) setUnread(count);
      })
      .catch(() => {});
  };

  const markRead = () => {
    apiClient.post(`/api/league/${leagueId}/chat/read`).catch(() => {});
  };

  useEffect(() => {
    if (onUnreadChange) onUnreadChange(unread);
  }, [unread, onUnreadChange]);

  useEffect(() => {
    fetchHistory();
    fetchUnread();
    // fetchHistory/fetchUnread close over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Opening the drawer reads everything currently in it.
  useEffect(() => {
    openRef.current = open;
    if (open) {
      setUnread(0);
      markRead();
    }
    // markRead closes over leagueId; open/leagueId are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leagueId]);

  useEffect(() => {
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    newSocket.emit('league:join', { leagueId: Number(leagueId) });

    newSocket.on('chat:message', (data) => {
      setMessages((prev) => [...prev, data]);
      if (openRef.current) {
        // Reading live: keep the server-side marker current so a later
        // reload doesn't resurrect these as unread.
        markRead();
      } else if (data.userId !== currentUserIdRef.current) {
        setUnread((count) => count + 1);
      }
    });

    // On reconnect: re-join the room (server re-adds us) and re-fetch chat
    // history via REST so any messages sent while we were offline appear.
    // The unread count re-syncs from the server for the same reason.
    const offReconnect = onReconnect(newSocket, () => {
      newSocket.emit('league:join', { leagueId: Number(leagueId) });
      fetchHistory();
      fetchUnread();
    });

    return () => {
      offReconnect?.(); // reconnect listener lives on the manager, which outlives the socket
      socketRef.current.disconnect();
      socketRef.current = null;
    };
    // Rebuild the socket only when the league room changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    socketRef.current.emit(
      'chat:send',
      { leagueId: Number(leagueId), message: trimmed },
      (ack) => {
        if (ack && ack.error) {
          setError(ack.error);
          return;
        }
        setText('');
      }
    );
  };

  return (
    <Paper sx={{ p: 2, mt: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        League Chat
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ maxHeight: 320, overflowY: 'auto', mb: 2 }}>
        {messages.length === 0 ? (
          <Typography sx={{ color: 'text.secondary' }}>No messages yet</Typography>
        ) : (
          messages.map((m) => (
            <Box key={m.id} sx={{ mb: 1 }}>
              <Typography variant="body2">
                <strong>{m.username}</strong> {m.message}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {new Date(m.created_at).toLocaleTimeString()}
              </Typography>
            </Box>
          ))
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <TextField
          id="chat-message-input"
          label="Message"
          size="small"
          fullWidth
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button variant="contained" onClick={handleSend} disabled={!text.trim()}>
          Send
        </Button>
      </Box>
    </Paper>
  );
}

export default ChatPanel;
