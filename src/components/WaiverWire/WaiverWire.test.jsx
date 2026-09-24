import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { formatRelative } from '../../utils/formatRelative';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import WaiverWire from './WaiverWire';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), put: jest.fn() },
}));

const renderScreen = (leagueId = 1, route = `/league/${leagueId}/waivers`) =>
  renderWithProviders(<WaiverWire />, {
    path: '/league/:leagueId/waivers',
    route,
  });

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderScreenWithToasts = (leagueId = 1) =>
  renderWithProviders(
    <SnackbarProvider>
      <WaiverWire />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId/waivers',
      route: `/league/${leagueId}/waivers`,
    }
  );

// PlayerRow's Status column renders "Clears in 3 days" as one text node
// (StatusDetail), so an exact getByText on the bare relative time no longer
// matches - this content matcher checks an element's full text instead, the
// same pattern TradeCenter.test.jsx's own `byText` helper uses for a
// PlayerNameLink's nested <button>.
const byText = (text) => (_, element) => element?.textContent === text;

const waiversResponse = (overrides = {}) => ({
  league: {
    waiver_type: 'priority',
    waiver_period_hours: 24,
    faab_budget: 100,
    waivers_clear_at: null,
  },
  myTeam: { id: 10, waiver_priority: 3, faab_remaining: 85 },
  myClaims: [],
  ...overrides,
});

const rosterResponse = () => [
  { id: 20, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills' },
  { id: 21, name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins' },
];

const rosterWithProjectionsResponse = () => [
  { id: 20, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills', projected_weekly_points: 22.4 },
  { id: 21, name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins', projected_weekly_points: 15.1 },
  { id: 22, name: 'Bench Warmer', position: 'WR', nfl_team: 'Free Agent', projected_weekly_points: 3.2 },
];

// #1310 formal review f2: the On waivers table's own rows now come from
// GET /api/players?view=cards&availability=waivers (the same shape
// PlayerManagement's Players list renders), not /api/waivers's own raw
// `onWaivers` rows.
const cardsPlayer = (overrides = {}) => ({
  id: 7,
  name: 'Breece Hall',
  position: 'RB',
  nfl_team: 'New York Jets',
  photo_url: null,
  injury_status: null,
  bye_week: null,
  availability: { state: 'waivers', teamId: null, teamName: null, availableAt: '2026-07-12T15:00:00.000Z' },
  projWeek: null,
  ros: { points: null },
  weeks: [],
  ownership: null,
  upgrade: null,
  ...overrides,
});

const setupGet = ({ waivers, roster, cardsPlayers = [cardsPlayer()], cardsPages, suggestions, claimTarget }) => {
  apiClient.get.mockImplementation((url, config) => {
    if (url.startsWith('/api/waivers/suggestions')) {
      // #1310 formal review f2: the on-waivers table no longer reads this
      // endpoint at all (constraint 1: left in place server-side, just
      // unused from here) - a test that still sets this up is asserting on
      // dead code, not real behavior.
      if (suggestions !== undefined) return Promise.resolve({ data: suggestions });
      throw new Error('/api/waivers/suggestions should not be called by WaiverWire anymore (#1310 formal review f2)');
    }
    if (url.startsWith('/api/waivers/claim-target')) return Promise.resolve({ data: { player: claimTarget } });
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waivers });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: roster });
    if (url === '/api/players') {
      if (cardsPages) {
        const page = config?.params?.page || 1;
        return Promise.resolve({ data: cardsPages[page - 1] });
      }
      return Promise.resolve({ data: { players: cardsPlayers, totalPages: 1, total: cardsPlayers.length } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
};

test('opens a server-validated blanket-waiver target from the Player Browser', async () => {
  const blanketWaiverPlayer = {
    id: 8,
    name: 'Blanket Waiver Player',
    position: 'WR',
    nfl_team: 'DAL',
  };
  setupGet({
    waivers: waiversResponse({ myClaims: [] }),
    roster: rosterResponse(),
    cardsPlayers: [],
    claimTarget: blanketWaiverPlayer,
  });
  apiClient.post.mockResolvedValue({});

  renderScreen(1, '/league/1/waivers?playerId=8');

  expect(await screen.findByRole('dialog', { name: /claim blanket waiver player/i })).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/waivers/claim-target?leagueId=1&playerId=8');

  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 8,
      dropPlayerId: null,
      bid: 0,
    })
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

// #1307, ADR 0040: WaiverWire opens the Decision card (context="waivers")
// instead of PlayerQuickView. #1513: the context is now built through
// waivers({ availability, roster }), the same values passed loose below.
test('clicking a player name opens the Decision card in the waivers context, not PlayerQuickView', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await userEvent.click(await screen.findByText('Breece Hall'));

  const card = await screen.findByTestId('decision-card');
  expect(within(card).getByRole('heading', { name: 'Breece Hall' })).toBeInTheDocument();
  expect(within(card).getByTestId('claim-player-action')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Claim' })).toBeInTheDocument();
  expect(screen.queryByTestId('quickview-content')).not.toBeInTheDocument();
});

test('renders the on-waivers table and the priority chip', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('RB')).toBeInTheDocument();
  expect(screen.getByText('New York Jets')).toBeInTheDocument();
  expect(screen.getByText('Waiver priority: #3')).toBeInTheDocument();
  expect(screen.getByText(byText(`Clears ${formatRelative('2026-07-12T15:00:00.000Z')}`))).toBeInTheDocument();
});

test('the Clears cell shows the absolute time in a tooltip', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  const relativeText = screen.getByText(byText(`Clears ${formatRelative('2026-07-12T15:00:00.000Z')}`));
  await userEvent.hover(relativeText);

  expect(
    await screen.findByText(new Date('2026-07-12T15:00:00.000Z').toLocaleString())
  ).toBeInTheDocument();
});

test('a FAAB league shows the FAAB chip and a bid field in the claim dialog', async () => {
  setupGet({
    waivers: waiversResponse({
      league: {
        waiver_type: 'faab',
        waiver_period_hours: 24,
        faab_budget: 100,
        waivers_clear_at: null,
      },
    }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('FAAB remaining: $85')).toBeInTheDocument();
  expect(screen.queryByLabelText('Bid')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  expect(screen.getByLabelText('Bid')).toBeInTheDocument();
});

const faabLeagueOverride = {
  waiver_type: 'faab',
  waiver_period_hours: 24,
  faab_budget: 100,
  waivers_clear_at: null,
};

test('an empty or negative FAAB bid disables Submit and shows an error state', async () => {
  setupGet({
    waivers: waiversResponse({ league: faabLeagueOverride }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  const submitButton = screen.getByRole('button', { name: 'Submit Claim' });
  const bidInput = screen.getByLabelText('Bid');

  // Empty bid: disabled and already in an error state (nothing valid to submit).
  expect(submitButton).toBeDisabled();
  expect(screen.getByText('Enter a bid between $0 and $85')).toBeInTheDocument();

  // Negative bid: error state + still disabled.
  await userEvent.type(bidInput, '-5');
  expect(submitButton).toBeDisabled();
  expect(screen.getByText('Enter a bid between $0 and $85')).toBeInTheDocument();
});

test('a FAAB bid over budget shows an error state and disables Submit', async () => {
  setupGet({
    waivers: waiversResponse({ league: faabLeagueOverride }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  const bidInput = screen.getByLabelText('Bid');
  await userEvent.type(bidInput, '90');

  expect(screen.getByRole('button', { name: 'Submit Claim' })).toBeDisabled();
  expect(screen.getByText('Enter a bid between $0 and $85')).toBeInTheDocument();
});

test('a valid FAAB bid within budget enables Submit and posts the bid amount', async () => {
  setupGet({
    waivers: waiversResponse({ league: faabLeagueOverride }),
    roster: rosterResponse(),
  });
  apiClient.post.mockResolvedValue({});
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  const bidInput = screen.getByLabelText('Bid');
  await userEvent.type(bidInput, '40');

  const submitButton = screen.getByRole('button', { name: 'Submit Claim' });
  expect(submitButton).not.toBeDisabled();
  expect(screen.getByText('$85 remaining')).toBeInTheDocument();
  await userEvent.click(submitButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 7,
      dropPlayerId: null,
      bid: 40,
    })
  );
});

test('submitting a claim with no drop player posts the correct body and refetches', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockResolvedValue({});
  renderScreenWithToasts();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 7,
      dropPlayerId: null,
      bid: 0,
    })
  );
  expect(await screen.findByText('Waiver claim submitted')).toBeInTheDocument();
  // Waiver list refetches after the claim (suggestions calls don't count):
  // one on mount, one after.
  await waitFor(() => {
    const waiverGets = apiClient.get.mock.calls.filter(([url]) =>
      url.startsWith('/api/waivers?')
    );
    expect(waiverGets).toHaveLength(2);
  });
});

test('selecting a drop player includes its id in the claim request', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockResolvedValue({});
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  await userEvent.click(screen.getByLabelText('Drop a player (optional)'));
  await userEvent.click(await screen.findByRole('option', { name: 'Josh Allen (QB)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 7,
      dropPlayerId: 20,
      bid: 0,
    })
  );
});

test('drop-select options are sorted worst-weekly-projection-first with a weekly proj caption', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterWithProjectionsResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  await userEvent.click(screen.getByLabelText('Drop a player (optional)'));

  const options = await screen.findAllByRole('option');
  // "No drop" first, then worst projected_weekly_points -> best.
  expect(within(options[1]).getByText(/Bench Warmer \(WR\)/)).toBeInTheDocument();
  expect(within(options[1]).getByText('weekly proj 3.2')).toBeInTheDocument();
  expect(within(options[2]).getByText(/Tyreek Hill \(WR\)/)).toBeInTheDocument();
  expect(within(options[3]).getByText(/Josh Allen \(QB\)/)).toBeInTheDocument();
});

// #1310 formal review f2 constraint 2: the suggested drop pick used to come
// from a separate /api/waivers/suggestions read (`dropPlayerId`); the
// view=cards payload's own per-row `upgrade.overPlayer` carries the same
// fact now (the starter this player would replace).
test("preselects the roster player the row's own Upgrade pairs with the claimed pickup", async () => {
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    cardsPlayers: [
      cardsPlayer({ upgrade: { points: 5.3, overPlayer: { id: 21, name: 'Tyreek Hill' }, slot: 'WR' } }),
    ],
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  expect(await screen.findByText('Tyreek Hill (WR)')).toBeInTheDocument();
});

test("does not preselect a drop when the row's Upgrade pairs with a player not on this roster", async () => {
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    cardsPlayers: [
      cardsPlayer({ upgrade: { points: 5.3, overPlayer: { id: 999, name: 'Not On Roster' }, slot: 'WR' } }),
    ],
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  // MUI renders an empty-string Select value as blank rather than the "No
  // drop" label itself, so assert the absence of either roster option instead.
  expect(screen.queryByText('Josh Allen (QB)')).not.toBeInTheDocument();
  expect(screen.queryByText('Tyreek Hill (WR)')).not.toBeInTheDocument();
});

test('shows a Cancel button only for pending claims and cancels correctly', async () => {
  setupGet({
    waivers: waiversResponse({
      myClaims: [
        {
          id: 1,
          player_id: 8,
          player_name: 'Jaylen Warren',
          player_position: 'RB',
          drop_player_name: null,
          bid: 0,
          status: 'pending',
          note: null,
          created_at: '2026-07-10T12:00:00.000Z',
        },
        {
          id: 2,
          player_id: 9,
          player_name: 'Isiah Pacheco',
          player_position: 'RB',
          drop_player_name: null,
          bid: 0,
          status: 'won',
          note: 'Won weekly waiver run',
          created_at: '2026-07-09T12:00:00.000Z',
        },
      ],
    }),
    roster: rosterResponse(),
  });
  apiClient.delete.mockResolvedValue({});
  renderScreenWithToasts();

  await screen.findByText('Jaylen Warren');
  expect(screen.getByText('Isiah Pacheco')).toBeInTheDocument();
  expect(screen.getByText('Won weekly waiver run')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/waivers/claim/1?leagueId=1')
  );
  expect(await screen.findByText('Waiver claim cancelled')).toBeInTheDocument();
});

// #1579: Claim order. Pending claims list in claim_order (not created_at),
// each leading with its rank and carrying up/down buttons.
const pendingClaim = (id, name, claimOrder, createdAt) => ({
  id,
  player_id: 100 + id,
  player_name: name,
  player_position: 'RB',
  drop_player_name: null,
  bid: 0,
  status: 'pending',
  note: null,
  claim_order: claimOrder,
  created_at: createdAt,
});

// created_at DESC (as the server returns), but claim_order says B, A, C.
const orderedClaimsResponse = () =>
  waiversResponse({
    myClaims: [
      pendingClaim(3, 'Claim C', 3, '2026-07-12T12:00:00.000Z'),
      pendingClaim(2, 'Claim A', 2, '2026-07-11T12:00:00.000Z'),
      pendingClaim(1, 'Claim B', 1, '2026-07-10T12:00:00.000Z'),
    ],
  });

const claimNames = () => screen.getAllByText(/^Claim [ABC]$/).map((el) => el.textContent);

test('lists pending claims in claim_order with a rank and helper copy', async () => {
  setupGet({ waivers: orderedClaimsResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Claim A');
  expect(claimNames()).toEqual(['Claim B', 'Claim A', 'Claim C']);
  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getByText('#3')).toBeInTheDocument();
  expect(screen.getByText('Your #1 claim is tried first when claims process.')).toBeInTheDocument();
});

test('disables up on the first claim and down on the last', async () => {
  setupGet({ waivers: orderedClaimsResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Claim A');
  const ups = screen.getAllByRole('button', { name: /^Move .* up$/ });
  const downs = screen.getAllByRole('button', { name: /^Move .* down$/ });
  expect(ups).toHaveLength(3);
  expect(ups[0]).toBeDisabled();
  expect(ups[1]).toBeEnabled();
  expect(downs[2]).toBeDisabled();
  expect(downs[0]).toBeEnabled();
});

test('moving #2 up sends the full new id list and reorders optimistically', async () => {
  setupGet({ waivers: orderedClaimsResponse(), roster: rosterResponse() });
  apiClient.put.mockResolvedValue({ data: {} });
  renderScreen();

  await screen.findByText('Claim A');
  await userEvent.click(screen.getAllByRole('button', { name: /^Move .* up$/ })[1]);

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/waivers/claims/order', {
      leagueId: 1,
      claimIds: [2, 1, 3],
    })
  );
  expect(claimNames()).toEqual(['Claim A', 'Claim B', 'Claim C']);
  expect(await screen.findByText('Claim A moved to Claim order #1')).toBeInTheDocument();
  // #1 now, so its up button is disabled: focus lands on its down button.
  expect(screen.getByRole('button', { name: 'Move Claim A down' })).toHaveFocus();
});

test('moving a claim down keeps focus on that claim\'s down button', async () => {
  setupGet({ waivers: orderedClaimsResponse(), roster: rosterResponse() });
  apiClient.put.mockResolvedValue({ data: {} });
  renderScreen();

  await screen.findByText('Claim A');
  await userEvent.click(screen.getByRole('button', { name: 'Move Claim B down' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Move Claim B down' })).toHaveFocus());
});

test('a refused reorder reverts the list and shows the refusal message', async () => {
  setupGet({ waivers: orderedClaimsResponse(), roster: rosterResponse() });
  apiClient.put.mockRejectedValue({
    response: {
      status: 409,
      data: { code: 'CLAIM_ORDER_MISMATCH', message: 'Your pending claims changed; refresh and retry.' },
    },
  });
  renderScreen();

  await screen.findByText('Claim A');
  await userEvent.click(screen.getAllByRole('button', { name: /^Move .* down$/ })[0]);

  expect(await screen.findByText('Your pending claims changed; refresh and retry.')).toBeInTheDocument();
  expect(claimNames()).toEqual(['Claim B', 'Claim A', 'Claim C']);
});

test('a server error when submitting a claim is surfaced', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockRejectedValue({
    response: { data: { error: 'You have reached the claim limit' } },
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

  expect(await screen.findByText('You have reached the claim limit')).toBeInTheDocument();
});

test('shows empty states when there are no waiver players or claims', async () => {
  setupGet({
    waivers: waiversResponse({ myClaims: [] }),
    roster: rosterResponse(),
    cardsPlayers: [],
  });
  renderScreen();

  expect(await screen.findByText('No players on waivers')).toBeInTheDocument();
  expect(screen.getByText('No claims yet')).toBeInTheDocument();
});

test('empty waivers Browse Players opens the player pool filtered to available players', async () => {
  setupGet({
    waivers: waiversResponse({ myClaims: [] }),
    roster: rosterResponse(),
    cardsPlayers: [],
  });
  renderScreen();

  await screen.findByText('No players on waivers');
  // hide=1 is the Players page's "Hide rostered" filter, so the CTA lands on
  // the pool already scoped to unrostered/available players.
  expect(screen.getByRole('link', { name: /browse players/i })).toHaveAttribute(
    'href',
    '/player?hide=1'
  );
});

test('shows an error alert when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'waivers unavailable' } } });

  renderScreen();

  expect(await screen.findByText('waivers unavailable')).toBeInTheDocument();
});

// #1310 formal review f2 constraint 3: a failed on-waivers read (the cards
// fetch, part of the SAME Promise.all as the league/roster reads) must
// surface the existing error alert - never a silently-empty table.
test("a failed on-waivers read surfaces the existing error alert, not an empty table", async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waiversResponse() });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: rosterResponse() });
    if (url === '/api/players') return Promise.reject(new Error('players index unavailable'));
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderScreen();

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByTestId('on-waivers-panel')).not.toBeInTheDocument();
  expect(screen.queryByText('No players on waivers')).not.toBeInTheDocument();
});

// #1399: the On waivers table pages at 25 like the Players list. #1310 formal
// review f2 constraint 3 had the page loop EVERY cards page before first paint;
// once #1375's kickoff hold put every unrostered player on waivers (3,500+
// rows, 141 pages) that loop ran to its cap and the page never rendered. Now
// exactly one page is read per view, the pager reads the next page on demand,
// and a page change never re-reads the claims panel or the roster.
const twoCardsPages = () => ({
  pageOne: Array.from({ length: 25 }, (_, i) => cardsPlayer({ id: 100 + i, name: `Waiver Player ${i}` })),
  pageTwo: [cardsPlayer({ id: 200, name: 'Second Page Player' })],
});

const playersCalls = () => apiClient.get.mock.calls.filter(([url]) => url === '/api/players');

test('renders after ONE on-waivers page and pages the rest through the pager', async () => {
  const { pageOne, pageTwo } = twoCardsPages();
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    cardsPages: [
      { players: pageOne, totalPages: 2, total: 26 },
      { players: pageTwo, totalPages: 2, total: 26 },
    ],
  });
  renderScreen();

  await screen.findByText('Waiver Player 0');
  // header row + 25 player rows: the first page only, not the whole list.
  expect(screen.getAllByRole('row')).toHaveLength(26);
  expect(screen.queryByText('Second Page Player')).not.toBeInTheDocument();
  expect(playersCalls()).toHaveLength(1);
  expect(playersCalls()[0][1].params.page).toBe(1);
  expect(screen.getByText('26 players on waivers')).toBeInTheDocument();

  const pager = screen.getByRole('navigation', { name: /pagination/i });
  await userEvent.click(within(pager).getByRole('button', { name: 'Go to page 2' }));

  await screen.findByText('Second Page Player');
  expect(screen.queryByText('Waiver Player 0')).not.toBeInTheDocument();
  expect(playersCalls()).toHaveLength(2);
  expect(playersCalls()[1][1].params.page).toBe(2);
  // A page change reads the cards page only, never the claims panel or roster again.
  expect(apiClient.get.mock.calls.filter(([url]) => url.startsWith('/api/waivers'))).toHaveLength(1);
  expect(apiClient.get.mock.calls.filter(([url]) => url.startsWith('/api/team/roster'))).toHaveLength(1);
});

test('a ?page= deep link reads that page first', async () => {
  const { pageOne, pageTwo } = twoCardsPages();
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    cardsPages: [
      { players: pageOne, totalPages: 2, total: 26 },
      { players: pageTwo, totalPages: 2, total: 26 },
    ],
  });
  renderScreen(1, '/league/1/waivers?page=2');

  await screen.findByText('Second Page Player');
  expect(playersCalls()).toHaveLength(1);
  expect(playersCalls()[0][1].params.page).toBe(2);
});

test('a single page shows no pager', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
});

test('renders an Upgrade badge for a player with a nonzero Upgrade', async () => {
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    cardsPlayers: [cardsPlayer({ upgrade: { points: 5.3, overPlayer: { id: 21, name: 'Tyreek Hill' }, slot: 'WR' } })],
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('+5.3')).toBeInTheDocument();
});

test('does not show an upgrade badge for a player with a null Upgrade', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse(), cardsPlayers: [cardsPlayer({ upgrade: null })] });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
});

// Dropped (was: "a failed suggestions fetch is silently ignored (no badges,
// no error)"): there is no separate, best-effort suggestions fetch left to
// fail silently - Upgrade arrives as part of the required cards read, and a
// failed READ now surfaces the error alert (constraint 3's own test above),
// not a quietly-ignored one.

test('a best-ball league hides the Upgrade column and sort', async () => {
  setupGet({
    waivers: waiversResponse({
      league: {
        waiver_type: 'priority',
        waiver_period_hours: 24,
        faab_budget: 100,
        waivers_clear_at: null,
        best_ball: true,
      },
    }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
});

test('a non-best-ball league still shows the Upgrade column', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('Upgrade')).toBeInTheDocument();
});

const twoWaiverCardsPlayers = () => [
  cardsPlayer({
    id: 7,
    name: 'Breece Hall',
    upgrade: { points: 2.1, overPlayer: { id: 20, name: 'Josh Allen' }, slot: 'RB' },
  }),
  cardsPlayer({
    id: 8,
    name: 'Jaylen Warren',
    nfl_team: 'Pittsburgh Steelers',
    upgrade: { points: 6.1, overPlayer: { id: 20, name: 'Josh Allen' }, slot: 'RB' },
  }),
];

test('defaults the on-waivers sort to upgrade-desc once the cards read loads', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse(), cardsPlayers: twoWaiverCardsPlayers() });
  renderScreen();

  await screen.findByText('Breece Hall');
  await waitFor(() => {
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(within(rows[0]).getByText('Jaylen Warren')).toBeInTheDocument();
  });
});

// Second risk review (accessibility, round 1 fix delta), finding 3: prev/
// next must follow the RENDERED (sorted) order, not the raw fetch order -
// the sort here defaults to upgrade-desc, putting Jaylen Warren first.
test('prev/next over the opening list follows the sorted table order, not the raw fetch order', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse(), cardsPlayers: twoWaiverCardsPlayers() });
  renderScreen();

  await waitFor(() => {
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Jaylen Warren')).toBeInTheDocument();
  });

  await userEvent.click(screen.getByText('Jaylen Warren'));
  const card = await screen.findByTestId('decision-card');
  expect(within(card).getByLabelText('Player 1 of 2')).toBeInTheDocument();

  await userEvent.click(within(card).getByTestId('decision-card-next'));
  expect(within(card).getByRole('heading', { name: 'Breece Hall' })).toBeInTheDocument();
});

test('clicking the Upgrade column header toggles the default sort direction', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse(), cardsPlayers: twoWaiverCardsPlayers() });
  renderScreen();

  await screen.findByText('Breece Hall');
  // Auto-sorted desc already (Jaylen Warren's +6.1 first); one click on an
  // already-active sort flips the direction, not re-applies the same one.
  await waitFor(() => {
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Jaylen Warren')).toBeInTheDocument();
  });

  await userEvent.click(screen.getByText('Upgrade'));

  const rows = screen.getAllByRole('row').slice(1);
  expect(within(rows[0]).getByText('Breece Hall')).toBeInTheDocument();
});

test('the sort toggle can still be engaged manually when every row has nothing to rank', async () => {
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    cardsPlayers: [
      cardsPlayer({ id: 7, name: 'Breece Hall' }),
      cardsPlayer({ id: 8, name: 'Jaylen Warren', nfl_team: 'Pittsburgh Steelers' }),
    ],
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  // No Upgrade values to rank by, so nothing meaningfully reorders; a manual
  // click still works and doesn't crash with no upgrade data.
  await userEvent.click(screen.getByText('Upgrade'));
  const rows = screen.getAllByRole('row').slice(1);
  expect(within(rows[0]).getByText('Breece Hall')).toBeInTheDocument();
});

// #970: the transaction surfaces read a refusal through readHttpFailure. This
// is the envelope where the user-visible benefit of the whole sequence lands:
// the server sends shape (b), the machine code in `error` and the sentence
// written for the manager in `message`. The old hand-rolled
// `err.response?.data?.error` read the code, so a manager whose claim was
// refused was shown WAIVER_PERIOD_CLOSED in both the banner and the toast.
test('a claim refusal carrying a code beside a message renders the message, not the code', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockRejectedValueOnce({
    response: {
      status: 409,
      data: {
        error: 'WAIVER_PERIOD_CLOSED',
        message: 'Waivers have already cleared for this week. Try a free agent add.',
      },
    },
  });
  renderScreenWithToasts();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

  expect(await screen.findAllByText(
    'Waivers have already cleared for this week. Try a free agent add.'
  )).not.toHaveLength(0);
  expect(screen.queryByText('WAIVER_PERIOD_CLOSED')).not.toBeInTheDocument();
});

// The Decision card's claim bar requires a drop pick at capacity; that gate
// reads rosterCount/rosterCapacity, which only this page's cards read
// carries, so it must be handed through or a full-roster claim from here
// still dies on the server's 409.
test('at roster capacity the Decision card claim bar from Waiver Wire requires a drop pick', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waiversResponse() });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: rosterResponse() });
    if (url === '/api/players')
      return Promise.resolve({
        data: {
          players: [cardsPlayer()],
          totalPages: 1,
          total: 1,
          context: { rosterCount: 16, rosterCapacity: 16 },
        },
      });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  renderScreen();

  await userEvent.click(await screen.findByRole('button', { name: 'Breece Hall' }));
  const card = await screen.findByTestId('decision-card');
  const action = within(card).getByTestId('claim-player-action');
  expect(within(action).getByTestId('claim-player-submit')).toBeDisabled();
  expect(within(action).getByLabelText('Drop a player')).toBeInTheDocument();
});

// The page's OWN claim dialog must apply the same gate. A 19-of-20 roster
// whose IR slot holds a non-eligible player has a capacity of 19 (#97), so a
// no-drop claim can only 409 "roster capacity of 19 reached; choose a player
// to drop" - the Winsconsota "Jesus 1" report of 2026-09-15. The dialog used
// to say "Drop a player (optional)" and let Submit through to that refusal.
test('at roster capacity the claim dialog requires a drop pick before Submit', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waiversResponse() });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: rosterResponse() });
    if (url === '/api/players')
      return Promise.resolve({
        data: {
          players: [cardsPlayer()],
          totalPages: 1,
          total: 1,
          context: { rosterCount: 19, rosterCapacity: 19 },
        },
      });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Your roster is full/)).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Drop a player')).toBeInTheDocument();
  expect(within(dialog).queryByLabelText('Drop a player (optional)')).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Submit Claim' })).toBeDisabled();
  expect(apiClient.post).not.toHaveBeenCalled();

  await userEvent.click(within(dialog).getByLabelText('Drop a player'));
  await userEvent.click(screen.getByRole('option', { name: /Josh Allen/ }));
  expect(within(dialog).getByRole('button', { name: 'Submit Claim' })).toBeEnabled();
});

test('below roster capacity the claim dialog keeps the drop pick optional', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waiversResponse() });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: rosterResponse() });
    if (url === '/api/players')
      return Promise.resolve({
        data: {
          players: [cardsPlayer()],
          totalPages: 1,
          total: 1,
          context: { rosterCount: 18, rosterCapacity: 19 },
        },
      });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByText(/Your roster is full/)).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText('Drop a player (optional)')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Submit Claim' })).toBeEnabled();
});
