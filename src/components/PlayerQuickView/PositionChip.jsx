import React from 'react';
import { Chip } from '@mui/material';

// Fantasy position -> CSS-var fill (defined per-theme in tokens.js: QB red,
// RB green, WR blue, TE orange, K purple, DEF gray). The label uses
// --text-inverse, which flips white/dark with the theme so it stays AA-legible
// on the fill in both light and dark modes.
const POSITION_VAR = { QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', K: 'k', DEF: 'def' };

/**
 * sx for a position-colored surface (chip fill or avatar background), or null
 * for an unknown position. Shared so chips and avatars color identically.
 */
export function positionColorSx(position) {
  const key = POSITION_VAR[position];
  if (!key) return null;
  return { bgcolor: `var(--pos-${key})`, color: 'var(--text-inverse)' };
}

/** A small, position-colored chip (QB red, RB green, WR blue, TE orange, K purple, DEF gray). */
function PositionChip({ position, size = 'small', sx, ...props }) {
  if (!position) return null;
  const colorSx = positionColorSx(position);
  return (
    <Chip
      label={position}
      size={size}
      sx={{ fontWeight: 600, ...(colorSx || {}), ...sx }}
      {...props}
    />
  );
}

export default PositionChip;
