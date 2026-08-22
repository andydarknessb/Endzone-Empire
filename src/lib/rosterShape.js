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

/**
 * Client mirror of the server's draftRounds() (ADR 0005: fix Draft rounds at
 * draft start). A pending draft keeps deriving Draft roster size live; an
 * active or completed draft reads the fixed `draft_rounds` value instead, so
 * Board rendering, presenter views and client progress never renumber a
 * draft already in progress or finished off a later roster-shape edit.
 * Falls back to the live derivation when `draft_rounds` is unexpectedly null
 * on an active/completed row (a legacy row the one-time backfill migration
 * has not reached).
 */
export function draftRounds(league) {
  if (!league) return 0;
  if (league.draft_status !== 'pending' && league.draft_rounds != null) {
    return toInt(league.draft_rounds);
  }
  return draftRosterSize(league);
}

export default draftRosterSize;
