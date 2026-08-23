import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import { PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';
import { FORMER_MANAGER_LABEL } from '../../lib/teamIdentity';
import DraftBoard from './DraftBoard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

/**
 * A controllable fake socket: captures .on() handlers so tests can fire them,
 * and answers `draft:join` the way the server does.
 *
 * The acknowledgement is the viewer's ONLY per-viewer channel (#113, contract
 * #112): `viewerTeamId` never rides on a broadcast, so a test that wants the
 * board to know which Team is the viewer's sets `fakeSocket.viewerTeamId` and
 * connects, rather than putting an account id in the redux store.
 */
function makeFakeSocket() {
  const handlers = {};
  const managerHandlers = {};
  const socket = {
    viewerTeamId: null,
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    io: {
      on: jest.fn((event, cb) => {
        managerHandlers[event] = cb;
      }),
    },
    emit: jest.fn((event, payload, ack) => {
      if (event === 'draft:join' && typeof ack === 'function') {
        ack({ ok: true, viewerTeamId: socket.viewerTeamId });
      }
    }),
    disconnect: jest.fn(),
    trigger(event, payload) {
      if (handlers[event]) handlers[event](payload);
    },
    triggerManager(event, payload) {
      if (managerHandlers[event]) managerHandlers[event](payload);
    },
  };
  return socket;
}

/**
 * Connect the draft room as the manager who owns Team `teamId`, which is how
 * a test says "this viewer is that Team". The server answers the join
 * acknowledgement before it sends the first snapshot, so this always runs
 * before a `draft:state` trigger.
 */
const connectAsTeam = (teamId) => {
  fakeSocket.viewerTeamId = teamId;
  act(() => fakeSocket.trigger('connect'));
};

const playersPage = (players = [{ id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs' }]) => ({
  data: { players, totalPages: 1 },
});

const renderBoard = (leagueId = 1, state) =>
  renderWithProviders(<DraftBoard />, {
    path: '/league/:leagueId/draft',
    route: `/league/${leagueId}/draft`,
    state,
  });

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderBoardWithToasts = (leagueId = 1, state) =>
  renderWithProviders(
    <SnackbarProvider>
      <DraftBoard />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId/draft',
      route: `/league/${leagueId}/draft`,
      state,
    }
  );

/**
 * Pick history left the rail for the Board (issue #123 acceptance criterion
 * 5), where it is a collapsible chronological view of the same committed
 * Picks the matrix is built from. Anything that asserts on history opens the
 * Board tab and expands it first, exactly as a manager would.
 */
const openPickHistory = async () => {
  await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
  const trigger = screen.getByRole('button', { name: 'Pick history' });
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger);
};

/**
 * Once a draft is live the rail shows the compact Upcoming strip, and the full
 * Draft order - with its per-team Auto-draft switches - sits behind a
 * disclosure inside it (issue #123 acceptance criterion 2).
 */
const openFullDraftOrder = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Full Draft order' }));
};

let fakeSocket;

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  onReconnect.mockImplementation((socket, handler) => socket.io.on('reconnect', handler));
  apiClient.get.mockResolvedValue(playersPage());
  apiClient.put.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test('creates a socket and joins the league draft room once connected', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  expect(createDraftSocket).toHaveBeenCalled();
  act(() => fakeSocket.trigger('connect'));

  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:join', { leagueId: 1 }, expect.any(Function));
});

test('renders league state (name, on-the-clock, pick history) from a draft:state event', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active' },
      teams: [{ teamId: 5, teamName: "Bob's Team" }],
      picks: [{
        pick_number: 1, teamId: 5, teamName: "Bob's Team",
        player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills',
      }],
      onTheClock: { teamId: 5, teamName: "Bob's Team" },
    })
  );

  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
  // The on-the-clock chip names the Team and nothing else: the manager's
  // username used to sit in parentheses after it (#113 criterion 4).
  expect(screen.getByText("On the clock: Bob's Team")).toBeInTheDocument();
  expect(screen.queryByText(/bob/)).not.toBeInTheDocument();

  await openPickHistory();
  expect(screen.getByText('#1')).toBeInTheDocument();
  // The pick-history name is now a quick-view button (separate from any action).
  expect(screen.getByRole('button', { name: 'Josh Allen' })).toBeInTheDocument();
  // Every Pick is attributed by Team, including one already on the board
  // when the room opened - which could not be attributed at all before.
  expect(screen.getByText(/by Bob's Team/)).toBeInTheDocument();
});

test('a Pick with no Team identity is attributed as a former manager, never blank', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  // This pins the RENDERING RULE, not a payload the server produces today:
  // the contract lets any LEFT-joined Team identity read back null, but a
  // Pick's cannot, because draft_picks.team_id is NOT NULL and cascades (see
  // 20260710000001_initial_schema.js), so removing a team removes its picks
  // rather than orphaning them. Rendering a null straight would print
  // nothing at all, which is the failure this rules out either way.
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), {
      picks: [{
        pick_number: 1, teamId: null, teamName: null,
        player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF',
      }],
    }))
  );

  await openPickHistory();
  expect(screen.getByText(`by ${FORMER_MANAGER_LABEL}`)).toBeInTheDocument();
  // And the board itself simply has no cell for a Team that is gone, rather
  // than an unlabelled column appearing for it.
  expect(screen.queryByText('null')).not.toBeInTheDocument();
});

test('shows the prominent on-clock timer with "Your pick!" for the active user', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(5);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: {
        name: 'Sunday Ballers',
        draft_status: 'active',
        owner_id: 99,
        pick_time_seconds: 90,
        pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
      },
      teams: [{ teamId: 5, teamName: "Bob's Team", draft_position: 1, autodraft: false }],
      picks: [],
      onTheClock: { teamId: 5, teamName: "Bob's Team" },
    })
  );

  expect(screen.getByText('Your pick!')).toBeInTheDocument();
  expect(screen.getByTestId('draft-clock')).toBeInTheDocument();
});

test('shows an AUTO badge and a checked autodraft switch for an autodrafting team', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(5);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', owner_id: 99 },
      teams: [{ teamId: 5, teamName: "Bob's Team", draft_position: 1, autodraft: true }],
      picks: [],
      onTheClock: null,
    })
  );

  await openFullDraftOrder();
  expect(screen.getByText('AUTO')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Autodraft for Bob's Team/ })).toBeChecked();
});

test('toggling a team\'s autodraft posts to the autodraft endpoint', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(5);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', owner_id: 99 },
      teams: [{ teamId: 5, teamName: "Bob's Team", draft_position: 1, autodraft: false }],
      picks: [],
      onTheClock: null,
    })
  );

  await openFullDraftOrder();
  await userEvent.click(screen.getByRole('checkbox', { name: /Autodraft for Bob's Team/ }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/teams/5/autodraft', { enabled: true })
  );
});

test('shows "No picks yet" when the pick history is empty', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'pending' },
      teams: [],
      picks: [],
      onTheClock: null,
    })
  );

  // Product language, not the stored enum (issue #123 acceptance criterion 6).
  expect(screen.getByText('Draft not started')).toBeInTheDocument();
  expect(screen.queryByText('pending')).not.toBeInTheDocument();

  await openPickHistory();
  expect(screen.getByText('No picks yet')).toBeInTheDocument();
});

test('clicking Draft on a player emits draft:pick with the league and player id', async () => {
  renderBoard(3);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', draft_paused: false },
      teams: [{ teamId: 1, teamName: 'Team A' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
  // Clicking Draft opens the focused confirmation dialog naming the player
  // instead of committing straight away (#120 acceptance criterion 3).
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Draft Patrick Mahomes?')).toBeInTheDocument();
  expect(fakeSocket.emit).not.toHaveBeenCalledWith('draft:pick', expect.anything(), expect.anything());

  await userEvent.click(within(dialog).getByRole('button', { name: 'Draft Patrick Mahomes' }));

  expect(fakeSocket.emit).toHaveBeenCalledWith(
    'draft:pick',
    { leagueId: 3, playerId: 1 },
    expect.any(Function)
  );
});

test('canceling the Draft confirmation dialog never emits draft:pick', async () => {
  renderBoard(3);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', draft_paused: false },
      teams: [{ teamId: 1, teamName: 'Team A' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(
    fakeSocket.emit.mock.calls.some(([event]) => event === 'draft:pick')
  ).toBe(false);
});

test('a draft:picked event prepends the new pick, updates who is on the clock, and refetches players', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active' },
      teams: [
        { teamId: 1, teamName: 'Team A' },
        { teamId: 2, teamName: 'Team B' },
      ],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })
  );
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(playersPage([]));

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs' },
      nextTeamId: 2,
      draftComplete: false,
      by: { userId: 5, username: 'alice' },
    })
  );

  expect(screen.getByText('On the clock: Team B')).toBeInTheDocument();

  await openPickHistory();
  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Patrick Mahomes' }).length).toBeGreaterThan(0);
  // The landed Pick is attributed to the Team that made it, and the
  // username the broadcast carried in `by` reaches no rendered surface.
  expect(screen.getByText(/by Team A/)).toBeInTheDocument();
  expect(screen.queryByText(/alice/)).not.toBeInTheDocument();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/players', expect.any(Object)));
});

test('a pick landing refetches the caller\'s own roster only when THAT pick is theirs', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active' },
      teams: [
        { teamId: 1, teamName: 'Team A' },
        { teamId: 2, teamName: 'Team B' },
      ],
      picks: [],
      onTheClock: { teamId: 2, teamName: 'Team B' },
    })
  );
  apiClient.get.mockClear();

  // Team B (not the caller's) picks - the caller's own roster is unchanged.
  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 2,
      player: { id: 20, name: 'Someone Elses Pick', position: 'WR', nfl_team: 'DAL' },
      nextTeamId: 1,
      draftComplete: false,
      by: { username: 'bob' },
    })
  );
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/players', expect.any(Object)));
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/team/roster', expect.any(Object));

  apiClient.get.mockClear();
  // Team A (the caller's own team) picks - the caller's own roster refetches.
  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 2,
      teamId: 1,
      player: { id: 21, name: 'My New Guy', position: 'RB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      by: { username: 'alice' },
    })
  );
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/team/roster', { params: { leagueId: 1 } })
  );
});

test('a draft:picked event with draftComplete shows the completion banner and marks the league complete', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active' },
      teams: [{ teamId: 1, teamName: 'Team A' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })
  );

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 15,
      teamId: 1,
      player: { id: 9, name: 'Last Player', position: 'K', nfl_team: 'X' },
      nextTeamId: null,
      draftComplete: true,
      by: { username: 'alice' },
    })
  );

  expect(screen.getByText('Draft complete!')).toBeInTheDocument();
  // The status chip, in product language rather than the stored enum.
  expect(screen.getByText('Draft complete')).toBeInTheDocument();
  expect(screen.queryByText('complete')).not.toBeInTheDocument();
});

test('a draft:complete event alone also shows the completion banner', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('draft:complete'));

  expect(screen.getByText('Draft complete!')).toBeInTheDocument();
});

test('an error acknowledgment from draft:join is surfaced as an alert', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('connect'));
  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
  act(() => ack({ error: 'you are not in this league' }));

  expect(await screen.findByText('you are not in this league')).toBeInTheDocument();
});

test('an error acknowledgment from draft:pick is surfaced as an alert', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', draft_paused: false },
      teams: [{ teamId: 1, teamName: 'Team A' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Draft Patrick Mahomes' }));

  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:pick');
  act(() => ack({ error: 'it is not your turn to pick' }));

  expect(await screen.findByText('it is not your turn to pick')).toBeInTheDocument();
});

test('changing the position filter refetches available players filtered by position', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(playersPage([]));

  await userEvent.click(screen.getByLabelText('Position'));
  await userEvent.click(await screen.findByRole('option', { name: 'RB' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, leagueId: 1, available: true, sort: 'adp', position: 'RB' },
    })
  );
});

test('the position filter offers individual defender positions and filters the draft pool by them', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(playersPage([]));

  await userEvent.click(screen.getByLabelText('Position'));
  for (const pos of ['DE', 'DT', 'LB', 'CB', 'S', 'DB']) {
    expect(await screen.findByRole('option', { name: pos })).toBeInTheDocument();
  }
  await userEvent.click(screen.getByRole('option', { name: 'LB' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, leagueId: 1, available: true, sort: 'adp', position: 'LB' },
    })
  );
});

test('disconnects the socket on unmount', async () => {
  const { unmount } = renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  unmount();

  expect(fakeSocket.disconnect).toHaveBeenCalled();
});

test('shows a reconnecting indicator on disconnect and hides it once reconnected', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('disconnect'));
  expect(screen.getByText('Reconnecting…')).toBeInTheDocument();

  act(() => fakeSocket.trigger('connect'));
  expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
});

test('re-joins the draft room (and gets a fresh draft:state) when the manager reconnects', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('disconnect'));
  fakeSocket.emit.mockClear();

  act(() => fakeSocket.triggerManager('reconnect'));

  expect(fakeSocket.emit).toHaveBeenCalledWith(
    'draft:join',
    { leagueId: 1 },
    expect.any(Function)
  );
});

// --- Phase 4: pick timer, queue, commissioner controls ---

const activeLeague = (overrides = {}) => ({
  name: 'Sunday Ballers',
  draft_status: 'active',
  pick_time_seconds: 90,
  draft_paused: false,
  pick_deadline_at: null,
  owner_id: 99,
  ...overrides,
});

// Team identity on the wire, as the server sends it: `teamId` / `teamName`,
// with no account field to fall back on (#113, contract #112).
const TEAM_A = { teamId: 1, teamName: 'Team A' };
const TEAM_B = { teamId: 2, teamName: 'Team B' };

const stateEvent = (league, extra = {}) => ({
  league,
  teams: [TEAM_A, TEAM_B],
  picks: [],
  onTheClock: TEAM_A,
  ...extra,
});

/** URL-keyed GET mock so the queue and player fetches can differ. */
const mockGets = ({ players = playersPage(), queue = [] } = {}) => {
  apiClient.get.mockImplementation((url) =>
    url === '/api/draft/queue'
      ? Promise.resolve({ data: queue })
      : Promise.resolve(players)
  );
};

test('countdown chip renders from pick_deadline_at and ticks down', async () => {
  jest.useFakeTimers();
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
    })))
  );
  expect(screen.getByText('⏱ 30s')).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(3000);
  });
  expect(screen.getByText('⏱ 27s')).toBeInTheDocument();
});

test('the countdown resets to pick_time_seconds on each draft:picked', async () => {
  jest.useFakeTimers();
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 5000).toISOString(),
    }), {
      teams: [
        { teamId: 1, teamName: 'Team A' },
        { teamId: 2, teamName: 'Team B' },
      ],
    }))
  );
  expect(screen.getByText('⏱ 5s')).toBeInTheDocument();

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      by: { username: 'alice' },
    })
  );
  expect(screen.getByText('⏱ 90s')).toBeInTheDocument();
});

test('a paused draft shows the paused chip and leaves drafting focusable but aria-disabled', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_paused: true })))
  );

  expect(screen.getByText('Draft Paused')).toBeInTheDocument();
  const draftButton = screen.getByRole('button', { name: 'Draft' });
  // Temporarily unavailable, not nonexistent: focusable aria-disabled, not
  // the native disabled attribute (#120 acceptance criterion 5).
  expect(draftButton).not.toBeDisabled();
  expect(draftButton).toHaveAttribute('aria-disabled', 'true');

  // Suppressed activation: clicking it does nothing.
  await userEvent.click(draftButton);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('the pool Draft button is aria-disabled off-turn and fully enabled on-turn', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  // Whose turn it is, is now decided by Team: the clock names a Team ID and
  // the viewer holds their own from the join acknowledgement (#113).
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B }))
  );
  expect(screen.getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-disabled', 'true');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_A }))
  );
  const draftButton = screen.getByRole('button', { name: 'Draft' });
  expect(draftButton).toBeEnabled();
  expect(draftButton).not.toHaveAttribute('aria-disabled');
});

test("the queue's top-row Draft button is aria-disabled off-turn and fully enabled on-turn, and drafts queue[0]", async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoardWithToasts(1);
  await screen.findByRole('button', { name: 'Bijan Robinson' });
  connectAsTeam(1);

  const queuePanel = () => screen.getByText('My Queue').closest('.MuiPaper-root');

  // Not my turn: the quick-draft button stays in the DOM (a manual Pick
  // still exists in this active, snake-type draft) but is focusable
  // aria-disabled, matching the pool row and Quick View - not hidden, and
  // not the native disabled attribute (#120 acceptance criteria 2, 5).
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B }))
  );
  const offTurnButton = within(queuePanel()).getByRole('button', { name: 'Draft' });
  expect(offTurnButton).not.toBeDisabled();
  expect(offTurnButton).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(offTurnButton);
  expect(fakeSocket.emit.mock.calls.some(([event]) => event === 'draft:pick')).toBe(false);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  // My turn: the quick-draft button appears and drafts queue[0] (Bijan Robinson, id 2).
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_A }))
  );
  const queueDraftButton = within(queuePanel()).getByRole('button', { name: 'Draft' });
  await userEvent.click(queueDraftButton);

  // The rail's quick-draft button goes through the same focused confirmation
  // as every other manual Pick, naming the actual queued player even though
  // he isn't in the (separately fetched, unrelated) pool response.
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Draft Bijan Robinson?')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Draft Bijan Robinson' }));

  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:pick');
  expect(fakeSocket.emit).toHaveBeenCalledWith(
    'draft:pick',
    { leagueId: 1, playerId: 2 },
    expect.any(Function)
  );
  act(() => ack({}));
  // The success toast names the actual player even though he was only ever
  // resolvable through the queue, not the (unrelated) pool response - the
  // same lookup requestDraftPlayer used to build the confirmation dialog.
  expect(await screen.findByText('Drafted Bijan Robinson!')).toBeInTheDocument();
});

test("the queue's top-row Draft button is aria-disabled on your turn while the draft is paused, with the same shared explanation as the pool row", async () => {
  mockGets({
    queue: [{ id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 }],
  });
  renderBoard(1);
  await screen.findByRole('button', { name: 'Bijan Robinson' });
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague({ draft_paused: true }), {
        teams: [{ teamId: 1, teamName: 'Team A' }],
        onTheClock: { teamId: 1, teamName: 'Team A' }, // my turn, but paused
      })
    )
  );

  const queuePanel = () => screen.getByText('My Queue').closest('.MuiPaper-root');
  const pausedButton = within(queuePanel()).getByRole('button', { name: 'Draft' });
  expect(pausedButton).not.toBeDisabled();
  expect(pausedButton).toHaveAttribute('aria-disabled', 'true');

  await userEvent.click(pausedButton);
  expect(fakeSocket.emit.mock.calls.some(([event]) => event === 'draft:pick')).toBe(false);
});

test('the queue loads on mount and renders players in rank order', async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoard(1);

  await screen.findByRole('button', { name: 'Bijan Robinson' });
  // Queue names are quick-view buttons; assert both are present in rank order.
  const queued = screen
    .getAllByRole('button', { name: /Bijan Robinson|Justin Jefferson/ })
    .map((b) => b.textContent);
  expect(queued).toEqual(['Bijan Robinson', 'Justin Jefferson']);
  expect(apiClient.get).toHaveBeenCalledWith('/api/draft/queue', { params: { leagueId: 1 } });
});

test('clicking Queue on an available player persists the updated ordered list', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByRole('button', { name: 'Queue' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/draft/queue', {
      leagueId: 1,
      playerIds: [1],
    })
  );
  // Patrick Mahomes now appears both in the available table and the queue.
  expect(screen.getAllByRole('button', { name: 'Patrick Mahomes' })).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Queue' })).toBeDisabled();
});

test('move up and remove reorder the queue and persist it', async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoard(1);
  await screen.findByRole('button', { name: 'Bijan Robinson' });

  await userEvent.click(screen.getAllByLabelText('Move up')[1]);
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/draft/queue', {
      leagueId: 1,
      playerIds: [3, 2],
    })
  );
  const reordered = screen
    .getAllByRole('button', { name: /Bijan Robinson|Justin Jefferson/ })
    .map((b) => b.textContent);
  expect(reordered).toEqual(['Justin Jefferson', 'Bijan Robinson']);

  apiClient.put.mockClear();
  await userEvent.click(screen.getAllByLabelText('Remove from queue')[0]);
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/draft/queue', {
      leagueId: 1,
      playerIds: [2],
    })
  );
});

test('Randomize Draft order shows only for the commissioner pre-draft and POSTs', async () => {
  const { unmount } = renderBoardWithToasts(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );

  await userEvent.click(screen.getByRole('button', { name: 'Randomize Draft order' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/order', { randomize: true })
  );
  expect(await screen.findByText('Draft order randomized')).toBeInTheDocument();
  unmount();

  // Non-owner never sees the button
  renderBoard(1, { user: { id: 8, username: 'notcommish' } });
  await screen.findByText('Patrick Mahomes');
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );
  expect(screen.queryByRole('button', { name: 'Randomize Draft order' })).not.toBeInTheDocument();
});

test('Pause Draft POSTs the toggled paused flag for the commissioner during an active draft', async () => {
  renderBoard(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 7 })))
  );

  await userEvent.click(screen.getByRole('button', { name: 'Pause Draft' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/pause', { paused: true })
  );
});

test('commissioner confirms undo before posting the last-pick rollback', async () => {
  renderBoardWithToasts(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99, current_pick: 1 }), {
    picks: [{ pick_number: 1, player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: false }],
  })));

  await userEvent.click(screen.getByRole('button', { name: 'Undo last pick' }));
  expect(screen.getByText('Undo last pick?')).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalledWith('/api/draft/league/1/undo', { count: 1 });
  await userEvent.click(screen.getByRole('button', { name: 'Undo pick' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/undo', { count: 1 }));
  expect(await screen.findByText('Last pick undone')).toBeInTheDocument();
});

test('undo is disabled when the most recent reached pick is a keeper', async () => {
  renderBoard(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99, current_pick: 1 }), {
    picks: [{ pick_number: 1, player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: true }],
  })));

  expect(screen.getByRole('button', { name: 'Undo last pick' })).toBeDisabled();
  expect(screen.getByText('Keeper picks cannot be undone.')).toBeInTheDocument();
});

test('reset draft requires the exact league name before calling the destructive endpoint', async () => {
  renderBoardWithToasts(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }))));

  await userEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
  const reset = screen.getByRole('button', { name: 'Reset draft' });
  expect(reset).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'League name' }), 'Sunday Ballers');
  expect(reset).toBeEnabled();
  await userEvent.click(reset);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/reset', {}));
});

test('commissioner copies a presenter link generated by the share-token endpoint', async () => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  apiClient.post.mockResolvedValue({ data: { url: 'http://localhost:3000/#/present/example-token' } });
  renderBoardWithToasts(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }))));

  await userEvent.click(screen.getByRole('button', { name: 'Presenter link' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/share-token', {}));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/#/present/example-token');
  expect(screen.getByRole('textbox', { name: 'Presenter link' })).toHaveValue('http://localhost:3000/#/present/example-token');
});

test('a pending-draft member can toggle readiness and sees the league readiness chips', async () => {
  renderBoardWithToasts(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending', owner_id: 99 }), {
    teams: [
      { teamId: 1, teamName: 'Team A', draft_ready: false },
      { teamId: 2, teamName: 'Team B', draft_ready: true },
    ],
    onTheClock: null,
  })));

  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 managers ready');
  expect(screen.getByText('Team B: Ready')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'I am ready for the draft' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/ready', { ready: true }));
});

test('shows projected points and injury badges in the available players table', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      {
        id: 1,
        name: 'Patrick Mahomes',
        position: 'QB',
        nfl_team: 'Kansas City Chiefs',
        projected_points: 21.5,
        injury_status: 'Q',
      },
      { id: 2, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills', projected_points: null, adp: 3.2 },
    ])
  );
  renderBoard(1);

  await screen.findByText('Patrick Mahomes');
  expect(screen.getByText('21.5')).toBeInTheDocument();
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(screen.getByText('3.2')).toBeInTheDocument(); // Josh Allen's ADP
  expect(screen.getByLabelText(/17-game pace: Historical pace:/)).toBeInTheDocument();
  expect(screen.getAllByText('-').length).toBeGreaterThan(0); // missing proj/adp render as -
  // The name is a quick-view trigger (a button), not a navigation link.
  expect(screen.getByRole('button', { name: 'Patrick Mahomes' })).toBeInTheDocument();
});

test('shows a sortable Pos rank column so IDP players (no ADP) still order sensibly', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      // An IDP player: no ADP by design, ranked from last season's points.
      { id: 3, name: 'Jordyn Brooks', position: 'LB', nfl_team: 'DET', adp: null, position_rank: 1, projected_points: 160.2 },
      { id: 4, name: 'Rookie Backer', position: 'LB', nfl_team: 'DAL', adp: null, position_rank: null, projected_points: null },
    ])
  );
  renderBoard(1);

  await screen.findByText('Jordyn Brooks');
  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getByLabelText(/Pos rank: Position rank:/)).toBeInTheDocument();

  // Clicking the header re-fetches with the server's whitelisted sort key.
  apiClient.get.mockClear();
  await userEvent.click(screen.getByText('Pos rank'));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: expect.objectContaining({ sort: 'position_rank' }),
    })
  );
});

test('shows each pool player\'s bye week, with an em dash when the schedule is unknown', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC', adp: 12.1, position_rank: 1, projected_points: 380.5, bye_week: 10 },
      { id: 2, name: 'Rookie Backer', position: 'LB', nfl_team: 'DAL', adp: null, position_rank: null, projected_points: null, bye_week: null },
    ])
  );
  renderBoard(1);

  await screen.findByText('Patrick Mahomes');
  expect(screen.getByText('Bye')).toBeInTheDocument();
  expect(within(screen.getByText('Patrick Mahomes').closest('tr')).getByText('10')).toBeInTheDocument();
  const rookieCells = within(screen.getByText('Rookie Backer').closest('tr')).getAllByText('-');
  expect(rookieCells.length).toBeGreaterThan(0);
});

test('clicking a player name opens the quick-view dialog and never drafts the player', async () => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/summary')
      ? Promise.resolve({
          data: {
            player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
            currentSeason: null,
            previousSeasons: [],
          },
        })
      : Promise.resolve(playersPage())
  );
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByRole('button', { name: 'Patrick Mahomes' }));

  // Dialog opened (heading shows the player); no draft:pick was ever emitted.
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(
    fakeSocket.emit.mock.calls.some(([event]) => event === 'draft:pick')
  ).toBe(false);
});

// --- State-correct player actions, Pick-safe manual Draft (#120, parent #108) ---
// status (pending/active/complete) x type (snake/linear/autopick/offline) x
// turn ownership x pause x completion. Snake/linear are the same draft_type
// ('snake') differing only in draft_rotation, which pickActionExists doesn't
// key on; autopick and offline get their own coverage below.

test('a pending draft never renders a manual Draft control in the pool table or Quick View, only Queue', async () => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/summary')
      ? Promise.resolve({
          data: {
            player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
            currentSeason: null,
            previousSeasons: [],
          },
        })
      : Promise.resolve(playersPage())
  );
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'pending' },
      teams: [],
      picks: [],
      onTheClock: null,
    })
  );

  expect(screen.queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Queue' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Patrick Mahomes' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Queue' })).toBeInTheDocument();
});

test('a complete draft never renders a manual Draft control', async () => {
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'complete' },
      teams: [{ teamId: 1, teamName: 'Team A' }],
      picks: [],
      onTheClock: null,
    })
  );

  expect(screen.queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
});

test('an autopick-type active draft never renders a manual Draft control - table, Quick View, or queue rail', async () => {
  mockGets({ queue: [{ id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 }] });
  renderBoard(1);
  await screen.findByRole('button', { name: 'Bijan Robinson' });
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague({ draft_type: 'autopick' }), {
        teams: [{ teamId: 1, teamName: 'Team A' }],
        onTheClock: { teamId: 1, teamName: 'Team A' }, // even "on the clock"
      })
    )
  );

  // Autopick-type drafts are read-only for the manager: no manual Draft
  // control anywhere, even though this viewer is nominally on the clock.
  expect(screen.queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
});

test('an offline-type active draft never renders a manual Draft control from the player-row/Quick View surfaces', async () => {
  mockGets({ queue: [{ id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 }] });
  renderBoard(1);
  await screen.findByRole('button', { name: 'Bijan Robinson' });
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague({ draft_type: 'offline' }), {
        teams: [{ teamId: 1, teamName: 'Team A' }],
        onTheClock: { teamId: 1, teamName: 'Team A' },
      })
    )
  );

  // The offline commissioner-entry workflow lives outside this table (and is
  // untouched here); a live 'draft:pick' from these surfaces would just 409.
  expect(screen.queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
});

test('an already-drafted pool row hides both Draft and Queue entirely, keeping only the Drafted chip', async () => {
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague(), {
        teams: [{ teamId: 1, teamName: 'Team A' }],
        picks: [{ pick_number: 1, team_id: 1, player_id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' }],
        onTheClock: { teamId: 1, teamName: 'Team A' },
      })
    )
  );

  const table = screen.getByRole('table');
  const row = within(table).getByRole('button', { name: 'Patrick Mahomes' }).closest('tr');
  expect(within(row).getByText('Drafted')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument();
});

test('Quick View shows Draft as focusable aria-disabled with the shared explanation off-turn, and suppresses activation', async () => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/summary')
      ? Promise.resolve({
          data: {
            player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
            currentSeason: null,
            previousSeasons: [],
          },
        })
      : Promise.resolve(playersPage())
  );
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B })) // not this viewer
  );

  await userEvent.click(screen.getByRole('button', { name: 'Patrick Mahomes' }));
  const dialog = await screen.findByRole('dialog');
  const draftAction = within(dialog).getByRole('button', { name: 'Draft' });
  expect(draftAction).not.toBeDisabled();
  expect(draftAction).toHaveAttribute('aria-disabled', 'true');

  await userEvent.click(draftAction);
  expect(fakeSocket.emit.mock.calls.some(([event]) => event === 'draft:pick')).toBe(false);
  expect(screen.queryByText('Draft Patrick Mahomes?')).not.toBeInTheDocument();
});

test('a stale confirmation (the turn moved on while the dialog sat open) never commits', async () => {
  renderBoardWithToasts(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_A })) // my turn
  );

  await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Draft Patrick Mahomes?')).toBeInTheDocument();

  // The confirmation sits open while the turn moves on without the manager -
  // their pick clock expired and autodraft resolved it, say - which never
  // touches the pending confirmation itself.
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B })) // no longer my turn
  );

  await userEvent.click(within(dialog).getByRole('button', { name: 'Draft Patrick Mahomes' }));

  expect(fakeSocket.emit.mock.calls.some(([event]) => event === 'draft:pick')).toBe(false);
  expect(await screen.findByText(PICK_UNAVAILABLE_EXPLANATION)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

// --- Schedule-aware pool: columns, Column guide, Bye filter, Bye overlap ---
// (issue #119, parent spec #108)

test('the final columns are exactly Name/Position/NFL Team/Bye/ADP/Pos rank/17-game pace/Actions', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  const table = screen.getByRole('table');
  // Render index, Draft value, and Tier are all absent from this table.
  expect(within(table).queryByText(/^#$/)).not.toBeInTheDocument();
  expect(within(table).queryByText('Draft value')).not.toBeInTheDocument();
  expect(within(table).queryByText('Tier')).not.toBeInTheDocument();
  expect(within(table).queryByText('Season Proj')).not.toBeInTheDocument();

  for (const label of ['Name', 'Position', 'NFL Team', 'ADP', '17-game pace', 'Actions']) {
    expect(within(table).getByText(label)).toBeInTheDocument();
  }
  // Bye and Pos rank headers carry their AbbreviationTooltip aria-label
  // (asserted precisely in the tests below) rather than a plain text node.
  expect(within(table).getByRole('button', { name: /^Bye:/ })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: /^Pos rank:/ })).toBeInTheDocument();
});

test('NFL Team and Bye headers are sortable and pass the server field name through', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();

  await userEvent.click(screen.getByText('NFL Team'));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: expect.objectContaining({ sort: 'nfl_team' }),
    })
  );

  apiClient.get.mockClear();
  await userEvent.click(screen.getByRole('button', { name: /^Bye:/ }));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: expect.objectContaining({ sort: 'bye_week' }),
    })
  );
});

test('the Bye-weeks multi-select filters across the pool and renders removable chips', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(playersPage([]));

  await userEvent.click(screen.getByLabelText('Bye week'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 9' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 6' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: expect.objectContaining({ byeWeeks: '6,9' }), // sorted regardless of pick order
    })
  );
  expect(screen.getByText('Bye 6')).toBeInTheDocument();
  expect(screen.getByText('Bye 9')).toBeInTheDocument();
});

test('shows a neutral Bye overlap hint for a candidate sharing a Bye with a rostered player', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/team/roster') {
      // The caller's own roster already holds a KC player on Bye 10 (Travis
      // Kelce) - Patrick Mahomes below shares that same Bye as a candidate.
      return Promise.resolve({
        data: [{ id: 99, name: 'Travis Kelce', position: 'TE', nfl_team: 'KC', bye_week: 10 }],
      });
    }
    return Promise.resolve(
      playersPage([
        { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC', bye_week: 10 },
        { id: 2, name: 'No Overlap Guy', position: 'RB', nfl_team: 'DAL', bye_week: 6 },
      ])
    );
  });
  renderBoard(1);

  await screen.findByText('Patrick Mahomes');
  const overlapHint = await screen.findByLabelText(/Bye overlap: 1 rostered player.*Travis Kelce/);
  expect(overlapHint).toBeInTheDocument();
  // No overlap for the other row (different Bye week).
  expect(
    within(screen.getByText('No Overlap Guy').closest('tr')).queryByLabelText(/Bye overlap/)
  ).not.toBeInTheDocument();
  // Neutral: no "conflict"/"risk"/"warning" language anywhere near the hint.
  expect(overlapHint.getAttribute('aria-label')).not.toMatch(/conflict|risk|warning/i);
});

test('missing 17-game pace shows a neutral placeholder with a keyboard-accessible explanation', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      { id: 1, name: 'Rookie No Pace', position: 'WR', nfl_team: 'DAL', projected_points: null },
    ])
  );
  renderBoard(1);

  await screen.findByText('Rookie No Pace');
  const row = within(screen.getByText('Rookie No Pace').closest('tr'));
  // Several cells can render a plain "-" (Bye/ADP/Pos rank); only the pace
  // cell's placeholder is keyboard-focusable with an explanatory tooltip.
  const placeholder = row.getAllByText('-').find((el) => el.getAttribute('tabIndex') === '0');
  expect(placeholder).toBeTruthy();
});

test('the Column guide is a keyboard-reachable dialog explaining abbreviations and injury-status codes', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByRole('button', { name: 'Column guide' }));

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Column guide')).toBeInTheDocument();
  expect(within(dialog).getByText('17-game pace')).toBeInTheDocument();
  expect(within(dialog).getByText('IR')).toBeInTheDocument();
  expect(within(dialog).getByText('Injured Reserve')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

// ---------------------------------------------------------------------------
// My Roster (src/components/RosterPanel/) - the league supplies its own shape.
// ---------------------------------------------------------------------------

/** 12 starters, 7 bench, 1 IR: the server derives roster_limit 20 from these. */
const ROSTER_SLOTS_12 = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
  { key: 'D LINE', count: 1, eligiblePositions: ['DL'] },
  { key: 'LB', count: 1, eligiblePositions: ['LB'] },
  { key: 'DB', count: 1, eligiblePositions: ['DB'] },
];

const rosterLeague = (overrides = {}) => activeLeague({
  roster_slots: ROSTER_SLOTS_12,
  bench_slots: 7,
  ir_slots: 1,
  roster_limit: 20,
  // leagues.current_pick is 0-based, so this is the third pick overall.
  current_pick: 2,
  draft_rotation: 'snake',
  ...overrides,
});

const rosterTeams = [
  { teamId: 1, teamName: 'Team A', draft_position: 1 },
  { teamId: 2, teamName: 'Team B', draft_position: 2 },
];

const firstPick = {
  pick_number: 1, teamId: 1, teamName: 'Team A', player_id: 10,
  name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL',
};

const showRoster = async (picks) => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);
  act(() => fakeSocket.trigger('draft:state', stateEvent(rosterLeague(), {
    teams: rosterTeams,
    picks,
    onTheClock: TEAM_A,
  })));
};

test('renders the league’s own 12 starter / 7 bench / 1 IR shape across rail and board', async () => {
  await showRoster([firstPick]);

  const panel = screen.getByLabelText('My Roster');
  expect(within(panel).getAllByRole('listitem')).toHaveLength(20);
  expect(within(panel).getByLabelText('RB 1 slot, Bijan Robinson, RB, ATL, pick 1.01')).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Injured reserve' })).getAllByRole('listitem'))
    .toHaveLength(1);
  expect(screen.getByText('1 of 12 starters filled')).toBeInTheDocument();
  // The draft runs 19 rounds for 12 starters + 7 bench; the IR slot is not
  // drafted, so there is nothing to warn about (#96).
  expect(screen.queryByText(/This draft runs/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
  expect(screen.getByRole('rowheader', { name: '19' })).toBeInTheDocument();
  expect(screen.queryByRole('rowheader', { name: '20' })).not.toBeInTheDocument();
});

test('names the next pick from the league’s own rotation', async () => {
  await showRoster([firstPick]);
  // Two teams, snake: pick 0 was Team A, 1 and 2 are Team B and... the third
  // pick overall is on the clock, so Team A is next up at 2.02.
  expect(screen.getByText('Next pick 2.02')).toBeInTheDocument();
});

test('skips a keeper the team already holds when naming the next pick', async () => {
  await showRoster([
    firstPick,
    {
      pick_number: 4, teamId: 1, teamName: 'Team A', player_id: 11, is_keeper: true,
      name: 'Kept Guy', position: 'WR', nfl_team: 'BUF',
    },
  ]);

  // 2.02 is Team A's next turn by rotation, but a keeper is already sitting on
  // it, so the next pick they actually make is 3.01.
  expect(screen.getByText('Next pick 3.01')).toBeInTheDocument();
  expect(screen.getByText('Keeper')).toBeInTheDocument();
});

test('tags the manager’s own picks in the history with the slot they filled', async () => {
  // The history moved to the Board, but it is still handed the viewer's own
  // slot assignment, so their picks keep the slot tag other Teams' cannot have.
  await showRoster([firstPick]);
  await openPickHistory();
  expect(screen.getByText('→ RB 1')).toBeInTheDocument();
});

test('keeps the roster section out of the DOM until the league shape arrives', async () => {
  renderBoardWithToasts(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending', owner_id: 99 }), {
    teams: [
      { teamId: 1, teamName: 'Team A', draft_ready: false },
      { teamId: 2, teamName: 'Team B', draft_ready: true },
    ],
    onTheClock: null,
  })));

  expect(screen.queryByLabelText('My Roster')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Roster needs')).not.toBeInTheDocument();
  // And the managers-ready line stays the ONE status region: RosterNeedsStrip
  // uses a bare aria-live precisely so this singular query keeps working.
  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 managers ready');
});

// ---------------------------------------------------------------------------
// Accessible structure (issue #121, parent spec #108): landmarks, headings.
// ---------------------------------------------------------------------------

describe('accessible structure', () => {
  /** A commissioner who also owns a team, active draft with the league's own
   * roster shape, so every optional panel (commissioner controls, roster,
   * live banner) mounts at once. The viewer holds Team A through the join
   * acknowledgement, and is the league's commissioner by account (the one
   * check on this page that is still an account comparison - see #178). */
  const showFullBoard = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(rosterLeague({
      owner_id: 5,
      pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
    }), {
      teams: rosterTeams,
      picks: [firstPick],
      onTheClock: TEAM_A,
    })));
    await screen.findByText('Sunday Ballers');
  };

  test('wraps the page content in a single <main>, named by the league heading', async () => {
    await showFullBoard();

    const main = screen.getByRole('main');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Sunday Ballers');
    // The main landmark's accessible name comes from that same H1 (via
    // aria-labelledby), not a separately hardcoded string.
    expect(main).toHaveAccessibleName('Sunday Ballers');
    expect(main).toContainElement(h1);
  });

  test('exposes the league name as the single H1, panel titles as H2, no skipped levels', async () => {
    await showFullBoard();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Sunday Ballers');

    // showFullBoard is an ACTIVE draft, so this is the active composition
    // (issue #123 acceptance criterion 2): Draft order is behind the Upcoming
    // disclosure and Pick history has moved to the Board.
    const h2Names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2Names).toEqual(expect.arrayContaining([
      'Available Players', 'My Queue', 'My Roster', 'Upcoming',
    ]));

    // The live "27s" pick clock used to render as a second, competing <h1>
    // (LiveDraftBanner) - regression coverage for that specific bug.
    expect(screen.getByTestId('draft-clock').tagName).not.toBe('H1');

    // No heading level from 1 up to the deepest one used is ever skipped.
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    const maxLevel = Math.max(...levels);
    for (let level = 1; level <= maxLevel; level += 1) {
      expect(levels).toContain(level);
    }
  });

  test('exposes each rendered panel as a named region, not a bare div', async () => {
    await showFullBoard();

    // Available Players and Draft rail (issue #122 acceptance criterion 1):
    // desktop's two named, focusable dual-scroll regions.
    const playersRegion = screen.getByRole('region', { name: 'Available Players' });
    expect(playersRegion).toBeInTheDocument();
    expect(playersRegion).toHaveAttribute('tabIndex', '0');
    const railRegion = screen.getByRole('region', { name: 'Draft rail' });
    expect(railRegion).toBeInTheDocument();
    expect(railRegion).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('region', { name: 'My Queue' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'My Roster' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Commissioner draft controls' })).toBeInTheDocument();

    // Switching to the Board tab swaps in the matrix's own named region, plus
    // the Pick history that now lives inside Board - the panel set changes by
    // view, and each one it renders is still named.
    await openPickHistory();
    expect(screen.getByRole('region', { name: 'Draft Board' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pick history' })).toBeInTheDocument();
  });

  test('the pending-draft readiness panel is a named region too', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending', owner_id: 99 }), {
      teams: [
        { teamId: 1, teamName: 'Team A', draft_ready: false },
        { teamId: 2, teamName: 'Team B', draft_ready: true },
      ],
      onTheClock: null,
    })));

    // Named for the term itself (CONTEXT.md: Readiness), and a real H2 now
    // that it is the first panel of the pending composition.
    expect(screen.getByRole('region', { name: 'Readiness' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Readiness' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Mobile tab-card layout (issue #122): below the medium breakpoint, three
// persistent tabs (Players/Board/Draft) replace desktop's dual-pane
// workspace, each its own single scroll region.
// ---------------------------------------------------------------------------

describe('mobile layout (issue #122)', () => {
  // Same matchMedia-mock convention used elsewhere in this codebase (see
  // PlayerQuickView.test.jsx, PowerRankings.test.jsx): jsdom has no real
  // media-query engine, so every query the component asks resolves to this
  // one flag regardless of its breakpoint text.
  beforeEach(() => {
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });
  afterEach(() => {
    delete window.matchMedia;
  });

  const showMobileActiveDraft = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByText('Patrick Mahomes');
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }), {
      teams: [{ teamId: 1, teamName: 'Team A' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })));
  };

  test('exposes persistent Players, Board, and Draft tabs, in that order, landing on Players', async () => {
    await showMobileActiveDraft();

    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Players', 'Board', 'Draft']);
    expect(screen.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
    // The player pool renders by default - no tab switch needed.
    expect(screen.getByText('Patrick Mahomes')).toBeInTheDocument();
    expect(screen.queryByText('My Queue')).not.toBeInTheDocument();
  });

  test('the Draft tab shows the rail and not the player pool - a single region at a time', async () => {
    await showMobileActiveDraft();

    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));

    expect(screen.getByText('My Queue')).toBeInTheDocument();
    expect(screen.queryByText('Patrick Mahomes')).not.toBeInTheDocument();
  });

  test('the Board tab shows the matrix and not the player pool or the rail', async () => {
    await showMobileActiveDraft();

    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));

    expect(screen.getByRole('region', { name: 'Draft Board' })).toBeInTheDocument();
    expect(screen.queryByText('Patrick Mahomes')).not.toBeInTheDocument();
    expect(screen.queryByText('My Queue')).not.toBeInTheDocument();
  });

  test('on-the-clock information (LiveDraftBanner) stays visible across every mobile tab', async () => {
    await showMobileActiveDraft();
    expect(screen.getByText('Team A is on the clock')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByText('Team A is on the clock')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    expect(screen.getByText('Team A is on the clock')).toBeInTheDocument();
  });

  test('renders player cards, not a table, on the Players tab', async () => {
    await showMobileActiveDraft();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Patrick Mahomes')).toBeInTheDocument();
  });
});
