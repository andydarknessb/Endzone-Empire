/**
 * Draft order resolution: which team is on the clock for a given pick,
 * honoring a league's rotation type (snake vs linear) and any commissioner
 * round-by-round overrides. This supersedes the inline round-parity math
 * previously duplicated across draft.service.js, draftSocket.js,
 * autopick.service.js, and draft.router.js — draft.service.js's
 * teamIndexForPick() stays in place (and tested) as the plain snake-index
 * primitive teamForPick() falls back to.
 *
 * `teams` must already be sorted into base draft order (by draft_position).
 * `overrides` is the league's draft_order_overrides jsonb: a map of 1-based
 * round number -> array of team ids in the order they pick that round. A
 * round with no entry (or an entry that is no longer a valid permutation of
 * the live team ids — e.g. a team left after the override was saved) falls
 * back to the rotation.
 */
function isPermutationOf(candidate, teamIds) {
  if (!Array.isArray(candidate) || candidate.length !== teamIds.length) return false;
  const idSet = new Set(teamIds);
  const seen = new Set();
  for (const id of candidate) {
    if (!idSet.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** Pure: the team on the clock for 0-based pickNumber. */
function teamForPick(pickNumber, teams, { rotation = 'snake', overrides = null } = {}) {
  const teamCount = teams.length;
  if (teamCount === 0) return null;
  const round = Math.floor(pickNumber / teamCount);
  const slot = pickNumber % teamCount;

  if (overrides) {
    const teamIds = teams.map((t) => t.id);
    const roundOrder = overrides[String(round + 1)];
    if (isPermutationOf(roundOrder, teamIds)) {
      const byId = new Map(teams.map((t) => [t.id, t]));
      return byId.get(roundOrder[slot]);
    }
  }

  if (rotation === 'linear') return teams[slot];
  return round % 2 === 0 ? teams[slot] : teams[teamCount - 1 - slot];
}

/**
 * Validate a full draft_order_overrides object against the league's live
 * teams and round count. Returns an error string, or null when valid.
 * Rules: keys must be integers in [1, maxRounds]; each value must be a
 * permutation of the live team ids.
 */
function validateOrderOverrides(overrides, teamIds, maxRounds) {
  if (overrides == null) return null;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    return 'draftOrderOverrides must be an object keyed by round number';
  }
  for (const [key, order] of Object.entries(overrides)) {
    const round = Number(key);
    if (!Number.isInteger(round) || round < 1 || round > maxRounds) {
      return `invalid round "${key}" in draftOrderOverrides (must be 1-${maxRounds})`;
    }
    if (!isPermutationOf(order, teamIds)) {
      return `round ${key} override must list every team exactly once`;
    }
  }
  return null;
}

/**
 * Resolve each keeper to the 0-based pick number it occupies, given the
 * league's rotation/overrides. A keeper's draft_round is 1-based and names
 * the team's pick in that round — we scan the round's picks for the one
 * assigned to that team. Throws if the team doesn't pick in that round under
 * the current overrides (e.g. an override was edited after keepers were
 * assigned) — callers should surface this as a validation error rather than
 * silently dropping the keeper.
 */
function keeperPickNumbers(keepers, teams, { rotation = 'snake', overrides = null } = {}) {
  const teamCount = teams.length;
  return keepers.map((keeper) => {
    const roundStart = (keeper.draft_round - 1) * teamCount;
    let pickNumber = null;
    for (let slot = 0; slot < teamCount; slot++) {
      const candidate = roundStart + slot;
      const onClock = teamForPick(candidate, teams, { rotation, overrides });
      if (onClock && onClock.id === keeper.team_id) {
        pickNumber = candidate;
        break;
      }
    }
    if (pickNumber === null) {
      throw new Error(
        `team ${keeper.team_id} does not pick in round ${keeper.draft_round} under the current draft order`
      );
    }
    return { keeper, pickNumber };
  });
}

/** Pure: smallest pick number >= fromInclusive not present in takenSet, below totalPicks (or null if none). */
function nextOpenPickNumber(takenSet, fromInclusive, totalPicks) {
  for (let n = fromInclusive; n < totalPicks; n++) {
    if (!takenSet.has(n)) return n;
  }
  return null;
}

module.exports = {
  teamForPick,
  validateOrderOverrides,
  keeperPickNumbers,
  nextOpenPickNumber,
  isPermutationOf,
};
