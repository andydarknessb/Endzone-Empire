import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import { Frame, PsButton } from '../../shared/ui/playselect';
import { teamNameLabel } from '../../shared/lib/teamIdentity';
import { PS_DIALOG_PROPS, PS_DIALOG_TEXT_SX } from './DraftPickConfirmDialog';

const REASON_MIN = 10;
const REASON_MAX = 200;
const DANGER_TEXT = { color: 'var(--ps-danger)' };

/**
 * The active-draft commissioner toolbar (#439). It places the state-correct
 * controls beside the feed: Pause/Resume and the safe, reasoned Correct latest
 * Pick together, with the destructive Reset kept visually and behaviourally
 * separate (a typed-name confirmation). There is no Stop control. Server
 * broadcasts remain the source of truth after each action.
 *
 * Correct latest Pick is NOT a manager undo: it names the exact Pick, Team and
 * player being reversed, requires a 10-200 character reason, and reverses only
 * the latest non-keeper Pick as one atomic act that leaves the draft paused
 * (the server enforces all of this; this dialog gathers the reason and the
 * confirmed pick number).
 */
export default function DraftDayControls({ league, picks, onTogglePause, onCorrect, onReset, onGetShareLink }) {
  const [correctOpen, setCorrectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetName, setResetName] = useState('');
  // MUI's focus trap lands on the dialog container after the transition in
  // Chromium, so autoFocus alone loses; focus Cancel once it has entered.
  const cancelRef = useRef(null);
  // ...but never pull focus out of the League name field once someone is in it.
  const focusCancelUnlessTyping = () => {
    if (!document.activeElement?.matches('input, textarea')) cancelRef.current?.focus();
  };
  const [sharing, setSharing] = useState(false);
  const [shareLink, setShareLink] = useState('');

  const lastReachedPick = useMemo(() => [...picks]
    .filter((pick) => pick.pick_number <= (league.current_pick ?? 0))
    .sort((a, b) => b.pick_number - a.pick_number)[0], [league.current_pick, picks]);
  const correctDisabled = !lastReachedPick || !!lastReachedPick.is_keeper;

  const reasonLength = reason.trim().length;
  const reasonValid = reasonLength >= REASON_MIN && reasonLength <= REASON_MAX;

  const copyPresenterLink = async () => {
    setSharing(true);
    const url = await onGetShareLink();
    if (url) setShareLink(url);
    setSharing(false);
  };

  const closeCorrect = () => {
    setCorrectOpen(false);
    setReason('');
  };

  const submitCorrection = async () => {
    if (!reasonValid || !lastReachedPick) return;
    const ok = await onCorrect({ pickNumber: lastReachedPick.pick_number, reason: reason.trim() });
    if (ok) closeCorrect();
  };

  return (
    <Frame tier="rule" component="section" aria-label="Commissioner draft controls" sx={{ p: 1.5, mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <PsButton onClick={onTogglePause}>
          {league.draft_paused ? 'Resume Draft' : 'Pause Draft'}
        </PsButton>
        <PsButton onClick={() => setCorrectOpen(true)} disabled={correctDisabled}>Correct latest Pick</PsButton>
        <PsButton onClick={() => setResetOpen(true)} style={DANGER_TEXT}>Reset draft</PsButton>
        <PsButton onClick={copyPresenterLink} disabled={sharing}>{sharing ? 'Creating link…' : 'Presenter link'}</PsButton>
      </Box>
      {shareLink && <TextField label="Presenter link" value={shareLink} fullWidth size="small" inputProps={{ readOnly: true }} sx={{ mt: 1 }} />}
      {lastReachedPick?.is_keeper && <Alert severity="info" sx={{ mt: 1 }}>Keeper picks cannot be corrected.</Alert>}

      <Dialog open={correctOpen} onClose={closeCorrect} fullWidth maxWidth="sm" {...PS_DIALOG_PROPS}>
        <DialogTitle>Correct latest pick?</DialogTitle>
        <DialogContent>
          {lastReachedPick && (
            <DialogContentText component="div" sx={PS_DIALOG_TEXT_SX}>
              This pauses the draft and reverses{' '}
              <strong>{`Pick ${lastReachedPick.pick_number}`}</strong>
              {' · '}
              {/* Attribute by Team through the shared identity helper, the same
                  way PickHistory and the feed render a Team (a departed team
                  reads as a former manager, never blank). */}
              <strong>{teamNameLabel(lastReachedPick.teamName)}</strong>
              {' · '}
              <strong>{lastReachedPick.name || 'this player'}</strong>
              . The draft stays paused until you resume it, and the correction is recorded with your reason.
            </DialogContentText>
          )}
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Reason (10 to 200 characters)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reasonLength > REASON_MAX}
            helperText={`${reasonLength}/${REASON_MAX}`}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <PsButton onClick={closeCorrect}>Cancel</PsButton>
          <PsButton variant="fill" disabled={!reasonValid} onClick={submitCorrection}>Correct pick</PsButton>
        </DialogActions>
      </Dialog>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        TransitionProps={{ onEntered: focusCancelUnlessTyping }}
        {...PS_DIALOG_PROPS}
      >
        <DialogTitle>Reset {league.name} draft?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={PS_DIALOG_TEXT_SX}>This deletes every draft pick and drafted roster entry, clears the schedule, and returns the draft to pending. Type the league name to continue.</DialogContentText>
          <TextField fullWidth label="League name" value={resetName} onChange={(event) => setResetName(event.target.value)} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions>
          {/* Cancel takes initial focus: the destructive confirm is a ghost with Danger text (wave 3 Drop dialog ruling). */}
          <PsButton ref={cancelRef} autoFocus onClick={() => setResetOpen(false)}>Cancel</PsButton>
          <PsButton
            disabled={resetName !== league.name}
            style={resetName === league.name ? DANGER_TEXT : undefined}
            onClick={async () => { if (await onReset()) { setResetOpen(false); setResetName(''); } }}
          >
            Reset draft
          </PsButton>
        </DialogActions>
      </Dialog>
    </Frame>
  );
}
