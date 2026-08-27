import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { pickAnnouncementFor } from './pickAnnouncement';

// A zero-width space (U+200B): appended to alternate announcements so that two
// different Picks whose text is byte-identical still change the live region's
// text node and are both announced. It is not rendered and not spoken. Built
// from its code point so no invisible literal sits in source.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * The Draft room's ROOM-LEVEL Pick announcer (#513): one persistent, visually
 * hidden polite region that speaks every live committed Pick, wherever the
 * manager is in the room. It follows the room's established idiom exactly -
 * ReadinessAnnouncer (#164), the combined-feed announcer (FeedAnnouncer, #445)
 * and ComposerCharacterCount (#486) all mount one permanently-present Box with
 * role="status" / aria-live="polite", styled visuallyHidden, and only change its
 * TEXT.
 *
 * WHY ROOM-LEVEL, AND WHY THAT IS DIFFERENT FROM CHAT. The combined-feed
 * announcer lives inside DraftRoomChat, so on a narrow container it is mounted
 * only while the Chat tab is selected. That is correct for human MESSAGES -
 * chat a manager cannot see should not be announced or marked read from another
 * tab - but wrong for PICKS: a sighted manager on the Players, Board or Draft
 * tab is watching Picks land in front of them, so an assistive-technology user
 * on the same tab must hear them too. This announcer therefore mounts in the
 * Draft room's chrome, above the tabs and present in both layouts, and speaks
 * Picks alone; the feed announcer no longer speaks Picks (feedAnnouncement.js),
 * so a Pick is announced exactly once even when Chat is mounted beside it.
 *
 * It is driven by the `pick` prop, the newest live committed Pick (the
 * `draft:picked` payload the room already routes through onPickLanded), or null
 * before any Pick has landed. Only a genuinely NEW Pick object re-fires it: the
 * effect keys on the prop's identity, so an ordinary rerender that hands the
 * same object back (a pool refetch, a clock tick) changes nothing and stays
 * silent. Initial Pick history never reaches here - it arrives on draft:state,
 * not draft:picked - so the room opening is not announced as a run of new Picks.
 *
 * TWO PICKS THAT DESCRIBE IDENTICALLY. Two consecutive autodrafts of a
 * same-named player by one Team read the same string. React bails on an
 * Object.is-equal state, so a byte-identical string would leave the region's
 * text node untouched and the second Pick silent. A zero-width space flips on
 * alternate announcements so the node value always changes; it is invisible and
 * unspoken.
 */
function PickAnnouncer({ pick = null }) {
  const [announcement, setAnnouncement] = useState('');
  // The last BASE announcement text (without any marker), and a flip used only
  // when a new announcement would repeat it (see below).
  const lastTextRef = useRef('');
  const nonceRef = useRef(0);

  useEffect(() => {
    if (!pick) return;
    const text = pickAnnouncementFor(pick);
    if (!text) return;
    // Only when the new text WOULD repeat the last announcement, append a
    // zero-width space that flips, so the node value changes and the repeat is
    // announced; the marker is invisible and unspoken. Distinct Picks stay clean.
    let out = text;
    if (text === lastTextRef.current) {
      nonceRef.current += 1;
      out = nonceRef.current % 2 ? text + ZERO_WIDTH_SPACE : text;
    }
    lastTextRef.current = text;
    setAnnouncement(out);
  }, [pick]);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

export default PickAnnouncer;
