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

const summaryResponse = (overrides = {}) => ({
  data: {
    player: {
      id: 5,
      name: 'Patrick Mahomes',
      position: 'QB',
      nfl_team: 'Kansas City Chiefs',
      jersey_number: 15,
      injury_status: null,
      injury_detail: null,
      news: null,
      photo_url: null,
      bye_week: 10,
      ...(overrides.player || {}),
    },
    fantasy:
      overrides.fantasy !== undefined
        ? overrides.fantasy
        : {
            adp: 24.5,
            projectionSeason: 2026,
            projectedPoints: 320.1,
            previousSeasonYear: 2025,
            previousSeasonTotal: 315.4,
          },
    currentSeason:
      overrides.currentSeason !== undefined
        ? overrides.currentSeason
        : {
            season: 2026,
            games: 2,
            points: 40,
            perGame: 20,
            weekly: [
              {
                week: 1,
                stats: { passingYards: 300, passingTDs: 2, interceptions: 1 },
                fantasy_points: 18,
              },
              { week: 2, stats: { passingYards: 250, passingTDs: 3 }, fantasy_points: 22 },
            ],
          },
    previousSeasons:
      overrides.previousSeasons !== undefined
        ? overrides.previousSeasons
        : [
            {
              season: 2025,
              games: 17,
              stats: { passingYards: 4800, passingTDs: 38 },
              points: 315.4,
              perGame: 18.6,
            },
          ],
  },
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderDetail();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders the player header, fantasy strip, and current-season stat lines', async () => {
  apiClient.get.mockResolvedValue(summaryResponse());
  renderDetail(5);

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/5/summary');
  expect(screen.getByText('QB')).toBeInTheDocument();
  expect(screen.getByText('Kansas City Chiefs')).toBeInTheDocument();
  expect(screen.getByText('#15')).toBeInTheDocument();
  expect(screen.getByText('Bye: Wk 10')).toBeInTheDocument();
  expect(screen.getByText('ADP 24.5')).toBeInTheDocument();
  expect(screen.getByText('Games: 2')).toBeInTheDocument();
  expect(screen.getByText('Fantasy Points: 40')).toBeInTheDocument();
  expect(screen.getByText('300 Pass Yds, 2 Pass TD, 1 INT')).toBeInTheDocument();
  expect(screen.getByText('22')).toBeInTheDocument();
});

test('renders a previous-seasons row', async () => {
  apiClient.get.mockResolvedValue(summaryResponse());
  renderDetail(5);

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  expect(screen.getByText('2025')).toBeInTheDocument();
  expect(screen.getByText('4800 Pass Yds, 38 Pass TD')).toBeInTheDocument();
});

test('shows the injury badge and news blurb when present', async () => {
  apiClient.get.mockResolvedValue(
    summaryResponse({
      player: {
        injury_status: 'Q',
        injury_detail: 'Ankle',
        news: 'Limited in practice Wednesday.',
      },
    })
  );
  renderDetail();

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(screen.getByText('Limited in practice Wednesday.')).toBeInTheDocument();
});

test('handles a player with no synced stats', async () => {
  apiClient.get.mockResolvedValue(
    summaryResponse({ fantasy: {}, currentSeason: null, previousSeasons: [] })
  );
  renderDetail();

  expect(await screen.findByText('No current-season stats yet')).toBeInTheDocument();
  expect(
    screen.getByText('No previous-season data available for this player.')
  ).toBeInTheDocument();
});

test('surfaces the server error when the fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'player not found' } } });
  renderDetail(999);

  expect(await screen.findByText('player not found')).toBeInTheDocument();
});
