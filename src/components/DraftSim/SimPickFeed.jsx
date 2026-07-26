import React from 'react';
import {
  Box, Chip, List, ListItem, Paper, Stack, Typography,
} from '@mui/material';
import PositionChip from '../PlayerQuickView/PositionChip';

/**
 * Running commentary on the draft: newest pick first, your own picks called out,
 * autopicks flagged so a timeout is never a silent surprise.
 */
function SimPickFeed({ picks, teamsById, playersById, teamCount, limit = 25 }) {
  const recent = [...picks].reverse().slice(0, limit);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>Recent picks</Typography>
      {recent.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No picks yet — the draft is about to start.
        </Typography>
      ) : (
        <List dense disablePadding aria-label="Recent picks">
          {recent.map((pick) => {
            const player = playersById.get(pick.playerId) || {};
            const team = teamsById.get(pick.teamId) || {};
            const round = Math.ceil(pick.pickNumber / Math.max(1, teamCount));
            return (
              <ListItem
                key={pick.pickNumber}
                disableGutters
                sx={{
                  borderBottom: '1px solid var(--border-subtle)',
                  py: 1,
                  bgcolor: team.isUser ? 'var(--accent-soft)' : 'transparent',
                  px: team.isUser ? 1 : 0,
                  borderRadius: team.isUser ? 1 : 0,
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', minWidth: 52, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {round}.{String(((pick.pickNumber - 1) % Math.max(1, teamCount)) + 1).padStart(2, '0')}
                  </Typography>
                  <PositionChip position={player.position} size="small" />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {player.name || 'Unknown player'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {team.name || 'Team'}
                      {player.nflTeam ? ` · ${player.nflTeam}` : ''}
                    </Typography>
                  </Box>
                  {pick.auto && <Chip size="small" label="Auto" variant="outlined" />}
                </Stack>
              </ListItem>
            );
          })}
        </List>
      )}
    </Paper>
  );
}

export default SimPickFeed;
