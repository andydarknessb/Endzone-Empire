import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
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
// (called per request, for retry tests) or 'pending' (never settles). `leagues`
// is a list, or a function returning a list, an Error (the fetch rejects) or 'pending'.
const mockApi = ({ leagues = [league()], actionItems = actionItemsBody([]), notifications = [] } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/user/action-items') {
      const answer = typeof actionItems === 'function' ? actionItems() : actionItems;
      if (answer === 'pending') return new Promise(() => {});
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ data: answer });
    }
    if (url === '/api/league') {
      const rows = typeof leagues === 'function' ? leagues() : leagues;
      if (rows instanceof Error) return Promise.reject(rows);
      return rows === 'pending' ? new Promise(() => {}) : Promise.resolve({ data: rows });
    }
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
    leagues: [league({ id: 9, draft_status: 'complete' })],
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
  // One fantasy league: straight to its Waivers page, no menu.
  expect(within(queue).getByRole('link', { name: 'Browse the waiver wire' })).toHaveAttribute('href', '/league/1/waivers');
});

// Waivers belong to one league, and Home spans all of them: with several
// fantasy leagues the link opens a menu of their Waivers pages; pick'em-only
// leagues have no waivers and are left out.
test('with several fantasy leagues, Browse the waiver wire opens a menu of their Waivers pages', async () => {
  const user = userEvent.setup();
  mockApi({
    leagues: [
      league({ id: 1, name: 'Sunday Ballers' }),
      league({ id: 2, name: 'Office Pool', pickem_only: true }),
      league({ id: 3, name: 'Dynasty Startup' }),
    ],
    actionItems: actionItemsBody([]),
  });
  renderPage();

  const queue = await findQueue();
  const trigger = await within(queue).findByRole('button', { name: 'Browse the waiver wire' });
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(within(queue).queryByRole('link', { name: 'Browse the waiver wire' })).not.toBeInTheDocument();

  await user.click(trigger);
  const menu = await screen.findByRole('menu', { name: 'Browse the waiver wire' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const items = within(menu).getAllByRole('menuitem');
  expect(items.map((el) => el.textContent)).toEqual(['Sunday Ballers', 'Dynasty Startup']);
  expect(within(menu).getByRole('menuitem', { name: 'Sunday Ballers' })).toHaveAttribute('href', '/league/1/waivers');
  expect(within(menu).getByRole('menuitem', { name: 'Dynasty Startup' })).toHaveAttribute('href', '/league/3/waivers');

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

test('with only pick\'em leagues there is no waiver wire to browse', async () => {
  mockApi({ leagues: [league({ id: 2, name: 'Office Pool', pickem_only: true })], actionItems: actionItemsBody([]) });
  renderPage();

  const queue = await findQueue();
  expect(await within(queue).findByRole('heading', { level: 3, name: "You're all caught up" })).toBeInTheDocument();
  expect(within(queue).queryByRole('link', { name: 'Browse the waiver wire' })).not.toBeInTheDocument();
  expect(within(queue).queryByRole('button', { name: 'Browse the waiver wire' })).not.toBeInTheDocument();
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
        detail: null, progress: { done: 9, total: 15 }, cta: { label: 'Finish picks', to: '/league/4/pickem' },
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

test('a picks row with a bar states its progress once, with the week in that one statement', async () => {
  mockApi({
    actionItems: actionItemsBody([
      item({
        id: 'p', type: 'picks_open', title: '14 picks still open', leagueName: "Office Pick'em",
        detail: '0 of 14 made for week 6', progress: { done: 0, total: 14 },
        cta: { label: 'Make picks', to: '/league/4/pickem' },
      }),
    ]),
  });
  renderPage();

  const queue = await findQueue();
  expect(await within(queue).findByRole('progressbar', { name: 'Picks made' })).toHaveAttribute('aria-valuetext', '0 of 14');
  expect(within(queue).getAllByText(/of 14 made/)).toHaveLength(1);
  expect(within(queue).getByText('0 of 14 made for week 6')).toBeInTheDocument();
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
  expect(within(queue).getByText(/Most urgent first · times in /)).toBeInTheDocument();
});

test('an info row is never warning-colored, however close its deadline is', async () => {
  mockApi({
    actionItems: actionItemsBody([
      item({ id: 'w', type: 'waiver_claims', title: '2 waiver claims pending', severity: 'info', deadlineAt: inFromNow(30 * MINUTE) }),
      item({ id: 'l', title: 'Fix lineup', deadlineAt: inFromNow(72 * MINUTE) }),
    ]),
  });
  renderPage();

  const queue = await findQueue();
  const { palette } = createTheme();
  expect(await within(queue).findByText('in 30m')).not.toHaveStyle({ color: palette.warning.main });
  expect(within(queue).getByText('in 1h 12m')).toHaveStyle({ color: palette.warning.main });
});

describe("grouped pick'em rows", () => {
  const picks = (id, leagueName, {
    done, total, open = total - done, deadlineAt,
  }) => item({
    id: `picks_open:${id}:2026-4`,
    type: 'picks_open',
    leagueId: id,
    leagueName,
    title: `${open} picks still open`,
    detail: null,
    deadlineAt,
    progress: { done, total, open },
    cta: { label: 'Make picks', to: `/league/${id}/pickem` },
  });

  test('two or more become one row with a chip per league and an action to the earliest', async () => {
    mockApi({
      actionItems: actionItemsBody([
        item({ id: 'l', title: 'Fix lineup', deadlineAt: inFromNow(HOUR) }),
        // One of Office's 16 games locked unpicked: 10 made, 5 still open, not 6.
        picks(4, "Office Pick'em", {
          done: 10, total: 16, open: 5, deadlineAt: inFromNow(5 * HOUR),
        }),
        picks(5, "Family Pick'em", { done: 0, total: 14, deadlineAt: inFromNow(3 * HOUR) }),
      ]),
    });
    renderPage();

    const queue = await findQueue();
    await within(queue).findByText('Make picks in 2 leagues');
    expect(rowTitles(queue)).toEqual(['Fix lineup', 'Make picks in 2 leagues']);
    const row = within(queue).getAllByRole('listitem')[1];
    const office = within(row).getByRole('link', { name: "Office Pick'em · 5 open" });
    expect(office).toHaveAttribute('href', '/league/4/pickem');
    expect(within(row).getByRole('link', { name: /Family Pick'em/ })).toHaveAttribute('href', '/league/5/pickem');
    expect(office).toHaveStyle({ minHeight: '44px' });
    // The deadline is the earliest, and the action goes to that league.
    expect(within(row).getByText('in 3h 00m')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Make picks' })).toHaveAttribute('href', '/league/5/pickem');
  });

  test('a single picks row renders as before, with no chips', async () => {
    mockApi({
      actionItems: actionItemsBody([picks(4, "Office Pick'em", { done: 9, total: 15, deadlineAt: null })]),
    });
    renderPage();

    const queue = await findQueue();
    await within(queue).findByText('6 picks still open');
    expect(within(queue).queryByText(/Make picks in/)).not.toBeInTheDocument();
    expect(within(queue).queryByRole('link', { name: /Office Pick'em .*open/ })).not.toBeInTheDocument();
  });

  test('Show all counts rendered rows, not items', async () => {
    mockApi({
      actionItems: actionItemsBody([
        picks(4, 'A', { done: 0, total: 2, deadlineAt: null }),
        picks(5, 'B', { done: 0, total: 2, deadlineAt: null }),
        picks(6, 'C', { done: 0, total: 2, deadlineAt: null }),
        ...Array.from({ length: 4 }, (_, i) => item({ id: `i${i}`, title: `Item ${i + 1}` })),
      ]),
    });
    renderPage();

    const queue = await findQueue();
    await within(queue).findByText('Make picks in 3 leagues');
    expect(rowTitles(queue)).toHaveLength(4);
    expect(within(queue).getByText('1 more')).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: 'Show all 5' })).toBeInTheDocument();
  });
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

test('there is no draft card when no league is drafting, late or scheduled ahead', async () => {
  mockApi({
    leagues: [
      league({ id: 4, name: 'Unscheduled League', draft_date: null }),
      league({ id: 5, name: 'Done League', draft_status: 'complete', draft_date: inFromNow(2 * HOUR) }),
    ],
  });
  renderPage();

  await screen.findByText('Unscheduled League');
  await findQueue();
  expect(screen.queryAllByRole('heading', { level: 2, name: /Next draft|Draft live|Draft starting soon/ })).toHaveLength(0);
});

test('a league whose draft is in progress shows the Draft live card with a Join draft link', async () => {
  mockApi({ leagues: [league({ id: 6, name: 'Night League', draft_status: 'active', draft_date: inFromNow(-HOUR) })] });
  renderPage();

  const card = await screen.findByRole('region', { name: 'Draft live' });
  expect(within(card).getByRole('heading', { level: 2, name: 'Draft live' })).toBeInTheDocument();
  expect(within(card).getByText('Night League')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Join draft' })).toHaveAttribute('href', '/league/6/draft');
  expect(screen.queryByRole('heading', { level: 2, name: 'Next draft' })).not.toBeInTheDocument();
});

// The Grid item around a region, and the `order` its emotion class declares at
// xs (jsdom does not evaluate media queries, so read the declared CSS).
// eslint-disable-next-line testing-library/no-node-access
const gridItem = (region) => region.closest('.MuiGrid2-root');
const declaredStyle = (element) => {
  const classes = Array.from(element.classList).filter((c) => c.startsWith('css-'));
  return Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .flatMap((rule) => (rule.cssRules ? Array.from(rule.cssRules) : [rule]))
    .filter((rule) => classes.some((cls) => rule.selectorText === `.${cls}`))
    .map((rule) => rule.style.cssText)
    .join(';');
};

test('on draft night (live or late) the draft card leads the to-do list on a phone and sits right of it at lg', async () => {
  mockApi({ leagues: [league({ id: 6, name: 'Night League', draft_status: 'active', draft_date: inFromNow(-HOUR) })] });
  renderPage();

  const card = gridItem(await screen.findByRole('region', { name: 'Draft live' }));
  const queue = gridItem(await findQueue());
  expect(card.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(declaredStyle(card)).toMatch(/order: 0/);
  expect(declaredStyle(card)).toMatch(/order: 2/);
  expect(declaredStyle(queue)).toMatch(/order: 1/);
});

test('a late draft leads on a phone too', async () => {
  mockApi({ leagues: [league({ id: 5, name: 'Late League', draft_date: inFromNow(-2 * HOUR) })] });
  renderPage();

  const card = gridItem(await screen.findByRole('region', { name: 'Draft starting soon' }));
  expect(card.compareDocumentPosition(gridItem(await findQueue())) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('a scheduled draft keeps the to-do list first and sets no order', async () => {
  mockApi({ leagues: [league({ id: 2, name: 'Dynasty Startup', draft_date: inFromNow(6 * 24 * HOUR) })] });
  renderPage();

  const card = gridItem(await screen.findByRole('region', { name: 'Next draft' }));
  const queue = gridItem(await findQueue());
  expect(queue.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(declaredStyle(card)).not.toMatch(/order:/);
  expect(declaredStyle(queue)).not.toMatch(/order:/);
});

test('a pre-draft league 2 hours past its draft date shows Draft starting soon', async () => {
  mockApi({ leagues: [league({ id: 5, name: 'Late League', draft_date: inFromNow(-2 * HOUR) })] });
  renderPage();

  const card = await screen.findByRole('region', { name: 'Draft starting soon' });
  expect(within(card).getByText('Late League')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Open Draft Room' })).toHaveAttribute('href', '/league/5/draft');
});

test('a league 30 days past its draft date is not featured; the one drafting in 2 hours is', async () => {
  mockApi({
    leagues: [
      league({ id: 1, name: 'Stale League', draft_date: inFromNow(-30 * 24 * HOUR) }),
      league({ id: 2, name: 'Soon League', draft_date: inFromNow(2 * HOUR) }),
    ],
  });
  renderPage();

  const card = await screen.findByRole('region', { name: 'Next draft' });
  expect(within(card).getByText('Soon League')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Draft starting soon' })).not.toBeInTheDocument();
});

// Draft night: the live card always keeps the filled button; the to-do row for
// the same league goes quiet and the primary moves to the first other row.
test('the live card stays primary, its to-do row goes quiet, and the first other row is primary', async () => {
  const live = league({ id: 6, name: 'Night League', draft_status: 'active' });
  const draftRow = item({
    id: 'draft_live:6', type: 'draft_live', leagueId: 6, leagueName: 'Night League', title: 'Your draft is live',
    severity: 'blocking', cta: { label: 'Join draft', to: '/league/6/draft' },
  });
  const other = item({ id: 'x', title: 'Fill your empty FLEX', cta: { label: 'Fix lineup', to: '/league/71/lineup' } });
  mockApi({ leagues: [live], actionItems: actionItemsBody([draftRow, other]) });
  const { unmount } = renderPage();
  const queue = await findQueue();
  await within(queue).findByText('Your draft is live');
  const card = within(screen.getByRole('region', { name: 'Draft live' })).getByRole('link', { name: 'Join draft' });
  expect(card).toHaveClass('MuiButton-contained');
  expect(within(queue).getByRole('link', { name: 'Join draft' })).toHaveClass('MuiButton-outlined');
  expect(within(queue).getByRole('link', { name: 'Fix lineup' })).toHaveClass('MuiButton-contained');
  unmount();

  // Without the draft card (the only league is stale, so none is featured), row 0 stays primary.
  mockApi({ leagues: [league({ id: 1, draft_date: inFromNow(-30 * 24 * HOUR) })], actionItems: actionItemsBody([draftRow, other]) });
  renderPage();
  const queue2 = await findQueue();
  await within(queue2).findByText('Your draft is live');
  expect(within(queue2).getByRole('link', { name: 'Join draft' })).toHaveClass('MuiButton-contained');
  expect(within(queue2).getByRole('link', { name: 'Fix lineup' })).toHaveClass('MuiButton-outlined');
});

// --- Draft-night freshness (fake timers) -------------------------------------

describe('draft-night refetch', () => {
  const { setImmediate: realSetImmediate } = jest.requireActual('timers');
  const leagueCalls = () => apiClient.get.mock.calls.filter(([url]) => url === '/api/league').length;
  const advance = (ms) => act(async () => {
    jest.advanceTimersByTime(ms);
    // A real macrotask lets the refetch's whole promise chain settle inside the act scope.
    await new Promise((resolve) => { realSetImmediate(resolve); });
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    delete document.hidden;
    jest.useRealTimers();
  });

  const setHidden = (hidden) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const lateDate = () => new Date(Date.now() - 2 * HOUR).toISOString();

  test('a scheduled draft whose time passes goes late on the refetch, then polls every 30 seconds', async () => {
    const draftDate = new Date(Date.now() + 60 * 1000).toISOString();
    mockApi({
      // A fresh array per call (a new reference, so React renders), still pending: the draft is late.
      leagues: () => [league({ id: 2, draft_date: draftDate, draft_status: 'pending' })],
    });
    renderPage();
    await screen.findByRole('region', { name: 'Next draft' });
    expect(leagueCalls()).toBe(1);

    // The countdown expires at 60s; the refetch follows 5s later.
    await advance(59 * 1000);
    expect(leagueCalls()).toBe(1);
    await advance(7 * 1000);
    expect(leagueCalls()).toBe(2);
    expect(await screen.findByRole('region', { name: 'Draft starting soon' })).toBeInTheDocument();

    await advance(29 * 1000);
    expect(leagueCalls()).toBe(2);
    await advance(1000);
    expect(leagueCalls()).toBe(3);
  });

  test('a scheduled draft whose time passes triggers exactly one leagues refetch', async () => {
    const draftDate = new Date(Date.now() + 60 * 1000).toISOString();
    mockApi({
      // The server auto-starts the draft at its time: the refetch finds it live.
      leagues: () => [league({ id: 2, draft_date: draftDate, draft_status: leagueCalls() > 1 ? 'active' : 'pending' })],
    });
    renderPage();
    await screen.findByRole('region', { name: 'Next draft' });
    expect(leagueCalls()).toBe(1);

    await advance(59 * 1000);
    expect(leagueCalls()).toBe(1);
    await advance(7 * 1000);
    expect(leagueCalls()).toBe(2);
    expect(await screen.findByRole('region', { name: 'Draft live' })).toBeInTheDocument();
    // A live draft needs no further refetch.
    await advance(5 * 60 * 1000);
    expect(leagueCalls()).toBe(2);
  });

  test('a late draft refetches leagues every 30 seconds, keeps the list up and stops on unmount', async () => {
    let calls = 0;
    mockApi({
      leagues: () => {
        calls += 1;
        return calls === 2 ? 'pending' : [league({ id: 5, name: 'Late League', draft_date: new Date(Date.now() - 2 * HOUR).toISOString() })];
      },
    });
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Draft starting soon' });
    expect(leagueCalls()).toBe(1);

    await advance(29 * 1000);
    expect(leagueCalls()).toBe(1);
    await advance(1000);
    expect(leagueCalls()).toBe(2);
    // The refetch is in flight: the cards stay and no skeleton stands in.
    expect(screen.queryAllByTestId('league-skeleton')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Draft starting soon' })).toBeInTheDocument();
    expect(screen.getAllByText('Late League').length).toBeGreaterThan(0);

    await advance(30 * 1000);
    expect(leagueCalls()).toBe(3);

    unmount();
    await advance(120 * 1000);
    expect(leagueCalls()).toBe(3);
  });

  test('a failing poll tick shows no alert, keeps the list, and the next tick retries', async () => {
    let calls = 0;
    mockApi({
      leagues: () => {
        calls += 1;
        return calls === 2 ? new Error('boom') : [league({ id: 5, name: 'Late League', draft_date: lateDate() })];
      },
    });
    renderPage();
    await screen.findByRole('region', { name: 'Draft starting soon' });

    await advance(30 * 1000);
    expect(leagueCalls()).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Late League').length).toBeGreaterThan(0);

    await advance(30 * 1000);
    expect(leagueCalls()).toBe(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a hidden tab skips the late poll and refetches once when shown again', async () => {
    mockApi({ leagues: () => [league({ id: 5, draft_date: lateDate() })] });
    renderPage();
    await screen.findByRole('region', { name: 'Draft starting soon' });

    setHidden(true);
    await advance(2 * 60 * 1000);
    expect(leagueCalls()).toBe(1);
    // Hiding itself fires visibilitychange too: still no request.
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(leagueCalls()).toBe(1);

    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => { realSetImmediate(resolve); });
    });
    expect(leagueCalls()).toBe(2);
  });

  test('a late draft whose auto-start failed polls every 2 minutes, not 30 seconds', async () => {
    mockApi({ leagues: () => [league({ id: 5, draft_date: lateDate(), draft_autostart_failed: true })] });
    renderPage();
    await screen.findByRole('region', { name: 'Draft starting soon' });

    await advance(119 * 1000);
    expect(leagueCalls()).toBe(1);
    await advance(1000);
    expect(leagueCalls()).toBe(2);
    await advance(2 * 60 * 1000);
    expect(leagueCalls()).toBe(3);
  });

  test('a live draft sets no refetch timer', async () => {
    mockApi({ leagues: [league({ id: 6, draft_status: 'active' })] });
    renderPage();
    await screen.findByRole('region', { name: 'Draft live' });
    await advance(5 * 60 * 1000);
    expect(leagueCalls()).toBe(1);
  });

  test('the late card says the draft did not start on its own only when auto-start failed', async () => {
    const lateDate = () => new Date(Date.now() - 2 * HOUR).toISOString();
    mockApi({ leagues: [league({ id: 5, draft_date: lateDate(), draft_autostart_failed: true })] });
    const { unmount } = renderPage();
    const card = await screen.findByRole('region', { name: 'Draft starting soon' });
    expect(within(card).getByText("The draft didn't start on its own. It starts when the commissioner begins it.")).toBeInTheDocument();
    unmount();

    mockApi({ leagues: [league({ id: 5, draft_date: lateDate(), draft_autostart_failed: false })] });
    renderPage();
    const plain = await screen.findByRole('region', { name: 'Draft starting soon' });
    expect(within(plain).getByText('Your draft is about to start.')).toBeInTheDocument();
    expect(within(plain).queryByText(/didn't start on its own/)).not.toBeInTheDocument();
  });
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
