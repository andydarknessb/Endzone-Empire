import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import ChatPanel from './ChatPanel';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
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
});

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
