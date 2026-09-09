import React from 'react';
import { Button } from '@mui/material';

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
 */
export default function ToggleGradeDetails({ expanded, onClick, controls, ...rest }) {
  return (
    <Button
      type="button"
      variant="text"
      size="small"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      data-testid="toggle-grade-details"
      {...rest}
    >
      {expanded ? 'Hide steals and reaches' : 'Show steals and reaches'}
    </Button>
  );
}
