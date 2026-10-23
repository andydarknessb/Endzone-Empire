import React, { useState } from 'react';
import { Box, MenuItem, Select, TextField, Typography } from '@mui/material';
import { isRosterAtCapacity, sortRosterForDrop } from '../../../shared/lib';
import { useClaimPlayer } from '../model/useClaimPlayer';
import { bidHelperText, isValidBid } from '../model/bidValidity';
import { PsButton } from '../../../shared/ui/playselect';
import {
  FIELD_SX, FieldLabel, HINT_SX, MENU_PAPER,
} from '../../../shared/ui/playselect/CardControls';

/**
 * ADR 0067, spec #2347 ruling 7: the bar on `ps-*` tokens, square 44px controls. Its Claim is a ghost button unless `filled`, which
 * only the modal phone sheet passes: the desktop drawer carries no filled action.
 *
 * The Decision card's waivers action bar (#1307, ADR 0040 CardStates):
 * Claim, with a drop pick (worst weekly projection first, the same sort
 * `add-player` and WaiverWire's own dialog both use) and, in a FAAB league,
 * a bid bounded by what remains. The drop pick is optional while the roster
 * has room and required once `rosterCount >= rosterCapacity`: a claim with
 * no drop there can only 409 ("choose a player to drop"), the same gate
 * `AddPlayerAction` already applies to a free-agent add.
 */
export default function ClaimPlayerAction({
  player, leagueId, availability, roster, onClaimed, filled = false,
}) {
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [bid, setBid] = useState('');
  const { submitClaim, pending } = useClaimPlayer({ leagueId, onDone: onClaimed });

  const isFaab = availability?.faabRemaining != null;
  const faabRemaining = availability?.faabRemaining ?? 0;
  const sortedRoster = sortRosterForDrop(roster);
  const atCapacity = isRosterAtCapacity(availability);
  const dropMissing = atCapacity && dropPlayerId === '';
  const dropLabel = atCapacity ? 'Drop a player' : 'Drop a player (optional)';

  const bidInvalid = isFaab && !isValidBid({ bid, faabRemaining });

  const handleClaim = () => {
    submitClaim({
      playerId: player.playerId,
      dropPlayerId: dropPlayerId === '' ? null : dropPlayerId,
      bid: isFaab ? Number(bid) : 0,
    });
  };

  const dropLabelId = 'claim-player-drop-label';
  return (
    <Box
      data-testid="claim-player-action"
      role="group"
      aria-label={`Claim ${player.name}`}
      sx={{ display: 'flex', flexDirection: 'column', gap: '14px', px: '16px', pb: '16px' }}
    >
      {atCapacity && (
        <Typography sx={{ fontFamily: 'inherit', fontSize: '14px', color: 'var(--ps-dim)' }} data-testid="claim-player-capacity-note">
          Your roster is full. Choose a player to drop when this claim clears.
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
        <FieldLabel id={dropLabelId}>{dropLabel}</FieldLabel>
        <Select
          labelId={dropLabelId}
          value={dropPlayerId}
          displayEmpty
          fullWidth
          onChange={(e) => setDropPlayerId(e.target.value)}
          MenuProps={{ PaperProps: MENU_PAPER }}
          sx={FIELD_SX}
          data-testid="claim-player-drop-select"
        >
          <MenuItem value="">{atCapacity ? 'Choose a player to drop' : 'No drop'}</MenuItem>
          {sortedRoster.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name} ({p.position})
            </MenuItem>
          ))}
        </Select>
      </Box>
      {isFaab && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
          <FieldLabel htmlFor="claim-player-bid">Bid</FieldLabel>
          <TextField
            id="claim-player-bid"
            type="number"
            fullWidth
            value={bid}
            onChange={(e) => setBid(e.target.value)}
            error={bidInvalid}
            helperText={bidInvalid ? bidHelperText(faabRemaining) : `$${faabRemaining} remaining`}
            inputProps={{ min: 0, max: faabRemaining, step: 1 }}
            InputProps={{ sx: FIELD_SX }}
            sx={HINT_SX}
          />
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <PsButton
          variant={filled ? 'fill' : 'ghost'}
          disabled={pending || bidInvalid || dropMissing}
          onClick={handleClaim}
          data-testid="claim-player-submit"
        >
          Claim
        </PsButton>
        {availability?.waiverPriority != null && (
          <Typography sx={{ fontFamily: 'inherit', fontSize: '14px', color: 'var(--ps-dim)' }}>{`Priority #${availability.waiverPriority}`}</Typography>
        )}
      </Box>
    </Box>
  );
}
