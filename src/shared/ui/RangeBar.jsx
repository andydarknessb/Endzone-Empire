import React from 'react';
import { Box } from '@mui/material';

/**
 * A Floor-to-Ceiling band with a mean tick (CONTEXT.md's Floor/Ceiling: the
 * Interval's 10th and 90th percentile, presentation names for the interval,
 * never a separate estimate). Introduced for the Start/sit advice panel
 * (#1238, ADR 0037 AC1), one bar per player: the band spans Floor to
 * Ceiling and the tick marks the Weekly projection's mean.
 *
 * Part of `shared/ui` (ADR 0020): paints only `dash-*` tokens, and - like
 * SplitBar - carries no visible text of its own, so it introduces no new
 * foreground/background pairing for tokens.contrast.test.js to register; a
 * composing widget prints the Floor/projection/Ceiling figures beside it as
 * plain `dash-ink`/`dash-faint` text. It is a `role="img"` whose accessible
 * name states all three figures, so the interval is announced, not just
 * painted, mirroring SplitBar's own "state it in the name" contract.
 *
 * `min`/`max` set the bar's domain (default 0..Ceiling); a caller comparing
 * two players' bars side by side (the panel's sit/start pair) passes the
 * same `min`/`max` to both so the two bands sit on one shared scale. Any
 * value outside 0..100% of the domain is clamped rather than overflowing the
 * track. A missing Floor or Ceiling renders no band at all (never a guessed
 * one), and a missing projection renders no tick.
 */
export default function RangeBar({
  floor,
  ceiling,
  projection,
  min = 0,
  max,
  label,
  height = 8,
  sx,
  'data-testid': testId = 'range-bar',
  ...rest
}) {
  const domainMin = Number.isFinite(Number(min)) ? Number(min) : 0;
  const fallbackMax = Math.max(Number(ceiling) || 0, Number(projection) || 0, domainMin + 1);
  const domainMax = Number.isFinite(Number(max)) ? Number(max) : fallbackMax;
  const span = Math.max(domainMax - domainMin, 1e-6);

  const pct = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, ((n - domainMin) / span) * 100));
  };

  const floorPct = pct(floor);
  const ceilingPct = pct(ceiling);
  const projectionPct = pct(projection);
  const hasBand = floorPct != null && ceilingPct != null;
  const bandLeft = hasBand ? Math.min(floorPct, ceilingPct) : 0;
  const bandWidth = hasBand ? Math.max(ceilingPct - floorPct, 0) : 0;

  const parts = [];
  if (label) parts.push(label);
  if (Number.isFinite(Number(floor))) parts.push(`Floor ${Number(floor).toFixed(1)}`);
  if (Number.isFinite(Number(projection))) parts.push(`Projection ${Number(projection).toFixed(1)}`);
  if (Number.isFinite(Number(ceiling))) parts.push(`Ceiling ${Number(ceiling).toFixed(1)}`);
  const ariaLabel = parts.length > 0 ? parts.join(', ') : 'No projection';

  return (
    <Box
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      sx={{
        position: 'relative',
        height,
        borderRadius: 'var(--radius-pill)',
        backgroundColor: 'var(--dash-surface3)',
        overflow: 'hidden',
        ...sx,
      }}
      {...rest}
    >
      {hasBand && (
        <Box
          data-testid={`${testId}-band`}
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            backgroundColor: 'var(--dash-accent-soft)',
            border: '1px solid var(--dash-accent-line)',
            borderRadius: 'var(--radius-pill)',
          }}
        />
      )}
      {projectionPct != null && (
        <Box
          data-testid={`${testId}-tick`}
          style={{ left: `${projectionPct}%` }}
          sx={{
            position: 'absolute',
            top: -2,
            bottom: -2,
            width: '2px',
            transform: 'translateX(-1px)',
            backgroundColor: 'var(--dash-accent)',
          }}
        />
      )}
    </Box>
  );
}
