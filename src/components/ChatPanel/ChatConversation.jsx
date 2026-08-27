import React, { useId, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Paper, Typography, Box, TextField, Button, Alert, Chip, InputAdornment } from '@mui/material';
import { teamNameLabel, feedEntryKey } from '../../lib/teamIdentity';
import { newClientMsgId } from '../../lib/clientMessageId';
import useComposerDraft from './useComposerDraft';
import EmojiPicker from './EmojiPicker';
import ComposerCharacterCount from './ComposerCharacterCount';

// A hide reason is required and bounded the same as the server enforces
// (safety.router: 10..500 chars), so the Confirm control is disabled until the
// reason is long enough and the server never has to reject a well-formed click.
const HIDE_REASON_MIN = 10;
const HIDE_REASON_MAX = 500;

// The neutral tombstone a member sees in place of hidden content (#441, AC3).
// It names neither the reason nor the moderator - those reach authorized
// reviewers alone (AC4) and never ride on the feed entry.
const HIDDEN_TOMBSTONE = 'Message hidden by commissioner';

// The past-tense verb each Draft LIFECYCLE kind reads as (#437). A lifecycle
// event is attributed to the acting commissioner's Team ("<Team> started the
// draft") when one is present, or phrased as a plain state transition ("The
// draft is complete") when there is no actor - a scheduler start or a
// completion. Kept as data so a new kind is a one-line addition, not a new
// branch, and so the actor / actor-less split is made in one place.
const LIFECYCLE_VERB = {
  draft_start: 'started',
  pause: 'paused',
  resume: 'resumed',
  reset: 'reset',
};

// One committed Pick as Draft activity in the combined feed (#435). It is NOT
// drawn as a chat bubble: Draft activity is server-authored, never a manager
// message (ADR 0012), so it reads as an event line and is attributed by Team
// without pretending the Team "said" anything. The snapshot shows player,
// position, NFL team, round and overall Pick number so the event is
// understandable without leaving the feed; an autopick is labeled AUTO.
function PickActivityLine({ entry }) {
  const player = entry.player || {};
  // House style: middot separators, no em-dashes. Null facts are dropped
  // rather than printed as "null".
  const meta = [player.position, player.nflTeam, `Round ${entry.round}`, `Pick ${entry.pickNumber}`]
    .filter((part) => part != null && part !== '')
    .join(' · ');
  return (
    <>
      <Typography component="div" variant="body2" sx={{ color: 'text.secondary' }}>
        <strong>{teamNameLabel(entry.teamName)}</strong> drafted {player.name}
        {entry.isAutopick && (
          <Chip label="AUTO" size="small" sx={{ ml: 1 }} />
        )}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {meta} {'·'} {new Date(entry.created_at).toLocaleTimeString()}
      </Typography>
    </>
  );
}

// A Draft lifecycle event (start, pause, resume, reset, completion) as an event
// line (#437). Completion is always actor-less; the others carry the acting
// Team when one is recorded. A null Team means no actor (a scheduler start),
// NOT a departed manager - lifecycle actors are never fabricated and teams are
// only Removable pre-draft - so it reads as a plain transition, not "Former
// manager". It carries no Pick facts, so none are shown.
function LifecycleActivityLine({ entry }) {
  const verb = LIFECYCLE_VERB[entry.kind] || 'updated';
  const hasActor = entry.teamName != null;
  let text;
  if (entry.kind === 'complete') {
    // Completion is always an actor-less state transition (#437).
    text = <>The draft is complete</>;
  } else if (hasActor) {
    text = <><strong>{teamNameLabel(entry.teamName)}</strong> {verb} the draft</>;
  } else {
    // No actor: the scheduler auto-started it (draft_start). Phrase the
    // transition without a Team rather than as "Former manager".
    text = entry.kind === 'draft_start'
      ? <>The draft started</>
      : <>The draft was {verb}</>;
  }
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {text}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {new Date(entry.created_at).toLocaleTimeString()}
      </Typography>
    </>
  );
}

// Route a Draft-activity entry to the right event-line renderer by kind. A Pick
// shows its snapshot facts; every other kind is a lifecycle transition (#437).
function DraftActivityEntry({ entry }) {
  return (
    <Box sx={{ mb: 1 }} data-testid="draft-activity">
      {entry.kind === 'pick'
        ? <PickActivityLine entry={entry} />
        : <LifecycleActivityLine entry={entry} />}
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
 *
 * `leagueId` and `viewerUserId` are the composer-draft scope (#442 AC5/AC6):
 * unsent text is preserved per league for the browser session and cleared on
 * send, logout or account change. They are handed in (never read from a store
 * here) so this component stays purely prop-driven; the container that owns the
 * league room supplies them. With neither, the composer still works, it just
 * keeps no draft between mounts.
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
  leagueId = null,
  viewerUserId = null,
}) {
  // The composer text is a preserved draft (#442 AC5/AC6): scoped per league and
  // account, cleared on send, logout or account change. clearDraft empties both
  // the box and the stored draft on a successful send.
  const [text, setText, clearDraft] = useComposerDraft({ leagueId, userId: viewerUserId });
  // The message currently being hidden (its id), and the reason being typed for
  // it. Only one hide form is open at a time; opening another replaces it.
  const [hidingId, setHidingId] = useState(null);
  const [hideReason, setHideReason] = useState('');
  const headingId = useId();
  // Associates the visible character counter with the input (#486), so a screen
  // reader hears the count on focus without the counter being a live region.
  const countId = useId();

  // Moderation controls (#441): open a hide form for one message at a time,
  // cancel it, or confirm the hide. These read and write only hidingId /
  // hideReason - never the composer's `text` - so they sit beside the emoji
  // helpers below without contending for the composer draft state.
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

  // The composer input, so an emoji can be inserted at the caret (#443) rather
  // than only appended, and focus can be returned here after a choice.
  const inputRef = useRef(null);
  // Where the caret should sit after an insert, applied once the picker has
  // closed so returning focus does not fight the menu's focus trap.
  const pendingCaretRef = useRef(null);

  // Insert a chosen emoji as ordinary Unicode at the current selection (#443).
  // It becomes part of `text` and rides every existing path from there: send,
  // the preserved draft (owned by useComposerDraft, #442), history, reconnect
  // and the character limit all treat it as the plain text it is. It uses the
  // same `text`/`setText` as every other edit, so there is no second text path.
  // Choosing never sends.
  const insertEmoji = (emoji) => {
    const el = inputRef.current;
    const start = el && el.selectionStart != null ? el.selectionStart : text.length;
    const end = el && el.selectionEnd != null ? el.selectionEnd : text.length;
    pendingCaretRef.current = start + emoji.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
  };

  // Called after the picker menu has fully closed following a choice (#443):
  // return focus to the composer and place the caret just after the emoji, so
  // the manager keeps typing where they left off. By this point the new text is
  // in the input, so the caret index is valid.
  const returnFocusToComposer = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (pendingCaretRef.current != null) {
      const caret = pendingCaretRef.current;
      pendingCaretRef.current = null;
      el.setSelectionRange(caret, caret);
    }
  };

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
    // (under the same key). A cleared box starts the next message fresh and
    // discards the preserved draft (#442 AC6).
    if (ok) {
      clearDraft();
      sendKeyRef.current = { text: null, key: null };
    }
  };

  // #442 AC1/AC2: the live feed auto-follows ONLY while the reader is at the
  // bottom; a reader up in the backlog keeps their scroll position and gets an
  // N-new affordance to return to the newest entries. The scroll container is
  // the anchoring authority: `atBottomRef` records whether the last scroll left
  // the reader at the end, and `seenKeyRef` is the newest entry they have
  // actually seen. Unseen entries are the ones AFTER that key, so the count is
  // derived from current state on every render rather than accumulated, which
  // keeps it correct even if a render fires the effect twice.
  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const seenKeyRef = useRef(null);
  const didAnchorRef = useRef(false);
  // The scroll height and head entry as they were before the latest feed change,
  // so a prepend (Load older) can be told from an append and the reader's place
  // held across it (#442 AC2).
  const prevScrollHeightRef = useRef(0);
  const prevFirstKeyRef = useRef(null);
  const [newCount, setNewCount] = useState(0);

  const lastKey = messages.length ? feedEntryKey(messages[messages.length - 1]) : null;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const anchorToLatest = useCallback(() => {
    atBottomRef.current = true;
    seenKeyRef.current = messages.length ? feedEntryKey(messages[messages.length - 1]) : null;
    setNewCount(0);
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const unseenAfterSeen = useCallback(() => {
    const seen = seenKeyRef.current;
    if (seen == null) return 0;
    const idx = messages.findIndex((m) => feedEntryKey(m) === seen);
    // The seen entry has aged out (retention); do not invent a count.
    if (idx < 0) return 0;
    return messages.length - idx - 1;
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Within a small threshold of the end still counts as at the bottom.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
    atBottomRef.current = atBottom;
    // Keep the pre-change height fresh from the reader's latest scroll, so a
    // prepend that follows can measure exactly how much was added above.
    prevScrollHeightRef.current = el.scrollHeight;
    if (atBottom) {
      seenKeyRef.current = messages.length ? feedEntryKey(messages[messages.length - 1]) : null;
      setNewCount(0);
    }
  }, [messages]);

  // Hold the reader's place across a prepend (Load older, #442 AC2). Older
  // entries added at the HEAD grow the content above the viewport, which would
  // shove the reader's content down; before the browser paints, absorb exactly
  // the added height into scrollTop so what they were reading stays put. Runs in
  // a layout effect so the adjustment lands in the same frame as the new rows.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstKey = messages.length ? feedEntryKey(messages[0]) : null;
    const prepended = prevFirstKeyRef.current != null && firstKey !== prevFirstKeyRef.current;
    if (prepended && !atBottomRef.current) {
      const added = el.scrollHeight - prevScrollHeightRef.current;
      if (added > 0) el.scrollTop += added;
    }
    prevFirstKeyRef.current = firstKey;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages]);

  // Anchor to the newest entry once, when the first entries land.
  useEffect(() => {
    if (!didAnchorRef.current && messages.length) {
      didAnchorRef.current = true;
      anchorToLatest();
    }
  }, [messages.length, anchorToLatest]);

  // On each feed change: follow to the bottom if the reader is already there,
  // otherwise surface how many entries they have not seen. A change that only
  // prepends older entries (loadOlder) leaves the seen tail in place, so the
  // unseen count stays 0 and the reader's position is undisturbed.
  useEffect(() => {
    if (!didAnchorRef.current) return;
    if (atBottomRef.current) {
      anchorToLatest();
    } else {
      setNewCount(unseenAfterSeen());
    }
    // anchorToLatest / unseenAfterSeen change with `messages`; keying on the
    // tail entry and the length is what makes an append vs a prepend distinct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey, messages.length]);

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

      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="chat-scroll"
        sx={{ maxHeight: 320, overflowY: 'auto', mb: 1 }}
      >
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
          // Draft activity (#435) is server-authored and never a manager
          // message: it renders as an event line and is NEVER hideable (AC6) -
          // the hide affordance lives only on the chat branch below. Both kinds
          // share one combined-feed key (feedEntryKey), since chat ids and
          // Draft-activity ids can collide across the two stores.
          messages.map((m) =>
            m.type === 'draft_activity' ? (
              <DraftActivityEntry key={feedEntryKey(m)} entry={m} />
            ) : (
              <Box key={feedEntryKey(m)} sx={{ mb: 1 }}>
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
                      hidden. Draft activity takes the branch above and never
                      reaches here, so nothing on this surface can hide it (AC6). */}
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
            )
          )
        )}
      </Box>

      {newCount > 0 && (
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Button size="small" variant="outlined" onClick={anchorToLatest}>
            {newCount} new message{newCount === 1 ? '' : 's'}
          </Button>
        </Box>
      )}

      {/* The counter rides INSIDE the input as an end adornment, not on a row of
          its own (#486). The desktop Draft room sizes this shell to exactly the
          viewport with zero slack (draft-board.spec #122 AC1), and the message
          list above is empty here, so a second composer row - or any element
          that grows the composer's height - tips the shell past the viewport and
          makes the page scroll. An end adornment sits within the input's own
          height, so the composer adds no height at all. */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          id="chat-message-input"
          label="Message"
          size="small"
          fullWidth
          value={text}
          inputRef={inputRef}
          // Describe the input with the visible counter (#486) rather than set
          // maxLength: the server is the single enforcement point, so typing
          // and sending past the limit stay possible.
          //
          // NOTE: setting aria-describedby through inputProps overrides MUI's own
          // describedby channel, because InputBase spreads inputProps AFTER the
          // aria-describedby it would compute from helperText/error. That is
          // latent, not live, here: this field has neither, so there is nothing
          // for MUI to describe and nothing is lost. If a helperText or error is
          // ever added, merge its id in rather than letting this clobber it.
          inputProps={{ 'aria-describedby': countId }}
          // disablePointerEvents so a click on the counter strip falls through to
          // the input and places the caret (#486). Without it the adornment eats
          // the click - InputBase focuses only when the click target IS the input
          // root, and the adornment's spans are descendants - so the right edge
          // that used to be the input's own padding became a dead strip inside
          // the field's outline. The counter has no interactivity to lose.
          InputProps={{
            endAdornment: (
              <InputAdornment position="end" disablePointerEvents>
                <ComposerCharacterCount text={text} indicatorId={countId} />
              </InputAdornment>
            ),
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <EmojiPicker onSelect={insertEmoji} onChoiceClosed={returnFocusToComposer} />
        <Button variant="contained" onClick={handleSend} disabled={!text.trim()}>
          Send
        </Button>
      </Box>
    </Paper>
  );
}

export default ChatConversation;
