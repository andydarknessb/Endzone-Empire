import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import RecapCard from './RecapCard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const recapResponse = (overrides = {}) => ({
  data: {
    season: 2026,
    week: 5,
    data: {
      generatedAt: '2026-07-10T12:00:00.000Z',
      narrative: 'The Sunday Ballers exploded for a league-high performance this week.',
      facts: {
        highestScorer: { team: 'Sunday Ballers', points: 142.5 },
        benchBlunder: { team: 'Bad Luck FC', pointsLeftOnBench: 22.1 },
        waiverSteal: { player: 'Puka Nacua', team: 'Bad Luck FC', points: 28.4 },
        closestMatchup: { home: 'Team A', away: 'Team B', homeScore: 100, awayScore: 99, margin: 1 },
      },
      ...overrides,
    },
  },
});

test('renders the narrative and stat chips when a recap is available', async () => {
  apiClient.get.mockResolvedValue(recapResponse());

  renderWithProviders(<RecapCard leagueId={1} />);

  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(
    screen.getByText('The Sunday Ballers exploded for a league-high performance this week.')
  ).toBeInTheDocument();
  expect(screen.getByText('Week 5')).toBeInTheDocument();
  expect(screen.getByText(/High score: Sunday Ballers \(142.5\)/)).toBeInTheDocument();
  expect(screen.getByText(/Bench blunder: Bad Luck FC left 22.1 on the bench/)).toBeInTheDocument();
  expect(screen.getByText(/Waiver steal: Puka Nacua \(Bad Luck FC\) - 28.4 pts/)).toBeInTheDocument();
  expect(screen.getByText(/Closest game: Team A vs Team B \(margin 1\)/)).toBeInTheDocument();
});

test('renders a biggestBlowout chip when present', async () => {
  apiClient.get.mockResolvedValue(
    recapResponse({
      facts: {
        biggestBlowout: { home: 'Team C', away: 'Team D', homeScore: 150, awayScore: 60, margin: 90 },
      },
    })
  );

  renderWithProviders(<RecapCard leagueId={1} />);

  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(screen.getByText(/Biggest blowout: Team C vs Team D \(margin 90\)/)).toBeInTheDocument();
});

test('renders nothing while no recap has been fetched yet', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<RecapCard leagueId={1} />);
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
});

test('hides itself when the recap endpoint 404s (not generated yet)', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 404 } });

  renderWithProviders(<RecapCard leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
});

test('hides itself on a generic fetch error', async () => {
  apiClient.get.mockRejectedValue(new Error('network down'));

  renderWithProviders(<RecapCard leagueId={1} />);

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
});
