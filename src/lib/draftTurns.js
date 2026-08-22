/**
 * Draft turn order: who is on the clock for a pick, which picks a team still
 * has coming, and how a pick number reads on screen.
 *
 * SYNC OBLIGATION (repo convention — see src/lib/positionCapsFeasibility.js):
 *   - `teamIdForPick` is hand-mirrored from `teamForPick` in
 *     server/services/draftOrder.service.js (line ~29), including
 *     `isPermutationOf`: snake and linear rotations, plus per-round
 *     `draft_order_overrides` that are honored only when the stored order is
 *     still a permutation of the live team ids. There is no shared module
 *     between client and server in this repo; if the server's order semantics
 *     change, change them here.
 *   - `remainingPickNumbersFor` mirrors the skip-taken-picks behaviour of
 *     `nextOpenPickNumber` in the same file (line ~103), including its
 *     exclusive `n < totalPicks` bound.
 *
 * PICK NUMBERING. Every function here takes and returns a 0-BASED pick index,
 * matching the server's `teamForPick(pickNumber, ...)` and the stored
 * `leagues.current_pick`. Two things nearby are 1-based and must be converted
 * exactly once, at the call site:
 *   - the draft simulator's `state.currentPick` (see src/lib/draftSim/engine.js)
 *   - stored `draft_picks.pick_number`
 *
 * KEEPERS. Keeper picks are pre-inserted at their future pick numbers when the
 * draft starts (server/services/draftStart.service.js), and the live draft
 * skips over them. A team's own un-reached keeper slots are therefore NOT picks
 * it still has, which is why `remainingPickNumbersFor` takes `takenPickNumbers`.
 */

/** Mirrors draftOrder.service.js isPermutationOf. */
export function isPermutationOf(candidate, teamIds) {
  if (!Array.isArray(candidate) || candidate.length !== teamIds.length) return false;
  const idSet = new Set(teamIds);
  const seen = new Set();
  for (const id of candidate) {
    if (!idSet.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * Pure: the index into the base draft order that picks at 0-based `pickNumber`.
 * Rotation only — overrides address teams by id, so they cannot be expressed as
 * an index and are resolved by `teamIdForPick`.
 */
export function teamIndexForPick(pickNumber, teamCount, { rotation = 'snake' } = {}) {
  if (!(teamCount > 0)) return -1;
  const round = Math.floor(pickNumber / teamCount);
  const slot = pickNumber % teamCount;
  if (rotation === 'linear') return slot;
  return round % 2 === 0 ? slot : teamCount - 1 - slot;
}

/**
 * Pure: the id of the team on the clock for 0-based `pickNumber`, or null.
 * `teamIds` must already be in base draft order (by draft_position).
 */
export function teamIdForPick(pickNumber, teamIds, { rotation = 'snake', overrides = null } = {}) {
  const teamCount = teamIds.length;
  if (teamCount === 0) return null;

  if (overrides) {
    const round = Math.floor(pickNumber / teamCount);
    const slot = pickNumber % teamCount;
    const roundOrder = overrides[String(round + 1)];
    if (isPermutationOf(roundOrder, teamIds)) return roundOrder[slot];
  }

  const index = teamIndexForPick(pickNumber, teamCount, { rotation });
  return index < 0 ? null : teamIds[index];
}

/** 'R.PP' for a 0-based pick number. (0, 10) -> '1.01'; (19, 10) -> '2.10'. */
export function pickLabelFor(pickNumber, teamCount) {
  if (!(teamCount > 0) || !Number.isFinite(pickNumber) || pickNumber < 0) return null;
  const round = Math.floor(pickNumber / teamCount) + 1;
  const slot = (pickNumber % teamCount) + 1;
  return `${round}.${String(slot).padStart(2, '0')}`;
}

/**
 * The 0-based pick numbers a team still owns, ascending, INCLUDING the one on
 * the clock and EXCLUDING anything already in `takenPickNumbers` (keepers).
 *
 * Iterates rather than solving in closed form on purpose: per-round overrides
 * can reorder any round arbitrarily, so no closed form is correct. Bounded by
 * totalPicks, which is at most 14 teams x ~20 rounds.
 */
export function remainingPickNumbersFor({
  teamId,
  teamIds = [],
  fromPick0 = 0,
  totalPicks = 0,
  rotation = 'snake',
  overrides = null,
  takenPickNumbers = null,
  limit = Infinity,
} = {}) {
  const out = [];
  if (teamId == null || teamIds.length === 0) return out;
  const start = Math.max(0, fromPick0);
  for (let n = start; n < totalPicks; n++) {
    if (takenPickNumbers && takenPickNumbers.has(n)) continue;
    if (teamIdForPick(n, teamIds, { rotation, overrides }) === teamId) {
      out.push(n);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * What the roster needs strip shows: how many picks are left, the next one, and
 * whether the next two are back to back (the snake turn boundary).
 */
export function turnSummaryFor(args = {}) {
  const remaining = remainingPickNumbersFor(args);
  const teamCount = (args.teamIds || []).length;
  const toPick = (pickNumber) => (pickNumber == null ? null : {
    pickNumber,
    round: Math.floor(pickNumber / teamCount) + 1,
    slot: (pickNumber % teamCount) + 1,
    label: pickLabelFor(pickNumber, teamCount),
  });

  const nextPick = toPick(remaining.length > 0 ? remaining[0] : null);
  const followingPick = toPick(remaining.length > 1 ? remaining[1] : null);
  return {
    remainingPicks: remaining.length,
    remaining,
    nextPick,
    followingPick,
    backToBack: !!(nextPick && followingPick
      && followingPick.pickNumber === nextPick.pickNumber + 1),
  };
}
