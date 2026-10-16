import React from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { PsAction } from '../../../shared/ui/playselect/LineupParts';

/**
 * The drop confirmation dialog (#1237, restated from LineupScreen.jsx).
 * `aria-describedby` pairs the dialog with its consequences paragraph (MUI's
 * own documented Dialog/DialogContentText pairing) so a screen reader
 * announces what dropping does on open, not just the title.
 *
 * `look` is `'dash'` (default, PlayerManagement) or `'playselect'` (ADR 0067 wave 3, spec #2347
 * ruling 3; the Lineup page): a 6px double frame, the title in Archivo 700 (it carries a player name,
 * never pixel type), "Cancel" with the default focus, and "Drop" a ghost with Danger text.
 */
export default function DropConfirmationDialog({ entry, onClose, onConfirm, look = 'dash' }) {
  const ps = look === 'playselect';
  return (
    <Dialog
      open={Boolean(entry)}
      onClose={onClose}
      aria-labelledby="drop-player-dialog-title"
      aria-describedby="drop-player-dialog-description"
      {...(ps ? {
        PaperProps: {
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
        },
      } : null)}
    >
      <DialogTitle
        id="drop-player-dialog-title"
        sx={ps ? { p: '14px 20px', borderBottom: '2px solid var(--ps-rule)', fontFamily: 'inherit', fontSize: '20px', fontWeight: 700, lineHeight: 1.3 } : undefined}
      >
        Drop {entry?.name}?
      </DialogTitle>
      <DialogContent sx={ps ? { p: '20px !important' } : undefined}>
        <DialogContentText
          id="drop-player-dialog-description"
          sx={ps ? { fontSize: '16px', color: 'var(--ps-ink)', fontFamily: 'inherit' } : undefined}
        >
          {entry?.name} leaves your Team and becomes available to every other manager in the
          league. The slot stays empty until you fill it. You can undo right after dropping,
          but not once another manager claims the player.
        </DialogContentText>
      </DialogContent>
      {ps ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '12px', p: '14px 20px', borderTop: '2px solid var(--ps-rule)' }}>
          <PsAction autoFocus onClick={onClose}>Cancel</PsAction>
          <PsAction danger onClick={onConfirm}>Drop</PsAction>
        </Box>
      ) : (
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" color="error" onClick={onConfirm}>
            Drop
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
