import React from 'react';
import { Box } from '@mui/material';

/**
 * A two-color proportion bar: the home share on the left in `dash-home`, the
 * away share on the right in `dash-away`, on a `dash-surface3` track. Win
 * probability on the hero card, the matchup cards and the scoreboard strip
 * all render this one bar (ADR 0031, #891).
 *
 * Part of `shared/ui` (ADR 0020): paints only `dash-*` tokens. It is a
 * `role="img"` whose accessible name carries both sides' names and
 * percentages, so the split is announced, not just painted; the two segment
 * widths are inline styles so a test can read them without a layout engine.
 * The home share is clamped to 0..1; the away share is its complement.
 */
export default function SplitBar({
  homeName,
  awayName,
  homeShare,
  height = 8,
  sx,
  'data-testid': testId = 'split-bar',
  ...rest
}) {
  const home = Math.max(0, Math.min(1, Number(homeShare) || 0));
  const homePct = Math.round(home * 100);
  const awayPct = 100 - homePct;
  return (
    <Box
      role="img"
      aria-label={`Win probability: ${homeName} ${homePct}%, ${awayName} ${awayPct}%`}
      data-testid={testId}
      sx={{
        display: 'flex',
        height,
        borderRadius: 'var(--radius-pill)',
        overflow: 'hidden',
        backgroundColor: 'var(--dash-surface3)',
        ...sx,
      }}
      {...rest}
    >
      <Box
        data-testid={`${testId}-home`}
        style={{ width: `${homePct}%` }}
        sx={{ backgroundColor: 'var(--dash-home)', transition: 'width var(--transition-base) ease' }}
      />
      <Box
        data-testid={`${testId}-away`}
        style={{ width: `${awayPct}%` }}
        sx={{ backgroundColor: 'var(--dash-away)', transition: 'width var(--transition-base) ease' }}
      />
    </Box>
  );
}
