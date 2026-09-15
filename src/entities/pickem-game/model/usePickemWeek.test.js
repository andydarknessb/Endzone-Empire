import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import usePickemWeek from './usePickemWeek';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

// One deferred promise per week so the test controls resolution order
// independently of request order.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.put.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

test('a week-5 response beats an older week-3/week-4 response that resolves later', async () => {
  const week3 = deferred();
  const week4 = deferred();
  const week5 = deferred();
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/week/3')) return week3.promise;
    if (url.endsWith('/week/4')) return week4.promise;
    if (url.endsWith('/week/5')) return week5.promise;
    throw new Error(`unexpected url ${url}`);
  });

  const { result, rerender } = renderHook(
    ({ week }) => usePickemWeek(7, week),
    { initialProps: { week: 3 } }
  );
  rerender({ week: 4 });
  rerender({ week: 5 });

  // Resolve out of request order: the newest request (week 5) settles first,
  // then the two stale ones settle afterward.
  await act(async () => { week5.resolve({ data: { week: 5 } }); });
  await act(async () => { week3.resolve({ data: { week: 3 } }); });
  await act(async () => { week4.resolve({ data: { week: 4 } }); });

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toEqual({ week: 5 });
  expect(result.current.error).toBeNull();
});

test('a stale rejection does not overwrite error or clear loading for the newer request', async () => {
  const week3 = deferred();
  const week5 = deferred();
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/week/3')) return week3.promise;
    if (url.endsWith('/week/5')) return week5.promise;
    throw new Error(`unexpected url ${url}`);
  });

  const { result, rerender } = renderHook(
    ({ week }) => usePickemWeek(7, week),
    { initialProps: { week: 3 } }
  );
  rerender({ week: 5 });

  // The stale (week 3) request rejects after the newer (week 5) request is
  // already in flight; it must not surface its error nor flip loading off.
  await act(async () => {
    week3.reject(new Error('stale failure'));
    // Let the rejection's catch/finally microtasks run.
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(result.current.error).toBeNull();
  expect(result.current.loading).toBe(true);

  await act(async () => { week5.resolve({ data: { week: 5 } }); });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toEqual({ week: 5 });
  expect(result.current.error).toBeNull();
});
