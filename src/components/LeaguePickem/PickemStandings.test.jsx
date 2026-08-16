import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import PickemStandings from './PickemStandings';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
import apiClient from '../../api/apiClient';
import { clearPickemStandingsCache } from '../../hooks/usePickemStandings';

const STANDINGS = {
  season: 2026,
  mode: 'confidence',
  standings: [
    { userId: 2, username: 'abe', teamName: 'Anvils', points: 21, correct: 9, incorrect: 4, pending: 2, rank: 1 },
    { userId: 9, username: 'zoe', teamName: 'Zephyrs', points: 12, correct: 6, incorrect: 7, pending: 2, rank: 2 },
  ],
};

beforeEach(() => { jest.clearAllMocks(); clearPickemStandingsCache(); });

test('renders the leaderboard in the order the server returned', async () => {
  apiClient.get.mockResolvedValue({ data: STANDINGS });
  renderWithProviders(<PickemStandings leagueId={7} season={2026} />);

  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row').slice(1); // drop the header
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText('Anvils')).toBeInTheDocument();
  expect(within(rows[0]).getByText('21')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Zephyrs')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings?season=2026');
});

test('names the scoring mode and the tie rule', async () => {
  apiClient.get.mockResolvedValue({ data: STANDINGS });
  renderWithProviders(<PickemStandings leagueId={7} />);

  expect(await screen.findByText(/confidence points/i)).toBeInTheDocument();
  expect(screen.getByText(/tied game credits nobody/i)).toBeInTheDocument();
  // No season prop — the server picks the league's current season.
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings');
});

test('shows a per-week points column when the page passes the selected week', async () => {
  const withWeekly = {
    ...STANDINGS,
    standings: STANDINGS.standings.map((row) => ({ ...row, weekly: { 3: row.userId === 2 ? 5 : 8 } })),
  };
  apiClient.get.mockResolvedValue({ data: withWeekly });
  renderWithProviders(<PickemStandings leagueId={7} season={2026} week={3} />);

  const table = await screen.findByRole('table');
  expect(within(table).getByText('Wk 3')).toBeInTheDocument();
  const rows = within(table).getAllByRole('row').slice(1);
  expect(within(rows[0]).getByText('5')).toBeInTheDocument();
  expect(within(rows[1]).getByText('8')).toBeInTheDocument();
});

test('omits the weekly column without a week (rows may predate the field)', async () => {
  apiClient.get.mockResolvedValue({ data: STANDINGS });
  renderWithProviders(<PickemStandings leagueId={7} season={2026} />);

  const table = await screen.findByRole('table');
  expect(within(table).queryByText(/^Wk /)).not.toBeInTheDocument();
});

test('a failed load offers a retry', async () => {
  const user = userEvent.setup();
  apiClient.get.mockRejectedValueOnce({ response: { data: { error: 'database is down' } } });
  renderWithProviders(<PickemStandings leagueId={7} />);

  expect(await screen.findByText(/database is down/)).toBeInTheDocument();

  apiClient.get.mockResolvedValue({ data: STANDINGS });
  await user.click(screen.getByRole('button', { name: /Retry standings/i }));

  await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
});
