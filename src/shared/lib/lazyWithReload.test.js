import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { loadWithReload, lazyWithReload } from './lazyWithReload';

const chunkError = () => Object.assign(new Error('Loading chunk 8784 failed.'), { name: 'ChunkLoadError' });

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('a chunk that fails to load after a deploy reloads the page once instead of failing the route', async () => {
  const storage = memoryStorage();
  const reload = jest.fn();
  const pending = loadWithReload(() => Promise.reject(chunkError()), { storage, reload });
  await Promise.resolve();
  await Promise.resolve();
  expect(reload).toHaveBeenCalledTimes(1);
  // The route never renders the error: the promise stays pending while the page reloads.
  const settled = await Promise.race([pending.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))]);
  expect(settled).toBe('pending');
});

test('a second chunk failure right after that reload is thrown, so a real outage never loops', async () => {
  const storage = memoryStorage();
  const reload = jest.fn();
  loadWithReload(() => Promise.reject(chunkError()), { storage, reload });
  await new Promise((r) => setTimeout(r, 0));
  await expect(loadWithReload(() => Promise.reject(chunkError()), { storage, reload })).rejects.toThrow('Loading chunk');
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a success after the reload does not clear the guard: a chunk that keeps failing never loops the page', async () => {
  const storage = memoryStorage();
  const reload = jest.fn();
  // Chunk A fails: the page reloads once and the key is set.
  loadWithReload(() => Promise.reject(chunkError()), { storage, reload });
  await new Promise((r) => setTimeout(r, 0));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(storage.getItem('endzone.chunkReload')).not.toBeNull();
  // After the reload (same storage): an unrelated chunk B loads from cache, then A fails again.
  await loadWithReload(() => Promise.resolve({ default: 'B' }), { storage, reload });
  await expect(loadWithReload(() => Promise.reject(chunkError()), { storage, reload })).rejects.toThrow('Loading chunk');
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a failure more than 60 seconds after the last reload reloads again (a long-lived tab, a later deploy)', async () => {
  const storage = memoryStorage();
  const reload = jest.fn();
  let t = 1_000_000;
  const now = () => t;
  loadWithReload(() => Promise.reject(chunkError()), { storage, reload, now });
  await new Promise((r) => setTimeout(r, 0));
  t += 59_000;
  await expect(loadWithReload(() => Promise.reject(chunkError()), { storage, reload, now })).rejects.toThrow('Loading chunk');
  expect(reload).toHaveBeenCalledTimes(1);
  t += 2_000; // 61 s after the reload
  loadWithReload(() => Promise.reject(chunkError()), { storage, reload, now });
  await new Promise((r) => setTimeout(r, 0));
  expect(reload).toHaveBeenCalledTimes(2);
});

test('a missing or unparseable guard value allows the reload', async () => {
  const storage = memoryStorage();
  storage.setItem('endzone.chunkReload', '1x-garbage');
  const reload = jest.fn();
  loadWithReload(() => Promise.reject(chunkError()), { storage, reload });
  await new Promise((r) => setTimeout(r, 0));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('an error that is not a chunk load error is thrown as is, with no reload', async () => {
  const reload = jest.fn();
  await expect(loadWithReload(() => Promise.reject(new TypeError('boom')), { storage: memoryStorage(), reload })).rejects.toThrow('boom');
  expect(reload).not.toHaveBeenCalled();
});

test('a CSS chunk failure counts too', async () => {
  const reload = jest.fn();
  loadWithReload(() => Promise.reject(new Error('Loading CSS chunk 12 failed.')), { storage: memoryStorage(), reload });
  await new Promise((r) => setTimeout(r, 0));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('with storage blocked the guard cannot be kept, so it throws rather than risk a reload loop', async () => {
  const reload = jest.fn();
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  await expect(loadWithReload(() => Promise.reject(chunkError()), { storage: blocked, reload })).rejects.toThrow('Loading chunk');
  expect(reload).not.toHaveBeenCalled();
});

describe('lazyWithReload', () => {
  const loadPage = () => Promise.resolve({ default: () => <p>the page</p> });

  test('a preloaded route renders at once, with no fallback', async () => {
    const Page = lazyWithReload(loadPage);
    await Page.preload();
    render(<Suspense fallback={<p>loading</p>}><Page /></Suspense>);
    expect(screen.getByText('the page')).toBeInTheDocument();
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
  });

  test('without a preload it suspends, then shows the page', async () => {
    const Page = lazyWithReload(loadPage);
    render(<Suspense fallback={<p>loading</p>}><Page /></Suspense>);
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });

  test('preload and render share one load call', async () => {
    const load = jest.fn(loadPage);
    const Page = lazyWithReload(load);
    const first = Page.preload();
    expect(Page.preload()).toBe(first);
    await first;
    render(<Suspense fallback={null}><Page /></Suspense>);
    expect(screen.getByText('the page')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('a failed chunk preload never reloads or touches the guard, and the render path can still reload once', async () => {
    const storage = memoryStorage();
    const reload = jest.fn();
    const load = jest.fn().mockRejectedValueOnce(chunkError()).mockRejectedValueOnce(chunkError());
    const Page = lazyWithReload(load, { storage, reload });
    await Page.preload().catch(() => {});
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem('endzone.chunkReload')).toBeNull();
    // A later render goes through the normal path: the second chunk failure reloads once.
    render(<Suspense fallback={<p>loading</p>}><Page /></Suspense>);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(storage.getItem('endzone.chunkReload')).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('a successful preload does not touch the guard, and the render path does not load again', async () => {
    const storage = memoryStorage();
    storage.setItem('endzone.chunkReload', '123');
    const load = jest.fn(loadPage);
    const Page = lazyWithReload(load, { storage, reload: jest.fn() });
    await Page.preload();
    expect(storage.getItem('endzone.chunkReload')).toBe('123');
    render(<Suspense fallback={<p>loading</p>}><Page /></Suspense>);
    expect(screen.getByText('the page')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('a failed preload can be retried', async () => {
    const load = jest.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementation(loadPage);
    const Page = lazyWithReload(load);
    await expect(Page.preload()).rejects.toThrow('offline');
    await Page.preload();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
