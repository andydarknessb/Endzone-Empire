import React from 'react';
import Badge from './Badge';

/**
 * A player's Game cell state (CONTEXT.md's Game cell; ADR 0037): pre-kickoff,
 * live, final, or bye. Added to `shared/ui` for the Lineup page slice
 * (#1237) so every Ledger row (Starters, Bench, IR) paints the same four
 * states the same way, rather than each widget inventing its own chip.
 *
 * Built on the kit's Badge (ADR 0020) so it composes only already-registered
 * `dash-*` pairings (tokens.contrast.test.js): `neutral` for `pre`, `danger`
 * with a dot for `live`, `success` for `final`, `warning` for `bye`. No new
 * pairing is introduced here.
 *
 * `state` is one of `'pre' | 'live' | 'final' | 'bye'`; an unrecognized value
 * falls back to `pre` rather than throwing or rendering an empty chip. The
 * label is whatever `children` holds, so a caller supplies its own copy
 * ("Sun 1:00 PM", "Q3 6:42", "Final", "on bye") - this component only picks
 * the variant and the dot.
 */
const VARIANT_BY_STATE = {
  pre: 'neutral',
  live: 'danger',
  final: 'success',
  bye: 'warning',
};

export default function GameStateChip({ state, children, sx, 'data-testid': testId = 'game-state-chip', ...rest }) {
  const variant = VARIANT_BY_STATE[state] || 'neutral';
  return (
    <Badge
      variant={variant}
      dot={state === 'live'}
      data-testid={testId}
      data-game-state={state}
      sx={{ fontSize: '10.5px', lineHeight: 1.2, flex: 'none', '& .MuiChip-label': { px: 0.75, py: 0.25 }, ...sx }}
      {...rest}
    >
      {children}
    </Badge>
  );
}
