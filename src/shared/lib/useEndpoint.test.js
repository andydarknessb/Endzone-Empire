import { renderHook, waitFor, act } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { useEndpoint } from './useEndpoint';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// A deferred promise whose resolve/reject are exposed, for ordering-sensitive
// tests (a slow first read that must lose to a faster later one).
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  apiClient.get.mockResolvedValue({ data: null });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('a null url never calls apiClient.get and reports the idle shape', async () => {
  const { result } = renderHook(() => useEndpoint(null));

  // renderHook flushes the mount effect inside act, so the null-url branch has
  // already run: the read never fires and the state is the idle shape the
  // dashboard widgets rely on (matchup-preview parks a chained read here).
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current).toEqual({ status: 'loading', data: null, httpStatus: null });
});

test('a successful read reports status ready, the payload, and httpStatus null', async () => {
  apiClient.get.mockResolvedValue({ data: { grades: [] } });
  const { result } = renderHook(() => useEndpoint('/api/league/7/draft-grades'));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/7/draft-grades');
  expect(result.current).toEqual({ status: 'ready', data: { grades: [] }, httpStatus: null });
});

test('a failure reports status error and the failing response HTTP status', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 404 } });
  const { result } = renderHook(() => useEndpoint('/api/league/7/draft-grades'));

  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current).toEqual({ status: 'error', data: null, httpStatus: 404 });
});

test('a failure with no response (e.g. network error) reports httpStatus null', async () => {
  apiClient.get.mockRejectedValue(new Error('network down'));
  const { result } = renderHook(() => useEndpoint('/api/league/7/draft-grades'));

  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current).toEqual({ status: 'error', data: null, httpStatus: null });
});

test('a url change discards the earlier response even if it lands later', async () => {
  const first = deferred();
  apiClient.get
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValueOnce({ data: { which: 'second' } });

  const { result, rerender } = renderHook(({ url }) => useEndpoint(url), {
    initialProps: { url: '/api/first' },
  });

  // The first read is still in flight when the url changes to the second.
  rerender({ url: '/api/second' });
  await waitFor(() => expect(result.current.data).toEqual({ which: 'second' }));

  // The stale first read now resolves late; it must NOT clobber the second.
  await act(async () => {
    first.resolve({ data: { which: 'first' } });
  });
  expect(result.current.data).toEqual({ which: 'second' });
});

test('resolving after unmount is harmless (the cancel path is not observable in React 18)', async () => {
  const pending = deferred();
  apiClient.get.mockImplementationOnce(() => pending.promise);

  const { result, unmount } = renderHook(() => useEndpoint('/api/league/7/draft-grades'));
  expect(result.current.status).toBe('loading');

  unmount();

  // Honest scope: this does NOT pin the cancelled flag. In React 18 an
  // unmounted hook cannot re-render, and the setState-after-unmount warning was
  // removed, so result.current is frozen at its last value whether or not the
  // response was discarded - the two are externally indistinguishable through
  // renderHook. All this asserts is that resolving after unmount throws
  // nothing. The url-change test above is the real pin for cancellation.
  await act(async () => {
    pending.resolve({ data: { grades: [] } });
  });
  expect(result.current.status).toBe('loading');
});
