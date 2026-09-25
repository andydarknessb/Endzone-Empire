import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../../components/Snackbar/SnackbarProvider';
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
  roster = [],
  cards = {},
} = {}) => {
  apiClient.get.mockImplementation((url) => {
    const cardMatch = /^\/api\/players\/(\d+)\/card/.exec(url);
    if (cardMatch) {
      const body = cards[cardMatch[1]];
      return body instanceof Error ? Promise.reject(body) : Promise.resolve({ data: body || { news: [] } });
    }
    if (url === '/api/players') {
      if (playersError) return Promise.reject(playersError);
      return Promise.resolve({ data: { players, totalPages: 1, total: total ?? players.length, context } });
    }
    if (url.startsWith('/api/waivers/claim-target')) return Promise.resolve({ data: { player: claimTarget } });
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waivers });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: roster });
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

test('a server-validated claim target from the Player Browser opens the claim sheet, no swap preview', async () => {
  setup({ claimTarget: { id: 8, name: 'Blanket Waiver Player', position: 'WR', nfl_team: 'DAL' } });
  renderPage('/league/1/waivers?playerId=8');
  const sheet = await screen.findByRole('dialog', { name: 'Claim Blanket Waiver Player' });
  expect(apiClient.get).toHaveBeenCalledWith('/api/waivers/claim-target?leagueId=1&playerId=8');
  expect(within(sheet).queryByTestId('claim-sheet-swap')).not.toBeInTheDocument();
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

test('two refused moves up in a row both keep focus on the moved claim\'s control', async () => {
  setup({ waivers: waiversBody({ myClaims: orderedClaims() }) });
  apiClient.put.mockRejectedValue({ response: { status: 409, data: { message: 'Your pending claims changed; refresh and retry.' } } });
  renderPage();
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await userEvent.click(within(card).getByRole('button', { name: 'Move Claim A up' }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(attempt));
    await within(card).findByText('Your pending claims changed; refresh and retry.');
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Move Claim A up' })).toHaveFocus());
  }
});

// #1615: the claim sheet.
const bench = (id, name, pts, position = 'RB') => ({ id, name, position, projected_weekly_points: pts });
const upgradeFor = (over = { id: 2, name: 'Starter Two' }, points = 3.5) => ({ points, overPlayer: over, slot: 'RB' });
const SHEET_ROSTER = [bench(3, 'Best Bench', 9.0), bench(2, 'Starter Two', 8.6), bench(1, 'Worst Guy', 2.0), bench(4, 'No Proj', null)];
const openSheet = async (name = 'Breece Hall') => {
  await userEvent.click(await screen.findByRole('button', { name: `Claim ${name}` }));
  return screen.findByRole('dialog', { name: `Claim ${name}` });
};
const submitBtn = (sheet) => within(sheet).getByRole('button', { name: 'Submit claim' });
const claimReads = () => apiClient.get.mock.calls.filter(([url]) => url.startsWith('/api/waivers') && !url.includes('claim-target')).length;

test('Claim on a row opens the sheet; submitting files the claim, closes it and refreshes claims', async () => {
  setup({ players: [cardsPlayer({ upgrade: upgradeFor() })], roster: SHEET_ROSTER });
  apiClient.post.mockResolvedValue({ data: {} });
  renderPage();
  const sheet = await openSheet();
  const before = claimReads();
  await userEvent.click(submitBtn(sheet));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', { leagueId: 1, playerId: 7, dropPlayerId: 2, bid: 0 })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(claimReads()).toBeGreaterThan(before));
});

test('the swap preview shows both projections and the gain', async () => {
  setup({ players: [cardsPlayer({ upgrade: upgradeFor() })], roster: SHEET_ROSTER });
  renderPage();
  const swap = within(await openSheet()).getByTestId('claim-sheet-swap');
  expect(swap).toHaveTextContent('Breece Hall');
  expect(swap).toHaveTextContent('12.1');
  expect(swap).toHaveTextContent('Starter Two');
  expect(swap).toHaveTextContent('8.6');
  expect(swap).toHaveTextContent('+3.5');
});

test('no Upgrade means no swap preview and no preselected drop', async () => {
  setup({ players: [cardsPlayer({ upgrade: null })], roster: SHEET_ROSTER });
  renderPage();
  const sheet = await openSheet();
  expect(within(sheet).queryByTestId('claim-sheet-swap')).not.toBeInTheDocument();
  expect(within(sheet).getByRole('radio', { name: /No drop/ })).toBeChecked();
});

test('drops sort weakest first with projections and the replaced starter is preselected', async () => {
  setup({ players: [cardsPlayer({ upgrade: upgradeFor() })], roster: SHEET_ROSTER });
  renderPage();
  const sheet = await openSheet();
  const radios = within(sheet).getAllByRole('radio');
  expect(radios).toHaveLength(5);
  ['No drop', 'Worst Guy (RB) · 2.0 proj', 'Starter Two', 'Best Bench', 'No Proj'].forEach((name, i) =>
    expect(radios[i]).toHaveAccessibleName(expect.stringContaining(name))
  );
  expect(within(sheet).getByRole('radio', { name: /Starter Two/ })).toBeChecked();
});

test('a replaced starter who is not on the roster is not preselected', async () => {
  setup({ players: [cardsPlayer({ upgrade: upgradeFor({ id: 99, name: 'Ghost' }) })], roster: SHEET_ROSTER });
  renderPage();
  const sheet = await openSheet();
  expect(within(sheet).getByRole('radio', { name: /No drop/ })).toBeChecked();
});

test('at Roster capacity Submit is disabled until a drop is chosen', async () => {
  setup({ players: [cardsPlayer()], roster: SHEET_ROSTER, context: { rosterCount: 20, rosterCapacity: 20 } });
  renderPage();
  const sheet = await openSheet();
  expect(within(sheet).queryByRole('radio', { name: /No drop/ })).not.toBeInTheDocument();
  expect(submitBtn(sheet)).toBeDisabled();
  await userEvent.click(within(sheet).getByRole('radio', { name: /Worst Guy/ }));
  expect(submitBtn(sheet)).toBeEnabled();
});

test('the bid is refused outside $0 to FAAB remaining; $1 and Max set it', async () => {
  setup({ players: [cardsPlayer()], roster: SHEET_ROSTER });
  renderPage();
  const sheet = await openSheet();
  const bid = within(sheet).getByRole('spinbutton', { name: 'Bid' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Bid $1' }));
  expect(bid).toHaveValue(1);
  await userEvent.click(within(sheet).getByRole('button', { name: 'Bid max' }));
  expect(bid).toHaveValue(62);
  await userEvent.click(within(sheet).getByRole('button', { name: 'Raise bid' }));
  expect(bid).toHaveValue(62);
  await userEvent.clear(bid);
  await userEvent.type(bid, '63');
  expect(submitBtn(sheet)).toBeDisabled();
  expect(within(sheet).getByText('Enter a bid between $0 and $62')).toBeInTheDocument();
  await userEvent.clear(bid);
  await userEvent.type(bid, '5');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Raise bid' }));
  expect(bid).toHaveValue(6);
  await userEvent.click(within(sheet).getByRole('button', { name: 'Lower bid' }));
  expect(bid).toHaveValue(5);
  expect(submitBtn(sheet)).toBeEnabled();
});

test('a non-FAAB league shows Waiver priority and no bid', async () => {
  setup({
    league: { id: 1, best_ball: false, waiver_type: 'priority' },
    waivers: waiversBody({ league: { waiver_type: 'priority', waivers_clear_at: null } }),
    players: [cardsPlayer()],
    roster: SHEET_ROSTER,
  });
  apiClient.post.mockResolvedValue({ data: {} });
  renderPage();
  const sheet = await openSheet();
  expect(within(sheet).getByText(/Waiver priority #7/)).toBeInTheDocument();
  expect(within(sheet).queryByRole('spinbutton', { name: 'Bid' })).not.toBeInTheDocument();
  await userEvent.click(submitBtn(sheet));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', expect.objectContaining({ bid: 0 })));
});

test('every sheet control is at least 44px tall', async () => {
  setup({ players: [cardsPlayer({ upgrade: upgradeFor() })], roster: SHEET_ROSTER });
  renderPage();
  const sheet = await openSheet();
  const controls = within(sheet).getAllByRole('button');
  expect(controls.length).toBeGreaterThan(5);
  controls.forEach((el) => expect(parseInt(getComputedStyle(el).minHeight, 10) || 0).toBeGreaterThanOrEqual(44));
});

// #1616: manage-claim (Edit, Cancel with Undo, the shared-drop warning).
const renderWithToast = () =>
  renderWithProviders(
    <SnackbarProvider>
      <WaiversPage />
    </SnackbarProvider>,
    { path: '/league/:leagueId/waivers', route: '/league/1/waivers?tab=claims' }
  );
const manageClaims = () => [
  pendingClaim({ id: 1, player_id: 11, player_name: 'Claim B', claim_order: 1, drop_player_id: 3, drop_player_name: 'Best Bench', bid: 4 }),
  pendingClaim({ id: 2, player_id: 12, player_name: 'Claim A', claim_order: 2, drop_player_id: 2, drop_player_name: 'Starter Two', bid: 10 }),
  pendingClaim({ id: 3, player_id: 13, player_name: 'Claim C', claim_order: 3, drop_player_id: 1, drop_player_name: 'Worst Guy', bid: 1 }),
];

test('every pending-claim control (Move, Edit, Cancel) is at least 44px in both directions', async () => {
  setup({ waivers: waiversBody({ myClaims: manageClaims() }), roster: SHEET_ROSTER });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  const controls = within(card).getAllByRole('button');
  expect(within(card).getAllByRole('button', { name: /^Edit claim on / })).toHaveLength(3);
  expect(within(card).getAllByRole('button', { name: /^Cancel claim on / })).toHaveLength(3);
  expect(controls).toHaveLength(12);
  controls.forEach((el) => {
    expect(parseInt(getComputedStyle(el).minHeight, 10) || 0).toBeGreaterThanOrEqual(44);
    expect(parseInt(getComputedStyle(el).minWidth, 10) || 0).toBeGreaterThanOrEqual(44);
  });
});

test('Edit opens the sheet prefilled; saving PATCHes the bid and drop and never touches the order', async () => {
  const waivers = waiversBody({ myClaims: manageClaims() });
  setup({ waivers, roster: SHEET_ROSTER });
  apiClient.patch.mockResolvedValue({ data: {} });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  await userEvent.click(await within(card).findByRole('button', { name: 'Edit claim on Claim A' }));
  const sheet = await screen.findByRole('dialog', { name: /Claim A/ });
  expect(within(sheet).getByRole('radio', { name: /Starter Two/ })).toBeChecked();
  expect(within(sheet).getByRole('spinbutton', { name: 'Bid' })).toHaveValue(10);
  await userEvent.click(within(sheet).getByRole('radio', { name: /Worst Guy/ }));
  const bid = within(sheet).getByRole('spinbutton', { name: 'Bid' });
  await userEvent.clear(bid);
  await userEvent.type(bid, '15');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save claim' }));
  await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/api/waivers/claim/2', { bid: 15, dropPlayerId: 1 }));
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.put).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

// Each claims read returns a fresh body, as the server does (a mutated shared object would not re-render).
const freshClaimReads = (waivers) => {
  const base = apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation((url) =>
    url.startsWith('/api/waivers') && !url.includes('claim-target')
      ? Promise.resolve({ data: { ...waivers, myClaims: [...waivers.myClaims] } })
      : base(url)
  );
};
const cancelWith = (waivers) => {
  freshClaimReads(waivers);
  apiClient.delete.mockImplementation(async () => {
    waivers.myClaims = waivers.myClaims.filter((c) => c.id !== 2);
    return { data: {} };
  });
};

test('Cancel removes the claim and Undo re-files it, then restores its Claim order position', async () => {
  const waivers = waiversBody({ myClaims: manageClaims() });
  setup({ waivers, roster: SHEET_ROSTER });
  cancelWith(waivers);
  apiClient.post.mockResolvedValue({ data: { id: 9 } });
  apiClient.put.mockResolvedValue({ data: {} });
  renderWithToast();
  const card = await claimsCard();
  await userEvent.click(await within(card).findByRole('button', { name: 'Cancel claim on Claim A' }));
  await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/waivers/claim/2?leagueId=1'));
  await waitFor(() => expect(within(card).queryByText('Claim A')).not.toBeInTheDocument());
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', { leagueId: 1, playerId: 12, dropPlayerId: 2, bid: 10 })
  );
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/waivers/claims/order', { leagueId: 1, claimIds: [1, 9, 3] })
  );
});

test('after Cancel, focus lands on the next claim\'s Cancel control and the list never flashes empty', async () => {
  const waivers = waiversBody({ myClaims: manageClaims() });
  setup({ waivers, roster: SHEET_ROSTER });
  cancelWith(waivers);
  renderWithToast();
  const card = await claimsCard();
  const cancel = await within(card).findByRole('button', { name: 'Cancel claim on Claim A' });
  cancel.focus();
  await userEvent.click(cancel);
  await waitFor(() => expect(within(card).queryByText('Claim A')).not.toBeInTheDocument());
  expect(within(card).queryByText('No claims yet')).not.toBeInTheDocument();
  await waitFor(() => expect(within(card).getByRole('button', { name: 'Cancel claim on Claim C' })).toHaveFocus());
});

test('after saving an edit, focus returns to that claim\'s Edit control', async () => {
  const waivers = waiversBody({ myClaims: manageClaims() });
  setup({ waivers, roster: SHEET_ROSTER });
  freshClaimReads(waivers);
  apiClient.patch.mockResolvedValue({ data: {} });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  await userEvent.click(await within(card).findByRole('button', { name: 'Edit claim on Claim A' }));
  const sheet = await screen.findByRole('dialog', { name: /Claim A/ });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save claim' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(within(card).getByRole('button', { name: 'Edit claim on Claim A' })).toHaveFocus());
});

test('the edit sheet offers the FAAB left net of the OTHER pending claims (left plus this claim\'s own bid)', async () => {
  // faab_remaining 62, pending bids 4 + 10 + 1: left is 47, and editing the $10 claim offers 47 + 10.
  setup({ waivers: waiversBody({ myClaims: manageClaims() }), roster: SHEET_ROSTER });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  await userEvent.click(await within(card).findByRole('button', { name: 'Edit claim on Claim A' }));
  const sheet = await screen.findByRole('dialog', { name: /Claim A/ });
  expect(within(sheet).getByText('$57 remaining')).toBeInTheDocument();
  await userEvent.click(within(sheet).getByRole('button', { name: 'Bid max' }));
  expect(within(sheet).getByRole('spinbutton', { name: 'Bid' })).toHaveValue(57);
});

test('three claims naming the same drop read "all drop", two read "both drop"', async () => {
  const claims = manageClaims().map((c) => ({ ...c, drop_player_id: 3, drop_player_name: 'Best Bench' }));
  setup({ waivers: waiversBody({ myClaims: claims }), roster: SHEET_ROSTER });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  expect(await within(card).findAllByText('Only one of these can go through: #1, #2 and #3 all drop Best Bench')).toHaveLength(3);
  expect(within(card).queryByText(/both drop/)).not.toBeInTheDocument();
});

test('cancelling the last claim with no results leaves focus on the empty state, not body', async () => {
  const waivers = waiversBody({ myClaims: [manageClaims()[1]] });
  setup({ waivers, roster: SHEET_ROSTER });
  freshClaimReads(waivers);
  apiClient.delete.mockImplementation(async () => {
    waivers.myClaims = [];
    return { data: {} };
  });
  renderWithToast();
  const card = await claimsCard();
  const cancel = await within(card).findByRole('button', { name: 'Cancel claim on Claim A' });
  cancel.focus();
  await userEvent.click(cancel);
  await within(card).findByText('No claims yet');
  await waitFor(() => expect(within(card).getByText('No claims yet')).toHaveFocus());
});

test('a failed Undo says so in the toast', async () => {
  const waivers = waiversBody({ myClaims: manageClaims() });
  setup({ waivers, roster: SHEET_ROSTER });
  cancelWith(waivers);
  apiClient.post.mockRejectedValue({ response: { status: 409, data: { message: 'Roster is full' } } });
  renderWithToast();
  const card = await claimsCard();
  await userEvent.click(await within(card).findByRole('button', { name: 'Cancel claim on Claim A' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  expect(await screen.findByText(/Could not undo/i)).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('claims that name the same drop each carry the neutral warning and the resolution line, with no prediction', async () => {
  const claims = manageClaims();
  claims[2] = { ...claims[2], drop_player_id: 3, drop_player_name: 'Best Bench' };
  setup({ waivers: waiversBody({ myClaims: claims }), roster: SHEET_ROSTER });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  const warnings = within(card).getAllByText('Only one of these can go through: #1 and #3 both drop Best Bench');
  expect(warnings).toHaveLength(2);
  expect(within(card).getAllByText(/higher bid first, then Waiver priority, then your Claim order, each at its player's Clear time/i)).toHaveLength(2);
  expect(card.textContent).not.toMatch(/will (win|go through)|likely/i);
});

test('claims with different drops carry no shared-drop warning', async () => {
  setup({ waivers: waiversBody({ myClaims: manageClaims() }), roster: SHEET_ROSTER });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  await within(card).findByText('Claim A');
  expect(within(card).queryByText(/Only one of these can go through/)).not.toBeInTheDocument();
});

test('the warning disappears once an edit changes the drop', async () => {
  const claims = manageClaims();
  claims[2] = { ...claims[2], drop_player_id: 3, drop_player_name: 'Best Bench' };
  const waivers = waiversBody({ myClaims: claims });
  setup({ waivers, roster: SHEET_ROSTER });
  freshClaimReads(waivers);
  apiClient.patch.mockImplementation(async () => {
    waivers.myClaims = waivers.myClaims.map((c) => (c.id === 3 ? { ...c, drop_player_id: 1, drop_player_name: 'Worst Guy' } : c));
    return { data: {} };
  });
  renderPage('/league/1/waivers?tab=claims');
  const card = await claimsCard();
  await within(card).findAllByText(/Only one of these can go through/);
  await userEvent.click(within(card).getByRole('button', { name: 'Edit claim on Claim C' }));
  const sheet = await screen.findByRole('dialog', { name: /Claim C/ });
  await userEvent.click(within(sheet).getByRole('radio', { name: /Worst Guy/ }));
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save claim' }));
  await waitFor(() => expect(within(card).queryByText(/Only one of these can go through/)).not.toBeInTheDocument());
});

// #1617: the expandable row.
const cardReads = () => apiClient.get.mock.calls.filter(([url]) => /^\/api\/players\/\d+\/card/.test(url));
const expandButton = (name) => screen.findByRole('button', { name: `Show details for ${name}` });
const SWAPPER = {
  upgrade: { points: 3.2, overPlayer: { id: 3, name: 'Best Bench' }, slot: 'RB' },
  ros: { points: 150, perGame: 11.5 },
};

test('the expand control is a real 44px button that toggles aria-expanded and shows the panel', async () => {
  setup({ players: [cardsPlayer(SWAPPER)] });
  renderPage();
  const button = await expandButton('Breece Hall');
  expect(button.tagName).toBe('BUTTON');
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('waiver-row-detail')).not.toBeInTheDocument();
  await userEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByTestId('waiver-row-detail')).toBeInTheDocument();
  await userEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('waiver-row-detail')).not.toBeInTheDocument();
});

test('the panel shows the swap, Rest of season with per game, the Clear time and News, and a Decision card link', async () => {
  setup({
    players: [cardsPlayer(SWAPPER)],
    cards: { 7: { news: [{ headline: 'Hall cleared to practice', url: null, blurb: null, publishedAt: null }] } },
  });
  renderPage();
  await userEvent.click(await expandButton('Breece Hall'));
  const panel = await screen.findByTestId('waiver-row-detail');
  expect(within(panel).getByTestId('claim-sheet-swap')).toHaveTextContent('Best Bench');
  expect(within(panel).getByTestId('claim-sheet-swap')).toHaveTextContent('+3.2 this week');
  expect(within(panel).getByText('Rest of season')).toBeInTheDocument();
  expect(panel).toHaveTextContent('150.0');
  expect(panel).toHaveTextContent('11.5 per game');
  expect(within(panel).getByTestId('waiver-row-detail-clear')).toHaveTextContent(/resolve at/i);
  expect(within(panel).getByTestId('waiver-row-detail-clear').textContent).not.toMatch(/claims process at/i);
  expect(await within(panel).findByText('Hall cleared to practice')).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Open Breece Hall Decision card' })).toBeInTheDocument();
  expect(panel.textContent).not.toMatch(/usage/i);
});

test('the swap is hidden without an Upgrade', async () => {
  setup({ players: [cardsPlayer({ upgrade: null })] });
  renderPage();
  await userEvent.click(await expandButton('Breece Hall'));
  const panel = await screen.findByTestId('waiver-row-detail');
  expect(within(panel).queryByTestId('claim-sheet-swap')).not.toBeInTheDocument();
  expect(within(panel).getByText('Rest of season')).toBeInTheDocument();
});

test('the panel link opens the Decision card', async () => {
  setup({ players: [cardsPlayer()] });
  renderPage();
  await userEvent.click(await expandButton('Breece Hall'));
  await userEvent.click(await screen.findByRole('button', { name: 'Open Breece Hall Decision card' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('no News request until a row expands, and one per player however often it re-expands', async () => {
  setup({ players: [cardsPlayer(), cardsPlayer({ id: 8, name: 'Other Guy' })] });
  renderPage();
  const first = await expandButton('Breece Hall');
  await screen.findByText('Other Guy');
  expect(cardReads()).toHaveLength(0);
  await userEvent.click(first);
  await screen.findByTestId('waiver-row-detail');
  await waitFor(() => expect(cardReads()).toHaveLength(1));
  await userEvent.click(first);
  await userEvent.click(first);
  await screen.findByTestId('waiver-row-detail');
  expect(cardReads()).toHaveLength(1);
  await userEvent.click(await expandButton('Other Guy'));
  await waitFor(() => expect(cardReads()).toHaveLength(2));
});

test('only one row is expanded at a time', async () => {
  setup({ players: [cardsPlayer(), cardsPlayer({ id: 8, name: 'Other Guy' })] });
  renderPage();
  const first = await expandButton('Breece Hall');
  const second = await expandButton('Other Guy');
  await userEvent.click(first);
  await userEvent.click(second);
  expect(first).toHaveAttribute('aria-expanded', 'false');
  expect(second).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByTestId('waiver-row-detail')).toHaveLength(1);
});

test('paging collapses the expanded row', async () => {
  setup();
  apiClient.get.mockImplementation((url) => {
    if (/^\/api\/players\/\d+\/card/.test(url)) return Promise.resolve({ data: { news: [] } });
    if (url === '/api/players') {
      return Promise.resolve({
        data: { players: [cardsPlayer()], totalPages: 3, total: 60, context: { rosterCount: 1, rosterCapacity: 20 } },
      });
    }
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waiversBody() });
    if (url.startsWith('/api/league/')) return Promise.resolve({ data: { league: FAAB_LEAGUE, teams: [] } });
    if (url.startsWith('/api/team/')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  renderPage();
  await userEvent.click(await expandButton('Breece Hall'));
  await screen.findByTestId('waiver-row-detail');
  await userEvent.click(screen.getByRole('button', { name: /page 2/i }));
  await waitFor(() => expect(screen.queryByTestId('waiver-row-detail')).not.toBeInTheDocument());
  expect(await expandButton('Breece Hall')).toHaveAttribute('aria-expanded', 'false');
});

test('a failed News read falls back to the Decision card link', async () => {
  setup({ players: [cardsPlayer()], cards: { 7: new Error('boom') } });
  renderPage();
  await userEvent.click(await expandButton('Breece Hall'));
  const panel = await screen.findByTestId('waiver-row-detail');
  expect(await within(panel).findByText(/News is on the Decision card/i)).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Open Breece Hall Decision card' })).toBeInTheDocument();
});

test('the phone card expands the same way', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query),
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  try {
    setup({ players: [cardsPlayer(SWAPPER)] });
    renderPage();
    const button = await expandButton('Breece Hall');
    expect(screen.getByTestId('player-row-card')).toBeInTheDocument();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('waiver-row-detail')).toHaveTextContent('Rest of season');
  } finally {
    window.matchMedia = original;
  }
});
