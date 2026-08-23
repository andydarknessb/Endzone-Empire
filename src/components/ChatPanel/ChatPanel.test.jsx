import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import ChatPanel from './ChatPanel';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

// A chat row as the server sends it today: Team identity beside the account
// fields the expand step deliberately left in place (#112). The panel must
// read only the Team half, so every fixture keeps a username that the
// assertions then refuse to find on screen.
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

// The `chat:message` broadcast. It carries Team identity and, by contract,
// never a viewer-relative field: one payload reaches the whole league room.
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

// `league:join` is answered to one socket, so it is the chat panel's only
// route to its own Team ID; nothing else it receives can carry one.
const answerJoinWith = (viewerTeamId) => {
  mockSocket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'league:join' && ack) ack({ ok: true, viewerTeamId });
  });
};

let mockSocket;
let socketHandlers;
let reconnectHandlers;

beforeEach(() => {
  socketHandlers = {};
  reconnectHandlers = [];
  mockSocket = {
    on: jest.fn((event, cb) => {
      socketHandlers[event] = cb;
    }),
    io: {
      on: jest.fn((event, cb) => {
        reconnectHandlers.push(cb);
      }),
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  createDraftSocket.mockReturnValue(mockSocket);
  onReconnect.mockImplementation((socket, handler) => socket.io.on('reconnect', handler));
  apiClient.post.mockResolvedValue({ data: { ok: true } });
});

// Route the two GET endpoints the panel uses: chat history and unread count.
const mockGets = ({ history = [], unread = 0 } = {}) => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/chat/unread')
      ? Promise.resolve({ data: { unread } })
      : Promise.resolve({ data: history })
  );
};

afterEach(() => {
  jest.clearAllMocks();
});

test('loads chat history and attributes each message to its Team, never its account', async () => {
  apiClient.get.mockResolvedValue({ data: [chatMessage({ id: 1, message: 'hi' })] });

  renderWithProviders(<ChatPanel leagueId={1} />);

  expect(await screen.findByText('hi')).toBeInTheDocument();
  expect(screen.getByText('Anvils')).toBeInTheDocument();
  expect(screen.queryByText('alice')).not.toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat');
});

test('a message from a manager who has left the league is attributed to a former manager', async () => {
  // The history join is LEFT so the message survives the departure; its Team
  // identity comes back null and there is no account name to fall back to.
  apiClient.get.mockResolvedValue({
    data: [chatMessage({ id: 1, teamId: null, teamName: null, username: 'ghost', message: 'so long' })],
  });

  renderWithProviders(<ChatPanel leagueId={1} />);

  expect(await screen.findByText('so long')).toBeInTheDocument();
  expect(screen.getByText('Former manager')).toBeInTheDocument();
  expect(screen.queryByText('ghost')).not.toBeInTheDocument();
  expect(screen.queryByText('null')).not.toBeInTheDocument();
});

test('shows an empty state when there are no messages', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<ChatPanel leagueId={1} />);

  expect(await screen.findByText('No messages yet')).toBeInTheDocument();
});

test('appends an incoming chat:message in real time', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<ChatPanel leagueId={1} />);
  await screen.findByText('No messages yet');

  act(() => {
    socketHandlers['chat:message'](broadcast());
  });

  expect(await screen.findByText('yo')).toBeInTheDocument();
  expect(screen.getByText('Bulldogs')).toBeInTheDocument();
  expect(screen.queryByText('bob')).not.toBeInTheDocument();
});

test('sending a message emits chat:send with the trimmed text and clears the input on success', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  mockSocket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({});
  });

  renderWithProviders(<ChatPanel leagueId={5} />);
  await screen.findByText('No messages yet');

  const input = screen.getByLabelText('Message');
  await userEvent.type(input, '  hey team  ');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() =>
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'chat:send',
      { leagueId: 5, message: 'hey team' },
      expect.any(Function)
    )
  );
  expect(input).toHaveValue('');
});

test('shows an error alert when the send ack reports an error', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  mockSocket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ error: 'message rejected' });
  });

  renderWithProviders(<ChatPanel leagueId={1} />);
  await screen.findByText('No messages yet');

  const input = screen.getByLabelText('Message');
  await userEvent.type(input, 'bad message');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByText('message rejected')).toBeInTheDocument();
});

test('the Send button is disabled while the input is empty', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<ChatPanel leagueId={1} />);
  await screen.findByText('No messages yet');

  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('joins the league room on mount and disconnects on unmount', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  const { unmount } = renderWithProviders(<ChatPanel leagueId={7} />);
  await screen.findByText('No messages yet');

  expect(createDraftSocket).toHaveBeenCalled();
  // The join now carries an acknowledgement callback: it is the only channel
  // that can tell this panel which Team is the viewer's own.
  expect(mockSocket.emit).toHaveBeenCalledWith(
    'league:join',
    { leagueId: 7 },
    expect.any(Function)
  );

  unmount();
  expect(mockSocket.disconnect).toHaveBeenCalled();
});

test('while closed, unread starts from the server count and grows with others\' messages only', async () => {
  mockGets({ unread: 2 });
  // "Which of these is mine" is answered by Team, and the join ack is where
  // that answer arrives.
  answerJoinWith(99);
  const onUnreadChange = jest.fn();

  renderWithProviders(<ChatPanel leagueId={1} open={false} onUnreadChange={onUnreadChange} />);
  await screen.findByText('No messages yet');

  // Server-persisted count (survives reloads) seeds the badge.
  await waitFor(() => expect(onUnreadChange).toHaveBeenCalledWith(2));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat/unread');

  // Someone else's Team increments...
  act(() => {
    socketHandlers['chat:message'](broadcast());
  });
  await waitFor(() => expect(onUnreadChange).toHaveBeenLastCalledWith(3));

  // ...but the viewer's own broadcast echo does not, recognised by Team ID
  // and not by any account field on the payload.
  act(() => {
    socketHandlers['chat:message'](broadcast({
      id: 3, userId: 9, username: 'me', teamId: 99, teamName: 'Mine', message: 'mine',
    }));
  });
  await screen.findByText('mine');
  expect(onUnreadChange).toHaveBeenLastCalledWith(3);
  // Closed panel never touches the read marker.
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('a broadcast that shares the viewer\'s account but not their Team still counts as unread', async () => {
  // Pins the migration: the account fields still on the payload have no say
  // in the answer, so a userId collision cannot swallow someone else's
  // message the way an account-ID comparison would.
  mockGets({ unread: 0 });
  answerJoinWith(99);
  const onUnreadChange = jest.fn();

  renderWithProviders(<ChatPanel leagueId={1} open={false} onUnreadChange={onUnreadChange} />);
  await screen.findByText('No messages yet');

  act(() => {
    socketHandlers['chat:message'](broadcast({ userId: 9, teamId: 22, message: 'not mine' }));
  });

  await waitFor(() => expect(onUnreadChange).toHaveBeenLastCalledWith(1));
});

test('opening the chat resets unread and moves the server-side read marker', async () => {
  mockGets({ unread: 5 });
  const onUnreadChange = jest.fn();

  const { rerender } = renderWithProviders(
    <ChatPanel leagueId={1} open={false} onUnreadChange={onUnreadChange} />
  );
  await waitFor(() => expect(onUnreadChange).toHaveBeenCalledWith(5));

  // ChatPanel needs no providers, so a bare rerender flips the drawer open.
  rerender(<ChatPanel leagueId={1} open onUnreadChange={onUnreadChange} />);

  await waitFor(() => expect(onUnreadChange).toHaveBeenLastCalledWith(0));
  expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/chat/read');
});

test('messages arriving while open are marked read on the server immediately', async () => {
  mockGets();

  renderWithProviders(<ChatPanel leagueId={4} open />);
  await screen.findByText('No messages yet');
  apiClient.post.mockClear(); // drop the mount-time mark-read

  act(() => {
    socketHandlers['chat:message'](broadcast({ leagueId: 4, message: 'seen live' }));
  });

  await screen.findByText('seen live');
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/4/chat/read'));
});

test('re-joins the league room and re-fetches chat history on reconnect', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<ChatPanel leagueId={7} />);
  await screen.findByText('No messages yet');

  mockSocket.emit.mockClear();
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue({
    data: [chatMessage({ id: 9, username: 'carl', message: 'missed while offline' })],
  });

  act(() => {
    reconnectHandlers.forEach((cb) => cb());
  });

  expect(mockSocket.emit).toHaveBeenCalledWith(
    'league:join',
    { leagueId: 7 },
    expect.any(Function)
  );
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/7/chat');
  expect(await screen.findByText('missed while offline')).toBeInTheDocument();
});
