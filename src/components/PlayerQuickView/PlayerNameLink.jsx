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
        p: 0,
        cursor: 'pointer',
        verticalAlign: 'baseline',
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
        ...sx,
      }}
    >
      {name}
    </Link>
  );
}

export default PlayerNameLink;
