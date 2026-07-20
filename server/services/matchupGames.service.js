/**
 * De-dupes the tank01_game_id values `view_matchup_nfl_games` returns for one
 * fantasy matchup. The view has one row per (rostered player, real game)
 * pair, so a game shows up once per player rostered from that NFL team —
 * two Chiefs on the same fantasy roster means two rows for the same game.
 * Sorted for a stable response (matters for snapshot/UI tests downstream).
 */
function dedupeGameIds(rows) {
  return [...new Set((rows || []).map((r) => r.tank01_game_id))].sort();
}

module.exports = { dedupeGameIds };
