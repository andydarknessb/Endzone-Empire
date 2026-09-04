import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import TeamLineup from './TeamLineup';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
  clearLeagueCache();
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
  best_ball: false,
  ...overrides,
});

const lineupResponse = (overrides = {}) => ({
  leagueId: 1,
  teamId: 101,
  season: 2026,
  week: 3,
  currentWeek: 3,
  rosterSlots: [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'WR', count: 1, eligiblePositions: ['WR'] },
  ],
  benchSlots: 5,
  irSlots: 1,
  entries: [
    { id: 10, name: 'Starting Quarterback', position: 'QB', nfl_team: 'KC', slot: 'QB', locked: false, onBye: false, projected_points: 18.4 },
    { id: 11, name: 'Bench Receiver', position: 'WR', nfl_team: 'CHI', slot: 'BENCH', locked: false, onBye: false, projected_points: 11.2 },
  ],
  ...overrides,
});

const rosterRows = () => [
  {
    id: 10,
    name: 'Starting Quarterback',
    position: 'QB',
    nfl_team: 'KC',
    lineup_slot: 'QB',
    photo_url: 'https://example.test/qb.png',
    bye_week: 8,
    injury_status: 'Q',
    acquired_at: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 11,
    name: 'Bench Receiver',
    position: 'WR',
    nfl_team: 'CHI',
    lineup_slot: 'BENCH',
    photo_url: 'https://example.test/wr.png',
    bye_week: 10,
    injury_status: null,
    acquired_at: null,
  },
];

const mockTeamApi = ({
  league = makeLeague(),
  roster = rosterRows(),
  lineup = lineupResponse(),
  standings = [{ teamId: 101, wins: 1, losses: 0, ties: 0, rank: 1 }],
} = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [league] });
    if (url === `/api/league/${league.id}`) return Promise.resolve({ data: { league } });
    if (url === `/api/team/roster?leagueId=${league.id}`) return Promise.resolve({ data: roster });
    if (url === `/api/team/lineup?leagueId=${league.id}`) return Promise.resolve({ data: lineup });
    if (url.includes('/standings')) return Promise.resolve({ data: { standings } });
    if (url.includes('/hindsight')) return Promise.resolve({ data: {} });
    if (url.includes('/advice')) return Promise.resolve({ data: null });
    return Promise.resolve({ data: {} });
  });
};

test('shows lineup loading placeholders while the Team roster is loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));

  renderWithProviders(<TeamLineup />);

  expect(screen.getByTestId('team-lineup-skeleton')).toBeInTheDocument();
  expect(screen.getAllByTestId('roster-skeleton')).toHaveLength(3);
});

test('renders roster-managed player rows in one Team Lineup surface', async () => {
  mockTeamApi();

  renderWithProviders(<TeamLineup />);

  expect(await screen.findByRole('heading', { name: 'Gridiron Guild' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Lineup' })).toBeInTheDocument();
  expect(screen.getByText('Record: 1-0-0 · Rank: #1 · Waiver priority: #3')).toBeInTheDocument();

  const quarterbackRow = screen.getByTestId('slot-row-QB-0');
  expect(within(quarterbackRow).getByText('Starting Quarterback')).toBeInTheDocument();
  expect(quarterbackRow).toHaveTextContent('Bye 8');
  expect(quarterbackRow).toHaveTextContent('Acquired');
  expect(quarterbackRow).toHaveTextContent('proj 18.4');
  expect(within(quarterbackRow).getByLabelText('Injury status: questionable')).toBeInTheDocument();
  expect(within(quarterbackRow).getByRole('link', { name: 'Trade' })).toHaveAttribute('href', '/league/1/trades');
  expect(within(quarterbackRow).getByRole('button', { name: 'Drop' })).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Roster management' })).not.toBeInTheDocument();
});

test('keeps lineup assignment in the same surface as roster actions', async () => {
  mockTeamApi();
  apiClient.put.mockResolvedValue({});

  renderWithProviders(<TeamLineup />);

  await screen.findByText('Bench Receiver');
  await userEvent.click(screen.getByTestId('slot-row-BENCH-11'));
  await userEvent.click(screen.getByTestId('slot-row-WR-0'));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
    leagueId: 1,
    week: 3,
    moves: [{ playerId: 11, slot: 'WR' }],
  }));
});

test('keeps roster actions available when Best Ball makes a starter assignment read-only', async () => {
  mockTeamApi({ league: makeLeague({ best_ball: true }) });

  renderWithProviders(<TeamLineup />);

  expect(await screen.findByTestId('best-ball-alert')).toBeInTheDocument();
  const quarterbackRow = screen.getByTestId('slot-row-QB-0');
  expect(quarterbackRow).toHaveAttribute('aria-disabled', 'true');
  expect(within(quarterbackRow).getByRole('button', { name: 'Drop' })).toBeEnabled();
  expect(within(quarterbackRow).getByRole('link', { name: 'Trade' })).toHaveAttribute('href', '/league/1/trades');
});

test('keeps historical Lineup rows read-only for roster actions', async () => {
  mockTeamApi();
  const defaultGet = apiClient.get.getMockImplementation();
  const historicalLineup = lineupResponse({ week: 2, currentWeek: 3 });
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/team/lineup?leagueId=1&week=2') {
      return Promise.resolve({ data: historicalLineup });
    }
    return defaultGet(url);
  });

  renderWithProviders(<TeamLineup />);

  await screen.findByText('Starting Quarterback');
  await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup?leagueId=1&week=2'));
  expect(screen.getByRole('combobox', { name: 'Week' })).toHaveTextContent('Week 2');
  const historicalQuarterback = screen.getByTestId('slot-row-QB-0');
  expect(within(historicalQuarterback).queryByRole('button', { name: 'Drop' })).not.toBeInTheDocument();
  expect(within(historicalQuarterback).queryByRole('link', { name: 'Trade' })).not.toBeInTheDocument();
});

test('drops from a Lineup row and offers an undo that uses the undo-drop endpoint', async () => {
  let roster = rosterRows().slice(0, 1);
  let lineup = lineupResponse({ entries: [lineupResponse().entries[0]] });
  mockTeamApi({ roster, lineup });
  apiClient.delete.mockImplementation(async () => {
    roster = [];
    lineup = lineupResponse({ entries: [] });
  });
  apiClient.post.mockImplementation(async () => {
    roster = rosterRows().slice(0, 1);
    lineup = lineupResponse({ entries: [lineupResponse().entries[0]] });
  });
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [makeLeague()] });
    if (url === '/api/league/1') return Promise.resolve({ data: { league: makeLeague() } });
    if (url === '/api/team/roster?leagueId=1') return Promise.resolve({ data: roster });
    if (url === '/api/team/lineup?leagueId=1') return Promise.resolve({ data: lineup });
    if (url.includes('/standings')) return Promise.resolve({ data: { standings: [] } });
    if (url.includes('/hindsight') || url.includes('/advice')) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });

  renderWithProviders(<SnackbarProvider><TeamLineup /></SnackbarProvider>);

  await screen.findByText('Starting Quarterback');
  await userEvent.click(screen.getByRole('button', { name: 'Drop' }));
  expect(apiClient.delete).not.toHaveBeenCalled();

  const dialog = await screen.findByRole('dialog', { name: /Drop .*\?/ });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Drop' }));
  await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/10?leagueId=1'));
  expect(await screen.findByText(/No players rostered yet/)).toBeInTheDocument();

  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/10/undo-drop', { leagueId: 1 }));
  expect(await screen.findByText('Starting Quarterback')).toBeInTheDocument();
});

test('cancelling the drop warning keeps the player and never calls the drop endpoint', async () => {
  mockTeamApi({
    roster: rosterRows().slice(0, 1),
    lineup: lineupResponse({ entries: [lineupResponse().entries[0]] }),
  });

  renderWithProviders(<SnackbarProvider><TeamLineup /></SnackbarProvider>);

  await screen.findByText('Starting Quarterback');
  await userEvent.click(screen.getByRole('button', { name: 'Drop' }));

  const dialog = await screen.findByRole('dialog', { name: /Drop .*\?/ });
  expect(within(dialog).getByText(/becomes available to every other manager/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(apiClient.delete).not.toHaveBeenCalled();
  expect(screen.getByText('Starting Quarterback')).toBeInTheDocument();
});

test('shows the Draft Room state for a pre-draft Team with no roster', async () => {
  mockTeamApi({ league: makeLeague({ draft_status: 'pending', my_team_waiver_priority: null }), roster: [] });

  renderWithProviders(<TeamLineup />);

  expect(await screen.findByText(/Your roster fills during the draft/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/1/draft');
});

test('shows the Draft Room state for a drafting Team with no roster', async () => {
  mockTeamApi({ league: makeLeague({ draft_status: 'active' }), roster: [] });

  renderWithProviders(<TeamLineup />);

  expect(await screen.findByText(/Your roster fills during the draft/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/1/draft');
});

test('shows Browse Players after a completed draft when the roster is empty', async () => {
  mockTeamApi({ roster: [] });

  renderWithProviders(<TeamLineup />);

  expect(await screen.findByText(/No players rostered yet/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Browse Players' })).toHaveAttribute('href', '/player');
});

test('shows a roster request error without replacing the Team surface', async () => {
  const league = makeLeague();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [league] });
    if (url === `/api/team/roster?leagueId=${league.id}`) {
      return Promise.reject({ response: { data: { error: 'Roster unavailable' } } });
    }
    if (url.includes('/standings')) return Promise.resolve({ data: { standings: [] } });
    return Promise.resolve({ data: {} });
  });

  renderWithProviders(<TeamLineup />);

  expect(await screen.findByText('Roster unavailable')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Gridiron Guild' })).toBeInTheDocument();
});

test('keeps pickem-only leagues out of the Team selector', async () => {
  const fantasyLeague = makeLeague();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [
      { id: 9, name: 'Office Pool', pickem_only: true },
      fantasyLeague,
    ] });
    if (url === '/api/league/1') return Promise.resolve({ data: { league: fantasyLeague } });
    if (url === '/api/team/roster?leagueId=1') return Promise.resolve({ data: [] });
    if (url.includes('/standings')) return Promise.resolve({ data: { standings: [] } });
    return Promise.resolve({ data: {} });
  });

  renderWithProviders(<TeamLineup />);

  await userEvent.click(await screen.findByRole('combobox', { name: 'League' }));
  expect(await screen.findByRole('option', { name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Office Pool' })).not.toBeInTheDocument();
});
