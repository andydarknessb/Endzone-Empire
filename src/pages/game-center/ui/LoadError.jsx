import React from 'react';
import { Box } from '@mui/material';
import {
  Frame, PixelWarn, PsButton, pixelSx,
} from '../../../shared/ui/playselect';

/**
 * Game Center's load failure (spec #2334 QA): the danger frame with the title "We could not load Game Center
 * right now.", the server's own sentence as the body, and a ghost "Retry" wired to the reads' refetch. The
 * body of the page still renders with whatever did load, so this sits above it.
 */
export default function LoadError({ body, onRetry }) {
  return (
    <Frame
      component="div"
      tone="danger"
      role="alert"
      data-testid="game-center-error"
      sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px', padding: '16px 20px',
      }}
    >
      <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start', minWidth: 0 }}>
        <PixelWarn color="var(--ps-danger)" />
        <Box>
          <Box sx={pixelSx(16)}>We could not load Game Center right now.</Box>
          {body && <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)', mt: '4px' }}>{body}</Box>}
        </Box>
      </Box>
      <PsButton variant="ghost" onClick={onRetry}>Retry</PsButton>
    </Frame>
  );
}
