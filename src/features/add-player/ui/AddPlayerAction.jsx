import React, { useState } from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import { sortRosterForDrop } from '../../../shared/lib';
import { useAddPlayer } from '../model/useAddPlayer';

/**
 * The Decision card's free-agent action bar (#1307, ADR 0040 CardStates):
 * "Add to roster" when there is room, or - when `rosterCount >= rosterCapacity`
 * - an inline, required drop pick ("today the API just fails" there, ADR
 * 0040's Plan, is the gap this closes) sorted worst weekly projection first,
 * the same order WaiverWire's own claim dialog already uses.
 */
export default function AddPlayerAction({ player, leagueId, availability, roster, onAdded }) {
  const [dropPlayerId, setDropPlayerId] = useState('');
  const { addPlayer, pending } = useAddPlayer({ leagueId, onDone: onAdded });

  const atCapacity =
    availability?.rosterCount != null &&
    availability?.rosterCapacity != null &&
    availability.rosterCount >= availability.rosterCapacity;
  const sortedRoster = sortRosterForDrop(roster);

  const handleAdd = () => {
    addPlayer({
      playerId: player.playerId,
      playerName: player.name,
      dropPlayerId: atCapacity && dropPlayerId !== '' ? Number(dropPlayerId) : null,
    });
  };

  return (
    <Box data-testid="add-player-action" sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 2, pb: 1.5 }}>
      {atCapacity && (
        // Risk-review finding (accessibility): `size="small"` shrinks MUI's
        // OutlinedInput to 40px, under the 44px minimum every Button on this
        // card already carries via MIN_TOUCH_TARGET_SX - default size clears
        // it without one, the same way WaiverWire's own analogous drop-pick
        // Select already does.
        <FormControl fullWidth>
          <InputLabel id="add-player-drop-label">Drop a player</InputLabel>
          <Select
            labelId="add-player-drop-label"
            label="Drop a player"
            value={dropPlayerId}
            onChange={(e) => setDropPlayerId(e.target.value)}
            data-testid="add-player-drop-select"
          >
            <MenuItem value="">Choose a player to drop</MenuItem>
            {sortedRoster.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name} ({p.position})
                {p.projected_weekly_points != null && (
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                    weekly proj {p.projected_weekly_points}
                  </Typography>
                )}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="contained"
          disabled={pending || (atCapacity && dropPlayerId === '')}
          onClick={handleAdd}
          sx={MIN_TOUCH_TARGET_SX}
          data-testid="add-player-submit"
        >
          {atCapacity ? 'Add and drop' : 'Add to roster'}
        </Button>
        {availability?.rosterCount != null && (
          <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {`Roster ${availability.rosterCount} of ${availability.rosterCapacity}`}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
