import React from 'react';
import { Box, Chip, Button, IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { draftStatusLabel, draftStatusChipColor } from './draftStatusCopy';

/** Status chip row (reconnecting/on-the-clock/timer) and the "you're on the
 * clock" snackbar, plus the controls that used to sit inside that same row.
 * The prominent pick-clock display lives in LiveDraftBanner, rendered
 * separately so it can stay sticky on its own.
 *
 * Two groups, not one (issue #123 acceptance criterion 6). Everything here
 * used to be a single flex row, so the mute toggle - a per-manager setting
 * that changes nothing about the draft - read as one more fact about the
 * draft's state, sitting between "Draft Paused" and the commissioner's pause
 * button. Status is now what the draft is doing, and controls are what you
 * can do about it: separated visually, and named separately in the
 * accessibility tree so the distinction is not carried by spacing alone. */
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
        {/* What the draft is doing. */}
        <Box role="group" aria-label="Draft status" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {reconnecting && <Chip label="Reconnecting…" color="default" size="small" variant="outlined" />}
          {onTheClock ? (
            <Chip
              label={`On the clock: ${onTheClock.teamName}`}
              color="primary"
              sx={{ fontWeight: 'bold' }}
            />
          ) : (
            <Chip
              // Product language, never the stored enum, and the color that
              // goes with it - both from the one place that knows how a
              // status is spoken (see draftStatusCopy).
              label={draftStatusLabel(league?.draft_status)}
              color={draftStatusChipColor(league?.draft_status)}
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
        </Box>

        {/* What you can do about it. Pushed to the far end of the row with a
            rule between, so the separation survives at any width instead of
            depending on the status group happening to be short. */}
        <Box
          role="group"
          aria-label="Draft controls"
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            flexWrap: 'wrap',
            ml: 'auto',
            pl: 1.5,
            borderLeft: '1px solid',
            borderColor: 'divider',
          }}
        >
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
            <Button variant="outlined" size="small" onClick={onRandomizeOrder} sx={MIN_TOUCH_TARGET_SX}>
              {/* Draft order is the defined term - which team holds which
                  slot (CONTEXT.md: Draft order). */}
              Randomize Draft order
            </Button>
          )}
          {isCommissioner && league?.draft_status === 'active' && (
            <Button variant="outlined" size="small" onClick={onTogglePause} sx={MIN_TOUCH_TARGET_SX}>
              {league?.draft_paused ? 'Resume Draft' : 'Pause Draft'}
            </Button>
          )}
        </Box>
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
