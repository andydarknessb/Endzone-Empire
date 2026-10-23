import React, { useRef } from 'react';
import { Box, Dialog, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { PsButton } from '../../../shared/ui/playselect';

/**
 * The drop confirmation dialog (#1237, restated from LineupScreen.jsx).
 * `aria-describedby` pairs the dialog with its consequences paragraph (MUI's
 * own documented Dialog/DialogContentText pairing) so a screen reader
 * announces what dropping does on open, not just the title.
 *
 * Play-select (ADR 0067 wave 3, spec #2347 ruling 3): a 6px double frame, the title in Archivo 700
 * (it carries a player name, never pixel type), "Cancel" with the default focus, and "Drop" a ghost
 * with Danger text. MUI's focus trap puts focus on the dialog container once the transition ends,
 * which beats `autoFocus` on a child in Chromium, so Cancel is focused from `onEntered` instead.
 */
export default function DropConfirmationDialog({ entry, onClose, onConfirm }) {
  const cancelRef = useRef(null);
  return (
    <Dialog
      open={Boolean(entry)}
      onClose={onClose}
      aria-labelledby="drop-player-dialog-title"
      aria-describedby="drop-player-dialog-description"
      TransitionProps={{ onEntered: () => cancelRef.current?.focus() }}
      PaperProps={{
        className: 'ps-root',
        sx: {
          width: '100%',
          maxWidth: '480px',
          m: '16px',
          borderRadius: 0,
          backgroundImage: 'none',
          boxShadow: 'none',
          backgroundColor: 'var(--ps-panel)',
          color: 'var(--ps-ink)',
          border: '6px double var(--ps-frame)',
          fontFamily: 'inherit',
        },
      }}
    >
      <DialogTitle
        id="drop-player-dialog-title"
        sx={{ p: '14px 20px', borderBottom: '2px solid var(--ps-rule)', fontFamily: 'inherit', fontSize: '20px', fontWeight: 700, lineHeight: 1.3 }}
      >
        Drop {entry?.name}?
      </DialogTitle>
      <DialogContent sx={{ p: '20px !important' }}>
        <DialogContentText
          id="drop-player-dialog-description"
          sx={{ fontSize: '16px', color: 'var(--ps-ink)', fontFamily: 'inherit' }}
        >
          {entry?.name} leaves your Team and becomes available to every other manager in the
          league. The slot stays empty until you fill it. You can undo right after dropping,
          but not once another manager claims the player.
        </DialogContentText>
      </DialogContent>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '12px', p: '14px 20px', borderTop: '2px solid var(--ps-rule)' }}>
        <PsButton ref={cancelRef} onClick={onClose}>Cancel</PsButton>
        <PsButton style={{ color: 'var(--ps-danger)' }} onClick={onConfirm}>Drop</PsButton>
      </Box>
    </Dialog>
  );
}
