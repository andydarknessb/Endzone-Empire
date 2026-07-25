import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import RuleRow from './RuleRow';

const SEASON_STATUS_LABELS = {
  regular: 'Regular season',
  playoffs: 'Playoffs',
  complete: 'Season complete',
};

export default function PlayoffRulesView({ league }) {
  const regularSeasonWeeks = league.regular_season_weeks ?? 14;
  const keepersEnabled = !!league.keepers_enabled;

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Season shape</Typography>
        <RuleRow
          label="Regular season length"
          value={`${regularSeasonWeeks} weeks`}
          detail={`Playoffs begin in week ${regularSeasonWeeks + 1}.`}
        />
        <RuleRow label="Playoff teams" value={league.playoff_teams ?? 4} />
        <RuleRow
          label="Consolation bracket"
          value={league.playoff_consolation ? 'Yes' : 'No'}
          detail={league.playoff_consolation
            ? 'Teams that miss the playoffs keep playing for placement.'
            : 'Eliminated teams are done for the season.'}
        />
        {league.season_status && (
          <RuleRow
            label="Current phase"
            value={SEASON_STATUS_LABELS[league.season_status] || league.season_status}
          />
        )}
        {league.best_ball && (
          <RuleRow
            label="Best ball"
            value="On"
            detail="Lineups score automatically from your best possible starters — no lineup setting."
          />
        )}
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Keepers</Typography>
        <RuleRow label="Keepers" value={keepersEnabled ? 'Enabled' : 'Disabled'} />
        {keepersEnabled && (
          <RuleRow
            label="Keepers per team"
            value={league.keeper_count ?? 0}
            detail="Kept players cost their assigned draft round."
          />
        )}
      </Box>
    </Stack>
  );
}
