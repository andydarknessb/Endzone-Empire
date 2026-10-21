import React from 'react';
import { screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import NotificationBell from '../NotificationBell/NotificationBell';
import { invalidate } from '../../lib/resourceCache';
import { clearNotificationsCache } from '../../hooks/useNotifications';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import { listArticles } from '../../content/articles';
import { isPushSupported, fetchPushPublicKey, getCurrentSubscription } from '../../utils/push';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// LeagueStatusGrid is tested in its own file; here it renders the props UserPage hands it. The real
// ActionQueue reads the action items over the mocked apiClient.
jest.mock('./LeagueStatusGrid', () => ({ __esModule: true, default: require('./homeTestStubs').LeagueStatusGridStub }));

// Push support is a browser fact jsdom lacks; the Alert prompt tests below turn it on.
jest.mock('../../utils/push', () => ({
  ...jest.requireActual('../../utils/push'),
  isPushSupported: jest.fn(() => false),
  fetchPushPublicKey: jest.fn(),
  getCurrentSubscription: jest.fn(),
}));

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  my_team_id: 10,
  my_team_name: "alice's Team",
  draft_status: 'pending',
  owner_id: 1,
  ...overrides,
});

const liveLeague = (overrides = {}) => league({
  draft_status: 'complete',
  season_status: 'regular',
  current_week: 4,
  status: { phase: 'in-season', week: 4, matchup: { id: 9, status: 'live' } },
  ...overrides,
});

// The app mounts UserPage inside SnackbarProvider; tests that assert what a
// user is told (and how many times) render the same way.
const renderPage = () => renderWithProviders(<SnackbarProvider><UserPage /></SnackbarProvider>, { state: baseState });

// Let every pending effect and resolved promise run, so an absence check cannot pass early.
const flushEffects = () => act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));

// The action queue's frame (the skeleton while it loads, "Call your plays" after).
const queue = () => screen.getByRole('region', { name: /plays$/ });
const queueReads = () => apiClient.get.mock.calls.filter(([url]) => String(url).startsWith('/api/user/action-items')).length;

const follows = (x, y) => Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);

// /api/notifications is a shared read (ADR 0004): without this a response, or an
// in-flight request, left by an earlier test would answer this one.
beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows the leagues loading state, not first run, while leagues are loading', async () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  expect(screen.getByTestId('league-grid')).toHaveTextContent('loading');
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, alice');
});

test('the root carries the home class and is named by the h1', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderPage();
  await screen.findByTestId('league-grid');

  // the page root is located by id; its role is asserted through the accessible name below
  // eslint-disable-next-line testing-library/no-node-access
  const root = document.getElementById('user-main-content');
  expect(root).toHaveClass('ps-root');
  expect(root).toHaveAccessibleName('Welcome back, alice');
});

test('fetches the leagues with their status and hands them to the grid and the queue', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderPage();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league', { params: { include: 'status' } });
  expect(queue()).toBeInTheDocument();
  expect(screen.getByTestId('league-grid')).toHaveAttribute('data-live', 'false');
  expect(screen.getByTestId('league-grid')).toHaveAttribute('data-updated', 'yes');
});

test('a failed leagues fetch keeps "Welcome back" and the play frame, and never claims the user has no leagues', async () => {
  apiClient.get.mockImplementation((url) => (url === '/api/league'
    ? Promise.reject({ response: { data: { error: 'server exploded' } } })
    : Promise.resolve({ data: [] })));
  renderPage();

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, alice');
  expect(queue()).toBeInTheDocument();
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
});

test('a failed leagues fetch with no server sentence passes a clean line, never the transport text', async () => {
  apiClient.get.mockImplementation((url) => (url === '/api/league'
    ? Promise.reject(new Error('Request failed with status code 500'))
    : Promise.resolve({ data: [] })));
  renderPage();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Check your connection, then try again.');
  expect(alert).not.toHaveTextContent('status code');
});

test('Try again on a failed leagues fetch reads it again', async () => {
  let leaguesCall = 0;
  apiClient.get.mockImplementation((url) => {
    if (url !== '/api/league') return Promise.resolve({ data: [] });
    leaguesCall += 1;
    return leaguesCall === 1
      ? Promise.reject({ response: { data: { error: 'server exploded' } } })
      : Promise.resolve({ data: [league()] });
  });
  renderPage();

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.queryByText('server exploded')).not.toBeInTheDocument();
});

// --- Join and Create ---------------------------------------------------------

// MUI's useMediaQuery reads window.matchMedia, which jsdom lacks (a phone).
const setDesktop = () => {
  window.matchMedia = (media) => ({
    matches: true,
    media,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
};

describe('Join and Create', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  test('on a desktop the ghost pair is at the top right of the header, once', async () => {
    setDesktop();
    apiClient.get.mockResolvedValue({ data: [league()] });
    renderPage();
    await screen.findByTestId('league-grid');

    const header = within(screen.getByTestId('dashboard-hero'));
    ['Join a league', 'Create a league'].forEach((name) => {
      expect(screen.getAllByRole('button', { name })).toHaveLength(1);
      expect(header.getByRole('button', { name })).toBeInTheDocument();
    });
    // the filled foot is a data attribute with no role
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
  });

  test('on a phone the pair moves to the bottom of the page, once', async () => {
    apiClient.get.mockResolvedValue({ data: [league()] });
    renderPage();
    await screen.findByTestId('league-grid');

    const header = within(screen.getByTestId('dashboard-hero'));
    expect(header.queryByRole('button', { name: 'Create a league' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Join a league' })).toHaveLength(1);
    const create = screen.getByRole('button', { name: 'Create a league' });
    expect(follows(screen.getByTestId('league-grid'), create)).toBe(true);
  });

  test('both open their dialog', async () => {
    apiClient.get.mockResolvedValue({ data: [league()] });
    renderPage();
    await screen.findByTestId('league-grid');

    await userEvent.click(screen.getByRole('button', { name: 'Join a league' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Create a league' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  test('a first run has neither', async () => {
    apiClient.get.mockResolvedValue({ data: [] });
    renderPage();
    await screen.findByTestId('leagues-empty-state');

    expect(screen.queryByRole('button', { name: 'Join a league' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('dashboard-hero')).queryByRole('button')).not.toBeInTheDocument();
  });
});

// --- First run ---------------------------------------------------------------

test('first run: the h1, the promise, one filled Create, Join with a code, three steps and the mock-draft line', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderPage();

  const start = await screen.findByTestId('leagues-empty-state');
  await flushEffects();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start a league tonight');
  expect(screen.getByTestId('dashboard-hero')).toHaveTextContent(
    "Welcome, alice. Free to play: pick fantasy, NFL pick'em, or both, send your friends the invite code, and draft as soon as they're in."
  );
  expect(within(start).getByRole('heading', { level: 2, name: 'Start here' })).toBeInTheDocument();

  // the filled foot is a data attribute with no role
  // eslint-disable-next-line testing-library/no-node-access
  const filled = document.querySelectorAll('[data-filled="true"]');
  expect(filled).toHaveLength(1);
  expect(filled[0]).toHaveTextContent('Create a league');
  expect(within(start).getByRole('button', { name: /^Next up: Create a league/ })).toBeInTheDocument();
  expect(within(start).getByRole('button', { name: /^Join with a code/ })).toBeInTheDocument();

  const steps = within(within(start).getByRole('list')).getAllByRole('listitem');
  expect(steps.map((step) => step.textContent)).toEqual([
    '1Create the leagueName it, choose the format and set the size.',
    '2Send the invite codeFriends join with the code you share.',
    "3Play this weekFantasy leagues draft live with a pick clock. Pick'em leagues skip the draft and start picking.",
  ]);
  const mock = within(start).getByRole('link', { name: 'Practice a mock draft' });
  expect(mock).toHaveAttribute('href', '/draft-sim');
  expect(mock).toHaveStyle({ minHeight: '44px' });
});

test('first run has no queue, no leagues, no summary and no League news', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderPage();

  await screen.findByTestId('leagues-empty-state');
  await flushEffects();
  expect(screen.queryByRole('region', { name: /plays$/ })).not.toBeInTheDocument();
  expect(screen.queryByTestId('league-grid')).not.toBeInTheDocument();
  expect(screen.queryByTestId('greeting-summary')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'League news' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 2, name: 'Columns' })).toBeInTheDocument();
});

test('first run: both cards open their dialog', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderPage();

  await userEvent.click(await screen.findByRole('button', { name: /^Join with a code/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: /^Next up: Create a league/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

// --- Order ---------------------------------------------------------------------

test('game-week order: header, queue, leagues, League news, Columns, Alert prompt, Join and Create', async () => {
  window.localStorage.clear();
  isPushSupported.mockReturnValue(true);
  fetchPushPublicKey.mockResolvedValue('key');
  getCurrentSubscription.mockResolvedValue(null);
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/notifications') {
      return Promise.resolve({
        data: { notifications: [{ id: 1, message: 'A trade went through', league_name: 'Sunday Ballers', created_at: '2026-10-12T12:00:00.000Z' }], unread: 0 },
      });
    }
    return Promise.resolve({ data: url === '/api/league' ? [league({ status: { phase: 'in-season' } })] : [] });
  });
  renderPage();

  const alerts = await screen.findByRole('heading', { level: 2, name: 'Get alerts on this device' });
  const news = await screen.findByRole('heading', { level: 2, name: 'League news' });
  const columns = await screen.findByRole('heading', { level: 2, name: 'Columns' });
  const ordered = [
    screen.getByRole('heading', { level: 1 }),
    queue(),
    screen.getByTestId('league-grid'),
    news,
    columns,
    alerts,
    screen.getByRole('button', { name: 'Create a league' }),
  ];
  ordered.slice(1).forEach((el, i) => expect(follows(ordered[i], el)).toBe(true));
});

describe('game day', () => {
  const gameDayApi = () => apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [liveLeague()] });
    if (url === '/api/notifications') {
      return Promise.resolve({ data: { notifications: [{ id: 1, message: 'A trade went through', created_at: '2026-10-12T12:00:00.000Z' }], unread: 0 } });
    }
    return Promise.resolve({ data: [] });
  });

  test('League news is left out, and the grid is told it is live', async () => {
    gameDayApi();
    renderPage();

    await screen.findByText('1 matchup live');
    await flushEffects();
    expect(screen.getByTestId('league-grid')).toHaveAttribute('data-live', 'true');
    expect(screen.queryByRole('heading', { name: 'League news' })).not.toBeInTheDocument();
    expect(screen.queryByText('A trade went through')).not.toBeInTheDocument();
  });

  test('Columns still shows under the grid, once', async () => {
    gameDayApi();
    renderPage();

    expect(await screen.findByRole('heading', { level: 2, name: 'Columns' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2, name: 'Columns' })).toHaveLength(1);
    // The grid is mocked here; it stands in for the Live scores section.
    const live = screen.getByTestId('league-grid');
    const columns = screen.getByRole('heading', { level: 2, name: 'Columns' });
    expect(live.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('with fake timers', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    const leagueReads = () => apiClient.get.mock.calls.filter(([url]) => url === '/api/league').length;

    test('re-requests the leagues after 60 s and bumps the queue refresh key', async () => {
      gameDayApi();
      renderPage();
      await screen.findByText('1 matchup live');
      expect(leagueReads()).toBe(1);
      expect(queueReads()).toBe(1);

      await act(async () => { jest.advanceTimersByTime(59 * 1000); });
      expect(leagueReads()).toBe(1);
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(leagueReads()).toBe(2);
      expect(queueReads()).toBe(2);
    });

    test('a quiet week with no lock ahead does not poll', async () => {
      apiClient.get.mockResolvedValue({ data: [league()] });
      renderPage();
      await screen.findByText('Sunday Ballers');

      await act(async () => { jest.advanceTimersByTime(180 * 1000); });
      expect(leagueReads()).toBe(1);
    });
  });
});

// --- Before kickoff ---------------------------------------------------------------

describe('before kickoff', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  const leagueReads = () => apiClient.get.mock.calls.filter(([url]) => url === '/api/league').length;
  const scheduled = (lockInMs, overrides = {}) => league({
    draft_status: 'complete',
    season_status: 'regular',
    current_week: 4,
    status: {
      phase: 'in-season',
      week: 4,
      matchup: { id: 9, status: 'scheduled' },
      lineup: { nextLockAt: new Date(Date.now() + lockInMs).toISOString() },
    },
    ...overrides,
  });
  // Each /api/league read answers the next list; the last one repeats.
  const leaguesAnswers = (...answers) => {
    let reads = 0;
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/league') {
        const answer = answers[Math.min(reads, answers.length - 1)];
        reads += 1;
        return Promise.resolve({ data: typeof answer === 'function' ? answer() : answer });
      }
      if (url === '/api/notifications') return Promise.resolve({ data: { notifications: [], unread: 0 } });
      return Promise.resolve({ data: [] });
    });
  };
  const hide = (hidden) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const show = () => act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

  test('refreshes once at the earliest lock, so a page opened before kickoff goes live; then the 60 s poll takes over', async () => {
    leaguesAnswers(
      () => [scheduled(10 * 60 * 1000)],
      () => [liveLeague()],
    );
    renderPage();
    await screen.findByText('Sunday Ballers');
    expect(leagueReads()).toBe(1);
    expect(screen.queryByText('1 matchup live')).not.toBeInTheDocument();

    await act(async () => { jest.advanceTimersByTime(9 * 60 * 1000); });
    expect(leagueReads()).toBe(1);
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(leagueReads()).toBe(2);
    expect(await screen.findByText('1 matchup live')).toBeInTheDocument();
    expect(queueReads()).toBe(2);

    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(leagueReads()).toBe(3);
    expect(queueReads()).toBe(3);
  });

  // Kickoff window (batch 2): the server still says `scheduled` for a while after
  // the lock, so the page keeps asking every 60 s until a matchup is live or 30
  // minutes have passed since the lock.
  describe.each([
    ['the status keeps naming the passed lock', (lockAt) => scheduled(lockAt - Date.now())],
    ['the status has moved on past the lock', () => scheduled(0, { status: { phase: 'in-season', week: 4, matchup: { id: 9, status: 'scheduled' } } })],
  ])('after the lock, while the server still says scheduled (%s)', (_name, stale) => {
    test('asks again every 60 s, then stops once the lock is 30 minutes behind', async () => {
      const lockAt = Date.now() + 10 * 60 * 1000;
      leaguesAnswers(() => [scheduled(10 * 60 * 1000)], () => [stale(lockAt)]);
      renderPage();
      await screen.findByText('Sunday Ballers');

      await act(async () => { jest.advanceTimersByTime(10 * 60 * 1000); });
      expect(leagueReads()).toBe(2);
      await act(async () => { jest.advanceTimersByTime(60 * 1000); });
      expect(leagueReads()).toBe(3);
      await act(async () => { jest.advanceTimersByTime(60 * 1000); });
      expect(leagueReads()).toBe(4);

      await act(async () => { jest.advanceTimersByTime(30 * 60 * 1000); });
      const settled = leagueReads();
      await act(async () => { jest.advanceTimersByTime(10 * 60 * 1000); });
      expect(leagueReads()).toBe(settled);
    });

    test('goes live on a later poll and the page then follows the game-day poll alone', async () => {
      const lockAt = Date.now() + 10 * 60 * 1000;
      leaguesAnswers(() => [scheduled(10 * 60 * 1000)], () => [stale(lockAt)], () => [stale(lockAt)], () => [liveLeague()]);
      renderPage();
      await screen.findByText('Sunday Ballers');
      await act(async () => { jest.advanceTimersByTime(10 * 60 * 1000); });
      await act(async () => { jest.advanceTimersByTime(60 * 1000); });
      await act(async () => { jest.advanceTimersByTime(60 * 1000); });
      expect(await screen.findByText('1 matchup live')).toBeInTheDocument();
      const reads = leagueReads();
      await act(async () => { jest.advanceTimersByTime(60 * 1000); });
      expect(leagueReads()).toBe(reads + 1);
    });
  });

  test('keeps asking every 60 s while one of the leagues is drafting', async () => {
    const drafting = league({ id: 2, name: 'Night League', draft_status: 'active', status: { phase: 'drafting', draft: { round: 1, slot: 7, onTheClock: false } } });
    leaguesAnswers(() => [drafting]);
    renderPage();
    await screen.findByText('Night League');
    expect(leagueReads()).toBe(1);

    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(leagueReads()).toBe(2);
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(leagueReads()).toBe(3);
  });

  test("the matchup's own kickoff, earlier than the lineup lock, is where the refresh lands", async () => {
    const withKickoff = (kickoffInMs) => {
      const row = scheduled(60 * 60 * 1000);
      row.status.matchup.kickoffAt = new Date(Date.now() + kickoffInMs).toISOString();
      return row;
    };
    leaguesAnswers(() => [withKickoff(10 * 60 * 1000)], () => [scheduled(6 * 60 * 60 * 1000)]);
    renderPage();
    await screen.findByText('Sunday Ballers');

    await act(async () => { jest.advanceTimersByTime(9 * 60 * 1000); });
    expect(leagueReads()).toBe(1);
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(leagueReads()).toBe(2);
  });

  test("reads the lock from the pick'em side too, the earliest wins, and a lock under 30 s away waits 30 s", async () => {
    const pickem = scheduled(20 * 60 * 1000, { id: 2, name: 'Pickem Side', status: { phase: 'in-season', week: 4, pickem: { nextLockAt: new Date(Date.now() + 5 * 1000).toISOString() } } });
    leaguesAnswers(() => [scheduled(10 * 60 * 1000), pickem], () => [scheduled(60 * 60 * 1000)]);
    renderPage();
    await screen.findByText('Sunday Ballers');

    await act(async () => { jest.advanceTimersByTime(29 * 1000); });
    expect(leagueReads()).toBe(1);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(leagueReads()).toBe(2);
  });

  test('after the kickoff window the one scheduled refresh waits for the next lock', async () => {
    const laterLock = Date.now() + 3 * 60 * 60 * 1000;
    const stale = () => scheduled(laterLock - Date.now(), { status: { phase: 'in-season', week: 4, matchup: { id: 9, status: 'scheduled' }, lineup: { nextLockAt: new Date(laterLock).toISOString() } } });
    leaguesAnswers(() => [scheduled(10 * 60 * 1000)], () => [stale()]);
    renderPage();
    await screen.findByText('Sunday Ballers');
    await act(async () => { jest.advanceTimersByTime(10 * 60 * 1000); });
    // 31 minutes of one-a-minute asking, then quiet.
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    for (let i = 0; i < 31; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    }
    const settled = leagueReads();
    await act(async () => { jest.advanceTimersByTime(60 * 60 * 1000); });
    expect(leagueReads()).toBe(settled);
    await act(async () => { jest.advanceTimersByTime(90 * 60 * 1000); });
    expect(leagueReads()).toBe(settled + 1);
  });

  test('a scheduled refresh that fails is retried in 30 s, silently', async () => {
    let reads = 0;
    apiClient.get.mockImplementation((url) => {
      if (url !== '/api/league') return Promise.resolve({ data: url === '/api/notifications' ? { notifications: [], unread: 0 } : [] });
      reads += 1;
      if (reads === 2) return Promise.reject(new Error('down'));
      return Promise.resolve({ data: [scheduled(reads === 1 ? 2 * 60 * 1000 : 40 * 60 * 1000)] });
    });
    renderPage();
    await screen.findByText('Sunday Ballers');

    await act(async () => { jest.advanceTimersByTime(2 * 60 * 1000); });
    expect(reads).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(30 * 1000); });
    expect(reads).toBe(3);
  });

  test('showing the tab refreshes only when the last load is over 60 s old', async () => {
    leaguesAnswers(() => [scheduled(6 * 60 * 60 * 1000)]);
    renderPage();
    await screen.findByText('Sunday Ballers');

    hide(true);
    await act(async () => { jest.advanceTimersByTime(50 * 1000); });
    hide(false);
    await show();
    expect(leagueReads()).toBe(1);

    hide(true);
    await act(async () => { jest.advanceTimersByTime(20 * 1000); });
    hide(false);
    await show();
    expect(leagueReads()).toBe(2);
    expect(queueReads()).toBe(2);
  });

  test('every silent leagues refresh bumps the queue key: the draft expiry and the late-draft poll', async () => {
    leaguesAnswers(() => [league({ draft_status: 'pending', draft_date: new Date(Date.now() - 60 * 60 * 1000).toISOString() })]);
    renderPage();
    await screen.findByRole('region', { name: 'Call your plays' });
    await screen.findByTestId('league-grid');
    expect(queueReads()).toBe(1);

    await act(async () => { jest.advanceTimersByTime(30 * 1000); });
    expect(leagueReads()).toBe(2);
    expect(queueReads()).toBe(2);
  });

  test('on game day one visibility event refreshes once, not once for the live path and again for a late draft', async () => {
    leaguesAnswers(() => [
      liveLeague(),
      league({ id: 2, name: 'Late One', draft_status: 'pending', draft_date: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    ]);
    renderPage();
    await screen.findByText('1 matchup live');
    hide(true);
    await act(async () => { jest.advanceTimersByTime(40 * 1000); });
    hide(false);
    const before = leagueReads();
    await show();
    expect(leagueReads()).toBe(before + 1);
  });
});

// --- League news ------------------------------------------------------------------

test('the Nav bell and League news share one /api/notifications read', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/notifications') {
      return Promise.resolve({ data: { notifications: [{ id: 5, message: 'Shared read note', created_at: '2026-01-01T00:00:00.000Z' }], unread: 0 } });
    }
    return Promise.resolve({ data: [league()] });
  });
  // The app mounts the bell in Nav beside the routed page.
  renderWithProviders(<><NotificationBell /><UserPage /></>, { state: baseState });

  expect(await screen.findByText('Shared read note')).toBeInTheDocument();
  const reads = apiClient.get.mock.calls.filter(([url]) => url === '/api/notifications');
  expect(reads).toHaveLength(1);
});

// The bell's 60 s poll is an invalidating refetch that reloads this frame too.
// Red-tell: gating the skeleton on `loading` alone blanks the list on every poll.
describe('League news while the bell polls', () => {
  const note = { id: 5, message: 'Poll survivor', created_at: '2026-01-01T00:00:00.000Z' };
  const mockPoll = (secondRead) => {
    let reads = 0;
    apiClient.get.mockImplementation((url) => {
      if (url !== '/api/notifications') return Promise.resolve({ data: [league()] });
      reads += 1;
      return reads === 1 ? Promise.resolve({ data: { notifications: [note], unread: 0 } }) : secondRead();
    });
  };

  test('keeps the list on screen while the reload is in flight', async () => {
    mockPoll(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Poll survivor');

    act(() => clearNotificationsCache());

    expect(screen.getByText('Poll survivor')).toBeInTheDocument();
    expect(screen.queryAllByTestId('news-skeleton')).toHaveLength(0);
    await waitFor(() => expect(apiClient.get.mock.calls.filter(([u]) => u === '/api/notifications')).toHaveLength(2));
  });

  test('keeps the list on screen when the reload fails', async () => {
    mockPoll(() => Promise.reject(new Error('network blip')));
    renderPage();
    await screen.findByText('Poll survivor');

    act(() => clearNotificationsCache());
    await waitFor(() => expect(apiClient.get.mock.calls.filter(([u]) => u === '/api/notifications')).toHaveLength(2));

    expect(screen.getByText('Poll survivor')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load league news")).not.toBeInTheDocument();
  });
});

test('Home has no Latest NFL News card and never reads /api/news', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderPage();

  await screen.findByText('Sunday Ballers');
  await flushEffects();
  expect(screen.queryByRole('heading', { name: 'Latest NFL News' })).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/news');
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/public/recaps', expect.anything());
});

// --- Columns ---------------------------------------------------------------------------

test('surfaces the newest Darkness Report (lazy) under Columns', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderPage();

  // The frame is a lazy chunk (it carries the strategy-article registry), so it
  // arrives after the initial render.
  expect(await screen.findByRole('heading', { level: 2, name: 'Columns' })).toBeInTheDocument();
  const report = listArticles().find((article) => /Darkness Report/i.test(article.title));
  expect(screen.getByText(report.title)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /^Read the .* column$/ })).toHaveAttribute('href', `/strategy/${report.slug}`);
});

// --- Heading outline (ADR 0021: levels are explicit) ---

test('the page has one h1 and pixel h2 sections', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/notifications') {
      return Promise.resolve({ data: { notifications: [{ id: 5, message: 'Hello', created_at: '2026-01-01T00:00:00.000Z' }], unread: 0 } });
    }
    return Promise.resolve({ data: [league()] });
  });
  renderPage();
  await screen.findByText('Hello');
  await screen.findByRole('heading', { level: 2, name: 'Columns' });

  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, alice');
  expect(screen.getByRole('heading', { level: 2, name: 'League news' })).toBeInTheDocument();
  screen.getAllByRole('heading', { level: 2 }).forEach((heading) => {
    expect(heading).toHaveStyle({ textTransform: 'uppercase' });
  });
  expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
});

// --- A leagues fetch error survives the dialogs ---

test('opening Create or Join does not clear a leagues fetch error', async () => {
  apiClient.get.mockImplementation((url) => (url === '/api/league'
    ? Promise.reject({ response: { data: { error: 'server exploded' } } })
    : Promise.resolve({ data: [] })));
  renderPage();
  expect(await screen.findByText('server exploded')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Create a league' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Join a league' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('server exploded')).toBeInTheDocument();
});

// --- Postgame cutscene (ADR 0052) ---

const dueCutscene = {
  matchupId: 9,
  leagueId: 1,
  leagueName: 'Sunday Ballers',
  week: 4,
  playoff: false,
  outcome: 'win',
  me: { teamId: 10, name: "alice's Team", avatarStaticUrl: null, score: 120 },
  opponent: { teamId: 11, name: 'Rivals', avatarStaticUrl: null, score: 100 },
  record: { wins: 3, losses: 1, ties: 0 },
  standing: { rank: 1, of: 8 },
};

const mockHome = (cutscenes) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/user/postgame-cutscenes') return cutscenes instanceof Error ? Promise.reject(cutscenes) : Promise.resolve({ data: { cutscenes } });
    if (url === '/api/league') return Promise.resolve({ data: [league()] });
    return Promise.resolve({ data: [] });
  });
};

test('Home reads the due Postgame cutscenes once, beside its own reads, and plays them', async () => {
  window.sessionStorage.clear();
  apiClient.post.mockResolvedValue({ status: 204 });
  mockHome([dueCutscene]);
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('alertdialog')).toHaveAccessibleName('WEEK 4 IS FINAL');
  const calls = apiClient.get.mock.calls.map((c) => c[0]);
  expect(calls.filter((url) => url === '/api/user/postgame-cutscenes')).toHaveLength(1);
  expect(calls).toContain('/api/league');
  window.sessionStorage.clear();
});

test('a failed Postgame fetch renders nothing and never blocks Home', async () => {
  mockHome(new Error('cutscenes down'));
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('an empty Postgame list renders no overlay', async () => {
  mockHome([]);
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

// --- Alert prompt (#2136) --------------------------------------------------

const mockAlertHome = (rows) => {
  window.localStorage.clear();
  isPushSupported.mockReturnValue(true);
  fetchPushPublicKey.mockResolvedValue('key');
  getCurrentSubscription.mockResolvedValue(null);
  apiClient.get.mockImplementation((url) => Promise.resolve({ data: url === '/api/league' ? rows : [] }));
};

afterEach(() => {
  isPushSupported.mockReturnValue(false);
  window.localStorage.clear();
});

test('the Alert prompt sits after the leagues, in its own row', async () => {
  const draftDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
  mockAlertHome([league({ draft_date: draftDate, status: { phase: 'pre-draft' } })]);
  renderPage();

  const prompt = await screen.findByRole('heading', { level: 2, name: 'Get alerts on this device' });
  expect(follows(screen.getByTestId('league-grid'), prompt)).toBe(true);
});

test('no Alert prompt when no league row carries a team of the manager', async () => {
  mockAlertHome([league({ my_team_id: null, status: { phase: 'in-season' } })]);
  renderPage();

  await screen.findByText('Sunday Ballers');
  await flushEffects();
  expect(fetchPushPublicKey).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Get alerts on this device' })).not.toBeInTheDocument();
});

test('an eligible league asks for the push public key', async () => {
  mockAlertHome([league({ status: { phase: 'in-season' } })]);
  renderPage();

  await screen.findByRole('heading', { level: 2, name: 'Get alerts on this device' });
  expect(fetchPushPublicKey).toHaveBeenCalledTimes(1);
});
