import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import PowerRankings from './PowerRankings';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<PowerRankings />, {
    path: '/league/:leagueId/power-rankings',
    route: `/league/${leagueId}/power-rankings`,
  });

const powerRankingsResponse = (overrides = {}) => ({
  season: 2026,
  week: 5,
  data: {
    computedAt: '2026-07-10T12:00:00.000Z',
    runs: 10000,
    rankings: [
      { teamId: 1, name: "Alice's Team", rank: 1, score: 92.4, winPct: 0.75, avgScore: 121.3, playoffOdds: 0.91, titleOdds: 0.34 },
      { teamId: 2, name: "Bob's Team", rank: 2, score: 85.1, winPct: 0.5, avgScore: 108.7, playoffOdds: 0.62, titleOdds: 0.12 },
    ],
    ...(overrides.data || {}),
  },
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

test('renders the ranked table with win %, avg score, and odds columns', async () => {
  apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });

  renderScreen();

  await screen.findByText("Alice's Team");
  expect(screen.getByText("Bob's Team")).toBeInTheDocument();

  const aliceRow = screen.getByTestId('power-ranking-row-1');
  expect(within(aliceRow).getByText('1')).toBeInTheDocument();
  expect(within(aliceRow).getByText('75%')).toBeInTheDocument();
  expect(within(aliceRow).getByText('121.3')).toBeInTheDocument();
  expect(within(aliceRow).getByText('91%')).toBeInTheDocument();
  expect(within(aliceRow).getByText('34%')).toBeInTheDocument();

  const bobRow = screen.getByTestId('power-ranking-row-2');
  expect(within(bobRow).getByText('50%')).toBeInTheDocument();
  expect(within(bobRow).getByText('62%')).toBeInTheDocument();
  expect(within(bobRow).getByText('12%')).toBeInTheDocument();

  // LinearProgress bars render for the odds columns
  expect(screen.getAllByRole('progressbar')).toHaveLength(4);
});

test('shows the computedAt caption and run count', async () => {
  apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });

  renderScreen();

  await screen.findByText("Alice's Team");
  expect(
    screen.getByText(new RegExp(new Date('2026-07-10T12:00:00.000Z').toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  ).toBeInTheDocument();
  expect(screen.getByText(/10000\s*simulation runs/)).toBeInTheDocument();
});

test('shows an empty state when rankings have not been computed yet (404)', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 404 } });

  renderScreen();

  expect(
    await screen.findByText('Rankings appear after the first scored week')
  ).toBeInTheDocument();
});

test('shows a generic error alert on a non-404 failure', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'rankings unavailable' } } });

  renderScreen();

  expect(await screen.findByText('rankings unavailable')).toBeInTheDocument();
});
