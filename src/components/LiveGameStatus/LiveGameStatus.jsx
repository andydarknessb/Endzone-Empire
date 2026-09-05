import React from 'react';
import PropTypes from 'prop-types';
import { Box, Chip, Typography } from '@mui/material';

/**
 * One real NFL game's status strip (score, quarter, clock): a pure render of
 * a `live_game_states` row handed in by the page. It reads nothing itself:
 * the Matchup entity hook owns the one realtime subscription for every game a
 * Matchup spans (#885) and hands each game's current row down, so this strip
 * cannot open a channel of its own. Matchup Detail renders one per game.
 */
export default function LiveGameStatus({ state }) {
  if (!state) return null;

  const isLive = state.game_status === 'in_progress';
  const isFinal = state.game_status === 'final';
  const label = isLive
    ? `${state.quarter || ''} ${state.time_remaining || ''}`.trim() || 'LIVE'
    : String(state.game_status || '').toUpperCase();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip size="small" color={isLive ? 'success' : isFinal ? 'default' : 'info'} label={label} />
      <Typography variant="body2">
        {state.away_team} {state.current_score_away} - {state.current_score_home} {state.home_team}
      </Typography>
    </Box>
  );
}

LiveGameStatus.propTypes = {
  // A live_game_states row: game_status, quarter, time_remaining, the two team
  // codes and the two current scores. Null renders nothing.
  state: PropTypes.shape({
    tank01_game_id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    game_status: PropTypes.string,
    quarter: PropTypes.string,
    time_remaining: PropTypes.string,
    home_team: PropTypes.string,
    away_team: PropTypes.string,
    current_score_home: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    current_score_away: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }),
};
