import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import Nav from './Nav';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

beforeEach(() => {
  apiClient.get.mockResolvedValue({ data: { notifications: [], unread: 0 } });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a "Login / Register" link when no user is logged in', () => {
  renderWithProviders(<Nav />, { state: { user: {} } });

  expect(screen.getByRole('link', { name: /login \/ register/i })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'League' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Discover Leagues' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Notification Settings' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Log Out' })).not.toBeInTheDocument();
});

test('shows the full authenticated nav when a user is logged in', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });

  expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/user');
  expect(screen.getByRole('link', { name: 'League' })).toHaveAttribute('href', '/league');
  expect(screen.getByRole('link', { name: 'Discover Leagues' })).toHaveAttribute('href', '/discover');
  expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('href', '/player');
  expect(screen.getByRole('link', { name: 'My Team' })).toHaveAttribute('href', '/team');
  expect(screen.queryByRole('link', { name: /login \/ register/i })).not.toBeInTheDocument();
});

test('exposes Notification Settings and Log Out from the profile menu', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });

  // These moved out of the top-level link row into the account/profile menu.
  expect(screen.queryByRole('menuitem', { name: 'Log Out' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /account menu/i }));

  expect(screen.getByRole('menuitem', { name: 'Notification Settings' })).toHaveAttribute(
    'href',
    '/settings/notifications'
  );
  expect(screen.getByRole('menuitem', { name: 'Log Out' })).toBeInTheDocument();
});

test('the brand link always points at the home route', () => {
  renderWithProviders(<Nav />, { state: { user: {} } });
  expect(screen.getByRole('link', { name: 'Endzone Empire' })).toHaveAttribute('href', '/home');
});

test('shows the notification bell when a user is logged in', () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });
  expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
});

test('hides the notification bell when no user is logged in', () => {
  renderWithProviders(<Nav />, { state: { user: {} } });
  expect(screen.queryByRole('button', { name: /notifications/i })).not.toBeInTheDocument();
});

test('shows the Admin link when the logged-in user is a platform admin', () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice', isPlatformAdmin: true } } });
  expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
});

test('hides the Admin link when the logged-in user is not a platform admin', () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice', isPlatformAdmin: false } } });
  expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
});

test('hides the Admin link when isPlatformAdmin is undefined', () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });
  expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
});
