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

const chatMessage = (overrides = {}) => ({
  id: 1,
  user_id: 1,
  username: 'alice',
  message: 'hello there',
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

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

test('loads and renders chat history', async () => {
  apiClient.get.mockResolvedValue({ data: [chatMessage({ id: 1, username: 'alice', message: 'hi' })] });

  renderWithProviders(<ChatPanel leagueId={1} />);

  expect(await screen.findByText('hi')).toBeInTheDocument();
  expect(screen.getByText('alice')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat');
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
    socketHandlers['chat:message']({
      id: 2,
      leagueId: 1,
      userId: 2,
      username: 'bob',
      message: 'yo',
      created_at: '2026-01-01T12:05:00Z',
    });
  });

  expect(await screen.findByText('yo')).toBeInTheDocument();
  expect(screen.getByText('bob')).toBeInTheDocument();
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
  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 7 });

  unmount();
  expect(mockSocket.disconnect).toHaveBeenCalled();
});

test('while closed, unread starts from the server count and grows with others\' messages only', async () => {
  mockGets({ unread: 2 });
  const onUnreadChange = jest.fn();

  renderWithProviders(
    <ChatPanel leagueId={1} open={false} currentUserId={9} onUnreadChange={onUnreadChange} />
  );
  await screen.findByText('No messages yet');

  // Server-persisted count (survives reloads) seeds the badge.
  await waitFor(() => expect(onUnreadChange).toHaveBeenCalledWith(2));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat/unread');

  // Someone else's live message increments...
  act(() => {
    socketHandlers['chat:message']({
      id: 2, leagueId: 1, userId: 2, username: 'bob', message: 'yo', created_at: '2026-01-01T12:05:00Z',
    });
  });
  await waitFor(() => expect(onUnreadChange).toHaveBeenLastCalledWith(3));

  // ...but the user's own broadcast echo does not.
  act(() => {
    socketHandlers['chat:message']({
      id: 3, leagueId: 1, userId: 9, username: 'me', message: 'mine', created_at: '2026-01-01T12:06:00Z',
    });
  });
  await screen.findByText('mine');
  expect(onUnreadChange).toHaveBeenLastCalledWith(3);
  // Closed panel never touches the read marker.
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('opening the chat resets unread and moves the server-side read marker', async () => {
  mockGets({ unread: 5 });
  const onUnreadChange = jest.fn();

  const { rerender } = renderWithProviders(
    <ChatPanel leagueId={1} open={false} currentUserId={9} onUnreadChange={onUnreadChange} />
  );
  await waitFor(() => expect(onUnreadChange).toHaveBeenCalledWith(5));

  // ChatPanel needs no providers, so a bare rerender flips the drawer open.
  rerender(<ChatPanel leagueId={1} open currentUserId={9} onUnreadChange={onUnreadChange} />);

  await waitFor(() => expect(onUnreadChange).toHaveBeenLastCalledWith(0));
  expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/chat/read');
});

test('messages arriving while open are marked read on the server immediately', async () => {
  mockGets();

  renderWithProviders(<ChatPanel leagueId={4} open currentUserId={9} />);
  await screen.findByText('No messages yet');
  apiClient.post.mockClear(); // drop the mount-time mark-read

  act(() => {
    socketHandlers['chat:message']({
      id: 2, leagueId: 4, userId: 2, username: 'bob', message: 'seen live', created_at: '2026-01-01T12:05:00Z',
    });
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

  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 7 });
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/7/chat');
  expect(await screen.findByText('missed while offline')).toBeInTheDocument();
});
