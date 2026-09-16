/**
 * The Roster template read model (ADR 0029: the entities layer, following the
 * Matchup and Standings slices' shape; #1500). CONTEXT.md's Roster template:
 * "A league's ordered list of Slots, each with the positions it accepts and
 * how many of it a lineup holds. One rule answers both 'may this position sit
 * in this Slot' and 'which Slots fit this player'; BENCH and IR accept
 * anyone." This module is that one rule.
 *
 * `parseRosterTemplate` is the entity's own name for `shared/lib`'s
 * `parseRosterSlots` (ADR 0029: an entity imports `shared` only) - a league's
 * `roster_slots` column as an array, tolerating the shapes it can arrive in
 * and applying no fallback of its own (an absent/malformed config parses to
 * `[]`, same as `parseRosterSlots`).
 *
 * `accepts(template, slotKey, position)` answers the pure, position-only
 * question: BENCH and IR accept any position unconditionally - this is the
 * position-eligibility question alone, not a player's IR-eligibility (a fact
 * about an injury designation, not a position; `slotsFor` below layers that
 * on top). A named starting slot accepts a position when the slot's own
 * `eligiblePositions` (a defensive GROUP key - DL, LB, DB - expanded to its
 * member codes, same table `entities/roster`'s `lineupModel.js` and
 * `src/lib/draftSim/templates.js` mirror from `lineup.service.js`) includes
 * it. A slot the template does not carry never accepts anything - there is no
 * default shape guessed at here (ADR 0029's sibling concern, the same refusal
 * `pairStartersBySlot` and `lineupEntries` make for a missing slot order).
 *
 * `slotsFor(template, entry)` is every slot key `entry` may occupy right now:
 * BENCH always, IR only when `entry.injuryStatus` is an IR-eligible
 * designation (`IR_ELIGIBLE_DESIGNATIONS`, mirroring
 * `irPolicy.service.js`/`lineupModel.js`), and each of the template's own
 * named slots `accepts` for `entry.position` - in the template's own order.
 *
 * `rosterablePositions(template)` is CONTEXT.md's Rosterable position: every
 * position at least one STARTING slot in the template accepts, group keys
 * expanded. BENCH, IR and any slot outside the template carry nothing here -
 * a league is IDP exactly when DL, LB or DB comes back rosterable, with no
 * separate flag.
 */

// Imported from the concrete module, not the `shared/lib` barrel: the barrel
// (`shared/lib/index.js`) also exports `chipsForRosterSlots`
// (`positionChips.js`), which imports `src/lib/draftSim/templates.js` -
// which imports `DEFAULT_ROSTER_SLOTS` from THIS file (#1500). Importing the
// barrel here would close that cycle (this file -> shared barrel ->
// positionChips -> templates.js -> this file, mid-evaluation) and read as
// `undefined` at the far end. `parseRosterSlots` itself is a leaf with no
// imports of its own, so this narrows the edge without losing anything.
import { parseRosterSlots } from '../../../shared/lib/rosterSlots';

const BENCH = 'BENCH';
const IR = 'IR';

// Mirrors POSITION_GROUPS in server/services/lineup.service.js,
// entities/roster/model/lineupModel.js and src/lib/draftSim/templates.js: a
// slot's configured eligiblePositions may name a defensive GROUP key rather
// than a specific position, and it expands to every specific position Tank01
// reports in that group.
const POSITION_GROUPS = {
  DL: ['DL', 'DE', 'DT', 'NT'],
  LB: ['LB', 'ILB', 'OLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
};

// injury_status codes that qualify a player for the IR slot (mirrors
// irPolicy.service.js's IR_ELIGIBLE_DESIGNATIONS and
// entities/roster/model/lineupModel.js's own copy, CONTEXT.md's IR-eligible).
const IR_ELIGIBLE_DESIGNATIONS = new Set(['O', 'IR']);

/**
 * The standard default roster-slot shape (#1500: moved here from
 * `src/lib/draftSim/templates.js`, which now imports it from this entity
 * through the index rather than declaring its own copy). Mirrors the
 * server's own `server/services/rosterSlots.js` DEFAULT_ROSTER_SLOTS, pinned
 * equal to it by `src/lib/draftSim/templates.parity.test.js`.
 */
export const DEFAULT_ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

/**
 * A league's `roster_slots` as an array (the entity's own name for
 * `shared/lib`'s `parseRosterSlots`): tolerates the shapes the column can
 * arrive in, applies no fallback, never throws.
 */
export function parseRosterTemplate(raw) {
  return parseRosterSlots(raw);
}

function expandEligibility(eligiblePositions) {
  const out = new Set();
  for (const p of eligiblePositions || []) {
    (POSITION_GROUPS[p] || [p]).forEach((m) => out.add(m));
  }
  return out;
}

/**
 * Pure, position-only: may a player at `position` sit in the slot named
 * `slotKey`? BENCH and IR accept any position unconditionally - this is not
 * the same question as "is this specific player IR-eligible", which depends
 * on an injury designation `accepts` never reads (see `slotsFor`). A
 * `slotKey` the template does not carry never accepts anything.
 */
export function accepts(template, slotKey, position) {
  if (slotKey === BENCH || slotKey === IR) return true;
  const slots = Array.isArray(template) ? template : [];
  const slot = slots.find((s) => s && s.key === slotKey);
  if (!slot) return false;
  return expandEligibility(slot.eligiblePositions).has(position);
}

/**
 * Every slot key `entry` may occupy right now: BENCH always, IR only when
 * `entry.injuryStatus` is an IR-eligible designation, and each of the
 * template's own named slots `accepts` for `entry.position` - in the
 * template's own order.
 */
export function slotsFor(template, entry) {
  const e = entry || {};
  const position = e.position ?? null;
  const injuryDesignation = e.injuryStatus ?? null;
  const slots = Array.isArray(template) ? template : [];
  const out = [BENCH];
  if (IR_ELIGIBLE_DESIGNATIONS.has(injuryDesignation)) out.push(IR);
  for (const slot of slots) {
    const key = slot && slot.key;
    if (key == null || key === BENCH || key === IR) continue;
    if (accepts(template, key, position)) out.push(key);
  }
  return out;
}

/**
 * CONTEXT.md's Rosterable position: every position at least one STARTING
 * slot in the template accepts, group keys expanded. BENCH, IR and taxi
 * slots do not count, and an empty/absent template returns an empty set -
 * this entity applies no fallback of its own (a caller that wants "every
 * canonical position" for an absent league or empty template supplies that
 * fallback itself, the same split `parseRosterSlots` draws).
 */
export function rosterablePositions(template) {
  const slots = Array.isArray(template) ? template : [];
  const out = new Set();
  for (const slot of slots) {
    const key = slot && slot.key;
    if (key == null || key === BENCH || key === IR) continue;
    expandEligibility(slot.eligiblePositions).forEach((p) => out.add(p));
  }
  return out;
}

const rosterTemplateModel = { parseRosterTemplate, accepts, slotsFor, rosterablePositions, DEFAULT_ROSTER_SLOTS };

export default rosterTemplateModel;
