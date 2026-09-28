import React from 'react';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
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

// The hero's Create/Join League buttons are always on screen; the rich empty
// state repeats the same two CTAs when there are no leagues yet. Scope to the
// hero so these tests keep working regardless of which state is showing.
const heroButton = (name) => within(screen.getByTestId('dashboard-hero')).getByRole('button', { name });

// The app mounts UserPage inside SnackbarProvider; tests that assert what a
// user is told (and how many times) render the same way.
const renderPage = () => renderWithProviders(<SnackbarProvider><UserPage /></SnackbarProvider>, { state: baseState });

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
  expect(within(emptyState).getByRole('button', { name: 'Create League' })).toBeInTheDocument();
  expect(within(emptyState).getByRole('button', { name: 'Join League' })).toBeInTheDocument();
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
  expect(screen.getByRole('heading', { level: 2, name: 'My Leagues' })).toBeInTheDocument();
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

test('the empty state heading sits under My Leagues', async () => {
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

  await userEvent.click(heroButton('Create League'));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(heroButton('Join League'));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('server exploded')).toBeInTheDocument();
});
