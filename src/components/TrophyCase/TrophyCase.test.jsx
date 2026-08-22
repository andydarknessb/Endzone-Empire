import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import TrophyCase from './TrophyCase';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const trophies = [
  {
    id: 1,
    type: 'weekly_high',
    label: 'Weekly High Score',
    week: 4,
    season: 2026,
    team_id: 10,
    team_name: 'Sunday Ballers',
    data: {},
    awarded_at: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 2,
    type: 'champion',
    label: 'League Champion',
    week: null,
    season: 2025,
    team_id: 11,
    team_name: "Alice's Team",
    data: {},
    awarded_at: '2025-12-30T00:00:00.000Z',
  },
  {
    id: 3,
    type: 'closest_game',
    label: 'Closest Game',
    week: 4,
    season: 2026,
    team_id: 12,
    team_name: 'Cardiac Comebacks',
    data: { margin: 0.01 },
    awarded_at: '2026-07-01T00:00:00.000Z',
  },
];

test('renders trophies with team names, defaulting to the current (latest) season', async () => {
  apiClient.get.mockResolvedValue({ data: trophies });

  renderWithProviders(<TrophyCase leagueId={1} />);

  expect(await screen.findByTestId('trophy-case')).toBeInTheDocument();
  expect(screen.getByText(/Weekly High Score/)).toBeInTheDocument();
  expect(screen.getByText(/Sunday Ballers/)).toBeInTheDocument();
  expect(screen.getByText(/Closest Game/)).toBeInTheDocument();
  expect(screen.getByText(/Cardiac Comebacks/)).toBeInTheDocument();
  // 2025's champion trophy should not show by default since 2026 is the latest season
  expect(screen.queryByText(/League Champion/)).not.toBeInTheDocument();
});

test('renders nothing while loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderWithProviders(<TrophyCase leagueId={1} />);
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});

test('hides itself when there are no trophies', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<TrophyCase leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});

test('hides itself on a fetch error', async () => {
  apiClient.get.mockRejectedValue(new Error('boom'));
  renderWithProviders(<TrophyCase leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
});
