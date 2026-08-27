import React, {
  useId, useLayoutEffect, useRef, useState,
} from 'react';
import {
  Box, IconButton, Menu, MenuItem, Tooltip,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

/**
 * An accessible Unicode emoji picker for the League chat composer (#443, parent
 * #429). It is deliberately small: a trigger button opens a menu of a curated
 * set of common emoji, and choosing one hands the raw Unicode string back to the
 * caller through `onSelect`. It inserts nothing and sends nothing itself - the
 * composer decides where the character lands (at the caret) and the emoji then
 * rides the ordinary text path for send, persistence, history and the character
 * limit (#429: emoji is portable text, not a separate message type).
 *
 * Accessibility is the whole point of the ticket, so (with the #488 follow-up
 * from the #483 review folded in):
 *  - the trigger carries a stable accessible name ("Insert emoji") and now
 *    announces whether the menu is open (aria-expanded) and which list it
 *    controls (aria-controls), matching DraftRail and MatchupExtras;
 *  - each emoji is a `menuitem` whose accessible name is REAL, visually hidden
 *    text (not just an aria-label), because MUI's MenuList matches typeahead on
 *    an item's text, so "f" jumps to "fire"; the glyph is decorative;
 *  - the palette is a plain vertical menu, so the arrow keys a screen reader is
 *    told to use (ArrowUp/ArrowDown) actually walk every item one at a time. It
 *    was a wrapped 2-D grid before, which announced "vertical menu" yet moved
 *    focus sideways and left the last item 22 presses away by the wrong axis;
 *  - the menu is MUI's, so it traps focus, and it opens with focus on the first
 *    item;
 *  - focus return is predictable: choosing an emoji hands focus back to the
 *    composer (the caller moves it there via onChoiceClosed as it inserts) or,
 *    when no such callback is supplied, back to the trigger so focus is never
 *    stranded on the body; dismissing the menu returns focus to the trigger.
 *
 * No reactions, custom emoji or stickers are introduced (#443): this is a fixed
 * palette of standard Unicode characters and nothing more.
 */

// A short, curated palette. Each name is the item's accessible name and its
// typeahead text (#488), so they are plain, unique enough to type toward, and
// house-style clean (no em-dashes). The football nods to the product without
// changing that these are ordinary Unicode characters.
export const EMOJI_CHOICES = [
  { char: '\u{1F600}', name: 'grinning face' },
  { char: '\u{1F604}', name: 'grinning face with smiling eyes' },
  { char: '\u{1F602}', name: 'face with tears of joy' },
  { char: '\u{1F642}', name: 'slightly smiling face' },
  { char: '\u{1F609}', name: 'winking face' },
  { char: '\u{1F60A}', name: 'smiling face with smiling eyes' },
  { char: '\u{1F60D}', name: 'smiling face with heart eyes' },
  { char: '\u{1F60E}', name: 'smiling face with sunglasses' },
  { char: '\u{1F914}', name: 'thinking face' },
  { char: '\u{1F62E}', name: 'face with open mouth' },
  { char: '\u{1F622}', name: 'crying face' },
  { char: '\u{1F62D}', name: 'loudly crying face' },
  { char: '\u{1F621}', name: 'pouting face' },
  { char: '\u{1F44D}', name: 'thumbs up' },
  { char: '\u{1F44E}', name: 'thumbs down' },
  { char: '\u{1F44F}', name: 'clapping hands' },
  { char: '\u{1F64C}', name: 'raising hands' },
  { char: '\u{1F64F}', name: 'folded hands' },
  { char: '\u{1F4AA}', name: 'flexed biceps' },
  { char: '\u{1F525}', name: 'fire' },
  { char: '\u{1F389}', name: 'party popper' },
  { char: '❤️', name: 'red heart' },
  { char: '\u{1F3C8}', name: 'american football' },
];

function EmojiPicker({ onSelect, onChoiceClosed = null }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const triggerRef = useRef(null);
  // The Popover's imperative handle, used to reposition on open (see below).
  const popoverActionRef = useRef(null);
  // A stable id for the menu list, so the trigger's aria-controls can name it.
  const menuListId = useId();
  // Which close path we are on, read in onExited once the menu has fully closed.
  // Returning focus only then keeps it from fighting the menu's focus trap and
  // unmount: a choice hands focus to the composer, a dismissal to the trigger.
  const closeReasonRef = useRef(null); // 'choice' | 'dismiss' | null
  const open = Boolean(anchorEl);

  const handleOpen = (event) => setAnchorEl(event.currentTarget);

  // A choice: report the Unicode and close. Focus goes to the composer (not the
  // trigger) once the menu is gone, so the manager keeps typing.
  const handleChoose = (char) => {
    closeReasonRef.current = 'choice';
    onSelect(char);
    setAnchorEl(null);
  };

  // A dismissal (Escape, click-away): close, then return focus to the trigger
  // the user opened the picker from.
  const handleClose = () => {
    closeReasonRef.current = 'dismiss';
    setAnchorEl(null);
  };

  // Runs after the close transition finishes and the menu list is unmounted, so
  // moving focus here is not overridden by the menu tearing down. On a choice
  // the consumer's onChoiceClosed moves focus to the composer; with no such
  // callback (#488) we fall back to the trigger rather than stranding focus on
  // the body, since disableRestoreFocus means MUI will not restore it for us.
  //
  // Known limitation, left as-is on purpose (#488 out of scope): on iOS, moving
  // focus programmatically does not raise the soft keyboard, so a composer that
  // regains focus here will not reopen the keyboard until the user taps. We do
  // not work around it; it is not observable in the e2e runner.
  const handleExited = () => {
    const reason = closeReasonRef.current;
    closeReasonRef.current = null;
    if (reason === 'choice') {
      if (onChoiceClosed) onChoiceClosed();
      else triggerRef.current?.focus();
    } else if (reason === 'dismiss') {
      triggerRef.current?.focus();
    }
  };

  // #488: our TransitionProps.onExited replaces Popover's own onExited, whose
  // job was to reset the internal "isPositioned" flag so a reopened menu is
  // hidden until it has been placed against its anchor. Without that reset a
  // reopen can paint one frame at the previous position. The review asked to
  // "chain rather than replace", but Popover's onExited is a private internal
  // handler with no public hook to chain onto, so we take the equivalent path
  // that MUI does expose: reposition through Popover's `action` ref in a layout
  // effect (before the browser paints) on every open. That places the menu at
  // the correct anchor whatever the stale flag says, closing the same gap.
  useLayoutEffect(() => {
    if (open) popoverActionRef.current?.updatePosition();
  }, [open]);

  return (
    <>
      <Tooltip title="Insert emoji">
        <IconButton
          ref={triggerRef}
          aria-label="Insert emoji"
          aria-haspopup="menu"
          // The trigger announces its state (#488): expanded tracks open, and
          // aria-controls names the live menu list only while it exists.
          aria-expanded={open}
          aria-controls={open ? menuListId : undefined}
          onClick={handleOpen}
          sx={MIN_TOUCH_TARGET_SX}
        >
          <EmojiEmotionsOutlinedIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        action={popoverActionRef}
        // The composer claims focus on a choice, so MUI must not also try to
        // restore it to the trigger; dismissal restores focus explicitly above.
        disableRestoreFocus
        TransitionProps={{ onExited: handleExited }}
        // A plain vertical menu (#488): no flex-wrap grid, so ArrowUp/ArrowDown
        // walk the palette one item at a time exactly as a menu is announced to.
        MenuListProps={{ id: menuListId, 'aria-label': 'Emoji' }}
      >
        {EMOJI_CHOICES.map(({ char, name }) => (
          <MenuItem
            key={name}
            onClick={() => handleChoose(char)}
            // The menu items are the real tap targets in the palette, so they
            // carry the shared 44x44 minimum (src/lib/a11y.js) rather than a
            // hand-rolled width that omits the height.
            sx={{ fontSize: '1.25rem', justifyContent: 'center', ...MIN_TOUCH_TARGET_SX }}
          >
            {/* #488: the name is real text (visually hidden), not just an
                aria-label. It is the item's accessible name AND what MUI's
                MenuList typeahead matches on, and it comes first so the item's
                text STARTS with the name (typeahead is a startsWith match). The
                glyph follows and is decorative. */}
            <Box component="span" sx={visuallyHidden}>{name}</Box>
            <span aria-hidden="true">{char}</span>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default EmojiPicker;
