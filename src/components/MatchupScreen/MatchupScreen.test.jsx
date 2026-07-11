import React from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket } from '../../api/socket';
import MatchupScreen from './MatchupScreen';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
}));

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<MatchupScreen />, {
    path: '/league/:leagueId/matchups',
    route: `/league/${leagueId}/matchups`,
  });

const matchup = (overrides = {}) => ({
  id: 1,
  season: 2025,
  week: 1,
  home_team_name: 'Home Team',
  away_team_name: 'Away Team',
  home_score: 0,
  away_score: 0,
  ...overrides,
});

function mockApi({ matchups = [], league = { id: 1, name: 'Sunday Ballers', owner_id: 1 }, user = { id: 1 } } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/matchups')) return Promise.resolve({ data: matchups });
    if (url === '/api/user') return Promise.resolve({ data: user });
    return Promise.resolve({ data: { league } });
  });
}

let mockSocket;
let socketHandlers;

beforeEach(() => {
  socketHandlers = {};
  mockSocket = {
    on: jest.fn((event, cb) => {
      socketHandlers[event] = cb;
    }),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  createDraftSocket.mockReturnValue(mockSocket);
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
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

test('the week filter lists unique weeks and filters the visible matchups', async () => {
  // Non-owner: keeps Owner Tools (which has its own "Week" TextField) out
  // of the tree, so the filter's "Week" label is unambiguous.
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_name: 'Week1 Home' }),
      matchup({ id: 2, week: 2, home_team_name: 'Week2 Home' }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99 },
    user: { id: 1 },
  });

  renderScreen();
  await screen.findByText(/Week1 Home/);
  expect(screen.getByText(/Week2 Home/)).toBeInTheDocument();

  await userEvent.click(screen.getByLabelText('Week'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 1' }));

  expect(screen.getByText(/Week1 Home/)).toBeInTheDocument();
  expect(screen.queryByText(/Week2 Home/)).not.toBeInTheDocument();
});

test('shows Owner Tools for the league owner and lets them generate matchups and score the week', async () => {
  mockApi({ matchups: [], league: { id: 1, name: 'Sunday Ballers', owner_id: 1 }, user: { id: 1 } });
  apiClient.post.mockResolvedValue({});

  renderScreen();
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
  mockApi({ matchups: [], league: { id: 1, name: 'Sunday Ballers', owner_id: 99 }, user: { id: 1 } });

  renderScreen();
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

test('receiving scores:updated for a rendered matchup updates the displayed scores', async () => {
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

test('each matchup links to its details page', async () => {
  mockApi({ matchups: [matchup({ id: 5 })] });

  renderScreen(3);
  await screen.findByText('Home Team (0)');

  expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute(
    'href',
    '/league/3/matchups/5'
  );
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
