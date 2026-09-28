import React from 'react';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';

// Home v2 slice 3: league status cards on GET /api/league?include=status
// (Contract B). The seam is the page itself: UserPage rendered with apiClient
// mocked, the leagues response carrying each row's `status` block.

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const DAY_MS = 24 * 60 * 60 * 1000;

const liveStatus = (overrides = {}) => ({
  phase: 'in-season',
  week: 4,
  record: { wins: 3, losses: 0, ties: 0 },
  standing: { rank: 2, of: 12 },
  matchup: {
    id: 912,
    status: 'live',
    opponent: { teamId: 488, name: 'Frozen Tundra FC' },
    my: { score: 87.4, expectedFinal: 118.6, playersRemaining: 4 },
    opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 3 },
    winProbability: null,
  },
  lineup: { emptySlots: ['FLEX'], problems: ['1 empty FLEX slot'], nextLockAt: '2026-10-04T20:25:00.000Z' },
  ...overrides,
});

const fantasyLeague = (statusOverrides = {}, rowOverrides = {}) => ({
  id: 71,
  name: 'Winsconsota',
  my_team_id: 10,
  my_team_name: 'Polk High Legends',
  draft_status: 'complete',
  season_status: 'regular',
  current_week: 4,
  owner_id: 1,
  is_owner: true,
  is_commissioner: true,
  scoring_preset: 'half_ppr',
  team_count: 12,
  max_teams: 12,
  status: liveStatus(statusOverrides),
  statusError: false,
  ...rowOverrides,
});

const pickemLeague = (pickem = {}, rowOverrides = {}) => ({
  id: 5,
  name: "Office Pick'em",
  my_team_id: 50,
  my_team_name: 'Cubicle Crew',
  draft_status: 'pending',
  pickem_only: true,
  owner_id: 2,
  is_owner: false,
  is_commissioner: false,
  team_count: 18,
  max_teams: 30,
  status: {
    phase: 'in-season',
    week: 4,
    pickem: { made: 9, total: 15, nextLockAt: '2026-10-05T00:20:00.000Z', ...pickem },
  },
  statusError: false,
  ...rowOverrides,
});

const preDraftLeague = (draft = {}, rowOverrides = {}) => ({
  id: 9,
  name: 'Dynasty Startup',
  my_team_id: 90,
  my_team_name: 'Startup Squad',
  draft_status: 'pending',
  owner_id: 1,
  is_owner: true,
  is_commissioner: true,
  invite_code: 'EZ7K4Q92',
  team_count: 9,
  max_teams: 12,
  status: {
    phase: 'pre-draft',
    draft: {
      date: new Date(Date.now() + 10 * DAY_MS).toISOString(),
      timezone: 'America/Chicago',
      seatsFilled: 9,
      maxTeams: 12,
      ...draft,
    },
  },
  statusError: false,
  ...rowOverrides,
});

const mockLeagues = (leagues) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: leagues });
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications: [], unread: 0 } });
    return Promise.resolve({ data: [] });
  });
};

const renderPage = () => renderWithProviders(<SnackbarProvider><UserPage /></SnackbarProvider>, { state: baseState });

// The card for one league: its h3 names the article that holds it.
const cardFor = (name) => screen.findByRole('article', { name });

// jsdom lays nothing out, but emotion inserts each sx rule into
// document.styleSheets under the element's generated class (the Countdown
// test's approach), so the 44px floor is asserted on the declared rule.
const declaredStyle = (element) => {
  const classes = Array.from(element.classList).filter((c) => c.startsWith('css-'));
  return Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule) => classes.some((cls) => rule.selectorText === `.${cls}`))
    .map((rule) => rule.style.cssText)
    .join(';');
};
const expectTouchTarget = (element) => expect(declaredStyle(element)).toMatch(/min-height: 44px/);

afterEach(() => {
  jest.clearAllMocks();
});

// --- The pinned call -----------------------------------------------------

test('fetches the leagues list with its status block', async () => {
  mockLeagues([]);
  renderPage();

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league', { params: { include: 'status' } }));
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/league');
});

// --- Live fantasy matchup ------------------------------------------------

test('a live fantasy card shows the league title as its link, both scores, projections and the standing', async () => {
  mockLeagues([fantasyLeague()]);
  renderPage();

  const card = within(await cardFor('Winsconsota'));
  expect(card.getByRole('link', { name: 'Winsconsota' })).toHaveAttribute('href', '/league/71');
  expect(card.getByText('Live')).toBeInTheDocument();
  expect(card.getByText('You · 3–0')).toBeInTheDocument();
  expect(card.getByText('Polk High Legends')).toBeInTheDocument();
  expect(card.getByText('87.4')).toBeInTheDocument();
  expect(card.getByText('Proj 118.6 · 4 yet to play')).toBeInTheDocument();
  expect(card.getByText('Frozen Tundra FC')).toBeInTheDocument();
  expect(card.getByText('71.2')).toBeInTheDocument();
  expect(card.getByText('Proj 104.1 · 3 yet to play')).toBeInTheDocument();
  expect(card.getByText('2nd')).toBeInTheDocument();
  expect(card.getByText(/of 12/)).toBeInTheDocument();
});

test('the win-probability bar is one image whose label carries both sides, computed with v1 from Expected final', async () => {
  // v1: margin of expected finals 118.6 - 104.1 = 14.5 over MARGIN_SCALE 24.
  mockLeagues([fantasyLeague()]);
  renderPage();

  const card = within(await cardFor('Winsconsota'));
  expect(card.getByRole('img', { name: 'Win probability: you 65 percent, Frozen Tundra FC 35 percent' })).toBeInTheDocument();
  expect(card.getByText('You 65% to win')).toBeInTheDocument();
  expect(card.getByText('Them 35%')).toBeInTheDocument();
});

test('a server win probability, once present, is preferred over the v1 estimate', async () => {
  mockLeagues([fantasyLeague({ matchup: { ...liveStatus().matchup, winProbability: 0.8 } })]);
  renderPage();

  const card = within(await cardFor('Winsconsota'));
  expect(card.getByRole('img', { name: 'Win probability: you 80 percent, Frozen Tundra FC 20 percent' })).toBeInTheDocument();
});

test('lineup health names the problem, or says the lineup is set', async () => {
  mockLeagues([
    fantasyLeague(),
    fantasyLeague({ lineup: { emptySlots: [], problems: [], nextLockAt: null } }, { id: 72, name: 'MinneApple' }),
    fantasyLeague(
      { lineup: { emptySlots: ['FLEX'], problems: ['1 empty FLEX slot', 'Jalen Hurts (QB) is on bye'], nextLockAt: null } },
      { id: 73, name: 'Lake Effect League' },
    ),
  ]);
  renderPage();

  expect(within(await cardFor('Winsconsota')).getByText('1 empty FLEX slot')).toBeInTheDocument();
  expect(within(await cardFor('MinneApple')).getByText('Lineup set')).toBeInTheDocument();
  expect(within(await cardFor('Lake Effect League')).getByText('1 empty FLEX slot · 1 more')).toBeInTheDocument();
});

test('the card actions are separate links that clear the 44px floor, and so does the title link', async () => {
  mockLeagues([fantasyLeague()]);
  renderPage();

  const card = within(await cardFor('Winsconsota'));
  const lineup = card.getByRole('link', { name: 'Lineup' });
  const matchup = card.getByRole('link', { name: 'Matchup' });
  const waivers = card.getByRole('link', { name: 'Waivers' });
  expect(lineup).toHaveAttribute('href', '/league/71/lineup');
  expect(matchup).toHaveAttribute('href', '/league/71/matchups/912');
  expect(waivers).toHaveAttribute('href', '/league/71/waivers');
  [lineup, matchup, waivers, card.getByRole('link', { name: 'Winsconsota' })].forEach(expectTouchTarget);
});

test('a bye week reads "Bye week" and draws no odds bar', async () => {
  mockLeagues([fantasyLeague({ matchup: null })]);
  renderPage();

  const card = within(await cardFor('Winsconsota'));
  expect(card.getByText('Bye week')).toBeInTheDocument();
  expect(card.queryByRole('img', { name: /Win probability/ })).not.toBeInTheDocument();
});

test('a final matchup swaps the LIVE chip for Final and the bar for the result', async () => {
  mockLeagues([fantasyLeague({
    matchup: {
      ...liveStatus().matchup,
      status: 'final',
      my: { score: 118.6, expectedFinal: 118.6, playersRemaining: 0 },
      opp: { score: 104.1, expectedFinal: 104.1, playersRemaining: 0 },
    },
  })]);
  renderPage();

  const card = within(await cardFor('Winsconsota'));
  expect(card.getByText('Final')).toBeInTheDocument();
  expect(card.queryByText('Live')).not.toBeInTheDocument();
  expect(card.getByText('You won')).toBeInTheDocument();
  expect(card.queryByRole('img', { name: /Win probability/ })).not.toBeInTheDocument();
});

// --- Pick'em -------------------------------------------------------------

test("a pick'em card shows progress, a strip whose cells differ by more than color, and a Finish picks action", async () => {
  mockLeagues([pickemLeague()]);
  renderPage();

  const article = await cardFor("Office Pick'em");
  const card = within(article);
  expect(card.getByText('Picks open')).toBeInTheDocument();
  expect(card.getByText('Week 4 picks made')).toBeInTheDocument();
  expect(card.getByRole('img', { name: 'Week 4 picks: 9 of 15 made' })).toBeInTheDocument();

  const made = card.getAllByTestId('pick-cell-made');
  const open = card.getAllByTestId('pick-cell-open');
  expect(made).toHaveLength(9);
  expect(open).toHaveLength(6);
  // Made carries a check glyph; open carries none and a dashed outline.
  made.forEach((cell) => expect(within(cell).getByTestId('CheckIcon')).toBeInTheDocument());
  open.forEach((cell) => {
    expect(within(cell).queryByTestId('CheckIcon')).not.toBeInTheDocument();
    expect(declaredStyle(cell)).toMatch(/border: 2px dashed/);
  });

  const finish = card.getByRole('link', { name: 'Finish picks' });
  expect(finish).toHaveAttribute('href', '/league/5/pickem');
  expectTouchTarget(finish);
});

test("a pick'em card with every pick in says so and offers to view them", async () => {
  mockLeagues([pickemLeague({ made: 15, total: 15 })]);
  renderPage();

  const card = within(await cardFor("Office Pick'em"));
  expect(card.getByText('Picks in')).toBeInTheDocument();
  expect(card.getByRole('link', { name: 'View picks' })).toHaveAttribute('href', '/league/5/pickem');
});

// --- Pre-draft -----------------------------------------------------------

test('a pre-draft card shows seat counts, a countdown, the invite code and the draft room', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  mockLeagues([preDraftLeague()]);
  renderPage();

  const article = await cardFor('Dynasty Startup');
  const card = within(article);
  expect(card.getByText('9 of 12 seats filled')).toBeInTheDocument();
  // No team names ride on Contract B, so the grid shows counts, not initials.
  expect(card.getAllByTestId('seat-filled')).toHaveLength(9);
  expect(card.getAllByTestId('seat-open')).toHaveLength(3);
  expect(card.getByText(/⏱ \d+d \d{2}h/)).toBeInTheDocument();
  expect(card.getByText('EZ7K4Q92')).toBeInTheDocument();

  const copy = card.getByRole('button', { name: 'Copy invite code EZ7K4Q92' });
  expectTouchTarget(copy);
  await userEvent.click(copy);
  expect(writeText).toHaveBeenCalledWith('EZ7K4Q92');
  expect(await screen.findByText('Invite code copied')).toBeInTheDocument();

  const draftRoom = card.getByRole('link', { name: 'Draft Room' });
  expect(draftRoom).toHaveAttribute('href', '/league/9/draft');
  expectTouchTarget(draftRoom);
});

test('a full pre-draft league hides the invite code', async () => {
  mockLeagues([preDraftLeague({ seatsFilled: 12 })]);
  renderPage();

  const card = within(await cardFor('Dynasty Startup'));
  expect(card.getByText('12 of 12 seats filled')).toBeInTheDocument();
  expect(card.queryByRole('button', { name: /Copy invite code/ })).not.toBeInTheDocument();
});

// --- Fallback ------------------------------------------------------------

test('a row with no status, or a failed status, falls back to the compact league card', async () => {
  mockLeagues([
    fantasyLeague({}, { status: null, statusError: true }),
    { id: 3, name: 'Sunday Ballers', my_team_name: "alice's Team", draft_status: 'pending', owner_id: 1 },
  ]);
  renderPage();

  expect(await screen.findByText('Team: Polk High Legends')).toBeInTheDocument();
  expect(screen.getByText("Team: alice's Team")).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Winsconsota' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Win probability/ })).not.toBeInTheDocument();
});

// --- Filters -------------------------------------------------------------

test('filter chips are aria-pressed toggle buttons with counts that narrow the grid', async () => {
  mockLeagues([fantasyLeague(), pickemLeague(), preDraftLeague()]);
  renderPage();
  await cardFor('Winsconsota');

  const group = within(screen.getByRole('group', { name: 'Filter leagues' }));
  const all = group.getByRole('button', { name: 'All 3' });
  const live = group.getByRole('button', { name: 'Live 1' });
  const pickem = group.getByRole('button', { name: "Pick'em 1" });
  const drafting = group.getByRole('button', { name: 'Drafting 1' });
  expect(all).toHaveAttribute('aria-pressed', 'true');
  expect(live).toHaveAttribute('aria-pressed', 'false');
  [all, live, pickem, drafting].forEach(expectTouchTarget);

  await userEvent.click(live);
  expect(live).toHaveAttribute('aria-pressed', 'true');
  expect(all).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('heading', { level: 3, name: 'Winsconsota' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 3, name: "Office Pick'em" })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 3, name: 'Dynasty Startup' })).not.toBeInTheDocument();

  await userEvent.click(drafting);
  expect(screen.getByRole('heading', { level: 3, name: 'Dynasty Startup' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 3, name: 'Winsconsota' })).not.toBeInTheDocument();

  await userEvent.click(all);
  expect(screen.getAllByTestId('league-status-card')).toHaveLength(3);
});

test('more than six leagues shows six, then a Show all button for the rest', async () => {
  const leagues = Array.from({ length: 8 }, (_, i) => fantasyLeague({}, { id: 100 + i, name: `League ${i + 1}` }));
  mockLeagues(leagues);
  renderPage();
  await cardFor('League 1');

  expect(screen.getAllByTestId('league-status-card')).toHaveLength(6);
  const showAll = screen.getByRole('button', { name: 'Show all 8 leagues' });
  expectTouchTarget(showAll);
  await userEvent.click(showAll);
  expect(screen.getAllByTestId('league-status-card')).toHaveLength(8);
});
