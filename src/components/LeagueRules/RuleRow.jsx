import React from 'react';
import { Box } from '@mui/material';

// Kit row: the label in Dim, the value in Ink with tabular figures.
export default function RuleRow({ label, value, detail }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '16px',
        py: '10px',
        borderBottom: '2px solid var(--ps-rule)',
        // The group's own heading separates it from the next one, so the last
        // row shouldn't leave a rule hanging under the section.
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>{label}</Box>
        {detail && <Box sx={{ fontSize: '14px', color: 'var(--ps-dim)', textWrap: 'pretty' }}>{detail}</Box>}
      </Box>
      <Box sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--ps-ink)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: { xs: 'normal', sm: 'nowrap' }, flex: 'none', maxWidth: { xs: '45%', sm: 'none' } }}>{value}</Box>
    </Box>
  );
}
