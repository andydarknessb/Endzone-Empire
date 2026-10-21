import React, { useState } from 'react';
import { Dialog, useMediaQuery } from '@mui/material';
import { sortRosterForDrop } from '../../../shared/lib';
import { BODY_FONT } from '../../../shared/ui/playselect';
import { useAddPlayer } from '../model/useAddPlayer';
import AddDropSheetPlayselect from './AddDropSheetPlayselect';

// The Play-select sheet's paper, the same as ClaimSheet's: a 6px double frame, square, on the panel fill.
const PS_PAPER_SX = {
  border: '6px double var(--ps-frame)',
  borderRadius: 0,
  backgroundColor: 'var(--ps-panel)',
  backgroundImage: 'none',
  color: 'var(--ps-ink)',
  fontFamily: BODY_FONT,
  boxSizing: 'border-box',
};

function AddDropSheetBody({ player, leagueId, roster, dropSuggestion, onClose, onAdded }) {
  const sortedRoster = sortRosterForDrop(roster);
  // The server's suggested drop (#1912, ADR 0055), the same preselect the
  // claim sheet makes: only when that player is on the list shown.
  const [dropId, setDropId] = useState(
    dropSuggestion != null && sortedRoster.some((p) => p.id === dropSuggestion.id) ? String(dropSuggestion.id) : '',
  );
  const { addPlayer, pending } = useAddPlayer({ leagueId, onDone: onAdded });

  const submit = async () => {
    const result = await addPlayer({ playerId: player.id, playerName: player.name, dropPlayerId: Number(dropId) });
    if (result.ok) onClose();
  };

  return (
    <AddDropSheetPlayselect
      player={player}
      roster={sortedRoster}
      dropId={dropId}
      onDrop={setDropId}
      pending={pending}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}

/**
 * The add and drop sheet (#1974, spec #1973 P1): a free agent's Add at a full
 * roster, where a plain add is refused by the server. ClaimSheet's anatomy (a
 * full-height sheet on a phone, a dialog from `sm`, the roster worst
 * projection first) without the bid or swap preview. It submits through
 * `useAddPlayer` with `dropPlayerId`, the one drop-then-add (undoing the drop
 * if the add fails) the Decision card's add bar also uses. `roster` is the
 * caller's own roster read; `dropSuggestion` is the players read's
 * `context.dropSuggestion` (`{ id, name } | null`), the one drop preselected.
 * `onAdded` runs after a successful add; the sheet then closes.
 * ADR 0067, spec #2453: the sheet is on `ps-*` tokens (`AddDropSheetPlayselect`), its dialog a
 * `ps-root` so the kit's focus ring and buttons apply.
 */
export default function AddDropSheet({ open, player, leagueId, roster, dropSuggestion, onClose, onAdded }) {
  const phone = useMediaQuery('(max-width:599.95px)'); // below MUI's sm
  if (!player) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={phone}
      fullWidth
      maxWidth={false}
      aria-labelledby="add-drop-sheet-title"
      className="ps-root"
      PaperProps={{ sx: phone ? PS_PAPER_SX : { ...PS_PAPER_SX, maxWidth: '480px' } }}
    >
      <AddDropSheetBody
        key={player.id}
        player={player}
        leagueId={leagueId}
        roster={Array.isArray(roster) ? roster : []}
        dropSuggestion={dropSuggestion}
        onClose={onClose}
        onAdded={onAdded}
      />
    </Dialog>
  );
}
