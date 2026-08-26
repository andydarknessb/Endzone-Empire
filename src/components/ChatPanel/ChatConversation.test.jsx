import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import ChatConversation from './ChatConversation';

const message = (overrides = {}) => ({
  id: 1,
  username: 'alice',
  teamId: 11,
  teamName: 'Anvils',
  message: 'hello there',
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

const noop = () => Promise.resolve(true);

test('renders each message attributed to its Team, never its account', () => {
  renderWithProviders(
    <ChatConversation messages={[message({ message: 'hi', username: 'alice', teamName: 'Anvils' })]} onSend={noop} />
  );

  expect(screen.getByText('hi')).toBeInTheDocument();
  expect(screen.getByText('Anvils')).toBeInTheDocument();
  expect(screen.queryByText('alice')).not.toBeInTheDocument();
});

test('a departed author reads back as a former manager, not blank or "null"', () => {
  renderWithProviders(
    <ChatConversation messages={[message({ teamId: null, teamName: null, username: 'ghost', message: 'so long' })]} onSend={noop} />
  );

  expect(screen.getByText('so long')).toBeInTheDocument();
  expect(screen.getByText('Former manager')).toBeInTheDocument();
  expect(screen.queryByText('null')).not.toBeInTheDocument();
});

test('shows an empty state when there are no messages', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  expect(screen.getByText('No messages yet')).toBeInTheDocument();
});

test('the title is a level-2 heading naming the conversation, in its own region', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  expect(screen.getByRole('heading', { level: 2, name: 'League Chat' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'League Chat' })).toBeInTheDocument();
});

test('Send is disabled while the input is empty', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('sending trims the text, calls onSend, and clears the input on success', async () => {
  const onSend = jest.fn().mockResolvedValue(true);
  renderWithProviders(<ChatConversation messages={[]} onSend={onSend} />);

  const input = screen.getByLabelText('Message');
  await userEvent.type(input, '  hey team  ');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => expect(onSend).toHaveBeenCalledWith('hey team', expect.any(String)));
  expect(input).toHaveValue('');
});

test('a retry of the same text reuses the idempotency key; editing mints a new one', async () => {
  const onSend = jest.fn().mockResolvedValue(false); // fail so the text stays to retry
  renderWithProviders(<ChatConversation messages={[]} onSend={onSend} />);
  const input = screen.getByLabelText('Message');
  const send = () => userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await userEvent.type(input, 'same text');
  await send();
  await send(); // retry the identical text
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
  const [firstKey, retryKey] = onSend.mock.calls.map(([, key]) => key);
  expect(retryKey).toBe(firstKey); // a retry of the same message reuses the key

  await userEvent.type(input, ' now edited');
  await send();
  const editedKey = onSend.mock.calls[2][1];
  expect(editedKey).not.toBe(firstKey); // a different message gets a different key
});

test('a successful send starts the next message with a fresh key', async () => {
  const onSend = jest.fn().mockResolvedValue(true);
  renderWithProviders(<ChatConversation messages={[]} onSend={onSend} />);
  const input = screen.getByLabelText('Message');
  const send = () => userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await userEvent.type(input, 'first');
  await send();
  await waitFor(() => expect(input).toHaveValue(''));
  await userEvent.type(input, 'first'); // same text, but a new logical message
  await send();

  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
  const [k1, k2] = onSend.mock.calls.map(([, key]) => key);
  expect(k2).not.toBe(k1);
});

test('a failed send keeps the text so the manager can retry', async () => {
  const onSend = jest.fn().mockResolvedValue(false);
  renderWithProviders(<ChatConversation messages={[]} onSend={onSend} />);

  const input = screen.getByLabelText('Message');
  await userEvent.type(input, 'retry me');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => expect(onSend).toHaveBeenCalled());
  expect(input).toHaveValue('retry me');
});

test('Enter sends without adding a newline', async () => {
  const onSend = jest.fn().mockResolvedValue(true);
  renderWithProviders(<ChatConversation messages={[]} onSend={onSend} />);

  await userEvent.type(screen.getByLabelText('Message'), 'quick one{Enter}');
  await waitFor(() => expect(onSend).toHaveBeenCalledWith('quick one', expect.any(String)));
});

test('renders the send error passed to it', () => {
  renderWithProviders(<ChatConversation messages={[]} error="message rejected" onSend={noop} />);
  expect(screen.getByText('message rejected')).toBeInTheDocument();
});

test('offers Load older messages only when there is more to page back to', () => {
  const { rerender } = renderWithProviders(
    <ChatConversation messages={[message()]} onSend={noop} hasMore onLoadOlder={() => {}} />
  );
  expect(screen.getByRole('button', { name: 'Load older messages' })).toBeInTheDocument();

  rerender(<ChatConversation messages={[message()]} onSend={noop} hasMore={false} onLoadOlder={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Load older messages' })).not.toBeInTheDocument();
});

test('Load older messages calls onLoadOlder', async () => {
  const onLoadOlder = jest.fn();
  renderWithProviders(
    <ChatConversation messages={[message()]} onSend={noop} hasMore onLoadOlder={onLoadOlder} />
  );

  await userEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
  expect(onLoadOlder).toHaveBeenCalled();
});

// #435: the combined Draft-room feed renders Draft activity beside chat. A Pick
// entry (type draft_activity) reads as an event line, not a chat bubble.
const pickActivity = (overrides = {}) => ({
  type: 'draft_activity',
  kind: 'pick',
  id: 1,
  seq: 6,
  teamId: 12,
  teamName: 'Bulldogs',
  player: { id: 500, name: 'Pat Mahomes', position: 'QB', nflTeam: 'KC' },
  round: 2,
  pickNumber: 15,
  isAutopick: false,
  created_at: '2026-01-01T12:05:00Z',
  ...overrides,
});

test('renders a Pick as Draft activity with its snapshot facts, attributed by Team', () => {
  renderWithProviders(<ChatConversation messages={[pickActivity()]} onSend={noop} />);

  const line = screen.getByTestId('draft-activity');
  expect(line).toHaveTextContent('Bulldogs');
  expect(line).toHaveTextContent('Pat Mahomes');
  expect(line).toHaveTextContent('QB');
  expect(line).toHaveTextContent('KC');
  expect(line).toHaveTextContent('Round 2');
  expect(line).toHaveTextContent('Pick 15');
  // A manual pick carries no AUTO label.
  expect(screen.queryByText('AUTO')).not.toBeInTheDocument();
});

test('labels an autopick AUTO', () => {
  renderWithProviders(<ChatConversation messages={[pickActivity({ isAutopick: true })]} onSend={noop} />);
  expect(screen.getByText('AUTO')).toBeInTheDocument();
});

test('a departed Team on a Pick activity reads as a former manager', () => {
  renderWithProviders(<ChatConversation messages={[pickActivity({ teamName: null })]} onSend={noop} />);
  expect(screen.getByText('Former manager')).toBeInTheDocument();
  expect(screen.queryByText('null')).not.toBeInTheDocument();
});

// #437: the rest of the Draft lifecycle renders as event lines too - a start,
// pause, resume, reset or completion - attributed to the acting commissioner's
// Team, or phrased without an actor when there is none (a scheduler start, a
// completion transition). A lifecycle entry has no player / round / Pick number.
const lifecycle = (kind, overrides = {}) => ({
  type: 'draft_activity',
  kind,
  id: 20,
  seq: 3,
  teamId: 30,
  teamName: 'Commish FC',
  created_at: '2026-01-01T12:10:00Z',
  ...overrides,
});

test('renders a draft_start as an event line attributed to the acting Team, with no Pick facts', () => {
  renderWithProviders(<ChatConversation messages={[lifecycle('draft_start')]} onSend={noop} />);
  const line = screen.getByTestId('draft-activity');
  expect(line).toHaveTextContent('Commish FC');
  expect(line).toHaveTextContent('started the draft');
  // A lifecycle event never renders phantom Pick facts.
  expect(line).not.toHaveTextContent('Round');
  expect(line).not.toHaveTextContent('Pick ');
  expect(line).not.toHaveTextContent('undefined');
  expect(line).not.toHaveTextContent('null');
});

test('renders pause, resume and reset attributed to the acting Team', () => {
  const { rerender } = renderWithProviders(<ChatConversation messages={[lifecycle('pause')]} onSend={noop} />);
  expect(screen.getByTestId('draft-activity')).toHaveTextContent('paused the draft');
  rerender(<ChatConversation messages={[lifecycle('resume')]} onSend={noop} />);
  expect(screen.getByTestId('draft-activity')).toHaveTextContent('resumed the draft');
  rerender(<ChatConversation messages={[lifecycle('reset')]} onSend={noop} />);
  expect(screen.getByTestId('draft-activity')).toHaveTextContent('reset the draft');
});

test('an actor-less lifecycle event (scheduler start / completion) is phrased without a Team, never "Former manager"', () => {
  renderWithProviders(
    <ChatConversation messages={[lifecycle('complete', { teamId: null, teamName: null })]} onSend={noop} />
  );
  const line = screen.getByTestId('draft-activity');
  expect(line).toHaveTextContent('The draft is complete');
  expect(line).not.toHaveTextContent('Former manager');
  expect(line).not.toHaveTextContent('null');
});
