import React from 'react';
import { Avatar } from '@mui/material';
import { positionColorSx } from './PositionChip';

function initialsFor(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/**
 * A player's headshot with a position-colored, initials fallback when no
 * photo_url is available. Shared by the players table, quick-view, and the
 * full profile page so avatars look identical everywhere.
 */
function PlayerAvatar({ name, position, photoUrl, size = 32 }) {
  // Match the position chip; fall back to the neutral (DEF) fill when unknown.
  const colorSx = positionColorSx(position) || {
    bgcolor: 'var(--pos-def)',
    color: 'var(--text-inverse)',
  };
  return (
    <Avatar
      src={photoUrl || undefined}
      imgProps={{ loading: 'lazy' }}
      sx={{ width: size, height: size, fontSize: size * 0.4, ...colorSx }}
    >
      {initialsFor(name)}
    </Avatar>
  );
}

export default PlayerAvatar;
