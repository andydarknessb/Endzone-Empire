/**
 * The CPU managers' draft brain.
 *
 * SYNC OBLIGATION (repo convention — see src/lib/positionCapsFeasibility.js):
 *   - `needMultiplier` is an adaptation of `fitAdjustedValue` in
 *     server/services/decision.service.js (~line 371): same "dedicated + flex
 *     capacity vs. how many you already have" idea, widened from the trade
 *     analyzer's 1.15/1.0/0.85 to a four-step curve with a per-position bench
 *     tolerance, because a drafter legitimately wants RB/WR depth but never a
 *     second kicker.
 *   - `positionGroupKey` mirrors `positionCapGroup` in
 *     server/services/draft.service.js: IDP roster math is done at the
 *     DL/LB/DB group level, not the literal Tank01 position code.
 *
 * Everything is pure and takes its randomness from an injected `rng()`, so a
 * seeded sim replays identically (see rng.js).
 */
import {
  POSITION_GROUPS, IDP_POSITIONS, templateFor, slotEligible,
} from './templates';
import { rosterFor, availablePlayers, currentRound, picksRemainingFor, unfilledDedicatedSlots } from './engine';
import { rngForPick } from './rng';

const IDP_POSITION_SET = new Set(IDP_POSITIONS);

/** How many of the lowest-effAdp available players the CPU actually considers. */
export const CANDIDATE_POOL_SIZE = 15;
/** Jitter applied to every candidate's score, so identical rosters diverge. */
export const JITTER = 0.06;
/** Effective ADP gap (in picks) that earns the full scarcity bonus. */
export const SCARCITY_SCALE = 25;
export const MAX_SCARCITY = 0.2;

/**
 * A usable draft-position number for every player.
 *
 * Individual defenders never carry market ADP (no free redraft IDP market
 * exists — see adp.service.js), so they're mapped onto the ADP scale from their
 * production rank instead: IDP1 lands around pick 154, IDP20 around 230. Any
 * other player without ADP falls back to a projection-derived pseudo-ADP.
 */
export function effAdp(player) {
  const adp = Number(player && player.adp);
  if (Number.isFinite(adp) && adp > 0) return adp;
  if (player && IDP_POSITION_SET.has(player.position)) {
    const rank = Number(player.positionRank);
    return 150 + (Number.isFinite(rank) && rank > 0 ? rank : 40) * 4;
  }
  const projected = Number(player && player.projectedPoints);
  return 400 - (Number.isFinite(projected) ? projected : 0);
}

/** Mirrors positionCapGroup in server/services/draft.service.js. */
export function positionGroupKey(position) {
  return Object.keys(POSITION_GROUPS).find((key) => POSITION_GROUPS[key].includes(position)) || position;
}

/** Total starting slots (dedicated + flex-style) a position is eligible for. */
export function slotCapacityFor(template, position) {
  let capacity = 0;
  for (const slot of template.slots) {
    if (slotEligible(slot.key, position, template.slots)) capacity += slot.count;
  }
  return capacity;
}

/**
 * How many beyond the starting capacity a sane manager still wants. RB/WR carry
 * real injury/bye depth; QB/TE one backup; K/DEF none; IDP one.
 */
export function benchToleranceFor(position) {
  if (position === 'RB' || position === 'WR') return 3;
  if (position === 'QB' || position === 'TE') return 1;
  if (position === 'K' || position === 'DEF') return 0;
  return 1;
}

/**
 * Roster-need weight for a position on one team: 1.15 filling an empty starting
 * slot, 1.0 while there's room, 0.9 once starters are covered, 0.7 past the
 * bench tolerance.
 */
export function needMultiplier(state, teamId, position) {
  const template = templateFor(state.config.leagueType);
  const capacity = slotCapacityFor(template, position);
  const group = positionGroupKey(position);
  const filling = rosterFor(state, teamId)
    .filter((p) => positionGroupKey(p.position) === group).length;
  const tolerance = benchToleranceFor(position);

  if (capacity > 0 && filling === 0) return 1.15;
  if (filling >= capacity + tolerance) return 0.7;
  if (filling >= capacity) return 0.9;
  return 1.0;
}

/** The gap to the next-best available player at the same position, as a 0–0.2 bonus. */
export function scarcityBonus(gap) {
  const value = Number(gap);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.max(value / SCARCITY_SCALE, 0), MAX_SCARCITY);
}

/** True once kickers and defenses are fair game (the last three rounds). */
export function kickersAndDefensesOpen(state) {
  return currentRound(state) > state.rounds - 3;
}

/**
 * The pool this team may pick from right now.
 *
 * Two filters, in priority order:
 *  1. Must-fill guard — when a team has no more picks than unfilled dedicated
 *     starting slots, it may only take players who fill one. This is what
 *     actually forces the late-round K and DEF, and it deliberately overrides
 *     the early-K/DEF gate below (a team that must draft a kicker, drafts one).
 *  2. Otherwise K and DEF are off the board until the last three rounds — no
 *     credible manager takes a kicker in round 4.
 */
export function eligibleCandidates(state, teamId) {
  const available = availablePlayers(state);
  const template = templateFor(state.config.leagueType);

  const unfilled = unfilledDedicatedSlots(state, teamId);
  const unfilledCount = [...unfilled.values()].reduce((sum, n) => sum + n, 0);
  if (unfilledCount > 0 && picksRemainingFor(state, teamId) <= unfilledCount) {
    const mustFill = available.filter((player) =>
      [...unfilled.keys()].some((slotKey) => slotEligible(slotKey, player.position, template.slots))
    );
    if (mustFill.length > 0) return mustFill;
  }

  if (kickersAndDefensesOpen(state)) return available;
  return available.filter((player) => player.position !== 'K' && player.position !== 'DEF');
}

/**
 * Pick a player for a CPU team. Returns a playerId, or null when nothing is
 * available. Scores the 15 lowest-effAdp candidates on
 * `(300 - effAdp) × need × (1 + scarcity) × jitter` and takes the argmax.
 */
export function cpuPick(state, teamId, rng = Math.random) {
  const pool = eligibleCandidates(state, teamId);
  if (pool.length === 0) return null;

  const scored = pool
    .map((player) => ({ player, adp: effAdp(player) }))
    .sort((a, b) => a.adp - b.adp || a.player.playerId - b.player.playerId);

  // Next-best-at-this-position lookup for the scarcity term, over the whole
  // eligible pool (not just the candidate slice) so a cliff just outside the
  // top 15 still registers.
  const nextAtPosition = new Map();
  const seenByGroup = new Map();
  for (let i = scored.length - 1; i >= 0; i--) {
    const group = positionGroupKey(scored[i].player.position);
    const laterAdp = seenByGroup.get(group);
    nextAtPosition.set(scored[i].player.playerId, laterAdp == null ? null : laterAdp - scored[i].adp);
    seenByGroup.set(group, scored[i].adp);
  }

  const candidates = scored.slice(0, CANDIDATE_POOL_SIZE);
  let best = null;
  let bestScore = -Infinity;
  for (const { player, adp } of candidates) {
    const need = needMultiplier(state, teamId, player.position);
    const scarcity = scarcityBonus(nextAtPosition.get(player.playerId));
    const jitter = 1 + (rng() * 2 - 1) * JITTER;
    const score = (300 - adp) * need * (1 + scarcity) * jitter;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best ? best.playerId : null;
}

/**
 * The generator for the pick currently on the clock, derived from the sim's one
 * stored seed and how many picks have already landed. Each pick gets its own
 * non-overlapping slice of the stream (one draw per candidate, plus a spare),
 * so a resumed draft reproduces exactly the CPU decisions it made before the
 * refresh without persisting a cursor.
 */
export function rngForState(state) {
  return rngForPick(state.seed, state.picks.length * (CANDIDATE_POOL_SIZE + 1));
}

/**
 * The user's auto-pick when the clock runs out: the same brain, so a timeout
 * never hands you a worse roster than a CPU would have built.
 */
export function autoPickForUser(state, teamId, rng = Math.random) {
  return cpuPick(state, teamId, rng);
}
