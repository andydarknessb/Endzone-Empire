import React from 'react';
import { Box } from '@mui/material';

const DEFINITIONS = [
  ['Projected', "Each lineup's points from Endzone Forecast, our projection engine."],
  ['Win probability', "Your chance to win the matchup from both lineups' projected finals. It sharpens as games finish."],
  ['Confidence', "In a Confidence pick'em, each pick carries a number from 1 up to that week's game count, each used once. A right pick earns that many points."],
];

/** The "What the numbers mean" disclosure. */
export function NumbersHelp() {
  return (
    <Box
      component="details"
      sx={{
        fontSize: '14px',
        color: 'var(--ps-dim)',
        position: 'relative',
        '& > summary': { listStyle: 'none' },
        '& > summary::-webkit-details-marker': { display: 'none' },
      }}
    >
      <Box
        component="summary"
        sx={{
          cursor: 'pointer',
          minHeight: '44px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '10px',
          fontWeight: 600,
          color: 'var(--ps-ink)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1 1h14v14H1zM3 3v10h10V3zM7 4h2v2H7zM7 7h2v5H7z" fill="currentColor" fillRule="evenodd" />
        </svg>
        What the numbers mean
      </Box>
      <Box
        component="dl"
        sx={{
          m: '4px 0 0',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'max-content 1fr' },
          gap: '6px 16px',
          maxWidth: '760px',
        }}
      >
        {DEFINITIONS.map(([term, text]) => (
          <React.Fragment key={term}>
            <Box component="dt" sx={{ fontWeight: 600, color: 'var(--ps-ink)' }}>{term}</Box>
            <Box component="dd" sx={{ m: 0 }}>{text}</Box>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
