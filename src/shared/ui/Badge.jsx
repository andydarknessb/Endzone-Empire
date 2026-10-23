import React from 'react';
import { Box, Chip } from '@mui/material';

/**
 * League Dashboard badge: a token-themed MUI Chip in three variants from the
 * mockup, plus three from the Game Center canvas:
 *   - `neutral` (default): the plain `.chip` (surface2 fill, dim text).
 *   - `live`: the `.chip.live` accent state (accent text and border on the panel).
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
 *     text and border on the panel, the broadcast-red "Live" of the
 *     scoring strip. Distinct from `live` above, which is the League Dashboard
 *     mockup's accent-toned season chip: the two canvases paint "live"
 *     differently and each keeps its own variant.
 *   - `warning`: the canvas's `.chip.warn` (ADR 0031, #903): warning text and
 *     border on the panel, the "may not play" tone of the injury tag
 *     (InjuryTag) and the Awaiting final status chip on the hero and the
 *     matchup cards (#897).
 *   - `success`: the canvas's `.chip.final` (ADR 0031, #897): success text and
 *     border on the panel, the Final status chip on the hero and the
 *     matchup cards.
 *
 * Part of `shared/ui` (ADR 0020). Colors come only from `--ps-*` tokens, on a `ps-panel` fill.
 * The label text is whatever `children` holds; the variant is also exposed as
 * a stable `data-variant` attribute so a composing widget (and this kit's own
 * tests) can assert which variant rendered without reaching into class names.
 *
 * `dot` (#903): the canvas's `.chip.live` carries an 8px disc before its
 * label (`statusChip('live')` in build.mjs), the LIVE status chip's dot on
 * the Matchup page header and the scoreboard strip. The disc is painted in
 * the chip's own text colour through `currentColor`, so it takes whatever
 * variant it sits in, and it is aria-hidden: the label carries the meaning
 * and the dot is exposed as `data-dot` for a test to read.
 */
const VARIANT_SX = {
  neutral: {
    backgroundColor: 'var(--ps-panel)',
    color: 'var(--ps-dim)',
    border: '1px solid var(--ps-rule)',
  },
  live: {
    backgroundColor: 'var(--ps-panel)',
    color: 'var(--ps-accent)',
    border: '1px solid var(--ps-accent)',
  },
  // The "You" pill shares the accent palette with `live`. Its distinct type
  // (see YOU_TYPE) is what keeps it reading as an identity marker rather than a
  // status chip when the two sit near each other.
  you: {
    backgroundColor: 'var(--ps-panel)',
    color: 'var(--ps-accent)',
    border: '1px solid var(--ps-accent)',
  },
  danger: {
    backgroundColor: 'var(--ps-panel)',
    color: 'var(--ps-danger)',
    border: '1px solid var(--ps-danger)',
  },
  warning: {
    backgroundColor: 'var(--ps-panel)',
    color: 'var(--ps-medal-gold)',
    border: '1px solid var(--ps-medal-gold)',
  },
  // The canvas's `.chip.final`: the same shape as `danger` and `warning`, on
  // the accent pair.
  success: {
    backgroundColor: 'var(--ps-panel)',
    color: 'var(--ps-accent)',
    border: '1px solid var(--ps-accent)',
  },
};

// The "You" pill's distinguishing type from the mockup (`.you`): smaller,
// heavier, wider tracking than the base chip. Applied as inline `style` (not
// sx) so a test can read it and a regression back to the `live` look is caught,
// not just so it renders.
const YOU_TYPE = { fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em' };

// The canvas's `.dot`: an 8px disc in the chip's text colour, decorative.
function Dot() {
  return (
    <Box
      component="span"
      aria-hidden="true"
      data-testid="badge-dot"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        mr: '6px',
        borderRadius: 'var(--radius-pill)',
        backgroundColor: 'currentColor',
        flex: 'none',
        verticalAlign: 'middle',
      }}
    />
  );
}

export default function Badge({
  variant = 'neutral',
  dot = false,
  children,
  sx,
  style,
  'data-testid': testId = 'badge',
  ...rest
}) {
  const variantSx = VARIANT_SX[variant] ?? VARIANT_SX.neutral;

  return (
    <Chip
      label={dot ? <><Dot />{children}</> : children}
      size="small"
      data-variant={variant}
      data-dot={dot || undefined}
      data-testid={testId}
      style={{ ...(variant === 'you' ? YOU_TYPE : {}), ...style }}
      sx={{
        height: 'auto',
        maxWidth: '100%',
        fontSize: '11.5px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        borderRadius: 'var(--radius-pill)',
        // Chip's own default is `white-space: nowrap`, built for a short
        // pill label. A caller that hands this a long freeform string (an
        // injury news sentence, say) would otherwise overflow its container
        // horizontally instead of wrapping - wrap defensively here so every
        // Badge is safe with long content, not just the callers that
        // remember to truncate first.
        '& .MuiChip-label': { px: 1.25, py: 0.5, whiteSpace: 'normal', wordBreak: 'break-word' },
        ...variantSx,
        ...sx,
      }}
      {...rest}
    />
  );
}
