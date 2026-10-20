import { useResource } from '../../../hooks/useResource';

// One shared empty list, so a consumer can key an effect on `items` without it changing every render.
const NONE = [];

const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The signed-in user's action items across every league, `GET
 * /api/user/action-items?tz=` (the server needs the viewer's IANA zone to
 * decide what is "due today"). Reads through the shared cached GET and
 * returns `{ items, partial, loading, error, reload }`; `partial` lists item types the
 * server could not check; `reload` refetches.
 */
export function useActionItems() {
  const tz = viewerTimeZone();
  const { data, loading, error, refetch } = useResource(
    ['action-items', tz],
    `/api/user/action-items?tz=${encodeURIComponent(tz)}`
  );
  return {
    items: Array.isArray(data?.items) ? data.items : NONE,
    partial: Array.isArray(data?.partial) ? data.partial : NONE,
    loading, error,
    reload: refetch,
  };
}
