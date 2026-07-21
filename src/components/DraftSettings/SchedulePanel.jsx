import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Typography } from '@mui/material';

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function SchedulePanel({ league, teamCount, frozen, onSave, onStart, saving }) {
  const [draftDate, setDraftDate] = useState(localDateTime(league.draft_date));
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setDraftDate(localDateTime(league.draft_date)), [league.draft_date]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const utcPreview = draftDate ? new Date(draftDate).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'No draft scheduled';
  return (
    <Stack spacing={2}>
      {frozen && <Alert severity="info">Scheduling is locked after the draft starts.</Alert>}
      <TextField label="Draft date and time" type="datetime-local" InputLabelProps={{ shrink: true }} sx={(theme) => ({ maxWidth: 310, colorScheme: theme.palette.mode })} value={draftDate} disabled={frozen} onChange={(event) => setDraftDate(event.target.value)} />
      <Typography variant="caption" color="text.secondary">Local timezone: {zone}. {utcPreview}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" disabled={frozen || saving} onClick={() => onSave({ draftDate: draftDate ? new Date(draftDate).toISOString() : null }, 'Draft schedule saved')}>Save schedule</Button>
        <Button variant="outlined" disabled={frozen || saving} onClick={() => setConfirmOpen(true)}>Start Draft Now</Button>
      </Box>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Start draft now?</DialogTitle>
        <DialogContent><DialogContentText>This starts immediately for all {teamCount} managers and can&apos;t be easily undone.</DialogContentText></DialogContent>
        <DialogActions><Button onClick={() => setConfirmOpen(false)}>Cancel</Button><Button variant="contained" onClick={async () => { await onStart(); setConfirmOpen(false); }}>Start now</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

SchedulePanel.propTypes = { league: PropTypes.object.isRequired, teamCount: PropTypes.number.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, onStart: PropTypes.func.isRequired, saving: PropTypes.bool };
