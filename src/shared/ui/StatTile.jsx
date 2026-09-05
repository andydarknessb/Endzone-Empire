import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * A labelled figure on a stat tile: an uppercase faint label above a tabular
 * value on `dash-surface2` with the small radius. The hero card's Expected
 * final and PMR tiles, the week-at-a-glance rows and the scoreboard strip all
 * compose this rather than re-deriving a tile (ADR 0031, #891).
 *
 * Part of `shared/ui` (ADR 0020): paints only `dash-*` tokens. The pairings it
 * composes (`dash-faint` and `dash-ink` on `dash-surface2`) are registered in
 * tokens.contrast.test.js. The tile is a plain group; the label and value are
 * text, so a screen reader hears "Expected final 110.5" in order.
 */
export default function StatTile({
  label,
  value,
  size = 'md',
  align = 'start',
  sx,
  'data-testid': testId = 'stat-tile',
  ...rest
}) {
  const valueSize = size === 'lg' ? '22px' : '16px';
  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'end' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        gap: '2px',
        px: '10px',
        py: '6px',
        minWidth: 0,
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius-sm)',
        color: 'var(--dash-ink)',
        ...sx,
      }}
      {...rest}
    >
      <Typography
        component="span"
        sx={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Typography>
      <Typography
        component="span"
        sx={{
          fontSize: valueSize,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
          color: 'var(--dash-ink)',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
