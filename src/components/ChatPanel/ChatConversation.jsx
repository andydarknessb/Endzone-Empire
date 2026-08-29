import React, { useId, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Paper, Typography, Box, TextField, Button, Alert, InputAdornment } from '@mui/material';
import { teamNameLabel, feedEntryKey } from '../../lib/teamIdentity';
import { newClientMsgId } from '../../lib/clientMessageId';
import useComposerDraft from './useComposerDraft';
import EmojiPicker from './EmojiPicker';
import ComposerCharacterCount from './ComposerCharacterCount';
import GifMessage from './GifMessage';
import GifComposer from './GifComposer';
// The Draft-activity event line is shared with the anonymous presenter feed
// (DraftBoard/DraftActivityEntry, #438), so a member and a presenter render the
// same entry the same way; it lives outside this chat component on purpose.
import DraftActivityEntry from '../DraftBoard/DraftActivityEntry';

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
  // The GIF-message capability (#446), off by default so any surface that does
  // not pass it renders no GIF picker at all (AC7). `gifEnabled` comes from the
  // server via the league-join ack; `onSendGif` sends the composed GIF payload.
  gifEnabled = false,
  onSendGif = null,
  fillHeight = false,
}) {
  // The composer draft is preserved (#442 AC5/AC6, extended by #524): scoped per
  // league and account, cleared on send, logout or account change. The hook owns
  // BOTH the message text and the GIF composition so the two composers behave
  // alike across an unmount; they clear independently, so clearDraft (a text
  // send) leaves a half-composed GIF in place and clearGif (a GIF send) leaves
  // the typed message in place.
  const [text, setText, clearDraft, gif, setGif] = useComposerDraft({ leagueId, userId: viewerUserId });
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
  //
  // Focus management for the inline hide form (#445 AC4). Opening the form moves
  // focus into the reason field (its autoFocus). Closing it must never drop
  // focus onto the document body, and the two close paths need DIFFERENT targets:
  //  - CANCEL: the message is not hidden, so its Hide button remounts; return
  //    focus there.
  //  - A COMMITTED HIDE: the `chat:hidden` broadcast sets m.hidden and the Hide
  //    button is no longer rendered (see the render guard below), so returning to
  //    it would strand focus on a removed node - the original defect. Return
  //    focus to the message ROW instead, which is always rendered (it shows the
  //    tombstone once hidden) and so always exists.
  // CANCEL returns focus to the Hide button as it remounts (the message is not
  // hidden), through an inline ref callback that focuses itself when it matches a
  // pending id - the button is a fresh node on remount, so the callback fires.
  const pendingHideButtonRef = useRef(null);
  const hideButtonRef = (id) => (node) => {
    if (node && pendingHideButtonRef.current === id) {
      pendingHideButtonRef.current = null;
      node.focus();
    }
  };

  // A COMMITTED hide cannot return focus to the Hide button - the chat:hidden
  // broadcast sets m.hidden and the button is no longer rendered, so aiming there
  // strands focus on the document body (the original defect). Return focus to the
  // feed LOG region instead, which is always mounted and holds the now-tombstoned
  // message, so a keyboard or screen-reader user lands back in the conversation
  // rather than on the body. A committed hide bumps this nonce; the layout effect
  // moves focus once the form has closed and the DOM has settled (a plain focus
  // call in confirmHide would land before the reason field unmounts and be undone
  // when the browser moves focus to the body on that unmount).
  const [committedHideNonce, setCommittedHideNonce] = useState(0);

  const closeHideForm = () => {
    setHidingId(null);
    setHideReason('');
  };
  const startHiding = (id) => {
    setHidingId(id);
    setHideReason('');
  };
  const cancelHiding = () => {
    // Message stays visible: return focus to its Hide button as it remounts.
    pendingHideButtonRef.current = hidingId;
    closeHideForm();
  };
  const confirmHide = async (id) => {
    const reason = hideReason.trim();
    if (reason.length < HIDE_REASON_MIN) return;
    const ok = onHide ? await onHide(id, reason) : false;
    // On a rejected hide the form stays open (below), so leave focus where it is.
    if (ok !== false) {
      setCommittedHideNonce((n) => n + 1);
      closeHideForm();
    }
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

  // A committed hide moves focus to the feed log (#445 AC4): defined here, after
  // scrollRef, and keyed on the nonce confirmHide bumps so it runs once the form
  // has closed and the DOM has settled.
  //
  // The guard keys on the NONCE VALUE, not a first-run boolean (#528). A boolean
  // consumed on the first invoke cannot tell "this is the mount" from "this is a
  // re-invoke of the mount": under React.StrictMode, development double-invokes
  // every mount effect, so a consumed-once boolean falls through on the second
  // invoke and focuses the log on a PLAIN mount - stealing focus with no hide at
  // all, and (until #528) masking the Draft room's layout-flip focus rescue,
  // because focus then landed on the log with or without it. Re-arming such a
  // boolean in this effect's cleanup would be worse: a [committedHideNonce]
  // cleanup runs before EVERY re-execution, so it would re-arm on a real hide too
  // and cancel the very focus move AC4 needs. A ref holding the last handled
  // nonce is the shape that works both ways: it is unchanged across the
  // double-invoke (so mount and any spurious re-invoke no-op) yet differs across
  // a real hide (so focus fires exactly once per hide). Do not simplify this back
  // to a first-run flag.
  const lastHandledHideNonceRef = useRef(committedHideNonce);
  useLayoutEffect(() => {
    if (lastHandledHideNonceRef.current === committedHideNonce) return;
    lastHandledHideNonceRef.current = committedHideNonce;
    if (scrollRef.current) scrollRef.current.focus();
  }, [committedHideNonce]);

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

  // The "N new" affordance (#445 AC4 new-entry navigation): jumping to the
  // latest also moves focus into the log region, so a keyboard or screen-reader
  // user who activates it lands on the live content rather than staying on a
  // button that has just vanished. The plain auto-follow path (anchorToLatest,
  // above) must NOT move focus - it fires on every feed change while the reader
  // is already at the bottom - so this is a separate, gesture-only handler.
  const handleJumpToLatest = useCallback(() => {
    anchorToLatest();
    scrollRef.current?.focus();
  }, [anchorToLatest]);

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
    <Paper
      component="section"
      aria-labelledby={headingId}
      sx={{
        p: 2,
        mt: fillHeight ? 0 : 3,
        ...(fillHeight ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <Typography id={headingId} variant="h6" component="h2" sx={{ mb: 2 }}>
        League Chat
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* The feed is a named accessible log (#445 AC1): role="log" names the
          scrollback as a log for structure and navigation, and it is named by
          the visible "League Chat" heading (aria-labelledby, a real visible
          label rather than an aria-label on a generic box).

          aria-live is set to "off" DELIBERATELY. A log role's implicit live
          value is "polite", which would make assistive tech read every new
          entry's full rendered text (Team, message body, timestamp). That is
          both verbose and a SECOND voice competing with the Draft room's concise
          FeedAnnouncer (#445 AC2), which already summarises new arrivals from
          derived state. Announcement duty belongs to that one region, so the log
          itself stays silent and is read on demand. On the League Dashboard,
          which mounts this same conversation without a FeedAnnouncer, new
          messages were never announced before either, so nothing regresses.

          tabIndex=-1 lets the "N new" jump move focus here programmatically
          (handleJumpToLatest, AC4) without adding the log to the Tab order. */}
      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="chat-scroll"
        role="log"
        aria-labelledby={headingId}
        aria-live="off"
        tabIndex={-1}
        sx={{
          maxHeight: fillHeight ? 'none' : 320,
          overflowY: 'auto',
          mb: 1,
          ...(fillHeight ? { flex: '1 1 auto', minHeight: 0 } : {}),
        }}
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
                      // A GIF message (#446) carries a structured `media` object;
                      // its caption (m.message) renders inside the GifMessage
                      // bubble below, so the inline slot holds only a plain text
                      // message's body. A hidden GIF took the branch above:
                      // feedEntryOf suppresses media AND caption to the same
                      // tombstone as hidden text, so nothing GIF-shaped renders.
                      m.media ? null : m.message
                    )}
                  </Typography>
                  {/* A commissioner may hide a human message that is not already
                      hidden. Draft activity takes the branch above and never
                      reaches here, so nothing on this surface can hide it (AC6). */}
                  {moderating && !m.hidden && hidingId !== m.id && (
                    <Button
                      size="small"
                      color="warning"
                      ref={hideButtonRef(m.id)}
                      onClick={() => startHiding(m.id)}
                      aria-label={`Hide message from ${teamNameLabel(m.teamName)}`}
                    >
                      Hide
                    </Button>
                  )}
                </Box>
                {/* A GIF message renders its asset (or the unavailable tile)
                    below the Team-name line. A hidden GIF has media suppressed to
                    null (feedEntryOf), so this never renders for a tombstone. */}
                {!m.hidden && m.media && (
                  <GifMessage media={m.media} caption={m.message} />
                )}
                {moderating && hidingId === m.id && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, mb: 0.5 }}>
                    <TextField
                      label="Reason for hiding"
                      size="small"
                      fullWidth
                      // Focus moves into the reason field as the form opens
                      // (#445 AC4); on close it returns to the Hide button
                      // (Cancel) or the message row (a committed hide).
                      autoFocus
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
          <Button size="small" variant="outlined" onClick={handleJumpToLatest}>
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
      {/* The composer is a named group (#445 AC1): its three controls - the
          message field, Insert emoji and Send - read as one labelled unit. A
          group role takes an accessible name, unlike the generic role a bare box
          maps to, so aria-label is valid here. The name deliberately avoids the
          word "Message": Playwright's getByLabel is a substring match, so a group
          named "Message composer" would be a second match for the existing
          specs' getByLabel('Message') alongside the message input itself. */}
      <Box role="group" aria-label="Chat composer" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
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
              <InputAdornment position="end" disablePointerEvents data-testid="composer-counter-adornment">
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
      {/* The GIF compose affordance (#446), absent unless the capability is
          enabled (AC7); emoji and text above are unaffected. Its compose fields
          are the hook-owned, per-league preserved GIF composition (#524), so a
          half-composed GIF survives an unmount exactly as the text draft does
          and the panel reopens when a restored composition is non-empty. A
          successful GIF send (or a Cancel) clears only this slice through
          setGif, leaving the message draft above untouched.

          The key is the composer-draft identity (league + account). GifComposer
          keeps two pieces of purely local UI state that the hook does not own -
          the open/closed disclosure and the description touched flag - and it
          computes the panel's initial open state once, from the composition it
          mounts with. When the identity CHANGES IN PLACE (the hook re-seeds the
          composition to the new scope without an unmount), that local state would
          otherwise go stale: a previously-touched empty Description could show a
          validation error for content the new scope never had. Keying on the
          identity remounts the composer on that transition, so its open state is
          recomputed from the re-seeded composition and the touched flag resets -
          the same fresh start a real unmount gives it.

          When is an in-place identity change even reachable? Not on logout or an
          account switch: ProtectedRoute (App.jsx wraps both the Draft room and
          the Dashboard) swaps the whole subtree for the login page the instant
          the account id goes null, so this component unmounts rather than
          re-rendering with a null viewerUserId. The one path that keeps it
          mounted is a direct league-to-league navigation whose target league is
          already warm in the useLeague cache (FantasyOnly then skips its loader).
          The key covers that path; without it the residual is only cosmetic and
          capability-gated, but the key is a cheaper guarantee than the analysis. */}
      <GifComposer
        key={`${leagueId}:${viewerUserId}`}
        enabled={gifEnabled}
        onSendGif={onSendGif}
        composition={gif}
        onCompositionChange={setGif}
      />
    </Paper>
  );
}

export default ChatConversation;
