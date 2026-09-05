import React from 'react';
import { Box } from '@mui/material';

/**
 * A position chip: the slot or position label on the position palette's fill
 * (a data encoding, `pos-*` in tokens.js) under the `text-inverse` label ink,
 * the pairing the app already registers for its position chips. FLEX and any
 * IDP slot map onto the palette too, so a lineup's slot column reads in one
 * vocabulary. The slot comparison table, the lineups preview and the matchup
 * hero compose this (ADR 0031, #891).
 *
 * Part of `shared/ui` (ADR 0020). The rendered label is the display form
 * (DEF reads as D/ST); the resolved palette key is exposed as a stable
 * `data-position` so a test can assert the encoding without reading styles.
 */
const PALETTE = {
  QB: 'qb',
  RB: 'rb',
  WR: 'wr',
  TE: 'te',
  K: 'k',
  DEF: 'def',
  'D/ST': 'def',
  DST: 'def',
  FLEX: 'flex',
  SUPERFLEX: 'flex',
  'W/R/T': 'flex',
  'W/R': 'flex',
  'R/W/T': 'flex',
};
const IDP = new Set(['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S', 'IDP', 'IDP FLEX', 'D LINE']);

/** The palette key for a slot or position label (unknown labels read as flex). */
export function positionKey(label) {
  const upper = String(label || '').toUpperCase();
  if (PALETTE[upper]) return PALETTE[upper];
  if (IDP.has(upper)) return 'idp';
  return 'flex';
}

/** DEF is stored/scored as the "DEF" slot but reads as D/ST everywhere it's displayed. */
export function positionLabel(label) {
  return String(label || '').toUpperCase() === 'DEF' ? 'D/ST' : label;
}

export default function PosChip({
  position,
  sx,
  'data-testid': testId = 'pos-chip',
  ...rest
}) {
  const key = positionKey(position);
  // The flex fill is the muted text tier, not a position hue: a FLEX slot is a
  // place, not a position. It carries the same inverse ink as the others.
  const fill = key === 'flex' ? 'var(--text-muted)' : `var(--pos-${key})`;
  return (
    <Box
      component="span"
      data-testid={testId}
      data-position={key}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 34,
        height: 20,
        px: '6px',
        borderRadius: 'var(--radius-sm)',
        fontSize: '10.5px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        backgroundColor: fill,
        color: 'var(--text-inverse)',
        ...sx,
      }}
      {...rest}
    >
      {positionLabel(position)}
    </Box>
  );
}
