import React from 'react';
import { Chip, Stack } from '@mui/material';
import { isPickemOnly } from '../../lib/leagueType';

const SCORING_LABEL = {
  standard: 'Standard',
  half_ppr: 'Half PPR',
  ppr: 'PPR',
};

/**
 * The chips that tell a joiner the league type they are looking at, from
 * a Discover-shaped row ({ pickemOnly, pickemEnabled, scoringPreset, bestBall }).
 * A pick'em-only league has no scoring preset and no draft: the type chip is
 * what tells a joiner what they are signing up for. Shared by the Discover
 * cards and the invite-code preview so both read the same.
 */
export default function LeagueTypeChips({ league, sx }) {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={sx}>
      {isPickemOnly(league) ? (
        <Chip size="small" label="Pick'em" color="secondary" />
      ) : (
        <>
          <Chip size="small" label={SCORING_LABEL[league.scoringPreset] || league.scoringPreset || 'Standard'} />
          {league.pickemEnabled && <Chip size="small" label="Pick'em" color="secondary" variant="outlined" />}
        </>
      )}
      {league.bestBall && <Chip size="small" label="Best Ball" color="secondary" />}
    </Stack>
  );
}
