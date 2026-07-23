import React from 'react';
import PropTypes from 'prop-types';
import { Box, Chip, Typography, Skeleton, Alert } from '@mui/material';
import useLiveGameRealtime from '../../hooks/useLiveGameRealtime';

/**
 * Standalone real-NFL-game status strip (score, quarter, clock) driven by
 * Supabase Realtime. Not wired into MatchupDetail/GameCenter yet — a fantasy
 * matchup can span many real games, and mapping one to the other is deferred
 * to a later phase.
 */
export default function LiveGameStatus({ gameId }) {
  const { state, loading, error } = useLiveGameRealtime(gameId);

  if (loading) return <Skeleton variant="rounded" height={64} />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!state) return null;

  const isLive = state.game_status === 'in_progress';
  const isFinal = state.game_status === 'final';
  const label = isLive
    ? `${state.quarter || ''} ${state.time_remaining || ''}`.trim() || 'LIVE'
    : state.game_status.toUpperCase();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip size="small" color={isLive ? 'success' : isFinal ? 'default' : 'info'} label={label} />
      <Typography variant="body2">
        {state.away_team} {state.current_score_away} — {state.current_score_home} {state.home_team}
      </Typography>
    </Box>
  );
}

LiveGameStatus.propTypes = {
  gameId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
};
