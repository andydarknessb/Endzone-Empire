import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { invalidate } from '../../lib/resourceCache';
import { formatInstant } from '../../shared/lib/instantFormat';

// The Activity feed card (spec #2308, #2311): an activity list that drops
// repeats and stops at three rows.

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

// A league on the page: Activity is hidden on a first run.
const mockFeeds = ({ notifications = [] } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications, unread: 0 } });
    return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers', my_team_id: 10, draft_status: 'pending' }] });
  });
};

beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const note = (id, message, league_name, created_at) => ({ id, message, league_name, created_at });

test('Activity drops a repeated (message, league) pair, keeps the newest, and shows at most 3 rows', async () => {
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

  // Two Waiver rows (one per league), the older Sunday Ballers repeat gone.
  expect(screen.getAllByText('Waiver claim processed')).toHaveLength(2);
  expect(screen.getByText(`Sunday Ballers · ${formatInstant('2026-10-12T12:00:00.000Z', 'day')}`)).toBeInTheDocument();
  expect(screen.getByText(`Office League · ${formatInstant('2026-10-04T12:00:00.000Z', 'day')}`)).toBeInTheDocument();
  expect(screen.getByText(`Sunday Ballers · ${formatInstant('2026-10-03T12:00:00.000Z', 'day')}`)).toBeInTheDocument();
  expect(screen.queryByText(`Sunday Ballers · ${formatInstant('2026-10-05T12:00:00.000Z', 'day')}`)).not.toBeInTheDocument();
  // Capped at three rows.
  expect(screen.queryByText('Draft starts soon')).not.toBeInTheDocument();
});

test('an activity row with no league name shows just the date', async () => {
  mockFeeds({ notifications: [note(1, 'Welcome to the league', null, '2026-10-12T12:00:00.000Z')] });
  renderWithProviders(<UserPage />, { state: baseState });

  await screen.findByText('Welcome to the league');
  expect(screen.getByText(formatInstant('2026-10-12T12:00:00.000Z', 'day'))).toBeInTheDocument();
});
