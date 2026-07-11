import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import PlayerDetail from './PlayerDetail';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const renderDetail = (playerId = 5) =>
  renderWithProviders(<PlayerDetail />, {
    path: '/players/:playerId',
    route: `/players/${playerId}`,
  });

const detailResponse = (overrides = {}) => ({
  data: {
    player: {
      id: 5,
      name: 'Patrick Mahomes',
      position: 'QB',
      nfl_team: 'Kansas City Chiefs',
      injury_status: null,
      injury_detail: null,
      news: null,
      ...(overrides.player || {}),
    },
    weekly: overrides.weekly || [
      {
        season: 2026,
        week: 1,
        stats: { passingYards: 300, passingTDs: 2, interceptions: 1 },
        fantasy_points: 18,
      },
      {
        season: 2026,
        week: 2,
        stats: { passingYards: 250, passingTDs: 3 },
        fantasy_points: 22,
      },
    ],
    seasonTotals:
      overrides.seasonTotals !== undefined
        ? overrides.seasonTotals
        : { season: 2026, games: 2, points: 40, projectedPoints: 20 },
  },
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderDetail();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

test('renders the player header, season totals, and weekly stat lines', async () => {
  apiClient.get.mockResolvedValue(detailResponse());
  renderDetail(5);

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/5');
  expect(screen.getByText('QB')).toBeInTheDocument();
  expect(screen.getByText('Kansas City Chiefs')).toBeInTheDocument();
  expect(screen.getByText('Games: 2')).toBeInTheDocument();
  expect(screen.getByText('Fantasy Points: 40')).toBeInTheDocument();
  expect(screen.getByText('Projected: 20/wk')).toBeInTheDocument();
  expect(screen.getByText('300 Pass Yds, 2 Pass TD, 1 INT')).toBeInTheDocument();
  expect(screen.getByText('22')).toBeInTheDocument();
});

test('shows the injury badge and news blurb when present', async () => {
  apiClient.get.mockResolvedValue(
    detailResponse({
      player: { injury_status: 'Q', injury_detail: 'Ankle', news: 'Limited in practice Wednesday.' },
    })
  );
  renderDetail();

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(screen.getByText('Limited in practice Wednesday.')).toBeInTheDocument();
});

test('handles a player with no synced stats', async () => {
  apiClient.get.mockResolvedValue(detailResponse({ weekly: [], seasonTotals: null }));
  renderDetail();

  expect(await screen.findByText('No stats synced yet')).toBeInTheDocument();
  expect(screen.getByText('No weekly stats yet')).toBeInTheDocument();
});

test('surfaces the server error when the fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'player not found' } } });
  renderDetail(999);

  expect(await screen.findByText('player not found')).toBeInTheDocument();
});
