import React from 'react';
import { Avatar } from '@mui/material';

/**
 * League Dashboard grade chip: a round letter chip mapping a draft grade
 * (A / B / C / D / F) to its data-encoding token, with the fixed dark
 * `--dash-on-grade` letter the mockup uses. A round MUI Avatar is the wrapped
 * primitive.
 *
 * Part of `shared/ui` (ADR 0020). Colors come only from `--dash-*` tokens.
 * The accessible name is "Grade A" (etc.) so a screen-reader user hears the
 * grade, not a bare letter. `role="img"` is required for that: without it the
 * Avatar is a roleless div, and ARIA does not expose an `aria-label` on a
 * generic role, so AT would fall back to reading the visible letter. `role`
 * makes the label authoritative and hides the decorative letter from AT.
 *
 * Two degrade paths, so a widget never blanks the card or announces garbage:
 *   - a value that is not one of A-F still renders it on a neutral fill with
 *     accessible name "Grade <value>".
 *   - a missing grade (null/undefined/blank, the pre-draft case) renders a "-"
 *     placeholder named "Grade not available", never "Grade undefined".
 */
const GRADE_TOKENS = {
  A: 'var(--dash-grade-a)',
  B: 'var(--dash-grade-b)',
  C: 'var(--dash-grade-c)',
  D: 'var(--dash-grade-d)',
  F: 'var(--dash-grade-f)',
};

export default function GradeChip({ grade, sx, ...rest }) {
  const raw = grade == null ? '' : String(grade).trim();
  const key = raw.toUpperCase();
  const known = Object.prototype.hasOwnProperty.call(GRADE_TOKENS, key);
  const missing = raw === '';
  const backgroundColor = known ? GRADE_TOKENS[key] : 'var(--dash-surface2)';
  // On a real grade fill the dark `dash-on-grade` letter clears AA. On the
  // neutral fallback fill it would not (on-grade on surface2 is 1.22:1 in
  // dark, invisible), so the fallback letter uses `dash-ink` instead, which
  // clears AA on surface2 in both modes (13.41 dark, 16.13 light).
  const color = known ? 'var(--dash-on-grade)' : 'var(--dash-ink)';

  return (
    <Avatar
      role="img"
      aria-label={missing ? 'Grade not available' : `Grade ${key}`}
      variant="circular"
      sx={{
        width: 26,
        height: 26,
        backgroundColor,
        color,
        fontFamily: 'var(--dash-font-display)',
        fontSize: '14px',
        fontWeight: 700,
        ...sx,
      }}
      {...rest}
    >
      {missing ? '-' : key}
    </Avatar>
  );
}
