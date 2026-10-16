import { useResource } from '../../../hooks/useResource';

const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The signed-in user's action items across every league, `GET
 * /api/user/action-items?tz=` (the server needs the viewer's IANA zone to
 * decide what is "due today"). Reads through the shared cached GET and
 * returns `{ items, loading, error, reload }`; `reload` refetches.
 */
export function useActionItems() {
  const tz = viewerTimeZone();
  const { data, loading, error, refetch } = useResource(
    ['action-items', tz],
    `/api/user/action-items?tz=${encodeURIComponent(tz)}`
  );
  return { items: Array.isArray(data?.items) ? data.items : [], loading, error, reload: refetch };
}
