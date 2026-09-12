/**
 * Groups the Roster entity's normalized lineup entries (`entities/roster`'s
 * `lineupEntries`) into the three Ledger sections (CONTEXT.md's Ledger row:
 * "the single row presentation every occupied Lineup row uses, whether
 * Starter, Bench, or IR"), each a row spec `{ key, slotLabel, slotType,
 * entry }` with `entry: null` for an empty slot - mirroring the legacy
 * LineupScreen's own starter/IR/bench row-building (#1237, replacing it).
 *
 * Starters: one row per configured starting slot INSTANCE (`rosterSlots`'
 * own order and per-slot `count`), filled from the occupied entries at that
 * slot in the order the server returned them, empty rows after. IR: one row
 * per `irSlots`, same fill rule. Bench: AC5, "Bench sorts by projection with
 * Unavailable players last" - a NEW ordering rule the legacy page did not
 * apply (it kept the server's own order). Available bench players sort by
 * projection descending (a null projection sorts as if it were the lowest,
 * never crashing the comparator); every Unavailable bench player (on bye,
 * out, or on IR) follows, in the order the server returned them. Padded up
 * to `benchSlots` (or the occupied count, whichever is larger: a roster can
 * overflow its bench, and an overflowing player without a row is one a
 * manager can neither see nor drop).
 *
 * Deliberately NOT reproduced from the legacy page (each a narrow,
 * best-ball-only edge case; left as a follow-up rather than blocking this
 * ticket): the zero-bench-slots IR-recovery placeholder row, and best
 * ball's extra bench row for the "resolve an ineligible IR stash" case.
 *
 * `testId` restores the legacy page's own `slot-row-<SLOT>-<index>` /
 * `slot-row-<SLOT>-<entryId>` contract byte-for-byte (LineupScreen.jsx):
 * `tests/e2e/auth-offline.spec.ts` asserts on it directly
 * (`slot-row-BENCH-501`, `slot-row-WR-0`) as the browser-level proof of the
 * offline queue, and that spec is out of this ticket's scope to edit.
 */
export function buildLedgerSections({ entries, rosterSlots, benchSlots, irSlots }) {
  const list = Array.isArray(entries) ? entries : [];
  const bySlot = new Map();
  for (const entry of list) {
    const key = entry.slot;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(entry);
  }

  const slots = Array.isArray(rosterSlots) ? rosterSlots : [];
  const starters = slots.flatMap((slot) => {
    const type = slot && slot.key;
    if (type == null || type === 'BENCH' || type === 'IR') return [];
    const count = Number(slot.count) || 0;
    const filled = bySlot.get(type) || [];
    return Array.from({ length: count }, (_, i) => ({
      key: `${type}-${i}`,
      testId: `slot-row-${type}-${i}`,
      slotLabel: count > 1 ? `${type} ${i + 1}` : type,
      slotType: type,
      entry: filled[i] || null,
    }));
  });

  const irCount = Number(irSlots) || 0;
  const irEntries = bySlot.get('IR') || [];
  const ir = Array.from({ length: irCount }, (_, i) => ({
    key: `IR-${i}`,
    testId: `slot-row-IR-${i}`,
    slotLabel: 'IR',
    slotType: 'IR',
    entry: irEntries[i] || null,
  }));

  const benchEntries = bySlot.get('BENCH') || [];
  const sortedBench = sortBenchEntries(benchEntries);
  const benchRowCount = Math.max(Number(benchSlots) || 0, sortedBench.length);
  const bench = Array.from({ length: benchRowCount }, (_, i) => {
    const entry = sortedBench[i] || null;
    return {
      key: entry ? `BENCH-${entry.playerId}` : `BENCH-empty-${i}`,
      testId: entry ? `slot-row-BENCH-${entry.playerId}` : `slot-row-BENCH-empty-${i}`,
      slotLabel: 'BENCH',
      slotType: 'BENCH',
      entry,
    };
  });

  return { starters, ir, bench };
}

function isUnavailable(entry) {
  return Boolean(entry.availability && entry.availability.available === false);
}

// Stable partition: every available entry (sorted by projection, high to
// low, an unknown projection sorting last among them) before every
// Unavailable one (kept in the order the server returned them).
function sortBenchEntries(benchEntries) {
  const available = [];
  const unavailable = [];
  for (const entry of benchEntries) {
    (isUnavailable(entry) ? unavailable : available).push(entry);
  }
  available.sort((a, b) => {
    const ap = Number.isFinite(a.projection) ? a.projection : -Infinity;
    const bp = Number.isFinite(b.projection) ? b.projection : -Infinity;
    return bp - ap;
  });
  return [...available, ...unavailable];
}

export default buildLedgerSections;
