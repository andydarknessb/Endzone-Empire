import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueTrophiesPage from './LeagueTrophiesPage';

// The page reads the trophies (useTrophies) and the league row (useLeague,
// for the champion avatar only) through the shared apiClient, so every GET is
// answered by the same URL-keyed dispatcher the dashboard test uses.
jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) {
        if (value && value.reject) return Promise.reject(value.reject);
        if (value && value.pending) return new Promise(() => {}); // never settles
        return Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
};

const leagueResponse = () => ({
  data: {
    viewerTeamId: 1,
    league: { id: 1, name: 'MinneApple' },
    teams: [
      { teamId: 1, id: 1, name: 'Team 1' },
      { teamId: 2, id: 2, name: 'Terrific T' },
    ],
  },
});

// Two seasons: 2026 (the newest, so the default view) and 2025.
const trophiesResponse = () => ({
  data: [
    { id: 1, season: 2026, week: 0, type: 'champion', label: 'League Champion', team_id: 2, team_name: 'Terrific T' },
    { id: 2, season: 2026, week: 3, type: 'weekly_high', label: 'Weekly High', team_id: 2, team_name: 'Terrific T' },
    { id: 3, season: 2026, week: 2, type: 'closest_game', label: 'Closest Game', team_id: 1, team_name: 'Team 1' },
    { id: 4, season: 2025, week: 0, type: 'champion', label: 'League Champion', team_id: 1, team_name: 'Team 1' },
  ],
});

const renderTrophies = () =>
  renderWithProviders(<LeagueTrophiesPage />, {
    path: '/league/:leagueId/trophies',
    route: '/league/1/trophies',
  });

test('opens on the newest season, in the trophy room frame', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), '/api/league/1/trophies': trophiesResponse() });
  renderTrophies();

  expect(await screen.findByRole('heading', { level: 1, name: 'Trophy case' })).toBeInTheDocument();
  const room = await screen.findByTestId('trophy-case');
  expect(within(room).getByRole('heading', { level: 3, name: '2026 League Champion' })).toBeInTheDocument();
  expect(within(room).getByText('Weekly High')).toBeInTheDocument();
  expect(within(room).getByText('Closest Game')).toBeInTheDocument();
  expect(screen.queryByText('2025 League Champion')).not.toBeInTheDocument();
});

test('a season select appears, and switching it swaps the awards', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), '/api/league/1/trophies': trophiesResponse() });
  renderTrophies();

  const room = await screen.findByTestId('trophy-case');
  const select = await within(room).findByTestId('trophy-season-select');
  fireEvent.change(select, { target: { value: '2025' } });

  expect(within(room).getByRole('heading', { level: 3, name: '2025 League Champion' })).toBeInTheDocument();
  expect(within(room).queryByTestId('trophy-2')).not.toBeInTheDocument();
});

test('no trophies leaves a stated empty case rather than a blank page', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), '/api/league/1/trophies': { data: [] } });
  renderTrophies();

  const empty = await screen.findByTestId('trophies-empty');
  expect(empty).toHaveTextContent('No trophies yet');
  expect(empty).toHaveTextContent('Trophy awards appear here once the first week settles.');
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});

test('a failed trophy read renders one alert with the failure message', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/league/1/trophies': { reject: new Error('trophies unavailable') },
  });
  renderTrophies();

  const error = await screen.findByTestId('league-trophies-error');
  expect(error).toHaveAttribute('role', 'alert');
  expect(error).toHaveTextContent('trophies unavailable');
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});
