import React from 'react';
import { Menu, MenuItem } from '@mui/material';

/**
 * The slot-first quick pick (#1237, restated from LineupScreen.jsx): tapping
 * an empty slot with nothing selected offers every eligible player instead
 * of the two-tap select-then-target swap.
 */
export default function QuickPickMenu({ quickPick, eligible, onClose, onSelect }) {
  return (
    <Menu
      anchorEl={quickPick?.anchorEl}
      open={Boolean(quickPick)}
      onClose={onClose}
      data-testid="quick-pick-menu"
      MenuListProps={{ 'aria-label': 'Eligible players' }}
    >
      {eligible.length === 0 ? (
        <MenuItem disabled>No eligible players available</MenuItem>
      ) : (
        eligible.map((e) => (
          <MenuItem key={e.playerId} onClick={() => onSelect(e.playerId)}>
            {e.name} · {e.position} · {e.slot === 'BENCH' ? 'Bench' : e.slot === 'IR' ? 'IR' : `Starting ${e.slot}`}
          </MenuItem>
        ))
      )}
    </Menu>
  );
}
