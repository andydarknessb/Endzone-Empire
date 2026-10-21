import React, { useRef } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { PsButton } from '../../shared/ui/playselect';

// The Play-select dialog (ADR 0067): a 6px double frame on the Field scrim, as
// the Lineup Drop dialog wears it. Shared by the Draft room's three dialogs.
export const PS_DIALOG_PROPS = {
  PaperProps: {
    className: 'ps-root',
    sx: {
      borderRadius: 0,
      backgroundImage: 'none',
      backgroundColor: 'var(--ps-panel)',
      color: 'var(--ps-ink)',
      border: '6px double var(--ps-frame)',
    },
  },
  BackdropProps: { sx: { backgroundColor: 'color-mix(in srgb, var(--ps-field) 85%, transparent)' } },
};

export const PS_DIALOG_TEXT_SX = { color: 'var(--ps-ink)' };

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
  const confirmRef = useRef(null);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="draft-pick-confirm-title"
      TransitionProps={{ onEntered: () => confirmRef.current?.focus() }}
      {...PS_DIALOG_PROPS}
    >
      <DialogTitle id="draft-pick-confirm-title">Draft {playerName}?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={PS_DIALOG_TEXT_SX}>
          Drafting {playerName} advances the draft for everyone right away. Once made, this pick
          can&apos;t be undone by you; only the commissioner can correct it afterward.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <PsButton onClick={onCancel}>Cancel</PsButton>
        <PsButton ref={confirmRef} variant="fill" onClick={onConfirm} autoFocus>
          Draft {playerName}
        </PsButton>
      </DialogActions>
    </Dialog>
  );
}
