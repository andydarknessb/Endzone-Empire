import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Box, MenuItem, Stack } from '@mui/material';
import { Dim, KitSelect, KitTextField, Note, PsButton } from './kit';
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
      {active && <Note>Clock changes apply from the next pick. Pause and resume to re-arm the clock immediately.</Note>}
      {frozen && !active && <Note>Timer settings are locked after the draft ends.</Note>}
      <KitSelect id="pick-clock" label="Pick clock" sx={{ maxWidth: 240 }} disabled={frozen && !active} error={Boolean(clockError)} helperText={clockError} value={clock} onChange={(event) => setClock(Number(event.target.value))}>{CLOCKS.map((seconds) => <MenuItem key={seconds} value={seconds}>{seconds === 0 ? 'Untimed' : `${seconds} seconds`}</MenuItem>)}</KitSelect>
      <KitTextField id="autodraft-delay" label="Autodraft delay (seconds)" type="number" sx={{ maxWidth: 240 }} inputProps={{ min: 1, max: 60 }} disabled={frozen} value={delay} error={Boolean(delayError)} helperText={delayError} onChange={(event) => setDelay(event.target.value)} />
      <Dim>Autodraft delay applies whenever the on-clock Team is on Autodraft.</Dim>
      <Box><PsButton disabled={(frozen && !active) || saving || hasInvalidTimer} onClick={() => active ? onSetClock(Number(clock)) : onSave({ pickTimeSeconds: Number(clock), autodraftDelaySeconds: Number(delay) }, 'Timer saved')}>Save timer</PsButton></Box>
    </Stack>
  );
}

TimerPanel.propTypes = { league: PropTypes.object.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, onSetClock: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
