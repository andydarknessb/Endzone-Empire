import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import { clearLeagueCache } from '../../hooks/useLeague';
import { clearPickemStandingsCache } from '../../hooks/usePickemStandings';
import LeaguePickem from './LeaguePickem';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
import apiClient from '../../api/apiClient';

const LEAGUE_ID = 7;
const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

const league = (overrides = {}) => ({
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  current_season: 2026,
  current_week: 3,
  ...overrides,
});

const openGame = (overrides = {}) => ({
  week: 3,
  gameKey: 'BUF|MIA',
  teams: ['BUF', 'MIA'],
  kickoffAt: hoursFromNow(48),
  homeTeam: null,
  awayTeam: null,
  status: 'scheduled',
  homeScore: null,
  awayScore: null,
  quarter: null,
  timeRemaining: null,
  tank01GameId: null,
  locked: false,
  winner: null,
  isTie: false,
  ...overrides,
});

const lockedGame = (overrides = {}) => ({
  week: 3,
  gameKey: 'DAL|WAS',
  teams: ['DAL', 'WAS'],
  kickoffAt: hoursFromNow(-24),
  homeTeam: 'DAL',
  awayTeam: 'WAS',
  status: 'final',
  homeScore: 10,
  awayScore: 24,
  quarter: 'Final',
  timeRemaining: null,
  tank01GameId: '20260920_WAS@DAL',
  locked: true,
  winner: 'WAS',
  isTie: false,
  ...overrides,
});

const weekView = (overrides = {}) => ({
  season: 2026,
  week: 3,
  mode: 'straight',
  games: [openGame(), lockedGame()],
  myPicks: [],
  othersPicks: {
    'DAL|WAS': [
      { userId: 5, username: 'rival', gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: null },
    ],
  },
  ...overrides,
});

const mockRequests = ({
  settings = { enabled: true, mode: 'straight', isCommissioner: false },
  view = weekView(),
  standings,
} = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/settings`)) {
      return Promise.resolve({ data: settings });
    }
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/week/`)) {
      return Promise.resolve({ data: view });
    }
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/standings`)) {
      return Promise.resolve({
        data: standings || { season: 2026, mode: 'straight', standings: [] },
      });
    }
    if (url.startsWith('/api/league/')) {
      return Promise.resolve({ data: { league: league(), teams: [] } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
};

const renderPage = () =>
  renderWithProviders(<LeaguePickem />, {
    route: `/league/${LEAGUE_ID}/pickem`,
    path: '/league/:leagueId/pickem',
  });

beforeEach(() => {
  jest.clearAllMocks();
  clearLeagueCache();
  clearPickemStandingsCache();
});

test('a member sees an explanation when the commissioner has not enabled Pick\'em', async () => {
  mockRequests({ settings: { enabled: false, mode: 'straight', isCommissioner: false } });
  renderPage();

  expect(await screen.findByText(/Pick'em is turned off/i)).toBeInTheDocument();
  expect(screen.getByText(/hasn't enabled Pick'em for this league/i)).toBeInTheDocument();
  // The week is never fetched while the feature is off.
  expect(apiClient.get).not.toHaveBeenCalledWith(
    expect.stringContaining(`/api/pickem/league/${LEAGUE_ID}/week/`)
  );
});

test('a commissioner sees the enable switch instead, and turning it on saves', async () => {
  const user = userEvent.setup();
  mockRequests({ settings: { enabled: false, mode: 'straight', isCommissioner: true } });
  apiClient.put.mockResolvedValue({
    data: { enabled: true, mode: 'straight', isCommissioner: true },
  });
  renderPage();

  const toggle = await screen.findByRole('checkbox', { name: /Enable Pick'em for this league/i });
  expect(toggle).not.toBeChecked();
  await user.click(toggle);

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(
      `/api/pickem/league/${LEAGUE_ID}/settings`,
      { enabled: true }
    )
  );
});

test('the board defaults to the league\'s current week and renders the slate', async () => {
  mockRequests();
  renderPage();

  expect(await screen.findByRole('button', { name: 'BUF' })).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith(`/api/pickem/league/${LEAGUE_ID}/week/3`);
  expect(screen.getByRole('button', { name: 'MIA' })).toBeEnabled();
});

test('a locked game is not editable and reveals the rest of the league\'s picks', async () => {
  mockRequests();
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  expect(screen.getByRole('button', { name: 'DAL' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'WAS' })).toBeDisabled();
  expect(screen.getByText(/rival: DAL/)).toBeInTheDocument();
  expect(screen.getByText('WAS won')).toBeInTheDocument();
  // The unlocked game leaks nothing.
  expect(screen.queryByText(/rival: MIA/)).not.toBeInTheDocument();
});

test('picking a team and saving posts only the unlocked games', async () => {
  const user = userEvent.setup();
  mockRequests();
  apiClient.put.mockResolvedValue({ data: { saved: 1, myPicks: [] } });
  renderPage();

  const save = await screen.findByRole('button', { name: /Save picks/i });
  expect(save).toBeDisabled(); // nothing changed yet

  await user.click(screen.getByRole('button', { name: 'BUF' }));
  // Dirty state shows the chip AND a second, sticky Save bar near the bottom.
  expect(screen.getAllByText(/Unsaved changes/i).length).toBeGreaterThanOrEqual(1);
  await user.click(screen.getAllByRole('button', { name: /Save picks/i })[0]);

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(
      `/api/pickem/league/${LEAGUE_ID}/week/3/picks`,
      { picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF' }] }
    )
  );
});

test('a 409 from the server surfaces the offending game', async () => {
  const user = userEvent.setup();
  mockRequests();
  apiClient.put.mockRejectedValue({
    response: {
      data: {
        error: 'those games have already kicked off',
        code: 'PICKEM_LOCKED',
        gameKeys: ['BUF|MIA'],
      },
    },
  });
  renderPage();

  await user.click(await screen.findByRole('button', { name: 'BUF' }));
  await user.click(screen.getAllByRole('button', { name: /Save picks/i })[0]);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/already kicked off/);
  expect(alert).toHaveTextContent(/BUF\|MIA/);
});

test('confidence mode blocks reusing a value another game already owns', async () => {
  const user = userEvent.setup();
  const second = openGame({
    gameKey: 'KC|LV',
    teams: ['KC', 'LV'],
    kickoffAt: hoursFromNow(72),
  });
  mockRequests({
    settings: { enabled: true, mode: 'confidence', isCommissioner: false },
    view: weekView({
      mode: 'confidence',
      games: [openGame(), second],
      othersPicks: {},
      myPicks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 2 }],
    }),
  });
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  // Pick the second game, then open its confidence menu: 2 is spoken for by
  // the first game's saved pick.
  await user.click(screen.getByRole('button', { name: 'KC' }));
  const confidenceSelects = screen.getAllByRole('combobox', { name: /Confidence/i });
  expect(confidenceSelects).toHaveLength(2);
  await user.click(confidenceSelects[1]);

  const options = await screen.findAllByRole('option');
  const two = options.find((option) => option.textContent === '2');
  expect(two).toHaveAttribute('aria-disabled', 'true');
  const one = options.find((option) => option.textContent === '1');
  expect(one).not.toHaveAttribute('aria-disabled', 'true');
});

test('the standings tab lives in the URL', async () => {
  const user = userEvent.setup();
  mockRequests({
    standings: {
      season: 2026,
      mode: 'straight',
      standings: [
        { userId: 9, username: 'me', teamName: 'Mine', points: 4, correct: 4, incorrect: 1, pending: 0, rank: 1 },
      ],
    },
  });
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  await user.click(screen.getByRole('tab', { name: 'Standings' }));

  const table = await screen.findByRole('table');
  expect(within(table).getByText('Mine')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith(
    expect.stringContaining(`/api/pickem/league/${LEAGUE_ID}/standings`)
  );
});

test('a week with no synced schedule says so instead of rendering an empty board', async () => {
  mockRequests({ view: weekView({ games: [], othersPicks: {} }) });
  renderPage();

  expect(await screen.findByText(/No games scheduled/i)).toBeInTheDocument();
});

test('switching weeks with unsaved picks asks before discarding them', async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await user.click(await screen.findByRole('button', { name: 'BUF' }));
  await user.click(screen.getByRole('button', { name: 'Next week' }));

  // The navigation is parked behind a confirmation, not silently applied.
  const dialog = await screen.findByRole('dialog', { name: /Discard unsaved picks/i });
  await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  // findByRole: the closing dialog un-hides the page async (MUI transition).
  expect(await screen.findByRole('button', { name: 'BUF' })).toHaveAttribute('aria-pressed', 'true');

  await user.click(screen.getByRole('button', { name: 'Next week' }));
  const dialog2 = await screen.findByRole('dialog', { name: /Discard unsaved picks/i });
  await user.click(within(dialog2).getByRole('button', { name: 'Discard picks' }));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining(`/api/pickem/league/${LEAGUE_ID}/week/4`)
    )
  );
});

test('a fully locked week explains itself instead of counting zero of zero', async () => {
  mockRequests({ view: weekView({ games: [lockedGame()], othersPicks: {} }) });
  renderPage();

  expect(await screen.findByText(/All games this week have kicked off/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Save picks/i })).not.toBeInTheDocument();
});

test('a locked game the member never picked says so', async () => {
  mockRequests();
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  expect(screen.getByText('No pick')).toBeInTheDocument();
});

test('confidence stays disabled until a team is picked for that game', async () => {
  mockRequests({
    settings: { enabled: true, mode: 'confidence', isCommissioner: false },
    view: weekView({ mode: 'confidence', games: [openGame()], othersPicks: {}, myPicks: [] }),
  });
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  const confidence = screen.getByRole('combobox', { name: /Confidence/i });
  expect(confidence).toHaveAttribute('aria-disabled', 'true');
});

test("the week selector marks the league's current week", async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  await user.click(screen.getByRole('combobox', { name: /Week/i }));
  expect(await screen.findByRole('option', { name: 'Week 3 · current' })).toBeInTheDocument();
});

test("in a pick'em-only league the commissioner cannot turn Pick'em off, only change how it scores", async () => {
  const user = userEvent.setup();
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/settings`)) {
      return Promise.resolve({ data: { enabled: true, mode: 'straight', isCommissioner: true } });
    }
    if (url.startsWith(`/api/pickem/league/${LEAGUE_ID}/week/`)) {
      return Promise.resolve({ data: weekView() });
    }
    if (url.startsWith('/api/league/')) {
      return Promise.resolve({ data: { league: league({ pickem_only: true }), teams: [] } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  renderPage();

  await user.click(await screen.findByRole('button', { name: /Commissioner settings/i }));
  expect(await screen.findByText("Pick'em is always on in this league.")).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Enable Pick'em for this league/i })).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Straight up/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /Confidence/ })).toBeInTheDocument();
});

// --- Standings caching (#35) ---

const standingsCalls = () =>
  apiClient.get.mock.calls.map(([url]) => url).filter((u) => u.includes(`/api/pickem/league/${LEAGUE_ID}/standings`));

test('the Standings tab requests the standings once, for the league season, never a season-less first pass', async () => {
  const user = userEvent.setup();
  mockRequests();
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  await user.click(screen.getByRole('tab', { name: 'Standings' }));
  await screen.findByRole('table');

  expect(standingsCalls()).toEqual([`/api/pickem/league/${LEAGUE_ID}/standings?season=2026`]);
  // Back to Picks and to Standings again: still served from the shared cache.
  await user.click(screen.getByRole('tab', { name: 'Picks' }));
  await screen.findByRole('button', { name: 'BUF' });
  await user.click(screen.getByRole('tab', { name: 'Standings' }));
  await screen.findByRole('table');
  expect(standingsCalls()).toHaveLength(1);
});

test('saving picks invalidates the cached standings so the Standings tab reflects them', async () => {
  const user = userEvent.setup();
  mockRequests();
  // The server answers the re-load after a save with the saved pick, which is
  // what clears the board's dirty state (and its leave-tab guard).
  apiClient.put.mockImplementation(async () => {
    mockRequests({ view: weekView({ myPicks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: null }] }) });
    return { data: { saved: 1, myPicks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: null }] } };
  });
  renderPage();

  await screen.findByRole('button', { name: 'BUF' });
  await user.click(screen.getByRole('tab', { name: 'Standings' }));
  await screen.findByRole('table');
  expect(standingsCalls()).toHaveLength(1);

  await user.click(screen.getByRole('tab', { name: 'Picks' }));
  await user.click(await screen.findByRole('button', { name: 'BUF' }));
  await user.click(screen.getAllByRole('button', { name: /Save picks/i })[0]);
  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());

  await user.click(screen.getByRole('tab', { name: 'Standings' }));
  await screen.findByRole('table');
  await waitFor(() => expect(standingsCalls()).toHaveLength(2));
});
