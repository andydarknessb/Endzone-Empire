import React from 'react';
import { Box } from '@mui/material';
import { PsButton, pixelSx } from '../../../shared/ui/playselect';

// The Play-select body of the add and drop sheet (ADR 0067, spec #2453): `AddDropSheetBody` keeps the
// roster sort, the preselected drop and the submit through `useAddPlayer`, and hands this its values. "Add and drop" is the modal's own filled action.

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toFixed(1));
const FOCUS_RING = { outline: '3px solid var(--ps-focus)', boxShadow: '0 0 0 7px var(--ps-halo)' };

// The same radio row ClaimSheetPlayselect draws: a 44px label over a native input.
function RadioRow({
  value, label, checked, onChange,
}) {
  return (
    <Box
      component="label"
      sx={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px', fontSize: '15px', cursor: 'pointer',
        '& input:focus-visible + span': FOCUS_RING,
      }}
    >
      <Box
        component="input"
        type="radio"
        name="add-drop-sheet-drop"
        value={value}
        checked={checked}
        onChange={onChange}
        sx={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', m: 0, opacity: 0, cursor: 'pointer',
        }}
      />
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          width: '20px', height: '20px', flex: 'none', boxSizing: 'border-box', border: '2px solid var(--ps-ink)', borderRadius: '50%', display: 'grid', placeItems: 'center',
        }}
      >
        {checked ? <Box component="span" sx={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--ps-ink)' }} /> : null}
      </Box>
      <Box component="span" sx={{ fontWeight: checked ? 700 : 400 }}>{label}</Box>
    </Box>
  );
}

export default function AddDropSheetPlayselect({
  player, roster, dropId, onDrop, pending, onSubmit, onClose,
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Box sx={{ padding: '14px 20px', borderBottom: '2px solid var(--ps-rule)' }}>
        <Box component="h2" id="add-drop-sheet-title" sx={{ m: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
          <Box component="span" sx={pixelSx(16)}>Add</Box>
          {' '}
          <Box component="span" sx={{ fontSize: '24px', fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{player.name}</Box>
        </Box>
      </Box>
      <Box sx={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', flex: 1 }}>
        <Box
          role="radiogroup"
          aria-labelledby="add-drop-sheet-drop-label"
          aria-describedby="add-drop-sheet-note"
          sx={{ display: 'flex', flexDirection: 'column' }}
        >
          <Box component="span" id="add-drop-sheet-drop-label" sx={{ fontSize: '15px', fontWeight: 700, mb: '2px' }}>
            Drop a player
          </Box>
          <Box component="span" id="add-drop-sheet-note" sx={{ fontSize: '14px', color: 'var(--ps-dim)', mb: '4px' }}>
            Your roster is full. Choose a player to drop.
          </Box>
          {roster.length === 0 ? (
            // A failed roster read leaves nothing to choose; say so rather than an empty list.
            <Box component="p" sx={{ m: 0, mt: '8px', fontSize: '15px' }}>Couldn't load your roster. Close and try again.</Box>
          ) : (
            <Box sx={{ maxHeight: '330px', overflowY: 'auto', borderTop: '2px solid var(--ps-rule)', borderBottom: '2px solid var(--ps-rule)' }}>
              {roster.map((p) => (
                <RadioRow
                  key={p.id}
                  value={String(p.id)}
                  label={`${p.name} (${p.position}) · ${fmt(p.projected_weekly_points)} proj`}
                  checked={dropId === String(p.id)}
                  onChange={() => onDrop(String(p.id))}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '12px', padding: '14px 20px', borderTop: '2px solid var(--ps-rule)' }}>
        <PsButton onClick={onClose}>Cancel</PsButton>
        <PsButton variant="fill" disabled={pending || dropId === ''} onClick={onSubmit}>Add and drop</PsButton>
      </Box>
    </Box>
  );
}
