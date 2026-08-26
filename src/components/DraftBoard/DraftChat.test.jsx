import React from 'react';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import DraftChat from './DraftChat';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

// The draft room hands DraftChat the session it already owns. This fake stands
// in for that session: it records `.on` handlers, has a real `.off` for
// listener cleanup, and deliberately no `.disconnect` - ending the session is
// the draft room's job, never the chat's.
function makeSharedSocket() {
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

const chatMessage = (overrides = {}) => ({
  id: 1,
  username: 'alice',
  teamId: 11,
  teamName: 'Anvils',
  message: 'hello there',
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

let socket;

beforeEach(() => {
  socket = makeSharedSocket();
  onReconnect.mockReturnValue(() => {});
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows existing League-chat history, attributed by Team', async () => {
  apiClient.get.mockResolvedValue({ data: [chatMessage({ message: 'welcome', teamName: 'Anvils', username: 'alice' })] });

  renderWithProviders(<DraftChat socket={socket} leagueId={3} viewerTeamId={11} />);

  expect(await screen.findByText('welcome')).toBeInTheDocument();
  expect(screen.getByText('Anvils')).toBeInTheDocument();
  expect(screen.queryByText('alice')).not.toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/3/chat');
});

test('appends a message broadcast over the shared draft session', async () => {
  renderWithProviders(<DraftChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await screen.findByText('No messages yet');

  act(() => socket.trigger('chat:message', chatMessage({ id: 2, teamName: 'Bulldogs', message: 'good luck all' })));

  expect(await screen.findByText('good luck all')).toBeInTheDocument();
  expect(screen.getByText('Bulldogs')).toBeInTheDocument();
});

test('sends over the shared session and never opens a second connection', async () => {
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true });
  });

  renderWithProviders(<DraftChat socket={socket} leagueId={7} viewerTeamId={11} />);
  await screen.findByText('No messages yet');

  await userEvent.type(screen.getByLabelText('Message'), 'from the draft room');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() =>
    expect(socket.emit).toHaveBeenCalledWith(
      'chat:send',
      { leagueId: 7, message: 'from the draft room' },
      expect.any(Function)
    )
  );
  // The whole point of #433 (acceptance criterion 3): chat rides the draft's
  // one authenticated session, so it must not mint its own.
  expect(createDraftSocket).not.toHaveBeenCalled();
});

test('takes back its own listener on unmount and never ends the shared session', async () => {
  const { unmount } = renderWithProviders(<DraftChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  unmount();

  expect(socket.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
  expect(socket).not.toHaveProperty('disconnect');
});

test('renders nothing that throws before the session exists', async () => {
  // The draft room hands a null socket until draft:join has landed; the chat
  // must render its history and wait, not crash.
  renderWithProviders(<DraftChat socket={null} leagueId={3} viewerTeamId={null} />);
  expect(await screen.findByText('No messages yet')).toBeInTheDocument();
});
