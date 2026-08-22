import React from 'react';
import { Paper, Box, Avatar, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';

// Subtle pulse for the timer once time is running low (<=10s).
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
function LiveDraftBanner({ league, onTheClock, secondsLeft, isMyTurn }) {
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
        {initialsFor(onTheClock?.name)}
      </Avatar>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography
          variant="h5"
          component="div"
          noWrap
          sx={{ fontWeight: 'bold', color: isMyTurn ? 'primary.main' : 'text.primary' }}
        >
          {isMyTurn ? 'Your pick!' : onTheClock ? `${onTheClock.name} is on the clock` : 'Waiting…'}
        </Typography>
        {onTheClock?.owner && (
          <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
            {onTheClock.owner}
          </Typography>
        )}
      </Box>
      {secondsLeft !== null ? (
        <Typography
          variant="h1"
          component="div"
          data-testid="draft-clock"
          sx={{
            fontWeight: 'bold',
            lineHeight: 1.1,
            flexShrink: 0,
            color: secondsLeft <= 10 ? 'error.main' : 'text.primary',
            animation: secondsLeft <= 10 ? `${pulse} 1s ease-in-out infinite` : 'none',
          }}
        >
          {secondsLeft}s
        </Typography>
      ) : league?.draft_paused ? (
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
