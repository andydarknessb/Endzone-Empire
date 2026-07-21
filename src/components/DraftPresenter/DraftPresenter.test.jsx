import React from 'react';
import { act, screen } from '@testing-library/react';
import axios from 'axios';
import renderWithProviders from '../../test-utils/renderWithProviders';
import DraftPresenter from './DraftPresenter';

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => ({ get: jest.fn() })) },
}));

const mockPresenterGet = axios.create.mock.results[0].value.get;

const draftState = {
  league: {
    name: 'Sunday Ballers',
    draft_status: 'active',
    roster_limit: 2,
    pick_deadline_at: '2099-09-01T12:01:00.000Z',
  },
  teams: [
    { id: 1, name: 'North Stars', draft_position: 1 },
    { id: 2, name: 'South Stars', draft_position: 2 },
  ],
  picks: [
    { pick_number: 1, team_id: 1, player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: false },
  ],
  onTheClock: { id: 2, name: 'South Stars' },
};

beforeEach(() => {
  mockPresenterGet.mockReset();
  mockPresenterGet.mockResolvedValue({ data: draftState });
});

afterEach(() => {
  jest.useRealTimers();
});

test('renders a public draft board from the presenter token route', async () => {
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  expect(await screen.findByRole('heading', { name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(screen.getByText('South Stars is on the clock')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Recent picks' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Round 1 pick 1, North Stars: Josh Allen' })).not.toBeInTheDocument();
  expect(mockPresenterGet).toHaveBeenCalledWith('/api/draft/board/share-token');
});

test('polls the public board every five seconds', async () => {
  jest.useFakeTimers();
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  await act(async () => {
    await Promise.resolve();
  });
  expect(mockPresenterGet).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
  });
  expect(mockPresenterGet).toHaveBeenCalledTimes(2);
});
