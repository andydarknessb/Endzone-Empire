import React from 'react';
import { Box } from '@mui/material';
import { Frame, Tag } from '../../../shared/ui/playselect';
import { playLabel, formatSignedPoints } from '../../../entities/matchup';

/**
 * The last-plays ticker of the Scoreboard view (ADR 0031, #903), in the board's "Last plays" look
 * (ADR 0067 wave 2, spec #2334 ruling 4): a tertiary frame with the "Last plays" label and the most
 * recent scoring plays by either side of this Matchup, newest first, each a kind tag, the scorer's
 * name, his team, the play label and the points figure to one decimal ("+6.0", the toasts' format
 * too), four on desktop and one on a phone. Renders nothing until a play has landed. The parts of a
 * row are separated by whitespace text nodes, so copied or announced text reads "P. Mahomes passing
 * TD +6.0" and never runs the words together (#903 review).
 *
 * It shows only in the Scoreboard view; the Standard view draws no Last plays. Side is exposed as
 * `data-side` (no colour dot: the scorer's name carries the meaning). Paints only `ps-*` tokens.
 */
export default function LastPlays({ items, mobile = false }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  const shown = list.slice(0, mobile ? 1 : 4);
  return (
    <Frame
      tier="rule"
      component="section"
      aria-label="Last plays"
      data-testid="last-plays"
      sx={{
        display: 'flex', alignItems: 'center', gap: '12px 16px', flexWrap: 'wrap', px: { xs: '14px', md: '20px' }, py: '8px', overflow: 'hidden',
      }}
    >
      <Box component="span" sx={{ flex: 'none', fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>
        Last plays
      </Box>
      <Box
        component="ul"
        role="list"
        sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px', m: 0, p: 0, listStyle: 'none', flex: '1 1 0', minWidth: 0,
        }}
      >
        {shown.map((item, i) => (
          <Box
            component="li"
            key={`${item.playerId}-${i}`}
            data-testid="last-play"
            data-side={item.side === 'second' ? 'second' : 'first'}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '15px', minHeight: '44px' }}
          >
            <Tag>{item.isTouchdown === false ? 'Play' : 'TD'}</Tag>
            <Box component="strong">{item.name}</Box>
            {' '}
            {item.nflTeam && <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{item.nflTeam}</Box>}
            {' '}
            <Box component="span" sx={{ color: 'var(--ps-dim)' }}>{playLabel(item)}</Box>
            {' '}
            <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {formatSignedPoints(item.pointsDelta)}
            </Box>
          </Box>
        ))}
      </Box>
    </Frame>
  );
}
