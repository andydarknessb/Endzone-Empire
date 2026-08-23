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

// The standings response as the server sends it: Team identity on every row,
// the account fields the expand step left in place (#112) which this table
// must no longer read, and `viewerTeamId` at the root, which nothing reads
// yet. The last is here to mirror the wire, not because the table uses it:
// marking the viewer's own row is a separate affordance, not this migration.
const STANDINGS = {
  season: 2026,
  mode: 'confidence',
  viewerTeamId: 92,
  standings: [
    { userId: 2, username: 'abe', teamId: 21, teamName: 'Anvils', points: 21, correct: 9, incorrect: 4, pending: 2, rank: 1 },
    { userId: 9, username: 'zoe', teamId: 92, teamName: 'Zephyrs', points: 12, correct: 6, incorrect: 7, pending: 2, rank: 2 },
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

test('names each participant by Team and never by their account', async () => {
  apiClient.get.mockResolvedValue({ data: STANDINGS });
  renderWithProviders(<PickemStandings leagueId={7} season={2026} />);

  const table = await screen.findByRole('table');
  expect(within(table).getByText('Anvils')).toBeInTheDocument();
  expect(within(table).queryByText('abe')).not.toBeInTheDocument();
  expect(within(table).queryByText('zoe')).not.toBeInTheDocument();
  // The column heading follows the identity it now shows.
  expect(within(table).getByText('Team')).toBeInTheDocument();
  expect(within(table).queryByText('Manager')).not.toBeInTheDocument();
  // Rows are addressed by Team too, so nothing keys off the account.
  expect(screen.getByTestId('pickem-standings-row-21')).toBeInTheDocument();
  expect(screen.getByTestId('pickem-standings-row-92')).toBeInTheDocument();
});

// Unlike chat history and revealed picks, a standings row cannot actually
// lose its Team: `getStandings` reads `FROM "teams"`, so a departed manager
// has no row to produce at all. The table still runs its name through the
// shared label, so that every league-shared surface answers a missing Team
// the same way and this one does not become the exception if that query ever
// widens to a LEFT join.
test('a standings row runs its Team name through the same former-manager label as every other surface', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      ...STANDINGS,
      standings: [{ ...STANDINGS.standings[0], teamId: null, teamName: null, username: 'abe' }],
    },
  });
  renderWithProviders(<PickemStandings leagueId={7} season={2026} />);

  const table = await screen.findByRole('table');
  expect(within(table).getByText('Former manager')).toBeInTheDocument();
  expect(within(table).queryByText('abe')).not.toBeInTheDocument();
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
    standings: STANDINGS.standings.map((row) => ({ ...row, weekly: { 3: row.teamId === 21 ? 5 : 8 } })),
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
