import React from 'react';
import { Link } from '@mui/material';

/**
 * A player's name rendered as an accessible, link-styled button that opens the
 * PlayerQuickView dialog. Deliberately a real <button> (not a nav Link) with
 * stopPropagation so a click can never bubble to a row/Draft handler — in the
 * draft room the name is a separate click target from the Draft/Queue buttons.
 */
function PlayerNameLink({ name, playerId, onOpen, sx }) {
  return (
    <Link
      component="button"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(playerId);
      }}
      sx={{
        color: 'primary.main',
        font: 'inherit',
        textTransform: 'none',
        textAlign: 'left',
        px: 0,
        // Reused inline in running prose on other pages (TransactionLog,
        // TradeCenter, WaiverWire, LineupScreen, ...), so the base size stays
        // small here; callers that need a 44px target (the Draft route's
        // dense rows) pass `sx={MIN_TOUCH_TARGET_SX}` explicitly instead of
        // this component growing every inline use of it app-wide.
        minWidth: 24,
        minHeight: 24,
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'pointer',
        verticalAlign: 'baseline',
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
        // MUI's `Link component="button"` bakes in its own
        // `outline: 0` plus a `&.MuiLink-focusVisible { outline: 'auto' }`
        // rule (see @mui/material/Link/Link.js) - that beats base.css's
        // global `:focus-visible` rule, so without an explicit override here
        // this control would show the browser's bare default ring (or none)
        // instead of the shared --focus-ring token every other control uses.
        // Reference the same CSS variable base.css and DraftBoardMatrix's
        // custom-button cells use, rather than a theme color, so it's the
        // exact same value, not just a similar one.
        '&:focus-visible': {
          outline: '2px solid var(--focus-ring)',
          outlineOffset: 2,
          borderRadius: 0.5,
        },
        ...sx,
      }}
    >
      {name}
    </Link>
  );
}

export default PlayerNameLink;
