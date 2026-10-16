import React from 'react';
import { Box } from '@mui/material';

const BLOCKS = 20;

/**
 * Two-sided win probability (RULINGS Critique 8-9): 20 blocks where `a`'s share fills
 * from the left end and `b`'s from the right, the leader's cells filled and the trailer's
 * a 2px outline. `pct` is `a`'s win percent; `b` is the rest, so the two always sum to 100
 * (an even game leads with `a`). The leader is Board-lit on a live Board black bar, Ink
 * before kickoff and Accent on the page when `live` (a live Pick'em card). Both names and
 * percents sit at the ends (`aShort`/`bShort` print instead of the names when given); one
 * image carries "{a} {x}%, {b} {y}% win probability". `caption` is optional (a Forecast
 * credit goes here on fantasy bars only, never on a Pick'em card). With no finite `pct` it draws nothing.
 */
export function TwoSidedOdds({
  a, b, pct, aShort, bShort, live = false, onBoard = false, caption, size = 14,
}) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const pa = Math.max(0, Math.min(100, Math.round(pct)));
  const pb = 100 - pa;
  const aLeads = pa >= 50;
  const aCells = Math.round(pa / 5);
  const ink = onBoard ? 'var(--ps-board-ink)' : 'var(--ps-ink)';
  const dim = onBoard ? 'var(--ps-board-dim)' : 'var(--ps-dim)';
  let lead = ink;
  if (live) lead = onBoard ? 'var(--ps-board-live)' : 'var(--ps-accent)';
  const end = (name, p, leads, right) => (
    <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: right ? 'right' : undefined, ...(leads ? { fontWeight: 700, color: ink } : null) }}>
      {`${name} ${p}%`}
    </Box>
  );
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: `${size}px`, color: dim }}>
      {caption ? <span>{caption}</span> : null}
      <Box
        role="img"
        aria-label={`${a} ${pa}%, ${b} ${pb}% win probability`}
        sx={{ display: 'grid', gridTemplateColumns: `repeat(${BLOCKS}, minmax(0, 1fr))`, gap: '2px' }}
      >
        {Array.from({ length: BLOCKS }, (_, i) => {
          const filled = (i < aCells) === aLeads;
          return (
            <Box
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              component="span"
              data-on={filled ? 'true' : undefined}
              sx={{
                height: '12px',
                boxSizing: 'border-box',
                ...(filled ? { backgroundColor: lead } : { border: `2px solid ${dim}` }),
              }}
            />
          );
        })}
      </Box>
      <Box aria-hidden="true" sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 8px' }}>
        {end(aShort || a, pa, aLeads)}
        {end(bShort || b, pb, !aLeads, true)}
      </Box>
    </Box>
  );
}
