import React from 'react';
import { screen, act, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { invalidate } from '../../lib/resourceCache';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// The whole Home page with nothing stubbed: the real ActionQueue and
// LeagueStatusGrid over a mocked apiClient. The per-component files test each
// piece alone; this is where the page-level promises are bound: one cursor and
// one filled foot on the whole page, the greeting and the badge agreeing, and
// the game-day refresh reaching both reads.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const fantasyLeague = (id, name, matchup, rowOverrides = {}) => ({
  id,
  name,
  my_team_id: id * 10,
  my_team_name: `${name} Team`,
  draft_status: 'complete',
  season_status: 'regular',
  current_week: 4,
  owner_id: 2,
  is_owner: false,
  team_count: 10,
  max_teams: 10,
  scoring_preset: 'ppr',
  status: {
    phase: 'in-season',
    week: 4,
    record: { wins: 3, losses: 1, ties: 0 },
    standing: { rank: 4, of: 10 },
    matchup,
  },
  statusError: false,
  ...rowOverrides,
});

const liveMatchup = {
  id: 912,
  status: 'live',
  opponent: { teamId: 488, name: 'Frozen Tundra FC' },
  my: { score: 87.4, expectedFinal: 118.6, playersRemaining: 4 },
  opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 3 },
  winProbability: null,
};
const scheduledMatchup = {
  id: 913,
  status: 'scheduled',
  opponent: { teamId: 489, name: 'Gridiron Ghosts' },
  my: { score: 0, expectedFinal: 105.9, playersRemaining: 9 },
  opp: { score: 0, expectedFinal: 98.4, playersRemaining: 9 },
  winProbability: null,
};

const pickemLeague = (id, name) => ({
  id,
  name,
  my_team_id: id * 10,
  draft_status: 'complete',
  season_status: 'regular',
  current_week: 4,
  owner_id: 2,
  scoring_preset: 'pickem_confidence',
  status: { phase: 'in-season', week: 4, pickem: { picksMade: 0, picksTotal: 14 } },
  statusError: false,
});

const item = (overrides = {}) => ({
  id: 'lineup_problem:71:2026-4',
  type: 'lineup_problem',
  leagueId: 71,
  leagueName: 'Thursday Night Regulars',
  title: 'Fill your empty FLEX slot',
  detail: '3 bench players are still to play',
  severity: 'timed',
  deadlineAt: null,
  cta: { label: 'Fix lineup', to: '/league/71/lineup' },
  progress: null,
  ...overrides,
});
const picks = (id, name, lock) => item({
  id: `picks_open:${id}:2026-4`,
  type: 'picks_open',
  leagueId: id,
  leagueName: name,
  title: '14 picks still open',
  deadlineAt: lock,
  cta: { label: 'Make picks', to: `/league/${id}/pickem` },
  progress: { done: 0, total: 14, open: 14 },
});
const waiver = () => item({
  id: 'waiver_claims:71',
  type: 'waiver_claims',
  title: '1 waiver claim pending',
  severity: 'info',
  deadlineAt: new Date(Date.now() + 30 * HOUR).toISOString(),
  cta: { label: 'View claims', to: '/league/71/waivers' },
});

const mockApi = ({ leagues, items }) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: leagues });
    if (url.startsWith('/api/user/action-items')) {
      return Promise.resolve({
        data: {
          generatedAt: new Date().toISOString(), counts: { total: items.length, dueToday: 0 }, partial: [], items,
        },
      });
    }
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications: [], unread: 0 } });
    return Promise.resolve({ data: [] });
  });
};
const reads = (url) => apiClient.get.mock.calls.filter(([u]) => u.startsWith(url)).length;
const setHidden = (hidden) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

const renderPage = () => renderWithProviders(<UserPage />, { state: baseState });
// The page-wide guard: Play-select has one cursor and one filled action.
const oneCursorOneFilled = (container) => {
  // eslint-disable-next-line testing-library/no-node-access -- the cursor and the filled foot are classes and a data attribute, not roles
  expect(container.querySelectorAll('.cursor')).toHaveLength(1);
  // eslint-disable-next-line testing-library/no-node-access
  expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(1);
};

beforeEach(() => { invalidate(undefined, { reload: false }); });
afterEach(() => {
  jest.useRealTimers();
  setHidden(false);
  jest.clearAllMocks();
});

test('main: picks in two leagues share a lock, a waiver claim waits on the sideline, fantasy leagues are scheduled: one cursor, one filled foot', async () => {
  const lock = new Date(Date.now() + 26 * HOUR).toISOString();
  mockApi({
    leagues: [fantasyLeague(71, 'Thursday Night Regulars', scheduledMatchup), fantasyLeague(72, 'Office League', null), pickemLeague(5, "Sunday Pick'em")],
    items: [picks(5, "Sunday Pick'em", lock), picks(71, 'Thursday Night Regulars', lock), waiver()],
  });
  const { container } = renderPage();

  await screen.findByRole('group', { name: /^Next up: Picks\./ });
  await screen.findByRole('heading', { level: 2, name: 'My leagues' });
  expect(screen.getByText('Office League')).toBeInTheDocument();
  oneCursorOneFilled(container);
});

test('the greeting and the badge give the same number: picks in two leagues are one play, plus a lineup problem makes 2', async () => {
  const lock = new Date(Date.now() + 26 * HOUR).toISOString();
  mockApi({
    leagues: [fantasyLeague(71, 'Thursday Night Regulars', scheduledMatchup), pickemLeague(5, "Sunday Pick'em")],
    items: [
      picks(5, "Sunday Pick'em", lock),
      picks(71, 'Thursday Night Regulars', lock),
      item({ deadlineAt: new Date(Date.now() + 5 * HOUR).toISOString() }),
    ],
  });
  renderPage();

  const region = await screen.findByRole('region', { name: 'Call your plays' });
  expect(await within(region).findByText('2 things need you')).toBeInTheDocument();
  expect(await screen.findByTestId('greeting-summary')).toHaveTextContent(/^2 things need you\./);
});

test('a lineup problem and a picks_open sharing one lock are one Play card with two feet, and the greeting counts 1', async () => {
  const lock = new Date(Date.now() + 5 * HOUR).toISOString();
  mockApi({
    leagues: [fantasyLeague(71, 'Thursday Night Regulars', scheduledMatchup)],
    items: [item({ deadlineAt: lock }), picks(71, 'Thursday Night Regulars', lock)],
  });
  renderPage();

  const region = await screen.findByRole('region', { name: 'Call your plays' });
  const card = await within(region).findByRole('group', { name: /^Next up: Lineup and picks./ });
  const feet = within(card).getAllByRole('link');
  expect(feet).toHaveLength(2);
  expect(feet[0]).toHaveTextContent('Fix lineup');
  expect(feet[1]).toHaveTextContent('Make picks');
  expect(within(region).getAllByRole('group')).toHaveLength(1);
  expect(within(region).getByText('1 thing needs you')).toBeInTheDocument();
  expect(await screen.findByTestId('greeting-summary')).toHaveTextContent(/^1 thing needs you./);
});

test('a failed refetch leaves the Plays on screen', async () => {
  jest.useFakeTimers();
  const lock = new Date(Date.now() + 5 * HOUR).toISOString();
  mockApi({
    leagues: [fantasyLeague(71, 'Thursday Night Regulars', liveMatchup)],
    items: [item({ deadlineAt: lock })],
  });
  const answer = apiClient.get.getMockImplementation();
  renderPage();
  expect(await screen.findByRole('link', { name: /^Next up: Fill your empty FLEX slot/ })).toBeInTheDocument();

  // Game day re-reads the Plays every 60 s; this time that read fails.
  apiClient.get.mockImplementation((url) => (url.startsWith('/api/user/action-items') ? Promise.reject(new Error('down')) : answer(url)));
  await act(async () => { jest.advanceTimersByTime(60 * 1000); });
  expect(reads('/api/user/action-items')).toBe(2);
  expect(screen.getByRole('link', { name: /^Next up: Fill your empty FLEX slot/ })).toBeInTheDocument();
  expect(screen.queryByRole('alert', { name: /what needs you/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn't check what needs you")).not.toBeInTheDocument();
});

test('"due today" counts the plays whose lock falls on today: two picks sharing today\'s lock and a lineup problem tomorrow', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 15, 15, 0, 0));
  const lock = new Date(2026, 9, 15, 18, 0, 0).toISOString();
  mockApi({
    leagues: [fantasyLeague(71, 'Thursday Night Regulars', scheduledMatchup), pickemLeague(5, "Sunday Pick'em")],
    items: [
      picks(5, "Sunday Pick'em", lock),
      picks(71, 'Thursday Night Regulars', lock),
      item({ deadlineAt: new Date(2026, 9, 16, 18, 0, 0).toISOString() }),
    ],
  });
  renderPage();

  expect(await screen.findByTestId('greeting-summary')).toHaveTextContent(/^2 things need you\. 1 is due today: Picks, at 6:00 PM\.$/);
});

test('the greeting follows the same clock as the badge: when a seats_open lock passes, both drop to the same number', async () => {
  jest.useFakeTimers();
  const draftLeague = {
    id: 4, name: 'Late League', my_team_id: 40, draft_status: 'pending', is_owner: true, draft_date: new Date(Date.now() + 2 * HOUR).toISOString(),
  };
  mockApi({
    leagues: [fantasyLeague(71, 'Thursday Night Regulars', scheduledMatchup), draftLeague],
    items: [
      item({
        id: 'seats_open:4', type: 'seats_open', leagueId: 4, leagueName: 'Late League', title: 'Fill the empty seats', deadlineAt: new Date(Date.now() + 10 * MINUTE).toISOString(),
      }),
      item({ deadlineAt: new Date(Date.now() + 5 * HOUR).toISOString() }),
    ],
  });
  renderPage();

  const region = await screen.findByRole('region', { name: 'Call your plays' });
  expect(await within(region).findByText('3 things need you')).toBeInTheDocument();
  expect(await screen.findByTestId('greeting-summary')).toHaveTextContent(/^3 things need you\./);

  // The queue's clock re-arms after each render, so it is stepped, not jumped.
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { jest.advanceTimersByTime(MINUTE); });
  }
  expect(within(region).getByText('2 things need you')).toBeInTheDocument();
  expect(screen.getByTestId('greeting-summary')).toHaveTextContent(/^2 things need you\./);
});

describe('game day', () => {
  const gameDay = () => mockApi({
    leagues: [fantasyLeague(71, 'Thursday Night Regulars', liveMatchup), fantasyLeague(72, 'Office League', liveMatchup)],
    items: [item({ deadlineAt: new Date(Date.now() + 42 * MINUTE + 20 * 1000).toISOString() })],
  });

  test('two live matchups and a lineup problem 42 min out: one cursor, one filled foot, and after 60 s both reads run again', async () => {
    jest.useFakeTimers();
    gameDay();
    const { container } = renderPage();

    expect(await screen.findByText('2 matchups live')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^Next up: Fill your empty FLEX slot./ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Live scores' })).toBeInTheDocument();
    oneCursorOneFilled(container);
    expect(reads('/api/league')).toBe(1);
    expect(reads('/api/user/action-items')).toBe(1);

    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(reads('/api/league')).toBe(2);
    expect(reads('/api/user/action-items')).toBe(2);
    oneCursorOneFilled(container);
  });

  test("a pick'em-only manager with a game in progress is in game day: Live scores header and the 60 s refresh", async () => {
    jest.useFakeTimers();
    const league = pickemLeague(5, "Sunday Pick'em");
    league.pickem_only = true;
    league.status = { phase: 'in-season', week: 4, standing: { rank: 4, of: 12 }, pickem: { made: 9, total: 15, missing: 0, nextLockAt: null, inProgress: true, weekPoints: 23, finals: 2 } };
    mockApi({ leagues: [league], items: [] });
    renderPage();

    expect(await screen.findByRole('heading', { level: 2, name: 'Live scores' })).toBeInTheDocument();
    // A pick'em game is not a matchup: no chip.
    expect(screen.queryByTestId('live-matchups-chip')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(reads('/api/league')).toBe(2);
  });

  test("the live chip counts only matchups when a pick'em game is also in progress", async () => {
    jest.useFakeTimers();
    const league = pickemLeague(5, "Sunday Pick'em");
    league.status = { phase: 'in-season', week: 4, pickem: { made: 9, total: 15, missing: 0, nextLockAt: null, inProgress: true } };
    mockApi({ leagues: [fantasyLeague(71, 'Thursday Night Regulars', liveMatchup), league], items: [] });
    renderPage();

    expect(await screen.findByText('1 matchup live')).toBeInTheDocument();
  });

  test('a hidden tab makes no second request', async () => {
    jest.useFakeTimers();
    setHidden(true);
    gameDay();
    renderPage();

    expect(await screen.findByText('2 matchups live')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(reads('/api/league')).toBe(1);
    expect(reads('/api/user/action-items')).toBe(1);
  });
});
