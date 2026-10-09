import apiClient from '../api/apiClient';
import { invalidate, read, setResource } from '../lib/resourceCache';
import { useResource } from './useResource';

// The nav bell and the Home activity card read the same list, so the shared
// store serves both from one request (ADR 0004, ADR 0059's #2097 amendment).
const KEY = ['notifications'];
const URL = '/api/notifications';

/**
 * Reloads every mounted reader of the shared notifications cache, keeping the
 * list they already show on screen until the new one lands.
 */
export function clearNotificationsCache() {
  invalidate(KEY);
}

/**
 * PUT /api/notifications/read, then write the result through to every mount
 * with no GET. The merge base is the store's current entry, read after the PUT
 * returns, not the list a component rendered with: a poll that landed while the
 * PUT was in flight is kept and marked read instead of being overwritten by the
 * older list. Rejects when the PUT fails, leaving the cache untouched.
 */
export async function markAllNotificationsRead() {
  await apiClient.put(`${URL}/read`);
  const current = read(KEY)?.data;
  // No entry (a reload dropped it): nothing to merge into, and the reload on
  // the wire carries the read state itself.
  if (!current) return;
  setResource(KEY, {
    ...current,
    unread: 0,
    notifications: (current.notifications || []).map((n) => ({ ...n, read: true })),
  });
}

/**
 * Shared GET /api/notifications, with the list and unread count defaulted.
 * `loaded` is true once any response is held, so a card can tell "no list yet"
 * from "an empty list" (the defaulted `[]` cannot) and keep a good list on
 * screen through a poll.
 */
export function useNotifications() {
  const { data, loading, error, refetch } = useResource(KEY, URL);
  return {
    notifications: data?.notifications || [],
    unread: data?.unread || 0,
    loaded: Boolean(data),
    loading,
    error,
    refetch,
  };
}
