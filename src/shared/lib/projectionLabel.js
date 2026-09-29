// The one client mapping from a lineup row to the single number a surface
// prints for its Weekly projection (#1776, spec #1774): "no history" for a
// Position-baseline projection (CONTEXT.md), else the formatted Point
// estimate. Sits beside `unavailableLabel`, which owns the harder facts: an
// Unavailable reason (bye, out, IR, no team, practice squad) always wins over
// "no history", so a caller renders `unavailableLabel(reason)` first and this
// only for an available row.
//
// The verdict is the server's (`entry.positionBaseline` on the Lineup wire,
// already false when an Unavailable reason applies, lineup.service.js); this
// holds no copy of it. The guard on `availability` below is belt and braces
// for a row built by hand, never a second derivation.

import { formatPoints } from './numeric';

export const NO_HISTORY_LABEL = 'no history';

/**
 * True when `entry` is a Position-baseline projection the surface must not
 * present as a number: `positionBaseline` is exactly `true` and the player is
 * not Unavailable. Never throws on a missing row.
 */
export function hasNoHistory(entry) {
  if (!entry || entry.positionBaseline !== true) return false;
  return !(entry.availability && entry.availability.available === false);
}

/**
 * "no history" for a Position-baseline row, else the one-decimal Point
 * estimate (`entry.projectedPoints`), a dash when it is unknown.
 */
export function projectionLabel(entry) {
  if (hasNoHistory(entry)) return NO_HISTORY_LABEL;
  return formatPoints(entry ? entry.projectedPoints : null);
}
