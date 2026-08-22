import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { invalidate, read, setResource } from '../lib/resourceCache';
import { useResource } from './useResource';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const TTL = 60000;

// One generic resource stands in for every adapter: the hook knows nothing
// about leagues or standings, only about a key, a url and a ttl.
const renderThing = (initialId) => renderHook(
  ({ id }) => useResource(id == null ? null : ['thing', id], `/api/thing/${id}`, { ttl: TTL }),
  { initialProps: { id: initialId } }
);

const pending = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  invalidate(undefined, { reload: false });
  apiClient.get.mockReset();
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.restoreAllMocks(); // the ttl test spies on Date.now; never let a failure leak it
  jest.clearAllMocks();
});

test('fetches on mount, and data and loading settle in the same tick', async () => {
  apiClient.get.mockResolvedValue({ data: { name: 'first' } });
  const renders = [];
  const { result } = renderHook(() => {
    const resource = useResource(['thing', 1], '/api/thing/1', { ttl: TTL });
    renders.push({ data: resource.data, loading: resource.loading });
    return resource;
  });

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.data).toEqual({ name: 'first' });
  expect(apiClient.get).toHaveBeenCalledWith('/api/thing/1');
  // The mount shows two states and no third: asking, then answered. No render
  // carries the answer while still claiming to be loading it, and none drops
  // the spinner before the answer is there.
  const seen = renders.map(({ data, loading }) => `${data ? 'data' : 'none'}/${loading ? 'loading' : 'settled'}`);
  expect(Array.from(new Set(seen))).toEqual(['none/loading', 'data/settled']);
});

test('a null key never fetches and never loads', async () => {
  const { result } = renderThing(null);

  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBeNull();
  await act(async () => { await result.current.refetch(); });
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('concurrent mounts on one key share a single request', async () => {
  const first = pending();
  apiClient.get.mockReturnValue(first.promise);

  const { result: a } = renderThing(1);
  const { result: b } = renderThing(1);

  expect(apiClient.get).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve({ data: 'shared' }); });
  expect(a.current.data).toBe('shared');
  expect(b.current.data).toBe('shared');
});

test('a fresh entry answers a later mount with no request at all', async () => {
  apiClient.get.mockResolvedValue({ data: 'cached' });
  const { result, unmount } = renderThing(1);
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();
  apiClient.get.mockClear();

  const { result: second } = renderThing(1);

  expect(second.current.loading).toBe(false);
  expect(second.current.data).toBe('cached');
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('an entry past its ttl is fetched again', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1000000);
  apiClient.get.mockResolvedValue({ data: 'stale' });
  const { result, unmount } = renderThing(1);
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  now.mockReturnValue(1000000 + TTL + 1);
  apiClient.get.mockResolvedValue({ data: 'refreshed' });
  const { result: second } = renderThing(1);

  expect(second.current.loading).toBe(true);
  await waitFor(() => expect(second.current.data).toBe('refreshed'));
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('refetch() bypasses the cache and its promise resolves once the data is on screen', async () => {
  apiClient.get.mockResolvedValue({ data: 'first' });
  const { result } = renderThing(1);
  await waitFor(() => expect(result.current.loading).toBe(false));

  apiClient.get.mockResolvedValue({ data: 'second' });
  await act(async () => { await result.current.refetch(); });

  // No waitFor here on purpose: awaiting refetch has to be enough.
  expect(result.current.data).toBe('second');
  expect(result.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('a sibling mount on the same key reloads from the one request a refetch starts', async () => {
  apiClient.get.mockResolvedValue({ data: 'first' });
  const { result: a } = renderThing(1);
  const { result: b } = renderThing(1);
  await waitFor(() => expect(a.current.loading).toBe(false));
  await waitFor(() => expect(b.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  apiClient.get.mockResolvedValue({ data: 'second' });
  await act(async () => { await a.current.refetch(); });

  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(a.current.data).toBe('second');
  expect(b.current.data).toBe('second');
});

test('refetch() while a request is in flight cuts a new one, and the older response never lands', async () => {
  const first = pending();
  apiClient.get.mockReturnValueOnce(first.promise);
  const { result } = renderThing(1);
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  // refetch means "at least as fresh as now": a response already on the wire
  // may predate whatever just changed, so it is superseded, not reused.
  const second = pending();
  apiClient.get.mockReturnValueOnce(second.promise);
  let refetched;
  act(() => { refetched = result.current.refetch(); });
  expect(apiClient.get).toHaveBeenCalledTimes(2);

  await act(async () => { first.resolve({ data: 'old' }); });
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(true);

  await act(async () => { second.resolve({ data: 'new' }); await refetched; });
  expect(result.current.data).toBe('new');
  expect(result.current.loading).toBe(false);
  expect(read(['thing', 1]).data).toBe('new');
});

test('switching keys never leaves the data of the key just left on screen', async () => {
  apiClient.get.mockImplementation((url) => (
    url.endsWith('/1') ? Promise.resolve({ data: 'one' }) : new Promise(() => {})
  ));
  const { result, rerender } = renderThing(1);
  await waitFor(() => expect(result.current.data).toBe('one'));

  rerender({ id: 2 });

  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(true);
});

test('a response for a key the mount has left never lands', async () => {
  const late = pending();
  apiClient.get.mockImplementation((url) => (
    url.endsWith('/1') ? late.promise : Promise.resolve({ data: 'two' })
  ));
  const { result, rerender } = renderThing(1);
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  rerender({ id: 2 });
  await waitFor(() => expect(result.current.data).toBe('two'));

  await act(async () => { late.resolve({ data: 'one, far too late' }); });

  expect(result.current.data).toBe('two');
  expect(result.current.loading).toBe(false);
});

test('an older response never lands over the newer one that superseded it', async () => {
  const first = pending();
  const second = pending();
  apiClient.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderThing(1);
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  // A save landed while the first request was still out: the mount reloads.
  act(() => { invalidate(['thing', 1]); });
  expect(apiClient.get).toHaveBeenCalledTimes(2);

  await act(async () => { second.resolve({ data: 'after the save' }); });
  expect(result.current.data).toBe('after the save');

  await act(async () => { first.resolve({ data: 'before the save' }); });
  expect(result.current.data).toBe('after the save');
  expect(read(['thing', 1]).data).toBe('after the save');
});

test('invalidation reloads a mounted hook, keeping the current data until the new one lands', async () => {
  apiClient.get.mockResolvedValue({ data: 'before' });
  const { result } = renderThing(1);
  await waitFor(() => expect(result.current.loading).toBe(false));

  const next = pending();
  apiClient.get.mockReturnValueOnce(next.promise);
  act(() => { invalidate(['thing', 1]); });

  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(result.current.data).toBe('before'); // stale-while-revalidate
  await act(async () => { next.resolve({ data: 'after' }); });
  expect(result.current.data).toBe('after');

  // Another key's invalidation is not this mount's business.
  act(() => { invalidate(['thing', 2]); });
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('setResource reaches every mount on the key at once and supersedes a pending load', async () => {
  const inFlight = pending();
  apiClient.get.mockReturnValue(inFlight.promise);
  const { result: a } = renderThing(1);
  const { result: b } = renderThing(1);
  expect(a.current.loading).toBe(true);

  act(() => { setResource(['thing', 1], 'written through'); });

  expect(a.current.data).toBe('written through');
  expect(b.current.data).toBe('written through');
  expect(a.current.loading).toBe(false);
  expect(b.current.loading).toBe(false);

  await act(async () => { inFlight.resolve({ data: 'the request that lost' }); });
  expect(a.current.data).toBe('written through');
  expect(read(['thing', 1]).data).toBe('written through');
});

test('invalidate with reload: false puts no request on the wire from a mounted hook', async () => {
  apiClient.get.mockResolvedValue({ data: 'signed-in row' });
  const { result } = renderThing(1);
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => { invalidate(undefined, { reload: false }); }); // a session drop

  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(read(['thing', 1])).toBeUndefined();
});

test('a request in flight when the session is dropped still answers the mount that asked', async () => {
  const inFlight = pending();
  apiClient.get.mockReturnValue(inFlight.promise);
  const { result } = renderThing(1);
  expect(result.current.loading).toBe(true);

  act(() => { invalidate(undefined, { reload: false }); }); // the session drop

  await act(async () => { inFlight.resolve({ data: 'the row the old session asked for' }); });

  // The store refuses the response, but the mount still settles: otherwise a
  // session that expires mid-request leaves a spinner nothing ever clears.
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBe('the row the old session asked for');
  expect(read(['thing', 1])).toBeUndefined();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test.each([
  [{ response: { data: { error: 'thing not found' } } }, 'thing not found'],
  [new Error('Network Error'), 'Network Error'],
  [{}, 'Request failed'],
])('surfaces the best message a failure carries (%#)', async (failure, message) => {
  apiClient.get.mockRejectedValue(failure);
  const { result } = renderThing(1);

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(message);
  expect(result.current.data).toBeNull();
});

test('a failure is not cached, and a later success clears the error', async () => {
  apiClient.get.mockRejectedValueOnce({ response: { data: { error: 'database is down' } } });
  const { result } = renderThing(1);
  await waitFor(() => expect(result.current.error).toBe('database is down'));

  apiClient.get.mockResolvedValue({ data: 'recovered' });
  await act(async () => { await result.current.refetch(); });

  expect(result.current.error).toBeNull();
  expect(result.current.data).toBe('recovered');
});

test('a fresh entry clears an error left over from the key the mount has left', async () => {
  setResource(['thing', 2], 'cached two');
  apiClient.get.mockRejectedValue({ response: { data: { error: 'thing unavailable' } } });
  const { result, rerender } = renderThing(1);
  await waitFor(() => expect(result.current.error).toBe('thing unavailable'));

  rerender({ id: 2 });

  expect(result.current.error).toBeNull();
  expect(result.current.data).toBe('cached two');
  expect(result.current.loading).toBe(false);
});
