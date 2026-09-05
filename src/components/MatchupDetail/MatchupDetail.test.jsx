import React from 'react';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import MatchupDetail from './MatchupDetail';
import useFantasyMatchupGames from '../../hooks/useFantasyMatchupGames';
import { useLeague } from '../../hooks/useLeague';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
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

// The detail body GET /api/league/:id/matchups/:matchupId delivers: { matchup,
// home, away }, the score on the matchup and each side's identity/figures on
// the per-side object (the shape the entity's matchupFromDetailBody reads).
// `status` is the server's status fact (ADR 0030): it defaults to 'live' (an
// in-progress matchup) and to 'final' when `final` is overridden true, so a
// fixture reads truthfully without every test spelling it out.
const matchupResponse = (overrides = {}) => {
  const m = overrides.matchup || {};
  const final = m.final ?? false;
  const status = m.status ?? (final ? 'final' : 'live');
  return {
    data: {
      matchup: {
        id: 9,
        week: 3,
        season: 2026,
        home_score: '101.5',
        away_score: '88',
        is_playoff: false,
        home_team_name: 'Team A',
        away_team_name: 'Team B',
        ...m,
        final,
        status,
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
  };
};

// Drive live updates through the app's own socket factory hook
// (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js): the entity hook's
// score feed builds its socket through createDraftSocket, so installing this
// factory hands the feed a controllable fake — no hand-rolled socket double.
function makeFakeSocket() {
  const handlers = {};
  const ioHandlers = {};
  return {
    emit: jest.fn(),
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    io: {
      on: jest.fn((event, cb) => { ioHandlers[event] = cb; }),
      off: jest.fn(),
    },
    disconnect: jest.fn(),
    fire: (event, payload) => handlers[event]?.(payload),
    reconnect: () => ioHandlers.reconnect?.(),
  };
}

let socket;

const emitScores = (payload) => act(() => { socket.fire('scores:updated', payload); });

beforeEach(() => {
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => {
    socket = makeFakeSocket();
    return socket;
  };
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
});

afterEach(() => {
  delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
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

// The status chip and the live UI are the server's status fact (ADR 0030),
// read through the entity's predicate — never a score-arrived timer.
test('a scheduled matchup shows no LIVE chip and no win-probability bar', async () => {
  apiClient.get.mockResolvedValue(matchupResponse({ matchup: { status: 'scheduled', home_score: '0', away_score: '0' } }));

  renderDetail();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Scheduled');
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Win probability:/i })).not.toBeInTheDocument();
});

// ADR 0030: a played (games done, not finalised) matchup reads "Awaiting final",
// never a guessed LIVE.
test('a played matchup renders the Awaiting final chip and no LIVE', async () => {
  apiClient.get.mockResolvedValue(matchupResponse({ matchup: { status: 'played', home_score: '99', away_score: '92' } }));

  renderDetail();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Awaiting final');
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
});

// The LIVE chip comes from the fetched status alone: no socket event is fired
// here. Red-tell (AC1): forcing the predicate to return Scheduled for `live`
// turns this test red and no other.
test('a live matchup renders LIVE from the fetch alone, with no socket event', async () => {
  apiClient.get.mockResolvedValue(matchupResponse({ matchup: { status: 'live' } }));

  renderDetail();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('LIVE');
  expect(screen.queryByText('Awaiting final')).not.toBeInTheDocument();
});

// One render test proving a model update from the hook reaches the DOM: the
// score, the Expected final, Players remaining and the chip label all follow a
// scores:updated event, with no refetch. The status moves scheduled -> played,
// so the chip label is driven by the model, not a timer.
test('a scores:updated event moves the score, Expected final, players remaining and chip', async () => {
  const response = matchupResponse({ matchup: { status: 'scheduled' } });
  response.data.home.expectedFinal = 120.5;
  response.data.home.playersRemaining = 4;
  response.data.away.expectedFinal = 97.25;
  response.data.away.playersRemaining = 2;
  apiClient.get.mockResolvedValue(response);

  renderDetail(1, 9);
  await screen.findByText('101.5');
  expect(screen.getByTestId('matchup-status-chip')).toHaveTextContent('Scheduled');
  expect(screen.getByText('Projected 120.5')).toBeInTheDocument();
  expect(screen.getByText('Projected 97.3')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 4')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 2')).toBeInTheDocument();

  emitScores({
    scored: [{
      matchupId: 9, homeScore: 110, awayScore: 90, status: 'played',
      homeExpectedFinal: 130.2, awayExpectedFinal: 96.4, homePlayersRemaining: 3, awayPlayersRemaining: 1,
    }],
  });

  expect(await screen.findByText('110')).toBeInTheDocument();
  expect(screen.getByText('90')).toBeInTheDocument();
  expect(screen.getByText('Projected 130.2')).toBeInTheDocument();
  expect(screen.getByText('Projected 96.4')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 3')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 1')).toBeInTheDocument();
  expect(screen.getByTestId('matchup-status-chip')).toHaveTextContent('Awaiting final');
});

test('a scores:updated for a different matchupId leaves the displayed scores unchanged', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(1, 9);
  await screen.findByText('101.5');

  emitScores({ scored: [{ matchupId: 999, homeScore: 200, awayScore: 200 }] });

  expect(screen.getByText('101.5')).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
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

test('a non-touchdown moment play (e.g. a sack) flashes a retro banner in Scoreboard mode, not a cutscene/toast', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(1, 9);
  await screen.findByText('P. Mahomes');
  await userEvent.click(screen.getByRole('button', { name: 'Scoreboard' }));

  emitScores({
    scored: [{ matchupId: 9, homeScore: 101.5, awayScore: 88 }],
    plays: [{
      playerId: 5, name: 'P. Mahomes', position: 'QB', nflTeam: 'KC', opponent: 'BUF',
      type: 'sack', isTouchdown: false, pointsDelta: 0,
    }],
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
    return Promise.resolve(matchupResponse());
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
    if (url.includes('/api/team/hindsight')) {
      return Promise.reject({ response: { status: 404 } });
    }
    return Promise.resolve(matchupResponse());
  });

  renderDetail();
  await screen.findByText('Team A');

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
});

test('a final best-ball matchup shows no bench line: nothing is ever left on a bench nobody sets (ADR 0023)', async () => {
  useLeague.mockReturnValue({
    league: { id: 1, name: 'Sunday Ballers', best_ball: true, season_status: 'regular', current_season: 2026, current_week: 3 },
    loading: false,
    error: null,
  });
  const releases = [];
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1/matchups/9') {
      return Promise.resolve(matchupResponse({ matchup: { final: true } }));
    }
    if (url.includes('/api/team/hindsight')) {
      return new Promise((resolve) => {
        releases.push(() => resolve({
          data: { week: 3, actualPoints: 101.5, optimalPoints: 101.5, pointsLeftOnBench: 0 },
        }));
      });
    }
    return Promise.resolve(matchupResponse());
  });

  renderDetail();
  await screen.findByText('Team A');
  await waitFor(() => expect(releases).toHaveLength(2));
  await act(async () => { releases.forEach((release) => release()); });

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
});

test('the bench line waits for the league to be known, so a best-ball zero never flashes', async () => {
  useLeague.mockReturnValue({ league: null, loading: true, error: null });
  const releases = [];
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1/matchups/9') {
      return Promise.resolve(matchupResponse({ matchup: { final: true } }));
    }
    if (url.includes('/api/team/hindsight')) {
      return new Promise((resolve) => {
        releases.push(() => resolve({
          data: { week: 3, actualPoints: 90, optimalPoints: 102.4, pointsLeftOnBench: 12.4 },
        }));
      });
    }
    return Promise.resolve(matchupResponse());
  });

  renderDetail();
  await screen.findByText('Team A');
  await waitFor(() => expect(releases).toHaveLength(2));
  await act(async () => { releases.forEach((release) => release()); });

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
});

test('the Scoreboard toggle swaps the retro view in and switching back restores the standard slot list', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail();
  await screen.findByText('P. Mahomes');

  // In Standard mode, starters are interactive links into PlayerQuickView.
  expect(screen.getByRole('button', { name: 'P. Mahomes' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Scoreboard' }));

  // Retro view: team names render in both the dot-matrix header and the field's
  // endzones, the full starting lineup shows (plain text, not the standard
  // mode's interactive quick-view links), and benches stay hidden until toggled.
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

  expect(socket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });

  unmount();
  expect(socket.disconnect).toHaveBeenCalled();
});

test('re-joins the league room and refetches the matchup when the manager reconnects', async () => {
  apiClient.get.mockResolvedValue(matchupResponse());

  renderDetail(42, 9);
  await screen.findByText('Week 3 Matchup');
  socket.emit.mockClear();
  const callsBeforeReconnect = apiClient.get.mock.calls.length;

  act(() => { socket.reconnect(); });

  expect(socket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });
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
