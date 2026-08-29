import React from 'react';
import { Box, Chip, Button, IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { draftStatusLabel, draftStatusChipColor } from './draftStatusCopy';

// Issue #512: a stable name in both states, with aria-pressed alone carrying
// on/off (WCAG 2.5.3, Label in Name). One constant so the Tooltip and the
// aria-label can never drift apart from each other again - that drift is
// exactly what #508/#510 got wrong the first time.
const SOUND_TOGGLE_LABEL = 'On-the-clock sound';

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
  pendingSchedule = null,
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
          ) : pendingSchedule ? (
            pendingSchedule
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
          <Tooltip title={SOUND_TOGGLE_LABEL}>
            <IconButton
              size="small"
              aria-label={SOUND_TOGGLE_LABEL}
              aria-pressed={soundOn}
              onClick={toggleSound}
              sx={MIN_TOUCH_TARGET_SX}
            >
              {soundOn ? <NotificationsActiveIcon fontSize="small" /> : <NotificationsOffIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          {isCommissioner && league?.draft_status === 'pending' && (
            <Button variant="text" size="small" onClick={onRandomizeOrder} sx={MIN_TOUCH_TARGET_SX}>
              {/* Draft order is the defined term - which team holds which
                  slot (CONTEXT.md: Draft order). */}
              Randomize Draft order
            </Button>
          )}
          {/* Pause/Resume moved to the active-draft commissioner toolbar
              (DraftDayControls) so every active-draft control sits in one
              separately named toolbar beside the feed (#439). */}
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
