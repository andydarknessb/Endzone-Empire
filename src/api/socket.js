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
  // While the server-disconnect handler below refreshes, the socket is inactive
  // but about to be revived, so its listener must not drop out (#2556).
  let reviving = false;
  const stopTellingServer = onTokenRefreshed((token) => {
    if (reviving) return;
    if (!socket.active) return stopTellingServer();
    if (socket.connected) socket.emit('auth:refresh', { token });
  });

  // A refresh can land after the auth callback read the old token but before
  // the socket is connected, and is then skipped above. Sending the current
  // token on every connect corrects the expiry the handshake recorded (#2556).
  socket.on('connect', () => {
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

  // Socket-only screens (draft room, live matchups) may go 15+ minutes with
  // no REST traffic, so nothing else refreshes the access token. When the
  // server rejects the handshake as unauthorized, refresh via REST. socket.io-client
  // destroys a socket refused at the handshake and nothing here reconnects it,
  // so it stays dead until its component remounts (a fresh token is only read
  // by the next socket).
  socket.on('connect_error', (err) => {
    if (String(err && err.message).includes('unauthorized')) {
      refreshTokens().catch(endSessionIfRefused);
    }
  });

  // The server drops a socket whose token expired unrenewed (#2556), and
  // socket.io does not reconnect after a server disconnect: refresh, then
  // connect again so a Manager whose refresh failed earlier recovers unaided.
  // If this refresh fails too the socket stays down until its component remounts.
  // shortcut: a component that unmounts while the refresh is in flight leaves a
  // revived socket nobody closes, move to a closed flag if that window ever bites
  socket.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect') return;
    reviving = true;
    refreshTokens()
      .then(() => {
        // connect() skips the manager's 'reconnect' event, which is what the rooms
        // and feeds (onReconnect) rejoin and resync on, so raise it once connected.
        socket.once('connect', () => socket.io.emit('reconnect', 0));
        socket.connect();
      })
      .catch(endSessionIfRefused)
      .finally(() => { reviving = false; });
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
export function onReconnect(socket, handler) {
  socket.io.on('reconnect', handler);
  return () => socket.io.off('reconnect', handler);
}
