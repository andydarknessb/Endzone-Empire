import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  TextField,
} from '@mui/material';

/** Commissioner-only active-draft controls. Server broadcasts remain the source of truth after each action. */
export default function DraftDayControls({ league, picks, onUndo, onReset, onGetShareLink }) {
  const [undoOpen, setUndoOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetName, setResetName] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const lastReachedPick = useMemo(() => [...picks]
    .filter((pick) => pick.pick_number <= (league.current_pick ?? 0))
    .sort((a, b) => b.pick_number - a.pick_number)[0], [league.current_pick, picks]);
  const undoDisabled = !lastReachedPick || !!lastReachedPick.is_keeper;
  const copyPresenterLink = async () => {
    setSharing(true);
    const url = await onGetShareLink();
    if (url) setShareLink(url);
    setSharing(false);
  };
  return (
    <Paper component="section" aria-label="Commissioner draft controls" sx={{ p: 1.5, mb: 2, bgcolor: 'action.hover' }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={() => setUndoOpen(true)} disabled={undoDisabled}>Undo last pick</Button>
        <Button variant="outlined" color="error" onClick={() => setResetOpen(true)}>Reset draft</Button>
        <Button variant="outlined" onClick={copyPresenterLink} disabled={sharing}>{sharing ? 'Creating link…' : 'Presenter link'}</Button>
      </Box>
      {shareLink && <TextField label="Presenter link" value={shareLink} fullWidth size="small" inputProps={{ readOnly: true }} sx={{ mt: 1 }} />}
      {lastReachedPick?.is_keeper && <Alert severity="info" sx={{ mt: 1 }}>Keeper picks cannot be undone.</Alert>}
      <Dialog open={undoOpen} onClose={() => setUndoOpen(false)}>
        <DialogTitle>Undo last pick?</DialogTitle>
        <DialogContent><DialogContentText>This restores the last drafted player to the pool and rewinds the draft clock.</DialogContentText></DialogContent>
        <DialogActions><Button onClick={() => setUndoOpen(false)}>Cancel</Button><Button variant="contained" onClick={async () => { if (await onUndo()) setUndoOpen(false); }}>Undo pick</Button></DialogActions>
      </Dialog>
      <Dialog open={resetOpen} onClose={() => setResetOpen(false)}>
        <DialogTitle>Reset {league.name} draft?</DialogTitle>
        <DialogContent>
          <DialogContentText>This deletes every draft pick and drafted roster entry, clears the schedule, and returns the draft to pending. Type the league name to continue.</DialogContentText>
          <TextField autoFocus fullWidth label="League name" value={resetName} onChange={(event) => setResetName(event.target.value)} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions><Button onClick={() => setResetOpen(false)}>Cancel</Button><Button color="error" variant="contained" disabled={resetName !== league.name} onClick={async () => { if (await onReset()) { setResetOpen(false); setResetName(''); } }}>Reset draft</Button></DialogActions>
      </Dialog>
    </Paper>
  );
}
