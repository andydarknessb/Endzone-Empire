import { waitFor } from '@testing-library/react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { createDraftSocket, onReconnect } from './socket';
import { setToken, getToken, clearToken, refreshTokens } from './apiClient';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

describe('createDraftSocket', () => {
  beforeEach(() => {
    // CRA's resetMocks wipes factory-inline implementations before each test,
    // so the fake socket has to be (re)installed here.
    io.mockImplementation(() => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() }));
  });

  afterEach(() => {
    clearToken();
    io.mockClear();
  });

  test('connects to "/" with reconnection enabled and backoff configured', () => {
    createDraftSocket();

    expect(io).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 15000,
        randomizationFactor: 0.5,
        reconnectionAttempts: Infinity,
      })
    );
  });

  test('passes auth as a callback function (not a frozen object) so a rotated token is picked up on every reconnect', () => {
    setToken('draft-jwt');

    createDraftSocket();

    const options = io.mock.calls[0][1];
    expect(typeof options.auth).toBe('function');

    const cb = jest.fn();
    options.auth(cb);
    expect(cb).toHaveBeenCalledWith({ token: 'draft-jwt' });
  });

  test('the auth callback yields a null token when the user is not logged in', () => {
    clearToken();

    createDraftSocket();

    const options = io.mock.calls[0][1];
    const cb = jest.fn();
    options.auth(cb);
    expect(cb).toHaveBeenCalledWith({ token: null });
  });

  test('the auth callback re-reads the token on each invocation (fresh on every reconnect attempt)', () => {
    setToken('first-jwt');
    createDraftSocket();
    const options = io.mock.calls[0][1];

    const cb1 = jest.fn();
    options.auth(cb1);
    expect(cb1).toHaveBeenCalledWith({ token: 'first-jwt' });

    setToken('rotated-jwt');
    const cb2 = jest.fn();
    options.auth(cb2);
    expect(cb2).toHaveBeenCalledWith({ token: 'rotated-jwt' });
  });

  test('returns the socket instance created by io()', () => {
    const result = createDraftSocket();
    expect(result).toBe(io.mock.results[0].value);
  });

  test('listens for connect_error so an expired JWT can be refreshed for the next attempt', () => {
    const socket = createDraftSocket();

    const registered = socket.on.mock.calls.find(([event]) => event === 'connect_error');
    expect(registered).toBeDefined();

    // A non-auth connect error (e.g. server briefly down) must not throw
    const [, handler] = registered;
    expect(() => handler(new Error('xhr poll error'))).not.toThrow();
  });

  describe('when the handshake is rejected as unauthorized', () => {
    let expired;
    const onExpired = () => { expired += 1; };

    beforeEach(() => {
      expired = 0;
      window.addEventListener('auth:session-expired', onExpired);
    });

    afterEach(() => {
      window.removeEventListener('auth:session-expired', onExpired);
      jest.restoreAllMocks();
    });

    function failHandshake() {
      const socket = createDraftSocket();
      const [, handler] = socket.on.mock.calls.find(([event]) => event === 'connect_error');
      handler(new Error('unauthorized'));
    }

    test('a refused refresh (401) clears the token and ends the session', async () => {
      setToken('revoked-jwt');
      jest.spyOn(axios, 'post').mockRejectedValue({ response: { status: 401 } });

      failHandshake();

      await waitFor(() => expect(expired).toBe(1));
      expect(getToken()).toBeNull();
    });

    test('a 5xx refresh failure leaves the session alone', async () => {
      setToken('still-good-jwt');
      const post = jest.spyOn(axios, 'post').mockRejectedValue({ response: { status: 503 } });

      failHandshake();

      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(expired).toBe(0);
      expect(getToken()).toBe('still-good-jwt');
    });

    test('a dropped link (no response) leaves the session alone', async () => {
      setToken('still-good-jwt');
      const post = jest.spyOn(axios, 'post').mockRejectedValue(new Error('Network Error'));

      failHandshake();

      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(expired).toBe(0);
      expect(getToken()).toBe('still-good-jwt');
    });
  });
});

describe('telling the server about a refreshed token', () => {
  let sockets;

  beforeEach(() => {
    sockets = [];
    io.mockImplementation(() => {
      const socket = { connected: true, active: true, on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() };
      sockets.push(socket);
      return socket;
    });
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { token: 'renewed-jwt' } });
  });

  afterEach(() => {
    clearToken();
    jest.restoreAllMocks();
  });

  test('a successful refresh makes each live draft socket emit auth:refresh with the new token', async () => {
    createDraftSocket();
    createDraftSocket();

    await refreshTokens();

    expect(sockets).toHaveLength(2);
    sockets.forEach((socket) => expect(socket.emit).toHaveBeenCalledWith('auth:refresh', { token: 'renewed-jwt' }));
  });

  test('a refused refresh tells no socket anything', async () => {
    createDraftSocket();
    axios.post.mockRejectedValue({ response: { status: 503 } });

    await expect(refreshTokens()).rejects.toBeDefined();

    expect(sockets[0].emit).not.toHaveBeenCalled();
  });

  test('a socket that is not connected is skipped; its next connect reads the fresh token', async () => {
    createDraftSocket();
    sockets[0].connected = false;

    await refreshTokens();

    expect(sockets[0].emit).not.toHaveBeenCalled();
  });

  test('a destroyed socket (closed, server-ended or refused at the handshake) is no longer told', async () => {
    createDraftSocket();
    createDraftSocket();
    sockets[0].active = false;

    await refreshTokens();

    expect(sockets[0].emit).not.toHaveBeenCalled();
    expect(sockets[1].emit).toHaveBeenCalledTimes(1);

    sockets[0].active = true;
    sockets[0].connected = true;
    await refreshTokens();
    expect(sockets[0].emit).not.toHaveBeenCalled();
  });
});

describe('createDraftSocket with a test harness installed', () => {
  beforeEach(() => {
    io.mockImplementation(() => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() }));
  });

  afterEach(() => {
    delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
    io.mockClear();
  });

  test('returns the harness-provided socket instead of calling io() when window.__ENDZONE_TEST_SOCKET_FACTORY__ is set', () => {
    const fakeSocket = { on: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), io: { on: jest.fn(), off: jest.fn() } };
    const factory = jest.fn(() => fakeSocket);
    window.__ENDZONE_TEST_SOCKET_FACTORY__ = factory;

    const result = createDraftSocket();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeSocket);
    expect(io).not.toHaveBeenCalled();
  });

  test('falls back to a real io() connection once the harness global is removed', () => {
    window.__ENDZONE_TEST_SOCKET_FACTORY__ = jest.fn(() => ({}));
    delete window.__ENDZONE_TEST_SOCKET_FACTORY__;

    createDraftSocket();

    expect(io).toHaveBeenCalledTimes(1);
  });
});

describe('onReconnect', () => {
  test('registers the handler on the manager-level "reconnect" event', () => {
    const handler = jest.fn();
    const managerOn = jest.fn();
    const socket = { io: { on: managerOn, off: jest.fn() } };

    onReconnect(socket, handler);

    expect(managerOn).toHaveBeenCalledWith('reconnect', handler);
  });

  test('returns an unsubscribe that removes the handler from the manager', () => {
    const handler = jest.fn();
    const socket = { io: { on: jest.fn(), off: jest.fn() } };

    const off = onReconnect(socket, handler);
    off();

    expect(socket.io.off).toHaveBeenCalledWith('reconnect', handler);
  });
});
