import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
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
  // See the comment on the notification-bell tests below: let
  // NotificationBell's own mount fetch settle.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

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
  // Let NotificationBell's own mount fetch settle before interacting with
  // the drawer, whose own transition/navigation timing is unrelated and
  // otherwise races it past the end of the test.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await user.click(screen.getByRole('button', { name: /open navigation menu/i }));
  const drawerNav = screen.getByRole('navigation', { name: 'Navigation menu' });
  const drawerHome = within(drawerNav).getByRole('link', { name: 'Home' });
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

test('exposes the primary links as a named navigation landmark, not a bare div', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });
  // A logged-in Nav mounts NotificationBell, which fetches on mount
  // regardless of what this test asserts. Let it settle before the test
  // ends, or its update lands after Jest has moved on.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(nav).getByRole('link', { name: 'League' })).toBeInTheDocument();
});

test('the top bar and drawer navigation landmarks carry distinct accessible names (#322)', async () => {
  const user = userEvent.setup();
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  // The top bar's landmark, before the drawer ever opens.
  expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();

  // Opening the drawer mounts its own "Navigation menu" landmark. MUI's
  // modal focus trap marks the rest of the page aria-hidden while it's
  // open, so the top-bar landmark is the drawer's own name at this point -
  // the two are asserted independently rather than as simultaneously
  // accessible, which is what a distinct name buys either way: an unlabeled
  // getByRole('navigation') would never have been ambiguous here.
  await user.click(screen.getByRole('button', { name: 'open navigation menu' }));
  const drawerNav = screen.getByRole('navigation', { name: 'Navigation menu' });
  expect(within(drawerNav).getByRole('link', { name: 'League' })).toBeInTheDocument();
});

test('shows the notification bell when a user is logged in', async () => {
  renderWithProviders(<Nav />, { state: { user: { id: 1, username: 'alice' } } });
  // See the comment above: let NotificationBell's own mount fetch settle.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
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
