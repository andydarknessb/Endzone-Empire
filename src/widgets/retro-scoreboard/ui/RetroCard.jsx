import React, { useId } from 'react';
import { Box } from '@mui/material';
import { Frame, FrameHead, PixelHeading } from '../../../shared/ui/playselect';

/**
 * A tertiary frame (2px rule) with a Pixel 16 heading, an optional count and a right-hand tail: the
 * card the Scoreboard view's Lineups and Games tiles sit in (ADR 0067 wave 2). `headingLevel` is the
 * heading's level, so the page can keep its outline (ADR 0021).
 */
export default function RetroCard({
  title, count, tail, headingLevel = 2, children, ...rest
}) {
  const headingId = useId();
  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      {...rest}
      head={(
        <FrameHead>
          <PixelHeading id={headingId} level={headingLevel} size={16}>{title}</PixelHeading>
          {count != null && <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)', whiteSpace: 'nowrap' }}>{count}</Box>}
          {tail != null && <Box component="span" sx={{ ml: 'auto' }}>{tail}</Box>}
        </FrameHead>
      )}
    >
      {children}
    </Frame>
  );
}
