import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { invalidate } from '../../lib/resourceCache';
import { formatInstant } from '../../shared/lib/instantFormat';

// The League news frame (spec #2315, #2308, #2311): a list that drops repeats,
// stops at three rows, links a row to its league when it names one, and fails
// into the error panel.

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));


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

// A league on the page: League news is hidden on a first run.
const mockFeeds = ({ notifications = [], notificationsError = null } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/notifications') {
      return notificationsError ? Promise.reject(notificationsError) : Promise.resolve({ data: { notifications, unread: 0 } });
    }
    if (url.startsWith('/api/user/action-items')) return Promise.resolve({ data: { items: [], partial: [] } });
    return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers', my_team_id: 10, draft_status: 'pending' }] });
  });
};

beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const note = (id, message, league_name, created_at, league_id) => ({
  id, message, league_name, created_at, league_id,
});

const newsFrame = () => screen.getByRole('region', { name: 'League news' });

test('League news drops a repeated (message, league) pair, keeps the newest, and shows at most 3 rows', async () => {
  mockFeeds({
    notifications: [
      note(9, 'Waiver claim processed', 'Sunday Ballers', '2026-10-12T12:00:00.000Z'),
      note(8, 'Waiver claim processed', 'Sunday Ballers', '2026-10-05T12:00:00.000Z'),
      note(7, 'Waiver claim processed', 'Office League', '2026-10-04T12:00:00.000Z'),
      note(6, 'Trade completed', 'Sunday Ballers', '2026-10-03T12:00:00.000Z'),
      note(5, 'Draft starts soon', 'Sunday Ballers', '2026-10-02T12:00:00.000Z'),
    ],
  });
  renderWithProviders(<UserPage />, { state: baseState });
  await screen.findByText('Trade completed');

  const frame = within(newsFrame());
  expect(frame.getByRole('heading', { level: 2, name: 'League news' })).toBeInTheDocument();
  expect(frame.getAllByRole('listitem')).toHaveLength(3);
  // Two Waiver rows (one per league), the older Sunday Ballers repeat gone.
  expect(frame.getAllByText('Waiver claim processed')).toHaveLength(2);
  expect(frame.getByText(`Sunday Ballers · ${formatInstant('2026-10-12T12:00:00.000Z', 'day')}`)).toBeInTheDocument();
  expect(frame.getByText(`Office League · ${formatInstant('2026-10-04T12:00:00.000Z', 'day')}`)).toBeInTheDocument();
  expect(frame.getByText(`Sunday Ballers · ${formatInstant('2026-10-03T12:00:00.000Z', 'day')}`)).toBeInTheDocument();
  expect(frame.queryByText(`Sunday Ballers · ${formatInstant('2026-10-05T12:00:00.000Z', 'day')}`)).not.toBeInTheDocument();
  // Capped at three rows.
  expect(screen.queryByText('Draft starts soon')).not.toBeInTheDocument();
});

test('a row with no league name shows just the date, and a row with no league id is not a link', async () => {
  mockFeeds({ notifications: [note(1, 'Welcome to the league', null, '2026-10-12T12:00:00.000Z')] });
  renderWithProviders(<UserPage />, { state: baseState });

  await screen.findByText('Welcome to the league');
  expect(screen.getByText(formatInstant('2026-10-12T12:00:00.000Z', 'day'))).toBeInTheDocument();
  expect(within(newsFrame()).queryByRole('link')).not.toBeInTheDocument();
});

test('a row that carries a league id links to that league', async () => {
  mockFeeds({ notifications: [note(1, 'A trade went through', 'Sunday Ballers', '2026-10-12T12:00:00.000Z', 42)] });
  renderWithProviders(<UserPage />, { state: baseState });

  const link = await within(await screen.findByRole('region', { name: 'League news' })).findByRole('link');
  expect(link).toHaveAttribute('href', '/league/42');
  expect(link).toHaveTextContent('A trade went through');
});

test('with no news the frame is left out', async () => {
  mockFeeds({ notifications: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  await screen.findByRole('region', { name: /^(My leagues|Live scores)$/ });
  await screen.findByRole('heading', { level: 2, name: 'Columns' });
  expect(screen.queryByRole('heading', { name: 'League news' })).not.toBeInTheDocument();
});

test('a failed read says so, and Try again reads it again', async () => {
  let reads = 0;
  apiClient.get.mockImplementation((url) => {
    if (url !== '/api/notifications') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers', my_team_id: 10, draft_status: 'pending' }] });
    reads += 1;
    return reads === 1
      ? Promise.reject(new Error('network error'))
      : Promise.resolve({ data: { notifications: [note(1, 'Back again', null, '2026-01-01T00:00:00.000Z')], unread: 0 } });
  });
  renderWithProviders(<UserPage />, { state: baseState });

  const panel = await screen.findByRole('alert');
  expect(panel).toHaveTextContent("Couldn't load league news");
  expect(panel).toHaveTextContent('Check your connection, then try again.');
  await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('Back again')).toBeInTheDocument();
  expect(reads).toBe(2);
});

test('rows are skeletons while the first read is in flight', async () => {
  apiClient.get.mockImplementation((url) => (url === '/api/notifications'
    ? new Promise(() => {})
    : Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers', my_team_id: 10, draft_status: 'pending' }] })));
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findAllByTestId('news-skeleton')).toHaveLength(3);
});
