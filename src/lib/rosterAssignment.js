import { expandEligibility } from './draftSim/templates';

/**
 * Which roster slot did each drafted player land in?
 *
 * SYNC OBLIGATION (repo convention): this unweighted starter matching is twinned
 * on the server by server/services/startingNeed.js (the Pick clock's autopick
 * need phase, #746/ADR 0026) and shares the K/DEF-window rule with the Draft
 * Sim's need logic in src/lib/draftSim/cpuBrain.js; keep the three in step.
 *
 * Pure and recomputed from the FULL pick list on every change, so the answer is
 * a function of the picks alone and never of the order they arrived in. That
 * matters: drafting a WR before a TE must not permanently park the WR in FLEX
 * and block the TE out of a starting job.
 *
 * WHY MAXIMUM MATCHING AND NOT A GREEDY SCAN. `roster_slots` is commissioner
 * free-text jsonb (server/routes/league.router.js validates the shape, not the
 * order or the names), so slots can appear in any order with any overlapping
 * eligibility. Two counterexamples, both reachable from the real editor -
 * CommissionerTools' addIdpFlexSlot really does create a slot keyed 'IDP FLEX':
 *
 *   [IDP FLEX(DL/LB/DB), LB]  + picks LB, DL
 *     free-first greedy: LB takes IDP FLEX, DL is stranded  -> 1 starter
 *     exact:             LB -> LB, DL -> IDP FLEX           -> 2 starters
 *
 *   [DL/LB, LB/DB]            + picks LB, DL
 *     most-restrictive-first greedy also fails here, because the eligibility
 *     sets OVERLAP without nesting: LB takes DL/LB, DL is stranded.
 *
 * So the starter assignment is solved exactly, as a maximum bipartite matching
 * between players and slot INSTANCES (a 2-count RB slot is two instances) via
 * Kuhn's algorithm. Sizing is ~20 players against ~20 instances, i.e.
 * microseconds; there is no reason to approximate.
 *
 * Scope note, so nobody mistakes the test coverage for the sim's coverage: the
 * three Draft Simulator templates all order dedicated slots before FLEX and
 * append SFLX last, so free-first greedy is already optimal for them. The
 * augmenting path exists for the real Draft Room's arbitrary data and is
 * UNREACHABLE through DraftSimulator - it is tested directly instead.
 *
 * Related but different: server/services/lineupOptimizer.js solves the
 * points-MAXIMIZING variant of this (which lineup scores most), is CommonJS
 * under server/ and so cannot be imported by client code anyway. Draft slotting
 * has no points objective, so this is the unweighted problem, not that one.
 */

/** Pure: rosterSlots -> one entry per startable slot INSTANCE, in display order. */
export function expandSlotInstances(rosterSlots = []) {
  const instances = [];
  (rosterSlots || []).forEach((slot, slotIndex) => {
    if (!slot || slot.key == null) return;
    const raw = Number(slot.count);
    const count = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    const baseLabel = slot.label || String(slot.key);
    // Eligibility is captured per ARRAY INDEX and never looked up by key.
    // Nothing validates key uniqueness in a league's roster_slots, and
    // templates.js slotEligible() resolves by key with a .find(), so two slots
    // sharing a key would silently collapse into one.
    const eligiblePositions = Array.isArray(slot.eligiblePositions) ? slot.eligiblePositions : [];
    const eligible = expandEligibility(eligiblePositions);
    for (let i = 0; i < count; i++) {
      instances.push({
        id: `${slotIndex}:${slot.key}#${i}`,
        slotIndex,
        slotKey: slot.key,
        baseLabel,
        slotLabel: count > 1 ? `${baseLabel} ${i + 1}` : baseLabel,
        instanceIndex: i,
        eligiblePositions,
        eligible,
      });
    }
  });
  return instances;
}

/**
 * Kuhn's maximum bipartite matching, players processed in pick order.
 * Returns matchInstance[instanceIndex] = playerIndex, or -1.
 */
function matchStarters(players, instances) {
  const matchInstance = new Array(instances.length).fill(-1);
  const eligibleFor = players.map((player) => {
    const out = [];
    if (player && player.position) {
      instances.forEach((instance, j) => {
        if (instance.eligible.has(player.position)) out.push(j);
      });
    }
    return out;
  });

  const tryAssign = (p, visited) => {
    // Phase 1: claim a FREE instance in canonical order, displacing nobody.
    // This is what makes RB, RB, RB fill RB 1, RB 2, FLEX in that order.
    for (const j of eligibleFor[p]) {
      if (!visited[j] && matchInstance[j] === -1) {
        visited[j] = 1;
        matchInstance[j] = p;
        return true;
      }
    }
    // Phase 2: no free instance, so look for an augmenting path - re-home an
    // incumbent who has somewhere else to go. Every unvisited eligible slot is
    // necessarily occupied by now, which is why matchInstance[j] is safe here.
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

  // Splitting the DFS into "free first, then augmenting" only reorders branch
  // exploration within each player's search, so Kuhn's maximum-cardinality
  // guarantee is untouched. (Asserted against a brute-force oracle in the tests.)
  for (let p = 0; p < players.length; p++) {
    tryAssign(p, new Uint8Array(instances.length));
  }
  return matchInstance;
}

const toInt = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * @param {object} args
 * @param {Array}  args.picks        normalized picks in any order; sorted internally
 *                                   by pickNumber. Never mutated.
 * @param {Array}  args.rosterSlots  [{ key, label, count, eligiblePositions }]
 * @param {number} args.benchCount
 * @param {number} args.irCount
 * @param {boolean} args.irDraftable Whether the tail of a full draft fills the IR
 *                                   spots. False for every real league draft since
 *                                   #96 (the IR slot costs no round); true only for
 *                                   callers modelling a draft that fills it.
 */
export function assignRosterSlots({
  picks = [],
  rosterSlots = [],
  benchCount = 0,
  irCount = 0,
  irDraftable = true,
} = {}) {
  const players = (Array.isArray(picks) ? picks : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (Number(a.pickNumber) || 0) - (Number(b.pickNumber) || 0));

  const instances = expandSlotInstances(rosterSlots);
  const matchInstance = matchStarters(players, instances);
  const matched = new Set(matchInstance.filter((p) => p >= 0));

  const benchInstances = toInt(benchCount);
  const irInstances = toInt(irCount);

  const rows = [];
  const byPickNumber = new Map();
  const addRow = (row) => {
    rows.push(row);
    if (row.player) {
      byPickNumber.set(row.player.pickNumber, {
        rowId: row.id,
        section: row.section,
        slotKey: row.slotKey,
        slotLabel: row.slotLabel,
      });
    }
  };

  instances.forEach((instance, j) => {
    const p = matchInstance[j];
    addRow({
      id: instance.id,
      section: 'starter',
      slotKey: instance.slotKey,
      slotLabel: instance.slotLabel,
      instanceIndex: instance.instanceIndex,
      // The RAW eligibility list, for the "RB/WR/TE" helper text. The expanded
      // set (12 codes for a DP slot) is a matching detail, not something to show.
      eligiblePositions: instance.eligiblePositions,
      multi: instance.eligiblePositions.length > 1,
      draftable: true,
      player: p >= 0 ? players[p] : null,
    });
  });

  const leftovers = players.filter((_player, p) => !matched.has(p));
  let cursor = 0;
  const nextLeftover = (canFill) => (canFill && cursor < leftovers.length ? leftovers[cursor++] : null);

  for (let i = 0; i < benchInstances; i++) {
    addRow({
      id: `bench#${i}`,
      section: 'bench',
      slotKey: 'BENCH',
      slotLabel: `BN ${i + 1}`,
      instanceIndex: i,
      eligiblePositions: [],
      multi: false,
      draftable: true,
      player: nextLeftover(true),
    });
  }

  for (let i = 0; i < irInstances; i++) {
    addRow({
      id: `ir#${i}`,
      section: 'ir',
      slotKey: 'IR',
      slotLabel: `IR ${i + 1}`,
      instanceIndex: i,
      eligiblePositions: [],
      multi: false,
      draftable: irDraftable,
      player: nextLeftover(irDraftable),
    });
  }

  // Past capacity. Never silently dropped: a pick with nowhere to go is a fact
  // the drafter needs, not a rendering detail.
  let overflowIndex = 0;
  while (cursor < leftovers.length) {
    addRow({
      id: `overflow#${overflowIndex}`,
      section: 'overflow',
      slotKey: null,
      slotLabel: 'No slot',
      instanceIndex: overflowIndex,
      eligiblePositions: [],
      multi: false,
      draftable: false,
      player: leftovers[cursor++],
    });
    overflowIndex += 1;
  }

  const starterRows = rows.filter((row) => row.section === 'starter');
  const startersFilled = starterRows.filter((row) => row.player).length;
  const benchFilled = rows.filter((row) => row.section === 'bench' && row.player).length;
  const irFilled = rows.filter((row) => row.section === 'ir' && row.player).length;

  // Grouped by slot INDEX, not key, so two same-keyed slots stay distinct.
  const unfilledStarters = [];
  const groupAt = new Map();
  starterRows.forEach((row, j) => {
    if (row.player) return;
    const { slotIndex, baseLabel } = instances[j];
    if (!groupAt.has(slotIndex)) {
      groupAt.set(slotIndex, unfilledStarters.length);
      unfilledStarters.push({
        slotKey: row.slotKey,
        slotLabel: baseLabel,
        eligiblePositions: row.eligiblePositions,
        count: 0,
      });
    }
    unfilledStarters[groupAt.get(slotIndex)].count += 1;
  });

  const configuredSlotCount = instances.length + benchInstances + irInstances;
  return {
    rows,
    byPickNumber,
    summary: {
      starterInstances: instances.length,
      startersFilled,
      startersOpen: instances.length - startersFilled,
      unfilledStarters,
      benchInstances,
      benchFilled,
      benchOpen: benchInstances - benchFilled,
      irInstances,
      irFilled,
      // How many of those configured spots a draft can fill. An undraftable
      // IR slot is not a round (#96), so it is excluded here.
      draftable: instances.length + benchInstances + (irDraftable ? irInstances : 0),
      configuredSlotCount,
      assignedCount: players.length,
      overflowCount: overflowIndex,
      rosterFull: configuredSlotCount > 0 && players.length >= configuredSlotCount,
    },
  };
}
