import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import DraftSettings from './DraftSettings';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const leagueResponse = (overrides = {}) => ({
  data: {
    league: {
      id: 1, name: 'Sunday Ballers', owner_id: 1, draft_status: 'pending', draft_type: 'snake', draft_rotation: 'snake',
      roster_limit: 4, roster_slots: [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }],
      bench_slots: 1, ir_slots: 0, position_caps: {}, pick_time_seconds: 60, autodraft_delay_seconds: 10,
      ...overrides,
    },
    teams: [{ id: 1, name: "Alice's Team", owner: 'alice', draft_position: 1, draft_ready: true }, { id: 2, name: "Bob's Team", owner: 'bob', draft_position: 2, draft_ready: false }],
  },
});

function mockData(overrides = {}) {
  const response = leagueResponse(overrides);
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1') return Promise.resolve(response);
    if (url === '/api/draft/league/1/keepers') return Promise.resolve({ data: [] });
    if (url === '/api/draft/league/1/keeper-candidates') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderSettings() {
  return renderWithProviders(<SnackbarProvider><DraftSettings /></SnackbarProvider>, {
    path: '/league/:leagueId/draft-settings', route: '/league/1/draft-settings', state: { user: { id: 1, username: 'alice' } },
  });
}

beforeEach(() => { clearLeagueCache(); });
afterEach(() => { clearLeagueCache(); jest.clearAllMocks(); });

test('shows auction controls only for salary-cap auction drafts', async () => {
  mockData();
  renderSettings();
  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Auction' }));
  expect(screen.getByText(/Select Salary-cap auction/)).toBeInTheDocument();
});

test('shows saved auction inputs for salary-cap auction drafts', async () => {
  mockData({ draft_type: 'auction' });
  renderSettings();
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Auction' }));
  expect(await screen.findByRole('spinbutton', { name: 'Budget' })).toBeInTheDocument();
  expect(screen.getByText(/stored now for the future salary-cap draft engine/i)).toBeInTheDocument();
});

test('saves pending-draft timer and delay through the league settings endpoint', async () => {
  mockData();
  apiClient.put.mockResolvedValue({ data: {} });
  renderSettings();
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save timer' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', { pickTimeSeconds: 60, autodraftDelaySeconds: 10 }));
});

test('uses the clock endpoint while active and locks draft setup panels', async () => {
  mockData({ draft_status: 'active' });
  apiClient.post.mockResolvedValue({ data: {} });
  renderSettings();
  expect(await screen.findByText(/Draft setup is locked after the draft starts/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save draft type' })).toBeDisabled();
  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save timer' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/clock', { pickTimeSeconds: 60 }));
});

test('requires confirmation before starting the draft immediately', async () => {
  mockData();
  apiClient.post.mockResolvedValue({ data: {} });
  renderSettings();
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start Draft Now' }));
  expect(screen.getByText(/starts immediately for all 2 managers/i)).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Start now' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/start-draft'));
});
