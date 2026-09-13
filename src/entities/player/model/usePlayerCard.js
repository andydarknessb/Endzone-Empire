import { useEndpoint } from '../../../shared/lib';
import { playerCardFromResponse } from './playerCardModel';

/**
 * The Decision-card payload for one player in one league/week, as a read
 * model (ADR 0029: the thin hook on the entity's index), over `shared/lib`'s
 * `useEndpoint` the same way `entities/line` and `entities/player-usage`
 * already read the Decision card's other context (#669). Every Availability
 * context reads through this one hook - `player`, `availability`,
 * `decision` (projWeek, ros, upgrade, usage), `weeks[1..18]`, `news[]`,
 * `log`, `bio` (ADR 0040: "one payload for the Decision card in every
 * availability context", #1306/#1331).
 *
 * A null `leagueId` or `playerId` binds no URL (`useEndpoint`'s idle shape):
 * `status` stays 'loading' and `card` is null, so a card mounted before its
 * player resolves never renders another player's data. `week` is omitted
 * from the query string when not given, matching the route's own default
 * (the league's current week).
 *
 * @param {{ leagueId?: number|string|null, playerId?: number|string|null, week?: number|string|null }} [params]
 * @returns {{ status: 'loading'|'ready'|'error', card: object|null }}
 */
export function usePlayerCard({ leagueId, playerId, week } = {}) {
  const ready = leagueId != null && playerId != null;
  const url = ready
    ? `/api/players/${playerId}/card?leagueId=${leagueId}${week != null ? `&week=${week}` : ''}`
    : null;
  const { status, data } = useEndpoint(url);
  return { status, card: playerCardFromResponse(data) };
}

export default usePlayerCard;
