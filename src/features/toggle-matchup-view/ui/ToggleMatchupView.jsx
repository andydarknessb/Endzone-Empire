import React from 'react';
import { SegmentedControl } from '../../../shared/ui';
import { VIEW_SCOREBOARD, VIEW_STANDARD } from '../model/useMatchupView';

/**
 * toggle-matchup-view feature (ADR 0031, #903): the Standard / Scoreboard
 * view toggle from the Matchup Detail canvas (`detailHeader()` in
 * docs/design/game-center-matchups/build.mjs), a SegmentedControl with the
 * list icon beside Standard and the field icon beside Scoreboard. The page
 * keeps owning the view (through `useMatchupView`, which remembers it per
 * viewer); this control only reports a pick through `onChange`.
 *
 * Props:
 *   - `value`: 'standard' or 'scoreboard'.
 *   - `onChange`: called with the picked view.
 *   - `fill`: the mobile layout, where the control stretches to its row and
 *     the two segments share its width.
 *
 * The control is the kit's radio group ("Matchup view"), so the selected view
 * is a checked radio and arrow keys move between the two. Paints nothing of
 * its own: the kit paints the segments, and the icons are inline stroke SVG
 * on the canvas's 20px grid, aria-hidden beside their words.
 */
const OPTIONS = [
  { value: VIEW_STANDARD, label: 'Standard', icon: <Icon name="list" /> },
  { value: VIEW_SCOREBOARD, label: 'Scoreboard', icon: <Icon name="field" /> },
];

export default function ToggleMatchupView({ value, onChange, fill = false, ...rest }) {
  return (
    <SegmentedControl
      aria-label="Matchup view"
      data-testid="toggle-matchup-view"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      fill={fill}
      {...rest}
    />
  );
}

const ICON_PATHS = {
  list: <path d="M4 6h12M4 10h12M4 14h12" />,
  field: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="M10 4.5v11M6 4.5v11M14 4.5v11" />
    </>
  ),
};

function Icon({ name, size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
