import React from 'react';
import { screen, waitFor } from '@testing-library/react';
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

test('shows separate "Log In" and "Register" links when no user is logged in', () => {
  renderWithProviders(<Nav />, { state: { user: {} } });

  expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/registration');
  expect(screen.queryByRole('link', { name: 'League' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Discover' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Notification Settings' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Log Out' })).not.toBeInTheDocument();
});

test('shows the full authenticated nav when a user is logged in', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });

  expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/user');
  expect(screen.getByRole('link', { name: 'League' })).toHaveAttribute('href', '/league');
  expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover');
  expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('href', '/player');
  expect(screen.getByRole('link', { name: 'Roster' })).toHaveAttribute('href', '/team');
  expect(screen.queryByRole('link', { name: /login \/ register/i })).not.toBeInTheDocument();
});

test('opens the authenticated mobile navigation drawer and closes it after navigation', async () => {
  const user = userEvent.setup();
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });

  await user.click(screen.getByRole('button', { name: /open navigation menu/i }));
  const drawerHome = screen.getAllByRole('link', { name: 'Home' }).find((link) => link.closest('.MuiDrawer-root'));
  expect(drawerHome).toHaveAttribute('href', '/user');

  await user.click(drawerHome);
  await waitFor(() => expect(drawerHome).not.toBeVisible());
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

test('shows Admin in the account menu when the logged-in user is a platform admin', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice', isPlatformAdmin: true } } });
  await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
  expect(screen.getByRole('menuitem', { name: 'Admin' })).toHaveAttribute('href', '/admin');
});

test('hides Admin from the account menu when the logged-in user is not a platform admin', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice', isPlatformAdmin: false } } });
  await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
  expect(screen.queryByRole('menuitem', { name: 'Admin' })).not.toBeInTheDocument();
});

test('hides Admin from the account menu when isPlatformAdmin is undefined', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });
  await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
  expect(screen.queryByRole('menuitem', { name: 'Admin' })).not.toBeInTheDocument();
});
