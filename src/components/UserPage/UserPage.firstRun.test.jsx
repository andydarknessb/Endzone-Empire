import React from 'react';
import { screen, within, act } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// Home critique 2 and 3 (#2308, #2311), first run (build-firstrun.js): one
// Create and one way to Join, both play cards, and copy that says the app is
// free and names fantasy and pick'em. The layout and steps are in
// UserPage.test.jsx.

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const flushEffects = () => act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));

const mountFirstRun = async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  const start = await screen.findByTestId('leagues-empty-state');
  await flushEffects();
  return start;
};

afterEach(() => {
  jest.clearAllMocks();
});

test('a first run shows exactly one Create a league and one Join with a code, and no header pair', async () => {
  await mountFirstRun();
  expect(screen.getAllByRole('button', { name: /Create a league/ })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: /Join with a code/ })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Join a league' })).not.toBeInTheDocument();
  expect(within(screen.getByTestId('dashboard-hero')).queryByRole('button')).not.toBeInTheDocument();
});

test('Create is the page\'s one filled action; Join is outlined', async () => {
  const start = await mountFirstRun();
  // the filled foot is a data attribute with no role
  /* eslint-disable testing-library/no-node-access */
  const filled = start.querySelectorAll('[data-filled="true"]');
  expect(filled).toHaveLength(1);
  expect(filled[0]).toHaveTextContent('Create a league');
  const join = within(start).getByRole('button', { name: /Join with a code/ });
  expect(join.querySelector('[data-filled]')).toBeNull();
  /* eslint-enable testing-library/no-node-access */
});

test('the intro copy says the app is free and names fantasy and pick\'em', async () => {
  await mountFirstRun();
  const text = screen.getByTestId('dashboard-hero').textContent;
  expect(text).toMatch(/free/i);
  expect(text).toMatch(/fantasy/i);
  expect(text).toMatch(/pick'em/i);
  expect(text).not.toContain('—');
});
