import React, { useState } from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { isRosterAtCapacity, sortRosterForDrop } from '../../../shared/lib';
import { useAddPlayer } from '../model/useAddPlayer';
import { PsButton } from '../../../shared/ui/playselect';
import {
  FIELD_SX, FieldLabel, MENU_PAPER,
} from '../../../shared/ui/playselect/CardControls';

/**
 * ADR 0067, spec #2347 ruling 7: the bar on `ps-*` tokens. Its Add is a ghost button unless `filled`, which only the modal phone
 * sheet passes: the desktop drawer carries no filled action.
 *
 * The Decision card's free-agent action bar (#1307, ADR 0040 CardStates):
 * "Add to roster" when there is room, or - when `rosterCount >= rosterCapacity`
 * - an inline, required drop pick ("today the API just fails" there, ADR
 * 0040's Plan, is the gap this closes) sorted worst weekly projection first,
 * the same order WaiverWire's own claim dialog already uses.
 */
export default function AddPlayerAction({
  player, leagueId, availability, roster, onAdded, filled = false,
}) {
  const [dropPlayerId, setDropPlayerId] = useState('');
  const { addPlayer, pending } = useAddPlayer({ leagueId, onDone: onAdded });

  const atCapacity = isRosterAtCapacity(availability);
  const sortedRoster = sortRosterForDrop(roster);

  const handleAdd = () => {
    addPlayer({
      playerId: player.playerId,
      playerName: player.name,
      dropPlayerId: atCapacity && dropPlayerId !== '' ? Number(dropPlayerId) : null,
    });
  };

  return (
    <Box
      data-testid="add-player-action"
      role="group"
      aria-label={`Add ${player.name}`}
      sx={{ display: 'flex', flexDirection: 'column', gap: '14px', px: '16px', pb: '16px' }}
    >
      {atCapacity && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
          <FieldLabel id="add-player-drop-label">Drop a player</FieldLabel>
          <Select
            labelId="add-player-drop-label"
            value={dropPlayerId}
            displayEmpty
            fullWidth
            onChange={(e) => setDropPlayerId(e.target.value)}
            MenuProps={{ PaperProps: MENU_PAPER }}
            sx={FIELD_SX}
            data-testid="add-player-drop-select"
          >
            <MenuItem value="">Choose a player to drop</MenuItem>
            {sortedRoster.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name} ({p.position})
                {p.projected_weekly_points != null && (
                  <Typography component="span" sx={{ fontFamily: 'inherit', fontSize: '14px', color: 'var(--ps-dim)', ml: 1 }}>
                    weekly proj {p.projected_weekly_points}
                  </Typography>
                )}
              </MenuItem>
            ))}
          </Select>
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <PsButton
          variant={filled ? 'fill' : 'ghost'}
          disabled={pending || (atCapacity && dropPlayerId === '')}
          onClick={handleAdd}
          data-testid="add-player-submit"
        >
          {atCapacity ? 'Add and drop' : 'Add to roster'}
        </PsButton>
        {availability?.rosterCount != null && (
          <Typography sx={{ fontFamily: 'inherit', fontSize: '14px', color: 'var(--ps-dim)' }}>
            {`Roster ${availability.rosterCount} of ${availability.rosterCapacity}`}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
