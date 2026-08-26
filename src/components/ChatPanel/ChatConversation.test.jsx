import React from 'react';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import ChatConversation from './ChatConversation';

// jsdom computes no layout, so scroll geometry is faked on the element instance:
// scrollHeight/clientHeight are read-only getters we override, scrollTop is a
// plain settable property. This lets a test place the reader at the bottom or
// up in the backlog and fire a scroll, the only signals the anchoring reads.
function setScrollMetrics(el, { scrollHeight, clientHeight, scrollTop }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  el.scrollTop = scrollTop;
}
const atTop = (el, over = {}) => setScrollMetrics(el, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0, ...over });
const atBottom = (el, over = {}) => setScrollMetrics(el, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700, ...over });

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

// Composer drafts live in sessionStorage; reset it so each test starts clean.
afterEach(() => window.sessionStorage.clear());

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

// #442 AC1/AC2: the live feed auto-follows only while the reader is at the
// bottom; a reader up in the backlog keeps their place and gets an N-new
// affordance to return to the newest entries.
const seqMsg = (over = {}) => message({ id: over.id ?? 1, seq: over.seq ?? 1, ...over });

// A harness that owns the feed as state, so the ChatConversation instance (and
// its scroll refs) SURVIVE a feed change. Driving new entries through
// setMessages models a live append or prepend far better than re-rendering a
// bare element, which would remount the component and reset its anchoring.
let feedSetter;
function LiveFeed({ initial }) {
  const [messages, setMessages] = React.useState(initial);
  feedSetter = setMessages;
  return <ChatConversation messages={messages} onSend={noop} />;
}
const setFeed = (messages) => act(() => feedSetter(messages));

test('a reader up in the backlog keeps position and gets an N-new affordance when new entries arrive', () => {
  renderWithProviders(<LiveFeed initial={[seqMsg({ id: 1, seq: 1, message: 'first' })]} />);
  const box = screen.getByTestId('chat-scroll');

  // The reader scrolls up into older content.
  atTop(box);
  fireEvent.scroll(box);

  // Two new entries arrive at the bottom while they read.
  setFeed([
    seqMsg({ id: 1, seq: 1, message: 'first' }),
    seqMsg({ id: 2, seq: 2, message: 'second' }),
    seqMsg({ id: 3, seq: 3, message: 'third' }),
  ]);

  // Position is not yanked to the bottom...
  expect(box.scrollTop).toBe(0);
  // ...and an affordance names how many are new.
  expect(screen.getByRole('button', { name: /2 new/i })).toBeInTheDocument();
});

test('the N-new affordance jumps to the newest entries and clears', () => {
  renderWithProviders(<LiveFeed initial={[seqMsg({ id: 1, seq: 1, message: 'first' })]} />);
  const box = screen.getByTestId('chat-scroll');
  atTop(box);
  fireEvent.scroll(box);
  setFeed([seqMsg({ id: 1, seq: 1 }), seqMsg({ id: 2, seq: 2, message: 'second' })]);

  const jump = screen.getByRole('button', { name: /1 new/i });
  fireEvent.click(jump);

  // Jumped to the bottom (scrollTop driven to the full scroll height)...
  expect(box.scrollTop).toBe(1000);
  // ...and the affordance is gone.
  expect(screen.queryByRole('button', { name: /new/i })).not.toBeInTheDocument();
});

test('the feed auto-follows a new entry while the reader is already at the bottom', () => {
  renderWithProviders(<LiveFeed initial={[seqMsg({ id: 1, seq: 1, message: 'first' })]} />);
  const box = screen.getByTestId('chat-scroll');
  atBottom(box);
  fireEvent.scroll(box);

  setFeed([seqMsg({ id: 1, seq: 1 }), seqMsg({ id: 2, seq: 2, message: 'second' })]);

  // Followed to the bottom, and no catch-up affordance is offered.
  expect(box.scrollTop).toBe(1000);
  expect(screen.queryByRole('button', { name: /new/i })).not.toBeInTheDocument();
});

test('loading older entries does not disturb position or raise an N-new affordance', () => {
  renderWithProviders(
    <LiveFeed initial={[seqMsg({ id: 2, seq: 2, message: 'second' }), seqMsg({ id: 3, seq: 3, message: 'third' })]} />
  );
  const box = screen.getByTestId('chat-scroll');
  atTop(box);
  fireEvent.scroll(box);

  // An older page is prepended at the head (lower seq), the shape loadOlder produces.
  setFeed([
    seqMsg({ id: 1, seq: 1, message: 'zeroth' }),
    seqMsg({ id: 2, seq: 2, message: 'second' }),
    seqMsg({ id: 3, seq: 3, message: 'third' }),
  ]);

  expect(box.scrollTop).toBe(0);
  expect(screen.queryByRole('button', { name: /new/i })).not.toBeInTheDocument();
});

// #442 AC5/AC6: unsent composer text is preserved per league for the current
// browser session, and cleared on a successful send, logout or account change.
test('preserves unsent text per league for the browser session, and restores it', async () => {
  const { unmount } = renderWithProviders(
    <ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />
  );
  await userEvent.type(screen.getByLabelText('Message'), 'half a thought');

  // The draft is held for this league, keyed so another league cannot read it.
  unmount();
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />);
  expect(screen.getByLabelText('Message')).toHaveValue('half a thought');
});

test('a draft does not leak into a different league', async () => {
  const { unmount } = renderWithProviders(
    <ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />
  );
  await userEvent.type(screen.getByLabelText('Message'), 'league five only');
  unmount();

  renderWithProviders(<ChatConversation messages={[]} onSend={noop} leagueId={6} viewerUserId={7} />);
  expect(screen.getByLabelText('Message')).toHaveValue('');
});

test('a successful send clears the preserved draft', async () => {
  const onSend = jest.fn().mockResolvedValue(true);
  const { unmount } = renderWithProviders(
    <ChatConversation messages={[]} onSend={onSend} leagueId={5} viewerUserId={7} />
  );
  await userEvent.type(screen.getByLabelText('Message'), 'ship it');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));

  // Nothing is left in the session to restore on the next visit.
  unmount();
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />);
  expect(screen.getByLabelText('Message')).toHaveValue('');
});

test('logging out clears the preserved draft', async () => {
  const { unmount } = renderWithProviders(
    <ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />
  );
  await userEvent.type(screen.getByLabelText('Message'), 'private thought');
  unmount();

  // Logged out: no account. The draft must not survive to the logged-out view...
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={null} />);
  expect(screen.getByLabelText('Message')).toHaveValue('');

  // ...nor be waiting for whoever logs in next.
  unmount();
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={8} />);
  expect(screen.getByLabelText('Message')).toHaveValue('');
});

test('a different account does not inherit the previous account\'s draft', async () => {
  const { unmount } = renderWithProviders(
    <ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />
  );
  await userEvent.type(screen.getByLabelText('Message'), 'account seven note');
  unmount();

  renderWithProviders(<ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={8} />);
  expect(screen.getByLabelText('Message')).toHaveValue('');
});
