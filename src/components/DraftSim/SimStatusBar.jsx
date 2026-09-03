import React, { useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, LinearProgress, Paper, Stack, Typography,
} from '@mui/material';
// The one pick-clock vocabulary (#754): the sim keeps its own engine seconds
// and its own display rule (timer only on the user's turn), but the format
// and the urgency threshold are the shared ones, not a private copy.
import { formatRemaining, isUrgent } from '../../lib/onTheClock';

/**
 * The persistent draft-room header: where the draft is, who's on the clock,
 * your countdown, and the two controls that matter mid-draft (skip ahead to
 * your pick, or start over).
 */
function SimStatusBar({
  round, rounds, pickNumber, totalPicks, onTheClockName, myTurn,
  secondsLeft, clockSeconds, onSimToMyPick, onRestart,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const progress = totalPicks > 0 ? Math.min(100, ((pickNumber - 1) / totalPicks) * 100) : 0;
  const urgent = myTurn && isUrgent(secondsLeft);

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
              Round
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {round} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>/ {rounds}</Box>
            </Typography>
          </Box>
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
              Pick
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {pickNumber} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>/ {totalPicks}</Box>
            </Typography>
          </Box>
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
              On the clock
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {onTheClockName || '-'}
              </Typography>
              {myTurn && <Chip size="small" color="primary" label="You're up" />}
            </Stack>
          </Box>
          {myTurn && secondsLeft != null && (
            // No aria-live / role="status" here (#805, ADR 0028): the room's
            // shape is one status region per axis, and the once-per-turn
            // announcement is DraftSimulator's job, not this per-second
            // display's. A live region here would read a new time out loud
            // every second for the whole turn. Mirrors the Draft room's
            // PickClock (src/components/DraftBoard/PickClock.jsx), which
            // carries urgency in the digits' colour alone and stays out of
            // any aria-live region for the same reason.
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
                Time left
              </Typography>
              <Typography
                variant="h6"
                sx={{ fontWeight: 800, color: urgent ? 'error.main' : 'text.primary' }}
              >
                {formatRemaining(secondsLeft)}
              </Typography>
            </Box>
          )}
          {!myTurn && clockSeconds > 0 && (
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
                Clock
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                {clockSeconds}s
              </Typography>
            </Box>
          )}
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={onSimToMyPick} disabled={myTurn}>
            Sim to my pick
          </Button>
          <Button variant="text" size="small" color="error" onClick={() => setConfirmOpen(true)}>
            Restart
          </Button>
        </Stack>
      </Stack>

      <LinearProgress
        variant="determinate"
        value={progress}
        aria-label="Draft progress"
        sx={{ mt: 2, height: 6, borderRadius: 3 }}
      />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Restart this mock draft?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Your current board and roster are discarded and you go back to setup. This can&apos;t be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Keep drafting</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirmOpen(false);
              onRestart();
            }}
          >
            Restart
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export default SimStatusBar;
