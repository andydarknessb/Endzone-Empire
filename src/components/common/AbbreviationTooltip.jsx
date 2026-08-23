import React from 'react';
import { Box, Tooltip } from '@mui/material';

// The visual treatment that marks a term as "has a definition on hover/
// focus": a help cursor plus a dotted underline offset from the text. Shared
// with SortableHeaderCell's inline numeric-header label in PlayerPoolTable.jsx
// (issue #255) - that header can't nest this component's own focusable span
// without giving numeric headers a second Tab stop (issue #212), so it
// spreads this constant into its own Box instead of restating the three
// properties by hand.
export const ABBREVIATION_STYLE = Object.freeze({
  cursor: 'help',
  textDecoration: 'underline dotted',
  textUnderlineOffset: 3,
});

export const STAT_DEFINITIONS = Object.freeze({
  PMR: 'Players remaining: starters whose NFL games have not finished.',
  PF: 'Points for: total fantasy points scored by this team.',
  PA: 'Points against: total fantasy points scored by this team\'s opponents.',
  ADP: 'Average draft position: the typical pick where this player is selected.',
  Projected: 'Projected fantasy points: an estimate based on available projection data.',
  'FPTS/G': 'Fantasy points per game: total fantasy points divided by games played.',
  'Pos rank': 'Position rank: this player\'s rank among players at the same position.',
  Bye: 'Bye week: the week this player\'s NFL team does not play, so they can\'t score.',
  '17-game pace': 'Historical pace: last completed season\'s per-game production, extrapolated '
    + 'across seventeen games. Not a forecast or a weekly projection.',
});

function AbbreviationTooltip({ term, label = term }) {
  const definition = STAT_DEFINITIONS[term];
  return (
    <Tooltip title={definition || term} arrow>
      <Box
        component="span"
        tabIndex={0}
        aria-label={`${label}: ${definition || term}`}
        sx={ABBREVIATION_STYLE}
      >
        {label}
      </Box>
    </Tooltip>
  );
}

export default AbbreviationTooltip;
