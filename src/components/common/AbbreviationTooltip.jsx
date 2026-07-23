import React from 'react';
import { Box, Tooltip } from '@mui/material';

export const STAT_DEFINITIONS = Object.freeze({
  PMR: 'Players remaining: starters whose NFL games have not finished.',
  PF: 'Points for: total fantasy points scored by this team.',
  PA: 'Points against: total fantasy points scored by this team\'s opponents.',
  ADP: 'Average draft position: the typical pick where this player is selected.',
  Projected: 'Projected fantasy points: an estimate based on available projection data.',
  'FPTS/G': 'Fantasy points per game: total fantasy points divided by games played.',
  'Pos rank': 'Position rank: this player\'s rank among players at the same position.',
});

function AbbreviationTooltip({ term, label = term }) {
  const definition = STAT_DEFINITIONS[term];
  return (
    <Tooltip title={definition || term} arrow>
      <Box
        component="span"
        tabIndex={0}
        aria-label={`${label}: ${definition || term}`}
        sx={{ cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
      >
        {label}
      </Box>
    </Tooltip>
  );
}

export default AbbreviationTooltip;
