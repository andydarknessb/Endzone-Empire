import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueDiscovery from './LeagueDiscovery';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const renderScreen = () =>
  renderWithProviders(<LeagueDiscovery />, { route: '/discover', path: '/discover' });

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  maxTeams: 10,
  teamCount: 8,
  openSlots: 2,
  scoringPreset: 'ppr',
  bestBall: false,
  joinApproval: false,
  draftDate: '2026-09-04T13:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  alreadyMember: false,
  myRequestStatus: null,
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders the league list with teams, scoring chip, best ball chip, and draft date', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ bestBall: true })] });
  renderScreen();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText(/8\/10 teams · 2 slots open/)).toBeInTheDocument();
  expect(screen.getByText('PPR')).toBeInTheDocument();
  expect(screen.getByText('Best Ball')).toBeInTheDocument();
  expect(screen.getByText(`Draft: ${new Date('2026-09-04T13:00:00.000Z').toLocaleString()}`)).toBeInTheDocument();
  expect(screen.getByText('1 public league found')).toBeInTheDocument();
});

test('shows a create-league CTA when there are no public leagues and no filters', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderScreen();

  expect(await screen.findByText(/no public leagues yet/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /create a league/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /invite friends/i })).toBeInTheDocument();
});

test('blames the filters only when a search is active and nothing matches', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderScreen();

  const searchBox = await screen.findByLabelText('Search');
  await userEvent.type(searchBox, 'zzz');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText(/no leagues match your filters/i)).toBeInTheDocument();
});

test('shows an error alert when the fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'discovery unavailable' } } });
  renderScreen();

  expect(await screen.findByText('discovery unavailable')).toBeInTheDocument();
});

test('always includes the default sort, and submitting search adds the search param', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/discover?sort=newest');

  await userEvent.type(screen.getByLabelText('Search'), 'Sunday');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/discover?search=Sunday&sort=newest')
  );
});

test('changing the scoring filter refetches with the scoring param', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByLabelText('Scoring'));
  await userEvent.click(await screen.findByRole('option', { name: 'PPR' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/discover?scoring=ppr&sort=newest')
  );
});

test('toggling "Open slots only" refetches with the openSlots param', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByLabelText('Open slots only'));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/discover?openSlots=true&sort=newest')
  );
});

test('changing sort refetches with the new sort param', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByLabelText('Sort by'));
  await userEvent.click(await screen.findByRole('option', { name: 'Draft date' }));

  await waitFor(() =>
    // snake_case: must match the server's VALID_DISCOVER_SORTS enum exactly
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/discover?sort=draft_date')
  );
});

test('direct join posts team name and navigates to the league dashboard on 201', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  apiClient.post.mockResolvedValue({ status: 201, data: { league: { id: 1 }, team: { id: 5 } } });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'Join' }));
  await userEvent.type(screen.getByLabelText('Team name'), "Cory's Squad");
  await userEvent.click(screen.getByRole('button', { name: 'Join' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/join-public', {
      teamName: "Cory's Squad",
    })
  );
  expect(mockNavigate).toHaveBeenCalledWith('/league/1');
});

test('an approval-required league shows "Request to join" and flips to a disabled pending state on 202', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ joinApproval: true })] });
  apiClient.post.mockResolvedValue({ status: 202, data: { status: 'pending' } });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'Request to join' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Team name'), "Cory's Squad");
  await userEvent.click(within(dialog).getByRole('button', { name: 'Request to join' }));

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Request pending' })).toBeDisabled()
  );
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('a league with myRequestStatus "pending" renders the disabled pending state on load', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ joinApproval: true, myRequestStatus: 'pending' })] });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('button', { name: 'Request pending' })).toBeDisabled();
});

test('an already-member league shows a View link instead of a join button', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ alreadyMember: true })] });
  renderScreen();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/league/1');
  expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument();
});

test("a pick'em-only league is labelled Pick'em and shows no scoring preset or draft date", async () => {
  apiClient.get.mockResolvedValue({
    data: [
      league({ id: 5, name: 'Office Pool', pickemOnly: true, scoringPreset: null, draftDate: null, maxTeams: 50, teamCount: 12 }),
      league({ id: 1, name: 'Sunday Ballers', pickemOnly: false }),
    ],
  });
  renderScreen();

  const pool = (await screen.findByText('Office Pool')).closest('.MuiCard-root');
  expect(within(pool).getByText("Pick'em")).toBeInTheDocument();
  expect(within(pool).queryByText('Standard')).not.toBeInTheDocument();
  expect(within(pool).queryByText(/Draft/)).not.toBeInTheDocument();
  expect(within(pool).getByText(/12\/50 teams · 38 slots open/)).toBeInTheDocument();
  expect(within(pool).getByText('Pick winners every week · no draft')).toBeInTheDocument();

  const fantasy = screen.getByText('Sunday Ballers').closest('.MuiCard-root');
  expect(within(fantasy).queryByText("Pick'em")).not.toBeInTheDocument();
  expect(within(fantasy).getByText('PPR')).toBeInTheDocument();
  expect(within(fantasy).getByText(/^Draft: /)).toBeInTheDocument();
});

test("a full pick'em-only league reads the same as an open one (the slot count carries the availability)", async () => {
  apiClient.get.mockResolvedValue({
    data: [league({ id: 5, name: 'Office Pool', pickemOnly: true, scoringPreset: null, draftDate: null, maxTeams: 12, teamCount: 12 })],
  });
  renderScreen();

  const pool = (await screen.findByText('Office Pool')).closest('.MuiCard-root');
  expect(within(pool).getByText(/12\/12 teams · 0 slots open/)).toBeInTheDocument();
  expect(within(pool).getByText('Pick winners every week · no draft')).toBeInTheDocument();
  expect(within(pool).queryByText(/join any time|joins stay open/i)).not.toBeInTheDocument();
});
