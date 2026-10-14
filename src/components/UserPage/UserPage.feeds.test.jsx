import React from 'react';
import { screen, act } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { invalidate } from '../../lib/resourceCache';
import { formatInstant } from '../../shared/lib/instantFormat';

// The Latest NFL News and Activity feed cards (spec #2308): a quiet dated news
// list, and an activity list that drops repeats and stops at three rows.

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

const flushEffects = () => act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));

const mockFeeds = ({ news = [], notifications = [] } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/news') return Promise.resolve({ data: news });
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications, unread: 0 } });
    return Promise.resolve({ data: [] }); // /api/league and the rest
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

test('News rows show a dim date when the source has one and leave it out when it does not', async () => {
  mockFeeds({
    news: [
      { title: 'Star RB questionable', link: 'https://example.com/a', published: '2026-10-12T12:00:00Z' },
      { title: 'Coach on the hot seat', link: 'https://example.com/b' },
    ],
  });
  renderWithProviders(<UserPage />, { state: baseState });
  await screen.findByRole('link', { name: /Star RB questionable/ });
  await flushEffects();

  expect(screen.getByText(formatInstant('2026-10-12T12:00:00Z', 'day'))).toBeInTheDocument();
  // One date line for two rows: the undated headline gets none.
  expect(screen.getAllByText(/^[A-Z][a-z]{2} [0-9]{1,2}$/)).toHaveLength(1);
  expect(screen.getByRole('link', { name: /Coach on the hot seat/ })).toBeInTheDocument();
});

test('news links are 44px targets in a quieter weight than the old 600', async () => {
  mockFeeds({ news: [{ title: 'Star RB questionable', link: 'https://example.com/a' }] });
  renderWithProviders(<UserPage />, { state: baseState });

  const link = await screen.findByRole('link', { name: /Star RB questionable/ });
  expect(link).toHaveStyle({ minHeight: '44px', fontWeight: '500' });
});
