import React from 'react';
import { Button } from '@mui/material';

/**
 * The League Dashboard / Game Center primary and ghost button treatment (ADR
 * 0031's 2026-09-10 #1146 amendment, #1166): the canvas's `.btn`, `.btn.primary`
 * and `.btn.ghost`, painted only with `--dash-*` tokens. Five island sites
 * (matchup-hero, matchup-preview, bench-what-if, my-team-summary, the Matchup
 * page's own header/bottom Set lineup link) had each grown their own copy of
 * this sx object, and the copies had already diverged on height, padding,
 * `flex`, `whiteSpace` and whether the primary hover eased - the hero's primary
 * never picked up the `transition: filter` fix the preview added. This is the
 * one canonical implementation all five now compose.
 *
 * `variant`:
 *   - `primary` (default): `dash-on-accent` label on a `dash-accent` fill with
 *     a `dash-accent` border. The registered "dashboard primary button label
 *     on accent" pairing (tokens.contrast.test.js); this component composes no
 *     new pairing. Hover keeps the fill and steps `filter: brightness(1.08)`
 *     with `transition: filter var(--transition-fast)` - the app theme's
 *     MuiButton transition (AppThemeProvider) covers background-color,
 *     box-shadow and border-color, never `filter`, so the transition has to be
 *     named here or the hover snaps instead of easing.
 *   - `ghost`: `dash-dim` label, transparent fill, a `dash-line-strong`
 *     hairline border. Hover moves the label to `dash-ink` and the border to
 *     `dash-accent-line`; the fill stays transparent. Already a registered
 *     pairing.
 *
 * `size`:
 *   - `md` (default): the canvas `.btn`, 38px min-height at the `md` breakpoint
 *     and up, 44px below it - the hit-target rule the hero, preview and
 *     Matchup page already follow.
 *   - `sm`: the bench-what-if card height, 32px at `sm` and up, 44px below it.
 *
 * Shared base: `textTransform: none`, 13px / 600 / line-height 1.2, 9px
 * radius, 16px horizontal padding, zero vertical padding (height comes from
 * `minHeight`, not padding), `minWidth: 0`, `whiteSpace: nowrap`,
 * `disableElevation`. Layout that belongs to the row, not the button (a
 * caller's `flex`, `width: 100%`), stays at the call site through the `sx`
 * prop, which merges over this treatment the same way `InjuryTag` and `Badge`
 * accept `sx` - a caller wins on any key it sets. `component`, `to`, `href`,
 * `onClick`, `aria-*` and `data-testid` all pass through `...rest` to the
 * underlying MUI `Button` (the Set Lineup buttons are `RouterLink`s).
 */
const BASE_SX = {
  textTransform: 'none',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: '9px',
  padding: '0 16px',
  minWidth: 0,
  whiteSpace: 'nowrap',
};

const VARIANT_SX = {
  primary: {
    color: 'var(--dash-on-accent)',
    backgroundColor: 'var(--dash-accent)',
    border: '1px solid var(--dash-accent)',
    transition: 'filter var(--transition-fast)',
    '&:hover': { backgroundColor: 'var(--dash-accent)', filter: 'brightness(1.08)' },
  },
  ghost: {
    color: 'var(--dash-dim)',
    backgroundColor: 'transparent',
    border: '1px solid var(--dash-line-strong)',
    '&:hover': {
      color: 'var(--dash-ink)',
      borderColor: 'var(--dash-accent-line)',
      backgroundColor: 'transparent',
    },
  },
};

const SIZE_SX = {
  md: { minHeight: { xs: 44, md: 38 } },
  sm: { minHeight: { xs: 44, sm: 32 } },
};

export default function DashButton({
  variant = 'primary',
  size = 'md',
  sx,
  'data-testid': testId = 'dash-button',
  ...rest
}) {
  const variantSx = VARIANT_SX[variant] ?? VARIANT_SX.primary;
  const sizeSx = SIZE_SX[size] ?? SIZE_SX.md;

  return (
    <Button
      disableElevation
      data-variant={variant}
      data-size={size}
      data-testid={testId}
      sx={{
        ...BASE_SX,
        ...sizeSx,
        ...variantSx,
        ...sx,
      }}
      {...rest}
    />
  );
}

// The same component under its name, for `import { DashButton }`.
export { DashButton };
