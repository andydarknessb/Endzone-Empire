import { DEFAULT_ROSTER_SLOTS, expandEligibility, templateFor } from '../../lib/draftSim/templates';

/**
 * The chip vocabulary a roster-scoped position menu offers, in the order the
 * manager sees them (#1419): "All" first, then this canonical order with any
 * key absent from the selected league's roster template dropped. There is no
 * position-group table here - expandEligibility (src/lib/draftSim/templates.js)
 * is the only one, reused rather than re-declared, the same table the Draft
 * Sim mirrors from the server's lineup.service.js. The only new list is this
 * order itself (formal review f4): whether a chip is flex-type is read from
 * the slot, not a second hand-kept list.
 *
 * Promoted out of PlayerManagement.jsx (#1420, "no third copy"): the Draft
 * room's own player pool table reuses this derivation instead of carrying a
 * hardcoded menu of its own.
 */
export const CANONICAL_CHIP_ORDER = [
  'QB',
  'RB',
  'WR',
  'TE',
  'FLEX',
  'SFLX',
  'K',
  'DEF',
  'DL',
  'LB',
  'DB',
];

// No league selected, or a template with no slots at all, falls back to the
// FULL canonical set - every chip a league could ever offer, FLEX meaning
// RB/WR/TE (#1419, #1416 story 16, the Rosterable position glossary entry,
// ADR 0045: such a request has no server-side gate, so the caller must offer
// every chip that could narrow it). Built from templates.js's own slot
// definitions (formal review f2) - DEFAULT_ROSTER_SLOTS plus the SFLX slot
// the 'superflex' LEAGUE_TEMPLATES entry carries and the DL/LB/DB slots the
// 'idp' entry carries - never a re-declared eligibility list.
export const FULL_CANONICAL_SLOTS = [
  ...DEFAULT_ROSTER_SLOTS,
  ...templateFor('superflex').slots.filter((slot) => slot.key === 'SFLX'),
  ...templateFor('idp').slots.filter((slot) => ['DL', 'LB', 'DB'].includes(slot.key)),
];

// A chip is flex-type when its slot's expanded eligibility is anything other
// than exactly its own key (formal review f4): FLEX and SFLX expand to a
// literal position list that never contains their own key, and LB, DL and DB
// are themselves POSITION_GROUPS keys, so expanding a single-entry
// `['LB']`/`['DL']`/`['DB']` still yields the whole group. QB, K and DEF
// expand to nothing but themselves and stay plain position chips.
export function isFlexSlot(slot) {
  const expanded = expandEligibility(slot.eligiblePositions);
  return expanded.size !== 1 || !expanded.has(slot.key);
}

/**
 * One chip per distinct starting slot key the template carries: canonical
 * chips first (CANONICAL_CHIP_ORDER order, absent keys dropped), then every
 * other slot key - a commissioner-defined key such as 'D LINE' or 'IDP FLEX'
 * (src/entities/roster/model/lineupModel.js:172, #1462) - in the template's
 * own order, one chip per distinct key. A custom key is never a plain
 * position code, so its chip always carries `positions` =
 * expandEligibility(slot.eligiblePositions) rather than being treated as
 * potentially non-flex. An empty (or absent) `rosterSlots` falls back to
 * FULL_CANONICAL_SLOTS, which carries no custom keys.
 */
export function chipsForRosterSlots(rosterSlots) {
  const slots = rosterSlots && rosterSlots.length > 0 ? rosterSlots : FULL_CANONICAL_SLOTS;
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const chips = [{ key: 'All' }];
  CANONICAL_CHIP_ORDER.forEach((key) => {
    const slot = slotByKey.get(key);
    if (!slot) return;
    chips.push(
      isFlexSlot(slot)
        ? { key, positions: Array.from(expandEligibility(slot.eligiblePositions)) }
        : { key },
    );
  });
  const seenCustomKeys = new Set();
  slots.forEach((slot) => {
    if (CANONICAL_CHIP_ORDER.includes(slot.key)) return;
    if (seenCustomKeys.has(slot.key)) return;
    seenCustomKeys.add(slot.key);
    chips.push({ key: slot.key, positions: Array.from(expandEligibility(slot.eligiblePositions)) });
  });
  return chips;
}
