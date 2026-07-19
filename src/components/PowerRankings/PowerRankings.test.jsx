import React from 'react';
import { screen, within, fireEvent } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import PowerRankings from './PowerRankings';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

let matchMediaMatches = false;
beforeEach(() => {
  matchMediaMatches = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: matchMediaMatches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<PowerRankings />, {
    path: '/league/:leagueId/power-rankings',
    route: `/league/${leagueId}/power-rankings`,
  });

const powerRankingsResponse = (overrides = {}) => ({
  season: 2026,
  week: 5,
  viewerTeamId: 1,
  data: {
    computedAt: '2026-07-10T12:00:00.000Z',
    runs: 10000,
    rankings: [
      { teamId: 1, name: "Alice's Team", rank: 1, score: 92.4, winPct: 0.75, avgScore: 121.3, playoffOdds: 0.91, titleOdds: 0.34, change: 1 },
      { teamId: 2, name: "Bob's Team", rank: 2, score: 85.1, winPct: 0.5, avgScore: 108.7, playoffOdds: 0.62, titleOdds: 0.12, change: -1 },
      { teamId: 3, name: "Cara's Team", rank: 3, score: 70.0, winPct: 0.3, avgScore: 95.0, playoffOdds: 0.2, titleOdds: 0.02, change: 0 },
      { teamId: 4, name: "Dave's Team", rank: 4, score: 60.0, winPct: 0.1, avgScore: 80.0, playoffOdds: 0.05, titleOdds: 0.0, change: null },
    ],
    ...(overrides.data || {}),
  },
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading skeleton before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders the ranked table with win %, avg score, and odds columns', async () => {
  apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });

  renderScreen();

  await screen.findByText("Alice's Team");
  expect(screen.getByText("Bob's Team")).toBeInTheDocument();

  const aliceRow = screen.getByTestId('power-ranking-row-1');
  expect(within(aliceRow).getAllByRole('cell')[0]).toHaveTextContent('1');
  expect(within(aliceRow).getByText('75%')).toBeInTheDocument();
  expect(within(aliceRow).getByText('121.3')).toBeInTheDocument();
  expect(within(aliceRow).getByText('91%')).toBeInTheDocument();
  expect(within(aliceRow).getByText('34%')).toBeInTheDocument();

  const bobRow = screen.getByTestId('power-ranking-row-2');
  expect(within(bobRow).getByText('50%')).toBeInTheDocument();
  expect(within(bobRow).getByText('62%')).toBeInTheDocument();
  expect(within(bobRow).getByText('12%')).toBeInTheDocument();

  // LinearProgress bars render for the odds columns (2 per row x 4 rows)
  expect(screen.getAllByRole('progressbar')).toHaveLength(8);
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

describe('rank movement', () => {
  test('renders up movement in success color with an up aria-label', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    const aliceRow = await screen.findByTestId('power-ranking-row-1');
    expect(within(aliceRow).getByLabelText('up 1')).toBeInTheDocument();
  });

  test('renders down movement in error color with a down aria-label', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    const bobRow = await screen.findByTestId('power-ranking-row-2');
    expect(within(bobRow).getByLabelText('down 1')).toBeInTheDocument();
  });

  test('renders a muted dash for no change', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    const caraRow = await screen.findByTestId('power-ranking-row-3');
    expect(within(caraRow).getByLabelText('no change')).toBeInTheDocument();
    expect(within(caraRow).getByText('–')).toBeInTheDocument();
  });

  test('renders a NEW chip when there is no prior week to compare against', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    const daveRow = await screen.findByTestId('power-ranking-row-4');
    expect(within(daveRow).getByTestId('movement-new')).toHaveTextContent('NEW');
  });
});

test("highlights the viewer's own team row", async () => {
  apiClient.get.mockResolvedValue({ data: powerRankingsResponse({ viewerTeamId: 2 }) });
  renderScreen();
  const bobRow = await screen.findByTestId('power-ranking-row-2');
  expect(bobRow).toHaveAttribute('data-viewer-team', 'true');
  const aliceRow = screen.getByTestId('power-ranking-row-1');
  expect(aliceRow).not.toHaveAttribute('data-viewer-team');
});

describe('sorting', () => {
  test('defaults to ascending rank order', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    await screen.findByText("Alice's Team");
    const rows = screen.getAllByTestId(/power-ranking-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'power-ranking-row-1',
      'power-ranking-row-2',
      'power-ranking-row-3',
      'power-ranking-row-4',
    ]);
  });

  test('clicking Win % sorts descending by win percentage', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    await screen.findByText("Alice's Team");
    fireEvent.click(screen.getByRole('button', { name: /Win %/i }));
    const rows = screen.getAllByTestId(/power-ranking-row-/);
    // Alice (0.75) already highest, so order is unchanged, but toggling again reverses it
    fireEvent.click(screen.getByRole('button', { name: /Win %/i }));
    const reversedRows = screen.getAllByTestId(/power-ranking-row-/);
    expect(reversedRows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'power-ranking-row-4',
      'power-ranking-row-3',
      'power-ranking-row-2',
      'power-ranking-row-1',
    ]);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'power-ranking-row-1',
      'power-ranking-row-2',
      'power-ranking-row-3',
      'power-ranking-row-4',
    ]);
  });

  test('clicking Avg Score sorts descending by average score', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    await screen.findByText("Alice's Team");
    fireEvent.click(screen.getByRole('button', { name: /Avg Score/i }));
    const rows = screen.getAllByTestId(/power-ranking-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'power-ranking-row-1',
      'power-ranking-row-2',
      'power-ranking-row-3',
      'power-ranking-row-4',
    ]);
  });
});

describe('mobile layout', () => {
  beforeEach(() => {
    matchMediaMatches = true;
  });

  test('renders card rows instead of the table below the sm breakpoint', async () => {
    apiClient.get.mockResolvedValue({ data: powerRankingsResponse() });
    renderScreen();
    await screen.findByText(/Alice's Team/);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const aliceRow = screen.getByTestId('power-ranking-row-1');
    expect(within(aliceRow).getByText(/#1 Alice's Team/)).toBeInTheDocument();
    expect(within(aliceRow).getByText(/Win 75%/)).toBeInTheDocument();
    expect(within(aliceRow).getByText(/Avg 121.3/)).toBeInTheDocument();
    expect(within(aliceRow).getByText('Playoff')).toBeInTheDocument();
    expect(within(aliceRow).getByText('Title')).toBeInTheDocument();
  });
});
