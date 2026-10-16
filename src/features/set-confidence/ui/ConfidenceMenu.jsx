import React from 'react';
import { Box } from '@mui/material';

/**
 * set-confidence feature (ADR 0038, restyled for Play-select in ADR 0067 wave 2): the per-card
 * Confidence control, the kit select: a native 44px select whose empty value reads
 * "Confidence: none" and whose options read "Confidence {n}". Choosing a rank saves it (the
 * board owns the save).
 *
 * `usedBy` maps a rank to the game that holds it, `{ [rank]: { label: 'DAL @ DEN', locked } }`
 * (never this menu's own `value`). A rank held by an open game reads "· used by {label}" and
 * stays choosable, because choosing it swaps the two games' ranks. A rank held by a game that
 * has kicked off reads "· locked, {label}", is `disabled` and `aria-disabled`, and cannot be
 * chosen: the server would refuse to move it. `swappable={false}` (a game with no rank of its
 * own yet has nothing to give the holder in a swap) disables the open-game ranks as well.
 *
 * `disabled` is the solid Rule edge with Dim text: no dash and no opacity. `bad` paints the
 * Danger edge for a refused save without disabling the control. `aria-describedby` points at the
 * window head's hint ("Pick a team to set its confidence") while the control is disabled.
 */
export default function ConfidenceMenu({
  value = null,
  max,
  usedBy = {},
  swappable = true,
  disabled = false,
  bad = false,
  onChange,
  'aria-label': ariaLabel = 'Confidence',
  'aria-describedby': describedBy,
  'data-testid': testId = 'confidence-menu',
}) {
  const ranks = Array.from({ length: Math.max(0, max || 0) }, (unused, index) => index + 1);
  const edge = bad ? 'var(--ps-danger)' : disabled ? 'var(--ps-rule)' : 'var(--ps-dim)';
  const ink = disabled ? 'var(--ps-dim)' : 'var(--ps-ink)';

  return (
    <Box
      data-testid={testId}
      data-bad={bad || undefined}
      sx={{ position: 'relative', width: '208px', maxWidth: '100%', flex: 'none' }}
    >
      <Box
        component="select"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        disabled={disabled}
        value={value == null ? '' : String(value)}
        data-testid={`${testId}-input`}
        onChange={(event) => onChange?.(event.target.value === '' ? null : Number(event.target.value))}
        sx={{
          boxSizing: 'border-box',
          height: '44px',
          width: '100%',
          appearance: 'none',
          opacity: 1,
          borderRadius: 0,
          backgroundColor: 'var(--ps-field)',
          color: ink,
          border: `2px solid ${edge}`,
          fontFamily: 'inherit',
          fontSize: '15px',
          fontWeight: 600,
          padding: '0 56px 0 12px',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <option value="">Confidence: none</option>
        {ranks.map((rank) => {
          const held = rank === value ? null : usedBy[rank];
          const locked = Boolean(held && held.locked);
          const blocked = locked || Boolean(held && !swappable);
          let suffix = '';
          if (locked) suffix = ` · locked, ${held.label}`;
          else if (held) suffix = ` · used by ${held.label}`;
          return (
            <option key={rank} value={rank} disabled={blocked} aria-disabled={blocked || undefined}>
              {`Confidence ${rank}${suffix}`}
            </option>
          );
        })}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: '44px',
          height: '44px',
          display: 'grid',
          placeItems: 'center',
          pointerEvents: 'none',
          borderLeft: `2px solid ${edge}`,
          boxSizing: 'border-box',
          color: ink,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1 2h10v2H9v2H7v2H5V6H3V4H1z" fill="currentColor" />
        </svg>
      </Box>
    </Box>
  );
}
