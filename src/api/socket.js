import { io } from 'socket.io-client';
import { clearToken, getToken, isSessionRefusal, onTokenRefreshed, refreshTokens } from './apiClient';
import { getSocketOrigin } from './origins';

// Deterministic browser-test seam: when a harness has installed a socket
// factory on `window` (see tests/e2e/fixtures/draftHarness.ts), every
// draft-room-shaped socket (draft, chat, game center, matchup detail) is
// created by that factory instead of a real socket.io-client connection, so
// nothing this app does over a socket can ever reach a live server. The
// global is never set outside a test harness, so production and every other
// test (including socket.test.js, which mocks socket.io-client directly) are
// unaffected.
function testSocketFactory() {
  return typeof window !== 'undefined' && typeof window.__ENDZONE_TEST_SOCKET_FACTORY__ === 'function'
    ? window.__ENDZONE_TEST_SOCKET_FACTORY__
    : null;
}

export function createDraftSocket() {
  const fakeFactory = testSocketFactory();
  if (fakeFactory) return fakeFactory();

  const socket = io(getSocketOrigin(), {
    // A callback (rather than a frozen object) so socket.io re-invokes it on
    // every reconnection attempt, picking up a rotated JWT (access tokens
    // auto-refresh roughly every 15 min) instead of replaying a stale one.
    auth: (cb) => cb({ token: getToken() }),
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,
    reconnectionAttempts: Infinity,
  });

  // The server checks the token at the handshake only, so a renewed token has to
  // be told to it or the socket keeps the old expiry (#2555). A socket that is
  // not connected skips it: its next connect reads the fresh token anyway.
  // A destroyed socket (closed here, by the server, or refused at the handshake)
  // is no longer `active`; the first refresh after that drops its listener.
  // While a revive (below) refreshes, the socket is inactive but about to be
  // revived, so its listener must not drop out (#2556, #2740).
  let reviving = false;
  // Held from a revive's start until its socket connects: one revive at a time,
  // so a handshake refused as unauthorized right after a revive does not revive again.
  let reviveHeld = false;
  const stopTellingServer = onTokenRefreshed((token) => {
    if (reviving) return;
    if (!socket.active) return stopTellingServer();
    if (socket.connected) socket.emit('auth:refresh', { token });
  });

  // A refresh can land after the auth callback read the old token but before
  // the socket is connected, and is then skipped above. Sending the current
  // token on every connect corrects the expiry the handshake recorded (#2556).
  socket.on('connect', () => {
    // A revive's own connect reads the manager mark before it clears it, so only other connects clear it here.
    if (!reviveHeld) reconnectedSinceConnect.delete(socket);
    const token = getToken();
    if (token) socket.emit('auth:refresh', { token });
  });

  // As in apiClient: only a refusal ends the session; a 5xx or dropped link leaves the cookie good.
  const endSessionIfRefused = (error) => {
    if (isSessionRefusal(error)) {
      clearToken();
      window.dispatchEvent(new Event('auth:session-expired'));
    }
  };

  // Refresh, then connect again and run the onReconnect handlers once the socket
  // is back. A refused refresh ends the session; any other failure leaves the
  // socket down until its component remounts.
  // shortcut: a component that unmounts while the refresh is in flight leaves a
  // revived socket nobody closes, move to a closed flag if that window ever bites
  // A refresh that fails leaves reviveHeld set, so the socket stays down as above.
  const reviveWithFreshToken = () => {
    if (reviveHeld) return;
    reviveHeld = true;
    reviving = true;
    refreshTokens()
      .then(() => {
        // connect() skips the manager's 'reconnect' event, which is what the rooms
        // and feeds (onReconnect) rejoin and resync on, so run their handlers
        // ourselves once the revived socket is connected (#2696), unless the manager
        // already ran them since the last connect (its emits are buffered for this one).
        socket.once('connect', () => {
          const alreadyRan = reconnectedSinceConnect.has(socket);
          reconnectedSinceConnect.delete(socket);
          reviveHeld = false;
          if (!alreadyRan) runReconnectHandlers(socket);
        });
        socket.connect();
      })
      .catch(endSessionIfRefused)
      .finally(() => { reviving = false; });
  };

  // Socket-only screens (draft room, live matchups) may go 15+ minutes with
  // no REST traffic, so nothing else refreshes the access token. socket.io-client
  // destroys a socket refused at the handshake; when that refusal is unauthorized,
  // revive it on the fresh token (#2740).
  socket.on('connect_error', (err) => {
    if (String(err && err.message).includes('unauthorized')) reviveWithFreshToken();
  });

  // The server drops a socket whose token expired unrenewed (#2556), and
  // socket.io does not reconnect after a server disconnect: refresh, then
  // connect again so a Manager whose refresh failed earlier recovers unaided.
  socket.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect') return;
    reviveWithFreshToken();
  });

  return socket;
}

/**
 * Fires `handler` once the socket.io manager has successfully reconnected
 * after a dropped connection (e.g. a phone locking mid-draft). This is a
 * manager-level event (`socket.io.on`), distinct from the per-socket
 * 'connect' event, and is the hook components use to re-join rooms and
 * resync state (e.g. re-emitting 'draft:join' to receive a fresh
 * 'draft:state' snapshot). Returns an unsubscribe function — the reconnect
 * listener lives on the manager, which socket.io caches beyond the socket's
 * own lifetime, so component cleanup should call it alongside disconnect().
 */
// Per-socket onReconnect handlers, so a revive (which never fires the manager's
// 'reconnect') can run them too.
const reconnectHandlers = new WeakMap();
// Sockets whose manager 'reconnect' has run since they last connected: their
// onReconnect handlers already ran then, buffering their emits for the next connect.
const reconnectedSinceConnect = new WeakSet();
// The mark listener is on the manager while the socket has handlers, so an
// unsubscribe that leaves none leaves no listener behind.
const reconnectMarks = new WeakMap();

export function onReconnect(socket, handler) {
  socket.io.on('reconnect', handler);
  if (!reconnectHandlers.has(socket)) reconnectHandlers.set(socket, new Set());
  const handlers = reconnectHandlers.get(socket);
  if (handlers.size === 0) {
    const mark = () => reconnectedSinceConnect.add(socket);
    reconnectMarks.set(socket, mark);
    socket.io.on('reconnect', mark);
  }
  handlers.add(handler);
  return () => {
    socket.io.off('reconnect', handler);
    handlers.delete(handler);
    if (handlers.size === 0) socket.io.off('reconnect', reconnectMarks.get(socket));
  };
}

function runReconnectHandlers(socket) {
  for (const handler of [...(reconnectHandlers.get(socket) ?? [])]) handler();
}
