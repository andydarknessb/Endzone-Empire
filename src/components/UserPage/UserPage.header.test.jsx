import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// Home v2 review fixes: the greeting header as Main.dc.html draws it. Under
// the h1, a summary line built from the to-do list response ActionQueue
// already fetches (no second request), a stat strip from the leagues list's
// status blocks, and a live chip counting live matchups. The seam is the page:
// UserPage rendered with apiClient mocked by URL.

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const actionItemsBody = (items, counts = {}, extra = {}) => ({
  generatedAt: new Date().toISOString(),
  counts: { total: items.length, dueToday: 0, ...counts },
  partial: [],
  items,
  ...extra,
});

const item = (overrides = {}) => ({
  id: `lineup_problem:${Math.random()}`,
  type: 'lineup_problem',
  leagueId: 71,
  leagueName: 'Winsconsota',
  title: 'Fill your empty FLEX before the late games',
  detail: null,
  severity: 'timed',
  deadlineAt: null,
  cta: { label: 'Fix lineup', to: '/league/71/lineup' },
  progress: null,
  ...overrides,
});

const fantasyStatus = (overrides = {}) => ({
  phase: 'in-season',
  week: 4,
  record: { wins: 3, losses: 1, ties: 0 },
  standing: { rank: 4, of: 10 },
  matchup: {
    id: 912,
    status: 'live',
    opponent: { teamId: 488, name: 'Frozen Tundra FC' },
    my: { score: 87.4, expectedFinal: 118.6, playersRemaining: 4 },
    opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 3 },
    winProbability: null,
  },
  ...overrides,
});

const fantasyLeague = (id, name, statusOverrides = {}, rowOverrides = {}) => ({
  id,
  name,
  my_team_id: id * 10,
  my_team_name: `${name} Team`,
  draft_status: 'complete',
  season_status: 'regular',
  current_week: 4,
  owner_id: 2,
  is_owner: false,
  is_commissioner: false,
  scoring_preset: 'ppr',
  team_count: 10,
  max_teams: 10,
  status: fantasyStatus(statusOverrides),
  statusError: false,
  ...rowOverrides,
});

// `actionItems` is a body, an Error (rejects) or 'pending' (never settles).
const mockApi = ({ leagues = [], actionItems = actionItemsBody([]) } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/user/action-items') {
      if (actionItems === 'pending') return new Promise(() => {});
      if (actionItems instanceof Error) return Promise.reject(actionItems);
      return Promise.resolve({ data: actionItems });
    }
    if (url === '/api/league') return Promise.resolve({ data: leagues });
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications: [], unread: 0 } });
    if (url === '/api/public/rankings') return Promise.resolve({ data: { rankings: [] } });
    if (url === '/api/public/recaps') return Promise.resolve({ data: { recaps: [] } });
    return Promise.resolve({ data: [] });
  });
};

const renderPage = () => renderWithProviders(<UserPage />, { state: baseState });
const header = () => within(screen.getByTestId('dashboard-hero'));
const findQueue = () => screen.findByRole('region', { name: /Needs your attention/ });
const summaryLine = () => screen.queryByTestId('greeting-summary');

// Each tile of the stat strip as [term, definition] text.
const statTiles = () => {
  const strip = screen.getByTestId('greeting-stats');
  const terms = within(strip).getAllByRole('term').map((el) => el.textContent);
  const values = within(strip).getAllByRole('definition').map((el) => el.textContent);
  return terms.map((term, i) => [term, values[i]]);
};

const declaredStyle = (element) => {
  const classes = Array.from(element.classList).filter((c) => c.startsWith('css-'));
  return Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule) => classes.some((cls) => rule.selectorText === `.${cls}`))
    .map((rule) => rule.style.cssText)
    .join(';');
};

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

// A deadline later today (a minute from now, but never past midnight).
const laterToday = () => {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 0, 0);
  return new Date(Math.min(Date.now() + 60 * 1000, endOfDay.getTime())).toISOString();
};

afterEach(() => {
  jest.clearAllMocks();
});

// --- Summary line ----------------------------------------------------------

test('the summary line counts what needs the manager, what is due today and when the first thing locks', async () => {
  const first = laterToday();
  const later = new Date(new Date(first).getTime() + 30 * 1000).toISOString();
  mockApi({
    actionItems: actionItemsBody(
      [
        item({ id: 'a', type: 'draft_live', deadlineAt: new Date().toISOString(), severity: 'blocking' }),
        item({ id: 'b', deadlineAt: later }),
        item({ id: 'c', type: 'picks_open', deadlineAt: first }),
        item({ id: 'd', type: 'trade_offer', deadlineAt: null, severity: 'untimed' }),
        item({ id: 'e', type: 'join_requests', deadlineAt: null, severity: 'untimed' }),
      ],
      { total: 5, dueToday: 2 },
    ),
  });
  renderPage();

  expect(await screen.findByText(`5 things need you. 2 are due today, and the first locks at ${timeFormat.format(new Date(first))}.`))
    .toBeInTheDocument();
  // One request: the header reads the list ActionQueue fetched.
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/api/user/action-items')).toHaveLength(1);
});

test('the summary line reads in the singular for one thing, and leaves the due-today clause out when nothing is due today', async () => {
  mockApi({ actionItems: actionItemsBody([item({ type: 'trade_offer', severity: 'untimed' })], { total: 1, dueToday: 0 }) });
  renderPage();

  expect(await screen.findByText('1 thing needs you.')).toBeInTheDocument();
});

test('one thing due today reads "it locks", not "the first locks"', async () => {
  const at = laterToday();
  mockApi({ actionItems: actionItemsBody([item({ deadlineAt: at })], { total: 1, dueToday: 1 }) });
  renderPage();

  expect(await screen.findByText(`1 thing needs you. 1 is due today, and it locks at ${timeFormat.format(new Date(at))}.`))
    .toBeInTheDocument();
});

test('an empty to-do list makes the summary line "You\'re all caught up."', async () => {
  mockApi({ actionItems: actionItemsBody([]) });
  renderPage();

  expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
});

test('the summary line counts the uncapped total, not the 20 rows served', async () => {
  mockApi({ actionItems: actionItemsBody([item()], { total: 23, dueToday: 0 }) });
  renderPage();

  expect(await screen.findByText('23 things need you.')).toBeInTheDocument();
});

test('the summary line is left out while the to-do list loads', async () => {
  mockApi({ actionItems: 'pending' });
  renderPage();

  await findQueue();
  expect(summaryLine()).not.toBeInTheDocument();
});

test('the summary line is left out when the to-do list fails', async () => {
  mockApi({ actionItems: new Error('boom') });
  renderPage();

  const queue = await findQueue();
  await within(queue).findByText("We couldn't load your to-do list.");
  expect(summaryLine()).not.toBeInTheDocument();
});

test('the summary line does not claim all caught up when some item types could not be checked', async () => {
  mockApi({ actionItems: actionItemsBody([], {}, { partial: ['trade_review'] }) });
  renderPage();

  const queue = await findQueue();
  await within(queue).findByText("Some of your to-do list couldn't be checked right now.");
  expect(summaryLine()).not.toBeInTheDocument();
});

// --- Stat strip ------------------------------------------------------------

test('the stat strip is a description list: league count, summed fantasy record and best standing', async () => {
  mockApi({
    leagues: [
      fantasyLeague(71, 'Winsconsota', { record: { wins: 3, losses: 1, ties: 0 }, standing: { rank: 4, of: 10 } }),
      fantasyLeague(72, 'MinneApple', { record: { wins: 2, losses: 0, ties: 1 }, standing: { rank: 2, of: 12 } }),
    ],
  });
  renderPage();

  await screen.findByRole('article', { name: 'Winsconsota' });
  expect(screen.getByTestId('greeting-stats').tagName).toBe('DL');
  expect(statTiles()).toEqual([
    ['Leagues', '2'],
    ['Fantasy record', '5-1-1'],
    ['Best standing', '2nd of 12'],
  ]);
});

test('a fantasy record with no ties reads wins-losses with a hyphen', async () => {
  mockApi({
    leagues: [
      fantasyLeague(71, 'Winsconsota', { record: { wins: 3, losses: 1, ties: 0 } }),
      fantasyLeague(72, 'MinneApple', { record: { wins: 2, losses: 0, ties: 0 } }),
    ],
  });
  renderPage();

  await screen.findByRole('article', { name: 'Winsconsota' });
  expect(statTiles()).toContainEqual(['Fantasy record', '5-1']);
});

test('the stat strip leaves out a tile it has no data for', async () => {
  mockApi({
    leagues: [
      { id: 3, name: 'Sunday Ballers', my_team_name: "alice's Team", draft_status: 'pending', owner_id: 1 },
    ],
  });
  renderPage();

  await screen.findByText('Sunday Ballers');
  expect(statTiles()).toEqual([['Leagues', '1']]);
});

test('with no leagues there is no stat strip', async () => {
  mockApi({ leagues: [] });
  renderPage();

  await screen.findByTestId('leagues-empty-state');
  expect(screen.queryByTestId('greeting-stats')).not.toBeInTheDocument();
});

// --- Live chip -------------------------------------------------------------

test('the live chip counts live matchups, with its dot hidden from assistive tech', async () => {
  mockApi({
    leagues: [
      fantasyLeague(71, 'Winsconsota'),
      fantasyLeague(72, 'MinneApple'),
      fantasyLeague(73, 'Lake Effect League', { matchup: { ...fantasyStatus().matchup, status: 'final' } }),
    ],
  });
  renderPage();

  await screen.findByRole('article', { name: 'Winsconsota' });
  const chip = header().getByTestId('live-matchups-chip');
  expect(chip).toHaveTextContent('2 matchups live');
  expect(within(chip).getByTestId('live-dot')).toHaveAttribute('aria-hidden', 'true');
});

test('one live matchup reads in the singular', async () => {
  mockApi({ leagues: [fantasyLeague(71, 'Winsconsota')] });
  renderPage();

  await screen.findByRole('article', { name: 'Winsconsota' });
  expect(header().getByTestId('live-matchups-chip')).toHaveTextContent('1 matchup live');
});

test('there is no live chip when no matchup is live', async () => {
  mockApi({ leagues: [fantasyLeague(71, 'Winsconsota', { matchup: { ...fantasyStatus().matchup, status: 'scheduled' } })] });
  renderPage();

  await screen.findByRole('article', { name: 'Winsconsota' });
  expect(header().queryByTestId('live-matchups-chip')).not.toBeInTheDocument();
});

// --- Sentence case and touch targets ---------------------------------------

test('the header buttons and the leagues heading are in sentence case', async () => {
  mockApi({ leagues: [fantasyLeague(71, 'Winsconsota')] });
  renderPage();

  await screen.findByRole('article', { name: 'Winsconsota' });
  expect(header().getByRole('button', { name: 'Create league' })).toBeInTheDocument();
  expect(header().getByRole('button', { name: 'Join league' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'My leagues' })).toBeInTheDocument();
});

test('the Around the League quick links clear the 44px touch target floor', async () => {
  mockApi();
  renderPage();

  const section = await screen.findByRole('region', { name: 'Around the League' });
  ['Rankings', 'Waiver Wire', 'Strategy', 'Recaps'].forEach((name) => {
    expect(declaredStyle(within(section).getByRole('link', { name }))).toMatch(/min-height: 44px/);
  });
});
