import React from 'react';
import { screen, within, act } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import LeagueStatusGrid from './LeagueStatusGrid';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// Home critique 2 and 3 (#2308, #2311), first run: one Create and one way to
// Join, and copy that says the app is free and names fantasy and pick'em. The
// promise itself (heading, steps, mock-draft line) is in UserPage.test.jsx.

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const flushEffects = () => act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));

const mountFirstRun = async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  const empty = await screen.findByTestId('leagues-empty-state');
  await flushEffects();
  return empty;
};

afterEach(() => {
  jest.clearAllMocks();
});

test('a first run shows exactly one Create league button and one invite-code button', async () => {
  await mountFirstRun();
  expect(screen.getAllByRole('button', { name: 'Create league' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'I have an invite code' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Join league' })).not.toBeInTheDocument();
  expect(within(screen.getByTestId('dashboard-hero')).queryByRole('button', { name: /league$/ })).not.toBeInTheDocument();
});

test('the empty-state copy says the app is free and names fantasy and pick\'em', async () => {
  const empty = await mountFirstRun();
  const text = empty.textContent;
  expect(text).toMatch(/free/i);
  expect(text).toMatch(/fantasy/i);
  expect(text).toMatch(/pick'em/i);
  expect(text).not.toContain('—');
});

test('the pressed league filter is not a filled contained button', () => {
  const leagues = [
    { id: 1, name: 'A', my_team_id: 1, draft_status: 'pending' },
    { id: 2, name: 'B', my_team_id: 2, draft_status: 'pending' },
  ];
  renderWithProviders(<LeagueStatusGrid leagues={leagues} />, { state: baseState });
  const group = screen.getByRole('group', { name: 'Filter leagues' });
  const buttons = within(group).getAllByRole('button');
  expect(buttons.length).toBeGreaterThan(0);
  const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
  expect(pressed).toHaveLength(1);
  buttons.forEach((b) => expect(b).not.toHaveClass('MuiButton-contained'));
});
