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
  Projected: 'An estimate of fantasy points based on available projection data.',
  'Expected final': 'The projection until a starter kicks off, then points so far plus what he '
    + 'is still expected to add, until it is the score.',
  'FPTS/G': 'Fantasy points per game: total fantasy points divided by games played.',
  'Pos rank': 'Position rank: this player\'s rank among players at the same position.',
  Bye: 'The week this player\'s NFL team does not play, so they can\'t score.',
  '17-game pace': 'Historical pace: last completed season\'s per-game production, extrapolated '
    + 'across seventeen games. Not a forecast or a weekly projection.',
  // A definition must never open with the literal text of its own term
  // (checked case-insensitively in AbbreviationTooltip.test.jsx): the
  // aria-label composed by AbbreviationTooltip below already prefixes the
  // term once, so a definition that opens with it gets announced twice.
  // That check is a literal prefix, not a ban on expanding an acronym into
  // words - 'PMR' -> 'Players remaining: ...', 'ADP' -> 'Average draft
  // position: ...' and 'Pos rank' -> 'Position rank: ...' are expansions,
  // not restatements, and stay as-is. 'Projected', 'Expected final' and
  // 'Bye' used to restate the literal term and were reworded (#1145); this
  // comment used to (wrongly) describe the difference as acronyms vs.
  // plain words instead of the restatement rule above - 'Bye' is plain
  // words and used to restate too, '17-game pace' is plain words and
  // never did.
  'Net vs ADP': 'Adds up how far each pick beat its market ADP. Higher is better. The steal is '
    + 'the pick that fell furthest past its ADP, the reach the pick taken furthest ahead of it.',
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
