import React from 'react';
import { Box } from '@mui/material';

/**
 * The Matchup page's note row (the boards' lineup note and Bench what-if): a quiet tertiary frame of
 * its own between the NFL strip and Starters, an icon, the words and an optional ghost action. It is
 * a labelled section, never a cursor or a filled action: Matchup is a watching page.
 */
export default function NoteRow({
  icon, ariaLabel, labelledBy, action, children, ...rest
}) {
  return (
    <Box
      component="section"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      {...rest}
      sx={{
        border: '2px solid var(--ps-frame-2)',
        backgroundColor: 'var(--ps-panel)',
        color: 'var(--ps-dim)',
        boxSizing: 'border-box',
        minHeight: '56px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 16px',
        padding: { xs: '10px 14px', md: '10px 20px' },
        fontSize: '14px',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: { xs: '1 1 100%', md: '1 1 320px' }, minWidth: 0 }}>
        <Box component="span" sx={{ mt: '2px', display: 'inline-flex', color: 'var(--ps-ink)' }}>{icon}</Box>
        <Box component="span">{children}</Box>
      </Box>
      {action}
    </Box>
  );
}

/** The padlock (the lock means Locked): the Bench what-if's pictogram. */
export function PixelLock({ color = 'currentColor' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges" style={{ flex: 'none', color }}>
      <path d="M5 1h6v2H5zM3 3h2v4H3zM11 3h2v4h-2zM2 7h12v8H2zM7 9h2v3H7z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
