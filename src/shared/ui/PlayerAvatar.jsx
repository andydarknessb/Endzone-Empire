import React from 'react';
import { Avatar } from '@mui/material';
// Concrete module path, not the shared/lib barrel: the same reason
// TeamAvatar.jsx imports it this way (ADR 0031's #1146 amendment, extended to
// this module by #1304) - the index would pull the whole kit, including
// useEndpoint, into this bundle.
import { initialsFor } from '../lib/initials';

/**
 * A player's headshot with a position-colored, initials fallback when no
 * photo_url is available. Shared by the players table, quick-view, and the
 * full profile page so avatars look identical everywhere.
 *
 * ADR 0067, wave 3: a neutral square on `ps-*` tokens, an Ink 2px edge and Ink
 * initials, with no position or jersey colour.
 */
function PlayerAvatar({ name, photoUrl, size = 32 }) {
  return (
    <Avatar
      aria-hidden="true"
      variant="square"
      src={photoUrl || undefined}
      imgProps={{ loading: 'lazy' }}
      sx={{
        width: size,
        height: size,
        boxSizing: 'border-box',
        border: '2px solid var(--ps-ink)',
        borderRadius: 0,
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
        bgcolor: 'var(--ps-panel)',
        color: 'var(--ps-ink)',
      }}
    >
      {initialsFor(name)}
    </Avatar>
  );
}

export default PlayerAvatar;
