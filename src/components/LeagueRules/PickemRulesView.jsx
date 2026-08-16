import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import apiClient from '../../api/apiClient';
import RuleRow from './RuleRow';
import { PICKEM_MODE_OPTIONS } from '../LeaguePickem/PickemSettingsPanel';

const errorMessage = (error) => error?.response?.data?.error || error?.message || 'Request failed';

/**
 * The read-only rulebook of a pick'em-only league. Everything but the scoring
 * mode is fixed by the game itself; the mode is read from the league's pick'em
 * settings so this page always states the rule actually in force.
 */
export default function PickemRulesView({ league }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    apiClient
      .get(`/api/pickem/league/${league.id}/settings`)
      .then((res) => { if (active) setSettings(res.data); })
      .catch((requestError) => { if (active) setError(errorMessage(requestError)); });
    return () => { active = false; };
  }, [league.id, reload]);

  // RuleRow renders its value nowrap, so the value stays a word and the full
  // rule sentence goes in the detail line.
  const mode = PICKEM_MODE_OPTIONS.find((option) => option.value === settings?.mode);
  const modeName = mode ? mode.label.split(':')[0] : settings?.mode;

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Scoring</Typography>
        {error ? (
          <Alert
            severity="error"
            action={<Button color="inherit" size="small" onClick={() => setReload((n) => n + 1)}>Retry</Button>}
          >
            Unable to load the scoring mode: {error}
          </Alert>
        ) : !settings ? (
          <Skeleton variant="rounded" height={48} />
        ) : (
          <RuleRow
            label="Scoring mode"
            value={modeName}
            detail={`${mode ? mode.label + '. ' : ''}The mode can only change before the season's first pick.`}
          />
        )}
        <RuleRow
          label="Tied game"
          value="Credits nobody"
          detail="A tied game credits nobody: it counts as neither correct nor incorrect."
        />
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Picks</Typography>
        <RuleRow
          label="Picks lock"
          value="At kickoff"
          detail="Picks lock at kickoff, game by game. Everyone's picks are revealed as each game locks."
        />
        <RuleRow
          label="Every game, every week"
          value="Weeks 1 to 18"
          detail="Weeks follow the NFL calendar. Nothing to draft, no lineups to set."
        />
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Season</Typography>
        <RuleRow
          label="Standings"
          value="Season-long"
          detail="Standings are cumulative for the season: every week's points add up. A manager who joins mid-season starts from zero."
        />
        <RuleRow
          label="Champion"
          value="Highest season total"
          detail="Most correct picks at the end of the season wins (highest points in confidence mode). Ties make co-champions. No playoffs."
        />
      </Box>
    </Stack>
  );
}
