import React from 'react';
import { Box, Typography } from '@mui/material';

// Label / value row used by the non-tabular rule views.
export default function RuleRow({ label, value, detail }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        py: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        // The group's own heading separates it from the next one, so the last
        // row shouldn't leave a rule hanging under the section.
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Box>
        <Typography variant="body2">{label}</Typography>
        {detail && <Typography variant="caption" color="text.secondary" component="div">{detail}</Typography>}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>{value}</Typography>
    </Box>
  );
}
