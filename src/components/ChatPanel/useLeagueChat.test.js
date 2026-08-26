import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { onReconnect } from '../../api/socket';
import useLeagueChat from './useLeagueChat';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

// The hook never creates a socket - it rides one it is handed - so only
// onReconnect is mocked here. `createDraftSocket` is deliberately not, and a
// test below proves the hook never reaches for it.
jest.mock('../../api/socket', () => ({
  onReconnect: jest.fn(),
}));

/**
 * A controllable fake socket the hook is handed. It records `.on` handlers so
 * a test can fire an incoming message, and a real `.off` so the hook's
 * listener cleanup can be asserted. It has no `.disconnect` on purpose: the
 * hook does not own this socket's lifecycle and must never end it.
 */
function makeFakeSocket() {
  const handlers = {};
  return {
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    off: jest.fn((event) => { delete handlers[event]; }),
    emit: jest.fn(),
    io: { on: jest.fn(), off: jest.fn() },
    trigger(event, payload) { handlers[event]?.(payload); },
    hasHandler(event) { return Boolean(handlers[event]); },
  };
}

// A chat row as the REST history returns it: Team identity beside the account
// fields the server leaves in place (#112). Only the Team half may be read.
const chatMessage = (overrides = {}) => ({
  id: 1,
  user_id: 1,
  username: 'alice',
  teamId: 11,
  teamName: 'Anvils',
  message: 'hello there',
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

// The `chat:message` broadcast: Team identity, and by contract no
// viewer-relative field (one payload reaches the whole league room).
const broadcast = (overrides = {}) => ({
  id: 2,
  leagueId: 1,
  userId: 2,
  username: 'bob',
  teamId: 22,
  teamName: 'Bulldogs',
  message: 'yo',
  created_at: '2026-01-01T12:05:00Z',
  ...overrides,
});

const mockGets = ({ history = [], unread = 0 } = {}) => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/chat/unread')
      ? Promise.resolve({ data: { unread } })
      : Promise.resolve({ data: history })
  );
};

let reconnectHandlers;

beforeEach(() => {
  reconnectHandlers = [];
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandlers.push(handler);
    return () => {
      reconnectHandlers = reconnectHandlers.filter((h) => h !== handler);
    };
  });
  apiClient.post.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  jest.clearAllMocks();
});

const render = (props) => {
  const socket = makeFakeSocket();
  const utils = renderHook(
    ({ socket: s, leagueId, open, viewerTeamId }) =>
      useLeagueChat({ socket: s, leagueId, open, viewerTeamId }),
    { initialProps: { socket, leagueId: 1, open: true, viewerTeamId: null, ...props } }
  );
  return { socket, ...utils };
};

test('fetches league-chat history on mount and exposes it as messages', async () => {
  mockGets({ history: [chatMessage({ id: 1, message: 'hi' })] });

  const { result } = render();

  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(result.current.messages[0].message).toBe('hi');
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat');
});

test('appends an incoming chat:message from the socket it was handed', async () => {
  mockGets();

  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => socket.trigger('chat:message', broadcast()));

  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(result.current.messages[0].message).toBe('yo');
});

test('sendMessage emits chat:send with trimmed text and resolves true on an ok ack', async () => {
  mockGets();
  const { socket, result } = render({ leagueId: 5 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true });
  });

  let resolved;
  await act(async () => { resolved = await result.current.sendMessage('  hey team  '); });

  expect(socket.emit).toHaveBeenCalledWith(
    'chat:send',
    { leagueId: 5, message: 'hey team' },
    expect.any(Function)
  );
  expect(resolved).toBe(true);
  expect(result.current.error).toBe(null);
});

test('sendMessage surfaces the ack error and resolves false', async () => {
  mockGets();
  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ error: 'message rejected' });
  });

  let resolved;
  await act(async () => { resolved = await result.current.sendMessage('bad'); });

  expect(resolved).toBe(false);
  await waitFor(() => expect(result.current.error).toBe('message rejected'));
});

test('an empty or whitespace-only message never emits and never touches the error', async () => {
  mockGets();
  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  let resolved;
  await act(async () => { resolved = await result.current.sendMessage('   '); });

  expect(resolved).toBe(false);
  expect(socket.emit).not.toHaveBeenCalledWith('chat:send', expect.anything(), expect.anything());
});

test('while closed, unread starts from the server count and grows only with others\' messages', async () => {
  mockGets({ unread: 2 });
  const { socket, result } = render({ open: false, viewerTeamId: 99 });

  await waitFor(() => expect(result.current.unread).toBe(2));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat/unread');

  // Someone else's Team increments...
  act(() => socket.trigger('chat:message', broadcast()));
  await waitFor(() => expect(result.current.unread).toBe(3));

  // ...but the viewer's own broadcast echo, recognised by Team, does not.
  act(() => socket.trigger('chat:message', broadcast({ id: 3, teamId: 99, teamName: 'Mine', message: 'mine' })));
  await waitFor(() => expect(result.current.messages.some((m) => m.message === 'mine')).toBe(true));
  expect(result.current.unread).toBe(3);
  // A closed surface never moves the read marker.
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('counts a former manager\'s message as unread when the viewer\'s own Team is not known yet', async () => {
  // The two-nulls-match trap (#188): a departed author reads back teamId null,
  // and viewerTeamId is null until it is known, so a guard must not treat the
  // two nulls as "my own echo".
  mockGets({ unread: 0 });
  const { socket, result } = render({ open: false, viewerTeamId: null });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => socket.trigger('chat:message', broadcast({ id: 7, teamId: null, teamName: null, message: 'gone' })));

  await waitFor(() => expect(result.current.unread).toBe(1));
});

test('opening resets unread and moves the server-side read marker', async () => {
  mockGets({ unread: 5 });
  const { socket, result, rerender } = render({ open: false });
  await waitFor(() => expect(result.current.unread).toBe(5));

  // Flip the drawer open, keeping the same handed-in socket.
  rerender({ socket, leagueId: 1, open: true, viewerTeamId: null });

  await waitFor(() => expect(result.current.unread).toBe(0));
  expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/chat/read');
});

test('messages arriving while open are marked read on the server immediately', async () => {
  mockGets();
  const { socket } = render({ open: true, leagueId: 4 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  apiClient.post.mockClear();

  act(() => socket.trigger('chat:message', broadcast({ leagueId: 4, message: 'seen live' })));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/4/chat/read'));
});

test('re-fetches chat history and unread when the socket reconnects', async () => {
  mockGets({ history: [] });
  const { result } = render({ open: false });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));

  apiClient.get.mockClear();
  mockGets({ history: [chatMessage({ id: 9, message: 'missed while offline' })], unread: 4 });

  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));
  await waitFor(() => expect(result.current.messages.some((m) => m.message === 'missed while offline')).toBe(true));
});

test('removes its chat:message listener on unmount, and never disconnects the shared socket', async () => {
  mockGets();
  const { socket, unmount } = render();
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  unmount();

  expect(socket.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
  expect(socket.hasHandler('chat:message')).toBe(false);
  // It was handed the socket; ending it is the owner's job, never the hook's.
  expect(socket).not.toHaveProperty('disconnect');
});

test('does not blow up before a socket exists, and sendMessage is a no-op then', async () => {
  mockGets();
  const utils = renderHook(
    ({ socket }) => useLeagueChat({ socket, leagueId: 1, open: true, viewerTeamId: null }),
    { initialProps: { socket: null } }
  );

  let resolved;
  await act(async () => { resolved = await utils.result.current.sendMessage('hi'); });
  expect(resolved).toBe(false);
  // History still loads without a socket.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));
});
