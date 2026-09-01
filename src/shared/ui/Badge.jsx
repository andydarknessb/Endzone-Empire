import React from 'react';
import { Chip } from '@mui/material';

/**
 * League Dashboard badge: a token-themed MUI Chip in three variants from the
 * mockup:
 *   - `neutral` (default): the plain `.chip` (surface2 fill, dim text).
 *   - `live`: the `.chip.live` accent state (accent text on the accent tint).
 *   - `you`: the small `.you` pill that marks the viewer's own Team.
 *
 * Part of `shared/ui` (ADR 0020). Colors come only from `--dash-*` tokens.
 * The label text is whatever `children` holds; the variant is also exposed as
 * a stable `data-variant` attribute so a composing widget (and this kit's own
 * tests) can assert which variant rendered without reaching into class names.
 */
const VARIANT_SX = {
  neutral: {
    backgroundColor: 'var(--dash-surface2)',
    color: 'var(--dash-dim)',
    border: '1px solid var(--dash-line)',
  },
  live: {
    backgroundColor: 'var(--dash-accent-soft)',
    color: 'var(--dash-accent)',
    border: '1px solid var(--dash-accent-line)',
  },
  // The "You" pill shares the accent palette with `live` but is its own thing
  // in the mockup (`.you`): smaller, heavier, wider tracking. Keeping its type
  // distinct is what makes it read as an identity marker rather than a status
  // chip when the two sit near each other.
  you: {
    backgroundColor: 'var(--dash-accent-soft)',
    color: 'var(--dash-accent)',
    border: '1px solid var(--dash-accent-line)',
    fontSize: '10.5px',
    fontWeight: 700,
    letterSpacing: '0.08em',
  },
};

export default function Badge({
  variant = 'neutral',
  children,
  sx,
  'data-testid': testId = 'badge',
  ...rest
}) {
  const variantSx = VARIANT_SX[variant] ?? VARIANT_SX.neutral;

  return (
    <Chip
      label={children}
      size="small"
      data-variant={variant}
      data-testid={testId}
      sx={{
        height: 'auto',
        fontSize: '11.5px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        borderRadius: 'var(--radius-pill)',
        '& .MuiChip-label': { px: 1.25, py: 0.5 },
        ...variantSx,
        ...sx,
      }}
      {...rest}
    />
  );
}
