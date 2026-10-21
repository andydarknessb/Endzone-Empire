import React, { useState } from 'react';
import { Box, Dialog, useMediaQuery } from '@mui/material';
import {
  NO_HISTORY_LABEL,
  hasNoHistory,
  isRosterAtCapacity,
  sortRosterForDrop,
  reasonLabel,
} from '../../../shared/lib';
import { usePlayerCard } from '../../../entities/player';
import { BODY_FONT } from '../../../shared/ui/playselect';
import { useClaimPlayer } from '../model/useClaimPlayer';
import { isValidBid } from '../model/bidValidity';
import ClaimSheetPlayselect from './ClaimSheetPlayselect';

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toFixed(1));
// The Play-select sheet: a 6px double frame, square, on the panel fill, 480px from `sm` (full screen below).
const PS_PAPER_SX = {
  border: '6px double var(--ps-frame)',
  borderRadius: 0,
  backgroundColor: 'var(--ps-panel)',
  backgroundImage: 'none',
  color: 'var(--ps-ink)',
  fontFamily: BODY_FONT,
  boxSizing: 'border-box',
};

/**
 * The swap preview: this player's Proj Wk against the starter he replaces.
 * The replaced starter's number is `overPlayer.points` (Ruling on #1793,
 * option B) - the same Weekly producer `upgrade.points` itself came from,
 * zeroed already if he is Unavailable, never a Pool projection, which never
 * agreed with it. The roster's `projected_weekly_points` is the Weekly
 * projection too now (ADR 0040), so the drop list below reads it as well.
 * When he is Unavailable, his reason replaces his number ("Stud Starter on
 * bye"), so the line reads honestly instead of implying he still projects it.
 *
 * QA f1 (deploy skew): the client (Netlify) and API (Render) release
 * separately, so a client build can run ahead of an API that has not shipped
 * `overPlayer.points` yet. `mine - upgrade.points` is the exact fallback
 * (that IS the math `points` came from server-side), never the roster's
 * stale Pool number, which is what regressed f1/f2 in the first place.
 *
 * #2168 (ADR 0062): `player.swapNet` is the card's net of the drop the manager
 * picked, signed. It replaces the gain line, and keeps the preview up when the
 * Upgrade is 0 with no overPlayer (a drop worth more than the claim).
 * `netPending`: a drop is picked and its net has not arrived (loading or
 * errored), so the Upgrade, which is not net of the drop, prints no gain line.
 *
 * ADR 0067 wave 3: the lines sit in a 2px Rule frame on `ps-*` tokens.
 */
export function SwapPreview({ player, netPending = false }) {
  const upgrade = player.upgrade;
  const swapNet = player.swapNet ?? null;
  if (upgrade == null || upgrade.points == null || (upgrade.overPlayer == null && swapNet == null)) return null;
  // #2175 (ADR 0062 point 2): a swap for any week but the current one names its
  // week, and both sides are read in that week, as DecisionStrip's pill does.
  const week = swapNet?.week ?? upgrade.week;
  const currentWeek = player.projWeek?.week;
  const later = week != null && currentWeek != null && week !== currentWeek;
  const mine = later
    ? (player.weeks?.find((w) => w.week === week)?.points ?? null)
    : (player.projWeek?.points ?? null);
  const { overPlayer } = upgrade;
  const reason = overPlayer?.unavailable ? reasonLabel(overPlayer.unavailable) : null;
  const theirs = overPlayer?.points ?? (mine != null ? mine - upgrade.points : null);
  const gain = Number(swapNet != null ? swapNet.points : upgrade.points);
  // A Position-baseline row prints "no history" for his number and no gain
  // line (#1808): the gain is built from the hidden number. The verdict is the
  // server's, read through `hasNoHistory`, never re-derived here.
  const noHistory = hasNoHistory(player);
  return (
    <Box data-testid="claim-sheet-swap" sx={{ border: '2px solid var(--ps-rule)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{later ? `Wk ${week} swap` : "This week's swap"}</Box>
      <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '15px' }}>
        <span>{`${player.name} ${noHistory ? NO_HISTORY_LABEL : fmt(mine)}`}</span>
        {overPlayer && <Box component="span" sx={{ textAlign: 'right' }}>{reason ? `${overPlayer.name} ${reason}` : `${overPlayer.name} ${fmt(theirs)}`}</Box>}
      </Box>
      {!noHistory && !netPending && (
        <Box component="b" sx={{ fontSize: '15px', fontWeight: 700 }}>{`${gain >= 0 ? '+' : ''}${fmt(gain)} ${later ? `Wk ${week}` : 'this week'}`}</Box>
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
  // #2168: the card re-read with the picked drop netted out. No read until a
  // drop is picked, and none for a row with no Upgrade to net.
  const { card } = usePlayerCard({
    leagueId,
    playerId: dropId !== '' && player.upgrade != null ? player.id : null,
    dropPlayerId: dropId === '' ? null : Number(dropId),
  });
  const swapNet = dropId === '' ? null : (card?.decision?.swapNet ?? null);

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
    <ClaimSheetPlayselect
      player={player}
      editing={editing}
      swap={(
        <SwapPreview
          player={swapNet ? { ...player, swapNet } : player}
          netPending={dropId !== '' && player.upgrade != null && swapNet == null}
        />
      )}
      atCapacity={atCapacity}
      roster={sortedRoster}
      dropId={dropId}
      onDrop={setDropId}
      isFaab={isFaab}
      bid={bid}
      onBid={setBid}
      bidInvalid={bidInvalid}
      faabRemaining={faabRemaining}
      onStep={step}
      waiverPriority={availability?.waiverPriority}
      pending={pending}
      dropMissing={dropMissing}
      onSubmit={submit}
      onClose={onClose}
    />
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
 *
 * ADR 0067 wave 3: the sheet, reads and submission are on `ps-*` tokens.
 */
export default function ClaimSheet({ open, player, claim, onSave, leagueId, availability, roster, dropSuggestion, onClose, onClaimed }) {
  const phone = useMediaQuery('(max-width:599.95px)'); // below MUI's sm
  if (!player) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={phone}
      fullWidth
      maxWidth={false}
      aria-labelledby="claim-sheet-title"
      className="ps-root"
      PaperProps={{ sx: phone ? PS_PAPER_SX : { ...PS_PAPER_SX, maxWidth: '480px' } }}
    >
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
