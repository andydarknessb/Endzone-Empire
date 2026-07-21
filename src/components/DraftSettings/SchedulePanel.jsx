import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Typography } from '@mui/material';

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function validateDraftDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Enter a valid draft date and time.';
  if (date.getTime() <= Date.now()) return 'Choose a draft date and time in the future.';
  return '';
}

export default function SchedulePanel({ league, teamCount, frozen, onSave, onStart, saving, onDirtyChange }) {
  const [draftDate, setDraftDate] = useState(localDateTime(league.draft_date));
  const [draftDateError, setDraftDateError] = useState(() => validateDraftDate(localDateTime(league.draft_date)));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState('');
  const startInFlight = useRef(false);
  useEffect(() => {
    const nextDraftDate = localDateTime(league.draft_date);
    setDraftDate(nextDraftDate);
    setDraftDateError(validateDraftDate(nextDraftDate));
  }, [league.draft_date]);
  useEffect(() => {
    onDirtyChange(draftDate !== localDateTime(league.draft_date));
  }, [draftDate, league.draft_date, onDirtyChange]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parsedDraftDate = draftDate ? new Date(draftDate) : null;
  const utcPreview = parsedDraftDate && !Number.isNaN(parsedDraftDate.getTime()) ? parsedDraftDate.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'No draft scheduled';
  const minimumDraftDate = localDateTime(new Date());
  const auctionUnavailable = league.draft_type === 'auction';
  const minimumTeams = Number.isInteger(Number(league.min_teams)) ? Number(league.min_teams) : 2;
  const insufficientTeams = teamCount < minimumTeams;
  const handleDraftDateChange = (event) => {
    const value = event.target.value;
    setDraftDate(value);
    setDraftDateError(validateDraftDate(value));
  };
  const handleSave = () => {
    const validationError = validateDraftDate(draftDate);
    setDraftDateError(validationError);
    if (validationError) return;
    onSave({ draftDate: draftDate ? new Date(draftDate).toISOString() : null }, 'Draft schedule saved');
  };
  const openStartConfirmation = () => {
    setStartError('');
    setConfirmOpen(true);
  };
  const closeStartConfirmation = () => {
    if (startInFlight.current) return;
    setStartError('');
    setConfirmOpen(false);
  };
  const handleStart = async () => {
    if (startInFlight.current) return;
    startInFlight.current = true;
    setStartPending(true);
    setStartError('');
    try {
      const result = await onStart();
      if (!result?.success) {
        setStartError(result?.error || 'The draft could not be started.');
        return;
      }
      setConfirmOpen(false);
    } catch (error) {
      setStartError(error?.response?.data?.error || error?.message || 'The draft could not be started.');
    } finally {
      startInFlight.current = false;
      setStartPending(false);
    }
  };
  return (
    <Stack spacing={2}>
      {frozen && <Alert severity="info">Scheduling is locked after the draft starts.</Alert>}
      {auctionUnavailable && <Alert severity="info">Live salary-cap auctions are coming soon. Scheduling and immediate start are unavailable.</Alert>}
      <TextField label="Draft date and time" type="datetime-local" InputLabelProps={{ shrink: true }} sx={(theme) => ({ maxWidth: 310, colorScheme: theme.palette.mode })} value={draftDate} disabled={frozen || auctionUnavailable} inputProps={{ min: minimumDraftDate }} error={Boolean(draftDateError)} helperText={draftDateError} onChange={handleDraftDateChange} />
      <Typography variant="caption" color="text.secondary">Local timezone: {zone}. {utcPreview}</Typography>
      <Typography variant="caption" color={insufficientTeams ? 'error' : 'text.secondary'}>{teamCount} of {minimumTeams} required teams have joined.</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" disabled={frozen || saving || auctionUnavailable || Boolean(draftDateError)} onClick={handleSave}>Save schedule</Button>
        <Button variant="outlined" disabled={frozen || saving || startPending || auctionUnavailable || insufficientTeams} onClick={openStartConfirmation}>Start Draft Now</Button>
      </Box>
      <Dialog open={confirmOpen} onClose={closeStartConfirmation}>
        <DialogTitle>Start draft now?</DialogTitle>
        <DialogContent><DialogContentText>This starts immediately for all {teamCount} managers and can&apos;t be easily undone.</DialogContentText>{startError && <Alert severity="error" sx={{ mt: 2 }}>{startError}</Alert>}</DialogContent>
        <DialogActions><Button disabled={startPending} onClick={closeStartConfirmation}>Cancel</Button><Button variant="contained" disabled={saving || startPending} onClick={handleStart}>{startPending ? 'Starting…' : 'Start now'}</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

SchedulePanel.propTypes = { league: PropTypes.object.isRequired, teamCount: PropTypes.number.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, onStart: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
