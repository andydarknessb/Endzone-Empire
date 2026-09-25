import React, { useState } from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import { MIN_TOUCH_TARGET_SX, isRosterAtCapacity, sortRosterForDrop } from '../../../shared/lib';
import { useClaimPlayer } from '../model/useClaimPlayer';
import { bidHelperText, isValidBid } from '../model/bidValidity';

/**
 * The Decision card's waivers action bar (#1307, ADR 0040 CardStates):
 * Claim, with a drop pick (worst weekly projection first, the same sort
 * `add-player` and WaiverWire's own dialog both use) and, in a FAAB league,
 * a bid bounded by what remains. The drop pick is optional while the roster
 * has room and required once `rosterCount >= rosterCapacity`: a claim with
 * no drop there can only 409 ("choose a player to drop"), the same gate
 * `AddPlayerAction` already applies to a free-agent add.
 */
export default function ClaimPlayerAction({ player, leagueId, availability, roster, onClaimed }) {
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

  return (
    <Box data-testid="claim-player-action" sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 2, pb: 1.5 }}>
      {/* Risk-review finding (accessibility): `size="small"` shrinks MUI's
          OutlinedInput to 40px, under the 44px minimum every Button on this
          card already carries via MIN_TOUCH_TARGET_SX - default size clears
          it without one, matching WaiverWire's own analogous claim dialog. */}
      {atCapacity && (
        <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="claim-player-capacity-note">
          Your roster is full. Choose a player to drop when this claim clears.
        </Typography>
      )}
      <FormControl fullWidth>
        <InputLabel id="claim-player-drop-label">{dropLabel}</InputLabel>
        <Select
          labelId="claim-player-drop-label"
          label={dropLabel}
          value={dropPlayerId}
          onChange={(e) => setDropPlayerId(e.target.value)}
          data-testid="claim-player-drop-select"
        >
          <MenuItem value="">{atCapacity ? 'Choose a player to drop' : 'No drop'}</MenuItem>
          {sortedRoster.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name} ({p.position})
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {isFaab && (
        <TextField
          label="Bid"
          type="number"
          fullWidth
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          error={bidInvalid}
          helperText={bidInvalid ? bidHelperText(faabRemaining) : `$${faabRemaining} remaining`}
          inputProps={{ min: 0, max: faabRemaining, step: 1 }}
        />
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="contained"
          disabled={pending || bidInvalid || dropMissing}
          onClick={handleClaim}
          sx={MIN_TOUCH_TARGET_SX}
          data-testid="claim-player-submit"
        >
          Claim
        </Button>
        {availability?.waiverPriority != null && (
          <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{`Priority #${availability.waiverPriority}`}</Typography>
        )}
      </Box>
    </Box>
  );
}
