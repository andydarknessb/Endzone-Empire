import React from 'react';
import { Box } from '@mui/material';
import { Card } from '../../../shared/ui';
import { playLabel } from '../../../lib/scoringEvents';

/**
 * The last-plays ticker of the Scoreboard view (ADR 0031, #903), transcribed
 * from the canvas's `liveTicker()` (docs/design/game-center-matchups/
 * build.mjs): a card row with the "Last plays" label and the most recent
 * touchdowns by either side of this Matchup, newest first, each a side dot,
 * the scorer's name, the play label and the points to one decimal ("+6.0",
 * the toasts' format too), in the side's colour (four on desktop, one on a
 * phone). Renders nothing until a play has landed. The three spans of a row
 * are separated by whitespace text nodes, so copied or announced text reads
 * "P. Mahomes passing TD +6.0" and never runs the words together (#903
 * review); the flex gap alone leaves none.
 *
 * Paints only `dash-*` tokens: the home and away hues on the card surface
 * are registered pairings (the scoreboard strip's percentages), dim and faint
 * on the surface too. The dot carries no meaning of its own: the side is
 * exposed as `data-side` and the row's text names the scorer.
 */
function formatPoints(delta) {
  return `+${(Number(delta) || 0).toFixed(1)}`;
}

export default function LastPlays({ items, mobile = false }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  const shown = list.slice(0, mobile ? 1 : 4);
  return (
    <Card
      component="section"
      aria-label="Last plays"
      data-testid="last-plays"
      sx={{ display: 'flex', alignItems: 'center', gap: '12px', px: '12px', py: '8px', overflow: 'hidden' }}
    >
      <Box component="span" sx={{ ...LABEL, flex: 'none' }}>Last plays</Box>
      <Box
        component="ul"
        role="list"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '18px',
          m: 0,
          p: 0,
          listStyle: 'none',
          flex: '1 1 0',
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {shown.map((item, i) => {
          const side = item.side === 'away' ? 'away' : 'home';
          const color = side === 'away' ? 'var(--dash-away)' : 'var(--dash-home)';
          return (
            <Box
              component="li"
              key={`${item.playerId}-${i}`}
              data-testid="last-play"
              data-side={side}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', backgroundColor: color, flex: 'none' }}
              />
              <Box component="strong">{item.name}</Box>
              {' '}
              <Box component="span" sx={{ color: 'var(--dash-dim)' }}>{playLabel(item)}</Box>
              {' '}
              <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatPoints(item.pointsDelta)}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}

const LABEL = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dash-faint)',
};
