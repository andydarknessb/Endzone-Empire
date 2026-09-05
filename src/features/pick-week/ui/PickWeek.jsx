import React from 'react';
import { Box, Button, IconButton } from '@mui/material';
import { SegmentedControl } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';

/**
 * pick-week feature (ADR 0031, #896): the week picker from the Game Center
 * canvas (docs/design/game-center-matchups/build.mjs, `weekStepper()`). A
 * previous/next pair around a SegmentedControl of the weeks (Wk 1 ... Wk N),
 * plus an "All weeks" action. The page keeps owning the week state and its
 * default; this feature only reports a pick through `onChange`.
 *
 * Props:
 *   - `weeks`: the weeks on offer, ascending (number[]).
 *   - `value`: the selected week, or the string "All" for every week.
 *   - `onChange`: called with the picked week (a number) or "All".
 *   - `fill`: the mobile layout (below the `sm` breakpoint): the stepper row
 *     stretches to the container, the segments share its width, "All weeks"
 *     drops onto its own full-width line, and every control grows to the
 *     44px minimum touch target.
 *
 * Previous and next step through `weeks` by index, the same rule the legacy
 * Game Center picker used: disabled at either end, and both disabled while
 * "All" (or a week the list does not carry) is selected, since there is no
 * neighbour to step to. The segments are the kit's radio group, so the
 * selected week is a checked radio and arrow keys move between weeks; the
 * "All weeks" button carries `aria-pressed` so the all-weeks state has a home
 * when no radio is checked.
 *
 * Paints only `dash-*` tokens plus the app's focus ring and transition
 * tokens. Every pairing here is already registered in tokens.contrast.test.js:
 * dim and ink on the card surface / page background, and ink on the accent
 * tint (the pressed "All weeks" button). No new pairing is composed. The
 * chevrons are inline stroke SVG on the canvas's 20px grid, aria-hidden, so
 * each icon button's accessible name is its aria-label alone.
 */
export default function PickWeek({ weeks, value, onChange, fill = false }) {
  const list = Array.isArray(weeks) ? weeks : [];
  const isAll = value === 'All';
  const index = isAll || value == null ? -1 : list.indexOf(Number(value));
  const prevDisabled = index <= 0;
  const nextDisabled = index < 0 || index >= list.length - 1;

  const options = list.map((week) => ({ value: week, label: `Wk ${week}` }));

  return (
    <Box
      role="group"
      aria-label="Week picker"
      data-testid="pick-week"
      sx={{
        display: 'flex',
        flexDirection: fill ? 'column' : 'row',
        alignItems: fill ? 'stretch' : 'center',
        gap: fill ? '10px' : '12px',
        width: fill ? '100%' : undefined,
      }}
    >
      <Box
        data-testid="pick-week-stepper"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: fill ? '100%' : undefined,
          minWidth: 0,
        }}
      >
        <IconButton
          type="button"
          aria-label="Previous week"
          disabled={prevDisabled}
          onClick={() => onChange?.(list[index - 1])}
          sx={iconButtonSx(fill)}
        >
          <Chevron direction="left" />
        </IconButton>

        <SegmentedControl
          aria-label="Week"
          data-testid="pick-week-weeks"
          options={options}
          value={isAll ? undefined : value}
          onChange={(week) => onChange?.(week)}
          fill={fill}
          // On mobile the group takes the width between the two chevrons
          // (the canvas's `flex: 1 1 0`) and each segment grows to the 44px
          // touch target with the group's own 3px padding and hairline border.
          sx={fill ? { flex: '1 1 0', minWidth: 0, '& [role="radio"]': { height: 38 } } : undefined}
        />

        <IconButton
          type="button"
          aria-label="Next week"
          disabled={nextDisabled}
          onClick={() => onChange?.(list[index + 1])}
          sx={iconButtonSx(fill)}
        >
          <Chevron direction="right" />
        </IconButton>
      </Box>

      <Button
        type="button"
        disableElevation
        aria-pressed={isAll}
        onClick={() => onChange?.('All')}
        sx={allWeeksSx(fill, isAll)}
      >
        All weeks
      </Button>
    </Box>
  );
}

// The canvas's `.btn.icon`: a 38px square ghost button, hairline border, dim
// chevron that lifts to ink on hover. Mobile grows it to the 44px touch target.
function iconButtonSx(fill) {
  return {
    ...(fill ? MIN_TOUCH_TARGET_SX : { width: 38, height: 38 }),
    flex: 'none',
    p: 0,
    borderRadius: '9px',
    border: '1px solid var(--dash-line-strong)',
    color: 'var(--dash-dim)',
    backgroundColor: 'transparent',
    transition: 'color var(--transition-fast) ease, border-color var(--transition-fast) ease',
    '&:hover': {
      color: 'var(--dash-ink)',
      borderColor: 'var(--dash-accent-line)',
      backgroundColor: 'transparent',
    },
    '&.Mui-disabled': {
      color: 'var(--dash-faint)',
      borderColor: 'var(--dash-line)',
      opacity: 0.5,
    },
    '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
  };
}

// The canvas's `.btn`: 38px tall, 16px side padding, 13px/600 label, hairline
// border, dim text on no fill. Pressed (All selected) sits the ink label on
// the accent tint behind the accent line, a registered pairing.
function allWeeksSx(fill, pressed) {
  return {
    ...(fill ? { minHeight: 44, width: '100%' } : { height: 38 }),
    flex: 'none',
    minWidth: 0,
    px: '16px',
    py: 0,
    borderRadius: '9px',
    border: '1px solid',
    borderColor: pressed ? 'var(--dash-accent-line)' : 'var(--dash-line-strong)',
    color: pressed ? 'var(--dash-ink)' : 'var(--dash-dim)',
    backgroundColor: pressed ? 'var(--dash-accent-soft)' : 'transparent',
    fontFamily: 'var(--dash-font-body)',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1.2,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    transition:
      'color var(--transition-fast) ease, border-color var(--transition-fast) ease, background-color var(--transition-fast) ease',
    '&:hover': {
      color: 'var(--dash-ink)',
      borderColor: 'var(--dash-accent-line)',
      backgroundColor: pressed ? 'var(--dash-accent-soft)' : 'transparent',
    },
    '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
  };
}

// The canvas's chevron icons (`icon('chevL')` / `icon('chevR')`): inline
// stroke SVG on a 20px grid at 18px, currentColor, decorative.
function Chevron({ direction }) {
  const d = direction === 'left' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5';
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid={`pick-week-chevron-${direction}`}
      style={{ display: 'block' }}
    >
      <path d={d} />
    </svg>
  );
}
