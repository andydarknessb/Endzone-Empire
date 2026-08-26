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

// --------------------------------------------------------------------------
// #441: commissioner content moderation - tombstone + hide control
// --------------------------------------------------------------------------

test('a hidden message renders the neutral tombstone, never its content', () => {
  renderWithProviders(
    <ChatConversation
      messages={[message({ message: null, hidden: true, teamName: 'Anvils' })]}
      onSend={noop}
    />
  );
  expect(screen.getByText('Message hidden by commissioner')).toBeInTheDocument();
  // The original content is gone; only the tombstone shows.
  expect(screen.queryByText('hello there')).not.toBeInTheDocument();
});

test('a member sees no Hide control (canModerate defaults off)', () => {
  renderWithProviders(
    <ChatConversation messages={[message()]} onSend={noop} onHide={jest.fn()} />
  );
  expect(screen.queryByRole('button', { name: /Hide message/ })).not.toBeInTheDocument();
});

test('a commissioner hides a message: reason required, then onHide is called', async () => {
  const onHide = jest.fn().mockResolvedValue(true);
  renderWithProviders(
    <ChatConversation
      messages={[message({ id: 55, message: 'you are worthless', teamName: 'Anvils' })]}
      onSend={noop}
      canModerate
      onHide={onHide}
    />
  );

  await userEvent.click(screen.getByRole('button', { name: 'Hide message from Anvils' }));

  const confirm = screen.getByRole('button', { name: 'Confirm hide' });
  // A hide cannot be confirmed without a sufficient reason (AC2).
  expect(confirm).toBeDisabled();
  expect(onHide).not.toHaveBeenCalled();

  await userEvent.type(screen.getByLabelText('Reason for hiding'), 'targeted harassment');
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);

  expect(onHide).toHaveBeenCalledWith(55, 'targeted harassment');
});

test('a commissioner sees no Hide control on an already-hidden message', () => {
  renderWithProviders(
    <ChatConversation
      messages={[message({ id: 55, message: null, hidden: true, teamName: 'Anvils' })]}
      onSend={noop}
      canModerate
      onHide={jest.fn()}
    />
  );
  expect(screen.queryByRole('button', { name: /Hide message/ })).not.toBeInTheDocument();
  expect(screen.getByText('Message hidden by commissioner')).toBeInTheDocument();
});
