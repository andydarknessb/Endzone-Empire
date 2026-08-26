import React, { useId, useRef, useState } from 'react';
import { Paper, Typography, Box, TextField, Button, Alert, Chip } from '@mui/material';
import { teamNameLabel, feedEntryKey } from '../../lib/teamIdentity';
import { newClientMsgId } from '../../lib/clientMessageId';

// One committed Pick as Draft activity in the combined feed (#435). It is NOT
// drawn as a chat bubble: Draft activity is server-authored, never a manager
// message (ADR 0012), so it reads as an event line and is attributed by Team
// without pretending the Team "said" anything. The snapshot shows player,
// position, NFL team, round and overall Pick number so the event is
// understandable without leaving the feed; an autopick is labeled AUTO.
function DraftActivityEntry({ entry }) {
  const player = entry.player || {};
  // House style: middot separators, no em-dashes. Null facts are dropped
  // rather than printed as "null".
  const meta = [player.position, player.nflTeam, `Round ${entry.round}`, `Pick ${entry.pickNumber}`]
    .filter((part) => part != null && part !== '')
    .join(' · ');
  return (
    <Box sx={{ mb: 1 }} data-testid="draft-activity">
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        <strong>{teamNameLabel(entry.teamName)}</strong> drafted {player.name}
        {entry.isAutopick && (
          <Chip label="AUTO" size="small" sx={{ ml: 1 }} />
        )}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {meta} {'·'} {new Date(entry.created_at).toLocaleTimeString()}
      </Typography>
    </Box>
  );
}

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
function ChatConversation({ messages = [], error = null, onSend, hasMore = false, onLoadOlder = null }) {
  const [text, setText] = useState('');
  const headingId = useId();

  // The idempotency key for the message being composed (#440). It is stable for
  // one logical message: a retry of the SAME text (a rejected send left in the
  // box, or a second click before the first ack) reuses the key, so the server
  // collapses it onto one row instead of posting a duplicate. Editing the text
  // makes it a different message and mints a fresh key, so two distinct sends
  // can never collide on one key; a successful send clears both the box and the
  // key so the next message starts clean.
  const sendKeyRef = useRef({ text: null, key: null });

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (sendKeyRef.current.text !== trimmed) {
      sendKeyRef.current = { text: trimmed, key: newClientMsgId() };
    }
    const ok = await onSend(trimmed, sendKeyRef.current.key);
    // Clear only on success, so a rejected message stays in the box to retry
    // (under the same key). A cleared box starts the next message fresh.
    if (ok) {
      setText('');
      sendKeyRef.current = { text: null, key: null };
    }
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
        {hasMore && onLoadOlder && (
          <Box sx={{ textAlign: 'center', mb: 1 }}>
            <Button size="small" onClick={() => onLoadOlder()}>
              Load older messages
            </Button>
          </Box>
        )}
        {messages.length === 0 ? (
          <Typography sx={{ color: 'text.secondary' }}>No messages yet</Typography>
        ) : (
          messages.map((m) =>
            m.type === 'draft_activity' ? (
              <DraftActivityEntry key={feedEntryKey(m)} entry={m} />
            ) : (
              <Box key={feedEntryKey(m)} sx={{ mb: 1 }}>
                <Typography variant="body2">
                  <strong>{teamNameLabel(m.teamName)}</strong> {m.message}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {new Date(m.created_at).toLocaleTimeString()}
                </Typography>
              </Box>
            )
          )
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
