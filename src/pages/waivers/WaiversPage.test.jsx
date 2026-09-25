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
  await screen.findByRole('button', { name: 'Claim #2 Breece Hall' });
  expect(screen.getAllByRole('button', { name: /^Claim Other Guy$/ })).toHaveLength(1);
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
  // The pool region is display:none, not merely [hidden] (page CSS would beat the attribute).
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
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

test('a failed league read shows the error and never the empty-list copy', async () => {
  setup();
  const base = apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation((url, config) =>
    url.startsWith('/api/league/')
      ? Promise.reject({ response: { status: 500, data: { error: 'league down' } }, message: 'Request failed' })
      : base(url, config)
  );
  renderPage();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  screen.queryAllByText(/No players/).forEach((el) => expect(el).not.toBeVisible());
  expect(playerReads()).toHaveLength(0);
});

test('the empty-list copy waits for the first read to settle', async () => {
  setup();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/players') return new Promise(() => {});
    if (url.startsWith('/api/league/')) return Promise.resolve({ data: { league: FAAB_LEAGUE, teams: [] } });
    return Promise.resolve({ data: waiversBody() });
  });
  renderPage();
  await waitFor(() => expect(playerReads().length).toBeGreaterThan(0));
  screen.queryAllByText(/No players/).forEach((el) => expect(el).not.toBeVisible());
});

// #1614: the waiver-claims widget (Claim order and Results) in the side panel.
const orderedClaims = () => [
  pendingClaim({ id: 3, player_id: 13, player_name: 'Claim C', claim_order: 3, created_at: '2026-09-22T00:00:00Z' }),
  pendingClaim({ id: 2, player_id: 12, player_name: 'Claim A', claim_order: 2, created_at: '2026-09-21T00:00:00Z' }),
  pendingClaim({ id: 1, player_id: 11, player_name: 'Claim B', claim_order: 1, created_at: '2026-09-20T00:00:00Z' }),
];
const claimsCard = () => screen.findByTestId('waivers-claims-card');

const resolved = (over) => ({
  id: 50,
  player_id: 40,
  player_name: 'Done Guy',
  drop_player_id: null,
  drop_player_name: null,
  bid: 9,
  status: 'won',
  note: null,
  claim_order: null,
  created_at: '2026-09-10T00:00:00Z',
  processed_at: '2026-09-16T10:00:00Z',
  week: 2,
  ...over,
});

test('pending claims list in Claim order with a rank and the qualified ranking line', async () => {
  setup({ waivers: waiversBody({ myClaims: orderedClaims() }) });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  expect(within(card).getAllByText(/^Claim [ABC]$/).map((el) => el.textContent)).toEqual(['Claim B', 'Claim A', 'Claim C']);
  expect(within(card).getByText('#1')).toBeInTheDocument();
  expect(within(card).getByText(/ranks your own claims/i)).toHaveTextContent(/higher bid still processes first/i);
  expect(card.textContent).not.toMatch(/#1 (claim )?is tried first/i);
});

test('up is disabled on the first claim and down on the last', async () => {
  setup({ waivers: waiversBody({ myClaims: orderedClaims() }) });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  const ups = within(card).getAllByRole('button', { name: /^Move .* up$/ });
  const downs = within(card).getAllByRole('button', { name: /^Move .* down$/ });
  expect(ups[0]).toBeDisabled();
  expect(ups[1]).toBeEnabled();
  expect(downs[2]).toBeDisabled();
});

test('moving a claim up PUTs the full id list, reorders at once, announces and keeps focus', async () => {
  setup({ waivers: waiversBody({ myClaims: orderedClaims() }) });
  apiClient.put.mockResolvedValue({ data: {} });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  await userEvent.click(within(card).getAllByRole('button', { name: /^Move .* up$/ })[1]);
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/waivers/claims/order', { leagueId: 1, claimIds: [2, 1, 3] })
  );
  expect(within(card).getAllByText(/^Claim [ABC]$/).map((el) => el.textContent)).toEqual(['Claim A', 'Claim B', 'Claim C']);
  expect(await within(card).findByText('Claim A moved to Claim order #1')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Move Claim A down' })).toHaveFocus();
});

test('moving a claim down keeps focus on that claim\'s down button', async () => {
  setup({ waivers: waiversBody({ myClaims: orderedClaims() }) });
  apiClient.put.mockResolvedValue({ data: {} });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  await userEvent.click(within(card).getByRole('button', { name: 'Move Claim B down' }));
  await waitFor(() => expect(within(card).getByRole('button', { name: 'Move Claim B down' })).toHaveFocus());
});

test('a refused reorder reverts the list and shows the refusal', async () => {
  setup({ waivers: waiversBody({ myClaims: orderedClaims() }) });
  apiClient.put.mockRejectedValue({
    response: { status: 409, data: { code: 'CLAIM_ORDER_MISMATCH', message: 'Your pending claims changed; refresh and retry.' } },
  });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  await userEvent.click(within(card).getAllByRole('button', { name: /^Move .* down$/ })[0]);
  expect(await within(card).findByText('Your pending claims changed; refresh and retry.')).toBeInTheDocument();
  expect(within(card).getAllByText(/^Claim [ABC]$/).map((el) => el.textContent)).toEqual(['Claim B', 'Claim A', 'Claim C']);
});

test('the Claim button on a row follows a reorder', async () => {
  setup({
    players: [cardsPlayer({ id: 11, name: 'Claim B' })],
    waivers: waiversBody({ myClaims: orderedClaims() }),
  });
  apiClient.put.mockResolvedValue({ data: {} });
  renderPage();
  await screen.findByRole('button', { name: 'Claim #1 Claim B' });
  const card = await claimsCard();
  await userEvent.click(within(card).getByRole('button', { name: 'Move Claim B down' }));
  expect(await screen.findByRole('button', { name: 'Claim #2 Claim B' })).toBeInTheDocument();
});

test('Results group by week with Won, Lost and Didn\'t go through wording, never "invalid" or cancelled', async () => {
  setup({
    waivers: waiversBody({
      myClaims: [
        resolved({ id: 50, player_name: 'Won Guy', status: 'won', bid: 9, week: 2 }),
        resolved({ id: 51, player_name: 'Lost Guy', status: 'lost', bid: 5, week: 2, winning_team_name: 'Rival FC', winning_bid: 17 }),
        resolved({ id: 52, player_name: 'Old Loss', status: 'lost', bid: 3, week: 1 }),
        resolved({ id: 53, player_name: 'Dead Guy', status: 'invalid', bid: 4, week: 1, note: 'Roster was full' }),
        resolved({ id: 54, player_name: 'Gone Guy', status: 'cancelled', week: 1 }),
      ],
    }),
  });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Won Guy');
  expect(within(card).getByRole('heading', { name: 'Week 2' })).toBeInTheDocument();
  expect(within(card).getByRole('heading', { name: 'Week 1' })).toBeInTheDocument();
  expect(card.textContent).toMatch(/Won\s*·\s*\$9/);
  expect(card.textContent).toContain('Lost to Rival FC · won at $17');
  expect(card.textContent).toMatch(/Didn't go through/);
  expect(card.textContent).toContain('Roster was full');
  expect(card.textContent).not.toMatch(/invalid/i);
  expect(within(card).queryByText('Gone Guy')).not.toBeInTheDocument();
});

test('a lost claim with a null winner reads plain Lost with the bid, never blank or undefined', async () => {
  setup({
    waivers: waiversBody({
      myClaims: [resolved({ id: 52, player_name: 'Old Loss', status: 'lost', bid: 3, week: 1, winning_team_name: null, winning_bid: null })],
    }),
  });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Old Loss');
  const row = within(card).getAllByRole('listitem').find((li) => li.textContent.includes('Old Loss'));
  expect(row).toHaveTextContent(/Lost/);
  expect(row).toHaveTextContent('$3');
  expect(row.textContent).not.toMatch(/undefined|null|Lost to/);
});

test('no claims at all says "No claims yet"', async () => {
  setup();
  renderPage();
  const card = await claimsCard();
  expect(await within(card).findByText('No claims yet')).toBeInTheDocument();
});

test('a refused move up keeps focus on the moved claim\'s control after the revert', async () => {
  setup({ waivers: waiversBody({ myClaims: orderedClaims() }) });
  apiClient.put.mockRejectedValue({ response: { status: 409, data: { message: 'Your pending claims changed; refresh and retry.' } } });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  await userEvent.click(within(card).getByRole('button', { name: 'Move Claim A up' }));
  await within(card).findByText('Your pending claims changed; refresh and retry.');
  await waitFor(() => expect(within(card).getByRole('button', { name: 'Move Claim A up' })).toHaveFocus());
});
