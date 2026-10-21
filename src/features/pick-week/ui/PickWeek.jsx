import React from 'react';
import { Box, Button, IconButton } from '@mui/material';
import { SegmentedControl } from '../../../shared/ui';
import { PixelArrow } from '../../../shared/ui/playselect';

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
 *   - `allWeeks`: whether to offer the "All weeks" action (default true). A page whose
 *     week setter cannot take "All" (Pick'em) passes `false`; Game Center and Lineup keep it.
 *   - Play-select (ADR 0067, spec #2334 ruling 3): the picker is on `ps-*` tokens, square 44px controls, no opacity, and ONE tab
 *     stop for the weeks: the selected week carries it (the strip's roving tabindex; Left/Right/Home/End
 *     move it), while Previous and Next stay pointer targets at tabindex -1. "All weeks" is a different
 *     action and keeps its own stop.
 *   - `fill`: the mobile layout (below the `sm` breakpoint): the stepper row
 *     stretches to the container and carries every control on one line, the
 *     weeks scroll sideways inside the room left between the chevrons and
 *     "All weeks", and every control grows to the 44px minimum touch target.
 *
 * A season is 14 to 18 weeks, which no phone row can hold as stretched
 * segments (#916): a flex item's default `min-width: auto` refuses to shrink
 * below its own label, so a stretched strip widened the document past the
 * viewport and left a dead strip beside every card. Below `sm` the strip is
 * the kit's `scrollable` group instead, and "All weeks" rides in the same row
 * rather than costing a second one.
 *
 * Previous and next step through `weeks` by index, the same rule the legacy
 * Game Center picker used: disabled at either end, and both disabled while
 * "All" (or a week the list does not carry) is selected, since there is no
 * neighbour to step to. The segments are the kit's radio group, so the
 * selected week is a checked radio and an arrow key walks from the focused
 * week, carrying DOM focus onto the neighbour so the checked week and the
 * group's single tab stop stay the same button (#933); the "All weeks" button
 * carries `aria-pressed` so the all-weeks state has a home when no radio is
 * checked.
 *
 * Paints only `dash-*` tokens plus the app's focus ring and transition
 * tokens. Every pairing here is already registered in tokens.contrast.test.js:
 * dim and ink on the card surface / page background, and ink on the accent
 * tint (the pressed "All weeks" button). No new pairing is composed. The
 * chevrons are inline stroke SVG on the canvas's 20px grid, aria-hidden, so
 * each icon button's accessible name is its aria-label alone.
 *
 * `ref` forwards to the weeks SegmentedControl's own ref (the
 * `role="radiogroup"` node, per `shared/ui/SegmentedControl`'s own
 * `forwardRef`): a composer that VETOES a picked week (a dirty-draft guard,
 * `pages/pickem` #1267) needs it to move DOM focus back onto the segment
 * that is still actually checked once the veto is confirmed - the roving
 * arrow-key move already carried focus onto the neighbour before reporting
 * it (SegmentedControl.jsx's own contract), so a rejected value otherwise
 * leaves focus on an unchecked segment.
 */
const PickWeek = React.forwardRef(function PickWeek({
  weeks, value, onChange, fill = false, allWeeks: offerAll = true,
}, ref) {
  const list = Array.isArray(weeks) ? weeks : [];
  const isAll = value === 'All';
  const index = isAll || value == null ? -1 : list.indexOf(Number(value));
  const prevDisabled = index <= 0;
  const nextDisabled = index < 0 || index >= list.length - 1;

  const options = list.map((week) => ({ value: week, label: `Wk ${week}` }));

  // Below sm this rides in the stepper row beside the strip, so the picker
  // costs one row of a phone and not two (#916).
  let allWeeks = null;
  if (offerAll) {
    allWeeks = (
      <Button
        type="button"
        disableElevation
        aria-pressed={isAll}
        onClick={() => onChange?.('All')}
        sx={psAllWeeksSx(isAll)}
      >
        {isAll ? <PixelArrow /> : null}
        All weeks
      </Button>
    );
  }

  const stepper = (direction, label, disabled, to) => (
    <IconButton
      type="button"
      aria-label={label}
      disabled={disabled}
      tabIndex={-1}
      onClick={() => onChange?.(list[to])}
      sx={psIconButtonSx}
    >
      <Chevron direction={direction} />
    </IconButton>
  );

  return (
    <Box
      role="group"
      aria-label="Week picker"
      data-testid="pick-week"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: fill ? '100%' : undefined,
        minWidth: 0,
      }}
    >
      <Box
        data-testid="pick-week-stepper"
        sx={{
          display: 'flex',
          alignItems: fill ? 'stretch' : 'center',
          gap: fill ? '8px' : '6px',
          width: fill ? '100%' : undefined,
          minWidth: 0,
        }}
      >
        {stepper('left', 'Previous week', prevDisabled, index - 1)}

        <SegmentedControl
          ref={ref}
          aria-label="Week"
          data-testid="pick-week-weeks"
          options={options}
          value={isAll ? undefined : value}
          onChange={(week) => onChange?.(week)}
          // The strip scrolls at EVERY width (#921). That is what makes the
          // zero minimum on the two boxes above safe: bounded by its row, the
          // strip can neither overflow onto the "All weeks" button beside it
          // nor widen the page, whatever the season length. When the weeks fit
          // there is no scrollbar and the desktop look is the canvas's.
          scrollable
          // On mobile the group also takes the room left in the row (the
          // canvas's `flex: 1 1 0`) and each segment grows to the 44px touch
          // target; on desktop the segments keep their natural width.
          sx={fill ? { flex: '1 1 0', minWidth: 0, '& [role="radio"]': { minHeight: 44 } } : undefined}
        />

        {stepper('right', 'Next week', nextDisabled, index + 1)}

        {fill ? allWeeks : null}
      </Box>

      {fill ? null : allWeeks}
    </Box>
  );
});

export default PickWeek;

// Previous/next week (docs/design/league, `weekPicker`): a 44px square 2px Ink edge, Ink pixel chevron;
// disabled is a Rule edge and Dim glyph, never opacity.
const psIconButtonSx = {
  minWidth: 44,
  minHeight: 44,
  width: 44,
  height: 44,
  flex: 'none',
  p: 0,
  borderRadius: 0,
  border: '2px solid var(--ps-ink)',
  color: 'var(--ps-ink)',
  backgroundColor: 'transparent',
  '&:hover': { backgroundColor: 'transparent' },
  '&.Mui-disabled': { color: 'var(--ps-dim)', borderColor: 'var(--ps-rule)' },
};

// All weeks: a 44px square ghost button; pressed is Play blue with a pixel arrow.
function psAllWeeksSx(pressed) {
  return {
    minWidth: 44,
    minHeight: 44,
    flex: 'none',
    px: '16px',
    py: 0,
    gap: '8px',
    borderRadius: 0,
    border: `2px solid ${pressed ? 'var(--ps-play)' : 'var(--ps-ink)'}`,
    color: pressed ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
    backgroundColor: pressed ? 'var(--ps-play)' : 'transparent',
    fontFamily: 'inherit',
    fontSize: '15px',
    fontWeight: 600,
    lineHeight: 1.2,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    '&:hover': { backgroundColor: pressed ? 'var(--ps-play)' : 'transparent' },
  };
}

// The Play-select 12px stepped chevron, currentColor, decorative.
function Chevron({ direction }) {
  const px = direction === 'left' ? 'M7 1h2v10H7zM5 3h2v6H5zM3 5h2v2H3z' : 'M3 1h2v10H3zM5 3h2v6H5zM7 5h2v2H7z';
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" data-testid={`pick-week-chevron-${direction}`} style={{ display: 'block' }}>
      <path d={px} fill="currentColor" />
    </svg>
  );
}
