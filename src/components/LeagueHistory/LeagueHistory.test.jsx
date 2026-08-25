import React from 'react';
import { act, screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueHistory from './LeagueHistory';
import { publishTeamProfileUpdate } from '../../lib/teamProfileEvents';

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
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
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

test('shows a thematic empty state when there are no completed seasons', async () => {
  apiClient.get.mockResolvedValue({ data: { seasons: [] } });

  renderHistory();

  const empty = await screen.findByTestId('history-empty');
  expect(empty).toHaveTextContent('The Hall of Fame is empty.');
  expect(empty).toHaveTextContent('Complete your first season to cement your legacy.');
  // The Hall of Fame preview scaffold only makes sense once real seasons exist.
  expect(screen.queryByTestId('history-year-tabs')).not.toBeInTheDocument();
});

test('renders the Hall of Fame preview (year tabs, podium, mock standings) when seasons exist', async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  await screen.findByText('Season 2026');

  const tabs = screen.getByTestId('history-year-tabs');
  expect(within(tabs).getByText('2025')).toBeInTheDocument();
  expect(within(tabs).getByText('2024')).toBeInTheDocument();
  expect(within(tabs).getByText('All-Time Records')).toBeInTheDocument();

  expect(screen.getByTestId('podium-card-1')).toBeInTheDocument();
  expect(screen.getByTestId('podium-card-2')).toBeInTheDocument();
  expect(screen.getByTestId('podium-card-3')).toBeInTheDocument();

  const mockTable = screen.getByTestId('history-mock-standings');
  expect(within(mockTable).getByText('W-L-T')).toBeInTheDocument();
  expect(within(mockTable).getByText('Total Points')).toBeInTheDocument();
});

test('shows an error alert when the history fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'history unavailable' } } });

  renderHistory();

  expect(await screen.findByText('history unavailable')).toBeInTheDocument();
});

test("a pick'em season's standings render points and correct picks instead of a W-L record", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          champion: { teamId: 1, name: 'Sunday Ballers' },
          // The shape rolloverSeason archives for a pick'em-only league.
          standings: [
            { userId: 11, username: 'alice', teamName: 'Sunday Ballers', teamId: 1, name: 'Sunday Ballers', rank: 1, points: 171, correct: 120, pushes: 2, weekly: {} },
            { userId: 12, username: 'bob', teamName: "Bob's Team", teamId: 2, name: "Bob's Team", rank: 2, points: 160, correct: 115, pushes: 2, weekly: {} },
          ],
          trophies: [
            { id: 1, type: 'pickem_champion', label: "2026 Pick'em Champion", team_name: 'Sunday Ballers' },
          ],
          draftGrades: null,
        },
      ],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(table).getByText('Points')).toBeInTheDocument();
  expect(within(table).getByText('Correct')).toBeInTheDocument();
  expect(within(table).queryByText('W-L')).not.toBeInTheDocument();
  expect(within(table).getByText('171')).toBeInTheDocument();
  expect(within(table).getByText('160')).toBeInTheDocument();
  expect(within(table).getByText('120')).toBeInTheDocument();
  expect(panel).not.toHaveTextContent('undefined');

  const banner = within(panel).getByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('171 points');
  expect(banner).not.toHaveTextContent('record');
});

test("a Pick'em history panel displays every archived co-champion instead of the singular compatibility field", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{
        season: 2026,
        outcome: 'champions',
        champions: [
          { teamId: 10, teamName: 'Archived Aces', avatarUrl: null, avatarStaticUrl: null, points: 171, correct: 120, mode: 'straight' },
          { teamId: 99, teamName: 'Departed Champs', avatarUrl: null, avatarStaticUrl: null, points: 171, correct: 120, mode: 'straight' },
        ],
        champion: { teamId: 777, name: 'Deprecated Wrong Winner' },
        standings: [
          { teamId: 11, name: 'Drifted Leader', rank: 1, points: 180, correct: 121, pushes: 0 },
          { teamId: 10, name: 'Archived Aces', rank: 2, points: 171, correct: 120, pushes: 0 },
        ],
        trophies: [],
        draftGrades: null,
      }],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const banner = within(panel).getByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('Co-Champions');
  expect(banner).toHaveTextContent('Archived Aces');
  expect(banner).toHaveTextContent('Departed Champs');
  expect(banner).toHaveTextContent('171 points');
  expect(panel).not.toHaveTextContent('Deprecated Wrong Winner');

  act(() => publishTeamProfileUpdate({ leagueId: 1, teamId: 10, name: 'Anonymized Current Team' }));
  expect(panel).not.toHaveTextContent('Anonymized Current Team');
  expect(panel).toHaveTextContent('Archived Aces');
});

test("a declared Pick'em no-champion season is explicit rather than reported as missing", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{
        season: 2026,
        outcome: 'no_champion',
        champions: [],
        champion: null,
        standings: [],
        trophies: [],
        draftGrades: null,
      }],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  expect(panel).toHaveTextContent('No champion');
  expect(panel).not.toHaveTextContent('No champion recorded');
  expect(within(panel).queryByTestId('champion-banner-2026')).not.toBeInTheDocument();
});
