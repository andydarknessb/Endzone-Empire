import {
  invalidate,
  isFresh,
  load,
  read,
  serializeKey,
  setResource,
  subscribe,
} from './resourceCache';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-20T12:00:00Z'));
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.useRealTimers();
});

// --- keys ---

test('a key is its stringified elements, so equivalent keys are one entry', () => {
  expect(serializeKey(['league', 7])).toBe(serializeKey(['league', '7']));
  expect(serializeKey(['league', 7])).not.toBe(serializeKey(['league', 70]));
});

test('a null or undefined element is omitted, so "no season" is the shorter key', () => {
  expect(serializeKey(['pickem-standings', 7, null])).toBe(serializeKey(['pickem-standings', 7]));
  expect(serializeKey(['pickem-standings', 7, undefined])).toBe(serializeKey(['pickem-standings', 7]));
  expect(serializeKey(['pickem-standings', 7, 0])).not.toBe(serializeKey(['pickem-standings', 7]));
});

test('a serialized key is itself a key, so hooks can carry the string around', () => {
  const serialized = serializeKey(['league', 7]);
  setResource(serialized, { league: { id: 7 } });
  expect(read(['league', 7]).data).toEqual({ league: { id: 7 } });
  invalidate(serialized);
  expect(read(['league', 7])).toBeUndefined();
});

// --- in-flight sharing, freshness ---

test('concurrent callers on one key share a single request', async () => {
  const pending = deferred();
  const fetcher = jest.fn(() => pending.promise);

  const first = load(['league', 7], fetcher);
  const second = load(['league', '7'], fetcher);

  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(second).toBe(first);

  pending.resolve({ id: 7 });
  await expect(first).resolves.toEqual({ id: 7 });
  expect(read(['league', 7]).data).toEqual({ id: 7 });
});

test('an entry is fresh until the ttl elapses, and never while a request is in flight', async () => {
  const pending = deferred();
  const promise = load(['league', 7], () => pending.promise);
  expect(isFresh(read(['league', 7]), 60000)).toBe(false);

  pending.resolve({ id: 7 });
  await promise;

  expect(isFresh(read(['league', 7]), 60000)).toBe(true);
  jest.advanceTimersByTime(59999);
  expect(isFresh(read(['league', 7]), 60000)).toBe(true);
  jest.advanceTimersByTime(2);
  expect(isFresh(read(['league', 7]), 60000)).toBe(false);
  expect(isFresh(undefined, 60000)).toBe(false);
});

test('a reload keeps the previous data readable until the new response lands', async () => {
  await load(['league', 7], () => Promise.resolve('first'));

  const pending = deferred();
  const promise = load(['league', 7], () => pending.promise);
  expect(read(['league', 7]).data).toBe('first');
  expect(read(['league', 7]).fetchedAt).toBeNull();

  pending.resolve('second');
  await promise;
  expect(read(['league', 7]).data).toBe('second');
});

// --- generation guard ---

test('a response in flight at invalidation neither repopulates the store nor is lost to its caller', async () => {
  const pending = deferred();
  const promise = load(['league', 7], () => pending.promise);

  invalidate(['league', 7]); // a logout or a save landing mid-fetch

  pending.resolve({ id: 7, name: 'Previous session row' });
  await expect(promise).resolves.toEqual({ id: 7, name: 'Previous session row' });
  expect(read(['league', 7])).toBeUndefined();
});

test('a request that started before setResource cannot overwrite what was written', async () => {
  const pending = deferred();
  const promise = load(['league', 7], () => pending.promise);

  setResource(['league', 7], { league: { id: 7, name: 'Written' } });

  pending.resolve({ league: { id: 7, name: 'Stale response' } });
  await promise;
  expect(read(['league', 7]).data).toEqual({ league: { id: 7, name: 'Written' } });
});

test('a failure is never cached, so the next caller is free to try again', async () => {
  const failure = new Error('database is down');
  const promise = load(['league', 7], () => Promise.reject(failure));

  await expect(promise).rejects.toBe(failure);
  expect(read(['league', 7])).toBeUndefined();

  await load(['league', 7], () => Promise.resolve({ id: 7 }));
  expect(read(['league', 7]).data).toEqual({ id: 7 });
});

// --- write-through ---

test('setResource stores fresh data and notifies only subscribers on that exact key', () => {
  const onExact = jest.fn();
  const onSibling = jest.fn();
  const onPrefix = jest.fn();
  const unsubscribes = [
    subscribe(['league', 7], onExact),
    subscribe(['league', 8], onSibling),
    subscribe(['league'], onPrefix),
  ];

  setResource(['league', 7], { league: { id: 7 } });

  expect(onExact).toHaveBeenCalledWith({ type: 'set', data: { league: { id: 7 } } });
  expect(onSibling).not.toHaveBeenCalled();
  expect(onPrefix).not.toHaveBeenCalled();
  expect(isFresh(read(['league', 7]), 60000)).toBe(true);

  unsubscribes.forEach((unsubscribe) => unsubscribe());
});

// --- invalidation ---

test('invalidate matches the prefix element by element, never as a string', async () => {
  await load(['pickem-standings', 7, 2026], () => Promise.resolve('7/2026'));
  await load(['pickem-standings', 7], () => Promise.resolve('7/current'));
  await load(['pickem-standings', 70, 2026], () => Promise.resolve('70/2026'));
  await load(['league', 7], () => Promise.resolve('league 7'));

  invalidate(['pickem-standings', 7]);

  expect(read(['pickem-standings', 7, 2026])).toBeUndefined();
  expect(read(['pickem-standings', 7])).toBeUndefined();
  expect(read(['pickem-standings', 70, 2026]).data).toBe('70/2026');
  expect(read(['league', 7]).data).toBe('league 7');
});

test('a one-element prefix clears every entry under it', async () => {
  await load(['league', 7], () => Promise.resolve('seven'));
  await load(['league', 8], () => Promise.resolve('eight'));
  await load(['pickem-standings', 7], () => Promise.resolve('standings'));

  invalidate(['league']);

  expect(read(['league', 7])).toBeUndefined();
  expect(read(['league', 8])).toBeUndefined();
  expect(read(['pickem-standings', 7]).data).toBe('standings');
});

test('invalidate with no prefix clears everything', async () => {
  await load(['league', 7], () => Promise.resolve('seven'));
  await load(['pickem-standings', 7, 2026], () => Promise.resolve('standings'));
  await load(['pickem-settings', 7], () => Promise.resolve('settings'));

  invalidate();

  expect(read(['league', 7])).toBeUndefined();
  expect(read(['pickem-standings', 7, 2026])).toBeUndefined();
  expect(read(['pickem-settings', 7])).toBeUndefined();
});

test('invalidate tells matching subscribers to reload', async () => {
  const listener = jest.fn();
  const other = jest.fn();
  const unsubscribeListener = subscribe(['pickem-standings', 7, 2026], listener);
  const unsubscribeOther = subscribe(['pickem-standings', 8, 2026], other);

  invalidate(['pickem-standings', 7]);

  // The subscriber is reached even though it had no entry to drop.
  expect(listener).toHaveBeenCalledWith({ type: 'invalidate' });
  expect(other).not.toHaveBeenCalled();

  unsubscribeListener();
  unsubscribeOther();
  invalidate(['pickem-standings', 7]);
  expect(listener).toHaveBeenCalledTimes(1);
});

test('reload: false forgets everything and notifies nobody (a session drop)', async () => {
  await load(['league', 7], () => Promise.resolve('seven'));
  const listener = jest.fn();
  const unsubscribe = subscribe(['league', 7], listener);

  invalidate(undefined, { reload: false });

  expect(read(['league', 7])).toBeUndefined();
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});
