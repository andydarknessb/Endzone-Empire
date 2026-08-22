// Thin, hand-rolled registration wrapper (no workbox / cra-template-pwa
// import) around the plain service worker in public/service-worker.js.
// Production-only so dev (react-scripts start) and tests (jsdom, no real
// SW support) are never affected.
import { getApiOrigin } from './api/origins';

/**
 * The worker cannot read REACT_APP_* itself, so the API origin (set in
 * production, where the API lives on api.<site>) rides on its script URL.
 * Registrations are keyed by scope, so a changed script URL updates the
 * existing scope-/ registration in place: the new worker installs and, via
 * skipWaiting + clients.claim, takes over on the next load. Nothing ever runs
 * two workers side by side.
 */
export function serviceWorkerUrl(apiOrigin = getApiOrigin()) {
  return apiOrigin ? `/service-worker.js?api=${encodeURIComponent(apiOrigin)}` : '/service-worker.js';
}

export function register() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }
  if (!('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(serviceWorkerUrl()).catch((error) => {
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
