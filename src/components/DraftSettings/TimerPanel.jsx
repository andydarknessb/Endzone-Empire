import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Box, Button, FormControl, FormHelperText, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { integerRangeError } from './numericValidation';

const CLOCKS = [0, 30, 60, 90, 120, 180, 300];
export default function TimerPanel({ league, frozen, onSave, onSetClock, saving, onDirtyChange }) {
  const [clock, setClock] = useState(league.pick_time_seconds ?? 60);
  const [delay, setDelay] = useState(league.autodraft_delay_seconds ?? 10);
  useEffect(() => { setClock(league.pick_time_seconds ?? 60); setDelay(league.autodraft_delay_seconds ?? 10); }, [league.pick_time_seconds, league.autodraft_delay_seconds]);
  useEffect(() => {
    onDirtyChange(Number(clock) !== (league.pick_time_seconds ?? 60) || Number(delay) !== (league.autodraft_delay_seconds ?? 10));
  }, [clock, delay, league.autodraft_delay_seconds, league.pick_time_seconds, onDirtyChange]);
  const active = league.draft_status === 'active';
  const clockError = integerRangeError(clock, { label: 'Pick clock', min: 0, max: 3600 });
  const delayError = integerRangeError(delay, { label: 'Autodraft delay', min: 1, max: 60 });
  const hasInvalidTimer = Boolean(clockError || (!active && delayError));
  return (
    <Stack spacing={2}>
      {active && <Alert severity="info">Clock changes apply from the next pick. Pause and resume to re-arm the clock immediately.</Alert>}
      {frozen && !active && <Alert severity="info">Timer settings are locked after the draft ends.</Alert>}
      <FormControl size="small" sx={{ maxWidth: 240 }} disabled={frozen && !active} error={Boolean(clockError)}><InputLabel id="pick-clock-label">Pick clock</InputLabel><Select labelId="pick-clock-label" label="Pick clock" value={clock} onChange={(event) => setClock(Number(event.target.value))}>{CLOCKS.map((seconds) => <MenuItem key={seconds} value={seconds}>{seconds === 0 ? 'Untimed' : `${seconds} seconds`}</MenuItem>)}</Select>{clockError && <FormHelperText>{clockError}</FormHelperText>}</FormControl>
      <TextField label="Autodraft delay (seconds)" type="number" size="small" sx={{ maxWidth: 240 }} inputProps={{ min: 1, max: 60 }} disabled={frozen} value={delay} error={Boolean(delayError)} helperText={delayError} onChange={(event) => setDelay(event.target.value)} />
      <Typography variant="caption" color="text.secondary">Autodraft delay applies when the on-clock manager enables autodraft.</Typography>
      <Box><Button variant="contained" disabled={(frozen && !active) || saving || hasInvalidTimer} onClick={() => active ? onSetClock(Number(clock)) : onSave({ pickTimeSeconds: Number(clock), autodraftDelaySeconds: Number(delay) }, 'Timer saved')}>Save timer</Button></Box>
    </Stack>
  );
}

TimerPanel.propTypes = { league: PropTypes.object.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, onSetClock: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
