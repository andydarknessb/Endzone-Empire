import React, { useRef, useState } from 'react';
import { IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
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
 * Accessibility is the whole point of the ticket, so:
 *  - the trigger carries a stable accessible name ("Insert emoji");
 *  - each emoji is a `menuitem` named by a short human label, never a bare glyph
 *    a screen reader would have to guess at, and the glyph is decorative;
 *  - the menu is MUI's, so it traps focus and is arrow-key and typeahead
 *    operable, and it is opened with focus moving into the first item;
 *  - focus return is predictable: choosing an emoji hands focus back to the
 *    composer (the caller moves it there as it inserts), while dismissing the
 *    menu returns focus to the trigger the user opened it from.
 *
 * No reactions, custom emoji or stickers are introduced (#443): this is a fixed
 * palette of standard Unicode characters and nothing more.
 */

// A short, curated palette. Names are the accessible labels, so they are plain
// and house-style clean (no em-dashes). The football nods to the product without
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
  // moving focus here is not overridden by the menu tearing down.
  const handleExited = () => {
    const reason = closeReasonRef.current;
    closeReasonRef.current = null;
    if (reason === 'choice') {
      onChoiceClosed?.();
    } else if (reason === 'dismiss') {
      triggerRef.current?.focus();
    }
  };

  return (
    <>
      <Tooltip title="Insert emoji">
        <IconButton
          ref={triggerRef}
          aria-label="Insert emoji"
          aria-haspopup="menu"
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
        // The composer claims focus on a choice, so MUI must not also try to
        // restore it to the trigger; dismissal restores focus explicitly above.
        disableRestoreFocus
        TransitionProps={{ onExited: handleExited }}
        MenuListProps={{ 'aria-label': 'Emoji', sx: { display: 'flex', flexWrap: 'wrap', maxWidth: 320 } }}
      >
        {EMOJI_CHOICES.map(({ char, name }) => (
          <MenuItem
            key={name}
            aria-label={name}
            onClick={() => handleChoose(char)}
            sx={{ fontSize: '1.25rem', minWidth: 44, justifyContent: 'center' }}
          >
            {/* The glyph is decorative; the accessible name is the label above. */}
            <span aria-hidden="true">{char}</span>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default EmojiPicker;
