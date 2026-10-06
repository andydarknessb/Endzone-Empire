import { loadWithReload } from './lazyWithReload';

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

test('a successful load clears the guard, so the next deploy can reload again', async () => {
  const storage = memoryStorage();
  const reload = jest.fn();
  loadWithReload(() => Promise.reject(chunkError()), { storage, reload });
  await new Promise((r) => setTimeout(r, 0));
  await loadWithReload(() => Promise.resolve({ default: 'Page' }), { storage, reload });
  loadWithReload(() => Promise.reject(chunkError()), { storage, reload });
  await new Promise((r) => setTimeout(r, 0));
  expect(reload).toHaveBeenCalledTimes(2);
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
