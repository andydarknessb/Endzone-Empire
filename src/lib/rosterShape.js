/**
 * Client mirror of server/services/rosterShape.js.
 *
 * A league's **draft roster size** is its starters plus its bench. IR slots
 * are not drafted, so this is the draft's round count and the bound both a
 * keeper's round and the keeper count must fit inside. The stored
 * `roster_limit` keeps its IR-inclusive meaning; this subtracts the IR slots
 * back off.
 */
const toInt = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
};

// Takes a league row as the API returns it. The server mirror also accepts
// camelCase because its settings service holds request-shaped values; no
// client caller does, so this side stays snake_case only.
export function draftRosterSize(league) {
  if (!league) return 0;
  return Math.max(0, toInt(league.roster_limit) - toInt(league.ir_slots));
}

export default draftRosterSize;
