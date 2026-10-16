import React, { useId } from 'react';
import { Box } from '@mui/material';
import { Frame, FrameHead, PixelHeading, pixelSx } from '../../../shared/ui/playselect';

/**
 * The Week at a glance frame (ADR 0031, #897; Play-select, ADR 0067 wave 2), page-local to Game Center: a
 * tertiary frame (2px rule, Pixel 16 h2) with one row per derivable fact: an uppercase dim label over a 15px
 * Archivo line on the left, the figure in Pixel 16 on the right. The rows come from the page model's
 * `weekGlanceFacts` (top score, closest Matchup, biggest lead, players remaining), already formatted; a fact
 * the week cannot answer is not a row, and a week with no rows renders no frame at all rather than an empty
 * one. The rows are a list, so a screen reader hears "Top score, Winona Wolfpack, 101.3" as one item.
 *
 * Paints only `ps-*` tokens.
 */
export default function WeekGlance({ rows, headingLevel = 2, ...rest }) {
  const headingId = useId();
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (list.length === 0) return null;

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="week-glance"
      {...rest}
      head={(
        <FrameHead>
          <PixelHeading id={headingId} level={headingLevel} size={16}>Week at a glance</PixelHeading>
        </FrameHead>
      )}
    >
      <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: '0 16px' }}>
        {list.map((row, i) => (
          <Box
            component="li"
            key={row.key}
            data-testid="week-glance-row"
            data-fact={row.key}
            sx={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: i ? '2px solid var(--ps-rule)' : 0,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
              <Box component="span" sx={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>
                {row.label}
              </Box>
              <Box component="span" data-testid="week-glance-text" sx={{ fontSize: '15px', textWrap: 'pretty' }}>
                {row.text}
              </Box>
            </Box>
            <Box component="span" data-testid="week-glance-value" sx={{ ...pixelSx(16), flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
              {row.value}
            </Box>
          </Box>
        ))}
      </Box>
    </Frame>
  );
}
