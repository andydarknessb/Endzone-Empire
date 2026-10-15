import React from 'react';
import { Box } from '@mui/material';
import { pixelSx } from './type';

const BLOCKS = 20;

/**
 * Win probability as 20 blocks, each worth 5 points. Filled blocks are Accent
 * only while the matchup is live (the board's bright green on a scoreboard
 * tile) and Frame color before kickoff; empty blocks are a 2px Dim outline.
 */
export function OddsBar({
  pct, live = false, onBoard = false, label = true,
}) {
  const on = Math.max(0, Math.min(BLOCKS, Math.round(pct / 5)));
  const dim = onBoard ? 'var(--ps-board-dim)' : 'var(--ps-dim)';
  let fill = 'var(--ps-frame)';
  if (live) fill = onBoard ? 'var(--ps-board-live)' : 'var(--ps-accent)';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Box
        role="img"
        aria-label={`${pct}% win probability`}
        sx={{ display: 'grid', gridTemplateColumns: `repeat(${BLOCKS}, minmax(0, 1fr))`, gap: '2px' }}
      >
        {Array.from({ length: BLOCKS }, (_, i) => (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            component="span"
            data-on={i < on ? 'true' : undefined}
            sx={{
              height: '12px',
              boxSizing: 'border-box',
              ...(i < on ? { backgroundColor: fill } : { border: `2px solid ${dim}` }),
            }}
          />
        ))}
      </Box>
      {label && (
        <Box sx={{ fontSize: '14px', color: dim }}>
          <Box component="b" sx={{ ...pixelSx(16), color: onBoard ? 'var(--ps-board-ink)' : 'var(--ps-ink)' }}>{pct}%</Box>
          {' win probability · Endzone Forecast'}
        </Box>
      )}
    </Box>
  );
}
