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

// Home critique 2 (#2308), first run: one Create and one Join, a Draft Sim
// card, and copy that says the app is free and names fantasy and pick'em.

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

test('a first run shows exactly one Create league and one Join league button', async () => {
  await mountFirstRun();
  expect(screen.getAllByRole('button', { name: 'Create league' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Join league' })).toHaveLength(1);
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

test('Draft Sim is a card that links to /draft-sim, with a description', async () => {
  const empty = await mountFirstRun();
  const card = within(empty).getByRole('link', { name: 'Practice in Draft Sim' });
  expect(card).toHaveAttribute('href', '/draft-sim');
  expect(card).toHaveTextContent('Run a mock draft against the clock, no league needed.');
  expect(within(empty).getByRole('link', { name: 'Find a public league' })).toHaveAttribute('href', '/discover');
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
