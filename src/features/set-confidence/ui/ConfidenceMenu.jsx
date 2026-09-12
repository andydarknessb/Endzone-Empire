import React, { useId } from 'react';
import { FormControl, MenuItem, Select } from '@mui/material';
import { visuallyHidden } from '@mui/utils';

/**
 * set-confidence feature (#1265, ADR 0038 "What to build"): the per-card
 * Confidence chip, a menu of 1 to the slate size with numbers already spent
 * on another game disabled, matching the server's own validation
 * (CONTEXT.md, Confidence: "each number used at most once across the
 * week"). The trigger always reads "Confidence N" (or "Confidence --"
 * before a number is picked), the canvas's `.conf` chip; the word is never
 * "rank" (house style, CONTEXT.md's Confidence entry: "_Avoid_: rank").
 *
 * `disabledValues` names the numbers another game on this week's slate has
 * already claimed - never this menu's own current `value`, which stays
 * selectable so re-opening the menu does not lock a manager out of the
 * number they are already on.
 *
 * `bad` paints the canvas's `.conf.bad` state (a PICKEM_BAD_CONFIDENCE
 * flag: two games saved under the same number); it never disables the
 * control, since the manager's next move is to change ONE of the two, not
 * to be locked out of doing so.
 */
export default function ConfidenceMenu({
  value = null,
  max,
  disabledValues = [],
  disabled = false,
  bad = false,
  onChange,
  'aria-label': ariaLabel = 'Confidence',
  'data-testid': testId = 'confidence-menu',
}) {
  const labelId = useId();
  const disabledSet = disabledValues instanceof Set ? disabledValues : new Set(disabledValues);
  const options = Array.from({ length: Math.max(0, max || 0) }, (unused, index) => index + 1);
  const selectValue = value == null ? '' : value;

  return (
    <FormControl
      size="small"
      disabled={disabled}
      data-testid={testId}
      data-bad={bad || undefined}
      data-empty={value == null || undefined}
      sx={{
        minWidth: 0,
        '& .MuiOutlinedInput-root': {
          height: 28,
          borderRadius: '8px',
          fontSize: '12px',
          fontWeight: 600,
          color: bad ? 'var(--dash-danger)' : value == null ? 'var(--dash-faint)' : 'var(--dash-ink)',
          backgroundColor: 'var(--dash-surface)',
          '& fieldset': {
            borderColor: bad ? 'var(--dash-danger)' : 'var(--dash-line-strong)',
            borderStyle: value == null && !bad ? 'dashed' : 'solid',
          },
        },
      }}
    >
      <span id={labelId} style={{ ...visuallyHidden }}>{ariaLabel}</span>
      <Select
        labelId={labelId}
        value={selectValue}
        displayEmpty
        onChange={(event) => {
          const raw = event.target.value;
          onChange?.(raw === '' ? null : Number(raw));
        }}
        renderValue={(raw) => `Confidence ${raw === '' ? '--' : raw}`}
        inputProps={{ 'data-testid': `${testId}-input` }}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {options.map((number) => (
          <MenuItem
            key={number}
            value={number}
            disabled={number !== value && disabledSet.has(number)}
          >
            {number}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
