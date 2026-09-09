import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import JoinRequests from '../index';

/**
 * join-requests widget tests (#1109, console-only): the commissioner-console
 * card listing pending join requests, composing the `decide-join-request`
 * feature per row. The widget reads the shared league cache (useLeague /
 * ADR 0004) for its own three-clause gate - the same one
 * `useCommissionerPanel` uses for this same queue - so this file mocks the
 * whole apiClient the way that widget's own test file does.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

beforeEach(() => {
  // The league read is a shared cached resource (ADR 0004) and is module
  // state that outlives a test, so it is cleared whole rather than per key.
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const leagueResponse = ({ league = {}, teams = [], viewerTeamId = 1 } = {}) => ({
  data: {
    viewerTeamId,
    league: { id: 42, name: 'MinneApple', is_commissioner: true, ...league },
    teams,
  },
});

const screenedPublicLeague = (overrides = {}) => ({ is_public: true, join_approval: true, ...overrides });

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) return Promise.resolve(value);
    }
    return Promise.resolve({ data: [] });
  });
};

const renderWidget = (leagueId = 42) => renderWithProviders(<JoinRequests leagueId={leagueId} />);

const getUrls = () => apiClient.get.mock.calls.map(([url]) => url);
const joinRequestUrls = () => getUrls().filter((url) => url.includes('/join-requests'));

// Lets every effect a resolved league read could start actually start, for
// the cases that assert a request was NOT made (mirrors
// CommissionerPanel.test.jsx's own settleReads: the league read landing is
// what lets the model decide whether the join-requests URL is null, and that
// decision runs in a second effect pass).
const settleReads = async () => {
  await waitFor(() => expect(getUrls()).toContain('/api/league/42'));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};

const pendingRow = (overrides = {}) => ({
  id: 7,
  team_name: 'Gridiron Gang',
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

test('two pending rows render their proposed names and relative times', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: screenedPublicLeague() }),
    '/api/league/42/join-requests': {
      data: [
        pendingRow({ id: 7, team_name: 'Gridiron Gang' }),
        pendingRow({ id: 8, team_name: 'Sunday Ballers' }),
      ],
    },
  });
  renderWidget();

  expect(await screen.findByText(/Gridiron Gang/)).toHaveTextContent('requested 2h ago');
  expect(screen.getByText(/Sunday Ballers/)).toHaveTextContent('requested 2h ago');
  expect(screen.getByTestId('join-requests')).toHaveTextContent('Join requests');
});

test('Approve posts { approve: true } and the list re-reads', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: screenedPublicLeague() }),
    '/api/league/42/join-requests': { data: [pendingRow()] },
  });
  apiClient.post.mockResolvedValue({ data: { status: 'approved' } });
  renderWidget();

  await screen.findByText(/Gridiron Gang/);
  const before = joinRequestUrls().length;

  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/league/42/join-requests/7/decide',
    { approve: true }
  ));
  // The re-read: a second GET against the same endpoint, not merely a local
  // splice of the row out of state.
  await waitFor(() => expect(joinRequestUrls().length).toBeGreaterThan(before));
});

test('a 409 refusal renders the server sentence inline and the row stays', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: screenedPublicLeague() }),
    '/api/league/42/join-requests': { data: [pendingRow()] },
  });
  apiClient.post.mockRejectedValue({ response: { status: 409, data: { error: 'league is full' } } });
  renderWidget();

  await screen.findByText(/Gridiron Gang/);
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('league is full');
  expect(screen.getByText(/Gridiron Gang/)).toBeInTheDocument();
});

test('a private league fires no read', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { is_public: false, join_approval: true } }),
  });
  renderWidget();
  await settleReads();

  expect(joinRequestUrls()).toEqual([]);
  expect(screen.queryByTestId('join-requests')).not.toBeInTheDocument();
});

test('a league that does not screen joins fires no read', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { is_public: true, join_approval: false } }),
  });
  renderWidget();
  await settleReads();

  expect(joinRequestUrls()).toEqual([]);
  expect(screen.queryByTestId('join-requests')).not.toBeInTheDocument();
});

test('an empty queue renders the settled sentence', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: screenedPublicLeague() }),
    '/api/league/42/join-requests': { data: [] },
  });
  renderWidget();

  expect(await screen.findByText('No pending join requests.')).toBeInTheDocument();
});

// The red-tell the ticket names by name: only the Approve case may go red on
// a copy-paste of the wrong boolean into either button's handler.
test('red-tell: the Approve button never posts { approve: false }', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: screenedPublicLeague() }),
    '/api/league/42/join-requests': { data: [pendingRow()] },
  });
  apiClient.post.mockResolvedValue({ data: { status: 'approved' } });
  renderWidget();

  await screen.findByText(/Gridiron Gang/);
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  expect(apiClient.post).not.toHaveBeenCalledWith(expect.any(String), { approve: false });
});
