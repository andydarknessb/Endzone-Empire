import React, { useState } from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import { sortRosterForDrop } from '../../../shared/lib';
import { useClaimPlayer } from '../model/useClaimPlayer';

/**
 * The Decision card's waivers action bar (#1307, ADR 0040 CardStates):
 * Claim, with an optional drop pick (worst weekly projection first, the
 * same sort `add-player` and WaiverWire's own dialog both use) and, in a
 * FAAB league, a bid bounded by what remains.
 */
export default function ClaimPlayerAction({ player, leagueId, availability, roster, onClaimed }) {
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [bid, setBid] = useState('');
  const { submitClaim, pending } = useClaimPlayer({ leagueId, onDone: onClaimed });

  const isFaab = availability?.faabRemaining != null;
  const faabRemaining = availability?.faabRemaining ?? 0;
  const sortedRoster = sortRosterForDrop(roster);

  const bidIsValidNumber = bid !== '' && !Number.isNaN(Number(bid));
  const bidInvalid = isFaab && (!bidIsValidNumber || Number(bid) < 0 || Number(bid) > faabRemaining);

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
      <FormControl fullWidth>
        <InputLabel id="claim-player-drop-label">Drop a player (optional)</InputLabel>
        <Select
          labelId="claim-player-drop-label"
          label="Drop a player (optional)"
          value={dropPlayerId}
          onChange={(e) => setDropPlayerId(e.target.value)}
          data-testid="claim-player-drop-select"
        >
          <MenuItem value="">No drop</MenuItem>
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
          helperText={bidInvalid ? `Enter a bid between $0 and $${faabRemaining}` : `$${faabRemaining} remaining`}
          inputProps={{ min: 0, max: faabRemaining }}
        />
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="contained"
          disabled={pending || bidInvalid}
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
