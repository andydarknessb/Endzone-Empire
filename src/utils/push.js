// The VAPID public key comes back from the server as a URL-safe base64
// string; PushManager.subscribe() needs it as a Uint8Array. Broken out as
// its own module so it's trivial to unit-test without touching the DOM.
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// iOS only delivers web push to an installed Home Screen app, so Safari tabs
// have no PushManager or Notification. True when the user is on iPhone/iPad
// (iPadOS reports as Macintosh with touch points), push is missing, and the
// page is not already running standalone.
export function needsHomeScreenInstall() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const pushMissing = !window.PushManager || !window.Notification;
  const standalone = navigator.standalone === true
    || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return isIos && pushMissing && !standalone;
}

export default urlBase64ToUint8Array;
