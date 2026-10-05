import React from 'react';
import { Box } from '@mui/material';

/**
 * A starter's state marker beside his name: the live dot, the final check or
 * the yet-to-play clock, as a labelled image so a screen reader hears the
 * state ("In progress") and not just a glyph. Takes the view `starterStateView`
 * (`shared/lib`) returns, `{ kind, label }`; nothing for an unknown state
 * (null). `data-testid="state-<kind>"` names the rendered state for a test.
 *
 * Part of `shared/ui` (ADR 0020, ADR 0031's component amendment): the
 * slot-comparison widget's Starters table and the retro-scoreboard widget's
 * Lineups card each carried a copy (#2010), and this is the one canonical
 * implementation, moved here at its second island consumer. `StateGlyph` is
 * the bare decorative glyph (no role, no label) for a caller that prints the
 * state's word beside it, the Starters legend; its in-progress form is the
 * live dot. Ink is `dash-faint` on the card or its surface2 footer, registered
 * in tokens.contrast.test.js; the dot is a `--danger` graphic beside text, not
 * a text pairing.
 */

// Inline stroke icons on the design's 20px grid, one style (1.6 stroke, round
// caps and joins).
const ICON_PATHS = {
  check: <path d="M4 10.5 8 14.5 16 6" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </>
  ),
};

function Icon({ name, size }) {
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

// The design's `.dot` in the in-progress color: an 8px disc painted `--danger`
// (an app token defined in both themes), so the live marker stays red beside
// the pace bar's green at-or-ahead fill. `data-tone` declares that paint where
// a test can read it (jsdom drops a var() color from computed and inline style
// alike), as Badge's `data-variant` does.
function LiveDot() {
  return (
    <Box
      component="span"
      data-testid="live-dot"
      data-tone="danger"
      aria-hidden="true"
      sx={{
        width: 8,
        height: 8,
        borderRadius: 'var(--radius-pill)',
        backgroundColor: 'var(--danger)',
        flex: 'none',
      }}
    />
  );
}

/** The bare glyph for a state kind: 'live' (the dot), 'final' (check), else the clock. */
export function StateGlyph({ kind, size = 14 }) {
  return kind === 'live' ? <LiveDot /> : <Icon name={kind === 'final' ? 'check' : 'clock'} size={size} />;
}

export default function StateMark({ view }) {
  if (!view) return null;
  return (
    <Box
      component="span"
      role="img"
      aria-label={view.label}
      data-testid={`state-${view.kind}`}
      sx={{ display: 'flex', flex: 'none', color: 'var(--dash-faint)' }}
    >
      <StateGlyph kind={view.kind} />
    </Box>
  );
}
