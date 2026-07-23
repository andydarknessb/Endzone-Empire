import React from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogTitle, DialogContent, DialogActions, Stack, TextField, Button } from '@mui/material';

/** Commissioner-only pre-draft settings (pick clock + autodraft delay), in a
 * Dialog so it stays out of the way until opened from the header gear icon. */
function DraftSettingsPanel({
  open,
  onClose,
  pickTimeSeconds,
  onPickTimeSecondsChange,
  autodraftDelaySeconds,
  onAutodraftDelaySecondsChange,
  onSubmit,
  saving,
  leagueId,
  draftStatus,
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ component: 'form', onSubmit }}
    >
      <DialogTitle>Draft Settings</DialogTitle>
      <DialogContent>
        <Stack direction="column" spacing={3} sx={{ mt: 1 }}>
          <TextField
            label="Pick clock (sec)"
            helperText="0 = untimed"
            type="number"
            size="small"
            fullWidth
            inputProps={{ min: 0, max: 3600 }}
            value={pickTimeSeconds}
            onChange={(e) => onPickTimeSecondsChange(e.target.value)}
          />
          <TextField
            label="Autodraft delay"
            helperText="seconds"
            type="number"
            size="small"
            fullWidth
            inputProps={{ min: 1, max: 60 }}
            value={autodraftDelaySeconds}
            onChange={(e) => onAutodraftDelaySecondsChange(e.target.value)}
            disabled={draftStatus === 'active'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button component={Link} to={`/league/${leagueId}/draft-settings`} onClick={onClose}>All draft settings →</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DraftSettingsPanel;
