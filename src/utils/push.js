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

export default urlBase64ToUint8Array;
