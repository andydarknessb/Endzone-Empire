import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { invalidate } from '../../lib/resourceCache';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// The real ActionQueue renders over the mocked apiClient: it reads the action items and hands the page
// the body and the plays the greeting counts.

// The greeting header as build-main.js draws it: the h1, one status line
// ("Week N · Weekday, Mon D · summary") built from the action items response
// ActionQueue already read (no second request), and a live chip counting
// live matchups. The seam is the page: UserPage rendered with apiClient mocked
// by URL.

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

// `actionItems` is the body GET /api/user/action-items returns (null: the read fails).
// A manager with at least one league by default: with none, Home is the first-run
// state and shows no summary line (#2305).
const mockApi = ({ leagues = [fantasyLeague(1, 'Default League', { matchup: null })], actionItems = actionItemsBody([]) } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/user/action-items')) {
      return actionItems ? Promise.resolve({ data: actionItems }) : Promise.reject(new Error('action items failed'));
    }
    if (url === '/api/league') return Promise.resolve({ data: leagues });
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications: [], unread: 0 } });
    return Promise.resolve({ data: [] });
  });
};

const renderPage = () => renderWithProviders(<UserPage />, { state: baseState });
const header = () => within(screen.getByTestId('dashboard-hero'));
const summaryLine = () => screen.queryByTestId('greeting-summary');
const findHeader = () => screen.findByRole('region', { name: /^(My leagues|Live scores)$/ });

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

// A deadline later today (a minute from now, but never past midnight).
const laterToday = () => {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 0, 0);
  return new Date(Math.min(Date.now() + 60 * 1000, endOfDay.getTime())).toISOString();
};

beforeEach(() => { invalidate(undefined, { reload: false }); });
afterEach(() => {
  jest.clearAllMocks();
});

// --- h1 and status line ----------------------------------------------------

test('the page has one h1, "Welcome back, <username>", in the pixel face', async () => {
  mockApi();
  renderPage();

  await findHeader();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveTextContent('Welcome back, alice');
  expect(h1).toHaveStyle({ textTransform: 'uppercase', lineHeight: '1.3' });
});

test('the status line carries the week, the date and the summary, each only when it has something to say', async () => {
  mockApi({ leagues: [fantasyLeague(1, 'Winsconsota', { matchup: null })], actionItems: actionItemsBody([]) });
  renderPage();

  await findHeader();
  expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  expect(header().getByText(`Week 4 · ${dateFormat.format(new Date())}`)).toBeInTheDocument();
  // the summary's wrapping paragraph has no role or name of its own
  // eslint-disable-next-line testing-library/no-node-access
  expect(screen.getByTestId('greeting-summary').closest('p')).toHaveTextContent(
    `Week 4 · ${dateFormat.format(new Date())} · You're all caught up.`
  );
});

test('with leagues in different weeks the week part is left out and the summary stands alone', async () => {
  mockApi({
    leagues: [
      fantasyLeague(1, 'Winsconsota', { matchup: null }),
      fantasyLeague(2, 'MinneApple', { matchup: null }, { current_week: 5 }),
    ],
    actionItems: actionItemsBody([]),
  });
  renderPage();

  await findHeader();
  expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  expect(header().queryByText(/^Week /)).not.toBeInTheDocument();
});

test('no status line at all when there is no week and no summary', async () => {
  mockApi({ leagues: [{ id: 3, name: 'Sunday Ballers', my_team_id: 30, draft_status: 'pending' }], actionItems: null });
  renderPage();

  await findHeader();
  expect(summaryLine()).not.toBeInTheDocument();
  // the hero's paragraphs have no role or name of their own
  const hero = screen.getByTestId('dashboard-hero');
  // eslint-disable-next-line testing-library/no-node-access
  expect(hero.querySelector('p')).toBeNull();
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
        item({ id: 'c', type: 'picks_open', title: 'Pick the week', deadlineAt: first }),
        item({ id: 'd', type: 'trade_offer', deadlineAt: null, severity: 'untimed' }),
        item({ id: 'e', type: 'join_requests', deadlineAt: null, severity: 'untimed' }),
      ],
      { total: 5, dueToday: 2 }, // the server counts a join request; it is not a play
    ),
  });
  renderPage();

  expect(await screen.findByText(`4 things need you. 2 are due today. First up: Pick the week, at ${timeFormat.format(new Date(first))}.`))
    .toBeInTheDocument();
});

test('the summary line reads in the singular for one thing, and leaves the due-today clause out when nothing is due today', async () => {
  mockApi({ actionItems: actionItemsBody([item({ type: 'trade_offer', severity: 'untimed' })], { total: 1, dueToday: 0 }) });
  renderPage();

  expect(await screen.findByText('1 thing needs you.')).toBeInTheDocument();
});

test('one thing due today names the item and its lock time', async () => {
  const at = laterToday();
  mockApi({ actionItems: actionItemsBody([item({ title: 'Fill your FLEX', deadlineAt: at })], { total: 1, dueToday: 1 }) });
  renderPage();

  expect(await screen.findByText(`1 thing needs you. 1 is due today: Fill your FLEX, at ${timeFormat.format(new Date(at))}.`))
    .toBeInTheDocument();
});

test('the summary line names a blocking item over an earlier info item (the info row is not a play)', async () => {
  const first = laterToday();
  const later = new Date(new Date(first).getTime() + 30 * 1000).toISOString();
  mockApi({
    actionItems: actionItemsBody(
      [
        item({ id: 'a', title: 'Fill your FLEX', deadlineAt: later, severity: 'blocking' }),
        item({ id: 'b', type: 'waiver_claims', title: '1 waiver claim pending', deadlineAt: first, severity: 'info' }),
      ],
      { total: 2, dueToday: 2 },
    ),
  });
  renderPage();

  expect(await screen.findByText(`1 thing needs you. 1 is due today: Fill your FLEX, at ${timeFormat.format(new Date(later))}.`))
    .toBeInTheDocument();
});

test('without server counts the summary line leaves info items out of the total', async () => {
  mockApi({
    actionItems: {
      generatedAt: new Date().toISOString(),
      partial: [],
      items: [
        item({ id: 'a', type: 'trade_offer', severity: 'untimed' }),
        item({ id: 'b', type: 'waiver_claims', severity: 'info' }),
      ],
    },
  });
  renderPage();

  expect(await screen.findByText('1 thing needs you.')).toBeInTheDocument();
});

test('the summary line counts the plays on the cards, the same number as the badge, not the server total', async () => {
  mockApi({ actionItems: actionItemsBody([item()], { total: 23, dueToday: 0 }) });
  renderPage();

  expect(await screen.findByText('1 thing needs you.')).toBeInTheDocument();
});

test('the summary line is left out when the action items fail to load', async () => {
  mockApi({ actionItems: null });
  renderPage();

  await findHeader();
  expect(summaryLine()).not.toBeInTheDocument();
});

test('the summary line does not claim all caught up when some item types could not be checked', async () => {
  mockApi({ actionItems: actionItemsBody([], {}, { partial: ['trade_review'] }) });
  renderPage();

  await findHeader();
  expect(summaryLine()).not.toBeInTheDocument();
});

test('the page has no stat strip', async () => {
  mockApi();
  renderPage();

  await findHeader();
  expect(screen.queryByTestId('greeting-stats')).not.toBeInTheDocument();
  expect(screen.queryByText('Best standing')).not.toBeInTheDocument();
});

// --- Live chip -------------------------------------------------------------

test('the live chip counts live matchups, with its dot hidden from assistive tech, beside the status line', async () => {
  mockApi({
    leagues: [
      fantasyLeague(71, 'Winsconsota'),
      fantasyLeague(72, 'MinneApple'),
      fantasyLeague(73, 'Lake Effect League', { matchup: { ...fantasyStatus().matchup, status: 'final' } }),
    ],
  });
  renderPage();

  await findHeader();
  const chip = header().getByTestId('live-matchups-chip');
  expect(chip).toHaveTextContent('2 matchups live');
  // aria-hidden content is hidden from every role query
  // eslint-disable-next-line testing-library/no-node-access
  expect(chip.querySelector('[aria-hidden="true"]')).not.toBeNull();
});

test('one live matchup reads in the singular', async () => {
  mockApi({ leagues: [fantasyLeague(71, 'Winsconsota')] });
  renderPage();

  await findHeader();
  expect(header().getByTestId('live-matchups-chip')).toHaveTextContent('1 matchup live');
});

test('there is no live chip when no matchup is live', async () => {
  mockApi({ leagues: [fantasyLeague(71, 'Winsconsota', { matchup: { ...fantasyStatus().matchup, status: 'scheduled' } })] });
  renderPage();

  await findHeader();
  expect(header().queryByTestId('live-matchups-chip')).not.toBeInTheDocument();
});

test('a league row that failed its status read is not a live matchup', async () => {
  mockApi({ leagues: [fantasyLeague(71, 'Winsconsota', {}, { statusError: true })] });
  renderPage();

  await findHeader();
  expect(header().queryByTestId('live-matchups-chip')).not.toBeInTheDocument();
});
