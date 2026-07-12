// Thin, hand-rolled registration wrapper (no workbox / cra-template-pwa
// import) around the plain service worker in public/service-worker.js.
// Production-only so dev (react-scripts start) and tests (jsdom, no real
// SW support) are never affected.
export function register() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }
  if (!('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

export function unregister() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch((error) => {
      console.error('Service worker unregistration failed:', error);
    });
}

export default register;
