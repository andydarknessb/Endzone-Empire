/**
 * Starting need (CONTEXT.md): does adding one player raise a team's count of
 * FILLED starting-slot instances? A pure leaf for the Pick clock's autopick
 * need phase (#746, ADR 0026). It issues no queries and imports no pool; the
 * caller hands it already-read data (the league's roster_slots, the team's
 * current positions, one candidate position) and it answers.
 *
 * WHY MAXIMUM MATCHING AND NOT A GREEDY SCAN. `roster_slots` is commissioner
 * free-text jsonb, so slots can appear in any order with any OVERLAPPING,
 * non-nested eligibility, and a greedy scan strands players. "Fills a Starting
 * need" is therefore the unweighted maximum bipartite matching between players
 * and slot INSTANCES (a 2-count RB slot is two instances) via Kuhn's algorithm:
 * a candidate fills a need exactly when the maximum match GROWS when he is added.
 *
 * SYNC OBLIGATION (repo convention). This is the server twin of the client's
 * starter-slot matching, and the two must agree on what a filled starting slot
 * is:
 *   - src/lib/rosterAssignment.js `matchStarters` / `expandSlotInstances` is the
 *     same unweighted Kuhn matching over the same slot-instance model; keep the
 *     free-first-then-augment search and the per-array-index eligibility in step
 *     with it.
 *   - src/lib/draftSim/cpuBrain.js is the Draft Sim's need logic (needMultiplier,
 *     kickersAndDefensesOpen, eligibleCandidates); it shares this module's
 *     KICKER_DEFENSE_WINDOW_ROUNDS window, pinned by
 *     src/lib/draftSim/kickerDefenseWindow.parity.test.js.
 * Eligibility (including IDP DL/LB/DB group keys) comes from
 * server/services/lineup.service.js `expandEligibility` so a starting slot
 * admits exactly the positions lineup validation admits.
 */

const { expandEligibility } = require('./lineup.service');

// K and DEF are held out of the autopick need/bench phases until the last three
// rounds (unless the must-fill guard fires). The Draft Sim mirrors this window;
// kickerDefenseWindow.parity.test.js pins the two equal.
const KICKER_DEFENSE_WINDOW_ROUNDS = 3;

/**
 * Pure: rosterSlots -> one entry per startable slot INSTANCE, each carrying the
 * expanded set of positions it admits. Eligibility is captured per ARRAY INDEX
 * and never looked up by key, because nothing validates key uniqueness in a
 * league's roster_slots (mirrors expandSlotInstances in rosterAssignment.js).
 */
function expandStartingSlotInstances(rosterSlots = []) {
  const instances = [];
  (rosterSlots || []).forEach((slot) => {
    if (!slot || slot.key == null) return;
    const raw = Number(slot.count);
    const count = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    const eligiblePositions = Array.isArray(slot.eligiblePositions) ? slot.eligiblePositions : [];
    const eligible = expandEligibility(eligiblePositions);
    for (let i = 0; i < count; i++) instances.push({ eligible });
  });
  return instances;
}

/** A roster entry may be a bare position string or an object carrying `.position`. */
function positionOf(entry) {
  return typeof entry === 'string' ? entry : entry && entry.position;
}

function rosterPositions(roster) {
  return (roster || []).map(positionOf).filter(Boolean);
}

/**
 * Kuhn's maximum bipartite matching between player positions and slot instances,
 * players processed in order. Free-first (claim an unused eligible instance),
 * then augment (re-home an incumbent who has somewhere else to go). Returns the
 * number of instances matched, i.e. the count of filled starting slots.
 */
function maxStartersMatched(positions, instances) {
  const matchInstance = new Array(instances.length).fill(-1);
  const eligibleFor = positions.map((position) => {
    const out = [];
    if (position) {
      instances.forEach((instance, j) => {
        if (instance.eligible.has(position)) out.push(j);
      });
    }
    return out;
  });

  const tryAssign = (p, visited) => {
    for (const j of eligibleFor[p]) {
      if (!visited[j] && matchInstance[j] === -1) {
        visited[j] = 1;
        matchInstance[j] = p;
        return true;
      }
    }
    for (const j of eligibleFor[p]) {
      if (visited[j]) continue;
      visited[j] = 1;
      if (tryAssign(matchInstance[j], visited)) {
        matchInstance[j] = p;
        return true;
      }
    }
    return false;
  };

  for (let p = 0; p < positions.length; p++) {
    tryAssign(p, new Uint8Array(instances.length));
  }
  return matchInstance.filter((p) => p >= 0).length;
}

/** How many starting-slot instances this roster already fills (maximum matching). */
function startersFilled({ rosterSlots = [], roster = [] } = {}) {
  return maxStartersMatched(rosterPositions(roster), expandStartingSlotInstances(rosterSlots));
}

/** Open Starting needs: starting-slot instances this roster leaves unfilled. */
function openStartingNeeds({ rosterSlots = [], roster = [] } = {}) {
  const instances = expandStartingSlotInstances(rosterSlots);
  return instances.length - maxStartersMatched(rosterPositions(roster), instances);
}

/**
 * Does adding a player of `candidatePosition` raise the team's filled-starter
 * count? True exactly when the maximum match grows by one when he is appended.
 */
function fillsStartingNeed({ rosterSlots = [], roster = [], candidatePosition } = {}) {
  if (!candidatePosition) return false;
  const instances = expandStartingSlotInstances(rosterSlots);
  const positions = rosterPositions(roster);
  const before = maxStartersMatched(positions, instances);
  const after = maxStartersMatched([...positions, candidatePosition], instances);
  return after > before;
}

module.exports = {
  fillsStartingNeed,
  openStartingNeeds,
  startersFilled,
  KICKER_DEFENSE_WINDOW_ROUNDS,
};
