import React from 'react';
import { Skeleton as MuiSkeleton } from '@mui/material';

/**
 * League Dashboard loading placeholder: a token-themed MUI Skeleton. Each
 * card's widget renders these while its own fetch is in flight so the layout
 * does not jump as responses arrive.
 *
 * Part of `shared/ui` (ADR 0020). The fill comes from `--dash-surface2`, never
 * a literal. A stable `data-testid` ("skeleton" by default, override with the
 * prop) gives a composing widget and this kit's tests a way to assert the
 * loading state is present. The placeholder is decorative, so it is
 * `aria-hidden`: a screen reader should hear the loading state from the
 * card/region that owns the fetch, not from each shape. The pulse is collapsed
 * under the app's global prefers-reduced-motion rule (base.css); the shape's
 * presence, not its motion, carries "content is coming".
 *
 * That owner obligation is enforced per consumer, in a test asserting
 * `aria-busy` on the owning region, not by a repo-wide guard. None of today's
 * dashboard widgets has its own test file, so those assertions live in
 * LeagueDashboardPage.test.jsx alongside the page shell's own. Each of the
 * five current consumers (the page shell, plus the draft-grades,
 * matchup-preview, my-team-summary and standings-table widgets) has one.
 * Coverage is not automatic, though: a new consumer does not inherit it, so
 * the next widget author should add their own assertion there rather than
 * assume one exists for them.
 */
export default function Skeleton({
  variant = 'rounded',
  width,
  height,
  sx,
  'data-testid': testId = 'skeleton',
  ...rest
}) {
  return (
    <MuiSkeleton
      variant={variant}
      width={width}
      height={height}
      data-testid={testId}
      aria-hidden="true"
      sx={{
        backgroundColor: 'var(--dash-surface2)',
        borderRadius: 'var(--dash-radius-sm)',
        ...sx,
      }}
      {...rest}
    />
  );
}
