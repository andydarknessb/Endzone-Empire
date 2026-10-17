import React from 'react';
import { Menu, MenuItem } from '@mui/material';

const ITEM_SX = {
  minHeight: '44px',
  px: '16px',
  borderRadius: 0,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  color: 'var(--ps-ink)',
  whiteSpace: 'normal',
  // The one Play-blue highlight is the row under the pointer or the keyboard.
  '&:hover, &.Mui-focusVisible, &.Mui-focusVisible:hover': { backgroundColor: 'var(--ps-play)', color: 'var(--ps-play-ink)' },
  '&.Mui-disabled': { opacity: 1, color: 'var(--ps-dim)' },
};

/**
 * The slot-first quick pick (#1237, restated from LineupScreen.jsx): tapping
 * an empty slot with nothing selected offers every eligible player instead
 * of the two-tap select-then-target swap. Drawn in Play-select (ADR 0067 wave 3): a framed list of 44px
 * rows, the highlighted one in Play blue.
 */
export default function QuickPickMenu({ quickPick, eligible, onClose, onSelect }) {
  return (
    <Menu
      anchorEl={quickPick?.anchorEl}
      open={Boolean(quickPick)}
      onClose={onClose}
      data-testid="quick-pick-menu"
      MenuListProps={{ 'aria-label': 'Eligible players', sx: { py: 0 } }}
      PaperProps={{
        className: 'ps-root',
        sx: {
          borderRadius: 0,
          backgroundImage: 'none',
          boxShadow: 'none',
          backgroundColor: 'var(--ps-panel)',
          color: 'var(--ps-ink)',
          border: '6px double var(--ps-frame)',
          minWidth: '280px',
          maxWidth: 'calc(100vw - 32px)',
        },
      }}
    >
      {eligible.length === 0 ? (
        <MenuItem disabled sx={ITEM_SX}>No eligible players available</MenuItem>
      ) : (
        eligible.map((e) => (
          <MenuItem key={e.playerId} onClick={() => onSelect(e.playerId)} sx={ITEM_SX}>
            {e.name} · {e.position} · {e.slot === 'BENCH' ? 'Bench' : e.slot === 'IR' ? 'IR' : `Starting ${e.slot}`}
          </MenuItem>
        ))
      )}
    </Menu>
  );
}
