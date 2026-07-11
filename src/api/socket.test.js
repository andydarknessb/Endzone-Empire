import { io } from 'socket.io-client';
import { createDraftSocket } from './socket';
import { setToken, clearToken } from './apiClient';

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() })),
}));

describe('createDraftSocket', () => {
  afterEach(() => {
    clearToken();
    io.mockClear();
  });

  test('connects to "/" passing the current token in the auth handshake', () => {
    setToken('draft-jwt');

    createDraftSocket();

    expect(io).toHaveBeenCalledWith('/', { auth: { token: 'draft-jwt' } });
  });

  test('passes a null token when the user is not logged in', () => {
    clearToken();

    createDraftSocket();

    expect(io).toHaveBeenCalledWith('/', { auth: { token: null } });
  });

  test('returns the socket instance created by io()', () => {
    const result = createDraftSocket();
    expect(result).toBe(io.mock.results[0].value);
  });
});
