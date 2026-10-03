/**
 * Pure view-building for the start-sit-panel widget (#1238, ADR 0037 AC1):
 * shapes one advice `suggestion` (`server/services/decision.service.js`'s
 * `buildSuggestions`) plus the page's own lineup entries (for kickoff, which
 * the advice payload does not carry - only the lineup entry does, #1235)
 * into what the panel renders. No network, no React: every branch here is
 * unit-tested directly.
 */

import { finite, ordinal, VOLATILITY_LABELS } from '../../../shared/lib';

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

/** The Line total at which the "High total" chip appears (#1853). */
export const HIGH_TOTAL_MIN = 48;
/** How many points a team must be favored by for the "Favored by" chip (#1853). */
export const FAVORED_BY_MIN = 7;
/** Outdoor wind speed, mph, at which the "Wind" chip appears (#1853). */
export const WIND_MIN_MPH = 20;
/** Outdoor chance of precipitation, percent, at which the "Rain" chip appears (#1853). */
export const RAIN_MIN_PERCENT = 60;

// 49.5 -> "49.5", 48 -> "48": a half point is kept, a whole number has no ".0".
const plain = (n) => String(Math.round(n * 10) / 10);

/**
 * The fact chips under one suggestion side (#1853): only what is notable about
 * the player's game, in a fixed order (total, favored, wind, rain), each
 * `{ key, text, contextOnly }`. `line` is the payload's `{ spread, total,
 * favoredBy }` (favoredBy positive when the player's team is favored) and
 * `weather` its `{ indoor, windSpeedMph, precipitationProbability, ... }`; either
 * may be null. A dome has no weather chip. The Implied team total is never
 * shown here (ADR 0037: Decision card only).
 *
 * `contextOnly` is driven by the Factor's applied flag, not hard-coded: the
 * Line chips by `marketApplied` (the gameEnvironment Factor), the weather chips
 * by `weatherApplied`. Only an explicit `true` drops the label, so a payload
 * that does not say is never read as applied; under v3.1 both Factors have a
 * maximum effect of zero and both flags are false.
 */
export function factChips({ line, weather, weatherApplied, marketApplied } = {}) {
  const marketContextOnly = marketApplied !== true;
  const weatherContextOnly = weatherApplied !== true;
  const chips = [];
  const total = finite(line?.total);
  if (total != null && total >= HIGH_TOTAL_MIN) {
    chips.push({ key: 'total', text: `High total ${plain(total)}`, contextOnly: marketContextOnly });
  }
  const favoredBy = finite(line?.favoredBy);
  if (favoredBy != null && favoredBy >= FAVORED_BY_MIN) {
    chips.push({ key: 'favored', text: `Favored by ${plain(favoredBy)}`, contextOnly: marketContextOnly });
  }
  if (weather && !weather.indoor) {
    const wind = finite(weather.windSpeedMph);
    if (wind != null && wind >= WIND_MIN_MPH) {
      chips.push({ key: 'wind', text: `Wind ${Math.round(wind)} mph`, contextOnly: weatherContextOnly });
    }
    const rain = finite(weather.precipitationProbability);
    if (rain != null && rain >= RAIN_MIN_PERCENT) {
      chips.push({ key: 'rain', text: `Rain ${Math.round(rain)}%`, contextOnly: weatherContextOnly });
    }
  }
  return chips;
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
    // "No practice this week" beside a Questionable tag (ADR 0056): the server's
    // verdict reason, carried as-is.
    noPractice: side.availability?.reason === 'no_practice',
    // The "Backup" tag (ADR 0057): a quarterback behind an available teammate.
    backup: side.availability?.reason === 'backup',
    volatility: VOLATILITY_LABELS[side.volatility] ?? null,
    floor: distribution?.p10 ?? null,
    ceiling: distribution?.p90 ?? null,
    opponentContext: opponentContextText({
      opponent: side.opponent,
      opponentPointsAllowed: side.opponentPointsAllowed,
      position,
      opponentApplied: side.opponentApplied,
    }),
    factChips: factChips({
      line: side.line,
      weather: side.weather,
      weatherApplied: side.weatherApplied,
      marketApplied: side.marketApplied,
    }),
  };
}

// A comparison the intervals say is close to a coin flip (Interval reading's
// tossup line, restated on the wire as `verdict`) reads
// as "too close to call" rather than a lean (CONTEXT.md's Start/sit advice:
// "an explicit too close to call answer when two players' distributions
// overlap enough that no honest edge exists").
export function isTooCloseToCall(suggestion) {
  return suggestion?.verdict === 'tossup';
}

// "about N%" to the nearest 10%, never above 90% (the 90-100% bin observed
// 92.6%, so a higher figure would overclaim). Null when there is no probability.
export function probabilityLabel(probability) {
  const p = finite(probability);
  return p == null ? null : `about ${Math.min(90, Math.round(p * 10) * 10)}%`;
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
    verdict: suggestion.verdict,
    tooCloseToCall: isTooCloseToCall(suggestion),
    probabilityLabel: probabilityLabel(suggestion.probabilityBetter),
    // The start/sit probability the Forecast quoted (#1856); a called shot is
    // offered only where there is an edge to call it against.
    probability: finite(suggestion.probabilityBetter),
    canCallShot: !isTooCloseToCall(suggestion) && finite(suggestion.probabilityBetter) != null,
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

/**
 * The standing "Your called shot" line (#1856), from the advice payload's
 * `calledShot` ({ starter, benched: { name, projection, points }, probability,
 * status: 'pending' | 'locked' | 'resolved', outcome: 'hit' | 'miss' | 'void' | null,
 * bothLocked, canWithdraw }), or null when there is none. Returns the pair, the numbers as
 * called and one status sentence; every status the payload can carry has its
 * own wording, and an unknown one reads as still open rather than as nothing.
 */
export function calledShotLine(calledShot, entriesById = new Map()) {
  if (!calledShot || !calledShot.starter || !calledShot.benched) return null;
  const { starter, benched } = calledShot;
  const number = (n) => (finite(n) == null ? '-' : Number(n).toFixed(1));
  const probability = finite(calledShot.probability);
  const numbers = [
    `Proj ${number(starter.projection)} vs ${number(benched.projection)}`,
    probability != null ? `${Math.round(probability * 100)}% lean to ${benched.name}` : null,
  ].filter(Boolean).join(' · ');
  let status;
  if (calledShot.status === 'resolved') {
    const scores = `${starter.name} scored ${number(starter.points)}, ${benched.name} ${number(benched.points)}`;
    if (calledShot.outcome === 'hit') status = `Hit: ${scores}`;
    else if (calledShot.outcome === 'miss') status = `Miss: ${scores}`;
    else status = 'Void: a player did not play, or the lineup changed';
  } else if (calledShot.status === 'locked' && calledShot.bothLocked) {
    // Both games have kicked off (#1857): the points are moving. The lineup
    // entries carry the page's live points; the payload's are the read's.
    const live = (side) => number(finite(entriesById.get(side.playerId)?.points) ?? side.points);
    status = `Live: ${starter.name} ${live(starter)} to ${benched.name} ${live(benched)}`;
  } else if (calledShot.status === 'locked') {
    status = 'Locked: one of the two games has started';
  } else {
    status = 'Open until the first of the two kicks off';
  }
  const state = calledShot.status === 'resolved'
    ? `resolved-${calledShot.outcome || 'void'}`
    : (calledShot.status === 'locked' ? 'locked' : 'pending');
  return {
    text: `${starter.name} over ${benched.name}`,
    numbers,
    status,
    state,
    canWithdraw: calledShot.canWithdraw === true,
  };
}

/**
 * The season points-left line (#1861), from the advice payload's `pointsLeft`
 * ({ total, rank, teams }): "Left on the bench this season: 41.2 (3rd fewest of
 * 10)". Null when the payload has no standing (best ball, pick'em, week one) or
 * one it cannot read.
 */
export function pointsLeftLine(pointsLeft) {
  const total = finite(pointsLeft?.total);
  const rank = ordinal(finite(pointsLeft?.rank));
  if (total == null || rank == null) return null;
  return `Left on the bench this season: ${total.toFixed(1)} (${rank} fewest of ${pointsLeft.teams})`;
}

/**
 * The "You vs the Forecast: 5-3" line (#1862), from the advice payload's
 * `overrideRecord` ({ hits, misses } over this team's resolved Overrides).
 * Null when nothing has resolved or the payload cannot be read.
 */
export function forecastRecordLine(overrideRecord) {
  const hits = finite(overrideRecord?.hits);
  const misses = finite(overrideRecord?.misses);
  if (hits == null || misses == null || hits + misses === 0) return null;
  return `You vs the Forecast: ${hits}-${misses}`;
}

/**
 * The "Called shots this season: 2 of 3 · streak 2" line (#1862), from the
 * payload's `calledShotRecord` ({ hits, resolved, streak }). Null when no shot
 * has resolved or the payload cannot be read.
 */
export function calledRecordLine(calledShotRecord) {
  const hits = finite(calledShotRecord?.hits);
  const resolved = finite(calledShotRecord?.resolved);
  const streak = finite(calledShotRecord?.streak);
  if (hits == null || resolved == null || streak == null || resolved === 0) return null;
  return `Called shots this season: ${hits} of ${resolved} · streak ${streak}`;
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
