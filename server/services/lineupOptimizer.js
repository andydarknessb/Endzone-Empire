const { slotEligible, DEFAULT_ROSTER_SLOTS } = require('./lineup.service');

/**
 * Exact weekly lineup optimization.
 *
 * The previous start/sit recommender walked each starting slot in order and
 * offered the best eligible bench player for it. That greedy scan is provably
 * wrong whenever a flexible slot competes with a restrictive one for the same
 * player. The canonical counterexample, which is a test:
 *
 *     RB slot, FLEX slot. Bench: RB 20, WR 18. Starting RB: 5.
 *     Greedy walks RB first (or FLEX first) and can hand the RB to FLEX,
 *     leaving the RB-only slot with the 5-point incumbent: 5 + 20 = 25.
 *     The exact answer starts RB 20 at RB and WR 18 at FLEX: 38.
 *
 * Real rosters make this worse, not better: SUPERFLEX takes QBs, DP takes
 * three different defensive groups, and leagues run repeated slots. So the
 * assignment is solved exactly, as a min-cost bipartite matching between slot
 * INSTANCES (a 2-count RB slot is two instances) and players, via the
 * Jonker-Volgenant/Hungarian algorithm with potentials.
 *
 * Sizing: a roster is ~16 players against ~10 slot instances, so the padded
 * square matrix is well under 40x40 and an O(n^3) exact solve is microseconds.
 * There is no reason to approximate.
 *
 * Leaving a slot EMPTY is a legal outcome and costs exactly 0, which is why a
 * player projected below zero (real for IDP and DST) is correctly left on the
 * bench instead of being forced into a slot.
 */

// Any cost this large is never chosen unless the matrix has no alternative,
// and such an assignment is discarded when the result is read back.
const INELIGIBLE = 1e9;

/** Pure: rosterSlots -> one entry per startable slot INSTANCE, in display order. */
function expandSlotInstances(rosterSlots = DEFAULT_ROSTER_SLOTS) {
  const instances = [];
  for (const slot of rosterSlots || []) {
    const count = Number(slot && slot.count) || 0;
    for (let i = 0; i < count; i++) instances.push({ key: slot.key, index: i });
  }
  return instances;
}

/**
 * Min-cost assignment for a rectangular cost matrix with rows <= cols.
 * Returns `assignment[row] = col` (or -1). Standard O(n^2 m) shortest
 * augmenting path formulation with dual potentials; deterministic for a given
 * matrix, which matters because two equally-good lineups must not flap
 * between page loads.
 */
function minCostAssignment(cost) {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (m < n) throw new Error('minCostAssignment requires at least as many columns as rows');

  const INF = Infinity;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0); // p[col] = row matched to col (1-indexed)
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function pointsValue(pointsFor, playerId) {
  const raw = pointsFor instanceof Map ? pointsFor.get(playerId) : (pointsFor || {})[playerId];
  const value = raw && typeof raw === 'object' ? raw.points : raw;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

/**
 * The highest-scoring legal starting lineup.
 *
 * @param {object}   args
 * @param {Array}    args.rosterSlots  league slot configuration
 * @param {Array}    args.candidates   [{ playerId, position }] — already filtered
 *                                     to AVAILABLE, movable players
 * @param {Map}      args.pointsFor    playerId -> points (or { points })
 * @param {Map}      args.pinned       playerId -> slotKey for locked starters,
 *                                     who keep their exact slot instance
 * @returns {{ assignments, byPlayer, total }}
 */
function optimalAssignment({
  rosterSlots = DEFAULT_ROSTER_SLOTS,
  candidates = [],
  pointsFor = new Map(),
  pinned = new Map(),
}) {
  const instances = expandSlotInstances(rosterSlots);
  const assignments = instances.map((slot) => ({
    slotKey: slot.key,
    slotIndex: slot.index,
    playerId: null,
    points: 0,
  }));

  // Locked starters consume their slot instance up front and never enter the
  // matrix: they cannot legally be moved, so optimizing over them would
  // produce advice the server would reject.
  const takenBySlot = new Map();
  const byPlayer = new Map();
  let total = 0;
  for (const [playerId, slotKey] of pinned) {
    const used = takenBySlot.get(slotKey) || 0;
    const target = assignments.find((a) => a.slotKey === slotKey && a.slotIndex === used && a.playerId === null);
    takenBySlot.set(slotKey, used + 1);
    const points = pointsValue(pointsFor, playerId);
    total += points;
    byPlayer.set(playerId, slotKey);
    if (target) {
      target.playerId = playerId;
      target.points = points;
      target.locked = true;
    } else {
      // A locked player in a slot the league no longer configures (a mid-season
      // roster-shape change). He still counts and still cannot move.
      assignments.push({ slotKey, slotIndex: used, playerId, points, locked: true });
    }
  }

  const openSlots = assignments.filter((a) => a.playerId === null);
  const pool = candidates.filter((c) => c && !pinned.has(c.playerId));
  if (openSlots.length === 0 || pool.length === 0) {
    return { assignments, byPlayer, total: Math.round(total * 100) / 100 };
  }

  // Rows: open slot instances. Columns: real players, then one "leave empty"
  // dummy per slot so that every row can always be filled at zero cost.
  const rows = openSlots.length;
  const cols = pool.length + rows;
  const cost = [];
  for (let r = 0; r < rows; r++) {
    const slot = openSlots[r];
    const row = new Array(cols).fill(0);
    for (let c = 0; c < pool.length; c++) {
      const player = pool[c];
      row[c] = slotEligible(slot.slotKey, player.position, rosterSlots)
        ? -pointsValue(pointsFor, player.playerId)
        : INELIGIBLE;
    }
    cost.push(row);
  }

  const assignment = minCostAssignment(cost);
  for (let r = 0; r < rows; r++) {
    const c = assignment[r];
    if (c < 0 || c >= pool.length) continue; // matched to a "leave empty" dummy
    if (cost[r][c] >= INELIGIBLE) continue; // never accept an illegal pairing
    const player = pool[c];
    openSlots[r].playerId = player.playerId;
    openSlots[r].points = pointsValue(pointsFor, player.playerId);
    byPlayer.set(player.playerId, openSlots[r].slotKey);
    total += openSlots[r].points;
  }

  return { assignments, byPlayer, total: Math.round(total * 100) / 100 };
}

/**
 * Pure: turn "where players are now" plus "where they should be" into
 * actionable, applicable changes.
 *
 * Pairing is done PER SLOT INSTANCE, not by sorting gains: the incoming player
 * is matched with whoever currently occupies the exact slot the optimizer put
 * him in. That is what makes a suggestion applicable as shown — the Apply
 * button sends "current player to the bench, suggested player into the current
 * player's slot", and slot-instance pairing guarantees that payload reproduces
 * the optimizer's own answer rather than an approximation of it.
 *
 * Returns two kinds of change:
 *  - `swaps`:  a bench player replaces the starter in a specific slot;
 *  - `fills`:  a bench player takes an EMPTY starting slot (a one-move change
 *              the previous greedy recommender could not see at all).
 *
 * A pure reshuffle of players already starting (A to FLEX, B to RB) is neither,
 * and appears only in the caller's move plan — which is why `optimalTotal` is
 * the optimizer's own total and not the sum of suggestion gains.
 *
 * No player appears in two recommendations: every player holds at most one slot
 * instance in the assignment, and every slot instance yields at most one entry.
 */
function buildSwapSuggestions({
  entries,
  optimalAssignments,
  optimalByPlayer,
  projectionOf,
  startingSlots,
}) {
  const byId = new Map(entries.map((e) => [e.playerId, e]));
  const isStarter = (e) => startingSlots.has(e.slot);

  // Current occupants per slot instance, in the same order the assignment
  // enumerates them.
  const occupantsBySlot = new Map();
  for (const entry of entries) {
    if (!isStarter(entry)) continue;
    if (!occupantsBySlot.has(entry.slot)) occupantsBySlot.set(entry.slot, []);
    occupantsBySlot.get(entry.slot).push(entry);
  }
  // optimalAssignment pins locked players to the LOWEST instance indices of
  // their slot key, so the occupant list has to be ordered the same way for
  // instance i to describe the same physical slot on both sides.
  for (const occupants of occupantsBySlot.values()) {
    occupants.sort((a, b) => (b.locked ? 1 : 0) - (a.locked ? 1 : 0));
  }

  const swaps = [];
  const fills = [];
  const seenSlotIndex = new Map();
  for (const assignment of optimalAssignments) {
    const index = seenSlotIndex.get(assignment.slotKey) || 0;
    seenSlotIndex.set(assignment.slotKey, index + 1);
    if (assignment.playerId == null || assignment.locked) continue;

    const incoming = byId.get(assignment.playerId);
    if (!incoming || isStarter(incoming)) continue; // already starting: a reshuffle, not a swap
    const incomingProjection = projectionOf(assignment.playerId);
    if (incomingProjection.points == null) continue; // never advise on a number we do not have

    const occupant = (occupantsBySlot.get(assignment.slotKey) || [])[index] || null;
    if (!occupant) {
      fills.push({ slot: assignment.slotKey, in: incoming, suggestedProjection: incomingProjection });
      continue;
    }
    if (occupant.locked) continue; // cannot be moved, so cannot be swapped out
    if (optimalByPlayer.has(occupant.playerId)) continue; // he keeps a starting job elsewhere
    const currentProjection = projectionOf(occupant.playerId);
    if (currentProjection.points == null) continue;
    if (incomingProjection.points <= currentProjection.points) continue;
    swaps.push({
      slot: assignment.slotKey,
      out: occupant,
      in: incoming,
      currentProjection,
      suggestedProjection: incomingProjection,
    });
  }
  return { swaps, fills };
}

module.exports = {
  INELIGIBLE,
  expandSlotInstances,
  minCostAssignment,
  optimalAssignment,
  buildSwapSuggestions,
  pointsValue,
};
