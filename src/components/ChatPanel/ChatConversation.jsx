import React, { useId, useRef, useState } from 'react';
import { Paper, Typography, Box, TextField, Button, Alert } from '@mui/material';
import { teamNameLabel } from '../../lib/teamIdentity';
import { newClientMsgId } from '../../lib/clientMessageId';

// A hide reason is required and bounded the same as the server enforces
// (safety.router: 10..500 chars), so the Confirm control is disabled until the
// reason is long enough and the server never has to reject a well-formed click.
const HIDE_REASON_MIN = 10;
const HIDE_REASON_MAX = 500;

// The neutral tombstone a member sees in place of hidden content (#441, AC3).
// It names neither the reason nor the moderator - those reach authorized
// reviewers alone (AC4) and never ride on the feed entry.
const HIDDEN_TOMBSTONE = 'Message hidden by commissioner';

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
function ChatConversation({
  messages = [],
  error = null,
  onSend,
  hasMore = false,
  onLoadOlder = null,
  // A commissioner (or co-commissioner / platform admin) may hide human
  // messages; a member may not. Both default off so the surfaces that do not
  // pass them (and any older caller) render no moderation affordance at all.
  canModerate = false,
  onHide = null,
}) {
  const [text, setText] = useState('');
  // The message currently being hidden (its id), and the reason being typed for
  // it. Only one hide form is open at a time; opening another replaces it.
  const [hidingId, setHidingId] = useState(null);
  const [hideReason, setHideReason] = useState('');
  const headingId = useId();

  const startHiding = (id) => {
    setHidingId(id);
    setHideReason('');
  };
  const cancelHiding = () => {
    setHidingId(null);
    setHideReason('');
  };
  const confirmHide = async (id) => {
    const reason = hideReason.trim();
    if (reason.length < HIDE_REASON_MIN) return;
    const ok = onHide ? await onHide(id, reason) : false;
    // Clear the form whether or not the hide succeeded; a failure surfaces
    // through the shared error Alert, and the message stays visible until the
    // tombstone broadcast replaces it.
    if (ok !== false) cancelHiding();
  };
  const moderating = canModerate && typeof onHide === 'function';

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
          messages.map((m) => (
            <Box key={m.id} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  <strong>{teamNameLabel(m.teamName)}</strong>{' '}
                  {m.hidden ? (
                    <em style={{ color: 'inherit', opacity: 0.7 }}>{HIDDEN_TOMBSTONE}</em>
                  ) : (
                    m.message
                  )}
                </Typography>
                {/* A commissioner may hide a human message that is not already
                    hidden. Draft activity is a different feed and is never
                    rendered here, so nothing on this surface can hide it (AC6). */}
                {moderating && !m.hidden && hidingId !== m.id && (
                  <Button
                    size="small"
                    color="warning"
                    onClick={() => startHiding(m.id)}
                    aria-label={`Hide message from ${teamNameLabel(m.teamName)}`}
                  >
                    Hide
                  </Button>
                )}
              </Box>
              {moderating && hidingId === m.id && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, mb: 0.5 }}>
                  <TextField
                    label="Reason for hiding"
                    size="small"
                    fullWidth
                    value={hideReason}
                    onChange={(e) => setHideReason(e.target.value)}
                    inputProps={{ maxLength: HIDE_REASON_MAX }}
                    helperText={`${HIDE_REASON_MIN}-${HIDE_REASON_MAX} characters, kept for review`}
                  />
                  <Button
                    size="small"
                    variant="contained"
                    color="warning"
                    disabled={hideReason.trim().length < HIDE_REASON_MIN}
                    onClick={() => confirmHide(m.id)}
                  >
                    Confirm hide
                  </Button>
                  <Button size="small" onClick={cancelHiding}>
                    Cancel
                  </Button>
                </Box>
              )}
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
