/**
 * Client mirror of server/services/rosterShape.js.
 *
 * A league's **draft roster size** is its starters plus its bench. IR slots
 * are not drafted (CONTEXT.md, "Draft roster size"), so this is the draft's
 * round count and the bound a keeper's round and the keeper count must fit
 * inside. The stored `roster_limit` keeps its IR-inclusive meaning; this
 * subtracts the IR slots back off.
 */
const toInt = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
};

export function draftRosterSize(league) {
  if (!league) return 0;
  const limit = toInt(league.roster_limit ?? league.rosterLimit);
  const ir = toInt(league.ir_slots ?? league.irSlots);
  return Math.max(0, limit - ir);
}

export default draftRosterSize;
