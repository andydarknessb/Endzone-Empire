import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueHistory from './LeagueHistory';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const renderHistory = (leagueId = 1) =>
  renderWithProviders(<LeagueHistory />, {
    path: '/league/:leagueId/history',
    route: `/league/${leagueId}/history`,
  });

const historyResponse = () => ({
  data: {
    seasons: [
      {
        season: 2026,
        champion: { teamId: 1, name: 'Sunday Ballers' },
        standings: [
          { teamId: 1, name: 'Sunday Ballers', rank: 1, wins: 12, losses: 2, pf: 1502.4 },
        ],
        trophies: [
          { id: 1, type: 'champion', label: 'League Champion', team_name: 'Sunday Ballers' },
        ],
        draftGrades: [
          { teamId: 1, name: 'Sunday Ballers', grade: 'A', rosterValue: 250.1, rank: 1 },
        ],
      },
      {
        season: 2025,
        champion: null,
        standings: [
          { teamId: 2, name: "Bob's Team", rank: 1, wins: 10, losses: 4, pf: 1400.0 },
        ],
        trophies: [],
        draftGrades: null,
      },
    ],
  },
});

test('renders past seasons with champion, standings, trophies, and draft grades', async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  expect(await screen.findByText('Season 2026')).toBeInTheDocument();
  expect(screen.getByTestId('champion-2026')).toHaveTextContent('Sunday Ballers');
  expect(screen.getByText('Season 2025')).toBeInTheDocument();
  expect(screen.getByText('No champion recorded')).toBeInTheDocument();
  expect(screen.getAllByText('Sunday Ballers').length).toBeGreaterThan(0);
  expect(screen.getByText("Bob's Team")).toBeInTheDocument();
});

test('renders a champion banner with team name and record inside the expanded panel', async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  const banner = await screen.findByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('Season Champion');
  expect(banner).toHaveTextContent('Sunday Ballers');
  expect(banner).toHaveTextContent('12-2 record');

  expect(screen.queryByTestId('champion-banner-2025')).not.toBeInTheDocument();
});

test('shows medal indicators for podium ranks in Final Standings', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          champion: { teamId: 1, name: 'Sunday Ballers' },
          standings: [
            { teamId: 1, name: 'Sunday Ballers', rank: 1, wins: 12, losses: 2, pf: 1502.4 },
            { teamId: 2, name: 'Runner Up', rank: 2, wins: 10, losses: 4, pf: 1400.0 },
            { teamId: 3, name: 'Third Place', rank: 3, wins: 9, losses: 5, pf: 1350.0 },
            { teamId: 4, name: 'Also Ran', rank: 4, wins: 5, losses: 9, pf: 1200.0 },
          ],
          trophies: [],
          draftGrades: null,
        },
      ],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  expect(panel).toHaveTextContent('🥇');
  expect(panel).toHaveTextContent('🥈');
  expect(panel).toHaveTextContent('🥉');
  // Rank numbers remain present for screen readers alongside the decorative medals.
  const table = within(panel).getByRole('table');
  expect(within(table).getByText('4')).toBeInTheDocument();
});

test('renders an inline note when trophies failed to load for a season', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          champion: null,
          standings: [],
          trophies: [],
          trophiesErrored: true,
          draftGrades: null,
        },
      ],
    },
  });

  renderHistory();

  expect(await screen.findByText("Couldn't load trophies for this season")).toBeInTheDocument();
});

test('renders an inline note when draft grades failed to load for a season', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          champion: null,
          standings: [],
          trophies: [],
          draftGrades: null,
          draftGradesErrored: true,
        },
      ],
    },
  });

  renderHistory();

  expect(await screen.findByText("Couldn't load draft grades for this season")).toBeInTheDocument();
});

test('shows an empty state when there are no completed seasons', async () => {
  apiClient.get.mockResolvedValue({ data: { seasons: [] } });

  renderHistory();

  expect(await screen.findByTestId('history-empty')).toHaveTextContent('No completed seasons yet');
});

test('shows an error alert when the history fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'history unavailable' } } });

  renderHistory();

  expect(await screen.findByText('history unavailable')).toBeInTheDocument();
});
