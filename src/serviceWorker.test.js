/**
 * The service worker is a plain script (no imports) that only registers in a
 * production build, so it has no runtime coverage in jsdom. This evaluates
 * public/service-worker.js in a sandbox with a fake `self` and pins what is
 * left of it: push, and no fetch listener (#2072, ADR 0059).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadServiceWorker({ cacheNames = [], disable } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
  const listeners = {};
  const calls = { deleted: [], claimed: 0, disabled: 0, notifications: [], opened: [] };
  const self = {
    location: { origin: 'https://endzoneempire.gg' },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => { calls.claimed += 1; return Promise.resolve(); },
      openWindow: (url) => { calls.opened.push(url); return Promise.resolve(); },
    },
    registration: {
      showNotification: (title, options) => { calls.notifications.push({ title, options }); return Promise.resolve(); },
      navigationPreload: { disable: () => { calls.disabled += 1; return disable ? disable() : Promise.resolve(); } },
    },
  };
  const caches = {
    keys: () => Promise.resolve(cacheNames),
    delete: (name) => { calls.deleted.push(name); return Promise.resolve(true); },
  };
  const context = vm.createContext({ self, caches, URL, console });
  vm.runInContext(source, context, { filename: 'service-worker.js' });
  return { listeners, calls };
}

// Runs a listener and resolves whatever it handed to event.waitUntil.
async function dispatch(listener, event = {}) {
  let pending;
  listener({ ...event, waitUntil: (promise) => { pending = promise; } });
  await pending;
}

test('registers install, activate, push and notificationclick, and no fetch listener', () => {
  const { listeners } = loadServiceWorker();
  expect(Object.keys(listeners).sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
});

test('activate deletes every cache, disables navigation preload and claims clients', async () => {
  const { listeners, calls } = loadServiceWorker({ cacheNames: ['endzone-shell-v1', 'endzone-shell-v2', 'api-cache-v1', 'whatever'] });

  await dispatch(listeners.activate);

  expect(calls.deleted).toEqual(['endzone-shell-v1', 'endzone-shell-v2', 'api-cache-v1', 'whatever']);
  expect(calls.disabled).toBe(1);
  expect(calls.claimed).toBe(1);
});

test('activate still claims clients when navigationPreload.disable() rejects', async () => {
  const { listeners, calls } = loadServiceWorker({ disable: () => Promise.reject(new Error('unsupported')) });

  await dispatch(listeners.activate);

  expect(calls.disabled).toBe(1);
  expect(calls.claimed).toBe(1);
});

test('push shows a notification with the payload title, body and url', async () => {
  const { listeners, calls } = loadServiceWorker();

  await dispatch(listeners.push, { data: { json: () => ({ title: 'Lineup locked', body: 'Week 5', url: '/lineup' }) } });

  expect(calls.notifications).toEqual([{ title: 'Lineup locked', options: { body: 'Week 5', data: { url: '/lineup' } } }]);
});

test('notificationclick closes the notification and opens its url', async () => {
  const { listeners, calls } = loadServiceWorker();
  const close = jest.fn();

  await dispatch(listeners.notificationclick, { notification: { close, data: { url: '/lineup' } } });

  expect(close).toHaveBeenCalled();
  expect(calls.opened).toEqual(['/lineup']);
});
