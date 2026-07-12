import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import AdminDashboard from './AdminDashboard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const overviewResponse = (overrides = {}) => ({
  users: { total: 42, signupsLast7Days: 3, signupsLast30Days: 11 },
  leagues: [
    { draft_status: 'completed', season_status: 'in_progress', count: 4 },
    { draft_status: 'pending', season_status: 'not_started', count: 2 },
  ],
  recentSignups: [
    { id: 1, username: 'alice', created_at: '2026-07-10T12:00:00.000Z' },
    { id: 2, username: 'bob', created_at: '2026-07-11T09:30:00.000Z' },
  ],
  sync: {
    scheduler: {
      lastTickAt: '2026-07-12T10:00:00.000Z',
      lastTickError: null,
      lastSyncAt: '2026-07-12T09:00:00.000Z',
    },
    statsCoverage: { season: 2026, week: 3, rows: 1500 },
    rapidApiConfigured: true,
  },
  errors: {
    sentryConfigured: true,
    errorsSinceBoot: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
  },
  uptimeSec: 13320, // 3h 42m
  ...overrides,
});

const renderScreen = () => renderWithProviders(<AdminDashboard />, { route: '/admin', path: '/admin' });

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders stat tiles, leagues table, sync health, and recent signups from a mocked overview', async () => {
  apiClient.get.mockResolvedValue({ data: overviewResponse() });
  renderScreen();

  expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();

  // Stat tiles
  expect(screen.getByText('Total Users')).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByText('3 / 11')).toBeInTheDocument();
  expect(screen.getByText('3h 42m')).toBeInTheDocument();
  expect(screen.getByText('Errors Since Boot')).toBeInTheDocument();
  expect(screen.getByText(/Sentry: configured/)).toBeInTheDocument();

  // Leagues table
  expect(screen.getByText('completed')).toBeInTheDocument();
  expect(screen.getByText('in_progress')).toBeInTheDocument();
  expect(screen.getByText('pending')).toBeInTheDocument();

  // Sync health
  expect(screen.getByText(/1500 stat rows through season 2026 week 3/)).toBeInTheDocument();
  expect(screen.getByText('RapidAPI configured')).toBeInTheDocument();

  // Recent signups
  expect(screen.getByText('alice')).toBeInTheDocument();
  expect(screen.getByText('bob')).toBeInTheDocument();
});

test('a red-tinted error tile shows the last error message and time when errorsSinceBoot > 0', async () => {
  apiClient.get.mockResolvedValue({
    data: overviewResponse({
      errors: {
        sentryConfigured: false,
        errorsSinceBoot: 4,
        lastErrorAt: '2026-07-12T08:00:00.000Z',
        lastErrorMessage: 'ECONNREFUSED',
      },
    }),
  });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  expect(screen.getByText('Errors Since Boot').closest('.MuiPaper-root')).toHaveTextContent('4');
  expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
  expect(screen.getByText(/Sentry: not configured/)).toBeInTheDocument();
});

test('shows a scheduler error and a warning RapidAPI chip when creds are missing', async () => {
  apiClient.get.mockResolvedValue({
    data: overviewResponse({
      sync: {
        scheduler: { lastTickAt: null, lastTickError: 'timeout', lastSyncAt: null },
        statsCoverage: { season: null, week: null, rows: 0 },
        rapidApiConfigured: false,
      },
    }),
  });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  expect(screen.getByText(/Last tick error: timeout/)).toBeInTheDocument();
  expect(screen.getByText('No stats synced yet')).toBeInTheDocument();
  expect(screen.getByText('RapidAPI missing')).toBeInTheDocument();
});

test('a 403 response shows the "Admin access required" message instead of crashing', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 403 } });
  renderScreen();

  expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
});

test('clicking Sync Players POSTs the correct URL and body and renders the result', async () => {
  apiClient.get.mockResolvedValue({ data: overviewResponse() });
  apiClient.post.mockResolvedValue({ data: { playersUpserted: 250 } });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  await userEvent.click(screen.getByRole('button', { name: 'Sync Players' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/sync/players', {})
  );
  expect(await screen.findByText(/playersUpserted/)).toBeInTheDocument();
});

test('typing a season includes it in the Sync Schedule request body', async () => {
  apiClient.get.mockResolvedValue({ data: overviewResponse() });
  apiClient.post.mockResolvedValue({ data: { gamesUpserted: 16 } });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  await userEvent.type(screen.getByLabelText('Season'), '2026');
  await userEvent.click(screen.getByRole('button', { name: 'Sync Schedule' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/sync/schedule', { season: 2026 })
  );
  expect(await screen.findByText(/gamesUpserted/)).toBeInTheDocument();
});

test('a sync failure renders the server error in an error alert', async () => {
  apiClient.get.mockResolvedValue({ data: overviewResponse() });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'RapidAPI request failed' } } });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  await userEvent.click(screen.getByRole('button', { name: 'Sync Injuries' }));

  expect(await screen.findByText('RapidAPI request failed')).toBeInTheDocument();
});

test('the Sync Stats button is disabled until a week is entered, then POSTs season+week', async () => {
  apiClient.get.mockResolvedValue({ data: overviewResponse() });
  apiClient.post.mockResolvedValue({ data: { playersUpdated: 30 } });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  const statsButton = screen.getByRole('button', { name: 'Sync Stats' });
  expect(statsButton).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Season'), '2026');
  await userEvent.type(screen.getByLabelText('Week'), '3');
  expect(statsButton).toBeEnabled();

  await userEvent.click(statsButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/sync/stats', { season: 2026, week: 3 })
  );
  expect(await screen.findByText(/playersUpdated/)).toBeInTheDocument();
});

test('all sync buttons are disabled with a hint when rapidApiConfigured is false', async () => {
  apiClient.get.mockResolvedValue({
    data: overviewResponse({
      sync: {
        scheduler: { lastTickAt: null, lastTickError: null, lastSyncAt: null },
        statsCoverage: { season: null, week: null, rows: 0 },
        rapidApiConfigured: false,
      },
    }),
  });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  expect(screen.getByText(/RapidAPI credentials are not configured/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sync Players' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Sync Schedule' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Sync Injuries' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Sync Stats' })).toBeDisabled();
});

test('a 503 from the server while syncing is surfaced as an error alert', async () => {
  apiClient.get.mockResolvedValue({ data: overviewResponse() });
  apiClient.post.mockRejectedValue({
    response: { status: 503, data: { error: 'RapidAPI credentials are not set' } },
  });
  renderScreen();

  await screen.findByRole('heading', { name: 'Admin Dashboard' });
  await userEvent.click(screen.getByRole('button', { name: 'Sync Players' }));

  expect(await screen.findByText('RapidAPI credentials are not set')).toBeInTheDocument();
});
