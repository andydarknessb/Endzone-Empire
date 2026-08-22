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
        minWidth: 24,
        minHeight: 24,
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'pointer',
        verticalAlign: 'baseline',
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
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
