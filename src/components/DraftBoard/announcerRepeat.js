/**
 * The one repeat-safe update every Draft-room polite announcer shares (#636).
 * Extracted here at the THIRD consumer exactly as the first two said to: the
 * combined-feed announcer (FeedAnnouncer, #445) and the room-level Pick
 * announcer (PickAnnouncer, #513) each spoke this same two-line idiom inline,
 * and BOTH docblocks read "extract a shared helper at three copies, not two".
 * StallAnnouncer (#636) is that third copy, so the idiom moves here and all
 * three call it.
 *
 * THE PROBLEM IT SOLVES. Two DIFFERENT announcements can describe identically -
 * two messages from one Team ("New message from <Team>"), two autodrafts of a
 * same-named player, two stalls on one Team with the same cause. React bails on
 * an Object.is-equal state, so re-setting a byte-identical string leaves the
 * live region's text node untouched and a screen reader silent on the second.
 * Appending a zero-width space (U+200B) when the new text would EXACTLY repeat
 * the CURRENTLY RENDERED announcement changes the node value while adding
 * nothing visible or spoken, so the repeat is announced.
 *
 * WHY `prev`, NOT A COUNTER. The comparison is against the rendered value (the
 * functional setState `prev`), never a separate last-text ref or a parity
 * counter. That is what keeps it correct across ANY interleaving such as
 * A, A, B, B: a different announcement landing between two repeat-pairs cannot
 * desync from what is on screen, because there is no counter to desync (#518
 * fixed exactly that parity-flip desync in FeedAnnouncer before this was
 * shared). Callers therefore MUST pass the functional-update `prev`:
 * `setAnnouncement((prev) => nextAnnouncement(prev, text))`.
 *
 * The marker is built from its code point so no invisible literal sits in
 * source; the announcer tests pin it as U+200B exactly.
 */
export const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * The next live-region text given what is CURRENTLY RENDERED (`prev`) and the
 * text to announce: the text as-is, or with a zero-width space appended when it
 * would exactly repeat `prev` so the node value still changes and the repeat is
 * spoken.
 */
export function nextAnnouncement(prev, text) {
  return prev === text ? text + ZERO_WIDTH_SPACE : text;
}
