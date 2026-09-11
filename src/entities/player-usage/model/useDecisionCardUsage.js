import { useEndpoint } from '../../../shared/lib';
import { usageFromResponse } from './usageModel';

/**
 * A player's Usage for one league/week, as a read model (ADR 0029: the thin
 * hook on the entity's index), over `shared/lib`'s `useEndpoint` the same way
 * every other plain League Dashboard read is (#669). The Decision card
 * fetches this on open (ADR 0037) — it is never joined into the Lineup page
 * payload.
 *
 * A null `leagueId` or `playerId` binds no URL (`useEndpoint`'s idle shape):
 * `status` stays 'loading' and `usage` is null, so a card mounted before its
 * player resolves never renders another player's usage. `week` is omitted
 * from the query string when not given, matching
 * `GET /api/team/lineup/:playerId/context`'s own default (the league's
 * current week).
 *
 * This entity calls the SAME endpoint `entities/line` does (both read off
 * one server response); FSD forbids an entity importing another, so each
 * owns its own plain read rather than one relaying the other's data (#669's
 * own pattern — every Dashboard widget that owns a plain read is its own
 * `useEndpoint` call).
 *
 * @param {{ leagueId?: number|string|null, playerId?: number|string|null, week?: number|string|null }} [params]
 * @returns {{ status: 'loading'|'ready'|'error', usage: object|null }}
 */
export function useDecisionCardUsage({ leagueId, playerId, week } = {}) {
  const ready = leagueId != null && playerId != null;
  const url = ready
    ? `/api/team/lineup/${playerId}/context?leagueId=${leagueId}${week != null ? `&week=${week}` : ''}`
    : null;
  const { status, data } = useEndpoint(url);
  return { status, usage: usageFromResponse(data) };
}

export default useDecisionCardUsage;
