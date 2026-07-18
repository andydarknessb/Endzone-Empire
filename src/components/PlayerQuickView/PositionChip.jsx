import React from 'react';
import { Chip } from '@mui/material';

// Shared position -> MUI palette color mapping so the position chip reads the
// same everywhere (players table, quick-view, full profile).
export const POSITION_COLORS = {
  QB: 'primary',
  RB: 'success',
  WR: 'secondary',
  TE: 'warning',
  K: 'info',
  DEF: 'error',
};

/** A small, position-colored chip (QB/RB/WR/TE/K/DEF). */
function PositionChip({ position, size = 'small', ...props }) {
  if (!position) return null;
  return <Chip label={position} size={size} color={POSITION_COLORS[position] || 'default'} {...props} />;
}

export default PositionChip;
