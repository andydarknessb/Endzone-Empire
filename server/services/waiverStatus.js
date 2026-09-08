/**
 * The "is this player on waivers?" read, in its own leaf module (the pattern
 * draftError.js and modules/io.js use for the same reason) so both
 * waiver.service.js and rosterGate.service.js can require it without requiring
 * each other.
 *
 * #944 points processWaivers (waiver.service) at the roster gate
 * (rosterGate.service) for the freeze, and the gate's acquire bundle already
 * calls this function - so leaving it in waiver.service would make the two
 * modules require each other circularly, and since waiver.service assigns its
 * module.exports as one object at the end of the file, the circular importer
 * would receive the pre-export empty object (isOnWaivers undefined). Collapsing
 * the shared read into one leaf both sides require is the fix (#943 precedent:
 * a circular require is collapsed to one leaf, never duplicated).
 */

/**
 * Is this player currently on waivers in the league (not yet a free agent)?
 * True when he has an unexpired waiver_players row, or the league's post-draft
 * blanket window is still open and he is unrostered.
 */
async function isOnWaivers(client, { league, playerId }) {
  const row = await client.query(
    `SELECT 1 FROM "waiver_players"
     WHERE "league_id" = $1 AND "player_id" = $2 AND "available_at" > now()`,
    [league.id, playerId]
  );
  if (row.rows[0]) return true;
  if (!league.waivers_clear_at || new Date(league.waivers_clear_at) <= new Date()) return false;
  const rostered = await client.query(
    `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
    [league.id, playerId]
  );
  return !rostered.rows[0];
}

module.exports = { isOnWaivers };
