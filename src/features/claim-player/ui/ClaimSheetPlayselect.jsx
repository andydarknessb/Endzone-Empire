import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { PixelWarn, PsButton, pixelSx } from '../../../shared/ui/playselect';
import { bidHelperText } from '../model/bidValidity';

// The Play-select body of the claim sheet (ADR 0067 wave 3, board WaiversStates "Claim sheet"):
// `ClaimSheetBody` keeps every read, state and submission and hands this its values. The sheet's "Submit claim" / "Save claim" is the modal's own
// filled action.

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toFixed(1));
const FOCUS_RING = { outline: '3px solid var(--ps-focus)', boxShadow: '0 0 0 7px var(--ps-halo)' };

function RadioRow({
  name, value, label, checked, onChange,
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
        name={name}
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

function StepButton({ label, onClick, d }) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      sx={{
        width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'grid', placeItems: 'center', boxSizing: 'border-box', borderRadius: 0,
        background: 'transparent', border: '2px solid var(--ps-ink)', color: 'var(--ps-ink)',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d={d} fill="currentColor" /></svg>
    </Box>
  );
}

export default function ClaimSheetPlayselect({
  player, editing, swap, atCapacity, roster, dropId, onDrop, isFaab, bid, onBid, bidInvalid, faabRemaining, onStep,
  waiverPriority, pending, dropMissing, onSubmit, onClose, rows = 7,
}) {
  const rootRef = useRef(null);
  // Initial focus goes to the first control: the picked (else first) drop, else the bid field, else Cancel.
  useEffect(() => {
    const root = rootRef.current;
    const first = root?.querySelector('input[type="radio"]:checked')
      || root?.querySelector('input[type="radio"]')
      || root?.querySelector('input[type="number"]')
      || root?.querySelector('button');
    first?.focus();
  }, []);

  return (
    <Box ref={rootRef} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Box sx={{ padding: '14px 20px', borderBottom: '2px solid var(--ps-rule)' }}>
        <Box
          component="h2"
          id="claim-sheet-title"
          sx={{
            m: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px',
          }}
        >
          <Box component="span" sx={pixelSx(16)}>{editing ? 'Edit claim' : 'Claim'}</Box>
          {' '}
          <Box component="span" sx={{ fontSize: '24px', fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{player.name}</Box>
        </Box>
      </Box>
      <Box sx={{
        padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', flex: 1,
      }}
      >
        {swap}
        <Box
          role="radiogroup"
          aria-labelledby="claim-sheet-drop-label"
          aria-describedby={atCapacity ? 'claim-sheet-capacity-note' : undefined}
          sx={{ display: 'flex', flexDirection: 'column' }}
        >
          <Box component="span" id="claim-sheet-drop-label" sx={{ fontSize: '15px', fontWeight: 700, mb: '2px' }}>
            {atCapacity ? 'Drop a player' : 'Drop a player (optional)'}
          </Box>
          {atCapacity && (
            <Box component="span" id="claim-sheet-capacity-note" sx={{ fontSize: '14px', color: 'var(--ps-dim)', mb: '4px' }}>
              Your roster is full. Choose a player to drop when this claim clears.
            </Box>
          )}
          <Box
            sx={{
              maxHeight: `${rows * 44 + 22}px`, overflowY: 'auto', borderTop: '2px solid var(--ps-rule)', borderBottom: '2px solid var(--ps-rule)',
            }}
          >
            {!atCapacity && (
              <RadioRow name="claim-sheet-drop" value="" label="No drop" checked={dropId === ''} onChange={() => onDrop('')} />
            )}
            {roster.map((p) => (
              <RadioRow
                key={p.id}
                name="claim-sheet-drop"
                value={String(p.id)}
                label={`${p.name} (${p.position}) · ${fmt(p.projected_weekly_points)} proj`}
                checked={dropId === String(p.id)}
                onChange={() => onDrop(String(p.id))}
              />
            ))}
          </Box>
        </Box>
        {isFaab ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Box sx={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px',
            }}
            >
              <StepButton label="Lower bid" onClick={() => onStep(-1)} d="M1 5h10v2H1z" />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Box component="label" htmlFor="claim-sheet-bid" sx={{ fontSize: '14px', fontWeight: 600 }}>Bid</Box>
                <Box
                  component="input"
                  id="claim-sheet-bid"
                  type="number"
                  min={0}
                  max={faabRemaining}
                  step={1}
                  value={bid}
                  onChange={(event) => onBid(event.target.value)}
                  aria-invalid={bidInvalid || undefined}
                  aria-describedby={bidInvalid ? 'claim-sheet-bid-error' : undefined}
                  sx={{
                    boxSizing: 'border-box',
                    width: '96px',
                    height: '44px',
                    borderRadius: 0,
                    backgroundColor: 'var(--ps-field)',
                    color: 'var(--ps-ink)',
                    border: `2px solid ${bidInvalid ? 'var(--ps-danger)' : 'var(--ps-dim)'}`,
                    fontFamily: 'inherit',
                    fontSize: '16px',
                    fontWeight: 600,
                    padding: '0 12px',
                    textAlign: 'center',
                    MozAppearance: 'textfield',
                    '&::-webkit-inner-spin-button, &::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
                    '&:hover, &:focus': { borderColor: bidInvalid ? 'var(--ps-danger)' : 'var(--ps-ink)' },
                  }}
                />
              </Box>
              <StepButton label="Raise bid" onClick={() => onStep(1)} d="M5 1h2v4h4v2H7v4H5V7H1V5h4z" />
              <PsButton ariaLabel="Bid $1" onClick={() => onBid('1')}>$1</PsButton>
              <PsButton ariaLabel="Bid max" onClick={() => onBid(String(faabRemaining))}>Max</PsButton>
            </Box>
            {bidInvalid && (
              <Box
                id="claim-sheet-bid-error"
                sx={{
                  display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px',
                }}
              >
                <PixelWarn color="var(--ps-danger)" />
                <span>{bidHelperText(faabRemaining)}</span>
              </Box>
            )}
            <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>{`$${faabRemaining} remaining`}</Box>
          </Box>
        ) : (
          waiverPriority != null && <Box component="p" sx={{ m: 0, fontSize: '15px' }}>{`Waiver priority #${waiverPriority}`}</Box>
        )}
      </Box>
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '12px', padding: '14px 20px', borderTop: '2px solid var(--ps-rule)',
      }}
      >
        <PsButton onClick={onClose}>Cancel</PsButton>
        <PsButton variant="fill" disabled={pending || bidInvalid || dropMissing} onClick={onSubmit}>
          {editing ? 'Save claim' : 'Submit claim'}
        </PsButton>
      </Box>
    </Box>
  );
}
