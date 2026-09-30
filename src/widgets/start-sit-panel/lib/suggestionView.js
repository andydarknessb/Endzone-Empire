/**
 * Pure view-building for the start-sit-panel widget (#1238, ADR 0037 AC1):
 * shapes one advice `suggestion` (`server/services/decision.service.js`'s
 * `buildSuggestions`) plus the page's own lineup entries (for kickoff, which
 * the advice payload does not carry - only the lineup entry does, #1235)
 * into what the panel renders. No network, no React: every branch here is
 * unit-tested directly.
 */

import { finite } from '../../../shared/lib';

/**
 * vs {opponent}, plus the defense's points allowed to this position when
 * known. `opponentApplied` (#1485) says whether the projection engine's own
 * opponent factor actually fired for this player - `false` still shows the
 * points-allowed figure but labels the line "context only" rather than
 * implying it moved the projection above it. A legacy payload with no
 * `opponentApplied` field (`undefined`) keeps the old, unqualified text: only
 * an explicit `false` qualifies the line.
 */
export function opponentContextText({ opponent, opponentPointsAllowed, position, opponentApplied }) {
  if (!opponent) return null;
  if (opponentPointsAllowed == null || position == null) return `vs ${opponent}`;
  const allowed = `vs ${opponent} (allows ${Number(opponentPointsAllowed).toFixed(1)} to ${position}`;
  return opponentApplied === false ? `${allowed}, context only)` : `${allowed})`;
}

/** The earlier of two kickoff instants (ISO strings); either may be absent. */
export function earlierKickoff(a, b) {
  const aTime = a ? new Date(a).getTime() : null;
  const bTime = b ? new Date(b).getTime() : null;
  if (aTime == null && bTime == null) return null;
  if (aTime == null) return b;
  if (bTime == null) return a;
  return aTime <= bTime ? a : b;
}

/**
 * One suggestion side (the advice's `current` or `suggested`), enriched with
 * the matching lineup entry's `position` and `kickoff` - fields the advice
 * payload itself does not carry (only `entities/roster`'s `lineupEntries`
 * does, sourced from the wire's own per-entry `kickoff`, #1235). A missing
 * lineup entry (the roster changed between the lineup read and the advice
 * read) degrades to no position/kickoff rather than throwing.
 */
function sideView(side, entriesById) {
  const entry = entriesById.get(side.playerId) || null;
  const position = entry?.position ?? null;
  const kickoff = entry?.kickoff ?? null;
  const distribution = side.distribution || null;
  return {
    playerId: side.playerId,
    name: side.name,
    position,
    kickoff,
    projection: side.projection ?? null,
    // The shared injury tag's code (#1852): the suggestion side's availability
    // carries the player's designation (O, IR, D, Q or null), the same field
    // the Ledger row's tag reads off the lineup entry.
    injuryStatus: side.availability?.status ?? entry?.injuryStatus ?? null,
    floor: distribution?.p10 ?? null,
    ceiling: distribution?.p90 ?? null,
    opponentContext: opponentContextText({
      opponent: side.opponent,
      opponentPointsAllowed: side.opponentPointsAllowed,
      position,
      opponentApplied: side.opponentApplied,
    }),
  };
}

// A comparison the intervals say is close to a coin flip (decision.service's
// own TOSSUP_PROBABILITY threshold, restated on the wire as `verdict`) reads
// as "too close to call" rather than a lean (CONTEXT.md's Start/sit advice:
// "an explicit too close to call answer when two players' distributions
// overlap enough that no honest edge exists").
export function isTooCloseToCall(suggestion) {
  return suggestion?.verdict === 'tossup';
}

/**
 * One suggestion, ready to render: `sit` (the current starter), `start` (the
 * bench player), a shared Floor..Ceiling domain the two RangeBars use so
 * they read on one scale, and `decideBy` - the earlier of the two players'
 * kickoffs, the moment the choice closes.
 */
export function buildSuggestionView(suggestion, entriesById) {
  const sit = sideView(suggestion.current, entriesById);
  const start = sideView(suggestion.suggested, entriesById);
  const domainMax = Math.max(sit.ceiling ?? 0, start.ceiling ?? 0, sit.projection ?? 0, start.projection ?? 0, 1);
  return {
    key: `${suggestion.slot}-${sit.playerId}-${start.playerId}`,
    slot: suggestion.slot,
    sit,
    start,
    gain: suggestion.gain ?? null,
    tooCloseToCall: isTooCloseToCall(suggestion),
    decideBy: earlierKickoff(sit.kickoff, start.kickoff),
    domainMin: 0,
    domainMax,
  };
}

/**
 * The advice's `movePlan` minus the moves of every dismissed suggestion (#1851).
 * `movePlan` is built server-side from the optimal assignment, not from the
 * suggestions the panel shows, so a dismissed swap would otherwise still be
 * made on Apply. A swap suggestion is exactly one sit (current starter -> bench)
 * and one start (bench player -> that slot), so a dismissed pair removes the
 * moves of those two players and nothing else: open-slot fills and reshuffles
 * name other players and pass through untouched.
 */
export function movePlanWithout(movePlan, dismissedViews) {
  const plan = Array.isArray(movePlan) ? movePlan : [];
  if (!dismissedViews || dismissedViews.length === 0) return plan;
  const held = new Set();
  for (const view of dismissedViews) {
    held.add(view.sit.playerId);
    held.add(view.start.playerId);
  }
  return plan.filter((move) => !held.has(move.playerId));
}

/** The Expected final gap, in points, at which the lean line appears (#1852). */
export const LEAN_LINE_MIN_GAP = 10;

/**
 * The one line at the top of the start/sit card when the Matchup is lopsided
 * (#1852): "Projected to trail by 12: lean toward Ceiling" or "Projected to
 * lead by 12: lean toward Floor". `mine` and `theirs` are the two teams'
 * Expected finals for the Matchup. The line appears only when the absolute gap
 * is `LEAN_LINE_MIN_GAP` or more (tested before rounding, so a 9.6 gap is no
 * line), shows the rounded gap, names no player and changes no suggestion.
 * A missing Expected final on either side reads as no line; a `0` is a value.
 */
export function projectedLeanLine(expectedFinals) {
  const mine = finite(expectedFinals?.mine);
  const theirs = finite(expectedFinals?.theirs);
  if (mine == null || theirs == null) return null;
  const gap = mine - theirs;
  if (Math.abs(gap) < LEAN_LINE_MIN_GAP) return null;
  const rounded = Math.round(Math.abs(gap));
  return gap < 0
    ? `Projected to trail by ${rounded}: lean toward Ceiling`
    : `Projected to lead by ${rounded}: lean toward Floor`;
}

export default buildSuggestionView;
