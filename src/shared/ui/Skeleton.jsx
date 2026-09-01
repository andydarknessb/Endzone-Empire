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
 * loading state is present. The pulse is decorative and is collapsed under the
 * app's global prefers-reduced-motion rule (base.css); the shape's presence,
 * not its motion, carries "content is coming".
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
      sx={{
        backgroundColor: 'var(--dash-surface2)',
        borderRadius: 'var(--dash-radius-sm)',
        ...sx,
      }}
      {...rest}
    />
  );
}
