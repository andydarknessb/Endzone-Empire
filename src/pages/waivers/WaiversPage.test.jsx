import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import WaiversPage from './WaiversPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), put: jest.fn(), patch: jest.fn() },
}));

const hours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

const cardsPlayer = (overrides = {}) => ({
  id: 7,
  name: 'Breece Hall',
  position: 'RB',
  nfl_team: 'New York Jets',
  photo_url: null,
  injury_status: null,
  bye_week: 9,
  availability: { state: 'waivers', teamId: null, teamName: null, availableAt: hours(30) },
  projWeek: { week: 4, points: 12.1 },
  ros: { points: 150 },
  weeks: [],
  ownership: null,
  upgrade: null,
  ...overrides,
});

const waiversBody = (over = {}) => ({
  league: { waiver_type: 'faab', waiver_period_hours: 24, faab_budget: 100, waivers_clear_at: null, current_season: 2026 },
  myTeam: { id: 10, waiver_priority: 7, faab_remaining: 62 },
  myClaims: [],
  onWaivers: [],
  ...over,
});

const pendingClaim = (over = {}) => ({
  id: 1,
  player_id: 7,
  player_name: 'Breece Hall',
  drop_player_id: null,
  drop_player_name: null,
  bid: 10,
  status: 'pending',
  note: null,
  claim_order: 2,
  created_at: '2026-09-20T00:00:00Z',
  processed_at: null,
  clear_at: hours(14),
  ...over,
});

const FAAB_LEAGUE = { id: 1, best_ball: false, waiver_type: 'faab', waiver_period_hours: 24 };

const setup = ({
  league = FAAB_LEAGUE,
  waivers = waiversBody(),
  players = [cardsPlayer()],
  context = { rosterCount: 18, rosterCapacity: 20 },
  total,
  playersError = null,
  lineup = { week: 4, currentWeek: 4, entries: [] },
  claimTarget,
} = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/players') {
      if (playersError) return Promise.reject(playersError);
      return Promise.resolve({ data: { players, totalPages: 1, total: total ?? players.length, context } });
    }
    if (url.startsWith('/api/waivers/claim-target')) return Promise.resolve({ data: { player: claimTarget } });
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waivers });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: [] });
    if (url.startsWith('/api/team/lineup')) return Promise.resolve({ data: lineup });
    if (url.startsWith('/api/league/')) return Promise.resolve({ data: { league, teams: [] } });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
};

const renderPage = (route = '/league/1/waivers') =>
  renderWithProviders(<WaiversPage />, { path: '/league/:leagueId/waivers', route });

const playerReads = () => apiClient.get.mock.calls.filter(([url]) => url === '/api/players');

// useLeague serves repeat mounts from a module-level cache; a test's league must not leak into the next.
beforeEach(() => clearLeagueCache());
afterEach(() => jest.clearAllMocks());

test('first load sends the locked Availability and sort=upgrade outside best ball', async () => {
  setup();
  renderPage();
  await screen.findByText('Breece Hall');
  const params = playerReads()[0][1].params;
  expect(params).toMatchObject({ availability: 'waivers', sort: 'upgrade', view: 'cards', leagueId: 1 });
  expect(screen.queryByRole('radiogroup', { name: 'Availability' })).not.toBeInTheDocument();
});

test('best ball sends no Upgrade sort on any read, the first included', async () => {
  setup({ league: { id: 1, best_ball: true, waiver_type: 'priority' } });
  renderPage();
  await screen.findByText('Breece Hall');
  playerReads().forEach(([, config]) => expect(config.params.sort).not.toBe('upgrade'));
  expect(playerReads()[0][1].params.availability).toBe('waivers');
});

test('search, position, bye week, sort and page are read from the URL', async () => {
  setup();
  renderPage('/league/1/waivers?q=hall&pos=RB&bye=9&sort=ros&page=2');
  await waitFor(() => expect(playerReads().length).toBeGreaterThan(0));
  const params = playerReads()[playerReads().length - 1][1].params;
  expect(params).toMatchObject({ search: 'hall', position: 'RB', byeWeeks: '9', page: 2, availability: 'waivers' });
  expect(params.sort).not.toBe('upgrade');
  expect(screen.getByRole('combobox', { name: 'Bye week' })).toBeInTheDocument();
});

test('the strip shows the next Clear time, FAAB left after pending bids and the roster count', async () => {
  setup({
    waivers: waiversBody({
      myClaims: [
        pendingClaim({ bid: 10 }),
        pendingClaim({ id: 2, player_id: 8, player_name: 'Late Add', bid: 14, claim_order: 3, clear_at: hours(40) }),
      ],
    }),
  });
  renderPage();
  const strip = await screen.findByTestId('waiver-summary');
  await within(strip).findByText('$38');
  expect(within(screen.getByTestId('waiver-summary-faab')).getByText('$24 bid on 2 pending claims')).toBeInTheDocument();
  expect(within(screen.getByTestId('waiver-summary-next-clear')).getByText(/Breece Hall clears/)).toBeInTheDocument();
  expect(await within(screen.getByTestId('waiver-summary')).findByText('18/20')).toBeInTheDocument();
  expect(strip.textContent).not.toMatch(/claims process at/i);
});

test('a non-FAAB league shows Waiver priority and no FAAB tile', async () => {
  setup({
    league: { id: 1, best_ball: false, waiver_type: 'priority' },
    waivers: waiversBody({ league: { waiver_type: 'priority', waivers_clear_at: null } }),
  });
  renderPage();
  const priority = await screen.findByTestId('waiver-summary-priority');
  expect(within(priority).getByText('#7')).toBeInTheDocument();
  expect(screen.queryByTestId('waiver-summary-faab')).not.toBeInTheDocument();
});

test('at Roster capacity the strip flags a required drop', async () => {
  setup({ context: { rosterCount: 20, rosterCapacity: 20 } });
  renderPage();
  const roster = await screen.findByTestId('waiver-summary-roster');
  await within(roster).findByText('Full');
  expect(within(roster).getByText('Every claim needs a drop.')).toBeInTheDocument();
});

test('a row with a pending claim reads "Claim #n", others read Claim', async () => {
  setup({
    players: [cardsPlayer(), cardsPlayer({ id: 8, name: 'Other Guy' })],
    waivers: waiversBody({ myClaims: [pendingClaim({ player_id: 7, claim_order: 2 })] }),
  });
  renderPage();
  await screen.findByText('Other Guy');
  await screen.findByRole('button', { name: 'Claim #2' });
  expect(screen.getAllByRole('button', { name: 'Claim' })).toHaveLength(1);
});

test('Ownership renders when present', async () => {
  setup({ players: [cardsPlayer({ ownership: 41 })] });
  renderPage();
  expect(await screen.findByText('41%')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Ownership' })).toBeInTheDocument();
});

test('the Ownership column is hidden while every share is null', async () => {
  setup({ players: [cardsPlayer({ ownership: null })] });
  renderPage();
  await screen.findByText('Breece Hall');
  expect(screen.queryByRole('columnheader', { name: 'Ownership' })).not.toBeInTheDocument();
});

test('an empty list says nobody is on waivers', async () => {
  setup({ players: [] });
  renderPage();
  expect(await screen.findByText('No players are on waivers')).toBeInTheDocument();
});

test('a failed read shows the error state, never an empty list', async () => {
  setup({ playersError: { response: { status: 500, data: { error: 'boom' } }, message: 'Request failed' } });
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent(/boom|Request failed/);
  screen.queryAllByText(/No players/).forEach((el) => expect(el).not.toBeVisible());
});

test('paging reads the next page from the server and lives in the URL', async () => {
  setup();
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/players') {
      return Promise.resolve({
        data: {
          players: [cardsPlayer({ name: `Page ${config.params.page} Guy` })],
          totalPages: 3,
          total: 60,
          context: { rosterCount: 1, rosterCapacity: 20 },
        },
      });
    }
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waiversBody() });
    if (url.startsWith('/api/league/')) return Promise.resolve({ data: { league: FAAB_LEAGUE, teams: [] } });
    if (url.startsWith('/api/team/')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  renderPage();
  await screen.findByText('Page 1 Guy');
  await userEvent.click(screen.getByRole('button', { name: /page 2/i }));
  expect(await screen.findByText('Page 2 Guy')).toBeInTheDocument();
  expect(playerReads()[playerReads().length - 1][1].params.page).toBe(2);
});

test('the tabs hold the selected tab in ?tab=', async () => {
  setup();
  renderPage();
  await screen.findByText('Breece Hall');
  const tabs = screen.getByRole('radiogroup', { name: 'Waivers view' });
  expect(within(tabs).getByRole('radio', { name: 'On waivers' })).toBeChecked();
  await userEvent.click(within(tabs).getByRole('radio', { name: 'My claims' }));
  expect(within(tabs).getByRole('radio', { name: 'My claims' })).toBeChecked();
});

test('?tab=claims opens on My claims', async () => {
  setup();
  renderPage('/league/1/waivers?tab=claims');
  const tabs = await screen.findByRole('radiogroup', { name: 'Waivers view' });
  expect(within(tabs).getByRole('radio', { name: 'My claims' })).toBeChecked();
});

test('the Bye cluster grid sits in the side panel, off the roster the lineup read carries', async () => {
  setup({
    lineup: {
      week: 4,
      currentWeek: 4,
      entries: [
        { id: 1, name: 'A', position: 'QB', slot: 'QB', bye_week: 7 },
        { id: 2, name: 'B', position: 'RB', slot: 'RB', bye_week: 7 },
      ],
    },
  });
  renderPage();
  expect(await screen.findByTestId('bye-cluster-grid')).toBeInTheDocument();
});

test('a server-validated claim target from the Player Browser opens its Decision card', async () => {
  setup({ claimTarget: { id: 8, name: 'Blanket Waiver Player', position: 'WR', nfl_team: 'DAL' } });
  renderPage('/league/1/waivers?playerId=8');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/waivers/claim-target?leagueId=1&playerId=8');
});
