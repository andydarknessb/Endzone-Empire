import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

// The "unsaved changes" prompt. NavigationGuard loads it only once a transition
// is first blocked, so pages that never block do not ship the Dialog.
export default function DiscardChangesDialog({ open, onKeepEditing, onDiscard, discardDisabled }) {
  return (
    <Dialog open={open} onClose={onKeepEditing}>
      <DialogTitle>You have unsaved changes. Discard them?</DialogTitle>
      <DialogContent><DialogContentText>Your edits on this tab will be lost.</DialogContentText></DialogContent>
      <DialogActions>
        <Button onClick={onKeepEditing}>Keep editing</Button>
        <Button color="error" variant="contained" disabled={discardDisabled} onClick={onDiscard}>Discard changes</Button>
      </DialogActions>
    </Dialog>
  );
}
