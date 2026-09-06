import React from 'react';
import { Box, Typography } from '@mui/material';
import { Card } from '../../../shared/ui';

/**
 * The Week at a glance tile (ADR 0031, #897), page-local to Game Center:
 * transcribed from the canvas's `weekGlance()` (docs/design/
 * game-center-matchups/build.mjs). A Card titled "Week at a glance" holding
 * one row per derivable fact: an uppercase faint label over a 13px line of
 * text on the left, the figure in the display face at 22px tabular on the
 * right. The rows come from the page model's `weekGlanceFacts` (top score,
 * closest Matchup, biggest lead, starters still to play), already formatted;
 * a fact the week cannot answer is not a row, and a week with no rows renders
 * no tile at all rather than an empty card.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens: ink and
 * faint on the card surface, both registered in tokens.contrast.test.js. The
 * rows are a list, so a screen reader hears "Top score, Winona Wolfpack,
 * 101.3" as one item.
 */
export default function WeekGlance({ rows, headingLevel = 2, ...rest }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (list.length === 0) return null;

  return (
    <Card data-testid="week-glance" title="Week at a glance" headingLevel={headingLevel} {...rest}>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: '8px 0' }}>
        {list.map((row) => (
          <Box
            component="li"
            key={row.key}
            data-testid="week-glance-row"
            data-fact={row.key}
            sx={{ display: 'flex', alignItems: 'center', gap: '12px', px: '18px', py: '8px' }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
              <Typography
                component="span"
                sx={{
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--dash-faint)',
                }}
              >
                {row.label}
              </Typography>
              <Typography
                component="span"
                data-testid="week-glance-text"
                sx={{
                  fontSize: '13px',
                  color: 'var(--dash-ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.text}
              </Typography>
            </Box>
            <Typography
              component="span"
              data-testid="week-glance-value"
              sx={{
                flex: 'none',
                fontFamily: 'var(--dash-font-display)',
                fontSize: '22px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
                color: 'var(--dash-ink)',
              }}
            >
              {row.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Card>
  );
}
