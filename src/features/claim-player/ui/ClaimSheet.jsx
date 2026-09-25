import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { MIN_TOUCH_TARGET_SX, isRosterAtCapacity, sortRosterForDrop } from '../../../shared/lib';
import { useClaimPlayer } from '../model/useClaimPlayer';

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toFixed(1));
const TOUCH = { minHeight: 44, minWidth: 44 };

/** The swap preview: this player's Proj Wk against the starter he replaces. */
export function SwapPreview({ player, roster }) {
  const upgrade = player.upgrade;
  if (upgrade == null || upgrade.points == null || upgrade.overPlayer == null) return null;
  const mine = player.projWeek?.points ?? null;
  const onRoster = roster.find((p) => p.id === upgrade.overPlayer.id);
  const theirs =
    onRoster?.projected_weekly_points != null
      ? Number(onRoster.projected_weekly_points)
      : mine != null
        ? mine - upgrade.points
        : null;
  const gain = Number(upgrade.points);
  return (
    <Box data-testid="claim-sheet-swap" sx={{ border: '1px solid var(--dash-line)', borderRadius: 1, p: 1.5 }}>
      <Typography sx={{ fontSize: 12, color: 'var(--dash-dim)', mb: 0.5 }}>This week&apos;s swap</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ minWidth: 0 }}>{`${player.name} ${fmt(mine)}`}</Typography>
        <Typography sx={{ minWidth: 0, textAlign: 'right' }}>{`${upgrade.overPlayer.name} ${fmt(theirs)}`}</Typography>
      </Box>
      <Typography sx={{ fontWeight: 700 }}>{`${gain >= 0 ? '+' : ''}${fmt(gain)} this week`}</Typography>
    </Box>
  );
}

function ClaimSheetBody({ player, claim, onSave, leagueId, availability, roster, onClose, onClaimed }) {
  const sortedRoster = sortRosterForDrop(roster);
  const overId = player.upgrade?.overPlayer?.id;
  const preselect = overId != null && sortedRoster.some((p) => p.id === overId) ? String(overId) : '';
  const editing = claim != null;
  const [dropId, setDropId] = useState(editing ? String(claim.dropPlayerId ?? '') : preselect);
  const [bid, setBid] = useState(editing ? String(claim.bid ?? 0) : '0');
  const { submitClaim, pending: filing } = useClaimPlayer({ leagueId, onDone: onClaimed });
  const [saving, setSaving] = useState(false);
  const pending = filing || saving;

  const isFaab = availability?.faabRemaining != null;
  // An edited claim's own bid is already held in the FAAB left.
  const faabRemaining = (availability?.faabRemaining ?? 0) + (editing ? Number(claim.bid) || 0 : 0);
  const atCapacity = isRosterAtCapacity(availability);
  const dropMissing = atCapacity && dropId === '';
  const bidNumber = bid === '' ? NaN : Number(bid);
  const bidInvalid = isFaab && (!Number.isInteger(bidNumber) || bidNumber < 0 || bidNumber > faabRemaining);
  const step = (delta) => {
    const base = Number.isFinite(bidNumber) ? bidNumber : 0;
    setBid(String(Math.min(faabRemaining, Math.max(0, base + delta))));
  };

  const submit = async () => {
    if (editing) {
      setSaving(true);
      const saved = await onSave({ bid: isFaab ? bidNumber : 0, dropPlayerId: dropId === '' ? null : Number(dropId) });
      setSaving(false);
      if (saved?.ok) onClose();
      return;
    }
    const result = await submitClaim({
      playerId: player.id,
      dropPlayerId: dropId === '' ? null : Number(dropId),
      bid: isFaab ? bidNumber : 0,
    });
    if (result.ok) onClose();
  };

  return (
    <>
      <DialogTitle id="claim-sheet-title">{editing ? `Edit claim: ${player.name}` : `Claim ${player.name}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SwapPreview player={player} roster={sortedRoster} />
        <Box>
          <Typography id="claim-sheet-drop-label" sx={{ fontWeight: 700, mb: 0.5 }}>
            {atCapacity ? 'Drop a player' : 'Drop a player (optional)'}
          </Typography>
          {atCapacity && (
            <Typography id="claim-sheet-capacity-note" sx={{ fontSize: 12, color: 'var(--dash-dim)' }}>
              Your roster is full. Choose a player to drop when this claim clears.
            </Typography>
          )}
          <RadioGroup aria-labelledby="claim-sheet-drop-label"
            aria-describedby={atCapacity ? 'claim-sheet-capacity-note' : undefined}
            value={dropId} onChange={(e) => setDropId(e.target.value)}>
            {!atCapacity && (
              <FormControlLabel value="" control={<Radio />} label="No drop" sx={{ ...TOUCH, m: 0 }} />
            )}
            {sortedRoster.map((p) => (
              <FormControlLabel
                key={p.id}
                value={String(p.id)}
                control={<Radio />}
                label={`${p.name} (${p.position}) · ${fmt(p.projected_weekly_points)} proj`}
                sx={{ ...TOUCH, m: 0 }}
              />
            ))}
          </RadioGroup>
        </Box>
        {isFaab ? (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <IconButton aria-label="Lower bid" onClick={() => step(-1)} sx={TOUCH}>
                −
              </IconButton>
              <TextField
                label="Bid"
                type="number"
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                error={bidInvalid}
                helperText={bidInvalid ? `Enter a bid between $0 and $${faabRemaining}` : undefined}
                inputProps={{ min: 0, max: faabRemaining, step: 1 }}
                sx={{ width: 110 }}
              />
              <IconButton aria-label="Raise bid" onClick={() => step(1)} sx={TOUCH}>
                +
              </IconButton>
              <Button variant="outlined" aria-label="Bid $1" onClick={() => setBid('1')} sx={MIN_TOUCH_TARGET_SX}>
                $1
              </Button>
              <Button variant="outlined" aria-label="Bid max" onClick={() => setBid(String(faabRemaining))} sx={MIN_TOUCH_TARGET_SX}>
                Max
              </Button>
            </Box>
            <Typography sx={{ fontSize: 12, mt: 0.5, color: 'var(--dash-dim)' }}>{`$${faabRemaining} remaining`}</Typography>
          </Box>
        ) : (
          availability?.waiverPriority != null && (
            <Typography>{`Waiver priority #${availability.waiverPriority}`}</Typography>
          )
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={MIN_TOUCH_TARGET_SX}>
          Cancel
        </Button>
        <Button variant="contained" disabled={pending || bidInvalid || dropMissing} onClick={submit} sx={MIN_TOUCH_TARGET_SX}>
          {editing ? 'Save claim' : 'Submit claim'}
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * The claim sheet (#1615, ADR 0049): swap preview, drop choices and bid,
 * a full-height sheet on a phone and a dialog from `sm`. It files the claim
 * through `useClaimPlayer`, the one submission the Decision card's claim bar
 * also uses. `player` is a players-read row (`upgrade`, `projWeek`) or the
 * claim-target read (neither, so no swap preview and no preselection).
 *
 * Edit mode (#1616): pass the pending `claim` (the `waiver-claim` read model's
 * row) and `onSave({ bid, dropPlayerId })`, which resolves `{ ok }`. The sheet
 * opens prefilled and saves through `onSave`, never a new submission; the
 * Claim order is the server's to keep.
 */
export default function ClaimSheet({ open, player, claim, onSave, leagueId, availability, roster, onClose, onClaimed }) {
  const phone = useMediaQuery('(max-width:599.95px)'); // below MUI's sm
  if (!player) return null;
  return (
    <Dialog open={open} onClose={onClose} fullScreen={phone} fullWidth maxWidth="sm" aria-labelledby="claim-sheet-title">
      <ClaimSheetBody
        key={`${player.id}-${claim?.id ?? 'new'}`}
        claim={claim}
        onSave={onSave}
        player={player}
        leagueId={leagueId}
        availability={availability}
        roster={Array.isArray(roster) ? roster : []}
        onClose={onClose}
        onClaimed={onClaimed}
      />
    </Dialog>
  );
}
