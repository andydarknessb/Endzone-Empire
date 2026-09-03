import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, useLocation } from 'react-router-dom';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import publicApiClient from '../../api/publicApiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import AuthenticatedPlayerProfilePage from '../PlayerDetail/AuthenticatedPlayerProfilePage';
import { PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';
import { FORMER_MANAGER_LABEL } from '../../lib/teamIdentity';
import DraftBoard from './DraftBoard';
import PlayerPoolTableProbe from './PlayerPoolTable';
import { railCompositionFor, RAIL_PANELS } from './railComposition';
import { DRAFT_ASSISTANT_KEY } from '../../lib/draftAssistantPreference';
import { fillTemplate, TRIGGERS, POLK_HIGH_LEGEND_LINES } from '../../lib/draftAssistant';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

// A render probe on a memo-free sibling of the pick clock (#754 amendments A7):
// PlayerPoolTable renders whenever DraftBoard renders, so its count is a direct
// reading of whether the room root re-rendered. The real component still
// renders underneath, so every other test in this file is unaffected.
jest.mock('./PlayerPoolTable', () => {
  const actual = jest.requireActual('./PlayerPoolTable');
  const ReactForProbe = jest.requireActual('react');
  const renderSpy = jest.fn();
  const Probe = (props) => {
    renderSpy();
    return ReactForProbe.createElement(actual.default, props);
  };
  Probe.renderSpy = renderSpy;
  return { __esModule: true, default: Probe };
});

// The readiness announcer (#164) is no longer the only role=status region in
// the Draft room: the composer's character counter (#486) mounts its own polite
// status region, and the countdown (#117) mounts one when a draft date is set.
// So a bare getByRole('status') is ambiguous - the invariant this file cares
// about is the readiness region specifically, identified by its text, exactly as
// the "only readiness announcement" test below already does.
const readinessAnnouncer = () =>
  screen.getAllByRole('status').find((region) => /managers? ready/.test(region.textContent));

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
    isCommissioner: false,
    // The GIF-message capability the server answers on the same per-viewer join
    // ack (#516, #446 AC7). A test that wants the Draft-room composer sets this
    // and connects, exactly as it does for isCommissioner; off by default so the
    // picker stays absent unless a test asks for it.
    gifMessagesEnabled: false,
    // A socket is an EventEmitter: more than one consumer can listen for the
    // same event on one session. Since #435 the draft board (advance the clock,
    // land the pick) and the combined feed (append the Pick activity) both
    // listen for 'draft:picked' on this one session, so this records a LIST per
    // event rather than a single slot the second listener would overwrite -
    // mirroring the manager (`io`) below, which #433 made a list for the same
    // reason.
    on: jest.fn((event, cb) => {
      (handlers[event] = handlers[event] || []).push(cb);
    }),
    off: jest.fn((event, cb) => {
      if (handlers[event]) handlers[event] = handlers[event].filter((h) => h !== cb);
    }),
    io: {
      // The socket.io manager is an EventEmitter: more than one consumer can
      // listen for 'reconnect' on the same session. Since #433 the draft room
      // (re-join) and league chat (re-sync history) both do, so this records a
      // list per event rather than a single slot that the second listener
      // would overwrite.
      on: jest.fn((event, cb) => {
        (managerHandlers[event] = managerHandlers[event] || []).push(cb);
      }),
      off: jest.fn((event, cb) => {
        if (managerHandlers[event]) managerHandlers[event] = managerHandlers[event].filter((h) => h !== cb);
      }),
    },
    emit: jest.fn((event, payload, ack) => {
      if (event === 'draft:join' && typeof ack === 'function') {
        ack({
          ok: true,
          viewerTeamId: socket.viewerTeamId,
          isCommissioner: socket.isCommissioner,
          gifMessagesEnabled: socket.gifMessagesEnabled,
        });
      }
    }),
    disconnect: jest.fn(),
    trigger(event, payload) {
      (handlers[event] || []).forEach((cb) => cb(payload));
    },
    triggerManager(event, payload) {
      (managerHandlers[event] || []).forEach((cb) => cb(payload));
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
const connectAsTeam = (teamId, { isCommissioner = false, gifMessagesEnabled = false } = {}) => {
  fakeSocket.viewerTeamId = teamId;
  // Set on every connect, never left standing from an earlier one: one test
  // can render the room twice off the same fake socket, and a role that
  // leaked from the first render would answer for the second.
  fakeSocket.isCommissioner = isCommissioner;
  // The capability travels the same way, re-answered on every connect (#516).
  fakeSocket.gifMessagesEnabled = gifMessagesEnabled;
  act(() => fakeSocket.trigger('connect'));
};

/**
 * Connect as a manager the server has answered "you are a commissioner of
 * this league" (#178). That answer is the ack's alone: the room reads no
 * `owner_id` and no signed-in account id, so a test that wants the
 * commissioner controls has to connect, exactly as the app does.
 */
const connectAsCommissioner = (teamId = null) => connectAsTeam(teamId, { isCommissioner: true });

/**
 * Refuse the LATEST `draft:join` the way the server does (#230). The fake
 * answers a join with success, so a refusal has to be delivered to the
 * acknowledgement callback of the join that already went out - which is also
 * what happens on the wire: the viewer joined, and it is the NEXT join, on a
 * reconnect, that is refused.
 */
const refuseJoin = (error, code) => {
  const joins = fakeSocket.emit.mock.calls.filter(([event]) => event === 'draft:join');
  const [, , ack] = joins[joins.length - 1];
  act(() => ack(code === undefined ? { error } : { error, code }));
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
 * Pick history lives inside the Board (issue #123 acceptance criterion 5),
 * where it is a collapsible chronological view of the same committed Picks the
 * matrix is built from. Anything that asserts on history shows the Board first
 * and expands it, exactly as a manager would. On a wide container (the unit
 * tests' default) the Board is the left pane, selected by its Players/Board
 * toggle button rather than a tab (#444).
 */
const showBoard = () => userEvent.click(screen.getByRole('button', { name: 'Board' }));

const openPickHistory = async () => {
  await showBoard();
  const trigger = screen.getByRole('button', { name: 'Pick history' });
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger);
};

/**
 * Once a draft is live the rail shows the compact Upcoming strip, and the full
 * Draft order - with manager-own / commissioner-all Autodraft switches - sits
 * behind a disclosure inside it (issue #123 acceptance criterion 2).
 */
const openFullDraftOrder = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Full Draft order' }));
};

let fakeSocket;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
let scrollIntoView;

beforeEach(() => {
  clearLeagueCache();
  scrollIntoView = jest.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  onReconnect.mockImplementation((socket, handler) => socket.io.on('reconnect', handler));
  apiClient.get.mockResolvedValue(playersPage());
  apiClient.put.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});
  publicApiClient.get.mockResolvedValue({ data: { rankings: [] } });
});

afterEach(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: originalScrollIntoView,
    });
  } else {
    delete HTMLElement.prototype.scrollIntoView;
  }
  clearLeagueCache();
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

test('ordinary Draft navigation does not claim focus or scroll the room', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  expect(screen.getByRole('main', { name: 'Draft Board' })).not.toHaveFocus();
  expect(scrollIntoView).not.toHaveBeenCalled();
});

test('returns through the real full profile to the exact freshly mounted Draft room', async () => {
  const draftSearch = '?view=players&pos=QB&q=Patrick+Mahomes&sort=proj&dir=desc&showDrafted=1&byes=6%2C10';
  let holdReturnedPlayerPool = false;
  let releaseReturnedPlayerPool;
  const returnedPlayerPool = new Promise((resolve) => {
    releaseReturnedPlayerPool = () => resolve(playersPage());
  });
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/players' && holdReturnedPlayerPool) return returnedPlayerPool;
    if (url === '/api/players/1/summary') {
      return Promise.resolve({
        data: {
          player: {
            id: 1,
            name: 'Patrick Mahomes',
            position: 'QB',
            nfl_team: 'Kansas City Chiefs',
          },
          fantasy: null,
          currentSeason: null,
          previousSeasons: [],
        },
      });
    }
    if (url === '/api/public/players/1') {
      return Promise.resolve({
        data: {
          playerId: 1,
          name: 'Patrick Mahomes',
          position: 'QB',
          nflTeam: 'KC',
          season: 2026,
          seasons: [{ season: 2026, status: 'pending' }],
          seasonSummary: null,
          weeklyLogPartial: false,
          recentGames: [],
        },
      });
    }
    if (url === '/api/league/10') {
      return Promise.resolve({ data: { league: { id: 10, scoring_preset: 'ppr' } } });
    }
    return Promise.resolve(playersPage());
  });

  function DraftLocation() {
    const location = useLocation();
    return (
      <output aria-label="Draft location">
        {JSON.stringify({
          pathname: location.pathname,
          search: location.search,
          state: location.state,
        })}
      </output>
    );
  }

  renderWithProviders(<><DraftBoard /><DraftLocation /></>, {
    path: '/league/:leagueId/draft',
    route: `/league/10/draft${draftSearch}`,
    routes: (
      <Route
        path="/players/:playerId"
        element={<AuthenticatedPlayerProfilePage />}
      />
    ),
  });

  await userEvent.click(await screen.findByRole('button', { name: 'Patrick Mahomes' }));
  await userEvent.click(await screen.findByRole('link', { name: /Full profile/i }));

  expect(await screen.findByRole('link', { name: 'Draft room' })).toHaveAttribute(
    'href',
    `/league/10/draft${draftSearch}`
  );
  expect(createDraftSocket).toHaveBeenCalledTimes(1);

  holdReturnedPlayerPool = true;
  await userEvent.click(screen.getByRole('link', { name: 'Draft room' }));

  const loadingMain = screen.getByRole('main');
  expect(loadingMain).toHaveAttribute('data-testid', 'page-skeleton');
  expect(loadingMain).not.toHaveFocus();
  expect(scrollIntoView).not.toHaveBeenCalled();

  await act(async () => releaseReturnedPlayerPool());
  await screen.findByRole('button', { name: 'Patrick Mahomes' });
  const draftMain = screen.getByRole('main', { name: 'Draft Board' });
  await waitFor(() => expect(draftMain).toHaveFocus());
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  expect(screen.getByRole('status', { name: 'Draft location' })).toHaveTextContent(
    JSON.stringify({
      pathname: '/league/10/draft',
      search: draftSearch,
      state: null,
    })
  );
  expect(createDraftSocket).toHaveBeenCalledTimes(2);

  act(() => fakeSocket.trigger('draft:state', {
    league: { name: 'Sunday Ballers', draft_status: 'pending' },
    teams: [],
    picks: [],
    onTheClock: null,
  }));
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
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

test('a manager can toggle their own Autodraft while another Team stays status-only', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(5);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', owner_id: 99 },
      teams: [
        { teamId: 5, teamName: "Bob's Team", draft_position: 1, autodraft: true },
        { teamId: 6, teamName: 'Other Team', draft_position: 2, autodraft: true },
      ],
      picks: [],
      onTheClock: null,
    })
  );

  await openFullDraftOrder();
  expect(screen.getByText('AUTO')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Autodraft for Other Team/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: /Autodraft for Bob's Team/ }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/teams/5/autodraft', { enabled: false })
  );
});

test('a commissioner toggling another Team\'s Autodraft posts to the endpoint', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner(5);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', owner_id: 99 },
      teams: [
        { teamId: 5, teamName: "Bob's Team", draft_position: 1, autodraft: false },
        { teamId: 6, teamName: 'Other Team', draft_position: 2, autodraft: false },
      ],
      picks: [],
      onTheClock: null,
    })
  );

  await openFullDraftOrder();
  await userEvent.click(screen.getByRole('checkbox', { name: /Autodraft for Other Team/ }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/teams/6/autodraft', { enabled: true })
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

test('puts the pending-draft start action in the Draft Room for commissioners', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();

  act(() => fakeSocket.trigger('draft:state', {
    league: {
      name: 'Sunday Ballers',
      draft_status: 'pending',
      draft_type: 'snake',
      min_teams: 2,
    },
    teams: [TEAM_A, TEAM_B],
    picks: [],
    onTheClock: null,
  }));

  const startButton = screen.getByRole('button', { name: 'Start Draft' });
  expect(startButton).toBeEnabled();
  await userEvent.click(startButton);
  await userEvent.click(screen.getByRole('button', { name: 'Start now' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/start-draft'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start draft now?' })).not.toBeInTheDocument());

  act(() => fakeSocket.trigger('draft:state', {
    league: { name: 'Sunday Ballers', draft_status: 'active' },
    teams: [TEAM_A, TEAM_B],
    picks: [],
    onTheClock: TEAM_A,
  }));
  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

test('does not show the pending-draft start action to a non-commissioner', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() => fakeSocket.trigger('draft:state', {
    league: { name: 'Sunday Ballers', draft_status: 'pending', min_teams: 2 },
    teams: [TEAM_A, TEAM_B],
    picks: [],
    onTheClock: null,
  }));

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

// --- the Start control's player-market state (#760) ---
//
// The room reads `market` from GET /api/league/:id (the shared useLeague
// resource) and hands it to DraftStartControl alongside the team-count/
// auction props it already passed - the same three states Draft Settings
// already renders for the same league. The socket `league` on draft:state
// carries no `market` field at all (#748 decision 3 attaches it to the
// detail payload only), so these cases are what proves the room is reading
// the second source rather than the snapshot.

const pendingCommissionerState = () => ({
  league: {
    name: 'Sunday Ballers',
    draft_status: 'pending',
    draft_type: 'snake',
    min_teams: 2,
  },
  teams: [TEAM_A, TEAM_B],
  picks: [],
  onTheClock: null,
});

test('renders the market-absent copy inside the room and disables Start when adpPlayers is below floor (#760)', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/draft/queue') return Promise.resolve({ data: [] });
    // adpPlayers (5) below floor (10): the fixture that makes this case red
    // is raising adpPlayers to equal floor, per the acceptance criterion.
    if (url === '/api/league/1') {
      return Promise.resolve({
        data: { league: { market: { adpPlayers: 5, floor: 10, lastSyncAt: null, stale: true } } },
      });
    }
    return Promise.resolve(playersPage());
  });
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();

  act(() => fakeSocket.trigger('draft:state', pendingCommissionerState()));

  await screen.findByText('The player market has not loaded (5 of 10 players carry an ADP). Ask your admin to run the ADP sync.');
  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled();
});

test('renders the market-stale copy inside the room with Start still enabled (#760)', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/draft/queue') return Promise.resolve({ data: [] });
    if (url === '/api/league/1') {
      return Promise.resolve({
        data: {
          league: {
            market: {
              adpPlayers: 50, floor: 10, lastSyncAt: '2026-08-01T00:00:00Z', stale: true,
            },
          },
        },
      });
    }
    return Promise.resolve(playersPage());
  });
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();

  act(() => fakeSocket.trigger('draft:state', pendingCommissionerState()));

  await screen.findByText(/Player market last updated/);
  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled();
});

test('renders neither market string inside the room when the market is fresh (#760)', async () => {
  let resolveLeagueDetail;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/draft/queue') return Promise.resolve({ data: [] });
    if (url === '/api/league/1') return new Promise((resolve) => { resolveLeagueDetail = resolve; });
    return Promise.resolve(playersPage());
  });
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();

  act(() => fakeSocket.trigger('draft:state', pendingCommissionerState()));
  const startButton = await screen.findByRole('button', { name: 'Start Draft' });
  expect(startButton).toBeEnabled();

  // Resolve the detail request deliberately, rather than trusting an absence
  // that could just as easily mean the request never landed: only once a
  // fresh market has actually arrived does "no line" mean anything.
  await act(async () => {
    resolveLeagueDetail({
      data: {
        league: {
          market: {
            adpPlayers: 50, floor: 10, lastSyncAt: '2026-08-01T00:00:00Z', stale: false,
          },
        },
      },
    });
  });

  expect(screen.queryByText(/The player market has not loaded/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Player market last updated/)).not.toBeInTheDocument();
  expect(startButton).toBeEnabled();
});

test('a non-commissioner sees no market copy and no Start control even when the market is absent (#760)', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/draft/queue') return Promise.resolve({ data: [] });
    if (url === '/api/league/1') {
      return Promise.resolve({
        data: { league: { market: { adpPlayers: 5, floor: 10, lastSyncAt: null, stale: true } } },
      });
    }
    return Promise.resolve(playersPage());
  });
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() => fakeSocket.trigger('draft:state', pendingCommissionerState()));

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
  expect(screen.queryByText(/The player market has not loaded/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Player market last updated/)).not.toBeInTheDocument();
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
      auto: false,
    })
  );

  expect(screen.getByText('On the clock: Team B')).toBeInTheDocument();

  await openPickHistory();
  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Patrick Mahomes' }).length).toBeGreaterThan(0);
  // The landed Pick is attributed to the Team that made it. No account
  // identity rides on the broadcast any more (#344), so no username can reach
  // a rendered surface: the pick names the Team and nothing else.
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
      auto: false,
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
      auto: false,
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
      auto: false,
    })
  );

  expect(screen.getByText('Draft complete!')).toBeInTheDocument();
  // The status chip, in product language rather than the stored enum.
  expect(screen.getByText('Draft complete')).toBeInTheDocument();
  expect(screen.queryByText('complete')).not.toBeInTheDocument();

  // And the manager is NOT relocated. The draft completing in front of
  // someone is the moment they are most engaged with what they are reading,
  // and useDraftSocket flips draft_status in place on this frame - so a
  // completed-draft default keyed on the status alone would swap the left pane
  // to the Board from under them here. It opens the Board on arrival only. On
  // a wide container the left pane stays on Players (its own region present,
  // the Board's absent).
  expect(screen.getByRole('region', { name: 'Available Players' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Draft Board' })).not.toBeInTheDocument();
});

test('a draft that is already complete when the room opens lands on the Board', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'complete' },
      teams: [{ teamId: 1, teamName: 'Team A', draft_position: 1 }],
      picks: [],
      onTheClock: null,
    })
  );

  // On a wide container the completed-draft default puts the Board in the left
  // pane: its toggle is pressed and the Board's own region is present.
  expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('region', { name: 'Draft Board' })).toBeInTheDocument();
});

test('an explicit ?view= wins over the completed-draft default', async () => {
  // The first guard clause. Someone who asked for a view in the URL keeps it,
  // even on a draft that is already complete when the room opens. ?view=draft
  // is not the Board, so on a wide container the left pane stays on Players
  // rather than being moved to the Board by the completed-draft default.
  renderWithProviders(<DraftBoard />, {
    path: '/league/:leagueId/draft',
    route: '/league/1/draft?view=draft',
  });
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'complete' },
      teams: [{ teamId: 1, teamName: 'Team A', draft_position: 1 }],
      picks: [],
      onTheClock: null,
    })
  );

  expect(screen.getByRole('region', { name: 'Available Players' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Draft Board' })).not.toBeInTheDocument();
});

test('a pane the manager chose is never overridden afterwards', async () => {
  // The second guard clause, and the one the ref exists for: a deliberate
  // choice outranks the default even before the status is known. On a wide
  // container the choice is the left pane's Players/Board toggle; a manager
  // who has switched it back to Players keeps Players when the draft completes.
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);

  await userEvent.click(screen.getByRole('button', { name: 'Board' }));
  await userEvent.click(screen.getByRole('button', { name: 'Players' }));

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'complete' },
      teams: [{ teamId: 1, teamName: 'Team A', draft_position: 1 }],
      picks: [],
      onTheClock: null,
    })
  );

  expect(screen.getByRole('region', { name: 'Available Players' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Draft Board' })).not.toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// #534: league chat mounts ONLY for a confirmed member. Three states, not the
// old "socket exists" boolean: UNKNOWN (before the join ack) mounts nothing and
// issues no feed request; MEMBER mounts the feed/composer/moderation; NON_MEMBER
// shows one explicit message. NOT_A_MEMBER is the sole authority (matched on the
// code), and it can arrive on the join, on chat:send, or as a 403 from the feed.
// ---------------------------------------------------------------------------

describe('league chat is gated on confirmed membership (#534)', () => {
  const activeState = {
    league: { name: 'Sunday Ballers', draft_status: 'active', draft_paused: false },
    teams: [{ teamId: 1, teamName: 'Team A' }],
    picks: [],
    onTheClock: { teamId: 1, teamName: 'Team A' },
  };

  test('AC1: before the join ack decides, no chat mounts and no combined-feed request is issued', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');

    // The socket is created on mount, so the OLD `socket ?` gate would already
    // have mounted the log and composer here. Membership is UNKNOWN, so no member
    // log/composer and no non-member surface are shown...
    expect(screen.queryByRole('log', { name: 'League Chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Chat composer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('draft-chat-non-member')).not.toBeInTheDocument();
    // ...and, crucially, a request that would 403 for a non-member never left.
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/draft-feed'));
    // But the pane is not blank (a11y finding 4): a connecting placeholder shows,
    // so a mobile manager landing on the Chat tab does not see a broken page.
    expect(screen.getByTestId('draft-chat-connecting')).toBeInTheDocument();
  });

  test('AC2: a confirmed member gets the chat feed, composer and Send, and the feed read fires', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(2); // a member whose Team is not the one on the clock
    act(() => fakeSocket.trigger('draft:state', activeState));

    expect(await screen.findByRole('heading', { level: 2, name: 'League Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByTestId('draft-chat-non-member')).not.toBeInTheDocument();
    // The positive half of AC1: a confirmed member DOES issue the feed read.
    expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/draft-feed');
  });

  test('AC3: an initial NOT_A_MEMBER refusal shows one explicit message and mounts no log, composer, Send or moderation, and issues no feed request', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    // The join's ONLY acknowledgement is the refusal - an initial non-member,
    // never a member first. Discriminated on the code, never the message text.
    fakeSocket.emit = jest.fn((event, payload, ack) => {
      if (event === 'draft:join' && typeof ack === 'function') {
        ack({ error: 'you are not in this league', code: 'NOT_A_MEMBER' });
      }
    });
    act(() => fakeSocket.trigger('connect'));

    expect(await screen.findByTestId('draft-chat-non-member'))
      .toHaveTextContent('League chat is available to league members only.');
    // The log, composer, Send and moderation are all absent (AC3)...
    expect(screen.queryByRole('log', { name: 'League Chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Chat composer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    // ...but the section + h2 "League Chat" shell stays, so a heading-navigation
    // user still finds chat where it was rather than a gap (a11y finding 2).
    expect(screen.getByRole('heading', { level: 2, name: 'League Chat' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'League Chat' })).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/draft-feed'));
  });

  test('AC4: a confirmed member who gets a 403 from the member-only feed moves to the non-member surface without a reload', async () => {
    // The commissioner-removes-a-manager-mid-draft case, feed channel: the feed
    // route checks membership before it reads anything and answers 403.
    apiClient.get.mockImplementation((url) =>
      String(url).includes('/draft-feed')
        ? Promise.reject({ response: { status: 403 } })
        : Promise.resolve(playersPage())
    );
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(2);
    act(() => fakeSocket.trigger('draft:state', activeState));

    expect(await screen.findByTestId('draft-chat-non-member')).toBeInTheDocument();
    // The member log and composer are gone, but the section + h2 shell stays
    // (a11y finding 2), so this asserts the controls' absence, not the heading's.
    expect(screen.queryByRole('log', { name: 'League Chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  test('AC5: a JOIN_FAILED refusal on a reconnect leaves a confirmed member their chat and only surfaces the error', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(2);
    act(() => fakeSocket.trigger('draft:state', activeState));
    expect(await screen.findByRole('heading', { level: 2, name: 'League Chat' })).toBeInTheDocument();

    // A transient refusal on the next join must not strip a genuine member of
    // chat - it fails in the direction that only looks like caution.
    refuseJoin('failed to join draft room', 'JOIN_FAILED');

    expect(await screen.findByText('failed to join draft room')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'League Chat' })).toBeInTheDocument();
    expect(screen.queryByTestId('draft-chat-non-member')).not.toBeInTheDocument();
  });

  test('a11y: a mid-session revocation hands focus to the non-member surface, never to the body', async () => {
    // The same standard the room holds when a commissioner's Hide button is torn
    // out by a socket broadcast (draft-accessibility.spec.ts): a teardown must
    // hand focus somewhere deliberate. Here the composer is removed from under a
    // member; focus must land on the explicit non-member surface, not <body>.
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(2);
    act(() => fakeSocket.trigger('draft:state', activeState));

    const composer = await screen.findByLabelText('Message');
    act(() => composer.focus());
    expect(composer).toHaveFocus();

    // Removed mid-draft: the next join re-ack is NOT_A_MEMBER. The composer
    // unmounts and the membership edge fires the rescue (signal is arrangement
    // AND membership, so a membership change triggers it just like a pane flip).
    refuseJoin('you are not in this league', 'NOT_A_MEMBER');

    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('region', { name: 'League Chat' })).toHaveFocus();
  });
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

test('the banner clock renders m:ss from pick_deadline_at and ticks down', async () => {
  jest.useFakeTimers();
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
    })))
  );
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:30');

  act(() => {
    jest.advanceTimersByTime(3000);
  });
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:27');
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
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:05');

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      auto: false,
    })
  );
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('1:30');
});

test('a ticking pick clock re-renders only its own leaf, never the room (#754 A7)', async () => {
  jest.useFakeTimers();
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
    })))
  );
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:30');
  const roomRendersBefore = PlayerPoolTableProbe.renderSpy.mock.calls.length;

  act(() => {
    jest.advanceTimersByTime(3000);
  });

  // The clock moved, so the leaf ticked...
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:27');
  // ...and nothing above it did. Storing a per-second field in the socket
  // reducer again (the shape #754 first proposed) turns this red.
  expect(PlayerPoolTableProbe.renderSpy.mock.calls.length).toBe(roomRendersBefore);
});

test('crossing the Overdue boundary re-renders the room at most once, never per second (#769 AC4)', async () => {
  jest.useFakeTimers();
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 5000).toISOString(),
    })))
  );
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:05');
  const roomRendersBefore = PlayerPoolTableProbe.renderSpy.mock.calls.length;

  // Run through the deadline (5s) and well past the 30s tolerance. The leaf
  // ticks ~35 times on its own; the banner lifts a one-shot Overdue boolean at
  // the crossing (#769 ruling 4).
  act(() => {
    jest.advanceTimersByTime(5000 + 30000 + 2000);
  });

  // We really crossed: digits pin at 0:00 and the room shows the Overdue copy
  // (the leaf under the digits and the banner's once-per-turn announcement).
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:00');
  expect(screen.getAllByText('Waiting on the server').length).toBeGreaterThanOrEqual(1);
  // Isolation holds across the boundary: ~35 per-second ticks reach only the
  // leaf, and the banner's single re-render does not cascade to the pool. At
  // most one, not one per second.
  expect(PlayerPoolTableProbe.renderSpy.mock.calls.length).toBeLessThanOrEqual(roomRendersBefore + 1);
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

  const queuePanel = () => screen.getByRole('region', { name: 'My Queue' });

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

  const queuePanel = () => screen.getByRole('region', { name: 'My Queue' });
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

// Issue #216: the queue hook used to raise the same `loading` flag on the
// resync fetch it runs after a failed PUT as it did on the very first load,
// and the room ORed that into a page-wide `loading` that swapped in the
// skeleton whenever it was true - unmounting and remounting the whole room
// (board, live banner, rail) on a failed reorder. Node identity, not mere
// presence, is the only assertion that would have caught that: a component
// that unmounts and remounts into a look-alike node still passes a
// `toBeInTheDocument()` check.
test('a failed queue write shows an inline error in the queue panel and never remounts the room', async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoard(1);
  await screen.findByRole('button', { name: 'Bijan Robinson' });
  connectAsTeam(1);
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
    })))
  );
  await screen.findByTestId('draft-clock');

  const mainBefore = screen.getByRole('main');
  const clockBefore = screen.getByTestId('draft-clock');
  const railBefore = screen.getByRole('region', { name: 'Draft rail' });

  // The resync GET the queue hook fires after the rejected PUT is held open
  // deliberately, rather than left to resolve instantly like the mock
  // elsewhere in this file - a same-tick resolution lets React's automatic
  // batching coalesce a spurious `loading: true -> false` flip into one
  // commit and hide it from the test. Holding it open forces a real commit
  // while the resync is still in flight, which is exactly where the room
  // used to be showing the page skeleton (issue #216).
  let resolveResync;
  apiClient.get.mockImplementation((url) =>
    (url === '/api/draft/queue'
      ? new Promise((resolve) => { resolveResync = resolve; })
      : Promise.resolve(playersPage())));
  apiClient.put.mockRejectedValueOnce(new Error('Could not save queue'));

  await userEvent.click(screen.getAllByLabelText('Move up')[1]);

  // Identity, not presence, while the resync is still pending: a component
  // that unmounted and remounted into a look-alike node would still pass a
  // `toBeInTheDocument()`/`queryByText` check here.
  expect(screen.getByRole('main')).toBe(mainBefore);
  expect(screen.getByTestId('draft-clock')).toBe(clockBefore);
  expect(screen.getByRole('region', { name: 'Draft rail' })).toBe(railBefore);
  expect(screen.queryByTestId('page-skeleton')).not.toBeInTheDocument();

  const queuePanel = screen.getByRole('region', { name: 'My Queue' });
  expect(within(queuePanel).getByText('Could not save queue')).toBeInTheDocument();

  // Resolve the resync and confirm the room is still exactly as it was -
  // this is the moment the pre-fix code would have already skeletoned and
  // remounted, discarding these references.
  await act(async () => {
    resolveResync({
      data: [
        { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
        { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
      ],
    });
  });
  expect(screen.getByRole('main')).toBe(mainBefore);
  expect(screen.getByTestId('draft-clock')).toBe(clockBefore);
  expect(screen.getByRole('region', { name: 'Draft rail' })).toBe(railBefore);
  expect(screen.queryByTestId('page-skeleton')).not.toBeInTheDocument();

  // The failed write resynced from the server (rolling back the optimistic
  // reorder), which the queue's own order confirms happened.
  const queued = screen
    .getAllByRole('button', { name: /Bijan Robinson|Justin Jefferson/ })
    .map((b) => b.textContent);
  expect(queued).toEqual(['Bijan Robinson', 'Justin Jefferson']);
});

test('the page skeleton still renders before the pool and queue first resolve', async () => {
  let resolvePlayers;
  let resolveQueue;
  // /api/team/roster (useMyRoster) also fires on mount but isn't part of
  // `loading` - it resolves immediately so it can't be mistaken for one of
  // the two deferred promises below.
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/draft/queue') return new Promise((resolve) => { resolveQueue = resolve; });
    if (url === '/api/players') return new Promise((resolve) => { resolvePlayers = resolve; });
    return Promise.resolve({ data: [] });
  });

  renderBoard(1);
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();

  await act(async () => {
    resolvePlayers(playersPage());
    resolveQueue({ data: [] });
  });

  await screen.findByText('Patrick Mahomes');
  expect(screen.queryByTestId('page-skeleton')).not.toBeInTheDocument();
});

// --- who gets the commissioner controls (#178) ---
//
// The room asks the join acknowledgement and nothing else. Before #178 it
// asked the draft:state snapshot for `is_commissioner` (a field a bare
// `SELECT * FROM leagues` never has) and fell back to comparing the
// snapshot's owner_id against the signed-in account, so a co-commissioner
// was silently refused controls they hold everywhere else.

test('a co-commissioner who does not own the league gets the Draft room controls', async () => {
  renderBoard(1, { user: { id: 8, username: 'cocommish' } });
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner(2);
  act(() =>
    // owner_id is somebody else's, and this viewer still holds the controls.
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );

  expect(screen.getByRole('button', { name: 'Randomize Draft order' })).toBeInTheDocument();
});

test('the league owner gets the controls from the acknowledgement, not from owner_id', async () => {
  // The regression guard for deleting the owner_id fallback. #115 removed
  // account identity from league-shared payloads (#344 took it off this
  // snapshot's team rows), so the room is handed a snapshot it cannot derive
  // commissioner from: this fixture strips owner_id entirely. The controls
  // have to survive that, and they can only survive it via the ack.
  renderBoard(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner(1);
  const { owner_id: _ownerId, ...leagueWithoutOwner } = activeLeague({ draft_status: 'pending' });
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(leagueWithoutOwner, { onTheClock: null }))
  );

  expect(screen.getByRole('button', { name: 'Randomize Draft order' })).toBeInTheDocument();
});

test('the owner gets no controls when the acknowledgement never grants them', async () => {
  // The other half of the same guard: if the flag goes missing the room must
  // fail closed, and it must not quietly re-derive the answer from the fact
  // that this viewer's account id matches the snapshot's owner_id.
  renderBoard(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1); // connected, acknowledged, not a commissioner
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );

  expect(screen.queryByRole('button', { name: 'Randomize Draft order' })).not.toBeInTheDocument();
});

test('an ordinary manager gets no commissioner controls', async () => {
  renderBoard(1, { user: { id: 9, username: 'manager' } });
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(3);
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );

  expect(screen.queryByRole('button', { name: 'Randomize Draft order' })).not.toBeInTheDocument();
});

test('a NOT_A_MEMBER refusal takes the commissioner controls and the viewer’s own picks off the room', async () => {
  // #230. A viewer removed from the league while sitting in the draft room
  // learns of it on the re-join every reconnect makes, and this room is the
  // only thing that knows: it holds both viewer-relative values and nothing
  // else revisits them.
  //
  // Nothing was GRANTED by the stale display - the controls behind this flag
  // re-authorise server-side, and the one socket action authorises inside
  // startDraft - so what is repaired here is coherence, not access. The room
  // was telling a former manager that they were a commissioner of this league
  // and that one of these Teams was theirs. Both claims are now false, so both
  // go, together: they arrive on one acknowledgement and they leave on one.
  renderBoard(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner(1);
  act(() => fakeSocket.trigger('draft:state', stateEvent(rosterLeague(), {
    teams: rosterTeams,
    picks: [firstPick],
    onTheClock: TEAM_A,
  })));
  expect(screen.getByRole('button', { name: 'Pause Draft' })).toBeInTheDocument();
  // Two attributions, and they are not the same claim: a TAKEN pick sitting in
  // this viewer’s roster, and the UPCOMING picks offered as theirs. Both read
  // off viewerTeamId, so both have to go together - asserting only the upcoming
  // group would leave the drafted player still shown as this manager’s.
  expect(within(screen.getByLabelText('My Roster')).getByText('Bijan Robinson')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Upcoming' }))
    .getByRole('group', { name: 'My picks' })).toBeInTheDocument();

  refuseJoin('you are not in this league', 'NOT_A_MEMBER');

  expect(screen.queryByRole('button', { name: 'Pause Draft' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('My Roster')).not.toBeInTheDocument();
  // The panel still stands on its league-wide strip; only the viewer-relative
  // group is gone, exactly as it is for a spectator who never held a Team here.
  const upcoming = screen.getByRole('region', { name: 'Upcoming' });
  expect(within(upcoming).queryByRole('group', { name: 'My picks' })).not.toBeInTheDocument();
  expect(within(upcoming).getByRole('button', { name: 'Full Draft order' })).toBeInTheDocument();
});

test('a transient refusal leaves the commissioner controls exactly where they were', async () => {
  // The other half, and the one a refactor breaks: JOIN_FAILED says the
  // ATTEMPT failed, not that this viewer stopped being a commissioner. This
  // path runs on every reconnect, so clearing here would flicker the controls
  // off and back on a blip - rejected at triage as worse than a stale display.
  renderBoard(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner(1);
  act(() => fakeSocket.trigger('draft:state', stateEvent(rosterLeague(), {
    teams: rosterTeams,
    picks: [firstPick],
    onTheClock: TEAM_A,
  })));

  refuseJoin('failed to join draft room', 'JOIN_FAILED');

  expect(screen.getByRole('button', { name: 'Pause Draft' })).toBeInTheDocument();
  expect(within(screen.getByLabelText('My Roster')).getByText('Bijan Robinson')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Upcoming' }))
    .getByRole('group', { name: 'My picks' })).toBeInTheDocument();
});

test('Randomize Draft order shows only for the commissioner pre-draft and POSTs', async () => {
  const { unmount } = renderBoardWithToasts(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();
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

  // A manager the ack did not name a commissioner never sees the button
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(2);
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );
  expect(screen.queryByRole('button', { name: 'Randomize Draft order' })).not.toBeInTheDocument();
});

test('Pause Draft POSTs the toggled paused flag for the commissioner during an active draft', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 7 })))
  );

  await userEvent.click(screen.getByRole('button', { name: 'Pause Draft' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/pause', { paused: true })
  );
});

test('commissioner corrects the latest pick with a reason, posting the confirmed pick number (#439)', async () => {
  renderBoardWithToasts(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99, current_pick: 1 }), {
    picks: [{ pick_number: 1, teamId: 5, teamName: "Bob's Team", player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: false }],
  })));

  await userEvent.click(screen.getByRole('button', { name: 'Correct latest Pick' }));
  const dialog = screen.getByRole('dialog');
  // Names the Pick, Team and player being reversed (#439 AC4).
  expect(within(dialog).getByText(/Pick 1/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Bob's Team/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Josh Allen/)).toBeInTheDocument();

  // No premature POST while the reason is still missing.
  expect(apiClient.post).not.toHaveBeenCalledWith('/api/draft/league/1/correct-pick', expect.anything());

  await userEvent.type(within(dialog).getByRole('textbox', { name: /reason/i }), 'wrong team entered, correcting before we resume');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Correct pick' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/correct-pick', {
    pickNumber: 1,
    reason: 'wrong team entered, correcting before we resume',
  }));
  expect(await screen.findByText('Latest pick corrected; draft paused')).toBeInTheDocument();
});

test('Correct latest Pick is disabled when the most recent reached pick is a keeper', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99, current_pick: 1 }), {
    picks: [{ pick_number: 1, teamId: 5, teamName: "Bob's Team", player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: true }],
  })));

  expect(screen.getByRole('button', { name: 'Correct latest Pick' })).toBeDisabled();
  expect(screen.getByText('Keeper picks cannot be corrected.')).toBeInTheDocument();
});

test('reset draft requires the exact league name before calling the destructive endpoint', async () => {
  renderBoardWithToasts(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();
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
  renderBoardWithToasts(1);
  await screen.findByText('Patrick Mahomes');
  connectAsCommissioner();
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }))));

  await userEvent.click(screen.getByRole('button', { name: 'Presenter link' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/share-token', {}));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/#/present/example-token');
  expect(screen.getByRole('textbox', { name: 'Presenter link' })).toHaveValue('http://localhost:3000/#/present/example-token');
});

test('a pending-draft member can toggle readiness and sees the league readiness summary', async () => {
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

  expect(readinessAnnouncer()).toHaveTextContent('1 of 2 managers ready');
  // One of two is at or below half, so the ready Team is the exception worth
  // naming and it sits behind a disclosure rather than in a chip per Team
  // (issue #124). The whole path is exercised here - league teams through the
  // socket, readinessSummary, the rail's panel - because the unit tests either
  // side of it agree with each other whether or not they are wired together.
  const readiness = screen.getByRole('region', { name: 'Readiness' });
  await userEvent.click(within(readiness).getByRole('button', { name: 'Ready managers (1)' }));
  // Scoped to the panel: Team B also names a row of the Draft order below it.
  expect(within(readiness).getAllByRole('listitem').map((item) => item.textContent))
    .toEqual(['Team B']);

  await userEvent.click(screen.getByRole('button', { name: "I'm ready" }));
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

test('missing 17-game pace shows a neutral placeholder with a keyboard-accessible explanation', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      { id: 1, name: 'Rookie No Pace', position: 'WR', nfl_team: 'DAL', projected_points: null },
    ])
  );
  renderBoard(1);

  await screen.findByText('Rookie No Pace');
  const row = within(screen.getByRole('row', { name: /Rookie No Pace/ }));
  // Several cells can render a plain "-" (Bye/ADP/Pos rank); only the pace
  // cell's placeholder is keyboard-focusable with an explanatory tooltip.
  const placeholder = row.getAllByText('-').find((el) => el.getAttribute('tabIndex') === '0');
  expect(placeholder).toBeTruthy();
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
  await showBoard();
  expect(screen.getByRole('rowheader', { name: '19' })).toBeInTheDocument();
  expect(screen.queryByRole('rowheader', { name: '20' })).not.toBeInTheDocument();
});

test('names the next pick from the league’s own rotation', async () => {
  await showRoster([firstPick]);
  // Two teams, snake: pick 0 was Team A, 1 and 2 are Team B and... the third
  // pick overall is on the clock, so Team A is next up at 2.02.
  expect(screen.getByText('Next pick 2.02')).toBeInTheDocument();
});

test('names the viewer’s own next three Picks, with the rest behind the popover', async () => {
  // The wiring, not the arithmetic: viewerPicks.test.js already sweeps
  // rotations and league sizes. What this asks is whether the live league row,
  // its Teams and its committed Picks reach viewerPicksFor and come back out
  // on screen (issue #124 acceptance criterion 4). Two teams, snake, the third
  // pick of the draft on the clock, and Team A has already made 1.01.
  await showRoster([firstPick]);

  const upcoming = screen.getByRole('region', { name: 'Upcoming' });
  const myPicks = within(upcoming).getByRole('group', { name: 'My picks' });
  expect(within(myPicks).getByText('2.02 · 3.01 · 4.02')).toBeInTheDocument();

  // 19 Draft rounds (roster_limit 20 less the undraftable IR slot), less the
  // pick already made.
  await userEvent.click(within(myPicks).getByRole('button', { name: 'All 18 of my picks' }));
  const allPicks = screen.getByRole('dialog', { name: 'All my picks' });
  const listed = within(allPicks).getAllByRole('listitem').map((item) => item.textContent);
  expect(listed).toHaveLength(18);
  expect(listed[0]).toBe('2.02');
  expect(listed[listed.length - 1]).toBe('19.01');
});

test('reads the viewer’s Picks off a linear league’s own rotation, not a snake assumption', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  connectAsTeam(1);
  act(() => fakeSocket.trigger('draft:state', stateEvent(
    rosterLeague({ draft_rotation: 'linear', current_pick: 1 }),
    { teams: rosterTeams, picks: [], onTheClock: TEAM_A },
  )));

  const myPicks = within(screen.getByRole('region', { name: 'Upcoming' }))
    .getByRole('group', { name: 'My picks' });
  // Linear: slot 1 in every round. Under a snake reading the second of these
  // would be 2.02, which is a wait of one turn rather than three.
  expect(within(myPicks).getByText('2.01 · 3.01 · 4.01')).toBeInTheDocument();
});

test('a spectator with no Team here is offered no picks of their own', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  // viewerTeamId comes from the draft:join acknowledgement and never from a
  // broadcast (#112), so a spectator is one whose join ack carried no Team.
  connectAsTeam(null);
  act(() => fakeSocket.trigger('draft:state', stateEvent(rosterLeague(), {
    teams: rosterTeams,
    picks: [firstPick],
    onTheClock: TEAM_A,
  })));

  const upcoming = screen.getByRole('region', { name: 'Upcoming' });
  // The panel still stands on its league-wide strip; only the viewer-relative
  // group is gone. Verified to fail against a rail that defaults a spectator
  // to the first Team's picks.
  expect(within(upcoming).queryByRole('group', { name: 'My picks' })).not.toBeInTheDocument();
  expect(within(upcoming).getByRole('button', { name: 'Full Draft order' })).toBeInTheDocument();
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
  // The readiness announcement is resolved by text (readinessAnnouncer()
  // above is a plural getAllByRole('status').find(...), not a singular
  // query) precisely because it is not the room's only status region. The
  // element it matches is now the Draft room's ReadinessAnnouncer rather
  // than the rail's own line, which #164 stripped role/aria-live from -
  // same invariant, different element.
  expect(readinessAnnouncer()).toHaveTextContent('1 of 2 managers ready');
});

// ---------------------------------------------------------------------------
// Accessible structure (issue #121, parent spec #108): landmarks, headings.
// ---------------------------------------------------------------------------

describe('accessible structure', () => {
  /** A commissioner who also owns a team, active draft with the league's own
   * roster shape, so every optional panel (commissioner controls, roster,
   * live banner) mounts at once. Both viewer-relative facts come from the
   * join acknowledgement (#178): the viewer holds Team A, and the server has
   * told them they are a commissioner here. */
  const showFullBoard = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByText('Patrick Mahomes');
    connectAsCommissioner(1);
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

  test('wide layout gives the player pool the primary width and lets chat fill its column', async () => {
    await showFullBoard();

    expect(screen.getByTestId('draft-workspace')).toHaveStyle({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 59fr) minmax(0, 25fr) minmax(0, 16fr)',
      gridTemplateRows: 'minmax(0, 1fr)',
    });
    expect(screen.getByRole('region', { name: 'Chat and Draft activity' })).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });
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

/**
 * Put the describe that calls this on a NARROW container (#444 acceptance
 * criterion 3). The Draft room chooses panes vs tabs from its own measured
 * CONTAINER width (useContainerWidth), not a window media query. jsdom has no
 * layout engine and reports width 0 for every element, which the room reads as
 * wide (the default), so stubbing getBoundingClientRect to a narrow width is
 * how this file now says "narrow" - the room then collapses its three panes
 * into the Chat/Players/Board/Draft tabs. jsdom defines no ResizeObserver, so
 * the width measured once on attach is all these tests need.
 */
const mockNarrowContainer = () => {
  let originalGetBoundingClientRect;
  beforeEach(() => {
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return {
        width: 500, height: 0, top: 0, left: 0, right: 500, bottom: 0, x: 0, y: 0, toJSON() {},
      };
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });
};

// ---------------------------------------------------------------------------
// Narrow-container tab layout (#444 acceptance criterion 2): below the pane
// threshold, four persistent tabs (Chat/Players/Board/Draft) replace the
// three-pane workspace, each its own single scroll region, and Chat is the tab
// the room opens on. Supersedes the #122/#123 Players-first three-tab layout.
// ---------------------------------------------------------------------------

describe('narrow container layout (#444)', () => {
  mockNarrowContainer();

  test('a contextual return focuses and top-scrolls the final narrow-layout main', async () => {
    renderWithProviders(<DraftBoard />, {
      path: '/league/:leagueId/draft',
      route: {
        pathname: '/league/1/draft',
        search: '?view=players&pos=QB',
        state: { draftRoomReturn: true },
      },
    });

    await screen.findByRole('tab', { name: 'Players', selected: true });
    const draftMain = screen.getByRole('main', { name: 'Draft Board' });
    await waitFor(() => expect(draftMain).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  const showNarrowActiveDraft = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    // The tabs exist only once the room is narrow and loaded; the Chat tab is
    // the settled signal, and is also the tab the room opens on.
    await screen.findByRole('tab', { name: 'Chat' });
    // Connect as a CONFIRMED member (#534): league chat mounts only for one, so
    // the Chat tab lands on the real feed rather than the non-member surface.
    // The viewer holds Team 2, which is NOT the Team on the clock (Team A,
    // teamId 1), so the banner still reads "Team A is on the clock" rather than
    // "Your pick!" - the phrasing these tests depend on.
    connectAsTeam(2);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }), {
      teams: [{ teamId: 1, teamName: 'Team A' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })));
  };

  test('exposes persistent Chat, Players, Board, and Draft tabs, in that order, landing on Chat', async () => {
    await showNarrowActiveDraft();

    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Chat', 'Players', 'Board', 'Draft']);
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    // The Chat feed is the centerpiece the room opens on; the pool is not
    // mounted until its own tab is chosen (a single region at a time).
    expect(screen.getByRole('heading', { level: 2, name: 'League Chat' })).toBeInTheDocument();
    expect(screen.queryByText('Patrick Mahomes')).not.toBeInTheDocument();
  });

  test('the Players tab shows the pool and not the rail - a single region at a time', async () => {
    await showNarrowActiveDraft();

    await userEvent.click(screen.getByRole('tab', { name: 'Players' }));

    expect(screen.getByText('Patrick Mahomes')).toBeInTheDocument();
    expect(screen.queryByText('My Queue')).not.toBeInTheDocument();
  });

  test('the Draft tab shows the rail and not the player pool - a single region at a time', async () => {
    await showNarrowActiveDraft();

    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));

    expect(screen.getByText('My Queue')).toBeInTheDocument();
    expect(screen.queryByText('Patrick Mahomes')).not.toBeInTheDocument();
  });

  test('the Board tab shows the matrix and not the player pool or the rail', async () => {
    await showNarrowActiveDraft();

    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));

    expect(screen.getByRole('region', { name: 'Draft Board' })).toBeInTheDocument();
    expect(screen.queryByText('Patrick Mahomes')).not.toBeInTheDocument();
    expect(screen.queryByText('My Queue')).not.toBeInTheDocument();
  });

  test('on-the-clock information (LiveDraftBanner) stays visible across every tab', async () => {
    await showNarrowActiveDraft();
    expect(screen.getByText('Team A is on the clock')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Players' }));
    expect(screen.getByText('Team A is on the clock')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByText('Team A is on the clock')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    expect(screen.getByText('Team A is on the clock')).toBeInTheDocument();
  });

  test('renders player cards, not a table, on the Players tab', async () => {
    await showNarrowActiveDraft();

    await userEvent.click(screen.getByRole('tab', { name: 'Players' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Patrick Mahomes')).toBeInTheDocument();
  });

  test('the selected tab controls a tabpanel named by that tab (#445 AC1)', async () => {
    await showNarrowActiveDraft();

    // The panel is a tabpanel, named by the selected tab (aria-labelledby), and
    // the tab points back at it (aria-controls) - so a reader hears "Chat, tab
    // panel" and can move between the two.
    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    const chatPanel = screen.getByRole('tabpanel', { name: 'Chat' });
    expect(chatTab).toHaveAttribute('aria-controls', chatPanel.getAttribute('id'));
    expect(chatPanel).toHaveAttribute('aria-labelledby', chatTab.getAttribute('id'));

    // Only the SELECTED tab may carry aria-controls: only its panel is rendered,
    // so the other three would point at ids that do not exist (a dangling
    // aria-controls / aria-valid-attr-value violation). Assert they have none.
    for (const name of ['Players', 'Board', 'Draft']) {
      expect(screen.getByRole('tab', { name })).not.toHaveAttribute('aria-controls');
    }

    // Switching tabs renames the panel to the newly selected tab, and moves the
    // aria-controls with the selection.
    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    const boardTab = screen.getByRole('tab', { name: 'Board' });
    expect(screen.getByRole('tabpanel', { name: 'Board' })).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'Chat' })).not.toBeInTheDocument();
    expect(boardTab).toHaveAttribute('aria-controls', 'draft-tabpanel-board');
    expect(screen.getByRole('tab', { name: 'Chat' })).not.toHaveAttribute('aria-controls');
  });

  test('selecting a tab keeps focus on the tab, and one Tab press reaches its panel (#445 AC4)', async () => {
    await showNarrowActiveDraft();

    const boardTab = screen.getByRole('tab', { name: 'Board' });
    await userEvent.click(boardTab);
    // The standard tabs pattern: focus stays on the chosen tab...
    expect(boardTab).toHaveFocus();

    // ...and the panel is the very next thing in the tab order (tabIndex 0).
    await userEvent.tab();
    expect(screen.getByRole('tabpanel', { name: 'Board' })).toHaveFocus();
  });

  test('a completed draft opens on the Board tab, the one exception to Chat-first', async () => {
    // A finished draft is a record, so it opens on the Board on both layouts
    // (issue #123 criterion 4). This is the single intentional exception to
    // #444's Chat-first default: Chat is still a tab away, just not the landing.
    renderBoard(1);
    await screen.findByRole('tab', { name: 'Chat' });
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'complete' },
      teams: [{ teamId: 1, teamName: 'Team A', draft_position: 1 }],
      picks: [],
      onTheClock: null,
    }));

    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('region', { name: 'Draft Board' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Readiness live region (issue #164): one region, mounted for the pending
// lobby rather than for whichever tab happens to be showing.
//
// The whole ticket is the difference between "a status region exists after
// the switch" and "it is the SAME region". Assistive technology announces
// CHANGES to a region it is already observing; a region inserted into the DOM
// already containing its text is generally not announced at all. So every
// assertion below that matters compares node identity (`toBe`) across the
// switch - an assertion that merely found a region afterwards would pass
// against the broken code too, because a freshly mounted one is present.
// ---------------------------------------------------------------------------

describe('readiness live region (issue #164)', () => {
  // The narrow tab layout is the one that mounts a single region per tab, so
  // it is the layout that unmounts the rail - and would have unmounted a live
  // region inside it - on every switch. The wide-container case is its own
  // describe below.
  mockNarrowContainer();

  /** A pending lobby whose viewer holds Team A, with Team B ready: Readiness
   * composes into `pending` alone (railComposition.js) and the panel renders
   * only for a viewer who holds a Team, so this is the one state the region
   * speaks in. */
  const showPendingLobby = async (leagueOverrides = {}) => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByRole('tab', { name: 'Chat' });
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending', ...leagueOverrides }), {
      teams: [
        { teamId: 1, teamName: 'Team A', draft_ready: false },
        { teamId: 2, teamName: 'Team B', draft_ready: true },
      ],
      onTheClock: null,
    })));
  };

  test('is the same DOM node before and after switching narrow tabs away and back', async () => {
    await showPendingLobby();

    const before = readinessAnnouncer();
    expect(before).toHaveTextContent('1 of 2 managers ready');

    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    // Present on a tab that does not render the rail at all - which is the
    // point: the region does not belong to the rail any more.
    expect(readinessAnnouncer()).toBe(before);

    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    expect(readinessAnnouncer()).toBe(before);

    // And back to the tab the room opened on (Chat, #444), the switch the
    // issue describes: the rail is rendered only while the Draft tab is active.
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(readinessAnnouncer()).toBe(before);
    expect(before).toHaveTextContent('1 of 2 managers ready');
  });

  test('updates its text in place when readiness changes while the rail is unmounted', async () => {
    await showPendingLobby();
    const region = readinessAnnouncer();

    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.queryByRole('region', { name: 'Readiness' })).not.toBeInTheDocument();

    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending' }), {
      teams: [
        { teamId: 1, teamName: 'Team A', draft_ready: true },
        { teamId: 2, teamName: 'Team B', draft_ready: true },
      ],
      onTheClock: null,
    })));

    // Same node, new text: a change to a region already being observed, which
    // is the shape assistive technology announces.
    expect(readinessAnnouncer()).toBe(region);
    expect(region).toHaveTextContent('2 of 2 managers ready');
  });

  test('is the only readiness announcement in the room - the rail shows the count without repeating it', async () => {
    // With a draft date, so the countdown's own status region (Countdown.jsx,
    // issue #117) is in the room too. The invariant is one region announcing
    // READINESS, not one region in the document: a bare count of role=status
    // would pass here only for as long as no other announcement exists, and
    // would then fail for a reason that has nothing to do with readiness.
    await showPendingLobby({ draft_date: '2099-09-01T17:00:00.000Z' });
    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));

    const announcing = screen.getAllByRole('status')
      .filter((region) => region.textContent.includes('managers ready'));
    expect(announcing).toHaveLength(1);

    const readiness = screen.getByRole('region', { name: 'Readiness' });
    const visibleCount = within(readiness).getByText('1 of 2 managers ready');
    expect(visibleCount).not.toHaveAttribute('aria-live');
    expect(visibleCount).not.toHaveAttribute('role', 'status');
  });
});

// ---------------------------------------------------------------------------
// GIF composition survives the real narrow-tab unmount (#524, acceptance
// criterion 5). The restore MECHANISM is proven fast and focused at the
// ChatPanel level (ChatConversation.test.jsx, useComposerDraft.test.js); this
// proves the Draft ROOM actually exercises it - that the room's own tab switch
// unmounts the chat subtree and the composition comes back across THAT, not a
// hand-driven unmount. It follows the readiness-region precedent above (the
// same-DOM-node-across-a-narrow-tab-switch test) but asserts restoration of
// state rather than node identity: the whole subtree is deliberately destroyed
// and rebuilt here, so a node-identity check would be the wrong instrument.
//
// Every helper below is block-scoped inside this describe on purpose: nothing is
// added at module scope, so it cannot collide with a sibling IC editing the same
// file near the width stub.
// ---------------------------------------------------------------------------
describe('GIF composition survives a narrow Chat-tab unmount (#524 AC5)', () => {
  mockNarrowContainer();

  // eslint-disable-next-line global-require
  const { registerGifProvider: gifPersist524Register, clearGifProviders: gifPersist524Clear } = require('../../lib/gifProvider');
  // eslint-disable-next-line global-require
  const { FAKE_PROVIDER_ID: GIF_PERSIST_524_PROVIDER, fakeGifResolver: gifPersist524Resolver } = require('../../lib/gifProviderFake');

  beforeEach(() => gifPersist524Register(GIF_PERSIST_524_PROVIDER, gifPersist524Resolver));
  afterEach(() => {
    gifPersist524Clear();
    window.sessionStorage.clear();
  });

  // The room opens on Chat (#444), narrow, with the GIF capability answered on
  // the join ack and an account id in the store so the composer draft is scoped
  // (leagueId 1, account 5).
  const gifPersist524ShowNarrowChatWithGif = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByRole('tab', { name: 'Chat' });
    connectAsTeam(1, { gifMessagesEnabled: true });
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }), {
      teams: [{ teamId: 1, teamName: 'Team A' }, { teamId: 2, teamName: 'Team B' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })));
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  test('filling the GIF composer, switching to Board and back, restores the composition', async () => {
    await gifPersist524ShowNarrowChatWithGif();

    // Fill a partial GIF composition on the Chat tab.
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
    await userEvent.type(screen.getByLabelText(/description/i), 'a cat knocking a cup');
    await userEvent.type(screen.getByLabelText(/caption/i), 'me at 3pm');

    // Switch to the Board tab: on a narrow container only the active tab's region
    // is mounted, so this genuinely UNMOUNTS the chat subtree (the composer with
    // it). Prove that, so the restoration below is across a real unmount.
    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'League Chat' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('gif-picker-panel')).not.toBeInTheDocument();

    // Back to Chat: the subtree remounts and the composition is restored, with
    // the panel reopened because the stored composition is non-empty.
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
    expect(screen.getByTestId('gif-picker-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('GIF asset id')).toHaveValue('abc123');
    expect(screen.getByLabelText(/description/i)).toHaveValue('a cat knocking a cup');
    expect(screen.getByLabelText(/caption/i)).toHaveValue('me at 3pm');
  });
});

// ---------------------------------------------------------------------------
// Wide-container three-pane layout (#444 acceptance criterion 1): Players or
// Board on the left, the largest Chat/activity feed in the centre, and the
// status-dependent rail on the right, all visible at once (no tabs). The unit
// tests' default zero-width measurement reads as wide.
// ---------------------------------------------------------------------------

describe('wide container three-pane layout (#444)', () => {
  const showWideActiveDraft = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }), {
      teams: [{ teamId: 1, teamName: 'Team A' }, { teamId: 2, teamName: 'Team B' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })));
    // The feed rides the room's session, so its heading is the settled signal.
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  test('shows Players (left), the Chat feed (centre) and the rail (right) at once, each a named region, with no tabs', async () => {
    await showWideActiveDraft();

    // All three panes are present simultaneously: the centerpiece Chat is not
    // hidden behind a tab, and the pool and rail sit beside it.
    expect(screen.getByRole('region', { name: 'Available Players' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Chat and Draft activity' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'League Chat' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Draft rail' })).toBeInTheDocument();
    expect(screen.getByText('My Queue')).toBeInTheDocument();
    expect(screen.getByText('Patrick Mahomes')).toBeInTheDocument();

    // A wide container has no tab bar. The pane toggle belongs to the Available
    // Players panel rather than sitting above it, so the panel aligns with the
    // Chat and rail containers.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const players = screen.getByRole('region', { name: 'Available Players' });
    const paneToggle = within(players).getByRole('group', { name: 'Players or Board' });
    expect(within(paneToggle).getByRole('button', { name: 'Players' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the left-pane toggle swaps Players for the Board while Chat and the rail stay put', async () => {
    await showWideActiveDraft();

    const players = screen.getByRole('region', { name: 'Available Players' });
    await userEvent.click(within(players).getByRole('button', { name: 'Board' }));

    const board = screen.getByRole('region', { name: 'Draft Board' });
    expect(within(board).getByRole('group', { name: 'Players or Board' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Available Players' })).not.toBeInTheDocument();
    // The centerpiece and the rail are unaffected by the left-pane choice.
    expect(screen.getByRole('region', { name: 'League Chat' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Draft rail' })).toBeInTheDocument();
  });

  test('the combined feed is the centre pane, no longer tucked inside the rail', async () => {
    await showWideActiveDraft();

    const rail = screen.getByRole('region', { name: 'Draft rail' });
    const chat = screen.getByRole('region', { name: 'League Chat' });
    // Chat is its own pane beside the rail, not a descendant of it (#444): the
    // feed was promoted out of the rail to be the centerpiece.
    expect(rail).not.toContainElement(chat);
  });

  // #516: the Draft-room GIF composer is gated on the SAME draft:join ack
  // gifMessagesEnabled the board already reads for isCommissioner. The board's
  // only job is to thread that capability through to DraftRoomChat, so these two
  // prove the wire end to end: the ack decides, the composer appears (or not).
  const showWideActiveDraftWithGif = async (gifMessagesEnabled) => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1, { gifMessagesEnabled });
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }), {
      teams: [{ teamId: 1, teamName: 'Team A' }, { teamId: 2, teamName: 'Team B' }],
      picks: [],
      onTheClock: { teamId: 1, teamName: 'Team A' },
    })));
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  test('with the ack capability OFF, the Draft-room GIF composer is absent (AC1)', async () => {
    await showWideActiveDraftWithGif(false);
    expect(screen.queryByTestId('gif-picker-trigger')).not.toBeInTheDocument();
    // Text composition is unaffected.
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  test('with the ack capability ON, the board threads it through and the GIF composer appears (AC2)', async () => {
    await showWideActiveDraftWithGif(true);
    expect(screen.getByTestId('gif-picker-trigger')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Layout-flip focus rescue (#525): crossing the pane threshold remounts the
// whole region subtree, so a manager focused inside it lost focus to <body>.
// These are the ONLY room tests that FLIP a single mount across the threshold;
// every other room/composer test lives inside one arrangement and is
// structurally blind to a focus-loss-on-remount defect.
//
// jsdom has no layout engine or ResizeObserver, so flip525* stubs a mutable
// container width behind getBoundingClientRect and a controllable
// ResizeObserver; flip525Resize(width) sets the width and fires the observer,
// re-measuring useContainerWidth inside act() exactly as a real resize would.
// Named distinctively (flip525*) so nothing added at module scope here can
// collide with a concurrently-merged helper (the DraftBoard.test.jsx sharing
// hazard: two same-named module consts merge clean, then fail the build).
const flip525State = { width: 1200, observers: new Set() };
const FLIP525_NARROW = 500; // < DRAFT_PANE_MIN_WIDTH (1200) -> tabs
const FLIP525_WIDE = 1200; //  >= 1200 -> three panes
const flip525InstallResizableContainer = () => {
  let originalGetBoundingClientRect;
  let originalResizeObserver;
  beforeEach(() => {
    flip525State.width = FLIP525_WIDE; // every flip test mounts WIDE first
    flip525State.observers = new Set();
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function flip525Rect() {
      const w = flip525State.width;
      return {
        width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON() {},
      };
    };
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class Flip525ResizeObserver {
      constructor(cb) { this.cb = cb; flip525State.observers.add(cb); }

      observe() {}

      disconnect() { flip525State.observers.delete(this.cb); }
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    global.ResizeObserver = originalResizeObserver;
  });
};
const flip525Resize = (width) => {
  flip525State.width = width;
  act(() => { flip525State.observers.forEach((cb) => cb()); });
};

describe('layout flip hands focus somewhere deliberate, never to the body (#525)', () => {
  flip525InstallResizableContainer();

  // Mount WIDE (three panes) and wait for the centre Chat pane to settle, as the
  // wide-container suite does; the composer lives in that centre pane.
  const showWideActiveDraftForFlip = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }), {
      teams: [TEAM_A, TEAM_B],
      picks: [],
      onTheClock: TEAM_A,
    })));
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  test('the chat composer keeps focus across a panes -> tabs flip (AC1)', async () => {
    await showWideActiveDraftForFlip();

    const composer = screen.getByLabelText('Message');
    act(() => composer.focus());
    expect(composer).toHaveFocus();

    // Cross the threshold: the three panes collapse to the Chat tab, remounting
    // the whole region subtree (and the composer as a fresh node).
    flip525Resize(FLIP525_NARROW);

    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(document.body).not.toHaveFocus();
    expect(screen.getByLabelText('Message')).toHaveFocus();
  });

  test('and the other way, tabs -> panes, in either direction (AC1)', async () => {
    await showWideActiveDraftForFlip();

    // Narrow first, focus the composer on its Chat tab...
    flip525Resize(FLIP525_NARROW);
    const composerNarrow = screen.getByLabelText('Message');
    act(() => composerNarrow.focus());
    expect(composerNarrow).toHaveFocus();

    // ...then widen back to three panes.
    flip525Resize(FLIP525_WIDE);

    expect(document.body).not.toHaveFocus();
    expect(screen.getByLabelText('Message')).toHaveFocus();
  });

  test('focus in the Players pool, Chat current, lands on the main content container after the flip (AC2)', async () => {
    await showWideActiveDraftForFlip();

    // Wide + Chat current: the Players pool is the left pane. Focus its filter,
    // which carries no stable id, so it cannot be found again after the remount.
    const filter = screen.getByLabelText('Filter available');
    act(() => filter.focus());
    expect(filter).toHaveFocus();

    // Flip narrow: the room is on the Chat tab, so the Players pool unmounts.
    flip525Resize(FLIP525_NARROW);

    expect(screen.queryByLabelText('Filter available')).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    // The main content container is the room's single <main> (id
    // draft-main-content), the skip-link target, reached here by its role.
    expect(screen.getByRole('main')).toHaveFocus();
  });

  test('focus moved OUT of the region is not yanked back into it by a flip (AC3)', async () => {
    await showWideActiveDraftForFlip();

    // Set the tracker for real by focusing a control INSIDE the region first.
    // (The earlier version of this test focused ONLY an outside control, so the
    // tracker was never set and it passed against any heldEl-gated rescue -
    // including one with no relatedTarget clearing at all - green for the wrong
    // reason, and structurally unable to see whether a focus move OUT of the
    // region clears the hold.)
    const composer = screen.getByLabelText('Message');
    act(() => composer.focus());
    expect(composer).toHaveFocus();

    // Focus then moves OUT to a chrome control that belongs to no region wrapper
    // and survives the flip (the on-the-clock sound toggle). That is a real focus
    // move - a truthy relatedTarget - so it MUST clear the tracker...
    const outside = screen.getByRole('button', { name: 'On-the-clock sound' });
    act(() => outside.focus());
    expect(outside).toHaveFocus();

    // ...and the flip must then leave this focus entirely alone: no stale hold
    // from the composer may yank focus back into the region.
    flip525Resize(FLIP525_NARROW);

    expect(outside).toHaveFocus();
  });
});

describe('readiness live region on a wide container (issue #164)', () => {
  // No narrow stub, so the default zero-width jsdom measurement reads as wide:
  // the three panes are all mounted at once. On a wide container the rail is
  // always the right pane and never unmounts, so nothing depends on the
  // announcer surviving a rail unmount here - but the announcer must still be
  // the chrome one (a single stable node), never the rail's Readiness panel.
  const showPendingLobbyWide = async () => {
    renderBoard(1, { user: { id: 5, username: 'alice' } });
    // The pool is the left pane on a wide container, so its content is the
    // loaded signal.
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending' }), {
      teams: [
        { teamId: 1, teamName: 'Team A', draft_ready: false },
        { teamId: 2, teamName: 'Team B', draft_ready: true },
      ],
      onTheClock: null,
    })));
  };

  test('is one stable chrome node across a left-pane switch, with the rail always present', async () => {
    await showPendingLobbyWide();
    // Proof this ran wide: a wide container has no tab bar, only the left-pane
    // Players/Board toggle.
    expect(screen.queryByRole('tab', { name: 'Chat' })).not.toBeInTheDocument();

    const before = readinessAnnouncer();
    expect(before).toHaveTextContent('1 of 2 managers ready');

    // The rail (and its Readiness panel) is the right pane and stays mounted
    // when the left pane toggles to the Board, so the panel is present
    // throughout - and the announcer is still the chrome one, the same node.
    await userEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(readinessAnnouncer()).toBe(before);
    expect(screen.getByRole('region', { name: 'Readiness' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// League chat in the Draft room (issue #433): the same conversation the
// Dashboard shows, carried over the draft room's ONE authenticated session.
// ---------------------------------------------------------------------------

describe('League chat in the draft room (issue #433)', () => {
  const showActiveDraft = async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague())));
    // Chat mounts on the room's session, so its heading is the settled signal.
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  test('renders League chat in the room, as a named region with a level-2 heading', async () => {
    await showActiveDraft();

    expect(screen.getByRole('heading', { level: 2, name: 'League Chat' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'League Chat' })).toBeInTheDocument();
  });

  test('carries chat over the one draft session, never a second connection', async () => {
    await showActiveDraft();

    // useDraftSocket opens exactly one authenticated session for the whole
    // room; chat rides it rather than minting its own (acceptance criterion 3).
    expect(createDraftSocket).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText('Message'), 'gg everyone');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith(
        'chat:send',
        expect.objectContaining({ leagueId: 1, message: 'gg everyone' }),
        expect.any(Function)
      )
    );
  });

  test('shows a message that arrives over the draft session, attributed by Team', async () => {
    await showActiveDraft();

    act(() =>
      fakeSocket.trigger('chat:message', {
        id: 91,
        leagueId: 1,
        userId: 2,
        username: 'bob',
        teamId: 2,
        teamName: 'Team B',
        message: 'nice pick',
        created_at: '2026-01-01T12:00:00Z',
      })
    );

    expect(await screen.findByText('nice pick')).toBeInTheDocument();
    // The author is the Team, never the account behind it.
    expect(screen.queryByText('bob')).not.toBeInTheDocument();
  });
});

// --- The optional on-the-clock chime (#445 AC5/AC7) ---
//
// AC5: ONE sound, and only when the VIEWER's own Team becomes On the clock.
// AC7: no chat/Pick/timer-tick sounds and no notifications. The once-per-turn,
// viewer-only edge itself is pinned in useDraftSocket.test.js (onClockAlertOpen);
// these tests pin the beep that rides it, gated on the sound preference.
describe('on-the-clock chime (#445 AC5/AC7)', () => {
  let startSpy;

  beforeEach(() => {
    window.localStorage.clear();
    startSpy = jest.fn();
    const makeCtx = () => ({
      createOscillator: () => ({ type: '', frequency: {}, connect: jest.fn(), start: startSpy, stop: jest.fn() }),
      createGain: () => ({ gain: {}, connect: jest.fn() }),
      destination: {},
      close: jest.fn(),
    });
    window.AudioContext = jest.fn().mockImplementation(makeCtx);
  });

  afterEach(() => {
    delete window.AudioContext;
  });

  const goOnTheClock = (onTheClock) =>
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock })));

  test('stays silent when the viewer becomes On the clock but sound is off (the default)', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);

    goOnTheClock(TEAM_A); // viewer is Team 1 = TEAM_A, so this is their turn

    // Off by default: no AudioContext is ever constructed, so nothing plays.
    expect(window.AudioContext).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('plays exactly one beep when the viewer becomes On the clock with sound enabled', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);

    // Enabling the preference is the user gesture browsers require for audio.
    await userEvent.click(screen.getByRole('button', { name: 'On-the-clock sound' }));

    goOnTheClock(TEAM_A);

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('does not beep when a DIFFERENT Team is On the clock, even with sound on', async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    await userEvent.click(screen.getByRole('button', { name: 'On-the-clock sound' }));

    goOnTheClock(TEAM_B); // someone else's turn

    expect(startSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Room-level Pick announcement (#513): every live committed Pick is announced
// once, on EVERY tab and in BOTH layouts, by a room-level announcer in the
// chrome - not by the Chat-scoped feed announcer, which no longer speaks Picks.
// The whole risk is DOUBLE SPEECH, not silence: when Chat is mounted the feed
// announcer used to speak the Pick and the room-level one would too, so a reader
// would hear it twice. So every assertion COUNTS the status regions carrying the
// Pick text and asserts exactly one - a presence check cannot tell one from two.
// ---------------------------------------------------------------------------

const PICK_TEXT = 'Team A drafted Patrick Mahomes';

// The status regions currently carrying a given announcement. Counting, not
// presence: the readiness/countdown/composer regions never carry this text, so
// exactly-one here means exactly one Pick announcement.
const announcementsSaying = (text) =>
  screen.getAllByRole('status').filter((region) => region.textContent.includes(text));

// Fire one live committed Pick, carrying BOTH the top-level fields the board and
// the room-level announcer read AND the `activity` feed entry the combined feed
// appends (server sends both on draft:picked). Including `activity` is what makes
// the Chat-scoped feed announcer genuinely see the Pick, so a regression to
// double speech shows up here as a count of two rather than hiding.
const landPick = ({ auto = false, seq = 100 } = {}) => {
  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      auto,
      activity: {
        type: 'draft_activity',
        kind: 'pick',
        seq,
        id: `act-${seq}`,
        teamName: 'Team A',
        player: { name: 'Patrick Mahomes' },
        isAutopick: auto,
      },
    })
  );
};

// A prior human message so the feed announcer is past its silent first-seed:
// without it, the Pick's own activity entry would be the FIRST feed entry and
// the feed announcer would seed it silently - hiding a double-speech regression
// instead of exposing it. Only meaningful where the feed (Chat) is mounted.
const seedFeed = () => {
  act(() =>
    fakeSocket.trigger('chat:message', {
      type: 'league_chat',
      seq: 50,
      id: 'c50',
      teamId: 99,
      teamName: 'Rivals',
      message: 'hi',
    })
  );
};

describe('room-level Pick announcement, wide layout (#513)', () => {
  // Default zero-width jsdom measurement reads as wide, so all three panes -
  // including the Chat feed and its announcer - are mounted at once. This is the
  // "exactly once when Chat is mounted" acceptance criterion.
  const showWideActiveDraft = async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1); // viewer holds Team A, so a Team A Pick is the viewer's own
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_A })));
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  test('announces a live Pick exactly once with Chat mounted beside the board', async () => {
    await showWideActiveDraft();
    seedFeed();
    landPick();

    // Exactly one region speaks the Pick, even though the Chat feed announcer is
    // mounted right beside the room-level one. This also covers "a viewer's own
    // committed Pick is announced": the viewer holds Team A.
    await waitFor(() => expect(announcementsSaying(PICK_TEXT)).toHaveLength(1));
  });

  test('announces an autopick as autodrafted, exactly once', async () => {
    await showWideActiveDraft();
    seedFeed();
    landPick({ auto: true });

    await waitFor(() =>
      expect(announcementsSaying('Team A autodrafted Patrick Mahomes')).toHaveLength(1)
    );
    // And never the manual wording as well.
    expect(announcementsSaying(PICK_TEXT)).toHaveLength(0);
  });

  test('does not announce Picks already in the initial draft:state history', async () => {
    // Initial history arrives on draft:state, never draft:picked, so the
    // room-level announcer (fed only by the live onPickLanded seam) is silent.
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() =>
      fakeSocket.trigger('draft:state', stateEvent(activeLeague(), {
        onTheClock: TEAM_B,
        picks: [{
          pick_number: 1, teamId: 1, teamName: 'Team A',
          player_id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC',
        }],
      }))
    );

    expect(announcementsSaying(PICK_TEXT)).toHaveLength(0);
  });

  test('a human chat message is still announced while Chat is mounted (scope preserved)', async () => {
    // The message/Pick distinction is not flattened: the room-level announcer
    // speaks Picks only, and the Chat-scoped feed announcer still speaks human
    // messages, exactly once, where Chat is mounted.
    await showWideActiveDraft();
    seedFeed(); // seq 50, seeds silently
    act(() =>
      fakeSocket.trigger('chat:message', {
        type: 'league_chat', seq: 60, id: 'c60', teamId: 99, teamName: 'Rivals', message: 'gg',
      })
    );

    await waitFor(() =>
      expect(announcementsSaying('New message from Rivals')).toHaveLength(1)
    );
  });
});

describe('room-level Pick announcement across narrow tabs (#513)', () => {
  mockNarrowContainer();

  const showNarrowActiveDraft = async () => {
    renderBoard(1);
    await screen.findByRole('tab', { name: 'Chat' });
    connectAsTeam(1);
    act(() =>
      fakeSocket.trigger('draft:state', stateEvent(activeLeague(), {
        teams: [TEAM_A, TEAM_B],
        onTheClock: TEAM_A,
      }))
    );
  };

  // Every narrow tab must hear a live Pick, including the three that do NOT mount
  // the Chat feed at all - the exact gap #513 closes. On the Chat tab the feed
  // announcer IS mounted, so that tab also proves no double speech there.
  test.each(['Chat', 'Players', 'Board', 'Draft'])(
    'announces a live Pick exactly once while the %s tab is selected',
    async (tab) => {
      await showNarrowActiveDraft();
      await userEvent.click(screen.getByRole('tab', { name: tab }));
      // Seed the feed only where it is mounted (the Chat tab); elsewhere the feed
      // announcer is unmounted and the room-level announcer is the only voice.
      if (tab === 'Chat') seedFeed();
      landPick();

      await waitFor(() => expect(announcementsSaying(PICK_TEXT)).toHaveLength(1));
    }
  );

  test('does not replay a Pick when a narrow tab is switched away and back', async () => {
    // The room-level announcer lives in the chrome, which never unmounts on a tab
    // switch, and lastPick does not change when the tab does - so a Pick is
    // neither re-announced nor replayed on return. Mirrors the ReadinessAnnouncer
    // same-node check earlier in this file.
    await showNarrowActiveDraft(); // opens on Chat
    landPick();
    const pickRegion = await waitFor(() => {
      const region = screen.getAllByRole('status').find((r) => r.textContent.includes(PICK_TEXT));
      expect(region).toBeTruthy();
      return region;
    });
    const textAfterPick = pickRegion.textContent;

    await userEvent.click(screen.getByRole('tab', { name: 'Players' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));

    // Same DOM node (identity, not mere presence) and unchanged text: no replay.
    const sameRegion = screen.getAllByRole('status').find((r) => r.textContent.includes(PICK_TEXT));
    expect(sameRegion).toBe(pickRegion);
    expect(sameRegion.textContent).toBe(textAfterPick);
  });

  test('a chat message arriving while a NON-Chat tab is selected is not announced (message scope is not global)', async () => {
    // The asymmetry the ruling turns on: Picks generalise to every tab, human
    // messages do NOT. On a non-Chat narrow tab the Chat feed (and its announcer
    // and socket listener) is unmounted, so a message that arrives is never even
    // received, let alone announced - exactly the scoping #513 must preserve.
    await showNarrowActiveDraft();
    await userEvent.click(screen.getByRole('tab', { name: 'Players' }));

    act(() =>
      fakeSocket.trigger('chat:message', {
        type: 'league_chat', seq: 70, id: 'c70', teamId: 99, teamName: 'Rivals', message: 'hi',
      })
    );

    expect(announcementsSaying('New message from Rivals')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Room-level stall announcement (#648). A nothing-draftable stall (#602) must
// be spoken wherever the manager is in the room - on EVERY narrow tab and once
// on wide - by the room-level StallAnnouncer in the chrome, fed by the live-only
// draft:activity socket seam, NOT by the chat-subtree feed. Before this ticket
// the stall announcer consumed the combined feed and so unmounted with the Chat
// tab on a narrow container, leaving a screen-reader user on Players/Board/Draft
// silent when the draft froze - the exact gap #513 already closed for Picks.
//
// The counting discipline mirrors #513: assertions COUNT the role="status"
// regions carrying the announcer's copy and assert exactly one. The VISIBLE
// stuck-state feed line (DraftActivityEntry.StalledActivityLine) also contains
// this text, but it is plain Typography inside the role="log" feed, never a
// role="status" region, so it is not counted - a stall reaching the feed on the
// Chat tab must not read as a second status announcement.
// ---------------------------------------------------------------------------

// The announcer-only next-step sentence, distinctive enough to count status
// regions by. stallAnnouncementFor puts it after the cause; the visible feed
// caption repeats it, but that caption is not a status region (see above).
const STALL_NEXT_STEP = 'A commissioner must resolve and resume';

// A live stalled draft_activity entry as the server broadcasts it on the league
// room's draft:activity event (pickClock.service escalation -> draftActivityBroadcast).
// Same shape the feed's StalledActivityLine renders and the room-level seam records.
const stalledEntry = (overrides = {}) => ({
  type: 'draft_activity',
  kind: 'stalled',
  id: 30,
  seq: 30,
  teamName: 'MinneApple',
  created_at: '2026-09-01T12:10:00Z',
  ...overrides,
});

// Fire one live stall on the shared session's draft:activity event. Both the
// room-level seam (useDraftSocket) and, where Chat is mounted, the feed hook
// (useDraftRoomFeed) listen on this one session, so a double-speech regression
// (a stall announced through a status region twice) would show as a count of two.
const landStall = (overrides = {}) => {
  act(() => fakeSocket.trigger('draft:activity', stalledEntry(overrides)));
};

describe('room-level stall announcement, wide layout (#648)', () => {
  // Default zero-width jsdom measurement reads as wide, so the Chat feed and its
  // announcer are mounted at once beside the board - the "exactly once when Chat
  // is mounted" case.
  const showWideActiveDraft = async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1); // viewer holds Team A
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_A })));
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  test('announces a live stall exactly once with Chat mounted beside the board (AC2)', async () => {
    await showWideActiveDraft();
    // Seed the feed so a regression that spoke the stall through the chat subtree
    // would surface as a second status region rather than hide.
    seedFeed();
    landStall();

    await waitFor(() => expect(announcementsSaying(STALL_NEXT_STEP)).toHaveLength(1));
  });

  test('opening onto an already-stalled draft (backlog ends in a stall) announces nothing (AC3)', async () => {
    // The opening backlog arrives on the feed's REST fetch, which the live-only
    // socket seam never sees: a room opening onto a stuck draft is a STATE to
    // read, not a live freeze to announce.
    apiClient.get.mockImplementation((url) =>
      String(url).includes('/draft-feed')
        ? Promise.resolve({ data: [stalledEntry({ id: 9, seq: 9 })] })
        : Promise.resolve(playersPage())
    );
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_A })));

    // The VISIBLE stuck-state line renders from the feed backlog...
    expect(await screen.findByText(/the draft is stuck on/i)).toBeInTheDocument();
    // ...but no status region announces it: backlog never reaches the live seam.
    expect(announcementsSaying(STALL_NEXT_STEP)).toHaveLength(0);
  });

  test('a live stall does not overwrite a standing unread chat announcement (AC4, #636 AC2 at room level)', async () => {
    await showWideActiveDraft();
    seedFeed(); // seq 50, seeds the feed announcer silently
    // A live human message from another Team writes the feed announcer's region.
    act(() =>
      fakeSocket.trigger('chat:message', {
        type: 'league_chat', seq: 60, id: 'c60', teamId: 99, teamName: 'Rivals', message: 'gg',
      })
    );
    const chatRegion = await waitFor(() => {
      const region = screen.getAllByRole('status').find((r) => /New message from Rivals/.test(r.textContent));
      expect(region).toBeDefined();
      return region;
    });
    const chatTextBefore = chatRegion.textContent;

    // Then the draft freezes live.
    landStall();

    // The stall is spoken in its OWN status region, distinct from the chat one...
    const stallRegion = await waitFor(() => {
      const region = screen.getAllByRole('status').find((r) => /the draft is stuck on/i.test(r.textContent));
      expect(region).toBeDefined();
      return region;
    });
    expect(stallRegion).toHaveTextContent('no draftable player');
    expect(stallRegion).toHaveTextContent(STALL_NEXT_STEP);
    expect(stallRegion.textContent).not.toMatch(/stalled the draft/i);

    // ...and the chat announcement is EXACTLY unchanged: same node, byte-identical
    // text (toBe on raw textContent catches a spurious re-announce or ZWSP flip).
    expect(stallRegion).not.toBe(chatRegion);
    expect(chatRegion.textContent).toBe(chatTextBefore);
    expect(chatRegion.textContent).toBe('New message from Rivals');
  });

  // A stall is a STATE with two edges: the room seam carries the exit too, so the
  // announcement is RETRACTED when the stuck state ends, live, on the same event.
  // Without this the room-level move would leave "The draft is stuck" standing in
  // the accessibility tree for the life of the room, on every tab (#653).
  const landLifecycle = (kind) =>
    act(() =>
      fakeSocket.trigger('draft:activity', {
        type: 'draft_activity', kind, id: 40, seq: 40, teamName: 'Commish FC',
        created_at: '2026-09-01T12:20:00Z',
      })
    );

  test.each(['resume', 'reset', 'complete'])(
    'a live %s clears the room-level stall announcement (exit edge, #653)',
    async (kind) => {
      await showWideActiveDraft();
      landStall();
      await waitFor(() => expect(announcementsSaying(STALL_NEXT_STEP)).toHaveLength(1));

      landLifecycle(kind);
      await waitFor(() => expect(announcementsSaying(STALL_NEXT_STEP)).toHaveLength(0));
    }
  );

  test('a live pause does NOT clear a standing stall (a stall already implies paused)', async () => {
    await showWideActiveDraft();
    landStall();
    await waitFor(() => expect(announcementsSaying(STALL_NEXT_STEP)).toHaveLength(1));

    landLifecycle('pause');
    // The pause is the same stuck state, not its end: the stall still stands.
    expect(announcementsSaying(STALL_NEXT_STEP)).toHaveLength(1);
  });
});

describe('room-level stall announcement across narrow tabs (#648)', () => {
  mockNarrowContainer();

  const showNarrowActiveDraft = async () => {
    renderBoard(1);
    await screen.findByRole('tab', { name: 'Chat' });
    connectAsTeam(1);
    act(() =>
      fakeSocket.trigger('draft:state', stateEvent(activeLeague(), {
        teams: [TEAM_A, TEAM_B],
        onTheClock: TEAM_A,
      }))
    );
  };

  // Every narrow tab must hear a live stall, including the three that do NOT
  // mount the Chat feed at all - the exact gap this ticket closes. On the Chat
  // tab the feed IS mounted, so that case also proves no double speech there.
  // Removing the chrome mount in a throwaway commit turns the non-Chat cases red
  // (and, since the chat-scoped mount is removed per this ticket, the Chat case
  // too): the room-level announcer is the only voice.
  test.each(['Chat', 'Players', 'Board', 'Draft'])(
    'announces a live stall exactly once while the %s tab is selected (AC1)',
    async (tab) => {
      await showNarrowActiveDraft();
      await userEvent.click(screen.getByRole('tab', { name: tab }));
      // Seed the feed only where it is mounted (the Chat tab); elsewhere the feed
      // is unmounted and the room-level announcer is the only voice.
      if (tab === 'Chat') seedFeed();
      landStall();

      await waitFor(() => expect(announcementsSaying(STALL_NEXT_STEP)).toHaveLength(1));
    }
  );

  test('does not replay a stall when a narrow tab is switched away and back', async () => {
    // The room-level announcer lives in the chrome, which never unmounts on a tab
    // switch, and lastStall does not change when the tab does - so a stall is
    // neither re-announced nor replayed on return.
    await showNarrowActiveDraft(); // opens on Chat
    landStall();
    const stallRegion = await waitFor(() => {
      const region = screen.getAllByRole('status').find((r) => r.textContent.includes(STALL_NEXT_STEP));
      expect(region).toBeTruthy();
      return region;
    });
    const textAfterStall = stallRegion.textContent;

    await userEvent.click(screen.getByRole('tab', { name: 'Players' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));

    const sameRegion = screen.getAllByRole('status').find((r) => r.textContent.includes(STALL_NEXT_STEP));
    expect(sameRegion).toBe(stallRegion);
    expect(sameRegion.textContent).toBe(textAfterStall);
  });
});

// ---------------------------------------------------------------------------
// The final Pick and Draft completion (#519). The last live Pick and the
// completion must be ONE ordered polite update - Team and player first, then
// "Draft complete." - and the visible "Draft complete!" success Alert must stay
// on screen WITHOUT speaking. The defect this closes is DOUBLE announcement:
// the assertive completion Alert (MUI role="alert") firing beside the polite
// Pick announcement queued in the same commit. So the assertions COUNT the live
// regions, across BOTH role=status and role=alert, and assert exactly one - a
// presence check cannot tell one live update from two.
// ---------------------------------------------------------------------------

// Live regions currently carrying a given text, across BOTH live-region roles.
// role=status (polite) and role=alert (assertive) are DIFFERENT roles: counting
// only one would "prove" the polite region is alone while the assertive Alert is
// still speaking. queryAllByRole never throws when a role is absent.
const liveRegionsSaying = (text) =>
  [...screen.queryAllByRole('status'), ...screen.queryAllByRole('alert')].filter((region) =>
    region.textContent.includes(text)
  );

describe('the final Pick and Draft completion (#519)', () => {
  const showWideActiveDraft = async () => {
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1); // viewer holds Team A
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_A })));
    await screen.findByRole('heading', { level: 2, name: 'League Chat' });
  };

  // The Pick that completes the draft: draftComplete:true rides the same
  // draft:picked payload the board and the room-level announcer already read
  // (server spreads the pick outcome), so no separate draft:complete is needed.
  const landFinalPick = ({ auto = false } = {}) => {
    act(() =>
      fakeSocket.trigger('draft:picked', {
        pickNumber: 30,
        teamId: 1,
        teamName: 'Team A',
        player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
        nextTeamId: null,
        draftComplete: true,
        auto,
        activity: {
          type: 'draft_activity',
          kind: 'pick',
          seq: 200,
          id: 'act-200',
          teamName: 'Team A',
          player: { name: 'Patrick Mahomes' },
          isAutopick: auto,
        },
      })
    );
    // The real wire on completion emits THREE things, not one (draftSocket.js:
    // 287-293, identically in the Pick clock module's autoPick): the pick, a completion
    // lifecycle entry on draft:activity (#437), and draft:complete. Fire all
    // three so "exactly one live update on the final Pick" is proven against the
    // wire, not against a simplification. The other two are silent today - the
    // feed announcer returns empty for every draft_activity, and draft:complete
    // only re-sets an already-true flag - which is exactly what the count below
    // must confirm.
    act(() =>
      fakeSocket.trigger('draft:activity', {
        type: 'draft_activity',
        kind: 'complete',
        id: 21,
        seq: 201,
        teamId: null,
        teamName: null,
        created_at: '2026-01-01T12:05:00Z',
      })
    );
    act(() => fakeSocket.trigger('draft:complete', { leagueId: 1 }));
  };

  test('a final manual Pick produces exactly one live update, ordered Team then completion', async () => {
    await showWideActiveDraft();
    seedFeed(); // so a double-speech regression through the feed announcer shows, not hides
    landFinalPick();

    // AC1 + AC6: exactly one live region speaks the completion, even with the
    // Chat feed announcer mounted beside the room-level one. Both roles counted.
    await waitFor(() => expect(liveRegionsSaying('Draft complete')).toHaveLength(1));

    // That one update is the polite announcer, both facts in order: Team and
    // player FIRST, then the completion sentence, as a single polite string.
    const [live] = liveRegionsSaying('Draft complete');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Team A drafted Patrick Mahomes. Draft complete.');

    // AC4: the visible success Alert is still rendered...
    const completionAlert = screen.getByTestId('draft-complete-alert');
    expect(completionAlert).toHaveTextContent('Draft complete!');
    // AC5: ...but it is not a live region. Pin the actual role shipped rather
    // than "not alert/status" - log, marquee and timer are all live-region roles
    // that a bare negative would let through. The count assertion at the top of
    // this test is the real guard; this is belt-and-braces on what silenced it.
    expect(completionAlert).toHaveAttribute('role', 'presentation');
  });

  test('a final automatic Pick announces autodrafted, once', async () => {
    await showWideActiveDraft();
    seedFeed();
    landFinalPick({ auto: true });

    await waitFor(() => expect(liveRegionsSaying('Draft complete')).toHaveLength(1));
    const [live] = liveRegionsSaying('Draft complete');
    expect(live).toHaveTextContent('Team A autodrafted Patrick Mahomes. Draft complete.');
    // Never the manual wording as well.
    expect(liveRegionsSaying('Team A drafted Patrick Mahomes')).toHaveLength(0);
  });

  test('a NON-final Pick carries no completion sentence and no completion Alert', async () => {
    await showWideActiveDraft();
    seedFeed();
    landPick(); // draftComplete:false

    await waitFor(() => expect(announcementsSaying(PICK_TEXT)).toHaveLength(1));
    // AC3: the ordinary wording, with nothing appended.
    const [live] = announcementsSaying(PICK_TEXT);
    expect(live).toHaveTextContent('Team A drafted Patrick Mahomes');
    expect(live.textContent).not.toMatch(/Draft complete/);
    expect(screen.queryByTestId('draft-complete-alert')).not.toBeInTheDocument();
  });

  test('an error Alert keeps its assertive role=alert (#519 leaves error Alerts alone)', async () => {
    // AC7: the completion Alert loses its live-region role, but the error Alert
    // beside it in DraftBoard keeps role="alert" - an error SHOULD interrupt.
    // No draftComplete here, so the only alert-role region is the error one.
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    act(() => fakeSocket.trigger('connect'));
    const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
    act(() => ack({ error: 'you are not in this league' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('you are not in this league');
  });
});

// --- Draft assistant, room venue (#787) ---
//
// These prove the WIRING between the live room and the assistant provider: the
// socket seam and toggle reach the presenter, and the render-count discipline
// (#754 A7) survives the assistant. The exact line-per-trigger behaviour is
// pinned deterministically in DraftRoomAssistant.test.jsx (rng-injected) and
// roomAssistantFacts.test.js; here rng is real, so assertions are membership in
// a trigger's own pool - which no OTHER trigger's pool shares - or presence.
//
// The viewer is kept OFF the clock (onTheClock TEAM_B, picks' nextTeamId 2) so
// the not-my-turn -> my-turn TURN_START trigger never fires alongside the line
// under test; TURN_START is exercised on its own in DraftRoomAssistant.test.jsx.
describe('Draft assistant in the live room (#787)', () => {
  const commentaryTexts = () =>
    within(screen.getByRole('list', { name: 'Draft assistant commentary' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
  const assistantOn = () => window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
  const linesFor = (trigger, name) =>
    POLK_HIGH_LEGEND_LINES[trigger].map((t) => fillTemplate(t, { player: { name } }));

  afterEach(() => {
    window.localStorage.removeItem(DRAFT_ASSISTANT_KEY);
  });

  test('a queued player taken by another team speaks a snipe (AC1 positive)', async () => {
    assistantOn();
    mockGets({ queue: [{ id: 7, name: 'Queued Star', position: 'WR', nfl_team: 'BUF' }] });
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B })));

    act(() => fakeSocket.trigger('draft:picked', {
      pickNumber: 1, teamId: 2, teamName: 'Team B',
      player: { id: 7, name: 'Queued Star', position: 'WR', nfl_team: 'BUF' },
      nextTeamId: 2, draftComplete: false, auto: false,
    }));

    const snipes = linesFor(TRIGGERS.QUEUE_PICKED_BY_OTHER, 'Queued Star');
    expect(commentaryTexts().some((t) => snipes.includes(t))).toBe(true);
  });

  test('an un-queued player taken by another team says nothing (AC1 negative, ruling item 6)', async () => {
    assistantOn();
    mockGets({ queue: [] });
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B })));

    act(() => fakeSocket.trigger('draft:picked', {
      pickNumber: 1, teamId: 2, teamName: 'Team B',
      player: { id: 999, name: 'Some Nobody', position: 'WR', nfl_team: 'NYJ' },
      nextTeamId: 2, draftComplete: false, auto: false,
    }));

    // The assistant is on (its panel heading shows) but nothing was said.
    expect(screen.getByRole('heading', { name: 'Draft assistant' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Draft assistant commentary' })).not.toBeInTheDocument();
  });

  test("the viewer's own autopick speaks a line from the Autopick pool (AC2)", async () => {
    assistantOn();
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B })));

    act(() => fakeSocket.trigger('draft:picked', {
      pickNumber: 1, teamId: 1, teamName: 'Team A',
      player: { id: 50, name: 'Auto Star', position: 'RB', nfl_team: 'KC' },
      nextTeamId: 2, draftComplete: false, auto: true,
    }));

    const autos = linesFor(TRIGGERS.PICK_AUTO, 'Auto Star');
    expect(commentaryTexts().some((t) => autos.includes(t))).toBe(true);
  });

  test('with the assistant on, a ticking pick clock still re-renders only its own leaf (AC3, extends #754 A7)', async () => {
    assistantOn();
    jest.useFakeTimers();
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
    }), { onTheClock: TEAM_B })));
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:30');
    // The assistant panel is mounted and on for this whole run.
    expect(screen.getByRole('heading', { name: 'Draft assistant' })).toBeInTheDocument();
    const roomRendersBefore = PlayerPoolTableProbe.renderSpy.mock.calls.length;

    // Tick inside the non-urgent zone (30s -> 27s): the leaf ticks...
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:27');
    // ...and nothing outside PickClock re-renders, assistant on and all.
    expect(PlayerPoolTableProbe.renderSpy.mock.calls.length).toBe(roomRendersBefore);
  });

  test('toggle off: the active composition still lists the assistant, and no panel renders (AC5)', async () => {
    // Composition lists it unconditionally...
    expect(railCompositionFor('active')).toContain(RAIL_PANELS.ASSISTANT);

    // ...but with the toggle off (the default), the room shows the toggle and
    // NO assistant panel: composition wants it, the panel declines.
    window.localStorage.removeItem(DRAFT_ASSISTANT_KEY);
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), { onTheClock: TEAM_B })));

    expect(screen.getByRole('button', { name: 'Draft assistant commentary' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Draft assistant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Draft assistant commentary' })).not.toBeInTheDocument();
  });

  // #815 ruling item 6: a quick view opened from the Board (or Queue) fires NO
  // assistant line; only the pool table's quick view does. This exercises the
  // real DraftBoard seam - the pool table alone gets handleSelectFromPool (the
  // nonce), the Board/Queue get the bare setQuickViewId - by opening a real
  // quick view from each surface. The pool-table half is a live positive
  // control, so the Board-half silence cannot pass merely because the panel is
  // empty. The browsed lines fill {position}/{team} too, so the expected set is
  // built from the full pool row, not the name alone.
  test('a pool-table quick view draws a browse line; a Board quick view adds none (#815, ruling item 6)', async () => {
    assistantOn();
    mockGets({ queue: [] });
    renderBoard(1);
    await screen.findByText('Patrick Mahomes');
    connectAsTeam(1);
    // Off the clock (onTheClock TEAM_B) so TURN_START never fires; a committed
    // Pick gives the Board a player to quick-view. Initial pick history reaches
    // the matrix and history, never the assistant (only draft:picked does), so
    // the panel starts silent.
    act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague(), {
      onTheClock: TEAM_B,
      picks: [{
        pick_number: 1, teamId: 2, teamName: 'Team B',
        player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills',
      }],
    })));

    // BOARD PATH FIRST, while no pool selection has started the cooldown (so a
    // mis-wire to handleSelectFromPool here really would draw a line rather than
    // being silently swallowed by the throttle). Open the drafted player's quick
    // view from Pick history: it goes through the bare setQuickViewId, never
    // handleSelectFromPool, so the nonce is untouched and NO browse line is
    // drawn - though the quick view really opens (the dialog proves the gesture
    // reached the room, and closing it makes the rail observable again).
    await openPickHistory();
    await userEvent.click(screen.getByRole('button', { name: 'Josh Allen' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The assistant is on (heading present) but silent: no commentary list.
    expect(screen.getByRole('heading', { name: 'Draft assistant' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Draft assistant commentary' })).not.toBeInTheDocument();

    // POOL PATH (live positive control): the pool table's quick view runs
    // through handleSelectFromPool, which sets the nonce, so a browse line IS
    // drawn. That a line appears here - in the same panel that stayed empty for
    // the Board gesture - is what proves the Board silence above is real, not an
    // empty-panel artefact. The browsed lines fill {position}/{team} too, so the
    // expected set is built from the full pool row, not the name alone.
    await userEvent.click(screen.getByRole('button', { name: 'Players' }));
    await userEvent.click(screen.getByRole('button', { name: 'Patrick Mahomes' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const mahomesRow = { name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs' };
    const browsed = POLK_HIGH_LEGEND_LINES[TRIGGERS.POOL_PLAYER_BROWSED]
      .map((t) => fillTemplate(t, { player: mahomesRow }));
    await waitFor(() => {
      expect(commentaryTexts().some((t) => browsed.includes(t))).toBe(true);
    });
    expect(commentaryTexts()).toHaveLength(1);
  });
});
