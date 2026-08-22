/**
 * Client-side mirror of server/services/draftValidation.service.js's
 * positionCapsFeasible() — kept in sync by hand (no shared module between
 * client/server in this repo). Used to give the commissioner an immediate,
 * non-blocking warning in the Position Limits panel; the server re-validates
 * on save regardless.
 */
const POSITION_KEYS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

export function positionCapsFeasible({ rosterSlots = [], benchSlots = 0, irSlots = 0, positionCaps = {} }) {
  const caps = {};
  for (const key of POSITION_KEYS) {
    const cap = positionCaps[key];
    caps[key] = Number.isInteger(cap) ? cap : Infinity;
  }

  const demands = rosterSlots
    .filter((s) => Number.isInteger(s.count) && s.count > 0)
    .map((s) => ({ label: s.label || s.key, eligible: new Set(s.eligiblePositions || []), count: s.count }));
  if (benchSlots > 0) demands.push({ label: 'BENCH', eligible: new Set(POSITION_KEYS), count: benchSlots });
  if (irSlots > 0) demands.push({ label: 'IR', eligible: new Set(POSITION_KEYS), count: irSlots });

  const cappedKeys = POSITION_KEYS.filter((k) => Number.isFinite(caps[k]));
  const errorMessages = new Set();
  const n = cappedKeys.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = new Set();
    let capacity = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        subset.add(cappedKeys[i]);
        capacity += caps[cappedKeys[i]];
      }
    }
    let demand = 0;
    const blocking = [];
    for (const d of demands) {
      if (d.eligible.size === 0) continue;
      let confined = true;
      for (const p of d.eligible) {
        if (!subset.has(p)) { confined = false; break; }
      }
      if (confined) {
        demand += d.count;
        blocking.push(d.label);
      }
    }
    if (demand > capacity) {
      const subsetLabel = [...subset].sort().join('/');
      errorMessages.add(
        `${subsetLabel} limit${subset.size > 1 ? 's' : ''} allow only ${capacity} total drafted, ` +
        `but ${blocking.join(', ')} need${blocking.length === 1 ? 's' : ''} ${demand}`
      );
    }
  }

  return { feasible: errorMessages.size === 0, errors: [...errorMessages].slice(0, 10) };
}

export default positionCapsFeasible;
