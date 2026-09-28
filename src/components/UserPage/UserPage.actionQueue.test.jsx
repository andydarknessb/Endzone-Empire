import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createTheme } from '@mui/material/styles';
import UserPage from './UserPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// Home v2 slice 2: the to-do list (GET /api/user/action-items, Contract A)
// replaces the hero and the "Next up" nudge. These tests drive UserPage the
// way a manager sees it, with apiClient mocked by URL.

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// A few seconds of slack so the minute a test computes is still the minute
// the page renders.
const inFromNow = (ms) => new Date(Date.now() + ms + 20 * 1000).toISOString();

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  my_team_id: 10,
  my_team_name: "alice's Team",
  draft_status: 'pending',
  owner_id: 1,
  ...overrides,
});

const item = (overrides = {}) => ({
  id: 'lineup_problem:71:2026-4',
  type: 'lineup_problem',
  leagueId: 71,
  leagueName: 'Winsconsota',
  title: 'Fill your empty FLEX before the late games',
  detail: '3 bench players are still to play',
  severity: 'timed',
  deadlineAt: null,
  cta: { label: 'Fix lineup', to: '/league/71/lineup' },
  progress: null,
  ...overrides,
});

const actionItemsBody = (items, extra = {}) => ({
  generatedAt: new Date().toISOString(),
  counts: { total: items.length, dueToday: 0 },
  partial: [],
  items,
  ...extra,
});

// `actionItems` is a response body, an Error (the fetch rejects), a function
// (called per request, for retry tests) or 'pending' (never settles).
const mockApi = ({ leagues = [], actionItems = actionItemsBody([]), notifications = [] } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/user/action-items') {
      const answer = typeof actionItems === 'function' ? actionItems() : actionItems;
      if (answer === 'pending') return new Promise(() => {});
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ data: answer });
    }
    if (url === '/api/league') return Promise.resolve({ data: leagues });
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications, unread: 0 } });
    return Promise.resolve({ data: [] });
  });
};

const renderPage = () => renderWithProviders(<UserPage />, { state: baseState });

const findQueue = () => screen.findByRole('region', { name: /Needs your attention/ });

const rowTitles = (queue) => within(within(queue).getByRole('list')).getAllByRole('listitem')
  .map((row) => within(row).getByTestId('action-item-title').textContent);

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches the to-do list with the viewer time zone and shows the items in the order served', async () => {
  mockApi({
    actionItems: actionItemsBody([
      item({ id: 'a', title: 'Your draft is live' }),
      item({ id: 'b', title: 'Fill your empty FLEX before the late games' }),
      item({ id: 'c', title: '6 Week 4 picks still open' }),
    ]),
  });
  renderPage();

  const queue = await findQueue();
  await within(queue).findByText('Your draft is live');
  expect(rowTitles(queue)).toEqual([
    'Your draft is live',
    'Fill your empty FLEX before the late games',
    '6 Week 4 picks still open',
  ]);
  expect(apiClient.get).toHaveBeenCalledWith('/api/user/action-items', {
    params: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
});

test('the old "Next up" nudge is gone: a trade notification no longer becomes a hero call to action', async () => {
  mockApi({
    leagues: [league({ id: 9, draft_status: 'active' })],
    notifications: [{ id: 1, message: 'Bob proposed a trade', league_id: 9, created_at: '2026-01-01T00:00:00.000Z' }],
  });
  renderPage();

  await screen.findByText('Sunday Ballers');
  await findQueue();
  expect(screen.queryByText('Next up')).not.toBeInTheDocument();
  expect(screen.queryByText('Action needed')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Review trades' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open Draft Room' })).not.toBeInTheDocument();
});

test('the greeting header is the page h1 and keeps Create and Join within reach', async () => {
  mockApi({ leagues: [league()] });
  renderPage();

  await screen.findByText('Sunday Ballers');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, alice');
  const header = screen.getByTestId('dashboard-hero');
  expect(within(header).getByRole('button', { name: 'Create league' })).toBeInTheDocument();
  expect(within(header).getByRole('button', { name: 'Join league' })).toBeInTheDocument();
  // The marketing tagline and banner photo gave way to the to-do list.
  expect(screen.queryByText(/Your command center for every league/)).not.toBeInTheDocument();
});

test("the first item's call to action is the primary button and the rest are outlined", async () => {
  mockApi({
    actionItems: actionItemsBody([
      item({ id: 'a', cta: { label: 'Fix lineup', to: '/league/71/lineup' } }),
      item({ id: 'b', type: 'picks_open', cta: { label: 'Finish picks', to: '/league/4/pickem' } }),
      item({ id: 'c', type: 'trade_offer', cta: { label: 'Review trade', to: '/league/71/trades' } }),
    ]),
  });
  renderPage();

  const queue = await findQueue();
  const first = await within(queue).findByRole('link', { name: 'Fix lineup' });
  expect(first).toHaveAttribute('href', '/league/71/lineup');
  expect(first).toHaveClass('MuiButton-contained');
  const second = within(queue).getByRole('link', { name: 'Finish picks' });
  expect(second).toHaveAttribute('href', '/league/4/pickem');
  expect(second).toHaveClass('MuiButton-outlined');
  expect(within(queue).getByRole('link', { name: 'Review trade' })).toHaveClass('MuiButton-outlined');
});

test('shows the first 4 items and a "Show all N" control that reveals the rest', async () => {
  const six = Array.from({ length: 6 }, (_, i) => item({ id: `i${i}`, title: `Item ${i + 1}` }));
  mockApi({ actionItems: actionItemsBody(six) });
  renderPage();

  const queue = await findQueue();
  await within(queue).findByText('Item 1');
  expect(rowTitles(queue)).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4']);

  const showAll = within(queue).getByRole('button', { name: 'Show all 6' });
  expect(showAll).toHaveAttribute('aria-controls');
  await userEvent.click(showAll);

  expect(rowTitles(queue)).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6']);
  expect(within(queue).queryByRole('button', { name: 'Show all 6' })).not.toBeInTheDocument();
  // The control is gone, so focus moves to the first revealed item rather
  // than falling back to the top of the page.
  expect(within(queue).getAllByRole('listitem')[4]).toHaveFocus();
});

test('with 4 or fewer items there is no Show all control', async () => {
  mockApi({ actionItems: actionItemsBody([item({ id: 'a' }), item({ id: 'b', title: 'Second' })]) });
  renderPage();

  const queue = await findQueue();
  await within(queue).findByText('Second');
  expect(within(queue).queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
});

test('an empty to-do list says the manager is all caught up', async () => {
  mockApi({ leagues: [league()], actionItems: actionItemsBody([]) });
  renderPage();

  const queue = await findQueue();
  expect(await within(queue).findByRole('heading', { level: 3, name: "You're all caught up" })).toBeInTheDocument();
  expect(within(queue).queryByRole('list')).not.toBeInTheDocument();
  expect(within(queue).getByRole('link', { name: 'Browse the waiver wire' })).toHaveAttribute('href', '/waiver-wire');
});

test('shows a skeleton while the to-do list loads, and never the caught-up state', async () => {
  mockApi({ actionItems: 'pending' });
  renderPage();

  const queue = await findQueue();
  expect(within(queue).getByTestId('action-queue-skeleton')).toBeInTheDocument();
  expect(within(queue).queryByText("You're all caught up")).not.toBeInTheDocument();
});

test('a failed to-do fetch shows an error with Try again, and the retry brings the items in', async () => {
  let call = 0;
  mockApi({
    actionItems: () => {
      call += 1;
      return call === 1 ? new Error('network error') : actionItemsBody([item({ title: 'Fill your empty FLEX' })]);
    },
  });
  renderPage();

  const queue = await findQueue();
  expect(await within(queue).findByText("We couldn't load your to-do list.")).toBeInTheDocument();
  expect(within(queue).queryByText("You're all caught up")).not.toBeInTheDocument();

  await userEvent.click(within(queue).getByRole('button', { name: 'Try again' }));

  expect(await within(queue).findByText('Fill your empty FLEX')).toBeInTheDocument();
  expect(within(queue).queryByText("We couldn't load your to-do list.")).not.toBeInTheDocument();
});

test('a failed to-do list never blocks the leagues list', async () => {
  mockApi({ leagues: [league()], actionItems: new Error('server exploded') });
  renderPage();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  const queue = await findQueue();
  expect(await within(queue).findByText("We couldn't load your to-do list.")).toBeInTheDocument();
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
});

test('a to-do list that never answers never blocks the leagues list', async () => {
  mockApi({ leagues: [league()], actionItems: 'pending' });
  renderPage();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.queryAllByTestId('league-skeleton')).toHaveLength(0);
});

test('an item with progress shows a labelled progress bar and the count', async () => {
  mockApi({
    actionItems: actionItemsBody([
      item({ id: 'l', title: 'Fill your empty FLEX' }),
      item({
        id: 'p', type: 'picks_open', title: '6 Week 4 picks still open', leagueName: "Office Pick'em",
        progress: { done: 9, total: 15 }, cta: { label: 'Finish picks', to: '/league/4/pickem' },
      }),
    ]),
  });
  renderPage();

  const queue = await findQueue();
  const bar = await within(queue).findByRole('progressbar', { name: 'Picks made' });
  expect(bar).toHaveAttribute('aria-valuemin', '0');
  expect(bar).toHaveAttribute('aria-valuemax', '15');
  expect(bar).toHaveAttribute('aria-valuenow', '9');
  expect(within(queue).getByText('9 of 15 made')).toBeInTheDocument();
  // Only the item that carries progress gets a bar.
  expect(within(queue).getAllByRole('progressbar')).toHaveLength(1);
});

test('a deadline under 24 hours reads relative, and under 2 hours it takes the warning color', async () => {
  mockApi({
    actionItems: actionItemsBody([
      item({ id: 'soon', title: 'Soon', deadlineAt: inFromNow(72 * MINUTE) }),
      item({ id: 'later', title: 'Later', deadlineAt: inFromNow(5 * HOUR + 7 * MINUTE) }),
      item({ id: 'far', title: 'Far', deadlineAt: inFromNow(3 * 24 * HOUR) }),
    ]),
  });
  renderPage();

  const queue = await findQueue();
  const soon = await within(queue).findByText('in 1h 12m');
  const later = within(queue).getByText('in 5h 07m');
  const { palette } = createTheme();
  expect(soon).toHaveStyle({ color: palette.warning.main });
  expect(later).not.toHaveStyle({ color: palette.warning.main });
  // Days out, the row names the date instead of counting down.
  const farRow = within(queue).getAllByRole('listitem').find((row) => within(row).queryByText('Far'));
  expect(within(farRow).queryByText(/^in /)).not.toBeInTheDocument();
  // One time zone for the whole list, and it says which.
  expect(within(queue).getByText(/Deadlines first · times in /)).toBeInTheDocument();
});

// CONTEXT.md, Clear time: claims resolve at each player's Clear time, never in
// a "waiver run", so the deadline column says when the claims clear.
test('a waiver claims deadline is labelled by its Clear time, not a waiver run', async () => {
  mockApi({
    actionItems: actionItemsBody([
      item({ id: 'w', type: 'waiver_claims', title: '2 claims pending', deadlineAt: inFromNow(5 * HOUR), cta: { label: 'View claims', to: '/league/71/waivers' } }),
    ]),
  });
  renderPage();

  const queue = await findQueue();
  expect(await within(queue).findByText('Claims clear')).toBeInTheDocument();
  expect(within(queue).queryByText(/waivers run/i)).not.toBeInTheDocument();
});

test('when some item types could not be checked, the list says so instead of claiming all caught up', async () => {
  mockApi({ actionItems: actionItemsBody([], { partial: ['picks_open'] }) });
  renderPage();

  const queue = await findQueue();
  expect(await within(queue).findByText("Some of your to-do list couldn't be checked right now.")).toBeInTheDocument();
  expect(within(queue).queryByText("You're all caught up")).not.toBeInTheDocument();
  expect(within(queue).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

// --- Next draft card -------------------------------------------------------

test('the Next draft card counts down to the earliest scheduled draft among pre-draft leagues', async () => {
  mockApi({
    leagues: [
      league({ id: 3, name: 'Later League', draft_date: inFromNow(10 * 24 * HOUR), team_count: 4, max_teams: 10 }),
      league({ id: 2, name: 'Dynasty Startup', draft_date: inFromNow(6 * 24 * HOUR), team_count: 9, max_teams: 12 }),
      league({ id: 4, name: 'Unscheduled League', draft_date: null }),
      league({ id: 5, name: 'Drafting League', draft_status: 'active', draft_date: inFromNow(-HOUR) }),
    ],
  });
  renderPage();

  const card = await screen.findByRole('region', { name: 'Next draft' });
  expect(within(card).getByText('Dynasty Startup')).toBeInTheDocument();
  expect(within(card).getByText(/^Draft in 6d/)).toBeInTheDocument();
  const seats = within(card).getByRole('progressbar', { name: 'Seats filled' });
  expect(seats).toHaveAttribute('aria-valuenow', '9');
  expect(seats).toHaveAttribute('aria-valuemax', '12');
  expect(within(card).getByText('9 / 12')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Open Draft Room' })).toHaveAttribute('href', '/league/2/draft');
  expect(within(card).getByRole('link', { name: 'Practice in Draft Sim' })).toHaveAttribute('href', '/draft-sim');
  expect(screen.getAllByRole('heading', { level: 2, name: 'Next draft' })).toHaveLength(1);
});

test('there is no Next draft card when no pre-draft league has a future draft date', async () => {
  mockApi({
    leagues: [
      league({ id: 4, name: 'Unscheduled League', draft_date: null }),
      league({ id: 6, name: 'Missed Date League', draft_date: inFromNow(-2 * HOUR) }),
      league({ id: 5, name: 'Done League', draft_status: 'complete', draft_date: inFromNow(2 * HOUR) }),
    ],
  });
  renderPage();

  await screen.findByText('Unscheduled League');
  await findQueue();
  expect(screen.queryByRole('region', { name: 'Next draft' })).not.toBeInTheDocument();
});

// --- Greeting context line -------------------------------------------------

test('the greeting names the NFL week when the in-season leagues agree on it', async () => {
  mockApi({
    leagues: [
      league({ id: 1, draft_status: 'complete', season_status: 'regular', current_week: 4 }),
      league({ id: 2, name: 'Office Pool', pickem_only: true, season_status: 'regular', current_week: 4 }),
      league({ id: 3, name: 'Startup', draft_status: 'pending', current_week: 1 }),
    ],
  });
  renderPage();

  await screen.findByText('Office Pool');
  const header = screen.getByTestId('dashboard-hero');
  expect(within(header).getByText(/^Week 4 · \w+, \w+ \d+$/)).toBeInTheDocument();
});

test('the greeting leaves out the week line when the leagues disagree or none is in season', async () => {
  mockApi({
    leagues: [
      league({ id: 1, draft_status: 'complete', season_status: 'regular', current_week: 4 }),
      league({ id: 2, name: 'Other League', draft_status: 'complete', season_status: 'regular', current_week: 5 }),
    ],
  });
  renderPage();

  await screen.findByText('Other League');
  expect(within(screen.getByTestId('dashboard-hero')).queryByText(/^Week /)).not.toBeInTheDocument();
});
