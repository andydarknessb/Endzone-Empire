/**
 * Roster shape math. Pure, dependency-free (like leagueSize.js) so both the
 * draft services and the settings service can require it without dragging in
 * the pool or each other.
 */

const intOr0 = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);

/**
 * Pure: a league's **draft roster size**, its starters plus its bench.
 *
 * IR slots are not drafted, so this is the draft's round count, the bound a
 * keeper's round must fit inside, and the bound the keeper count must fit
 * inside. The stored `roster_limit` column keeps its existing IR-inclusive
 * meaning and its existing server-side derivation (starters + bench + IR);
 * this subtracts the IR slots back off.
 *
 * Accepts either a league row (`roster_limit` / `ir_slots`) or already-read
 * camelCase values. `roster_limit` can be null on legacy rows (#70) and
 * `ir_slots` can be null on rows predating the column, so both degrade to 0
 * rather than to NaN.
 */
function draftRosterSize(league) {
  if (!league) return 0;
  const limit = intOr0(league.roster_limit ?? league.rosterLimit);
  return Math.max(0, limit - irSlotCount(league));
}

/**
 * Pure: a league's IR slot count, with the same null/legacy-row tolerance as
 * `draftRosterSize` (rows predating the column degrade to 0, never NaN).
 */
function irSlotCount(league) {
  if (!league) return 0;
  return Math.max(0, intOr0(league.ir_slots ?? league.irSlots));
}

module.exports = { draftRosterSize, irSlotCount };
