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
import { isPushSupported, fetchPushPublicKey, getCurrentSubscription } from '../../utils/push';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

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

// The hero's Create/Join league buttons are always on screen; the rich empty
// state repeats the same two CTAs when there are no leagues yet. Scope to the
// hero so these tests keep working regardless of which state is showing.
const heroButton = (name) => within(screen.getByTestId('dashboard-hero')).getByRole('button', { name });

// The app mounts UserPage inside SnackbarProvider; tests that assert what a
// user is told (and how many times) render the same way.
const renderPage = () => renderWithProviders(<SnackbarProvider><UserPage /></SnackbarProvider>, { state: baseState });

// /api/notifications is a shared read (ADR 0004): without this a response, or an
// in-flight request, left by an earlier test would answer this one.
beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton cards (not the empty state) while leagues are loading', async () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<UserPage />, { state: baseState });
  // The lazy PublicHighlights chunk resolves independently of apiClient (a
  // real dynamic import, not a mocked fetch) and only on the first mount in
  // this file. Let it settle so its Suspense ping doesn't land on a later
  // test that happens to yield first.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  expect(screen.getAllByTestId('league-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
});

test('renders a welcome message with the username', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  // UserPage unconditionally mounts the news/activity widgets and the lazy
  // PublicHighlights section, each firing its own fetch on mount regardless
  // of what this test asserts. Neither assertion below needs a fetch to
  // settle, but the test needs to let those settle before it ends, or their
  // state updates land after Jest has moved on to the next test.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  expect(screen.getByText('Welcome back, alice')).toBeInTheDocument();
});

test("fetches and renders the user's leagues on mount", async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText("Team: alice's Team")).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league', { params: { include: 'status' } });
});

test('shows an error alert when fetching leagues fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'server exploded' } } });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
});

test('a failed leagues fetch offers Try again and never claims the user has no leagues', async () => {
  let leaguesCall = 0;
  apiClient.get.mockImplementation((url) => {
    if (url !== '/api/league') return Promise.resolve({ data: [] });
    leaguesCall += 1;
    return leaguesCall === 1
      ? Promise.reject({ response: { data: { error: 'server exploded' } } })
      : Promise.resolve({ data: [league()] });
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View leagues' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.queryByText('server exploded')).not.toBeInTheDocument();
});

test('renders a rich empty state with an icon and CTAs once loading finishes with no leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  const emptyState = await screen.findByTestId('leagues-empty-state');
  expect(within(emptyState).getByText("You aren't managing any teams yet.")).toBeInTheDocument();
  expect(within(emptyState).getByTestId('SportsFootballIcon')).toBeInTheDocument();
  expect(within(emptyState).getByRole('button', { name: 'Create league' })).toBeInTheDocument();
  expect(within(emptyState).getByRole('button', { name: 'Join league' })).toBeInTheDocument();
});

test('does not render the empty state once leagues are present', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });

  await screen.findByText('Sunday Ballers');
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
});

test('renders NFL news headlines and cross-league activity from their own endpoints', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/news') {
      return Promise.resolve({
        data: [{ title: 'Star RB questionable for Sunday', link: 'https://example.com/news/1' }],
      });
    }
    if (url === '/api/notifications') {
      return Promise.resolve({
        data: {
          notifications: [
            { id: 5, message: 'Sunday Ballers completed a trade', league_name: 'Sunday Ballers', created_at: '2026-01-01T00:00:00.000Z' },
          ],
          unread: 0,
        },
      });
    }
    return Promise.resolve({ data: [] }); // /api/league
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'Star RB questionable for Sunday' })).toHaveAttribute(
    'href',
    'https://example.com/news/1'
  );
  // Once only: the activity feed. The old "Next up" hero no longer repeats it.
  expect(screen.getAllByText('Sunday Ballers completed a trade')).toHaveLength(1);
});

test('shows a friendly message when the news or activity widgets fail to load', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/news' || url === '/api/notifications') {
      return Promise.reject(new Error('network error'));
    }
    return Promise.resolve({ data: [] }); // /api/league
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText("Couldn't load the latest news right now.")).toBeInTheDocument();
  expect(screen.getByText("Couldn't load recent activity right now.")).toBeInTheDocument();
});

// The "Next up" hero (nextUpFor) and its tests are gone: the to-do list
// replaced it (Home v2 slice 2, UserPage.actionQueue.test.jsx).
const mockDashboard = ({ leagues = [], notifications = [] }) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications, unread: 0 } });
    if (url === '/api/news') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: leagues }); // /api/league
  });
};

test('the Nav bell and the activity card share one /api/notifications read', async () => {
  mockDashboard({
    notifications: [{ id: 5, message: 'Shared read note', created_at: '2026-01-01T00:00:00.000Z' }],
  });
  // The app mounts the bell in Nav beside the routed page.
  renderWithProviders(<><NotificationBell /><UserPage /></>, { state: baseState });

  expect(await screen.findByText('Shared read note')).toBeInTheDocument();
  const reads = apiClient.get.mock.calls.filter(([url]) => url === '/api/notifications');
  expect(reads).toHaveLength(1);
});

// The bell's 60 s poll is an invalidating refetch that reloads this card too.
// Red-tell: gating the skeleton on `loading` alone blanks the list on every poll.
describe('the activity card while the bell polls', () => {
  const note = { id: 5, message: 'Poll survivor', created_at: '2026-01-01T00:00:00.000Z' };
  const mockPoll = (secondRead) => {
    let reads = 0;
    apiClient.get.mockImplementation((url) => {
      if (url !== '/api/notifications') return Promise.resolve({ data: [] });
      reads += 1;
      return reads === 1 ? Promise.resolve({ data: { notifications: [note], unread: 0 } }) : secondRead();
    });
  };

  test('keeps the list on screen while the reload is in flight', async () => {
    mockPoll(() => new Promise(() => {}));
    renderWithProviders(<UserPage />, { state: baseState });
    await screen.findByText('Poll survivor');

    act(() => clearNotificationsCache());

    expect(screen.getByText('Poll survivor')).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get.mock.calls.filter(([u]) => u === '/api/notifications')).toHaveLength(2));
  });

  test('keeps the list on screen when the reload fails', async () => {
    mockPoll(() => Promise.reject(new Error('network blip')));
    renderWithProviders(<UserPage />, { state: baseState });
    await screen.findByText('Poll survivor');

    act(() => clearNotificationsCache());
    await waitFor(() => expect(apiClient.get.mock.calls.filter(([u]) => u === '/api/notifications')).toHaveLength(2));

    expect(screen.getByText('Poll survivor')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load recent activity right now.")).not.toBeInTheDocument();
  });
});

test('surfaces the public-layer highlights section (lazy) for logged-in users', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/rankings') {
      return Promise.resolve({
        data: { rankings: [{ rank: 1, playerId: 7, name: 'Top Back', position: 'RB', nflTeam: 'KC', seasonPoints: 300 }] },
      });
    }
    if (url === '/api/public/recaps') return Promise.resolve({ data: { recaps: [] } });
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications: [] } });
    return Promise.resolve({ data: [] });
  });
  renderWithProviders(<UserPage />, { state: baseState });

  // The section is a lazy chunk (it carries the strategy-article registry),
  // so it arrives after the initial render.
  expect(await screen.findByText('Around the League')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: '#1 Top Back' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Waiver Wire' })).toHaveAttribute('href', '/waiver-wire');
  expect(screen.getByRole('link', { name: 'All strategy articles' })).toHaveAttribute('href', '/strategy');
});

// --- Heading outline (ADR 0021: levels are explicit) ---

test('the page has one h1, an h2 per section and an h3 per league card', async () => {
  mockDashboard({ leagues: [league({ draft_status: 'complete', season_status: 'regular', current_week: 4 })] });
  renderPage();
  await screen.findByText('Sunday Ballers');

  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, alice');
  expect(screen.getByRole('heading', { level: 2, name: 'My leagues' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 2, name: 'Needs your attention' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Latest NFL News' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Global Activity' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 2, name: 'Around the League' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Top Players' })).toBeInTheDocument();
  expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
  expect(screen.queryAllByRole('heading', { level: 5 })).toHaveLength(0);
  expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
});

test('the empty state heading sits under My leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderPage();

  const emptyState = await screen.findByTestId('leagues-empty-state');
  expect(within(emptyState).getByRole('heading', { level: 3 })).toHaveTextContent("You aren't managing any teams yet.");
});

// --- A leagues fetch error survives the dialogs ---

test('opening Create or Join does not clear a leagues fetch error', async () => {
  apiClient.get.mockImplementation((url) => (url === '/api/league'
    ? Promise.reject({ response: { data: { error: 'server exploded' } } })
    : Promise.resolve({ data: [] })));
  renderPage();
  expect(await screen.findByText('server exploded')).toBeInTheDocument();

  await userEvent.click(heroButton('Create league'));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(heroButton('Join league'));
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

  expect(await screen.findByRole('heading', { level: 3, name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('an empty Postgame list renders no overlay', async () => {
  mockHome([]);
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('heading', { level: 3, name: 'Sunday Ballers' })).toBeInTheDocument();
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

test('the Alert prompt sits between the Action queue and Next draft for an eligible manager', async () => {
  const draftDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
  mockAlertHome([league({ draft_date: draftDate, status: { phase: 'pre-draft' } })]);
  renderPage();

  const prompt = await screen.findByRole('heading', { level: 2, name: 'Get alerts on this phone' });
  const queue = screen.getByRole('heading', { level: 2, name: 'Needs your attention' });
  const nextDraft = await screen.findByRole('region', { name: 'Next draft' });
  expect(queue.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(prompt.compareDocumentPosition(nextDraft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('no Alert prompt when no league row carries a team of the manager', async () => {
  mockAlertHome([league({ my_team_id: null, status: { phase: 'in-season' } })]);
  renderPage();

  await screen.findByText('Sunday Ballers');
  await waitFor(() => expect(fetchPushPublicKey).not.toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: 'Get alerts on this phone' })).not.toBeInTheDocument();
});
