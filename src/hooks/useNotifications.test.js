import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { invalidate, read, setResource } from '../lib/resourceCache';
import { clearNotificationsCache, markAllNotificationsRead, useNotifications } from './useNotifications';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

// Thin on purpose: the caching machinery is pinned in resourceCache.test.js and
// useResource.test.js. What is notification-specific is the key, the url, the
// returned shape and the mark-all-read write-through.
const note = (id, overrides = {}) => ({ id, message: `Note ${id}`, read: false, ...overrides });

beforeEach(() => {
  invalidate(undefined, { reload: false });
  apiClient.get.mockReset();
  apiClient.put.mockReset();
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.clearAllMocks();
});

test('requests /api/notifications and returns the list and the unread count', async () => {
  apiClient.get.mockResolvedValue({ data: { notifications: [note(1)], unread: 1 } });
  const { result } = renderHook(() => useNotifications());

  expect(result.current.loading).toBe(true);
  expect(result.current.notifications).toEqual([]);
  expect(result.current.unread).toBe(0);
  expect(result.current.loaded).toBe(false);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.loaded).toBe(true);
  expect(apiClient.get).toHaveBeenCalledWith('/api/notifications');
  expect(result.current.notifications).toEqual([note(1)]);
  expect(result.current.unread).toBe(1);
  expect(result.current.error).toBeNull();
});

test('clearNotificationsCache reloads what is mounted', async () => {
  apiClient.get.mockResolvedValue({ data: { notifications: [note(1)], unread: 1 } });
  const { result } = renderHook(() => useNotifications());
  await waitFor(() => expect(result.current.loading).toBe(false));
  apiClient.get.mockClear();

  apiClient.get.mockResolvedValue({ data: { notifications: [note(1), note(2)], unread: 2 } });
  await act(async () => { clearNotificationsCache(); });

  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(result.current.notifications).toHaveLength(2);
});

test('markAllNotificationsRead PUTs, then marks every cached item read for every mount, with no GET', async () => {
  apiClient.get.mockResolvedValue({ data: { notifications: [note(1)], unread: 1 } });
  apiClient.put.mockResolvedValue({});
  const { result: a } = renderHook(() => useNotifications());
  const { result: b } = renderHook(() => useNotifications());
  await waitFor(() => expect(a.current.loading).toBe(false));
  await waitFor(() => expect(b.current.loading).toBe(false));
  apiClient.get.mockClear();

  await act(async () => { await markAllNotificationsRead(); });

  expect(apiClient.put).toHaveBeenCalledWith('/api/notifications/read');
  expect(b.current.notifications).toEqual([note(1, { read: true })]);
  expect(b.current.unread).toBe(0);
  expect(apiClient.get).not.toHaveBeenCalled();
});

// Red-tell for the stale-merge defect: merging the list a component rendered
// with drops a poll that lands between the PUT and its response.
test('markAllNotificationsRead keeps a poll that landed while the PUT was in flight', async () => {
  apiClient.get.mockResolvedValue({ data: { notifications: [note(1)], unread: 1 } });
  let finishPut;
  apiClient.put.mockReturnValue(new Promise((resolve) => { finishPut = resolve; }));
  const { result } = renderHook(() => useNotifications());
  await waitFor(() => expect(result.current.loading).toBe(false));

  let marking;
  act(() => { marking = markAllNotificationsRead(); });
  // The 60 s poll lands: a second, newer unread item.
  act(() => { setResource(['notifications'], { notifications: [note(2), note(1)], unread: 2 }); });
  await act(async () => { finishPut({}); await marking; });

  expect(read(['notifications']).data).toEqual({
    notifications: [note(2, { read: true }), note(1, { read: true })],
    unread: 0,
  });
  expect(result.current.unread).toBe(0);
});

test('markAllNotificationsRead rejects when the PUT fails and leaves the cache alone', async () => {
  apiClient.get.mockResolvedValue({ data: { notifications: [note(1)], unread: 1 } });
  apiClient.put.mockRejectedValue(new Error('nope'));
  const { result } = renderHook(() => useNotifications());
  await waitFor(() => expect(result.current.loading).toBe(false));

  await expect(markAllNotificationsRead()).rejects.toThrow('nope');
  expect(result.current.unread).toBe(1);
});
