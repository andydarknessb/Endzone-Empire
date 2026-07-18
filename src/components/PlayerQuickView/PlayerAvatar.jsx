import React from 'react';
import { Avatar } from '@mui/material';
import { POSITION_COLORS } from './PositionChip';

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
  const color = POSITION_COLORS[position] || 'primary';
  return (
    <Avatar
      src={photoUrl || undefined}
      imgProps={{ loading: 'lazy' }}
      sx={{
        width: size,
        height: size,
        bgcolor: `${color}.main`,
        color: `${color}.contrastText`,
        fontSize: size * 0.4,
      }}
    >
      {initialsFor(name)}
    </Avatar>
  );
}

export default PlayerAvatar;
