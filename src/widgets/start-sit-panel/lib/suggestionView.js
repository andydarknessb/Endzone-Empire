/**
 * Pure view-building for the start-sit-panel widget (#1238, ADR 0037 AC1):
 * shapes one advice `suggestion` (`server/services/decision.service.js`'s
 * `buildSuggestions`) plus the page's own lineup entries (for kickoff, which
 * the advice payload does not carry - only the lineup entry does, #1235)
 * into what the panel renders. No network, no React: every branch here is
 * unit-tested directly.
 */

/** vs {opponent}, plus the defense's points allowed to this position when known. */
export function opponentContextText({ opponent, opponentPointsAllowed, position }) {
  if (!opponent) return null;
  if (opponentPointsAllowed == null || position == null) return `vs ${opponent}`;
  return `vs ${opponent} (allows ${Number(opponentPointsAllowed).toFixed(1)} to ${position})`;
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
    floor: distribution?.p10 ?? null,
    ceiling: distribution?.p90 ?? null,
    opponentContext: opponentContextText({
      opponent: side.opponent,
      opponentPointsAllowed: side.opponentPointsAllowed,
      position,
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

export default buildSuggestionView;
