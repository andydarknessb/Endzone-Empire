import React from 'react';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import DraftRoomChat from './DraftRoomChat';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

// The draft room hands DraftRoomChat the session it already owns. This fake stands
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
let reconnectHandlers;

beforeEach(() => {
  socket = makeSharedSocket();
  reconnectHandlers = [];
  onReconnect.mockImplementation((s, handler) => {
    reconnectHandlers.push(handler);
    return () => { reconnectHandlers = reconnectHandlers.filter((h) => h !== handler); };
  });
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows existing League-chat history, attributed by Team', async () => {
  apiClient.get.mockResolvedValue({ data: [chatMessage({ message: 'welcome', teamName: 'Anvils', username: 'alice' })] });

  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);

  expect(await screen.findByText('welcome')).toBeInTheDocument();
  expect(screen.getByText('Anvils')).toBeInTheDocument();
  expect(screen.queryByText('alice')).not.toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/3/draft-feed');
});

test('appends a message broadcast over the shared draft session', async () => {
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await screen.findByText('No messages yet');

  act(() => socket.trigger('chat:message', chatMessage({ id: 2, teamName: 'Bulldogs', message: 'good luck all' })));

  expect(await screen.findByText('good luck all')).toBeInTheDocument();
  expect(screen.getByText('Bulldogs')).toBeInTheDocument();
});

test('announces a live human message in a polite region - but never a Pick (#513) or the opening backlog', async () => {
  // Opening backlog: a message already in history is not "new" and must not be
  // announced.
  apiClient.get.mockResolvedValue({ data: [chatMessage({ message: 'welcome', teamName: 'Anvils', seq: 1 })] });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await screen.findByText('welcome');
  expect(screen.queryByText(/New message from/)).not.toBeInTheDocument();

  // A live human message announces its arrival by Team. That the announcer is a
  // persistent polite status region is pinned in FeedAnnouncer.test.jsx; here we
  // prove the live socket entry reaches it.
  // teamId 12, not the viewer's 11: a message from ANOTHER Team announces (the
  // viewer's own is suppressed, pinned in FeedAnnouncer.test.jsx).
  act(() => socket.trigger('chat:message', chatMessage({ id: 2, seq: 5, teamId: 12, teamName: 'Bulldogs', message: 'good luck all' })));
  expect(await screen.findByText('New message from Bulldogs')).toBeInTheDocument();

  // A live Pick is NO LONGER announced by the feed's polite region (#513). Picks
  // moved to a room-level announcer (PickAnnouncer, wired in DraftBoard and
  // tested there) so they are heard on every tab and exactly once - if this
  // Chat-scoped region also spoke the Pick, a reader with Chat mounted would hear
  // it twice. The Pick still appears in the VISIBLE feed; only the duplicate
  // polite announcement is gone.
  act(() => socket.trigger('draft:picked', {
    auto: false,
    activity: {
      type: 'draft_activity', kind: 'pick', id: 1, seq: 6, teamName: 'Bulldogs',
      player: { name: 'Pat Mahomes' }, round: 1, pickNumber: 1, created_at: '2026-01-01T12:05:00Z',
    },
  }));
  // Visible in the feed's normal activity line...
  expect(await screen.findByText(/drafted/)).toBeInTheDocument();
  // ...but no polite status region announces it: a Pick is a no-op for the feed
  // announcer now (#513), so the region keeps whatever it last held (here the
  // prior "New message from Bulldogs") rather than speaking the Pick. It does NOT
  // clear it - that a Pick must not blank a pending message is pinned in
  // FeedAnnouncer.test.jsx.
  const announcingPick = screen
    .getAllByRole('status')
    .filter((region) => /drafted|Pat Mahomes/.test(region.textContent));
  expect(announcingPick).toHaveLength(0);
});

const pickActivity = (overrides = {}) => ({
  type: 'draft_activity',
  kind: 'pick',
  id: 1,
  seq: 6,
  teamId: 12,
  teamName: 'Bulldogs',
  player: { id: 500, name: 'Pat Mahomes', position: 'QB', nflTeam: 'KC' },
  round: 1,
  pickNumber: 1,
  isAutopick: false,
  created_at: '2026-01-01T12:05:00Z',
  ...overrides,
});

test('appends a committed Pick as Draft activity from the shared draft:picked broadcast (#435)', async () => {
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await screen.findByText('No messages yet');

  // The Pick rides on draft:picked beside the board update; the feed reads its
  // activity entry.
  act(() => socket.trigger('draft:picked', { auto: false, activity: pickActivity() }));

  expect(await screen.findByText(/drafted/)).toBeInTheDocument();
  expect(screen.getByText('Bulldogs')).toBeInTheDocument();
  expect(screen.getByText('Pat Mahomes', { exact: false })).toBeInTheDocument();
  // The snapshot facts are shown without leaving the feed.
  expect(screen.getByText(/Round 1/)).toBeInTheDocument();
  expect(screen.getByText(/Pick 1/)).toBeInTheDocument();
});

test('labels an autopick AUTO in the feed (#435 AC3)', async () => {
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await screen.findByText('No messages yet');

  act(() => socket.trigger('chat:message', chatMessage({ id: 9, seq: 5, teamName: 'Anvils', message: 'my turn' })));
  act(() => socket.trigger('draft:picked', { auto: true, activity: pickActivity({ seq: 6, isAutopick: true }) }));

  expect(await screen.findByText('AUTO')).toBeInTheDocument();
  expect(screen.getByText('my turn')).toBeInTheDocument();
  // Strict seq ordering of the combined feed is pinned in useDraftRoomFeed.test.js.
});

test('sends over the shared session and never opens a second connection', async () => {
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true });
  });

  renderWithProviders(<DraftRoomChat socket={socket} leagueId={7} viewerTeamId={11} />);
  await screen.findByText('No messages yet');

  await userEvent.type(screen.getByLabelText('Message'), 'from the draft room');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() =>
    expect(socket.emit).toHaveBeenCalledWith(
      'chat:send',
      expect.objectContaining({ leagueId: 7, message: 'from the draft room' }),
      expect.any(Function)
    )
  );
  // The whole point of #433 (acceptance criterion 3): chat rides the draft's
  // one authenticated session, so it must not mint its own.
  expect(createDraftSocket).not.toHaveBeenCalled();
});

test('takes back its own listener on unmount and never ends the shared session', async () => {
  const { unmount } = renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  unmount();

  expect(socket.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
  expect(socket).not.toHaveProperty('disconnect');
});

test('re-syncs chat history when the draft session reconnects', async () => {
  // The Draft surface's own reconnection coverage (issue #433: tests cover
  // "both surfaces and reconnection"). The draft room re-joins on reconnect
  // over in useDraftSocket; here we prove the chat riding that session pulls a
  // fresh history so anything sent while offline appears.
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await screen.findByText('No messages yet');

  apiClient.get.mockResolvedValue({ data: [chatMessage({ id: 5, message: 'missed while offline' })] });
  act(() => reconnectHandlers.forEach((cb) => cb()));

  expect(await screen.findByText('missed while offline')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/3/draft-feed');
});

test('renders nothing that throws before the session exists', async () => {
  // The draft room hands a null socket until draft:join has landed; the chat
  // must render its history and wait, not crash.
  renderWithProviders(<DraftRoomChat socket={null} leagueId={3} viewerTeamId={null} />);
  expect(await screen.findByText('No messages yet')).toBeInTheDocument();
});

// --------------------------------------------------------------------------
// #482: the Draft room live-tombstones a hidden message and can hide from here
// --------------------------------------------------------------------------

const hiddenChat = (overrides = {}) => ({
  type: 'league_chat', id: 7, seq: 9, hidden: true, message: null,
  teamId: 11, teamName: 'Anvils', ...overrides,
});

test('a chat:hidden broadcast tombstones the held chat entry in place, not a Pick with the same id, keeping the count and position', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      chatMessage({ id: 7, seq: 9, teamName: 'Anvils', message: 'you are worthless' }),
      pickActivity({ id: 7, seq: 10 }),
    ],
  });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  expect(await screen.findByText('you are worthless')).toBeInTheDocument();

  act(() => socket.trigger('chat:hidden', hiddenChat({ id: 7, seq: 9 })));

  // The neutral tombstone replaces the content in place; the Pick beside it is
  // untouched, so both entries remain and neither moved.
  expect(await screen.findByText('Message hidden by commissioner')).toBeInTheDocument();
  expect(screen.queryByText('you are worthless')).not.toBeInTheDocument();
  expect(screen.getByText(/drafted/)).toBeInTheDocument();
  expect(screen.getByText('Pat Mahomes', { exact: false })).toBeInTheDocument();
});

test('a chat:hidden for an id the feed never held changes nothing', async () => {
  apiClient.get.mockResolvedValue({ data: [chatMessage({ id: 7, seq: 9, message: 'still here' })] });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  expect(await screen.findByText('still here')).toBeInTheDocument();

  act(() => socket.trigger('chat:hidden', hiddenChat({ id: 999 })));

  expect(screen.getByText('still here')).toBeInTheDocument();
  expect(screen.queryByText('Message hidden by commissioner')).not.toBeInTheDocument();
});

test('a commissioner sees the Hide control on a chat entry but never on a Pick', async () => {
  apiClient.get.mockResolvedValue({
    data: [chatMessage({ id: 7, seq: 9, teamName: 'Anvils', message: 'play nice' }), pickActivity({ id: 3, seq: 10 })],
  });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} canModerate />);
  await screen.findByText('play nice');

  // One Hide control, on the chat message; the Pick shows none.
  expect(screen.getByRole('button', { name: 'Hide message from Anvils' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Hide message/ })).toHaveLength(1);
});

test('a non-commissioner sees no Hide control at all', async () => {
  apiClient.get.mockResolvedValue({ data: [chatMessage({ id: 7, seq: 9, teamName: 'Anvils', message: 'play nice' })] });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} />);
  await screen.findByText('play nice');

  expect(screen.queryByRole('button', { name: /Hide message/ })).not.toBeInTheDocument();
});

// --------------------------------------------------------------------------
// #516: the Draft room offers the GIF composer, gated on the server capability,
// and its send rides the SAME shared session as text - end to end through the
// real useDraftRoomFeed and ChatConversation, against the deterministic fake
// provider with no network surface (AC7: proven absence of any provider request).
// --------------------------------------------------------------------------

const { registerGifProvider, clearGifProviders } = require('../../lib/gifProvider');
const { FAKE_PROVIDER_ID, fakeGifResolver } = require('../../lib/gifProviderFake');

// The entry the server persists, rides back on the ack, and re-broadcasts to the
// whole room (the sender included). A GIF entry carries structured `media`; its
// shared `seq` is the identity feedEntryKey dedups on.
const gifEntry = (over = {}) => ({
  type: 'league_chat', id: 40, seq: 40, teamId: 11, teamName: 'Anvils',
  media: { provider: FAKE_PROVIDER_ID, assetId: 'abc123', description: 'a cat knocking a cup off a table' },
  message: null, created_at: '2026-01-01T12:00:00Z', ...over,
});

afterEach(() => clearGifProviders());

test('with the capability OFF the GIF trigger is absent while text composition still works (AC1)', async () => {
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} gifEnabled={false} />);
  await screen.findByText('No messages yet');
  expect(screen.queryByTestId('gif-picker-trigger')).not.toBeInTheDocument();
  // Text composition is untouched: the Message field and Send are still here.
  expect(screen.getByLabelText('Message')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
});

test('with the capability ON the GIF trigger and composer are available (AC2)', async () => {
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} gifEnabled />);
  await screen.findByText('No messages yet');
  expect(screen.getByTestId('gif-picker-trigger')).toBeInTheDocument();
});

test('composing a GIF sends one chat:send with the structured payload over the shared session (AC3)', async () => {
  registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true, entry: gifEntry() });
  });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={7} viewerTeamId={11} gifEnabled />);
  await screen.findByText('No messages yet');

  await userEvent.click(screen.getByTestId('gif-picker-trigger'));
  await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
  await userEvent.type(screen.getByLabelText(/description/i), 'a cat knocking a cup off a table');
  await userEvent.click(screen.getByTestId('gif-send'));

  await waitFor(() =>
    expect(socket.emit).toHaveBeenCalledWith(
      'chat:send',
      expect.objectContaining({
        leagueId: 7,
        gif: { provider: FAKE_PROVIDER_ID, assetId: 'abc123', description: 'a cat knocking a cup off a table', caption: null },
        clientMsgId: expect.any(String),
      }),
      expect.any(Function)
    )
  );
  // It never opens a second connection (#433): chat rides the draft session.
  expect(createDraftSocket).not.toHaveBeenCalled();
});

test('a sender does not see their own GIF twice: the ack reconcile and the broadcast echo collapse to ONE (AC4)', async () => {
  // The specific #516 risk. Prove the COUNT of rendered GIFs is one - a presence
  // check cannot tell one from two, and duplication is the risk.
  registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
  const entry = gifEntry({ id: 41, seq: 41 });
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true, entry });
  });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={7} viewerTeamId={11} gifEnabled />);
  await screen.findByText('No messages yet');

  await userEvent.click(screen.getByTestId('gif-picker-trigger'));
  await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
  await userEvent.type(screen.getByLabelText(/description/i), 'a cat knocking a cup off a table');
  await userEvent.click(screen.getByTestId('gif-send'));

  // The ack reconciled it: exactly one GIF rendered.
  await waitFor(() => expect(screen.getAllByTestId('gif-animated')).toHaveLength(1));

  // The server now broadcasts that same send back to the whole room; the sender
  // receives its own echo (same seq). It must NOT render a second GIF.
  act(() => socket.trigger('chat:message', entry));

  expect(screen.getAllByTestId('gif-animated')).toHaveLength(1);
});

test('a refused GIF surfaces the error and PRESERVES the unsent description and caption (AC5)', async () => {
  // The forgotten half of the refusal criterion: a rate-limited manager must not
  // lose what they typed. sendGif resolves false, the GifComposer resets only on
  // a truthy return, so the panel stays open with the fields intact.
  registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ code: 'RATE_LIMITED', error: 'Too many messages', retryAfterSeconds: 12 });
  });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={7} viewerTeamId={11} gifEnabled />);
  await screen.findByText('No messages yet');

  await userEvent.click(screen.getByTestId('gif-picker-trigger'));
  await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
  await userEvent.type(screen.getByLabelText(/description/i), 'a cat knocking a cup off a table');
  await userEvent.type(screen.getByLabelText(/caption/i), 'lol');
  await userEvent.click(screen.getByTestId('gif-send'));

  // The refusal surfaced through the one composer error channel...
  expect(await screen.findByText(/Too many messages\. Try again in 12s\./)).toBeInTheDocument();
  // ...and nothing was lost: the composer is still open with the typed values.
  expect(screen.getByLabelText(/description/i)).toHaveValue('a cat knocking a cup off a table');
  expect(screen.getByLabelText(/caption/i)).toHaveValue('lol');
  expect(screen.getByLabelText('GIF asset id')).toHaveValue('abc123');
  // Nothing was appended to the feed.
  expect(screen.queryByTestId('gif-animated')).not.toBeInTheDocument();
});

test('the GIF composer Cancel is distinct from the moderation Cancel in the same region', async () => {
  // A commissioner can have BOTH the hide form and the GIF composer open at once.
  // Their cancel controls must not share one accessible name, or a button-list
  // navigator (and a strict-mode locator) cannot tell them apart.
  registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
  apiClient.get.mockResolvedValue({ data: [{ type: 'league_chat', id: 7, seq: 9, teamId: 11, teamName: 'Anvils', message: 'play nice', created_at: '2026-01-01T12:00:00Z' }] });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} canModerate gifEnabled />);
  await screen.findByText('play nice');

  // Open both forms.
  await userEvent.click(screen.getByRole('button', { name: 'Hide message from Anvils' }));
  await userEvent.click(screen.getByTestId('gif-picker-trigger'));

  // Exactly one bare "Cancel" (the moderation form), and exactly one "Cancel GIF".
  expect(screen.getAllByRole('button', { name: 'Cancel', exact: true })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Cancel GIF' })).toBeInTheDocument();
});

test('a commissioner hiding from the room posts through the shared hide route', async () => {
  apiClient.get.mockResolvedValue({ data: [chatMessage({ id: 55, seq: 9, teamName: 'Anvils', message: 'targeted harassment' })] });
  renderWithProviders(<DraftRoomChat socket={socket} leagueId={3} viewerTeamId={11} canModerate />);
  await screen.findByText('targeted harassment');

  await userEvent.click(screen.getByRole('button', { name: 'Hide message from Anvils' }));
  await userEvent.type(screen.getByLabelText('Reason for hiding'), 'targeted harassment of a member');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm hide' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/safety/hide', {
      leagueId: 3, messageId: 55, reason: 'targeted harassment of a member',
    })
  );
});
