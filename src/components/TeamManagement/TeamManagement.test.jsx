import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import TeamManagement from './TeamManagement';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const makeLeague = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  draft_status: 'complete',
  waiver_type: 'priority',
  my_team_id: 101,
  my_team_name: 'Gridiron Guild',
  my_team_waiver_priority: 3,
  my_team_faab_remaining: 100,
  ...overrides,
});

const makeStanding = (overrides = {}) => ({
  teamId: 101,
  wins: 0,
  losses: 0,
  ties: 0,
  rank: 1,
  ...overrides,
});

const standingsResponse = (rows) => ({ data: { standings: rows } });

test('fetches leagues, auto-selects the first one, and loads its roster', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    return Promise.resolve({
      data: [{ id: 10, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs', acquired_at: null }],
    });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/team/roster?leagueId=1'));
  expect(screen.queryByText(/Record: 4-0/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Rank: 1st/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Waiver: 3/)).not.toBeInTheDocument();
});

test('shows skeleton rows (not the empty state) while data is loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<TeamManagement />);

  expect(screen.getAllByTestId('roster-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByText(/No players rostered yet/)).not.toBeInTheDocument();
  expect(screen.queryByText(/not in a fantasy league yet/i)).not.toBeInTheDocument();
});

test('shows a compact summary skeleton while standings load', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague()] });
    if (url.includes('/standings')) return new Promise(() => {});
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByTestId('team-summary-skeleton')).toBeInTheDocument();
});

test('renders a pre-draft summary and directs an empty roster to the Draft Room', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') {
      return Promise.resolve({
        data: [makeLeague({ draft_status: 'pending', my_team_waiver_priority: null })],
      });
    }
    if (url.includes('/standings')) return Promise.resolve(standingsResponse([makeStanding()]));
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('No record yet · Waiver order not set')).toBeInTheDocument();
  expect(screen.getByText(/Your roster fills during the draft/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/1/draft');
});

test('shows current starter and bench slots with a Set Lineup entry point', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague()] });
    if (url.includes('/standings')) return Promise.resolve(standingsResponse([makeStanding({ wins: 1 })]));
    return Promise.resolve({ data: [
      { id: 10, name: 'Starting Quarterback', position: 'QB', nfl_team: 'KC', lineup_slot: 'QB' },
      { id: 11, name: 'Bench Receiver', position: 'WR', nfl_team: 'CHI', lineup_slot: 'BENCH' },
    ] });
  });
  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Starting Quarterback')).toBeInTheDocument();
  expect(screen.getByText('BENCH')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Set Lineup' })).toHaveAttribute('href', '/league/1/lineup');
});

test('an attested IR stash reads "IR (attested)" in the roster slot column', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague()] });
    if (url.includes('/standings')) return Promise.resolve(standingsResponse([makeStanding({ wins: 1 })]));
    return Promise.resolve({ data: [
      { id: 12, name: 'Attested Runner', position: 'RB', nfl_team: 'MIN', lineup_slot: 'IR', ir_attested: true },
      { id: 13, name: 'Eligible Runner', position: 'RB', nfl_team: 'GB', lineup_slot: 'IR', ir_attested: false },
    ] });
  });
  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Attested Runner')).toBeInTheDocument();
  expect(screen.getByText('IR (attested)')).toBeInTheDocument();
  // The normally eligible stash keeps the plain slot label.
  expect(screen.getByText('IR')).toBeInTheDocument();
});

test('post-draft zero-game summary omits rank and keeps the real waiver priority', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague({ my_team_waiver_priority: 4 })] });
    if (url.includes('/standings')) return Promise.resolve(standingsResponse([makeStanding({ rank: 2 })]));
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('No record yet · Waiver priority: #4')).toBeInTheDocument();
  expect(screen.queryByText(/Rank:/)).not.toBeInTheDocument();
});

test('renders active priority-waiver record, rank, and priority', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague()] });
    if (url.includes('/standings')) {
      return Promise.resolve(standingsResponse([makeStanding({ wins: 4, losses: 2, ties: 1, rank: 3 })]));
    }
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Record: 4-2-1 · Rank: #3 · Waiver priority: #3')).toBeInTheDocument();
});

test('renders active FAAB record, rank, and remaining balance', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') {
      return Promise.resolve({ data: [makeLeague({ waiver_type: 'faab', my_team_faab_remaining: 85 })] });
    }
    if (url.includes('/standings')) {
      return Promise.resolve(standingsResponse([makeStanding({ wins: 6, losses: 1, rank: 1 })]));
    }
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Record: 6-1-0 · Rank: #1 · FAAB remaining: $85')).toBeInTheDocument();
});

test('keeps the roster visible and real waiver data when standings are unavailable', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague({ my_team_waiver_priority: 2 })] });
    if (url.includes('/standings')) return Promise.reject(new Error('standings unavailable'));
    return Promise.resolve({
      data: [{ id: 10, name: 'Roster Player', position: 'RB', nfl_team: 'CHI', acquired_at: null }],
    });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Roster Player')).toBeInTheDocument();
  expect(await screen.findByText('Record unavailable · Waiver priority: #2')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('treats a missing team standings row as unavailable and keeps real FAAB', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') {
      return Promise.resolve({ data: [makeLeague({ waiver_type: 'faab', my_team_faab_remaining: 60 })] });
    }
    if (url.includes('/standings')) {
      return Promise.resolve(standingsResponse([makeStanding({ teamId: 999, wins: 3 })]));
    }
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Record unavailable · FAAB remaining: $60')).toBeInTheDocument();
});

test('renders defensive waiver and FAAB fallbacks when balances are missing', async () => {
  const leagues = [
    makeLeague({ my_team_waiver_priority: null }),
    makeLeague({
      id: 2,
      name: 'FAAB League',
      my_team_id: 202,
      waiver_type: 'faab',
      my_team_faab_remaining: null,
    }),
  ];
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: leagues });
    if (url === '/api/scoring/league/1/standings') {
      return Promise.resolve(standingsResponse([makeStanding({ wins: 1 })]));
    }
    if (url === '/api/scoring/league/2/standings') {
      return Promise.resolve(standingsResponse([makeStanding({ teamId: 202, wins: 1 })]));
    }
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText(/Waiver order not set/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'League' }));
  await userEvent.click(await screen.findByRole('option', { name: 'FAAB League' }));
  expect(await screen.findByText(/FAAB unavailable/)).toBeInTheDocument();
});

test('ignores stale standings after switching leagues and selects by my_team_id', async () => {
  let resolveFirstStandings;
  const firstStandings = new Promise((resolve) => { resolveFirstStandings = resolve; });
  const leagues = [
    makeLeague({ my_team_id: 111, my_team_name: 'First Team' }),
    makeLeague({ id: 2, name: 'Second League', my_team_id: 222, my_team_name: 'Second Team' }),
  ];
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: leagues });
    if (url === '/api/scoring/league/1/standings') return firstStandings;
    if (url === '/api/scoring/league/2/standings') {
      return Promise.resolve(standingsResponse([
        makeStanding({ teamId: 111, wins: 9, rank: 1 }),
        makeStanding({ teamId: 222, wins: 2, losses: 1, rank: 2 }),
      ]));
    }
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('First Team')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'League' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Second League' }));
  expect(await screen.findByText('Record: 2-1-0 · Rank: #2 · Waiver priority: #3')).toBeInTheDocument();

  await act(async () => {
    resolveFirstStandings(standingsResponse([makeStanding({ teamId: 111, wins: 8, rank: 1 })]));
  });
  expect(screen.queryByText(/Record: 8-0-0/)).not.toBeInTheDocument();
  expect(screen.getByText('Second Team')).toBeInTheDocument();
});

test('completed draft keeps the Browse Players action when the roster is empty', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague()] });
    if (url.includes('/standings')) return Promise.resolve(standingsResponse([makeStanding()]));
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText(/No players rostered yet/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /browse players/i })).toHaveAttribute('href', '/player');
});

test('active draft directs an empty roster to the Draft Room', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague({ draft_status: 'active' })] });
    if (url.includes('/standings')) return Promise.resolve(standingsResponse([makeStanding()]));
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText(/Head to the Draft Room/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/1/draft');
});

test('preserves the no-league empty state', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText(/not in a fantasy league yet/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to Leagues' })).toHaveAttribute('href', '/league');
});

test('renders an acquired date when present, and an em dash when absent', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    return Promise.resolve({
      data: [
        { id: 10, name: 'Has Date', position: 'RB', nfl_team: 'X', acquired_at: '2026-01-15T00:00:00.000Z' },
        { id: 11, name: 'No Date', position: 'WR', nfl_team: 'Y', acquired_at: null },
      ],
    });
  });

  renderWithProviders(<TeamManagement />);

  await screen.findByText('Has Date');
  expect(screen.getByText(new Date('2026-01-15T00:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
  const noDateRow = screen.getByText('No Date').closest('tr');
  expect(noDateRow).toHaveTextContent('-');
});

test('dropping a player calls the delete endpoint with the selected league and refetches', async () => {
  apiClient.get
    .mockImplementationOnce(() => Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] })) // leagues
    .mockImplementationOnce(() =>
      Promise.resolve({ data: [{ id: 10, name: 'Drop Me', position: 'TE', nfl_team: 'X', acquired_at: null }] })
    ) // initial roster
    .mockImplementationOnce(() => Promise.resolve({ data: [] })); // roster after drop
  apiClient.delete.mockResolvedValue({});

  renderWithProviders(<TeamManagement />);
  await screen.findByText('Drop Me');

  await userEvent.click(screen.getByRole('button', { name: 'Drop' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/10?leagueId=1')
  );
  expect(await screen.findByText(/No players rostered yet/)).toBeInTheDocument();
});

test('clicking Undo on the drop snackbar calls the undo-drop endpoint, not a plain re-add', async () => {
  apiClient.get
    .mockImplementationOnce(() => Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] })) // leagues
    .mockImplementationOnce(() =>
      Promise.resolve({ data: [{ id: 10, name: 'Drop Me', position: 'TE', nfl_team: 'X', acquired_at: null }] })
    ) // initial roster
    .mockImplementationOnce(() => Promise.resolve({ data: [] })) // roster after drop
    .mockImplementationOnce(() =>
      Promise.resolve({ data: [{ id: 10, name: 'Drop Me', position: 'TE', nfl_team: 'X', acquired_at: null }] })
    ); // roster after undo
  apiClient.delete.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});

  renderWithProviders(
    <SnackbarProvider>
      <TeamManagement />
    </SnackbarProvider>
  );
  await screen.findByText('Drop Me');

  await userEvent.click(screen.getByRole('button', { name: 'Drop' }));
  await screen.findByText(/No players rostered yet/);

  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/10/undo-drop', { leagueId: 1 })
  );
  expect(await screen.findByText('Drop Me')).toBeInTheDocument();
});

test('shows an error alert when the roster fetch fails', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    return Promise.reject({ response: { data: { error: 'roster unavailable' } } });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('roster unavailable')).toBeInTheDocument();
});

test("pick'em-only leagues are left out of the league selector because they have no roster to manage", async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') {
      return Promise.resolve({
        data: [
          { id: 5, name: 'Office Pool', pickem_only: true, draft_status: 'pending' },
          makeLeague({ id: 1, name: 'Sunday Ballers' }),
        ],
      });
    }
    if (String(url).startsWith('/api/scoring/')) return Promise.resolve(standingsResponse([makeStanding()]));
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  // The first FANTASY league is auto-selected, not the pick'em pool listed first.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/team/roster?leagueId=1'));
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/team/roster?leagueId=5');
  await userEvent.click(screen.getByRole('combobox', { name: 'League' }));
  expect(await screen.findByRole('option', { name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Office Pool' })).not.toBeInTheDocument();
});

test("a manager whose only league is pick'em-only sees the no-roster empty state", async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') {
      return Promise.resolve({ data: [{ id: 5, name: 'Office Pool', pickem_only: true, draft_status: 'pending' }] });
    }
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText(/not in a fantasy league yet/i)).toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/team/roster'));
});
