import React from 'react';
import { Box } from '@mui/material';
import { PIXEL_FONT, SR_ONLY_SX, pixelSx } from './homeType';

const asList = (sx) => (Array.isArray(sx) ? sx : [sx]);

/** The one frame: a 6px double rule, square corners, panel fill. `tone="danger"` is the error frame. Other props (`aria-label`, `data-testid`) pass through. */
export function Frame({
  component = 'section', labelledBy, tone = 'frame', role, head, children, sx, ...rest
}) {
  return (
    <Box
      component={component}
      aria-labelledby={labelledBy}
      role={role}
      {...rest}
      sx={[
        {
          border: `6px double var(--home-${tone === 'danger' ? 'danger' : 'frame'})`,
          backgroundColor: 'var(--home-panel)',
          color: 'var(--home-ink)',
          minWidth: 0,
        },
        ...asList(sx),
      ]}
    >
      {head}
      {children}
    </Box>
  );
}

/** The frame's header row, over a 2px rule. */
export function FrameHead({ children }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 12px',
        padding: { xs: '12px 14px', md: '14px 20px' },
        borderBottom: '2px solid var(--home-rule)',
      }}
    >
      {children}
    </Box>
  );
}

/** A pixel heading: h2 is 24px on desktop and 16px on phones; h1 is 32 and 24 with line height 1.3. */
export function PixelHeading({
  id, level = 2, size, children,
}) {
  const h1 = level === 1;
  const fixed = size ? pixelSx(size) : null;
  return (
    <Box
      component={`h${level}`}
      id={id}
      sx={{
        m: 0,
        ...pixelSx(16),
        ...(fixed || { fontSize: h1 ? { xs: '24px', md: '32px' } : { xs: '16px', md: '24px' } }),
        ...(h1 ? { lineHeight: 1.3, overflowWrap: 'break-word' } : null),
      }}
    >
      {children}
    </Box>
  );
}

/** A 28px square count with a 2px Ink border; a screen reader hears the sentence, not the digit. */
export function CountBadge({ n, noun = 'plays' }) {
  const spoken = noun === 'plays'
    ? `${n} ${n === 1 ? 'thing needs' : 'things need'} you`
    : `${n} ${noun}`;
  return (
    <Box
      component="span"
      sx={{
        position: 'relative',
        display: 'inline-grid',
        placeItems: 'center',
        minWidth: '28px',
        height: '28px',
        padding: '0 6px',
        boxSizing: 'border-box',
        border: '2px solid var(--home-ink)',
        fontFamily: PIXEL_FONT,
        fontSize: '16px',
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{n}</span>
      <Box component="span" sx={SR_ONLY_SX}>{spoken}</Box>
    </Box>
  );
}
