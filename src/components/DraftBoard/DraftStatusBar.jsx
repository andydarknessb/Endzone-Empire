import React from 'react';
import { Box, Paper, Typography, Chip, Button, IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import Countdown from '../Countdown/Countdown';

// Subtle pulse for the on-clock timer once time is running low (<=10s).
const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.55; }
  100% { opacity: 1; }
`;

/** Sticky status bar (reconnecting/on-the-clock/timer chips + controls), the
 * big pick clock while the draft is active, the pre-draft countdown, and the
 * "you're on the clock" snackbar. */
function DraftStatusBar({
  league,
  onTheClock,
  secondsLeft,
  reconnecting,
  isMyTurn,
  soundOn,
  toggleSound,
  isCommissioner,
  onRandomizeOrder,
  onTogglePause,
  onClockAlertOpen,
  onCloseOnClockAlert,
}) {
  return (
    <>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          bgcolor: 'background.default',
          borderBottom: '1px solid',
          borderColor: 'divider',
          py: 1,
          display: 'flex',
          gap: 1,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {reconnecting && <Chip label="Reconnecting…" color="default" size="small" variant="outlined" />}
        {onTheClock ? (
          <Chip
            label={`On the clock: ${onTheClock.name} (${onTheClock.owner})`}
            color="primary"
            sx={{ fontWeight: 'bold' }}
          />
        ) : (
          <Chip
            label={league?.draft_status || 'Unknown status'}
            color={
              league?.draft_status === 'complete'
                ? 'success'
                : league?.draft_status === 'active'
                ? 'warning'
                : 'default'
            }
          />
        )}
        {secondsLeft !== null && (
          <Chip
            label={`⏱ ${secondsLeft}s`}
            color={secondsLeft <= 10 ? 'error' : 'default'}
            sx={{ fontWeight: 'bold' }}
          />
        )}
        {league?.draft_paused && <Chip label="Draft Paused" color="warning" />}
        <Tooltip title={soundOn ? 'Mute pick sound' : 'Unmute pick sound'}>
          <IconButton
            size="small"
            aria-label={soundOn ? 'Mute pick sound' : 'Unmute pick sound'}
            aria-pressed={soundOn}
            onClick={toggleSound}
          >
            {soundOn ? <NotificationsActiveIcon fontSize="small" /> : <NotificationsOffIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        {isCommissioner && league?.draft_status === 'pending' && (
          <Button variant="outlined" size="small" onClick={onRandomizeOrder}>
            Randomize Draft Order
          </Button>
        )}
        {isCommissioner && league?.draft_status === 'active' && (
          <Button variant="outlined" size="small" onClick={onTogglePause}>
            {league?.draft_paused ? 'Resume Draft' : 'Pause Draft'}
          </Button>
        )}
      </Box>
      {league?.draft_status === 'active' && (
        <Paper variant="outlined" sx={{ mt: 2, p: 3, textAlign: 'center', bgcolor: 'action.hover' }}>
          <Typography variant="h5" sx={{ fontWeight: 'bold', color: isMyTurn ? 'primary.main' : 'text.primary' }}>
            {isMyTurn ? 'Your pick!' : onTheClock ? `${onTheClock.name} is on the clock` : 'Waiting…'}
          </Typography>
          {secondsLeft !== null ? (
            <Typography
              variant="h1"
              data-testid="draft-clock"
              sx={{
                fontWeight: 'bold',
                lineHeight: 1.1,
                color: secondsLeft <= 10 ? 'error.main' : 'text.primary',
                animation: secondsLeft <= 10 ? `${pulse} 1s ease-in-out infinite` : 'none',
              }}
            >
              {secondsLeft}s
            </Typography>
          ) : league?.draft_paused ? (
            <Typography variant="h6" sx={{ color: 'warning.main' }}>
              Draft paused
            </Typography>
          ) : (
            <Typography variant="h6" sx={{ color: 'text.secondary' }}>
              No pick clock
            </Typography>
          )}
        </Paper>
      )}
      {league?.draft_status === 'pending' && league?.draft_date && (
        <Box sx={{ mt: 2 }}>
          <Countdown variant="full" date={league.draft_date} />
        </Box>
      )}

      <Snackbar
        open={onClockAlertOpen}
        autoHideDuration={6000}
        onClose={onCloseOnClockAlert}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={onCloseOnClockAlert} severity="info" variant="filled" sx={{ fontWeight: 'bold' }}>
          You&apos;re on the clock!
        </Alert>
      </Snackbar>
    </>
  );
}

export default DraftStatusBar;
