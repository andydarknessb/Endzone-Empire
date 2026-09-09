import React from 'react';
import { Button } from '@mui/material';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';

/**
 * toggle-grade-details feature (#1104): the "Show steals and reaches" /
 * "Hide steals and reaches" control beside Draft Grades' explainer sentence.
 * A text MUI Button (UI conventions, CONTEXT.md: MUI `<Button>` is the house
 * button component). The widget owns the boolean through `useGradeDetails`;
 * this component only reports a click through `onClick` and renders the
 * label and aria wiring for whichever state it is handed.
 *
 * `aria-controls` always names the table (`controls`), unlike a disclosure
 * whose target only exists while open: Draft Grades' table is mounted either
 * way, only the second line per row changes.
 *
 * Colors come only from `--dash-*` tokens (the widget's own docblock, ADR
 * 0020), the same `dash-ink` label AdvanceWeek uses - already a registered
 * pairing (`tokens.contrast.test.js`: "dashboard body text on a card" /
 * "... on the raised tile"), so no new pairing is composed here; without it
 * the Button fell through to the app theme's primary color. The 44px touch
 * floor (`src/lib/a11y.js`) applies at phone widths only, matching
 * AdvanceWeek/CopyInvite: an unconditional floor would grow this
 * `size="small"` control on desktop, where a pointer needs none.
 */
const RESPONSIVE_MIN_TOUCH_TARGET_SX = { minHeight: { xs: MIN_TOUCH_TARGET_SX.minHeight, md: 'auto' } };

export default function ToggleGradeDetails({ expanded, onClick, controls, sx, ...rest }) {
  return (
    <Button
      type="button"
      variant="text"
      size="small"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      data-testid="toggle-grade-details"
      sx={{
        color: 'var(--dash-ink)',
        fontFamily: 'var(--dash-font-body)',
        fontWeight: 600,
        fontSize: '11.5px',
        textTransform: 'none',
        '&:hover': { backgroundColor: 'var(--dash-surface3)' },
        ...RESPONSIVE_MIN_TOUCH_TARGET_SX,
        ...sx,
      }}
      {...rest}
    >
      {expanded ? 'Hide steals and reaches' : 'Show steals and reaches'}
    </Button>
  );
}
