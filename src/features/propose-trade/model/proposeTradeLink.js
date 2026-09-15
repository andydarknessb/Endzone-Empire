/**
 * propose-trade feature (#1310, ADR 0040): the Players list row's Trade
 * action for a `rostered` player is a deep link into TradeCenter, not a
 * dialog of its own - `receivingTeamId` names the owning team and `playerId`
 * the row's own player, and TradeCenter (`TradeCenter.jsx`) reads both off
 * the URL to preselect the team and check the player in "You receive" once
 * its own rosters have loaded (a trade always has two sides, so it stays a
 * page, not something a compact row can hold).
 *
 * Pure by design: no fetch, no state, nothing to mock in a caller's test.
 */
export function proposeTradeHref({ leagueId, receivingTeamId, playerId }) {
  const params = new URLSearchParams({
    receivingTeamId: String(receivingTeamId),
    playerId: String(playerId),
  });
  return `/league/${leagueId}/trades?${params.toString()}`;
}

export default proposeTradeHref;
