import { io } from 'socket.io-client';
import { getToken, getRefreshToken, refreshTokens } from './apiClient';
import { getSocketOrigin } from './origins';

export function createDraftSocket() {
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

  // Socket-only screens (draft room, live matchups) may go 15+ minutes with
  // no REST traffic, so nothing else refreshes the access token. When the
  // server rejects the handshake as unauthorized, refresh via REST — the next
  // reconnection attempt then reads the fresh token through the auth callback.
  socket.on('connect_error', (err) => {
    if (String(err && err.message).includes('unauthorized') && getRefreshToken()) {
      refreshTokens().catch(() => {});
    }
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
