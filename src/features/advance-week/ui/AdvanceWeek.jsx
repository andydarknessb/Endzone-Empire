import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from '@mui/material';
import apiClient from '../../../api/apiClient';

/**
 * advance-week feature (ADR 0020): the commissioner's control to close the
 * current scoring week and open the next. A sentence stating the consequence, a
 * button that opens a confirm dialog, and - after a refusal - the server's own
 * message.
 *
 * This feature owns the POST and its outcome ONLY. Landing the cached league
 * refetch on success is the PANEL's job, handed in as `onAdvanced`: advancing
 * changes `league.current_week`, and the standings widgets are keyed on that
 * week (useStandings, #641), so the league refetch is what re-reads them. This
 * feature deliberately does NOT touch the standings cache. If it called
 * clearStandingsCache here, that invalidation would reload every standings
 * table still mounted on the prior week's key BEFORE the league refetch re-keys
 * them to the new week, firing one standings request that the re-key then fires
 * again - two reads where the week key already guarantees one fresh read. So a
 * clear here does not reflect the new standings any sooner; it only doubles the
 * request.
 *
 * The 409 path is a contract. The phase gate refuses a fantasy league whose
 * draft has not finished with a manager-readable sentence, and this renders
 * that sentence VERBATIM (`err.response.data.error`) in an alert region, never
 * a message it builds from the status code. The button stays enabled so the
 * commissioner can retry once the draft completes.
 */
export default function AdvanceWeek({ leagueId, currentWeek, onAdvanced }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const nextWeek = Number(currentWeek) + 1;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/scoring/league/${leagueId}/advance-week`);
      setOpen(false);
      if (typeof onAdvanced === 'function') onAdvanced();
    } catch (err) {
      // Render exactly what the server sent. The transport-level fallback is
      // only for a failure that carries no server sentence (a dropped
      // connection has no 409 body to quote); a real phase-gate 409 always
      // has `response.data.error`, so that is what shows.
      setOpen(false);
      setError(err?.response?.data?.error || err?.message || 'Could not advance the week.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-testid="advance-week" sx={{ display: 'grid', gap: 1.25 }}>
      <Typography sx={{ fontSize: '13px', lineHeight: 1.4, color: 'var(--dash-dim)' }}>
        {`Advancing closes Week ${currentWeek} matchups and opens Week ${nextWeek}. You'll be asked to confirm.`}
      </Typography>

      <Box>
        <Button
          type="button"
          variant="outlined"
          size="small"
          disabled={busy}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          // The dashboard island's own tokens (ADR 0020): ink label over the
          // page card, the accent line on hover, both registered pairings in
          // tokens.contrast.test.js. No new pairing is composed here.
          sx={{
            textTransform: 'none',
            color: 'var(--dash-ink)',
            // The 44px touch floor, phone widths only. Breakpoint-scoped
            // rather than the flat MIN_TOUCH_TARGET_SX because this is a
            // size="small" outlined control: an unconditional 44 would grow it
            // by 13px on desktop, where a pointer needs no floor. It measured
            // 30.75px at every width before this, and it is the control that
            // advances a whole league's week.
            minHeight: { xs: 44, md: 'auto' },
            borderColor: 'var(--dash-line-strong)',
            borderRadius: 'var(--dash-radius-sm)',
            fontFamily: 'var(--dash-font-body)',
            fontWeight: 600,
            fontSize: '13px',
            '&:hover': {
              borderColor: 'var(--dash-accent-line)',
              backgroundColor: 'transparent',
            },
          }}
        >
          {`Advance to Week ${nextWeek}`}
        </Button>
      </Box>

      {/* The server's refusal, verbatim. MUI Alert carries role="alert", so a
          screen reader hears it when it appears; the message text is exactly
          the string the 409 carried. */}
      {error && (
        <Alert severity="error" sx={{ fontSize: '13px' }}>
          {error}
        </Alert>
      )}

      {/* aria-describedby names the consequence sentence, not only the title:
          MUI moves focus to the first action (Cancel) on open, so without it a
          screen reader announces the dialog name and the focused button but not
          the "cannot be undone" warning, and this action is irreversible. */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        aria-labelledby="advance-week-dialog-title"
        aria-describedby="advance-week-dialog-description"
      >
        <DialogTitle id="advance-week-dialog-title">{`Advance to Week ${nextWeek}?`}</DialogTitle>
        <DialogContent>
          <DialogContentText id="advance-week-dialog-description">
            {`This closes Week ${currentWeek} matchups and opens Week ${nextWeek}. Week ${currentWeek} is scored as played, and this cannot be undone from here.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} variant="contained" disabled={busy}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
