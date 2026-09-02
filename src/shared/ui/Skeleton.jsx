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
 * That owner obligation is enforced per consumer, in the consumer's own test
 * asserting `aria-busy` on its owning region, not by a repo-wide guard: as of
 * #665, LeagueDashboardPage.test.jsx carries four such tests (the page shell's
 * "shows a loading placeholder until the league arrives", plus the my-team-
 * summary, standings-table, and matchup-preview widget tests), so the next
 * widget author copies the pattern rather than the silence. This count is a
 * snapshot, not a ceiling: it grows as more consumers add their own test
 * rather than being kept current here.
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
