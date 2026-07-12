import { io } from 'socket.io-client';
import { createDraftSocket, onReconnect } from './socket';
import { setToken, clearToken } from './apiClient';

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
