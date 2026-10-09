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
import {
  MIN_TOUCH_TARGET_SX,
  NO_HISTORY_LABEL,
  hasNoHistory,
  isRosterAtCapacity,
  sortRosterForDrop,
  reasonLabel,
} from '../../../shared/lib';
import { useClaimPlayer } from '../model/useClaimPlayer';
import { bidHelperText, isValidBid } from '../model/bidValidity';

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toFixed(1));
const TOUCH = { minHeight: 44, minWidth: 44 };

/**
 * The swap preview: this player's Proj Wk against the starter he replaces.
 * The replaced starter's number is `overPlayer.points` (Ruling on #1793,
 * option B) - the same Weekly producer `upgrade.points` itself came from,
 * zeroed already if he is Unavailable, never the roster's Pool projection
 * (`projected_weekly_points`), which never agreed with it (ADR 0040 left the
 * Pool number for the drop list below, not this preview). When he is
 * Unavailable, his reason replaces his number ("Stud Starter on bye"), so
 * the line reads honestly instead of implying he still projects it.
 *
 * QA f1 (deploy skew): the client (Netlify) and API (Render) release
 * separately, so a client build can run ahead of an API that has not shipped
 * `overPlayer.points` yet. `mine - upgrade.points` is the exact fallback
 * (that IS the math `points` came from server-side), never the roster's
 * stale Pool number, which is what regressed f1/f2 in the first place.
 */
export function SwapPreview({ player }) {
  const upgrade = player.upgrade;
  if (upgrade == null || upgrade.points == null || upgrade.overPlayer == null) return null;
  const mine = player.projWeek?.points ?? null;
  const { overPlayer } = upgrade;
  const reason = overPlayer.unavailable ? reasonLabel(overPlayer.unavailable) : null;
  const theirs = overPlayer.points ?? (mine != null ? mine - upgrade.points : null);
  const gain = Number(upgrade.points);
  // A Position-baseline row prints "no history" for his number and no gain
  // line (#1808): the gain is built from the hidden number. The verdict is the
  // server's, read through `hasNoHistory`, never re-derived here.
  const noHistory = hasNoHistory(player);
  return (
    <Box data-testid="claim-sheet-swap" sx={{ border: '1px solid var(--dash-line)', borderRadius: 1, p: 1.5 }}>
      <Typography sx={{ fontSize: 12, color: 'var(--dash-dim)', mb: 0.5 }}>This week&apos;s swap</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ minWidth: 0 }}>{`${player.name} ${noHistory ? NO_HISTORY_LABEL : fmt(mine)}`}</Typography>
        <Typography sx={{ minWidth: 0, textAlign: 'right' }}>
          {reason ? `${overPlayer.name} ${reason}` : `${overPlayer.name} ${fmt(theirs)}`}
        </Typography>
      </Box>
      {!noHistory && (
        <Typography sx={{ fontWeight: 700 }}>{`${gain >= 0 ? '+' : ''}${fmt(gain)} this week`}</Typography>
      )}
    </Box>
  );
}

function ClaimSheetBody({ player, claim, onSave, leagueId, availability, roster, dropSuggestion, onClose, onClaimed }) {
  const sortedRoster = sortRosterForDrop(roster);
  // The server's suggested drop (#1912, ADR 0055): the lowest Rest of season
  // player on a full roster. Never `upgrade.overPlayer`, who is the player the
  // claim moves out of this week's lineup, usually a starter-grade player.
  const preselect =
    dropSuggestion != null && sortedRoster.some((p) => p.id === dropSuggestion.id) ? String(dropSuggestion.id) : '';
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
  const bidInvalid = isFaab && !isValidBid({ bid, faabRemaining });
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
        <SwapPreview player={player} />
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
                helperText={bidInvalid ? bidHelperText(faabRemaining) : undefined}
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
 * claim-target read (neither, so no swap preview). `dropSuggestion` is the
 * players read's `context.dropSuggestion` (`{ id, name } | null`), the one
 * drop the sheet preselects on a new claim.
 *
 * Edit mode (#1616): pass the pending `claim` (the `waiver-claim` read model's
 * row) and `onSave({ bid, dropPlayerId })`, which resolves `{ ok }`. The sheet
 * opens prefilled and saves through `onSave`, never a new submission; the
 * Claim order is the server's to keep.
 */
export default function ClaimSheet({ open, player, claim, onSave, leagueId, availability, roster, dropSuggestion, onClose, onClaimed }) {
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
        dropSuggestion={dropSuggestion}
        onClose={onClose}
        onClaimed={onClaimed}
      />
    </Dialog>
  );
}
