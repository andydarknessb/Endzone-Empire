import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router-dom';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import DraftSettings from './DraftSettings';
import NavigationGuard from '../NavigationGuard/NavigationGuard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const leagueResponse = (overrides = {}) => ({
  data: {
    league: {
      id: 1, name: 'Sunday Ballers', owner_id: 1, draft_status: 'pending', draft_type: 'snake', draft_rotation: 'snake', min_teams: 2,
      roster_limit: 4, roster_slots: [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }],
      bench_slots: 1, ir_slots: 0, position_caps: {}, pick_time_seconds: 60, autodraft_delay_seconds: 10,
      ...overrides,
    },
    teams: [
      { id: 1, name: "Alice's Team", owner: 'alice', draft_position: 1, faab_remaining: 100, locked: false, draft_ready: true, roster_count: 0, total_points: '0' },
      { id: 2, name: "Bob's Team", owner: 'bob', draft_position: 2, faab_remaining: 100, locked: false, draft_ready: false, roster_count: 0, total_points: '0' },
    ],
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

function renderSettings({ withLeaveLink = false } = {}) {
  return renderWithProviders(<NavigationGuard>{withLeaveLink && <Link to="/league/1">Leave settings</Link>}<SnackbarProvider><DraftSettings /></SnackbarProvider></NavigationGuard>, {
    path: '/league/:leagueId/draft-settings', route: '/league/1/draft-settings', state: { user: { id: 1, username: 'alice' } },
  });
}

beforeEach(() => { clearLeagueCache(); });
afterEach(() => { clearLeagueCache(); jest.clearAllMocks(); });

test('associates each tab with its panel via matching ARIA ids', async () => {
  mockData();
  renderSettings();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('tablist')).toHaveAccessibleName('Draft settings sections');

  const typeTabId = screen.getByRole('tab', { name: 'Draft type' }).id;
  const typePanelId = screen.getByRole('tabpanel').id;
  expect(typeTabId).toBeTruthy();
  expect(typePanelId).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Draft type' })).toHaveAttribute('aria-controls', typePanelId);
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', typeTabId);

  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));
  const timerTabId = screen.getByRole('tab', { name: 'Timer' }).id;
  const timerPanelId = screen.getByRole('tabpanel').id;
  expect(screen.getByRole('tab', { name: 'Timer' })).toHaveAttribute('aria-controls', timerPanelId);
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', timerTabId);
  expect(timerPanelId).not.toBe(typePanelId);
});

test('shows auction controls only for salary-cap auction drafts', async () => {
  mockData();
  renderSettings();
  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Auction' }));
  expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument();
  expect(screen.getByText(/Select Salary-cap auction/)).toBeInTheDocument();
});

test('keeper endpoint failure does not block non-keeper tabs', async () => {
  const response = leagueResponse();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1') return Promise.resolve(response);
    if (url === '/api/draft/league/1/keepers') return Promise.resolve({ data: [] });
    if (url === '/api/draft/league/1/keeper-candidates') return Promise.reject(new Error('Keeper candidate service unavailable'));
    return Promise.resolve({ data: [] });
  });
  renderSettings();
  await screen.findByText('Sunday Ballers');

  expect(apiClient.get).not.toHaveBeenCalledWith('/api/draft/league/1/keepers');
  await userEvent.click(screen.getByRole('tab', { name: 'Keepers' }));
  expect(await screen.findByText('Unable to load keeper data: Keeper candidate service unavailable')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));
  expect(screen.getByRole('button', { name: 'Save timer' })).toBeInTheDocument();
  expect(screen.queryByText(/Unable to load keeper data/)).not.toBeInTheDocument();
});

test('Keepers tab lazy-loads and retries its localized error state', async () => {
  const response = leagueResponse({ keepers_enabled: true, keeper_count: 1, keeper_lock_at: null });
  let keeperAttempts = 0;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1') return Promise.resolve(response);
    if (url === '/api/draft/league/1/keepers') {
      keeperAttempts += 1;
      return keeperAttempts === 1
        ? Promise.reject(new Error('Keeper service unavailable'))
        : Promise.resolve({ data: [] });
    }
    if (url === '/api/draft/league/1/keeper-candidates') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  renderSettings();
  await screen.findByText('Sunday Ballers');

  expect(keeperAttempts).toBe(0);
  await userEvent.click(screen.getByRole('tab', { name: 'Keepers' }));
  expect(await screen.findByText('Unable to load keeper data: Keeper service unavailable')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Retry keeper data' }));
  expect(await screen.findByRole('checkbox', { name: 'Enable keepers' })).toBeInTheDocument();
  expect(keeperAttempts).toBe(2);
  expect(screen.queryByText(/Unable to load keeper data/)).not.toBeInTheDocument();
});

test('confirms before discarding unsaved edits when switching tabs', async () => {
  mockData();
  renderSettings();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('radio', { name: /Autopick/i }));
  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));

  expect(screen.getByText('You have unsaved changes — discard them?')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByText('You have unsaved changes — discard them?')).not.toBeInTheDocument());
  expect(screen.getByRole('tab', { name: 'Draft type' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('radio', { name: /Autopick/i })).toBeChecked();

  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.queryByText('You have unsaved changes — discard them?')).not.toBeInTheDocument());
  expect(screen.getByRole('tab', { name: 'Timer' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Save timer' })).toBeInTheDocument();
});

test('uses the same confirmation before navigating away from draft settings', async () => {
  mockData();
  renderSettings({ withLeaveLink: true });
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('radio', { name: /Offline/i }));
  await userEvent.click(screen.getByRole('link', { name: 'Leave settings' }));

  expect(screen.getByText('You have unsaved changes — discard them?')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByText('You have unsaved changes — discard them?')).not.toBeInTheDocument());
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Leave settings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.queryByText('Sunday Ballers')).not.toBeInTheDocument());
});

test('does not expose auction settings from an unsaved draft type selection', async () => {
  mockData();
  renderSettings();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('radio', { name: /Salary-cap auction/i }));
  await userEvent.click(screen.getByRole('tab', { name: 'Auction' }));
  expect(screen.getByText('You have unsaved changes — discard them?')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.queryByText('You have unsaved changes — discard them?')).not.toBeInTheDocument());
  expect(screen.getByText(/Select Salary-cap auction under Draft type/)).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton', { name: 'Budget' })).not.toBeInTheDocument();
});

test('guards browser back navigation when the active tab has unsaved changes', async () => {
  const originalState = window.history.state;
  const originalUrl = window.location.href;
  window.history.replaceState({ ...(originalState || {}), idx: 5 }, '', originalUrl);
  const goSpy = jest.spyOn(window.history, 'go').mockImplementation(() => {});
  try {
    mockData();
    renderSettings();
    await screen.findByText('Sunday Ballers');
    await userEvent.click(screen.getByRole('radio', { name: /Offline/i }));
    await act(async () => {});

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 4 } }));
    });

    expect(screen.getByRole('dialog', { name: /You have unsaved changes/ })).toBeInTheDocument();
    expect(goSpy).toHaveBeenCalledWith(1);
  } finally {
    goSpy.mockRestore();
    window.history.replaceState(originalState, '', originalUrl);
  }
});

test('shows saved auction inputs for salary-cap auction drafts', async () => {
  mockData({ draft_type: 'auction' });
  renderSettings();
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Auction' }));
  expect(await screen.findByRole('spinbutton', { name: 'Budget' })).toBeInTheDocument();
  expect(screen.getByText(/stored now for the future salary-cap draft engine/i)).toBeInTheDocument();
});

test('shows readiness values returned by the league-detail API', async () => {
  mockData();
  renderSettings();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('tab', { name: 'Readiness' }));

  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 managers ready');
  expect(screen.getByText("Alice's Team: Ready")).toBeInTheDocument();
  expect(screen.getByText("Bob's Team: Not ready")).toBeInTheDocument();
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

test('requires confirmation and closes the dialog after starting the draft', async () => {
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
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start draft now?' })).not.toBeInTheDocument());
});

test('keeps the start confirmation open with the API error when starting fails', async () => {
  mockData();
  apiClient.post.mockRejectedValueOnce({ response: { data: { error: 'Every team must be ready.' } } });
  renderSettings();
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start Draft Now' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start now' }));

  const dialog = screen.getByRole('dialog', { name: 'Start draft now?' });
  expect(await within(dialog).findByText('Every team must be ready.')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Start now' })).toBeEnabled();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

test('uses a successful schedule PUT as the baseline when the follow-up refetch fails', async () => {
  const response = leagueResponse();
  mockData();
  renderSettings();
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));

  const localDraftDate = new Date(Date.now() + 10 * 60000);
  const offset = localDraftDate.getTimezoneOffset() * 60000;
  const inputValue = new Date(localDraftDate.getTime() - offset).toISOString().slice(0, 16);
  const savedDraftDate = new Date(inputValue).toISOString();
  apiClient.put.mockResolvedValue({ data: { ...response.data.league, draft_date: savedDraftDate } });
  apiClient.get
    .mockRejectedValueOnce(new Error('League refresh unavailable'))
    .mockResolvedValueOnce({ data: { ...response.data, league: { ...response.data.league, draft_date: savedDraftDate } } });

  fireEvent.change(screen.getByLabelText('Draft date and time'), { target: { value: inputValue } });
  await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

  expect(await screen.findByText('Draft schedule saved')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Draft date and time')).toHaveValue(inputValue));
  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));
  expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save timer' })).toBeInTheDocument();
});

test('saving keeper settings preserves and continues guarding unsaved assignment edits', async () => {
  const response = leagueResponse({ keepers_enabled: true, keeper_count: 2, keeper_lock_at: null });
  let keeperLoads = 0;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1') return Promise.resolve(response);
    if (url === '/api/draft/league/1/keepers') {
      keeperLoads += 1;
      return Promise.resolve({ data: [{ team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 }] });
    }
    if (url === '/api/draft/league/1/keeper-candidates') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  apiClient.put.mockResolvedValue({ data: response.data.league });
  renderSettings();
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Keepers' }));
  await screen.findByRole('checkbox', { name: 'Enable keepers' });

  await userEvent.click(screen.getByLabelText('Round'));
  await userEvent.click(screen.getByRole('option', { name: '2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save keeper settings' }));

  expect(screen.getByRole('dialog', { name: 'Save keeper settings?' })).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Save settings and keep edits' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
    keepersEnabled: true,
    keeperCount: 2,
    keeperLockAt: null,
  }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save keeper settings?' })).not.toBeInTheDocument());
  expect(keeperLoads).toBe(1);
  expect(screen.getByLabelText('Round')).toHaveTextContent('2');
  await act(async () => {});

  await userEvent.click(screen.getByRole('tab', { name: 'Timer' }));
  expect(screen.getByRole('dialog', { name: /You have unsaved changes/ })).toBeInTheDocument();
});
