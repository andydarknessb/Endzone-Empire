import apiClient from '../api/apiClient';

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

// Feature-detected on every call (cheap) rather than hoisted to module scope,
// so tests can stub navigator.serviceWorker / window.PushManager per case.
export function isPushSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window;
}

// The subscribe flow shared by Notification settings and the Home Alert prompt.
// Each helper throws on failure; callers turn that into their own message.

// The server's VAPID public key, or null when push is not configured.
export async function fetchPushPublicKey() {
  const res = await apiClient.get('/api/notifications/push-public-key');
  return (res.data && res.data.publicKey) || null;
}

// This browser's push subscription, or null.
export async function getCurrentSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

// Asks permission, subscribes this browser, registers it with the server and
// returns the subscription.
export async function subscribeToPush(publicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted');
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const subscriptionJson = typeof subscription.toJSON === 'function'
    ? subscription.toJSON()
    : subscription;
  await apiClient.post('/api/notifications/push-subscribe', { subscription: subscriptionJson });
  return subscription;
}

// Unsubscribes this browser and tells the server to forget the endpoint.
export async function unsubscribeFromPush() {
  const subscription = await getCurrentSubscription();
  if (subscription) {
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await apiClient.delete('/api/notifications/push-subscribe', { data: { endpoint } });
  }
}

export default urlBase64ToUint8Array;
