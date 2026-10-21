import React from 'react';
import { Box } from '@mui/material';
import { pixelSx } from '../../shared/ui/playselect/type';

// Shared Play-select pieces of the read-only rule views. Everything reads `--ps-*` tokens.

// Section titles are h2, one level below the page's h1.
export function SectionTitle({ id, children }) {
  return (
    <Box component="h2" id={id} sx={{ m: 0, mb: '12px', ...pixelSx(16) }}>{children}</Box>
  );
}

export function Dim({ children, sx, ...rest }) {
  return (
    <Box component="p" {...rest} sx={{ m: 0, fontSize: '15px', color: 'var(--ps-dim)', textWrap: 'pretty', ...sx }}>{children}</Box>
  );
}

// Tags and jump links wrap on a phone rather than push the page sideways.
export function TagRow({ children, sx, ...rest }) {
  return (
    <Box {...rest} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', ...sx }}>{children}</Box>
  );
}

const CELL = { padding: '10px 8px', textAlign: 'left', borderBottom: '2px solid var(--ps-rule)', fontSize: '15px' };

export function RulesTable({ label, children, sx }) {
  return (
    <Box sx={{ overflowX: 'auto', ...sx }}>
      <Box
        component="table"
        aria-label={label}
        sx={{
          width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', color: 'var(--ps-ink)',
          '& th': { ...CELL, color: 'var(--ps-dim)', fontWeight: 600 },
          '& td': CELL,
          '& tr:last-of-type td': { borderBottom: 'none' },
          '& .num': { textAlign: 'right', whiteSpace: 'nowrap' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
