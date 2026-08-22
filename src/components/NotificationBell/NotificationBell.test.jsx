import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import NotificationBell from './NotificationBell';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

const notificationsResponse = (overrides = {}) => ({
  notifications: [
    { id: 1, type: 'trade', message: 'You have a new trade offer', read: false, created_at: '2026-07-01T12:00:00Z', league_id: 1 },
    { id: 2, type: 'waiver', message: 'Your waiver claim was processed', read: true, created_at: '2026-06-30T12:00:00Z', league_id: 1 },
  ],
  unread: 2,
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders a badge with the unread count', async () => {
  apiClient.get.mockResolvedValue({ data: notificationsResponse() });

  renderWithProviders(<NotificationBell />);

  expect(await screen.findByText('2')).toBeInTheDocument();
});

test('opens the menu and lists notification messages', async () => {
  apiClient.get.mockResolvedValue({ data: notificationsResponse() });
  apiClient.put.mockResolvedValue({});

  renderWithProviders(<NotificationBell />);
  await screen.findByText('2');

  await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

  expect(await screen.findByText('You have a new trade offer')).toBeInTheDocument();
  expect(screen.getByText('Your waiver claim was processed')).toBeInTheDocument();
});

test('"Mark all read" marks all read and clears the badge', async () => {
  apiClient.get.mockResolvedValue({ data: notificationsResponse() });
  apiClient.put.mockResolvedValue({});

  renderWithProviders(<NotificationBell />);
  await screen.findByText('2');

  await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
  await userEvent.click(await screen.findByRole('button', { name: /mark all read/i }));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/notifications/read'));
  // MUI's Badge keeps the last non-zero content in the DOM for its exit transition,
  // so assert on the "invisible" class rather than the text disappearing.
  await waitFor(() =>
    expect(document.querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible')
  );
});

test('groups notifications under league subheaders across multiple leagues', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      notifications: [
        { id: 1, message: 'Trade offer', read: false, created_at: '2026-07-01T12:00:00Z', league_id: 1, league_name: 'Sunday Ballers' },
        { id: 2, message: 'Waiver processed', read: true, created_at: '2026-06-30T12:00:00Z', league_id: 2, league_name: 'Monday Mayhem' },
      ],
      unread: 1,
    },
  });

  renderWithProviders(<NotificationBell />);
  await screen.findByText('1');
  await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText('Monday Mayhem')).toBeInTheDocument();
});

test('shows "No notifications" when there are none', async () => {
  apiClient.get.mockResolvedValue({ data: { notifications: [], unread: 0 } });

  renderWithProviders(<NotificationBell />);
  await screen.findByRole('button', { name: /notifications/i });

  await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

  expect(await screen.findByText('No notifications')).toBeInTheDocument();
});

test('fetch errors fail silently and do not crash', async () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  apiClient.get.mockRejectedValue(new Error('network down'));

  renderWithProviders(<NotificationBell />);

  await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();

  consoleErrorSpy.mockRestore();
});
