/* eslint-disable no-restricted-globals */
// No fetch listener, on purpose: the browser never starts this worker for page
// loads, scripts or API reads (#2072: a worker start-up in a throttled or
// frozen renderer held the page 1.1 s warm and 5 minutes cold). The worker
// exists for push only; activate drops every cache earlier versions wrote.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() =>
        // Preload is a property of the REGISTRATION (#2072 enabled it), so it
        // stays on until disabled explicitly. Older browsers have no
        // navigationPreload, and a rejected disable() never costs the
        // clients.claim() below.
        self.registration.navigationPreload
          ? self.registration.navigationPreload.disable().catch(() => {})
          : undefined
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = {};
  }
  const { title = 'Endzone Empire', body = '', url } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.openWindow(url));
});
