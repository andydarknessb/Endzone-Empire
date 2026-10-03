import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { MIN_TOUCH_TARGET_SX, sortRosterForDrop } from '../../../shared/lib';
import { useAddPlayer } from '../model/useAddPlayer';

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toFixed(1));
const TOUCH = { minHeight: 44, minWidth: 44 };

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
    <>
      <DialogTitle id="add-drop-sheet-title">{`Add ${player.name}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography id="add-drop-sheet-drop-label" sx={{ fontWeight: 700, mb: 0.5 }}>
            Drop a player
          </Typography>
          <Typography id="add-drop-sheet-note" sx={{ fontSize: 12, color: 'var(--dash-dim)' }}>
            Your roster is full. Choose a player to drop.
          </Typography>
          <RadioGroup
            aria-labelledby="add-drop-sheet-drop-label"
            aria-describedby="add-drop-sheet-note"
            value={dropId}
            onChange={(e) => setDropId(e.target.value)}
          >
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={MIN_TOUCH_TARGET_SX}>
          Cancel
        </Button>
        <Button variant="contained" disabled={pending || dropId === ''} onClick={submit} sx={MIN_TOUCH_TARGET_SX}>
          Add and drop
        </Button>
      </DialogActions>
    </>
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
 */
export default function AddDropSheet({ open, player, leagueId, roster, dropSuggestion, onClose, onAdded }) {
  const phone = useMediaQuery('(max-width:599.95px)'); // below MUI's sm
  if (!player) return null;
  return (
    <Dialog open={open} onClose={onClose} fullScreen={phone} fullWidth maxWidth="sm" aria-labelledby="add-drop-sheet-title">
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
