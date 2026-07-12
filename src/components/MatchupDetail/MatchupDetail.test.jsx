import React from 'react';
import { screen, act } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import MatchupDetail from './MatchupDetail';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
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
    },
    away: {
      teamId: 2,
      name: 'Team B',
      starters: overrides.awayStarters || [starter({ id: 6, name: 'D. Adams', slot: 'WR', position: 'WR', points: 15.4 })],
    },
  },
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

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderDetail();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
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

test('joins the league room on mount and disconnects on unmount', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  const { unmount } = renderDetail(42, 9);
  await screen.findByText('Week 3 Matchup');

  expect(createDraftSocket).toHaveBeenCalled();
  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });

  unmount();
  expect(mockSocket.disconnect).toHaveBeenCalled();
});

test('re-joins the league room when the manager reconnects', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(42, 9);
  await screen.findByText('Week 3 Matchup');
  mockSocket.emit.mockClear();

  act(() => {
    reconnectHandlers.forEach((cb) => cb());
  });

  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });
});
