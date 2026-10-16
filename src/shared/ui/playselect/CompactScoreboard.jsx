import React from 'react';
import { Box } from '@mui/material';
import { LiveChip } from './Controls';

const DOT_SX = { color: 'var(--ps-board-dim)' };

/**
 * The compact scoreboard bar (RULINGS Critique 11 item 8): 56px, Board black, "DF 61.0 · SS 58.9 ·
 * Darkness Falls by 2.1" with the leader's score in Board ink and the trailer's in Board dim, and a
 * Live chip when `live`. `a` and `b` are `{ abbr, name, score }` (score a string, already
 * formatted); `lead` is 'a', 'b' or nothing for a tie; `marginText` is the margin in words. One
 * group carries the full sentence as its name. Below sm the margin drops to a second line. It has
 * no cursor and no action; the page wires the pinning (position: sticky, scroll-padding-top 72px).
 */
export function CompactScoreboard({
  a, b, lead, marginText, live = false,
}) {
  const score = (side, leads) => (
    <Box component="span" sx={{ whiteSpace: 'nowrap', fontWeight: leads ? 700 : 600, color: leads ? 'var(--ps-board-ink)' : 'var(--ps-board-dim)' }}>
      {`${side.abbr} ${side.score}`}
    </Box>
  );
  return (
    <Box
      role="group"
      aria-label={`${a.name} ${a.score}, ${b.name} ${b.score}, ${marginText}`}
      sx={{
        height: '56px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        px: { xs: '14px', sm: '20px' },
        backgroundColor: 'var(--ps-board)',
        color: 'var(--ps-board-ink)',
        border: '2px solid var(--ps-board-dim)',
        fontSize: { xs: '15px', sm: '16px' },
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.3,
      }}
    >
      <Box aria-hidden="true" sx={{ minWidth: 0, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: '2px' }}>
        <span>
          {score(a, lead === 'a')}
          <Box component="span" sx={DOT_SX}> · </Box>
          {score(b, lead === 'b')}
        </span>
        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
          <Box component="span" sx={{ ...DOT_SX, display: { xs: 'none', sm: 'inline' } }}> · </Box>
          <Box component="span" sx={{ fontWeight: 700, color: 'var(--ps-board-ink)' }}>{marginText}</Box>
        </Box>
      </Box>
      {live ? <LiveChip onBoard>Live</LiveChip> : null}
    </Box>
  );
}
