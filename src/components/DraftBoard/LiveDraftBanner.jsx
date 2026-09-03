import React from 'react';
import { Paper, Box, Avatar, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import PickClock from './PickClock';
import { formatRemaining, isUrgent, URGENT_SECONDS } from '../../lib/onTheClock';

// Subtle pulse for the timer once time is running low (at/under URGENT_SECONDS).
// The red urgent color carries the same signal without motion, so a reduced-
// motion guard turns the animation off (A4, the DraftBoardMatrix idiom).
const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.55; }
  100% { opacity: 1; }
`;

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
 * pool table scrolls underneath it. Renders nothing outside an active draft. */
function LiveDraftBanner({ league, onTheClock, isMyTurn }) {
  if (league?.draft_status !== 'active') return null;

  const { team, state } = onTheClock;

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
      </Box>
      {state === 'running' ? (
        // The one timer display in the room: the PickClock leaf owns the tick
        // (nothing else here re-renders per second), and this render callback
        // decides how it looks. Urgency is a fact about the clock (isUrgent over
        // the shared URGENT_SECONDS), applied per second by the leaf; at 0:00
        // the derived "expired" display is just a running clock left urgent.
        <PickClock deadlineAt={onTheClock.deadlineAt}>
          {(remaining) => (
            <Typography
              variant="h1"
              component="div"
              data-testid="draft-clock"
              sx={{
                fontWeight: 'bold',
                lineHeight: 1.1,
                flexShrink: 0,
                fontVariantNumeric: 'tabular-nums',
                color: isUrgent(remaining, URGENT_SECONDS) ? 'error.main' : 'text.primary',
                animation: isUrgent(remaining, URGENT_SECONDS) ? `${pulse} 1s ease-in-out infinite` : 'none',
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            >
              {formatRemaining(remaining)}
            </Typography>
          )}
        </PickClock>
      ) : state === 'paused' ? (
        <Typography variant="h6" component="div" sx={{ color: 'warning.main', flexShrink: 0 }}>
          Draft paused
        </Typography>
      ) : (
        <Typography variant="h6" component="div" sx={{ color: 'text.secondary', flexShrink: 0 }}>
          No pick clock
        </Typography>
      )}
    </Paper>
  );
}

export default LiveDraftBanner;
