import React from 'react';
import { Box } from '@mui/material';

/**
 * "What the numbers mean": a closed disclosure over a term list (RULINGS Critique 9-11).
 * `terms` is `[term, definition][]`. The summary is a 44px target at every width, so it
 * clears the phone minimum without a breakpoint. The list is two columns from `sm` up.
 */
export function NumbersHelp({ terms, title = 'What the numbers mean' }) {
  return (
    <Box component="details" sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>
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
        {title}
      </Box>
      <Box
        component="dl"
        sx={{
          m: '4px 0 0',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' },
          gap: '6px 16px',
          maxWidth: '760px',
        }}
      >
        {terms.map(([term, definition]) => (
          <React.Fragment key={term}>
            <Box component="dt" sx={{ fontWeight: 600, color: 'var(--ps-ink)' }}>{term}</Box>
            <Box component="dd" sx={{ m: 0 }}>{definition}</Box>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
