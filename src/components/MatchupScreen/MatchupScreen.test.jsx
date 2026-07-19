import React from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import MatchupScreen from './MatchupScreen';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

const renderScreen = (leagueId = 1, state = {}) =>
  renderWithProviders(<MatchupScreen />, {
    path: '/league/:leagueId/matchups',
    route: `/league/${leagueId}/matchups`,
    state,
  });

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderScreenWithToasts = (leagueId = 1, state = {}) =>
  renderWithProviders(
    <SnackbarProvider>
      <MatchupScreen />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId/matchups',
      route: `/league/${leagueId}/matchups`,
      state,
    }
  );

const matchup = (overrides = {}) => ({
  id: 1,
  season: 2025,
  week: 1,
  home_team_id: 10,
  away_team_id: 20,
  home_team_name: 'Home Team',
  away_team_name: 'Away Team',
  home_score: 0,
  away_score: 0,
  final: false,
  ...overrides,
});

function mockApi({
  matchups = [],
  league = { id: 1, name: 'Sunday Ballers', owner_id: 1 },
  rosters = [],
} = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/matchups')) return Promise.resolve({ data: matchups });
    if (url.endsWith('/rosters')) return Promise.resolve({ data: rosters });
    return Promise.resolve({ data: { league } });
  });
}

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
  clearLeagueCache();
});

test('shows a loading skeleton before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders the league name and each matchup', async () => {
  mockApi({ matchups: [matchup({ home_score: 20, away_score: 10 })] });

  renderScreen();

  expect(await screen.findByText(/Sunday Ballers/)).toBeInTheDocument();
  expect(screen.getByText('Home Team (20)')).toBeInTheDocument();
  expect(screen.getByText('Away Team (10)')).toBeInTheDocument();
});

test('bolds the winning team even when scores arrive as strings from Postgres', async () => {
  // Regression test: pg returns DECIMAL columns as strings, and comparing
  // them with > does lexicographic (string) comparison, not numeric —
  // e.g. "9.00" > "10.00" is true as strings. The component must coerce
  // with Number() before comparing.
  mockApi({ matchups: [matchup({ home_score: '9.00', away_score: '10.00' })] });

  renderScreen();

  const homeText = await screen.findByText('Home Team (9)');
  const awayText = screen.getByText('Away Team (10)');

  // MUI's sx-driven fontWeight isn't reliably readable via jsdom's computed
  // style, so assert on the underlying signal instead: a different sx value
  // produces a different emotion-generated class name.
  expect(homeText.className).not.toBe(awayText.className);
});

test('neither team is bolded on a tie', async () => {
  mockApi({ matchups: [matchup({ home_score: '14.00', away_score: '14.00' })] });

  renderScreen();

  const homeText = await screen.findByText('Home Team (14)');
  const awayText = screen.getByText('Away Team (14)');

  // Both get the same {fontWeight: 'normal'} sx value on a tie, so they
  // should share the same emotion-generated class.
  expect(homeText.className).toBe(awayText.className);
});

test('defaults to the league current_week when it has matchups', async () => {
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_name: 'Week1 Home' }),
      matchup({ id: 2, week: 2, home_team_name: 'Week2 Home' }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99, current_week: 1 },
  });

  renderScreen();

  await screen.findByText(/Week1 Home/);
  expect(screen.queryByText(/Week2 Home/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Week')).toHaveTextContent('Week 1');
});

test('falls back to the highest non-final week when current_week has no matchups, and the filter switches weeks', async () => {
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_name: 'Week1 Home', final: true }),
      matchup({ id: 2, week: 2, home_team_name: 'Week2 Home', final: false }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99 },
  });

  renderScreen();
  await screen.findByText(/Week2 Home/);
  expect(screen.queryByText(/Week1 Home/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByLabelText('Week'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 1' }));

  expect(screen.getByText(/Week1 Home/)).toBeInTheDocument();
  expect(screen.queryByText(/Week2 Home/)).not.toBeInTheDocument();
});

test('week chevrons step through weeks and are hidden when All is selected', async () => {
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_name: 'Week1 Home', final: true }),
      matchup({ id: 2, week: 2, home_team_name: 'Week2 Home', final: true }),
      matchup({ id: 3, week: 3, home_team_name: 'Week3 Home', final: false }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99 },
  });

  renderScreen();
  await screen.findByText(/Week3 Home/);

  const prevButton = screen.getByLabelText('Previous week');
  const nextButton = screen.getByLabelText('Next week');
  expect(nextButton).toBeDisabled();
  expect(prevButton).not.toBeDisabled();

  await userEvent.click(prevButton);
  await screen.findByText(/Week2 Home/);
  expect(screen.queryByText(/Week3 Home/)).not.toBeInTheDocument();

  await userEvent.click(prevButton);
  await screen.findByText(/Week1 Home/);
  expect(screen.getByLabelText('Previous week')).toBeDisabled();

  await userEvent.click(screen.getByLabelText('Week'));
  await userEvent.click(await screen.findByRole('option', { name: 'All' }));

  expect(screen.queryByLabelText('Previous week')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Next week')).not.toBeInTheDocument();
});

test('renders the viewer matchup as a full-width hero and keeps it out of the grid', async () => {
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_id: 10, away_team_id: 20, home_team_name: 'My Team', away_team_name: 'Rival', home_score: 30, away_score: 20, final: true }),
      matchup({ id: 2, week: 1, home_team_id: 30, away_team_id: 40, home_team_name: 'Other A', away_team_name: 'Other B' }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99, current_week: 1 },
    rosters: [{ teamId: 10, teamName: 'My Team', ownerId: 1 }, { teamId: 20, teamName: 'Rival', ownerId: 2 }],
  });

  renderScreen(1, { user: { id: 1 } });

  expect(await screen.findByText('Your Matchup — Week 1')).toBeInTheDocument();
  // Hero renders team names and scores as separate elements, not "(score)".
  expect(screen.getByText('My Team')).toBeInTheDocument();
  expect(screen.getByText('30')).toBeInTheDocument();
  expect(screen.getByText('20')).toBeInTheDocument();
  // The viewer's matchup should not also appear as a grid card.
  expect(screen.queryByText('Rival (20)')).not.toBeInTheDocument();
  expect(screen.getByText('Other A (0)')).toBeInTheDocument();
});

test('no hero card renders when the viewer has no matchup this week', async () => {
  mockApi({
    matchups: [matchup({ id: 2, week: 1, home_team_id: 30, away_team_id: 40, home_team_name: 'Other A', away_team_name: 'Other B' })],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99, current_week: 1 },
    rosters: [{ teamId: 30, teamName: 'Other A', ownerId: 2 }],
  });

  renderScreen(1, { user: { id: 1 } });

  await screen.findByText('Other A (0)');
  expect(screen.queryByText(/Your Matchup/)).not.toBeInTheDocument();
});

test('shows a Final chip for a completed matchup and a Scheduled chip otherwise', async () => {
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_name: 'Done Team', final: true }),
      matchup({ id: 2, week: 1, home_team_name: 'Pending Team', final: false }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99, current_week: 1 },
  });

  renderScreen();

  await screen.findByText(/Done Team/);
  expect(screen.getByText('Final')).toBeInTheDocument();
  expect(screen.getByText('Scheduled')).toBeInTheDocument();
});

test('shows Owner Tools for the league owner and lets them generate matchups and score the week', async () => {
  mockApi({ matchups: [], league: { id: 1, name: 'Sunday Ballers', owner_id: 1 } });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts(1, { user: { id: 1 } });
  const ownerToolsHeading = await screen.findByRole('heading', { name: 'Owner Tools' });
  const ownerTools = within(ownerToolsHeading.closest('.MuiPaper-root'));

  const seasonInput = ownerTools.getByLabelText('Season');
  const weekInput = ownerTools.getByLabelText('Week');
  expect(seasonInput).toHaveValue(2025);
  expect(weekInput).toHaveValue(1);

  await userEvent.click(ownerTools.getByRole('button', { name: 'Generate Matchups' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/matchups', { season: 2025, week: 1 })
  );
  expect(await screen.findByText('Matchups generated successfully!')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Score Week' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/score', { season: 2025, week: 1 })
  );
  expect(await screen.findByText('Week scored successfully!')).toBeInTheDocument();
});

test('does not show Owner Tools for a non-owner', async () => {
  mockApi({ matchups: [], league: { id: 1, name: 'Sunday Ballers', owner_id: 99 } });

  renderScreen(1, { user: { id: 1 } });
  await screen.findByText(/Sunday Ballers/);

  expect(screen.queryByRole('heading', { name: 'Owner Tools' })).not.toBeInTheDocument();
});

test('shows an error alert when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'matchups unavailable' } } });

  renderScreen();

  expect(await screen.findByText('matchups unavailable')).toBeInTheDocument();
});

test('joins the league room over the socket on mount and disconnects on unmount', async () => {
  mockApi({ matchups: [] });

  const { unmount } = renderScreen(42);
  await screen.findByText(/Sunday Ballers/);

  expect(createDraftSocket).toHaveBeenCalled();
  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });

  unmount();
  expect(mockSocket.disconnect).toHaveBeenCalled();
});

test('re-joins the league room when the manager reconnects', async () => {
  mockApi({ matchups: [] });

  renderScreen(42);
  await screen.findByText(/Sunday Ballers/);
  mockSocket.emit.mockClear();

  act(() => {
    reconnectHandlers.forEach((cb) => cb());
  });

  expect(mockSocket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });
});

test('receiving scores:updated for a rendered matchup updates the displayed scores and shows a LIVE chip', async () => {
  mockApi({ matchups: [matchup({ id: 5, home_score: 0, away_score: 0 })] });

  renderScreen();
  await screen.findByText('Home Team (0)');

  act(() => {
    socketHandlers['scores:updated']({
      leagueId: 1,
      season: 2025,
      week: 1,
      scored: [{ matchupId: 5, homeTeamId: 1, awayTeamId: 2, homeScore: 21, awayScore: 14 }],
    });
  });

  expect(await screen.findByText('Home Team (21)')).toBeInTheDocument();
  expect(screen.getByText('Away Team (14)')).toBeInTheDocument();
  expect(screen.getByText('LIVE')).toBeInTheDocument();
});

test('each matchup card links to its details page', async () => {
  mockApi({ matchups: [matchup({ id: 5 })] });

  renderScreen(3);
  await screen.findByText('Home Team (0)');

  const links = screen.getAllByRole('link');
  expect(links.some((el) => el.getAttribute('href') === '/league/3/matchups/5')).toBe(true);
});

test('scores:updated for an unknown matchupId leaves the list unchanged', async () => {
  mockApi({ matchups: [matchup({ id: 5, home_score: 3, away_score: 7 })] });

  renderScreen();
  await screen.findByText('Home Team (3)');

  act(() => {
    socketHandlers['scores:updated']({
      leagueId: 1,
      season: 2025,
      week: 1,
      scored: [{ matchupId: 999, homeTeamId: 1, awayTeamId: 2, homeScore: 50, awayScore: 50 }],
    });
  });

  expect(screen.getByText('Home Team (3)')).toBeInTheDocument();
  expect(screen.getByText('Away Team (7)')).toBeInTheDocument();
});
