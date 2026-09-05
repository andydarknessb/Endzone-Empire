import React from 'react';
import { Chip } from '@mui/material';

/**
 * League Dashboard badge: a token-themed MUI Chip in three variants from the
 * mockup, plus one from the Game Center canvas:
 *   - `neutral` (default): the plain `.chip` (surface2 fill, dim text).
 *   - `live`: the `.chip.live` accent state (accent text on the accent tint).
 *   - `you`: the small `.you` pill that is the viewer-row marker for the League
 *     Dashboard island (ADR 0020's six widget slices, page `league-dashboard`;
 *     NOT `src/widgets/draft-order`, the older ADR 0017 island in the Draft
 *     room, which is out of scope and keeps its own pre-#671 marker) (#671):
 *     every row-shaped one of those widgets that shows the viewer among other
 *     Teams renders this pill on the viewer's row. The pill's visible "You"
 *     text is what satisfies WCAG 1.4.1 (identifiable in the accessibility
 *     tree, not by color alone); that row separately also carries the
 *     `data-viewer-team` attribute, identifiable to tooling, which is
 *     invisible to assistive tech and carries no accessibility guarantee of
 *     its own.
 *   - `danger`: the Game Center canvas's `.chip.live` (ADR 0031, #895): danger
 *     text and border on the danger tint, the broadcast-red "Live" of the
 *     scoring strip. Distinct from `live` above, which is the League Dashboard
 *     mockup's accent-toned season chip: the two canvases paint "live"
 *     differently and each keeps its own variant. Its tint is guarded only
 *     over a card (tokens.contrast.test.js), so it belongs on `dash-surface`.
 *   - `warning`: the canvas's `.chip.warn` (ADR 0031, #903): warning text and
 *     border on the warning tint, the "may not play" tone of the injury tag
 *     (InjuryTag). Its tint is guarded over a card and a stat tile
 *     (`dash-surface`, `dash-surface2`, tokens.contrast.test.js), nowhere else.
 *
 * Part of `shared/ui` (ADR 0020). Colors come only from `--dash-*` tokens.
 * The label text is whatever `children` holds; the variant is also exposed as
 * a stable `data-variant` attribute so a composing widget (and this kit's own
 * tests) can assert which variant rendered without reaching into class names.
 */
const VARIANT_SX = {
  neutral: {
    backgroundColor: 'var(--dash-surface2)',
    color: 'var(--dash-dim)',
    border: '1px solid var(--dash-line)',
  },
  live: {
    backgroundColor: 'var(--dash-accent-soft)',
    color: 'var(--dash-accent)',
    border: '1px solid var(--dash-accent-line)',
  },
  // The "You" pill shares the accent palette with `live`. Its distinct type
  // (see YOU_TYPE) is what keeps it reading as an identity marker rather than a
  // status chip when the two sit near each other.
  you: {
    backgroundColor: 'var(--dash-accent-soft)',
    color: 'var(--dash-accent)',
    border: '1px solid var(--dash-accent-line)',
  },
  // The canvas's `.chip.live` border is the solid danger color, not a line
  // tint (there is no `dash-danger-line`).
  danger: {
    backgroundColor: 'var(--dash-danger-soft)',
    color: 'var(--dash-danger)',
    border: '1px solid var(--dash-danger)',
  },
  // Like `danger`, the border is the solid warning color (no `dash-warning-line`).
  warning: {
    backgroundColor: 'var(--dash-warning-soft)',
    color: 'var(--dash-warning)',
    border: '1px solid var(--dash-warning)',
  },
};

// The "You" pill's distinguishing type from the mockup (`.you`): smaller,
// heavier, wider tracking than the base chip. Applied as inline `style` (not
// sx) so a test can read it and a regression back to the `live` look is caught,
// not just so it renders.
const YOU_TYPE = { fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em' };

export default function Badge({
  variant = 'neutral',
  children,
  sx,
  style,
  'data-testid': testId = 'badge',
  ...rest
}) {
  const variantSx = VARIANT_SX[variant] ?? VARIANT_SX.neutral;

  return (
    <Chip
      label={children}
      size="small"
      data-variant={variant}
      data-testid={testId}
      style={{ ...(variant === 'you' ? YOU_TYPE : {}), ...style }}
      sx={{
        height: 'auto',
        fontSize: '11.5px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        borderRadius: 'var(--radius-pill)',
        '& .MuiChip-label': { px: 1.25, py: 0.5 },
        ...variantSx,
        ...sx,
      }}
      {...rest}
    />
  );
}
