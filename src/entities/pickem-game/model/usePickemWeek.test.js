import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import usePickemWeek from './usePickemWeek';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

// A GET for /week/N returns the deferred registered for N, creating a fresh
// one (and recording it) the first time N is requested, so a test can grab
// the Nth deferred by number even when the hook fires more than one GET for
// the same week (a save's reload after a week switch fires a second one).
function makeGetRouter() {
  const queues = new Map();
  apiClient.get.mockImplementation((url) => {
    const match = url.match(/\/week\/(\d+)$/);
    if (!match) throw new Error(`unexpected url ${url}`);
    const week = match[1];
    if (!queues.has(week)) queues.set(week, []);
    const d = deferred();
    queues.get(week).push(d);
    return d.promise;
  });
  return {
    // The nth (1-indexed) GET issued for this week.
    nth: (week, n) => queues.get(String(week))[n - 1],
  };
}

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

// formal-001-f1: requestIdRef ordered calls to load(), not the week a
// response belongs to. savePicks closes over its render's load, so if the
// manager switches weeks while the PUT is in flight, the save's reload for
// the old week starts (and used to claim the highest id) after the new
// week's GET, dropping the new week's response and applying the old week's.
test.each([
  ['the new week GET resolves before the save\'s stale GET', ['week4', 'week3-initial', 'week3-reload']],
  ['the save\'s stale GET resolves before the new week GET', ['week3-initial', 'week3-reload', 'week4']],
])(
  'a save reload for a week the hook has left does not beat the current week (%s)',
  async (_label, resolveOrder) => {
    const router = makeGetRouter();
    const put = deferred();
    apiClient.put.mockImplementation(() => put.promise);

    const { result, rerender } = renderHook(
      ({ week }) => usePickemWeek(7, week),
      { initialProps: { week: 3 } }
    );

    // Kick off a save while still on week 3, then switch to week 4 before
    // the save's PUT (and so its reload) resolves.
    let savePromise;
    act(() => {
      savePromise = result.current.savePicks([{ gameKey: 'g1', pick: 'home' }]);
    });
    rerender({ week: 4 });

    // Resolving the PUT synchronously kicks off the save's own reload
    // (load()'s week-3 closure), which fires the second /week/3 GET —
    // await that microtask turn, but not `savePromise` itself yet: it
    // will not settle until that reload's GET resolves below.
    await act(async () => {
      put.resolve({});
      await Promise.resolve();
      await Promise.resolve();
    });

    const resolvers = {
      week4: () => router.nth(4, 1).resolve({ data: { week: 4 } }),
      'week3-initial': () => router.nth(3, 1).resolve({ data: { week: 3, source: 'initial-mount' } }),
      'week3-reload': () => router.nth(3, 2).resolve({ data: { week: 3, source: 'save-reload' } }),
    };
    for (const step of resolveOrder) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { resolvers[step](); });
    }
    await act(async () => { await savePromise; });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ week: 4 });
  }
);

// formal-002-f1: load() still wrote setLoading(true)/setError(null)
// unconditionally at issue time, before any applies() check — so a save's
// reload for a week the hook has left could still flip `loading` back on
// (or wipe a current-week `error`) for a request whose result can never be
// shown. The prior test.each always resolves the PUT before any GET, so it
// never exercised the current week settling FIRST.
test('a save reload for a left week does not reopen loading once the current week has already settled', async () => {
  const router = makeGetRouter();
  const put = deferred();
  apiClient.put.mockImplementation(() => put.promise);

  const { result, rerender } = renderHook(
    ({ week }) => usePickemWeek(7, week),
    { initialProps: { week: 3 } }
  );
  await act(async () => { router.nth(3, 1).resolve({ data: { week: 3 } }); });

  let savePromise;
  act(() => {
    savePromise = result.current.savePicks([{ gameKey: 'g1', pick: 'home' }]);
  });
  rerender({ week: 4 });

  // The new week's GET settles before the save's PUT (and so its reload).
  await act(async () => { router.nth(4, 1).resolve({ data: { week: 4 } }); });
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toEqual({ week: 4 });

  await act(async () => {
    put.resolve({});
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => { router.nth(3, 2).resolve({ data: { week: 3, source: 'save-reload' } }); });
  await act(async () => { await savePromise; });

  expect(result.current.loading).toBe(false);
  expect(result.current.data).toEqual({ week: 4 });
});

test("a save reload for a left week does not wipe the current week's error", async () => {
  const router = makeGetRouter();
  const put = deferred();
  apiClient.put.mockImplementation(() => put.promise);

  const { result, rerender } = renderHook(
    ({ week }) => usePickemWeek(7, week),
    { initialProps: { week: 3 } }
  );
  await act(async () => { router.nth(3, 1).resolve({ data: { week: 3 } }); });

  let savePromise;
  act(() => {
    savePromise = result.current.savePicks([{ gameKey: 'g1', pick: 'home' }]);
  });
  rerender({ week: 4 });

  await act(async () => { router.nth(4, 1).reject(new Error('week 4 failed')); });
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe('week 4 failed');

  await act(async () => {
    put.resolve({});
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => { router.nth(3, 2).resolve({ data: { week: 3, source: 'save-reload' } }); });
  await act(async () => { await savePromise; });

  expect(result.current.error).toBe('week 4 failed');
  expect(result.current.loading).toBe(false);
});
