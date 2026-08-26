import React, { useId, useState } from 'react';
import { Paper, Typography, Box, TextField, Button, Alert } from '@mui/material';
import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The visible half of League chat: the scrollback and the compose box. It is
 * the same conversation wherever managers gather (CONTEXT.md: League chat), so
 * one presenter draws it on both the League Dashboard and the Draft room, and
 * the data behaviour behind it lives in useLeagueChat. This component holds
 * only the draft text; everything else - messages, the send itself, the send
 * error - is handed in.
 *
 * An author is a Team, never an account (#114, parent #108): each row shows
 * `teamNameLabel(teamName)`, which names a departed author as a former manager
 * rather than printing a blank or the string "null".
 *
 * The heading is fixed to "League chat" - the one conversation on both
 * surfaces (CONTEXT.md: League chat) - rather than parameterized, so no caller
 * can retitle it to "Draft chat", the term the glossary tells the repo to
 * avoid. It is a level-2 heading in a named region, matching every other panel
 * in the surfaces this appears in, so it slots into their heading order without
 * skipping a level.
 */
function ChatConversation({ messages = [], error = null, onSend }) {
  const [text, setText] = useState('');
  const headingId = useId();

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const ok = await onSend(trimmed);
    // Clear only on success, so a rejected message stays in the box to retry.
    if (ok) setText('');
  };

  return (
    <Paper component="section" aria-labelledby={headingId} sx={{ p: 2, mt: 3 }}>
      <Typography id={headingId} variant="h6" component="h2" sx={{ mb: 2 }}>
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
                <strong>{teamNameLabel(m.teamName)}</strong> {m.message}
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

export default ChatConversation;
