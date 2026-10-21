import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Stack, TextField } from '@mui/material';
import { PsButton } from '../../shared/ui/playselect';
import { PS_DIALOG_PROPS } from './DraftPickConfirmDialog';

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
      {...PS_DIALOG_PROPS}
      PaperProps={{ ...PS_DIALOG_PROPS.PaperProps, component: 'form', onSubmit }}
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
        <PsButton variant="quiet" to={`/league/${leagueId}/draft-settings`} onClick={onClose}>
          All draft settings →
        </PsButton>
        <PsButton onClick={onClose}>Cancel</PsButton>
        <PsButton type="submit" variant="fill" disabled={saving}>
          Save
        </PsButton>
      </DialogActions>
    </Dialog>
  );
}

export default DraftSettingsPanel;
