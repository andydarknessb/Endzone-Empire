import React from 'react';
import { Paper, Box, Avatar, Typography } from '@mui/material';
import PickClock from './PickClock';
import { DraftRoomAssistantBannerLine, useDraftRoomAssistantControls } from './DraftRoomAssistant';

function initialsFor(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** Sticky, high-visibility banner for the active draft: who's on the clock
 * (with an initials avatar standing in for a team logo) and a large timer.
 * Sits just above the Draft/Board tabs so it stays visible while the player
 * pool table scrolls underneath it. Renders nothing outside an active draft.
 *
 * The room's ONE timer display (#754). `onTheClock` is the On-the-clock value
 * (src/lib/onTheClock): the timer slot follows its state - `running` mounts
 * the PickClock leaf, which owns its own tick so this banner and the room
 * around it never re-render per second; `paused` and `untimed`/`idle` show a
 * static label instead. */
function LiveDraftBanner({ league, onTheClock, isMyTurn }) {
  const team = onTheClock?.team ?? null;
  const state = onTheClock?.state ?? 'idle';
  const deadlineAt = onTheClock?.deadlineAt ?? null;

  // The Draft assistant's clock-urgent edge (#787 ruling item 2). Only the
  // stable controls half of its context is read here, so a landing line never
  // re-renders this banner or its PickClock leaf; the notifier itself gates on
  // the viewer's own turn, so forwarding it on every running clock is safe.
  // Absent the provider (LiveDraftBanner.test.jsx) it is a no-op.
  const { notifyClockUrgent } = useDraftRoomAssistantControls();

  // One-shot Overdue flag (#769 ruling 4). The PickClock leaf owns the per-second
  // tick and tells us ONCE, at the crossing, through onOverdue; we append the
  // same copy inside the existing role=status region so a screen reader hears
  // it a single time this turn - never per second (#445 AC3, #754 isolation).
  //
  // Key the flag to the deadline it belongs to, rather than a boolean cleared by
  // an effect. When a pick arrives ALREADY past the tolerance (a viewer opening
  // into a stalled draft - the case this feature exists for), the leaf's
  // mount-time onExpire and a reset effect would both run in the same commit;
  // child effects run before parent effects, so the reset would win and the
  // announcement would be lost. Recording the deadline sidesteps that race and
  // still self-clears on a new pick (overdueDeadline no longer matches).
  const [overdueDeadline, setOverdueDeadline] = React.useState(null);
  const handleOverdue = React.useCallback(() => setOverdueDeadline(deadlineAt), [deadlineAt]);
  const overdue = deadlineAt != null && overdueDeadline === deadlineAt;

  if (league?.draft_status !== 'active') return null;

  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 9,
        mt: 2,
        mb: 3,
        p: { xs: 2, sm: 3 },
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        // Wrap so the Draft assistant's latest line (below) drops to its own
        // full-width row under the avatar/status/clock, which stay on one row.
        flexWrap: 'wrap',
        bgcolor: isMyTurn ? 'action.hover' : 'background.paper',
        borderColor: isMyTurn ? 'primary.main' : 'divider',
        borderWidth: isMyTurn ? 2 : 1,
      }}
    >
      <Avatar
        sx={{
          width: 56,
          height: 56,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          fontWeight: 'bold',
          fontSize: '1.25rem',
          flexShrink: 0,
        }}
      >
        {initialsFor(team?.teamName)}
      </Avatar>
      {/* aria-live scoped to just who's-on-the-clock, not the whole banner:
          that changes once per pick (worth announcing), while the seconds
          countdown right after this Box changes every second - wrapping
          that too would spam assistive tech with a per-second announcement.
          This also restores the discoverability the old (mis-leveled) h1/h5
          headings gave for free before issue 121 correctly demoted them to
          non-headings - a screen reader is told the turn changed instead of
          losing that signal entirely. */}
      <Box sx={{ flexGrow: 1, minWidth: 0 }} role="status" aria-live="polite">
        <Typography
          variant="h5"
          component="div"
          noWrap
          sx={{ fontWeight: 'bold', color: isMyTurn ? 'primary.main' : 'text.primary' }}
        >
          {isMyTurn ? 'Your pick!' : team ? `${team.teamName} is on the clock` : 'Waiting…'}
        </Typography>
        {overdue ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Waiting on the server
          </Typography>
        ) : null}
      </Box>
      {state === 'running' ? (
        <PickClock deadlineAt={onTheClock.deadlineAt} onOverdue={handleOverdue} onUrgent={notifyClockUrgent} />
      ) : state === 'paused' ? (
        <Typography variant="h6" component="div" sx={{ color: 'warning.main', flexShrink: 0 }}>
          Draft paused
        </Typography>
      ) : (
        <Typography variant="h6" component="div" sx={{ color: 'text.secondary', flexShrink: 0 }}>
          No pick clock
        </Typography>
      )}
      {/* The Draft assistant's latest line on mobile (#787 ruling item 4): a
          visual line only, never a live region (the assistant's one polite
          region lives in the room chrome), so it may show a selection line the
          region does not speak. Renders nothing when the toggle is off. */}
      <DraftRoomAssistantBannerLine />
    </Paper>
  );
}

export default LiveDraftBanner;
