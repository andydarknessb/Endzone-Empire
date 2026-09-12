import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

/**
 * The drop confirmation dialog (#1237, restated from LineupScreen.jsx).
 * `aria-describedby` pairs the dialog with its consequences paragraph (MUI's
 * own documented Dialog/DialogContentText pairing) so a screen reader
 * announces what dropping does on open, not just the title.
 */
export default function DropConfirmationDialog({ entry, onClose, onConfirm }) {
  return (
    <Dialog
      open={Boolean(entry)}
      onClose={onClose}
      aria-labelledby="drop-player-dialog-title"
      aria-describedby="drop-player-dialog-description"
    >
      <DialogTitle id="drop-player-dialog-title">Drop {entry?.name}?</DialogTitle>
      <DialogContent>
        <DialogContentText id="drop-player-dialog-description">
          {entry?.name} leaves your Team and becomes available to every other manager in the
          league. His slot will be empty until you fill it. You can undo right after dropping,
          but not once another manager claims him.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          Drop
        </Button>
      </DialogActions>
    </Dialog>
  );
}
