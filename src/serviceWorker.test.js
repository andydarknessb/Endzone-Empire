/**
 * The service worker is a plain script (no imports) that only registers in a
 * production build, so it has no runtime coverage in jsdom. This evaluates
 * public/service-worker.js in a sandbox with a fake `self` and pins what is
 * left of it: push, and no fetch listener (#2072, ADR 0059).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadServiceWorker({ cacheNames = [], disable, preload = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
  const listeners = {};
  const calls = { deleted: [], claimed: 0, disabled: 0, skipped: 0, notifications: [], opened: [] };
  const self = {
    location: { origin: 'https://endzoneempire.gg' },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => { calls.skipped += 1; return Promise.resolve(); },
    clients: {
      claim: () => { calls.claimed += 1; return Promise.resolve(); },
      openWindow: (url) => { calls.opened.push(url); return Promise.resolve(); },
    },
    registration: {
      showNotification: (title, options) => { calls.notifications.push({ title, options }); return Promise.resolve(); },
      navigationPreload: preload ? { disable: () => { calls.disabled += 1; return disable ? disable() : Promise.resolve(); } } : undefined,
    },
  };
  const caches = {
    keys: () => Promise.resolve(cacheNames),
    delete: (name) => { calls.deleted.push(name); return Promise.resolve(true); },
  };
  const context = vm.createContext({ self, caches, URL, console });
  vm.runInContext(source, context, { filename: 'service-worker.js' });
  return { listeners, calls, self };
}

// Runs a listener and resolves whatever it handed to event.waitUntil.
async function dispatch(listener, event = {}) {
  let pending;
  listener({ ...event, waitUntil: (promise) => { pending = promise; } });
  await pending;
}

test('registers install, activate, push and notificationclick, and no fetch listener', () => {
  const { listeners, self } = loadServiceWorker();
  expect(Object.keys(listeners).sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
  expect(self.onfetch).toBeUndefined();
});

test('install skips waiting, so the push-only worker replaces the old fetch-handler worker without every tab closing', async () => {
  const { listeners, calls } = loadServiceWorker();

  await dispatch(listeners.install);

  expect(calls.skipped).toBe(1);
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

test('activate still claims clients on a browser with no navigationPreload', async () => {
  const { listeners, calls } = loadServiceWorker({ preload: false });

  await dispatch(listeners.activate);

  expect(calls.disabled).toBe(0);
  expect(calls.claimed).toBe(1);
});

test('push shows a notification with the payload title and body, and keeps all three in data for the click', async () => {
  const { listeners, calls } = loadServiceWorker();

  await dispatch(listeners.push, { data: { json: () => ({ title: 'Lineup locked', body: 'Week 5', url: '/lineup' }) } });

  expect(calls.notifications).toEqual([{ title: 'Lineup locked', options: { body: 'Week 5', data: { url: '/lineup', title: 'Lineup locked', body: 'Week 5' } } }]);
});

test('notificationclick closes the notification and opens its url unchanged when the alert has no text', async () => {
  const { listeners, calls } = loadServiceWorker();
  const close = jest.fn();

  await dispatch(listeners.notificationclick, { notification: { close, data: { url: '/#/lineup' } } });

  expect(close).toHaveBeenCalled();
  expect(calls.opened).toEqual(['/#/lineup']);
});

test('notificationclick opens "/#/" when the notification has no data at all', async () => {
  const { listeners, calls } = loadServiceWorker();

  await dispatch(listeners.notificationclick, { notification: { close: jest.fn() } });

  expect(calls.opened).toEqual(['/#/']);
});

test('notificationclick appends the whole alert after the hash path so useSearchParams sees it', async () => {
  const { listeners, calls } = loadServiceWorker();
  const title = 'Big play: Jaylen Warren';
  const body = 'facts line\nbanter line & more?';

  await dispatch(listeners.notificationclick, {
    notification: { close: jest.fn(), data: { url: '/#/league/5/game-center', title, body } },
  });

  const [opened] = calls.opened;
  expect(opened.startsWith('/#/league/5/game-center?alert=')).toBe(true);
  expect(JSON.parse(decodeURIComponent(opened.split('?alert=')[1]))).toEqual({ title, body });
});

test('notificationclick joins with & when the hash path already has a query', async () => {
  const { listeners, calls } = loadServiceWorker();

  await dispatch(listeners.notificationclick, {
    notification: { close: jest.fn(), data: { url: '/#/team?leagueId=5', title: 'T', body: 'B' } },
  });

  expect(calls.opened).toEqual([
    `/#/team?leagueId=5&alert=${encodeURIComponent(JSON.stringify({ title: 'T', body: 'B' }))}`,
  ]);
});

test('notificationclick falls back to "/#/" and still carries the alert when there is no url', async () => {
  const { listeners, calls } = loadServiceWorker();

  await dispatch(listeners.notificationclick, { notification: { close: jest.fn(), data: { title: 'T', body: 'B' } } });

  expect(calls.opened[0].startsWith('/#/?alert=')).toBe(true);
});

test('notificationclick puts ?alert= after the hash path when only the part before the hash has a query', async () => {
  const { listeners, calls } = loadServiceWorker();

  await dispatch(listeners.notificationclick, {
    notification: { close: jest.fn(), data: { url: '/?x=1#/p', title: 'T', body: 'B' } },
  });

  expect(calls.opened).toEqual([
    `/?x=1#/p?alert=${encodeURIComponent(JSON.stringify({ title: 'T', body: 'B' }))}`,
  ]);
});
