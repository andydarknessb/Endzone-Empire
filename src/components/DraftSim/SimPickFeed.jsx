import React from 'react';
import {
  Box, Chip, List, ListItem, Paper, Stack, Typography,
} from '@mui/material';
import PositionChip from '../PlayerQuickView/PositionChip';

/**
 * Running commentary on the draft: newest pick first, your own picks called out,
 * autopicks flagged so a timeout is never a silent surprise.
 *
 * `label` names BOTH the visible heading and the list's accessible name, which
 * has to stay in step: this component is mounted twice at once (the rail and
 * the My-team tab), and two lists sharing one accessible name is why tests here
 * reach for getAllByLabelText(...)[0].
 *
 * `slotTags` is the roster assignment's byPickNumber map. Tagging a pick with
 * the slot it landed in must come from the same assignment the roster panel
 * renders, never a second derivation, because a later pick can legitimately
 * re-home an earlier one.
 */
function SimPickFeed({
  picks, teamsById, playersById, teamCount, limit = 25,
  label = 'Recent picks', slotTags = null,
}) {
  const recent = [...picks].reverse().slice(0, limit);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>{label}</Typography>
      {recent.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No picks yet. The draft is about to start.
        </Typography>
      ) : (
        <List dense disablePadding aria-label={label}>
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
                  {slotTags && slotTags.has(pick.pickNumber) && (
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', flexShrink: 0 }}
                    >
                      → {slotTags.get(pick.pickNumber).slotLabel}
                    </Typography>
                  )}
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
