import React from 'react';
import { Box, Chip, Button, IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

/** Status chip row (reconnecting/on-the-clock/timer + controls) and the
 * "you're on the clock" snackbar. The prominent pick-clock display lives in
 * LiveDraftBanner, rendered separately so it can stay sticky on its own. */
function DraftStatusBar({
  league,
  onTheClock,
  secondsLeft,
  reconnecting,
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
            sx={MIN_TOUCH_TARGET_SX}
          >
            {soundOn ? <NotificationsActiveIcon fontSize="small" /> : <NotificationsOffIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        {isCommissioner && league?.draft_status === 'pending' && (
          <Button variant="outlined" size="small" onClick={onRandomizeOrder} sx={{ minHeight: 44 }}>
            Randomize Draft Order
          </Button>
        )}
        {isCommissioner && league?.draft_status === 'active' && (
          <Button variant="outlined" size="small" onClick={onTogglePause} sx={{ minHeight: 44 }}>
            {league?.draft_paused ? 'Resume Draft' : 'Pause Draft'}
          </Button>
        )}
      </Box>

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
