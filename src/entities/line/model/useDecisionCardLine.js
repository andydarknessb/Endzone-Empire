import { useEndpoint } from '../../../shared/lib';
import { lineContextFromResponse } from './lineModel';

/**
 * A player's Line and Weather for one league/week, as a read model (ADR
 * 0029: the thin hook on the entity's index), over `shared/lib`'s
 * `useEndpoint` the same way every other plain League Dashboard read is
 * (#669). The Decision card fetches this on open (ADR 0037) — it is never
 * joined into the Lineup page payload.
 *
 * A null `leagueId` or `playerId` binds no URL (`useEndpoint`'s idle shape):
 * `status` stays 'loading' and both fields are null, so a card mounted
 * before its player resolves never renders another player's game context.
 * `week` is omitted from the query string when not given, matching
 * `GET /api/team/lineup/:playerId/context`'s own default (the league's
 * current week).
 *
 * @param {{ leagueId?: number|string|null, playerId?: number|string|null, week?: number|string|null }} [params]
 * @returns {{ status: 'loading'|'ready'|'error', line: object|null, weather: object|null }}
 */
export function useDecisionCardLine({ leagueId, playerId, week } = {}) {
  const ready = leagueId != null && playerId != null;
  const url = ready
    ? `/api/team/lineup/${playerId}/context?leagueId=${leagueId}${week != null ? `&week=${week}` : ''}`
    : null;
  const { status, data } = useEndpoint(url);
  const { line, weather } = lineContextFromResponse(data);
  return { status, line, weather };
}

export default useDecisionCardLine;
