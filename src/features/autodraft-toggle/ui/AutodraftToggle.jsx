import React from 'react';
import { Box, Switch } from '@mui/material';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';

const SWITCH_SX = {
  width: 36,
  height: 22,
  p: 0,
  '& .MuiSwitch-switchBase': {
    p: '3px',
    '&.Mui-checked': {
      transform: 'translateX(14px)',
      color: 'var(--on-accent)',
      '& + .MuiSwitch-track': {
        opacity: 1,
        bgcolor: 'var(--accent)',
      },
    },
  },
  '& .MuiSwitch-thumb': {
    width: 16,
    height: 16,
    boxShadow: 'var(--shadow-1)',
  },
  '& .MuiSwitch-track': {
    borderRadius: 'var(--radius-pill)',
    opacity: 1,
    bgcolor: 'var(--border-strong)',
  },
};

/** Accessible, right-aligned Autodraft control for a Draft order row. */
export default function AutodraftToggle({
  teamName,
  checked,
  onChange,
  disabled = false,
  describedBy,
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 44, minHeight: 44 }}>
      <Switch
        size="small"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        sx={{ ...SWITCH_SX, ...MIN_TOUCH_TARGET_SX }}
        inputProps={{
          'aria-label': `Autodraft for ${teamName}`,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        }}
      />
    </Box>
  );
}
