import React from 'react';
import { screen, waitFor, fireEvent, act, within } from '@testing-library/react';
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

test('the feed is a named accessible log, named by the visible heading (#445 AC1)', () => {
  renderWithProviders(<ChatConversation messages={[message({ message: 'hi' })]} onSend={noop} />);
  const log = screen.getByRole('log', { name: 'League Chat' });
  expect(log).toBe(screen.getByTestId('chat-scroll'));
  // Announcement is delegated to the concise FeedAnnouncer (#445 AC2), so the
  // log itself does not auto-read every entry: aria-live is off, not polite.
  expect(log).toHaveAttribute('aria-live', 'off');
});

test('the composer is a named group (#445 AC1)', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  const composer = screen.getByRole('group', { name: 'Chat composer' });
  // Its three controls read as one labelled unit.
  expect(within(composer).getByLabelText('Message')).toBeInTheDocument();
  expect(within(composer).getByRole('button', { name: 'Insert emoji' })).toBeInTheDocument();
  expect(within(composer).getByRole('button', { name: 'Send' })).toBeInTheDocument();
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

test('opening the hide form moves focus to the reason field; cancelling returns it to Hide (#445 AC4)', async () => {
  renderWithProviders(
    <ChatConversation
      messages={[message({ id: 55, message: 'be nice', teamName: 'Anvils' })]}
      onSend={noop}
      canModerate
      onHide={jest.fn().mockResolvedValue(true)}
    />
  );

  const hideButton = screen.getByRole('button', { name: 'Hide message from Anvils' });
  await userEvent.click(hideButton);

  // Focus lands in the reason field, not on the document body.
  expect(screen.getByLabelText('Reason for hiding')).toHaveFocus();

  // Cancelling returns focus to the Hide button that opened the form.
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Hide message from Anvils' })).toHaveFocus();
});

test('a committed hide returns focus to the feed log, not the document body (#445 AC4)', async () => {
  // The regression: after a committed hide the Hide button is removed, so
  // returning focus to it strands focus on the body. Focus must land in the feed
  // log (which holds the now-tombstoned message), never on the body.
  const onHide = jest.fn().mockResolvedValue(true);
  const msg = message({ id: 55, message: 'you are worthless', teamName: 'Anvils' });
  const { rerender } = renderWithProviders(
    <ChatConversation messages={[msg]} onSend={noop} canModerate onHide={onHide} />
  );

  await userEvent.click(screen.getByRole('button', { name: 'Hide message from Anvils' }));
  await userEvent.type(screen.getByLabelText('Reason for hiding'), 'targeted harassment');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm hide' }));

  // A committed hide moves focus into the feed log, never the document body
  // (the regression). waitFor lets confirmHide's async path settle - onHide is
  // called before its await resolves, so waiting on the call alone would race the
  // focus move. (The full broadcast path - the chat:hidden event removing the
  // Hide button while focus is held - is driven in a real browser in
  // draft-accessibility.spec.ts, where focus preservation across a re-render is
  // faithful; jsdom's rerender does not model it.)
  const log = screen.getByRole('log', { name: 'League Chat' });
  await waitFor(() => expect(log).toHaveFocus());
  expect(onHide).toHaveBeenCalledWith(55, 'targeted harassment');
  expect(document.body).not.toHaveFocus();

  // The message still shows the hide affordance is gone once the parent supplies
  // the tombstone; the focus is what this test pins.
  rerender(
    <ChatConversation
      messages={[{ ...msg, message: null, hidden: true }]}
      onSend={noop}
      canModerate
      onHide={onHide}
    />
  );
  expect(screen.queryByRole('button', { name: /Hide message/ })).not.toBeInTheDocument();
  expect(screen.getByText('Message hidden by commissioner')).toBeInTheDocument();
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

test('the N-new jump moves focus into the log, so a keyboard user lands on live content (#445 AC4)', () => {
  renderWithProviders(<LiveFeed initial={[seqMsg({ id: 1, seq: 1, message: 'first' })]} />);
  const box = screen.getByTestId('chat-scroll');
  atTop(box);
  fireEvent.scroll(box);
  setFeed([seqMsg({ id: 1, seq: 1 }), seqMsg({ id: 2, seq: 2, message: 'second' })]);

  fireEvent.click(screen.getByRole('button', { name: /1 new/i }));

  // Focus is now on the log region (the button that had focus has vanished).
  expect(box).toHaveFocus();
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

test('loading older entries holds the reader position by absorbing the added height, and raises no N-new affordance', () => {
  renderWithProviders(
    <LiveFeed initial={[seqMsg({ id: 2, seq: 2, message: 'second' }), seqMsg({ id: 3, seq: 3, message: 'third' })]} />
  );
  const box = screen.getByTestId('chat-scroll');
  // Reading partway up the backlog: a mutable scrollHeight lets the prepend
  // "grow" the content above the viewport the way a real older page would.
  let height = 1000;
  Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 300 });
  box.scrollTop = 120;
  fireEvent.scroll(box);

  // An older page is prepended at the head (lower seq), the shape loadOlder
  // produces, adding 300px of content above the reader.
  height = 1300;
  setFeed([
    seqMsg({ id: 1, seq: 1, message: 'zeroth' }),
    seqMsg({ id: 2, seq: 2, message: 'second' }),
    seqMsg({ id: 3, seq: 3, message: 'third' }),
  ]);

  // The reader's content stays put: scrollTop advanced by exactly what was added.
  expect(box.scrollTop).toBe(420);
  // Nothing arrived at the bottom, so no catch-up affordance.
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

// #443: the composer carries an accessible emoji picker. A chosen emoji is
// inserted as ordinary Unicode at the caret and then rides the existing text
// path - it is never a separate message type, never sends on its own, and is
// preserved and sent exactly as typed text is.
const THUMBS_UP = '\u{1F44D}';

async function pickEmoji(name = 'thumbs up') {
  await userEvent.click(screen.getByRole('button', { name: 'Insert emoji' }));
  await userEvent.click(await screen.findByRole('menuitem', { name }));
}

test('inserts a chosen emoji at the caret, not just at the end, and returns focus to the composer', async () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  const input = screen.getByLabelText('Message');

  await userEvent.type(input, 'ab');
  // Place the caret between the two characters.
  input.setSelectionRange(1, 1);

  await pickEmoji();

  // The emoji lands at the caret: a, then the emoji, then b.
  await waitFor(() => expect(input).toHaveValue(`a${THUMBS_UP}b`));
  // Predictable focus return: the manager can keep typing straight away.
  await waitFor(() => expect(input).toHaveFocus());
  // The caret sits after the inserted emoji, ready for the next keystroke.
  expect(input.selectionStart).toBe(1 + THUMBS_UP.length);
});

test('choosing an emoji does not send the message', async () => {
  const onSend = jest.fn().mockResolvedValue(true);
  renderWithProviders(<ChatConversation messages={[]} onSend={onSend} />);

  await userEvent.type(screen.getByLabelText('Message'), 'nice pick');
  await pickEmoji();

  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(`nice pick${THUMBS_UP}`));
  // Inserting an emoji is composing, not sending.
  expect(onSend).not.toHaveBeenCalled();
});

test('an emoji is sent as ordinary text and clears on success', async () => {
  const onSend = jest.fn().mockResolvedValue(true);
  renderWithProviders(<ChatConversation messages={[]} onSend={onSend} />);
  const input = screen.getByLabelText('Message');

  await userEvent.type(input, 'gg');
  await pickEmoji();
  await waitFor(() => expect(input).toHaveValue(`gg${THUMBS_UP}`));
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => expect(onSend).toHaveBeenCalledWith(`gg${THUMBS_UP}`, expect.any(String)));
  expect(input).toHaveValue('');
});

test('an emoji in a feed message renders as ordinary text in history', () => {
  // A sent emoji is just Unicode in the message string, so it reads back in the
  // scrollback with no special handling (#443: emoji is portable text).
  renderWithProviders(
    <ChatConversation messages={[message({ message: `great pick ${THUMBS_UP}` })]} onSend={noop} />
  );
  expect(screen.getByText(`great pick ${THUMBS_UP}`)).toBeInTheDocument();
});

test('an emoji-bearing draft is preserved per league across a remount, like any text', async () => {
  const { unmount } = renderWithProviders(
    <ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />
  );
  const input = screen.getByLabelText('Message');
  await userEvent.type(input, 'later ');
  await pickEmoji();
  await waitFor(() => expect(input).toHaveValue(`later ${THUMBS_UP}`));

  // The emoji rides the preserved draft string for free (#442 AC5): it is just
  // Unicode text, so it survives the same tab-change / reconnect preservation.
  unmount();
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} leagueId={5} viewerUserId={7} />);
  expect(screen.getByLabelText('Message')).toHaveValue(`later ${THUMBS_UP}`);
});

// #486: the composer's character counter. It counts Unicode code points, the
// unit the server's limit and the varchar(500) column count, shows the live count
// against the limit, blocks nothing over the limit, and announces at thresholds
// only. Set the input value directly (fireEvent.change) so a case can jump to a
// precise code-point count without typing hundreds of keystrokes.
const setComposer = (value) =>
  fireEvent.change(screen.getByLabelText('Message'), { target: { value } });
const countText = () => screen.getByTestId('composer-char-count').textContent;
const statusText = () => screen.getByRole('status').textContent;

test('the counter reads the code-point count against the limit at 499, 500 and 501', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  setComposer('a'.repeat(499));
  expect(countText()).toBe('499 / 500');
  setComposer('a'.repeat(500));
  expect(countText()).toBe('500 / 500');
  setComposer('a'.repeat(501));
  expect(countText()).toBe('501 / 500');
});

test('a ZWJ family emoji counts as its code points, not 1 and not its UTF-16 length', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  // 👨‍👩‍👧‍👦 is four people joined by three ZWJs: 7 code points, one grapheme,
  // 11 UTF-16 code units. The count is 7; switching the helper to text.length
  // (which would read 11) turns this red, and 1 (a grapheme count) also fails.
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
  expect(family.length).toBe(11); // guards the premise: code units disagree
  setComposer(family);
  expect(countText()).toBe('7 / 500');
});

test('an emoji inserted through the picker counts the same as typing that emoji', async () => {
  const { unmount } = renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  await pickEmoji();
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(THUMBS_UP));
  const viaPicker = countText();
  unmount();

  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  setComposer(THUMBS_UP);
  expect(countText()).toBe(viaPicker);
  expect(countText()).toBe('1 / 500'); // one code point, though it is two UTF-16 units
});

test('the status region announces by band: silent above the warning, then at the warning, then at the limit', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);

  // Well above the warning threshold (50 remaining): two consecutive keystrokes
  // leave the status text identical, so a screen reader announces nothing.
  setComposer('a'.repeat(5));
  const quietA = statusText();
  setComposer('a'.repeat(6));
  const quietB = statusText();
  expect(quietB).toBe(quietA);
  expect(quietA).toBe('');

  // Crossing to at-or-below the warning threshold changes the text once.
  setComposer('a'.repeat(450)); // 50 remaining
  const warn = statusText();
  expect(warn).not.toBe(quietB);
  expect(warn).not.toBe('');
  // Another keystroke still inside the warning band does NOT change it again.
  setComposer('a'.repeat(470)); // 30 remaining
  expect(statusText()).toBe(warn);

  // Reaching the limit changes the text again.
  setComposer('a'.repeat(500)); // 0 remaining
  const atLimit = statusText();
  expect(atLimit).not.toBe(warn);
  expect(atLimit).not.toBe('');
  // Going further over the limit stays in the same band, so no re-announcement.
  setComposer('a'.repeat(512));
  expect(statusText()).toBe(atLimit);
});

test('the input is described by the visible counter and sets no maxLength', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  const input = screen.getByLabelText('Message');
  const describedById = input.getAttribute('aria-describedby');

  // The describedby target exists and contains the visible glyph, so the count
  // the manager sees is what a screen reader hears on focus.
  expect(describedById).toBeTruthy();
  const described = document.getElementById(describedById);
  expect(described).not.toBeNull();
  expect(described).toContainElement(screen.getByTestId('composer-char-count'));
  expect(input).not.toHaveAttribute('maxlength');
});

test('the counter description names the unit, so it does not read as a bare "N slash 500"', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  const input = screen.getByLabelText('Message');
  // Assert the ACCESSIBLE DESCRIPTION the input actually resolves - the text
  // content of its aria-describedby target - not a raw attribute that a browser
  // might prune. The visible glyph stays terse; the described text names the unit.
  const described = document.getElementById(input.getAttribute('aria-describedby'));
  expect(described).not.toBeNull();
  expect(screen.getByTestId('composer-char-count')).toHaveTextContent('0 / 500');
  expect(described.textContent.replace(/\s+/g, ' ').trim()).toBe('0 / 500 characters');
});

test('a click on the counter falls through to focus the input, not a dead strip', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  const indicator = screen.getByTestId('composer-char-count');
  // The counter rides in the input as an end adornment; disablePointerEvents lets
  // a click there reach the input and place the caret rather than being eaten by
  // the adornment. jsdom does no hit-testing, so pin the mechanism: the adornment
  // wrapper carries MUI's disablePointerEvents class.
  const adornment = indicator.closest('.MuiInputAdornment-root');
  expect(adornment).not.toBeNull();
  expect(adornment.className).toMatch(/disablePointerEvents/);
});

test('Send stays enabled past the limit: the server is the single enforcement point', () => {
  renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
  setComposer('a'.repeat(501));
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(countText()).toBe('501 / 500');
});

// ---------------------------------------------------------------------------
// #446: GIF messages render as their own bubble, and the picker is gated on the
// capability. The bubble and picker behaviour are proven in isolation in
// GifMessage/GifComposer tests; these prove the WIRING through ChatConversation.
// ---------------------------------------------------------------------------
describe('ChatConversation - GIF messages (#446)', () => {
  // eslint-disable-next-line global-require
  const { registerGifProvider, clearGifProviders } = require('../../lib/gifProvider');
  // eslint-disable-next-line global-require
  const { FAKE_PROVIDER_ID, fakeGifResolver } = require('../../lib/gifProviderFake');

  beforeEach(() => {
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: false, media: query, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    }));
  });
  afterEach(() => clearGifProviders());

  const gifMessage = (over = {}) => message({
    id: 42,
    message: 'this is me at 3pm',
    media: { provider: FAKE_PROVIDER_ID, assetId: 'abc123', description: 'a cat knocking a cup off a table' },
    ...over,
  });

  test('a GIF message with no provider renders the unavailable tile, preserving caption and description (AC5)', () => {
    renderWithProviders(<ChatConversation messages={[gifMessage()]} onSend={noop} />);
    expect(screen.getByTestId('gif-unavailable')).toBeInTheDocument();
    expect(screen.getByText('a cat knocking a cup off a table')).toBeInTheDocument();
    expect(screen.getByText('this is me at 3pm')).toBeInTheDocument();
  });

  test('a GIF message with a registered provider renders the animation (AC8)', () => {
    registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
    renderWithProviders(<ChatConversation messages={[gifMessage()]} onSend={noop} />);
    expect(screen.getByTestId('gif-animated').getAttribute('src')).toContain('abc123');
  });

  test('a HIDDEN GIF shows the tombstone, never the media (moderation)', () => {
    registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
    // A hidden entry arrives with media suppressed to null by the server; assert
    // the client renders the tombstone and nothing GIF-shaped.
    renderWithProviders(<ChatConversation messages={[gifMessage({ hidden: true, media: null, message: null })]} onSend={noop} />);
    expect(screen.getByText(/hidden by commissioner/i)).toBeInTheDocument();
    expect(screen.queryByTestId('gif-message')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gif-unavailable')).not.toBeInTheDocument();
  });

  test('the GIF picker is absent unless gifEnabled, and present when it is (AC7, one query both ways)', () => {
    const { rerender } = renderWithProviders(<ChatConversation messages={[]} onSend={noop} />);
    expect(screen.queryByTestId('gif-picker-trigger')).not.toBeInTheDocument();
    rerender(<ChatConversation messages={[]} onSend={noop} gifEnabled onSendGif={noop} />);
    expect(screen.getByTestId('gif-picker-trigger')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// #524: an unsent GIF composition is preserved across an unmount, on the same
// per-league, account-stamped scope and clearing rules as the text draft.
// These are the RESTORE-MECHANISM tests, driven through ChatConversation (the
// component the room and the dashboard both mount). The Draft-room test that
// crosses the real narrow-tab / breakpoint trigger lives in DraftBoard.test.jsx.
// Every existing composer test above lives inside a SINGLE mount and is
// structurally blind to a state-loss-on-unmount defect; these mount, fill,
// unmount and remount.
// ---------------------------------------------------------------------------
describe('ChatConversation - GIF composition persistence (#524)', () => {
  // eslint-disable-next-line global-require
  const { registerGifProvider, clearGifProviders } = require('../../lib/gifProvider');
  // eslint-disable-next-line global-require
  const { FAKE_PROVIDER_ID, fakeGifResolver } = require('../../lib/gifProviderFake');

  beforeEach(() => {
    registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: false, media: query, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    }));
  });
  afterEach(() => clearGifProviders());

  // Open the picker and fill the composition. Leaves the panel open.
  const fillGif = async ({ assetId = 'abc123', description = 'a cat knocking a cup', caption } = {}) => {
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    if (assetId) await userEvent.type(screen.getByLabelText('GIF asset id'), assetId);
    if (description) await userEvent.type(screen.getByLabelText(/description/i), description);
    if (caption) await userEvent.type(screen.getByLabelText(/caption/i), caption);
  };

  test('restores BOTH the message text and the GIF composition on remount (AC1, the load-bearing test)', async () => {
    const { unmount } = renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );
    await userEvent.type(screen.getByLabelText('Message'), 'and also this gif');
    await fillGif({ assetId: 'abc123', description: 'a cat knocking a cup', caption: 'me at 3pm' });

    // The everyday trigger: the chat subtree unmounts (a narrow tab switch) and
    // comes back for the same league and account.
    unmount();
    renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );

    // The message text is back...
    expect(screen.getByLabelText('Message')).toHaveValue('and also this gif');
    // ...and so is the whole GIF composition, with the panel already open because
    // the stored composition is non-empty (no click needed to reveal the fields).
    expect(screen.getByTestId('gif-picker-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('GIF asset id')).toHaveValue('abc123');
    expect(screen.getByLabelText(/description/i)).toHaveValue('a cat knocking a cup');
    expect(screen.getByLabelText(/caption/i)).toHaveValue('me at 3pm');
  });

  test('a restored composition does not come back already showing a validation error (touched flag not persisted)', async () => {
    // Fill only the asset id, leaving the required description empty, then remount.
    const { unmount } = renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );
    await fillGif({ assetId: 'abc123', description: '' });
    unmount();
    renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );

    // The panel is open (asset id makes the composition non-empty) but the empty
    // description is NOT marked invalid: touched did not survive the remount.
    const description = screen.getByLabelText(/description/i);
    expect(description).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/description is required/i)).not.toBeInTheDocument();
  });

  test('a different account finds an empty GIF composition and a closed panel', async () => {
    const { unmount } = renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );
    await fillGif();
    unmount();

    renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={8} />
    );
    // Nothing restored, so the panel stays closed for the new account.
    expect(screen.queryByTestId('gif-picker-panel')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    expect(screen.getByLabelText('GIF asset id')).toHaveValue('');
  });

  test('a logged-out (null) account finds an empty GIF composition', async () => {
    const { unmount } = renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );
    await fillGif();
    unmount();

    renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={null} />
    );
    expect(screen.queryByTestId('gif-picker-panel')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    expect(screen.getByLabelText('GIF asset id')).toHaveValue('');
  });

  test('a successful GIF send clears the GIF composition but leaves the text draft untouched', async () => {
    const onSendGif = jest.fn().mockResolvedValue(true);
    const { unmount } = renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={onSendGif} gifEnabled leagueId={5} viewerUserId={7} />
    );
    await userEvent.type(screen.getByLabelText('Message'), 'keep my message');
    await fillGif({ assetId: 'abc123', description: 'a waving hand' });
    await userEvent.click(screen.getByTestId('gif-send'));

    // The send fired and the panel closed / fields cleared...
    expect(onSendGif).toHaveBeenCalled();
    expect(screen.queryByTestId('gif-picker-panel')).not.toBeInTheDocument();
    // ...but the typed message is untouched, here and after a remount.
    expect(screen.getByLabelText('Message')).toHaveValue('keep my message');
    unmount();
    renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );
    expect(screen.getByLabelText('Message')).toHaveValue('keep my message');
    // The GIF slice is gone: reopening the picker shows empty fields.
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    expect(screen.getByLabelText('GIF asset id')).toHaveValue('');
  });

  test('a successful TEXT send clears the text draft but leaves the GIF composition untouched', async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    const { unmount } = renderWithProviders(
      <ChatConversation messages={[]} onSend={onSend} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );
    await userEvent.type(screen.getByLabelText('Message'), 'send this text');
    await fillGif({ assetId: 'abc123', description: 'a waving hand', caption: 'hi' });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // The text send fired and cleared the message box...
    expect(onSend).toHaveBeenCalledWith('send this text', expect.any(String));
    expect(screen.getByLabelText('Message')).toHaveValue('');
    // ...but the GIF composition is intact, still open with its fields, and it
    // survives a remount.
    expect(screen.getByLabelText('GIF asset id')).toHaveValue('abc123');
    unmount();
    renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={noop} gifEnabled leagueId={5} viewerUserId={7} />
    );
    expect(screen.getByLabelText('GIF asset id')).toHaveValue('abc123');
    expect(screen.getByLabelText(/description/i)).toHaveValue('a waving hand');
    expect(screen.getByLabelText(/caption/i)).toHaveValue('hi');
  });

  test('when sessionStorage throws, composing and sending a GIF still work', async () => {
    jest.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    jest.spyOn(window.sessionStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const onSendGif = jest.fn().mockResolvedValue(true);
    renderWithProviders(
      <ChatConversation messages={[]} onSend={noop} onSendGif={onSendGif} gifEnabled leagueId={5} viewerUserId={7} />
    );

    await fillGif({ assetId: 'abc123', description: 'a waving hand' });
    await userEvent.click(screen.getByTestId('gif-send'));

    // Persistence failed on every access, but the composition still reached the
    // send: a composer that cannot save a draft must still let the manager send.
    expect(onSendGif).toHaveBeenCalledWith(expect.objectContaining({
      provider: FAKE_PROVIDER_ID,
      assetId: 'abc123',
      description: 'a waving hand',
    }));
    jest.restoreAllMocks();
  });
});
