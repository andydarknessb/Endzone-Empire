import React from 'react';
import { Box } from '@mui/material';
import { Frame, PixelWarn, PsButton } from '../../../shared/ui/playselect';

// Small pieces the board draws that the shared Play-select kit does not carry (the lock and star
// pictograms, the error box). Kit markup:
// docs/design/league/league-kit-pickem.js.

export function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges" style={{ flex: 'none' }}>
      <path d="M5 1h6v2H5zM3 3h2v4H3zM11 3h2v4h-2zM2 7h12v8H2zM7 9h2v3H7z" fill="currentColor" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges" style={{ flex: 'none' }}>
      <path d="M7 1h2v4h2v2h4v2h-3v2h1v4h-2v-2H9v-1H7v1H5v2H3v-4h1V9H1V7h4V5h2z" fill="currentColor" />
    </svg>
  );
}

/** A failed read: the danger double frame, the sentence and a ghost Retry. */
export function ErrorBox({ message, onRetry, ...rest }) {
  return (
    <Frame
      component="div"
      tone="danger"
      role="alert"
      {...rest}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px 20px',
        padding: '16px 20px',
      }}
    >
      <Box sx={{ display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0 }}>
        <PixelWarn color="var(--ps-danger)" />
        <Box component="span" sx={{ fontSize: '16px' }}>{message}</Box>
      </Box>
      {onRetry && <PsButton variant="ghost" onClick={onRetry}>Retry</PsButton>}
    </Frame>
  );
}
