import React from 'react';
import { SegmentedControl } from '../../../shared/ui';
import { VIEW_SCOREBOARD, VIEW_STANDARD } from '../model/useMatchupView';

/**
 * toggle-matchup-view feature (ADR 0031, #903): the Standard / Scoreboard
 * view toggle from the Matchup Detail canvas, a SegmentedControl in its
 * `playselect` look (ADR 0067 wave 2): square 44px segments, the checked one
 * in Play blue with an arrow, so the state is not colour alone. The page
 * keeps owning the view (through `useMatchupView`, which remembers it per
 * viewer); this control only reports a pick through `onChange`.
 *
 * Props:
 *   - `value`: 'standard' or 'scoreboard'.
 *   - `onChange`: called with the picked view.
 *   - `fill`: the mobile layout, where the control stretches to its row and
 *     the two segments share its width (every segment is 44px tall in the
 *     playselect look).
 *
 * The control is the kit's radio group ("Matchup view"), so the selected view
 * is a checked radio and an arrow key walks from the focused option, carrying
 * DOM focus onto the neighbour, so the checked view and the group's single tab
 * stop stay the same button (#933). A `ref` reaches the group element (the kit
 * forwards it), so the page can move focus onto the checked option when another
 * control swaps the view. Paints nothing of its
 * own: the kit paints the segments.
 */
const OPTIONS = [
  { value: VIEW_STANDARD, label: 'Standard' },
  { value: VIEW_SCOREBOARD, label: 'Scoreboard' },
];

const ToggleMatchupView = React.forwardRef(function ToggleMatchupView({ value, onChange, fill = false, sx, ...rest }, ref) {
  return (
    <SegmentedControl
      ref={ref}
      aria-label="Matchup view"
      data-testid="toggle-matchup-view"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      fill={fill}
      sx={sx}
      {...rest}
    />
  );
});

export default ToggleMatchupView;
