import { matchPath } from 'react-router-dom';

export const DRAFT_ROOM_RETURN_STATE = Object.freeze({ draftRoomReturn: true });

export function createDraftRoomProfileOrigin({ leagueId, pathname, search }) {
  return {
    kind: 'draft-room',
    leagueId: String(leagueId),
    pathname,
    search,
  };
}

export function readDraftRoomProfileOrigin(state, profileLeagueId) {
  const origin = state?.playerProfileOrigin;
  if (!origin || origin.kind !== 'draft-room') return null;
  if (profileLeagueId == null || String(profileLeagueId) !== String(origin.leagueId)) return null;
  if (typeof origin.pathname !== 'string' || typeof origin.search !== 'string') return null;
  if (origin.search !== '' && (!origin.search.startsWith('?') || origin.search.includes('#'))) return null;

  const match = matchPath({ path: '/league/:leagueId/draft', end: true }, origin.pathname);
  if (!match || String(match.params.leagueId) !== String(origin.leagueId)) return null;

  return origin;
}
