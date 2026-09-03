import { useCallback, useState } from 'react';

/**
 * The one repeat-safe update every Draft-room polite announcer that speaks
 * EVENTS shares (#791, folding announcerRepeat.js in): `useAnnouncement()`
 * returns `[announcement, announce]`, where `announce(text)` sets the next
 * live-region text against what is CURRENTLY RENDERED.
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
 * WHY THE COMPARISON IS AGAINST `prev`, NOT A COUNTER. The comparison is
 * against the rendered value (the functional setState `prev`), never a
 * separate last-text ref or a parity counter. That is what keeps it correct
 * across ANY interleaving such as A, A, B, B: a different announcement landing
 * between two repeat-pairs cannot desync from what is on screen, because there
 * is no counter to desync (#518 fixed exactly that parity-flip desync in
 * FeedAnnouncer before the idiom was shared as announcerRepeat.js). That is
 * also why `announce` is a stable callback closed only over `setAnnouncement`,
 * never over `announcement` itself - a caller that read the last stale
 * `announcement` value instead would reintroduce the same desync this hook
 * exists to prevent.
 *
 * CLEARING GOES THROUGH `announce` TOO. `announce('')` is how a caller clears
 * the region (StallAnnouncer's exit edge, FeedAnnouncer's hidden-arrival and
 * own-message cases). The empty string is exempted from the repeat check - it
 * always lands plain, never plus a zero-width space - because silence has
 * nothing for a screen reader to re-announce: two clears in a row (an exit
 * immediately following another, an own-message arriving while the region is
 * already silent) must leave the region genuinely empty, not an invisible
 * character masquerading as empty in every DOM assertion that checks for it.
 * There is no separate setter - a second, ungated way to write the text is
 * exactly the kind of shared surface ADR 0028 refused to grow beyond the leaf
 * and this idiom.
 *
 * WHAT STAYS PER-CALLER (ADR 0028). This hook is the two-line repeat idiom
 * ONLY. Whether an announcer is mounted, WHEN it fires, and its own clear path
 * stay in each announcer's own effect - PickAnnouncer, StallAnnouncer and
 * FeedAnnouncer each keep theirs. ReadinessAnnouncer and
 * DraftChatMembershipAnnouncer do not use this hook: their text is DERIVED from
 * props on every render, never repeated as a discrete event, so there is
 * nothing for a repeat-safe update to guard.
 *
 * The marker is built from its code point so no invisible literal sits in
 * source; the announcer tests pin it as U+200B exactly.
 */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

export function useAnnouncement() {
  const [announcement, setAnnouncement] = useState('');

  const announce = useCallback((text) => {
    setAnnouncement((prev) => (text !== '' && prev === text ? text + ZERO_WIDTH_SPACE : text));
  }, []);

  return [announcement, announce];
}

export default useAnnouncement;
