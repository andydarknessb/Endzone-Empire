import React from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * A section title + optional subhead and right-aligned action (e.g. a
 * "View all →" link). Used across the public pages and the landing band for a
 * consistent heading rhythm.
 */
function SectionHeading({ title, subtitle, action, component = 'h2', variant = 'h4', id }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', sm: 'flex-end' }}
      spacing={1}
      sx={{ mb: 3 }}
    >
      <Box>
        <Typography variant={variant} component={component} id={id} sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Stack>
  );
}

export default SectionHeading;
