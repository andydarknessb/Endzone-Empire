import React from 'react';
import Badge from './Badge';

/**
 * A player's Game cell state (CONTEXT.md's Game cell; ADR 0037): pre-kickoff,
 * live, final, bye, or unavailable for another reason (out/IR). Added to
 * `shared/ui` for the Lineup page slice (#1237) so every Ledger row
 * (Starters, Bench, IR) paints the same states the same way, rather than
 * each widget inventing its own chip.
 *
 * Built on the kit's Badge (ADR 0020) so it composes only already-registered
 * `dash-*` pairings (tokens.contrast.test.js): `neutral` for `pre`, `danger`
 * with a dot for `live`, `success` for `final`, `warning` for `bye` and
 * `unavailable` alike. No new pairing is introduced here.
 *
 * `unavailable` (#1237, formal review finding
 * game-state-chip-bye-for-every-unavailable-reason) is distinct from `bye`
 * so a data-game-state inspection (or a future visual split) never claims a
 * player is on a bye when the real reason is out or on IR - the two share a
 * variant today, not an identity.
 *
 * `state` is one of `'pre' | 'live' | 'final' | 'bye' | 'unavailable'`; an
 * unrecognized value falls back to `pre` rather than throwing or rendering
 * an empty chip. The label is whatever `children` holds, so a caller
 * supplies its own copy ("Sun 1:00 PM", "Q3 6:42", "Final", "on bye", "out")
 * - this component only picks the variant and the dot.
 */
const VARIANT_BY_STATE = {
  pre: 'neutral',
  live: 'danger',
  final: 'success',
  bye: 'warning',
  unavailable: 'warning',
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
