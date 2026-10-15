// The one client mapping from a lineup row to the single number a surface
// prints for its Weekly projection (#1776, spec #1774): "no history" for a
// Position-baseline projection (CONTEXT.md), else the formatted Point
// estimate. Sits beside `unavailableLabel` (`entities/roster`), which owns the harder facts: an
// Unavailable reason (bye, out, IR, no team, practice squad) always wins over
// "no history", so a caller renders `unavailableLabel(entry)` first and this
// only for an available row.
//
// The verdict is the server's (`entry.startVerdict` on every wire, whose reason
// is `no_history` only for an available player); this holds no copy of it.

import { formatPoints } from './numeric';
import { startVerdictReason } from './startVerdict';

export const NO_HISTORY_LABEL = 'no history';

// The note beside a Questionable tag when the server's Start/sit advice read
// no practice all week for the player (the Start verdict's reason is
// `no_practice`, ADR 0056). The server owns the verdict; this is only its copy.
// Never "DNP".
export const NO_PRACTICE_LABEL = 'No practice this week';

// The tag for a Backup quarterback (the Start verdict's reason is 'backup',
// ADR 0057): behind an available teammate on the Depth chart. His projected
// number is his own evidence and is still printed.
export const BACKUP_LABEL = 'Backup';

/**
 * True when `entry` is a Position-baseline projection the surface must not
 * present as a number: its Start verdict reads `no_history` (every wire's
 * `startVerdict`, spec #2042). An Unavailable player carries an unavailable
 * verdict whose reason is never `no_history`, so the reason alone decides: no
 * second read of `availability` here (#2140). Never throws on a missing row.
 */
export function hasNoHistory(entry) {
  return startVerdictReason(entry) === 'no_history';
}

/**
 * "no history" for a Position-baseline row, else the one-decimal Point
 * estimate (`entry.projectedPoints`), a dash when it is unknown.
 */
export function projectionLabel(entry) {
  if (hasNoHistory(entry)) return NO_HISTORY_LABEL;
  return formatPoints(entry ? entry.projectedPoints : null);
}
