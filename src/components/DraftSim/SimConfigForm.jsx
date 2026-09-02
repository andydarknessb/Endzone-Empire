import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, FormControl, InputLabel, MenuItem,
  Paper, Select, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  LEAGUE_TEMPLATES, templateFor, roundsForTemplate, starterCount, SIM_BENCH_SLOTS,
} from '../../lib/draftSim/templates';
import { MIN_TEAMS, MAX_TEAMS, CLOCK_OPTIONS } from '../../lib/draftSim/engine';

const TEAM_OPTIONS = Array.from(
  { length: MAX_TEAMS - MIN_TEAMS + 1 },
  (_, i) => MIN_TEAMS + i
);

const CLOCK_LABELS = { 0: 'No clock', 30: '30s', 60: '60s', 90: '90s' };

function relativeTime(timestamp) {
  const minutes = Math.round((Date.now() - Number(timestamp)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The pre-draft setup screen: how many managers, where you pick, what the
 * league starts, and how long you get on the clock. Also the landing spot for
 * the "you have a draft in progress" resume banner.
 */
function SimConfigForm({ onStart, loading = false, error = false, savedSummary = null, onResume, onDiscardSaved }) {
  const [totalTeams, setTotalTeams] = useState(10);
  const [userSlot, setUserSlot] = useState(1);
  const [leagueType, setLeagueType] = useState('standard');
  const [clockSeconds, setClockSeconds] = useState(60);

  const template = templateFor(leagueType);
  const rounds = roundsForTemplate(template);
  const slotOptions = useMemo(
    () => Array.from({ length: totalTeams }, (_, i) => i + 1),
    [totalTeams]
  );

  const handleTeamsChange = (value) => {
    setTotalTeams(value);
    setUserSlot((slot) => (slot !== 'random' && slot > value ? value : slot));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onStart({ totalTeams, userSlot, leagueType, clockSeconds });
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      {savedSummary && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={(
            <Stack direction="row" spacing={1}>
              <Button color="inherit" size="small" onClick={onResume}>Resume</Button>
              <Button color="inherit" size="small" onClick={onDiscardSaved}>Discard</Button>
            </Stack>
          )}
        >
          You have a mock draft in progress: {savedSummary.totalTeams}-team{' '}
          {templateFor(savedSummary.leagueType).name}, round {savedSummary.round} of{' '}
          {savedSummary.rounds}, saved {relativeTime(savedSummary.updatedAt)}.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          We couldn&apos;t load the player pool. Check your connection and try again.
        </Alert>
      )}

      <Stack spacing={3}>
        <Box>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>
            League format
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {LEAGUE_TEMPLATES.map((option) => {
              const selected = option.id === leagueType;
              return (
                <Card
                  key={option.id}
                  variant="outlined"
                  sx={{
                    flex: 1,
                    borderColor: selected ? 'primary.main' : 'divider',
                    borderWidth: selected ? 2 : 1,
                    bgcolor: selected ? 'var(--accent-soft)' : 'background.paper',
                  }}
                >
                  <CardActionArea
                    onClick={() => setLeagueType(option.id)}
                    aria-pressed={selected}
                    aria-label={`${option.name} format`}
                    sx={{ p: 2, height: '100%', alignItems: 'flex-start' }}
                  >
                    <Stack spacing={0.75} alignItems="flex-start">
                      <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }}>
                        {option.name}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {option.description}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {roundsForTemplate(option)} rounds
                      </Typography>
                    </Stack>
                  </CardActionArea>
                </Card>
              );
            })}
          </Stack>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel id="sim-teams-label">Managers</InputLabel>
            <Select
              labelId="sim-teams-label"
              label="Managers"
              value={totalTeams}
              onChange={(event) => handleTeamsChange(Number(event.target.value))}
            >
              {TEAM_OPTIONS.map((count) => (
                <MenuItem key={count} value={count}>{count} teams</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel id="sim-slot-label">Your draft slot</InputLabel>
            <Select
              labelId="sim-slot-label"
              label="Your draft slot"
              value={userSlot}
              onChange={(event) => setUserSlot(
                event.target.value === 'random' ? 'random' : Number(event.target.value)
              )}
            >
              <MenuItem value="random">Random</MenuItem>
              {slotOptions.map((slot) => (
                <MenuItem key={slot} value={slot}>Pick {slot}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Box>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
            Pick clock
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={clockSeconds}
            onChange={(_event, value) => value != null && setClockSeconds(value)}
            aria-label="Pick clock"
          >
            {CLOCK_OPTIONS.map((seconds) => (
              <ToggleButton key={seconds} value={seconds} aria-label={CLOCK_LABELS[seconds]}>
                {CLOCK_LABELS[seconds]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
            {clockSeconds > 0
              ? 'Run out of time and the auto-drafter takes the best available player for you.'
              : 'Take as long as you like. Nothing auto-drafts.'}
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {totalTeams}-team {template.name} · {rounds} rounds ·{' '}
            {totalTeams * rounds} total picks · {starterCount(template)} starters
            {' '}plus {SIM_BENCH_SLOTS} bench spots
          </Typography>
        </Paper>

        <Box>
          <Button type="submit" variant="contained" size="large" disabled={loading}>
            {loading ? 'Loading players…' : 'Start mock draft'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

export default SimConfigForm;
