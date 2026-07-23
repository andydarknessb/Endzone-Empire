import React, { useState, useEffect, useRef } from 'react';
import { Paper, Typography, Box, TextField, Button, Alert } from '@mui/material';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';

function ChatPanel({ leagueId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  const fetchHistory = () => {
    apiClient
      .get(`/api/league/${leagueId}/chat`)
      .then((res) => setMessages(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchHistory();
    // fetchHistory closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    newSocket.emit('league:join', { leagueId: Number(leagueId) });

    newSocket.on('chat:message', (data) => {
      setMessages((prev) => [...prev, data]);
    });

    // On reconnect: re-join the room (server re-adds us) and re-fetch chat
    // history via REST so any messages sent while we were offline appear.
    const offReconnect = onReconnect(newSocket, () => {
      newSocket.emit('league:join', { leagueId: Number(leagueId) });
      fetchHistory();
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
