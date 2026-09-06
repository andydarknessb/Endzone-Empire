import React from 'react';
import { Box } from '@mui/material';

/**
 * The read-only "Celebrations on" / "Celebrations off" caption of the
 * celebrate-touchdown feature (ADR 0031, #903 review), the affordance the
 * design canvas draws on the right of the retro field's caption row
 * (`retroField()` in docs/design/game-center-matchups/build.mjs: the lock
 * glyph beside "Celebrations on"). The Matchup page slots it into the
 * retro-scoreboard widget's `fieldTail` (a widget imports no feature), fed
 * from the hook's `celebrationsEnabled` state, so a manager can see at a
 * glance whether a touchdown of his own will play a cutscene. It changes
 * nothing: the preference is set on the notifications settings page, and this
 * caption only reflects it.
 *
 * The glyph follows the state so the two readings differ by more than one
 * word: the canvas's bolt (the feature's own energy, the bench what-if's
 * glyph) when celebrations are on, the canvas's lock when they are off. Both
 * are inline stroke SVG on the canvas's 20px grid, aria-hidden beside the
 * words. Paints nothing of its own: it inherits the caption row's faint ink
 * (a registered pairing on the card surface). The state is exposed as
 * `data-enabled` for a test to read.
 */
const PATHS = {
  bolt: <path d="M11 2 4 11h5l-1 7 7-9h-5z" />,
  lock: (
    <>
      <rect x="5" y="9" width="10" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </>
  ),
};

function Glyph({ name, size = 13 }) {
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
      data-icon={name}
      data-testid="celebrations-glyph"
      style={{ display: 'block', flex: 'none' }}
    >
      {PATHS[name]}
    </svg>
  );
}

export default function CelebrationsCaption({ enabled, ...rest }) {
  const on = enabled !== false;
  return (
    <Box
      component="span"
      data-testid="celebrations-caption"
      data-enabled={on}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
      {...rest}
    >
      <Glyph name={on ? 'bolt' : 'lock'} />
      {on ? 'Celebrations on' : 'Celebrations off'}
    </Box>
  );
}
