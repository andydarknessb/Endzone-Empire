import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

/**
 * Focused confirmation in front of every manual Pick: names the specific
 * player and states that shared draft state advances immediately and can't
 * be undone by the manager who made it (CONTEXT.md's Pick entry; issue #120
 * acceptance criterion 3). Commissioner correction is a separate
 * administrative act (DraftDayControls' Correct latest Pick, #439) and stays
 * untouched here - this dialog never offers it, and confirming never introduces
 * a manager-level post-commit undo (acceptance criterion 4).
 */
export default function DraftPickConfirmDialog({ open, playerName, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby="draft-pick-confirm-title">
      <DialogTitle id="draft-pick-confirm-title">Draft {playerName}?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Drafting {playerName} advances the draft for everyone right away. Once made, this pick
          can&apos;t be undone by you; only the commissioner can correct it afterward.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} sx={MIN_TOUCH_TARGET_SX}>Cancel</Button>
        <Button variant="contained" color="success" onClick={onConfirm} autoFocus sx={MIN_TOUCH_TARGET_SX}>
          Draft {playerName}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
