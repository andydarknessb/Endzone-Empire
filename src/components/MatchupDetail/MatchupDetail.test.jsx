import React from 'react';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import MatchupDetail from './MatchupDetail';
import useFantasyMatchupGames from '../../hooks/useFantasyMatchupGames';
import { useLeague } from '../../hooks/useLeague';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

jest.mock('../../hooks/useFantasyMatchupGames', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../hooks/useLeague', () => ({
  useLeague: jest.fn(),
}));

// Stubbed so the ticker tests are isolated from useLiveGameRealtime/Supabase —
// this file only needs to verify MatchupDetail passes the right gameIds.
jest.mock('../LiveGameStatus/LiveGameStatus', () => ({
  __esModule: true,
  default: ({ gameId }) => <div data-testid="live-game-status">{gameId}</div>,
}));

const renderDetail = (leagueId = 1, matchupId = 9) =>
  renderWithProviders(<MatchupDetail />, {
    path: '/league/:leagueId/matchups/:matchupId',
    route: `/league/${leagueId}/matchups/${matchupId}`,
  });

const starter = (overrides = {}) => ({
  id: 5,
  name: 'P. Mahomes',
  position: 'QB',
  nfl_team: 'KC',
  injury_status: null,
  slot: 'QB',
  points: 24.1,
  ...overrides,
});

const matchupResponse = (overrides = {}) => ({
  data: {
    matchup: {
      id: 9,
      week: 3,
      season: 2026,
      home_score: '101.5',
      away_score: '88',
      final: false,
      is_playoff: false,
      home_team_name: 'Team A',
      away_team_name: 'Team B',
      ...(overrides.matchup || {}),
    },
    home: {
      teamId: 1,
      name: 'Team A',
      starters: overrides.homeStarters || [starter()],
      bench: overrides.homeBench || [],
    },
    away: {
      teamId: 2,
      name: 'Team B',
      starters: overrides.awayStarters || [starter({ id: 6, name: 'D. Adams', slot: 'WR', position: 'WR', points: 15.4 })],
      bench: overrides.awayBench || [],
    },
  },
});

let mockSocket;
let socketHandlers;
let reconnectHandlers;

beforeEach(() => {
  socketHandlers = {};
  reconnectHandlers = [];
  useFantasyMatchupGames.mockReturnValue({ realGameIds: [], loading: false, error: null });
  useLeague.mockReturnValue({
    league: {
      id: 1,
      name: 'Sunday Ballers',
      draft_status: 'complete',
      season_status: 'regular',
      current_season: 2026,
      current_week: 3,
    },
    loading: false,
    error: null,
  });
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

test('shows a loading skeleton before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderDetail();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders both teams starters with points and coerced scores', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail();

  expect(await screen.findByText('Week 3 Matchup')).toBeInTheDocument();
  expect(screen.getByText('Team A')).toBeInTheDocument();
  expect(screen.getByText('Team B')).toBeInTheDocument();
  expect(screen.getByText('101.5')).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
  expect(screen.getByText('P. Mahomes')).toBeInTheDocument();
  expect(screen.getByText('24.1')).toBeInTheDocument();
  expect(screen.getByText('D. Adams')).toBeInTheDocument();
  expect(screen.getByText('15.4')).toBeInTheDocument();
});

test('renders a pre-draft matchup as Not started and never LIVE', async () => {
  useLeague.mockReturnValue({
    league: {
      id: 1,
      name: 'Sunday Ballers',
      draft_status: 'pending',
      season_status: 'regular',
      current_season: 2026,
      current_week: 1,
    },
    loading: false,
    error: null,
  });
  apiClient.get.mockResolvedValue(
    matchupResponse({ matchup: { week: 1, home_score: '0', away_score: '0' } })
  );

  renderDetail();

  expect((await screen.findAllByText('Not started')).length).toBeGreaterThan(0);
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Win probability:/i })).not.toBeInTheDocument();
});

test('renders LIVE for a genuinely in-progress current-week matchup', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail();

  expect((await screen.findAllByText('LIVE')).length).toBeGreaterThan(0);
  expect(screen.queryByText('Not started')).not.toBeInTheDocument();
});

test('does not render dangling bench what-if copy when the viewer has no roster', async () => {
  const response = matchupResponse({ homeStarters: [], homeBench: [] });
  response.data.viewerTeamId = 1;
  response.data.viewerWhatIf = { delta: 0, swaps: [] };
  apiClient.get.mockResolvedValue(response);

  renderDetail();

  await screen.findByText('Week 3 Matchup');
  expect(screen.queryByText('Bench what-if')).not.toBeInTheDocument();
  expect(screen.queryByText(/Your best legal lineup is in/i)).not.toBeInTheDocument();
});

test('renders an injury badge for a flagged starter', async () => {
  apiClient.get.mockResolvedValue(
    matchupResponse({ homeStarters: [starter({ injury_status: 'Q' })] })
  );

  renderDetail();

  await screen.findByText('P. Mahomes');
  expect(screen.getByText('Q')).toBeInTheDocument();
});

test('scores:updated for this matchup updates the displayed scores', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(1, 9);
  await screen.findByText('101.5');

  act(() => {
    socketHandlers['scores:updated']({
      scored: [{ matchupId: 9, homeScore: 110, awayScore: 90 }],
    });
  });

  expect(await screen.findByText('110')).toBeInTheDocument();
  expect(screen.getByText('90')).toBeInTheDocument();
});

test('scores:updated for a different matchupId leaves the displayed scores unchanged', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(1, 9);
  await screen.findByText('101.5');

  act(() => {
    socketHandlers['scores:updated']({
      scored: [{ matchupId: 999, homeScore: 200, awayScore: 200 }],
    });
  });

  expect(screen.getByText('101.5')).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
});

test('a non-touchdown moment play (e.g. a sack) flashes a retro banner in Scoreboard mode, not a cutscene/toast', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(1, 9);
  await screen.findByText('P. Mahomes');
  await userEvent.click(screen.getByRole('button', { name: 'Scoreboard' }));

  act(() => {
    socketHandlers['scores:updated']({
      scored: [{ matchupId: 9, homeScore: 101.5, awayScore: 88 }],
      plays: [{
        playerId: 5, name: 'P. Mahomes', position: 'QB', nflTeam: 'KC', opponent: 'BUF',
        type: 'sack', isTouchdown: false, pointsDelta: 0,
      }],
    });
  });

  expect(await screen.findByRole('status')).toHaveTextContent('KC · SACK');
});

test('shows an error alert when the fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'matchup not found' } } });

  renderDetail();

  expect(await screen.findByText('matchup not found')).toBeInTheDocument();
});

test('shows points left on bench for each team when the matchup is final', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1/matchups/9') {
      return Promise.resolve(matchupResponse({ matchup: { final: true } }));
    }
    if (url.includes('teamId=1')) {
      return Promise.resolve({
        data: { teamId: 1, week: 3, actualPoints: 101.5, optimalPoints: 113.9, pointsLeftOnBench: 12.4 },
      });
    }
    if (url.includes('teamId=2')) {
      return Promise.resolve({
        data: { teamId: 2, week: 3, actualPoints: 88, optimalPoints: 90.2, pointsLeftOnBench: 2.2 },
      });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderDetail();

  await screen.findByText('Team A');
  expect(await screen.findByText('Left 12.4 on the bench')).toBeInTheDocument();
  expect(await screen.findByText('Left 2.2 on the bench')).toBeInTheDocument();
});

test('does not show bench points when the matchup is not final', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail();
  await screen.findByText('Team A');

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
});

test('silently skips bench points on a 404/error from the hindsight endpoint', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1/matchups/9') {
      return Promise.resolve(matchupResponse({ matchup: { final: true } }));
    }
    return Promise.reject({ response: { status: 404 } });
  });

  renderDetail();
  await screen.findByText('Team A');

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
});

test('the Scoreboard toggle swaps the retro view in and switching back restores the standard slot list', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail();
  await screen.findByText('P. Mahomes');

  // In Standard mode, starters are interactive links into PlayerQuickView.
  expect(screen.getByRole('button', { name: 'P. Mahomes' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Scoreboard' }));

  // Retro view: team names render in both the dot-matrix header and the
  // field's endzones, the full starting lineup shows (plain text, not the
  // standard mode's interactive quick-view links), and benches stay hidden
  // until toggled.
  expect(screen.getAllByText('TEAM A').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('TEAM B').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('P. Mahomes')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'P. Mahomes' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show Benches' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Standard' }));
  expect(screen.getByRole('button', { name: 'P. Mahomes' })).toBeInTheDocument();
  expect(screen.queryByText('TEAM A')).not.toBeInTheDocument();
});

test('Scoreboard mode\'s Show Benches reveals real bench players from the API', async () => {
  apiClient.get.mockResolvedValue(
    matchupResponse({ homeBench: [{ id: 20, name: 'Bench Runner', position: 'RB', points: 3.1 }] })
  );

  renderDetail();
  await screen.findByText('P. Mahomes');
  await userEvent.click(screen.getByRole('button', { name: 'Scoreboard' }));

  expect(screen.queryByText(/Bench Runner/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Show Benches' }));
  expect(screen.getByText(/Bench Runner/)).toBeInTheDocument();
});

test('joins the league room on mount and disconnects on unmount', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  const { unmount } = renderDetail(42, 9);
  await screen.findByText('Week 3 Matchup');

  expect(createDraftSocket).toHaveBeenCalled();
  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });

  unmount();
  expect(mockSocket.disconnect).toHaveBeenCalled();
});

test('re-joins the league room and refetches the matchup when the manager reconnects', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(42, 9);
  await screen.findByText('Week 3 Matchup');
  mockSocket.emit.mockClear();
  const callsBeforeReconnect = apiClient.get.mock.calls.length;

  act(() => {
    reconnectHandlers.forEach((cb) => cb());
  });

  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });
  // A dropped connection means missed play deltas never reached the client, so
  // rows can drift from the authoritative total — reconnect should refetch.
  await waitFor(() =>
    expect(apiClient.get.mock.calls.length).toBeGreaterThan(callsBeforeReconnect)
  );
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/42/matchups/9');
  await screen.findByText('Week 3 Matchup');
});

test('renders a live-game ticker strip when the matchup maps to real NFL games', async () => {
  useFantasyMatchupGames.mockReturnValue({
    realGameIds: ['20260910_BUF@KC', '20260913_SF@LAR'],
    loading: false,
    error: null,
  });
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail();

  await screen.findByText('Week 3 Matchup');
  const games = screen.getAllByTestId('live-game-status');
  expect(games.map((g) => g.textContent)).toEqual(['20260910_BUF@KC', '20260913_SF@LAR']);
});

test('does not render the live-game ticker once the matchup is final', async () => {
  useFantasyMatchupGames.mockReturnValue({
    realGameIds: ['20260910_BUF@KC'],
    loading: false,
    error: null,
  });
  apiClient.get.mockResolvedValue(matchupResponse({ matchup: { final: true } }));

  renderDetail();

  await screen.findByText('Week 3 Matchup');
  expect(screen.queryByTestId('live-game-status')).not.toBeInTheDocument();
});
