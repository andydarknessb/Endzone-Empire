import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket } from '../../api/socket';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import LeagueDashboard from './LeagueDashboard';
import FantasyOnly from '../common/FantasyOnly';
import { clearLeagueCache } from '../../hooks/useLeague';
import { clearPickemStandingsCache } from '../../hooks/usePickemStandings';
import PickemStandings from '../LeaguePickem/PickemStandings';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn((socket, handler) => socket.io.on('reconnect', handler)),
}));

beforeEach(() => {
  // The dashboard reads the league (and the pick'em standings) through the
  // shared resource cache, which is module state and outlives a test: without
  // these clears the next test would render the previous test's rows.
  clearLeagueCache();
  clearPickemStandingsCache();
  createDraftSocket.mockReturnValue({
    on: jest.fn(),
    io: { on: jest.fn() },
    emit: jest.fn(),
    disconnect: jest.fn(),
  });
  // ChatPanel marks the chat read (fire-and-forget POST) whenever the drawer
  // opens; resolve it so opening the drawer in any test can't reject.
  apiClient.post.mockResolvedValue({ data: { ok: true } });
});

const renderDashboard = (leagueId = 1) =>
  renderWithProviders(<LeagueDashboard />, {
    path: '/league/:leagueId',
    route: `/league/${leagueId}`,
  });

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderDashboardWithToasts = (leagueId = 1) =>
  renderWithProviders(
    <SnackbarProvider>
      <LeagueDashboard />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId',
      route: `/league/${leagueId}`,
    }
  );

const leagueResponse = (overrides = {}) => ({
  data: {
    // The viewer holds Team 1, and Team 1 is the league creator's: the
    // viewer-relative field lives at the response root (#113, contract #112).
    viewerTeamId: 1,
    league: {
      id: 1,
      name: 'Sunday Ballers',
      draft_status: 'pending',
      ownerTeamId: 1,
      roster_limit: 15,
      max_teams: 10,
      invite_code: 'abc123',
      ...overrides,
    },
    teams: [
      { teamId: 1, teamName: "Alice's Team", id: 1, name: "Alice's Team", owner: 'alice', roster_count: 3, total_points: 42.5 },
    ],
  },
});

const userResponse = (overrides = {}) => ({
  data: { id: 1, username: 'alice', ...overrides },
});

const standingsResponse = (overrides = {}) => ({
  data: {
    league: {
      playoff_teams: 4,
      regular_season_weeks: 14,
      season_status: 'regular',
      current_week: 3,
      ...(overrides.league || {}),
    },
    standings: overrides.standings || [
      {
        teamId: 1,
        name: "Alice's Team",
        // The server still sends this in the expand phase; the point is that
        // no league surface renders it any more (#113, contracted by #115).
        owner: 'alice',
        wins: 2,
        losses: 1,
        ties: 0,
        pf: 312.5,
        pa: 280.1,
        streak: 'W2',
        winPct: 0.667,
        rank: 1,
        playoffSeed: 1,
      },
    ],
  },
});

/**
 * Build a URL-keyed apiClient.get mock. `overrides` maps a URL (matched
 * exactly or as a trailing path segment via endsWith) to a resolved value, a
 * { reject: <error> } marker, or a { pending: true } marker for a request that
 * stays on the wire for the rest of the test. Falls back to a generic empty
 * response for unmatched URLs — e.g. ChatPanel's `/chat` fetch, which no
 * test needs to override. Exact/suffix matching (rather than a generic
 * substring `includes`) keeps a key like '/api/league/1' from also
 * matching nested requests such as '/api/league/1/chat'.
 */
const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) {
        if (value && value.reject) {
          return Promise.reject(value.reject);
        }
        if (value && value.pending) {
          return new Promise(() => {}); // never settles
        }
        return Promise.resolve(value);
      }
    }
    // RecapCard and DraftGradesCard hide themselves on 404 ("not generated
    // yet"); TrophyCase hides on an empty list. Default the new dashboard
    // GETs to those "nothing to show" shapes so tests that don't care about
    // these cards don't have to think about them — each card has its own
    // dedicated test file, and the integration tests below override these
    // keys explicitly to verify the cards render when data is present.
    if (url.endsWith('/recap') || url.endsWith('/draft-grades')) {
      return Promise.reject({ response: { status: 404 } });
    }
    if (url.endsWith('/trophies')) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [] });
  });
};

const leagueGetCount = (leagueId = 1) =>
  apiClient.get.mock.calls.filter(([url]) => url === `/api/league/${leagueId}`).length;

/**
 * Click something whose handler keeps working after the click itself resolves:
 * the POST, and then the un-awaited refresh() behind it. user-event does not
 * wrap its own waiting in act(), so those later updates would otherwise land
 * outside it and be reported as such.
 */
const clickAndSettle = async (element) => {
  // The act() is for the work that follows the click, not for the click, which
  // is why no-unnecessary-act does not apply here.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  await act(async () => { await userEvent.click(element); });
};

/**
 * A commissioner action fires refresh() without awaiting it, so the toast lands
 * before the reload does. Assert the reload was actually issued and let it
 * settle, so the test observes the refreshed page rather than ending mid-flight.
 */
const settleRefresh = async (leagueId = 1) => {
  await waitFor(() => expect(leagueGetCount(leagueId)).toBeGreaterThanOrEqual(2));
};

afterEach(() => {
  jest.clearAllMocks();
  clearPickemStandingsCache();
});

test('shows a layout-shaped skeleton before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderDashboard();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders league name, status chips, and the standings table', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText('pending')).toBeInTheDocument();
  // Pre-draft: Draft roster size, live-derived (roster_limit minus ir_slots).
  expect(screen.getByText('Draft roster size: 15')).toBeInTheDocument();
  expect(screen.getByText('Teams: 1/10')).toBeInTheDocument();
  expect(screen.getAllByText("Alice's Team").length).toBeGreaterThan(0);
  // The standings identify participants by Team and nothing else: the Owner
  // column beside it printed every other manager's username (#113 criterion
  // 4). The row still arrives carrying `owner`; nothing renders it.
  expect(screen.queryByRole('columnheader', { name: 'Owner' })).not.toBeInTheDocument();
  const standingsRow = screen.getByRole('row', { name: /Alice's Team/ });
  expect(within(standingsRow).queryByText('alice')).not.toBeInTheDocument();
});

// --- Draft roster size / Draft rounds chip (#162) ---
//
// The chip is a draft-preparation fact: it speaks pre-draft and while
// drafting, and goes quiet once the draft is done (2026-08-22 ruling).
// Phase comes from deriveLeaguePhase, never a local guess.

test('pre-draft: the chip reads Draft roster size, IR slots excluded, derived live', async () => {
  mockGetByUrl({
    // roster_limit is IR-inclusive; ir_slots are not drafted, so Draft roster
    // size (17 - 3) is what the Draft room shows a pending draft, not 17.
    '/api/league/1': leagueResponse({ roster_limit: 17, ir_slots: 3 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Draft roster size: 14')).toBeInTheDocument();
  expect(screen.queryByText(/Draft rounds/)).not.toBeInTheDocument();
});

test('drafting: the chip reads the fixed Draft rounds (ADR 0005), not a live recomputation', async () => {
  mockGetByUrl({
    // roster_limit/ir_slots changed after the draft started; draft_rounds
    // (16) is the fixed value snapshotted at draft start and must win.
    '/api/league/1': leagueResponse({
      draft_status: 'active', roster_limit: 99, ir_slots: 99, draft_rounds: 16,
    }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Draft rounds: 16')).toBeInTheDocument();
  expect(screen.queryByText(/Draft roster size/)).not.toBeInTheDocument();
});

test.each([
  ['in-season', { draft_status: 'complete', season_status: 'regular' }],
  ['playoffs', { draft_status: 'complete', season_status: 'playoffs' }],
  ['complete', { draft_status: 'complete', season_status: 'complete' }],
])('%s: no draft roster/rounds chip is rendered', async (_phaseName, overrides) => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(overrides),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByText(/Draft roster size/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Draft rounds/)).not.toBeInTheDocument();
});

test('standings table renders W-L-T, PF, PA, and a streak chip (no redundant playoff-seed pill)', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete' }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  // A record must never wrap at its hyphens (0-0-0 stacked three-high on a
  // phone): header and cell both pin to one line.
  expect(screen.getByText('2-1-0')).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(screen.getByText('W-L-T')).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(screen.getByText('312.5')).toBeInTheDocument();
  expect(screen.getByText('280.1')).toBeInTheDocument();
  expect(screen.getByText('W2')).toBeInTheDocument();
  const pointsForHeader = screen.getByLabelText(/PF: Points for:/i);
  expect(screen.getByLabelText(/PA: Points against:/i)).toBeInTheDocument();
  expect(pointsForHeader.closest('table')).toHaveStyle({ minWidth: '680px' });
  expect(pointsForHeader.closest('.MuiTableContainer-root')).toHaveStyle({
    maxWidth: '100%',
    overflowX: 'auto',
  });
  // The rank column is the single source of truth for standing; the old
  // green "#1" playoff-seed pill next to the team name is gone.
  expect(screen.queryByText('#1')).not.toBeInTheDocument();
});

test('marks the phase-appropriate nav actions as Recommended', async () => {
  // Pre-draft league: only the Draft Room action is recommended.
  mockGetByUrl({
    '/api/league/1': leagueResponse(), // draft_status: 'pending'
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  const { unmount } = renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(within(screen.getByRole('link', { name: 'Draft Room' })).getByText('Recommended')).toBeInTheDocument();
  expect(within(screen.getByRole('link', { name: 'Trades' })).queryByText('Recommended')).not.toBeInTheDocument();

  unmount();
  // Same league id, a different row: the shared entry from the mount above is
  // still fresh, so drop it (with nothing mounted on it) before re-rendering.
  clearLeagueCache();

  // In-season league: weekly-management actions are recommended, the draft is not.
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', season_status: 'regular' }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(within(screen.getByRole('link', { name: 'Set Lineup' })).getByText('Recommended')).toBeInTheDocument();
  expect(within(screen.getByRole('link', { name: 'Draft Room' })).queryByText('Recommended')).not.toBeInTheDocument();
});

test('shows the specific server error message when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'league not found' } } });

  renderDashboard();

  expect(await screen.findByText('league not found')).toBeInTheDocument();
});

test('falls back to a generic message if the initial fetch fails with no error detail', async () => {
  apiClient.get.mockRejectedValue({ message: undefined, response: undefined });

  renderDashboard();

  expect(await screen.findByText('League or user data not available')).toBeInTheDocument();
});

test('keeps the page alive and shows an error alert when the standings fetch fails', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': { reject: { response: { data: { error: 'standings unavailable' } } } },
  });

  renderDashboard();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(await screen.findByText('standings unavailable')).toBeInTheDocument();
});

test('a failed background reload keeps the league on screen under an error banner', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  // The reload a commissioner action (or any clear of the shared entry) starts
  // fails. The page has a league already, so it must not fall back to the
  // skeleton or the error view and lose the tab and form state under it.
  mockGetByUrl({
    '/api/league/1': { reject: { response: { data: { error: 'league unavailable' } } } },
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  await act(async () => { clearLeagueCache(1); });

  expect(await screen.findByText('league unavailable')).toBeInTheDocument();
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.queryByTestId('page-skeleton')).not.toBeInTheDocument();
});

test('an in-flight background reload keeps the dashboard mounted, drawer and all', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');
  await clickAndSettle(screen.getByRole('button', { name: 'Open league chat' }));
  expect(await screen.findByRole('button', { name: 'Close chat' })).toBeInTheDocument();

  // The reload is still on the wire, which is the window the first-load-only
  // guard exists for: blanking the page here would unmount the open drawer and
  // any in-progress form under it. This has to be asserted mid-flight; once
  // the reload settles, loading is false again and a skeleton that flashed is
  // invisible.
  mockGetByUrl({
    '/api/league/1': { pending: true },
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  await act(async () => { clearLeagueCache(1); });

  expect(screen.queryByTestId('page-skeleton')).not.toBeInTheDocument();
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close chat' })).toBeInTheDocument();
});

test('shows the invite code and copies it to the clipboard', async () => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboardWithToasts();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText(/abc123/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc123');
  expect(await screen.findByText('Invite code copied to clipboard!')).toBeInTheDocument();
});

test('copies a full invite link', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    expect.stringContaining('/#/league/join?code=abc123')
  );
});

test('does not render an invite code section when none is present', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ invite_code: undefined }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
});

test('shows "Start Draft" only for the owner while the draft is pending, and starting it refetches', async () => {
  // The server side of the action, so the refetch can be observed landing
  // rather than merely counted: once the draft has started the league row
  // comes back active.
  const gets = {
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  };
  mockGetByUrl(gets);
  apiClient.post.mockImplementation((url) => {
    if (url === '/api/league/1/start-draft') {
      gets['/api/league/1'] = leagueResponse({ draft_status: 'active' });
    }
    return Promise.resolve({});
  });

  renderDashboardWithToasts();
  await screen.findByText('Sunday Ballers');

  const startButton = screen.getByRole('button', { name: 'Start Draft' });
  await clickAndSettle(startButton);

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/start-draft'));
  expect(await screen.findByText('Draft started successfully!')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument()
  );
  expect(screen.getByText('active')).toBeInTheDocument();
});

test('disables "Start Draft" until the minimum team count is reached', async () => {
  // One team in the league (see leagueResponse), minimum of 8 required.
  mockGetByUrl({
    '/api/league/1': leagueResponse({ min_teams: 8 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled();
});

test('enables "Start Draft" once the minimum team count is met', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ min_teams: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled();
});

test('disables Start Draft for a salary-cap auction with an explanatory tooltip', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ min_teams: 1, draft_type: 'auction' }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled();
  expect(screen.getByText('Live salary-cap auctions are not supported yet.')).toBeInTheDocument();
});

test('does not show "Start Draft" for a non-owner', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ ownerTeamId: 99 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

test('does not show "Start Draft" once the draft is no longer pending', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'active', ownerTeamId: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

test('links to the Draft Room, Matchups, and Set Lineup pages for this league', async () => {
  mockGetByUrl({
    '/api/league/7': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard(7);
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/7/draft');
  expect(screen.getByRole('link', { name: 'Game Center' })).toHaveAttribute('href', '/league/7/game-center');
  expect(screen.queryByRole('link', { name: 'Matchups' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Set Lineup' })).toHaveAttribute('href', '/league/7/lineup');
  expect(screen.getByRole('link', { name: 'Waivers' })).toHaveAttribute('href', '/league/7/waivers');
  expect(screen.getByRole('link', { name: 'Trades' })).toHaveAttribute('href', '/league/7/trades');
  expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/league/7/activity');
  expect(screen.getByRole('link', { name: 'Power Rankings' })).toHaveAttribute(
    'href',
    '/league/7/power-rankings'
  );
});

// Phase, the week and the season chip come from the league row alone; the
// standings response contributes only its rows (#57 removed the splice).
test('week and season-status chips render from the league row once the draft is complete', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', season_status: 'playoffs', current_week: 12 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Week 12')).toBeInTheDocument();
  expect(screen.getByText('Playoffs')).toBeInTheDocument();
});

test('Advance Week is visible for the owner when draft is complete and season is not complete, posts, and refetches on click', async () => {
  const advanced = (week) => leagueResponse({
    draft_status: 'complete', season_status: 'regular', current_week: week, ownerTeamId: 1,
  });
  const gets = {
    '/api/league/1': advanced(3),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  };
  mockGetByUrl(gets);
  apiClient.post.mockImplementation((url) => {
    if (url === '/api/scoring/league/1/advance-week') gets['/api/league/1'] = advanced(4);
    return Promise.resolve({});
  });

  renderDashboardWithToasts();
  await screen.findByText('Sunday Ballers');
  expect(screen.getByText('Week 3')).toBeInTheDocument();

  const advanceButton = screen.getByRole('button', { name: 'Advance Week' });
  await clickAndSettle(advanceButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/advance-week')
  );
  expect(await screen.findByText('Week advanced!')).toBeInTheDocument();
  // The refresh landed, not merely started: the advanced row is on screen, and
  // the standings were reloaded alongside it.
  expect(await screen.findByText('Week 4')).toBeInTheDocument();
  expect(apiClient.get.mock.calls.filter((c) => c[0].includes('/standings')).length).toBeGreaterThanOrEqual(2);
});

test('Advance Week is absent for non-owners', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', season_status: 'regular', current_week: 3, ownerTeamId: 99 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Advance Week' })).not.toBeInTheDocument();
});

test('Advance Week is absent when draft_status is pending', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'pending', ownerTeamId: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Advance Week' })).not.toBeInTheDocument();
});

test('Advance Week is absent once the season is complete', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', season_status: 'complete', current_week: 14, ownerTeamId: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Advance Week' })).not.toBeInTheDocument();
});

test('the standings response no longer overrides the league row: phase reads the row alone (#57 dead splice removed)', async () => {
  // A standings row claiming the season is complete must not flip the header
  // chip or hide Advance Week when the league row says regular season.
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', season_status: 'regular', current_week: 5, ownerTeamId: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'complete', current_week: 17 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Week 5')).toBeInTheDocument();
  expect(screen.getByText('Regular Season')).toBeInTheDocument();
  expect(screen.queryByText('Season Complete')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Advance Week' })).toBeInTheDocument();
});

// --- Commissioner tools ---

test('Commissioner Tools panel is hidden from a plain member', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ ownerTeamId: 99, is_commissioner: false }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByText('Commissioner Tools')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Draft Settings/ })).not.toBeInTheDocument();
});

test('a co-commissioner gets Commissioner Tools and Draft Settings, but not the co-commissioner list', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ ownerTeamId: 99, is_commissioner: true }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Commissioner Tools')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Draft Settings/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeInTheDocument();
  // Managing co-commissioners stays with the owner.
  expect(screen.queryByText('Co-commissioners')).not.toBeInTheDocument();
});

test('the owner also sees the co-commissioner controls', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ ownerTeamId: 1, is_commissioner: true }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Co-commissioners')).toBeInTheDocument();
});

test('every member sees the read-only League Rules link', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ ownerTeamId: 99, is_commissioner: false }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: /League Rules/ })).toHaveAttribute('href', '/league/1/rules');
});

test('Lock Transactions toggles via the commissioner endpoint', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  apiClient.put.mockResolvedValue({});
  renderDashboardWithToasts();
  await screen.findByText('Sunday Ballers');

  await clickAndSettle(screen.getByRole('checkbox', { name: 'Lock Transactions' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/commissioner/league/1/transactions-lock', {
      locked: true,
    })
  );
  expect(await screen.findByText('Transactions locked')).toBeInTheDocument();
  await settleRefresh();
});

test('removing another owner\'s team calls the commissioner endpoint after confirming', async () => {
  const withOtherTeam = leagueResponse();
  withOtherTeam.data.teams.push({ teamId: 2, teamName: "Bob's Team", id: 2, name: "Bob's Team", owner: 'bob', roster_count: 0, total_points: 0 });
  mockGetByUrl({
    '/api/league/1': withOtherTeam,
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  apiClient.delete.mockResolvedValue({});
  renderDashboardWithToasts();
  await screen.findByText('Sunday Ballers');

  // Own team has no remove control; Bob's does
  expect(screen.queryByRole('button', { name: "Remove Alice's Team" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: "Remove Bob's Team" }));

  // A severe confirmation dialog guards the destructive action
  expect(await screen.findByText("Remove Bob's Team?")).toBeInTheDocument();
  expect(apiClient.delete).not.toHaveBeenCalled();
  await clickAndSettle(screen.getByRole('button', { name: 'Remove Team' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/commissioner/league/1/teams/2')
  );
  expect(await screen.findByText('Team removed')).toBeInTheDocument();
  await settleRefresh();
});

test('cancelling the remove-team dialog does not call the API', async () => {
  const withOtherTeam = leagueResponse();
  withOtherTeam.data.teams.push({ teamId: 2, teamName: "Bob's Team", id: 2, name: "Bob's Team", owner: 'bob', roster_count: 0, total_points: 0 });
  mockGetByUrl({
    '/api/league/1': withOtherTeam,
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboardWithToasts();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: "Remove Bob's Team" }));
  expect(await screen.findByText("Remove Bob's Team?")).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByText("Remove Bob's Team?")).not.toBeInTheDocument();
  expect(apiClient.delete).not.toHaveBeenCalled();
});

// --- Best ball chip ---

test('shows a Best Ball chip near the league name when the league is best-ball', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ best_ball: true }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Best Ball')).toBeInTheDocument();
});

test('does not show a Best Ball chip for a non-best-ball league', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ best_ball: false }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByText('Best Ball')).not.toBeInTheDocument();
});

// --- Commissioner join-request queue ---

test('loads and shows pending join requests for a public, approval-required league, with a count badge', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ is_public: true, join_approval: true }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
    '/join-requests': {
      data: [
        { id: 5, username: 'bob', team_name: "Bob's Team", created_at: '2026-07-10T12:00:00.000Z' },
      ],
    },
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(await screen.findByText(/bob/)).toBeInTheDocument();
  expect(screen.getByText(/Bob's Team/)).toBeInTheDocument();
  const section = screen.getByTestId('join-requests-section');
  expect(within(section).getByText('1')).toBeInTheDocument();
});

test('shows "No pending join requests" when the queue is empty', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ is_public: true, join_approval: true }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
    '/join-requests': { data: [] },
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(await screen.findByText('No pending join requests')).toBeInTheDocument();
});

test('approving a join request POSTs decide with approve:true and removes the row', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ is_public: true, join_approval: true }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
    '/join-requests': {
      data: [
        { id: 5, username: 'bob', team_name: "Bob's Team", created_at: '2026-07-10T12:00:00.000Z' },
      ],
    },
  });
  apiClient.post.mockResolvedValue({ data: { status: 'approved' } });
  renderDashboard();
  await screen.findByText('Sunday Ballers');
  await screen.findByText(/bob/);

  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/join-requests/5/decide', {
      approve: true,
    })
  );
  await waitFor(() => expect(screen.queryByText(/bob/)).not.toBeInTheDocument());
});

test('denying a join request POSTs decide with approve:false and removes the row', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ is_public: true, join_approval: true }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
    '/join-requests': {
      data: [
        { id: 5, username: 'bob', team_name: "Bob's Team", created_at: '2026-07-10T12:00:00.000Z' },
      ],
    },
  });
  apiClient.post.mockResolvedValue({ data: { status: 'denied' } });
  renderDashboard();
  await screen.findByText('Sunday Ballers');
  await screen.findByText(/bob/);

  await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/join-requests/5/decide', {
      approve: false,
    })
  );
  await waitFor(() => expect(screen.queryByText(/bob/)).not.toBeInTheDocument());
});

test('does not show the join-request queue for a private league', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ is_public: false, join_approval: false }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByTestId('join-requests-section')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.includes('/join-requests'))).toBe(false);
});

test('does not show the join-request queue for a non-owner even on a public approval league', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ is_public: true, join_approval: true, ownerTeamId: 99 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByTestId('join-requests-section')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.includes('/join-requests'))).toBe(false);
});

test('League Chat lives in a collapsible drawer, opened via a floating action button', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  const openChatButton = screen.getByRole('button', { name: 'Open league chat' });
  expect(await screen.findByText('League Chat')).toBeInTheDocument();
  expect(screen.getByText('No messages yet')).toBeInTheDocument();

  await userEvent.click(openChatButton);
  expect(await screen.findByRole('button', { name: 'Close chat' })).toBeInTheDocument();
});

test('the chat FAB shows an unread badge for messages arriving while the drawer is closed, cleared on open', async () => {
  const handlers = {};
  createDraftSocket.mockReturnValue({
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    io: { on: jest.fn() },
    emit: jest.fn(),
    disconnect: jest.fn(),
  });
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');
  await screen.findByText('League Chat');

  // Another member (userId 2 ≠ alice's 1) chats while the drawer is closed.
  act(() => {
    handlers['chat:message']({
      id: 5, leagueId: 1, userId: 2, username: 'bob', message: 'trade?', created_at: '2026-01-01T12:00:00Z',
    });
  });

  const fab = await screen.findByRole('button', { name: 'Open league chat, 1 unread message' });
  expect(within(fab).getByText('1')).toBeInTheDocument();

  // Opening the drawer clears the badge and persists the read on the server.
  await userEvent.click(fab);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/chat/read'));
  expect(screen.getByRole('button', { name: 'Open league chat' })).toBeInTheDocument();
});

// --- Recap / Trophy Case / Draft Grades / History integration ---

test('links to the League History page', async () => {
  mockGetByUrl({
    '/api/league/7': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard(7);
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    '/league/7/history'
  );
});

test('renders the Recap, Trophy Case, and Draft Grades cards when their data is available', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
    '/recap': {
      data: {
        season: 2026,
        week: 5,
        data: {
          generatedAt: '2026-07-10T00:00:00.000Z',
          narrative: 'A wild week of fantasy football.',
          facts: { highestScorer: { team: "Alice's Team", points: 130.2 } },
        },
      },
    },
    '/trophies': {
      data: [
        {
          id: 1,
          type: 'weekly_high',
          label: 'Weekly High Score',
          week: 5,
          season: 2026,
          team_id: 1,
          team_name: "Alice's Team",
          data: {},
          awarded_at: '2026-07-10T00:00:00.000Z',
        },
      ],
    },
    '/draft-grades': {
      data: {
        computedAt: '2026-07-01T00:00:00.000Z',
        grades: [{ teamId: 1, name: "Alice's Team", grade: 'A', rosterValue: 250, rank: 1 }],
      },
    },
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(await screen.findByTestId('recap-card')).toBeInTheDocument();
  expect(screen.getByText('A wild week of fantasy football.')).toBeInTheDocument();
  expect(await screen.findByTestId('trophy-case')).toBeInTheDocument();
  expect(screen.getByText(/Weekly High Score/)).toBeInTheDocument();
  expect(await screen.findByTestId('draft-grades-card')).toBeInTheDocument();
});

test('hides the Recap, Trophy Case, and Draft Grades cards when their endpoints have nothing to show', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
  expect(screen.queryByTestId('trophy-case')).not.toBeInTheDocument();
  expect(screen.queryByTestId('draft-grades-card')).not.toBeInTheDocument();
});

test('Start New Season appears only when the season is complete and POSTs the rollover', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', season_status: 'complete', current_week: 17 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  });
  apiClient.post.mockResolvedValue({});
  renderDashboardWithToasts();
  await screen.findByText('Sunday Ballers');

  await clickAndSettle(screen.getByRole('button', { name: 'Start New Season' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/commissioner/league/1/rollover', {})
  );
  expect(await screen.findByText('New season started!')).toBeInTheDocument();
  await settleRefresh();
});

// --- Pick'em-only leagues ---

const pickemLeagueResponse = (overrides = {}) =>
  leagueResponse({
    pickem_only: true,
    draft_status: 'pending',
    season_status: 'regular',
    current_week: 6,
    current_season: 2026,
    max_teams: 50,
    ...overrides,
  });

const pickemStandingsResponse = () => ({
  data: {
    season: 2026,
    mode: 'straight',
    standings: [
      { userId: 1, username: 'alice', teamName: "Alice's Team", rank: 1, points: 41, correct: 41, incorrect: 12, pushes: 0, pending: 0, weekly: {} },
    ],
  },
});

test("a pick'em-only league renders no fantasy tiles, offers Make your picks, and never requests fantasy standings", async () => {
  mockGetByUrl({
    '/api/league/1': pickemLeagueResponse(),
    '/api/user': userResponse(),
    '/api/pickem/league/1/standings?season=2026': pickemStandingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  // Nav trim: only the surfaces a pick'em league actually has.
  expect(screen.queryByRole('link', { name: 'Draft Room' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Set Lineup' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Game Center' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Waivers' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Trades' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Power Rankings' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Draft Settings' })).not.toBeInTheDocument();
  expect(screen.queryByText('Moves')).not.toBeInTheDocument(); // an emptied group is skipped
  expect(screen.getByRole('link', { name: "Pick'em" })).toHaveAttribute('href', '/league/1/pickem');
  expect(within(screen.getByRole('link', { name: "Pick'em" })).getByText('Recommended')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Activity' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'League Rules' })).toBeInTheDocument();

  // Pick'em-first body: the CTA above the self-fetching pick'em standings.
  expect(screen.getByRole('link', { name: 'Make your picks' })).toHaveAttribute('href', '/league/1/pickem');
  expect(await screen.findByText('one point per correct pick', { exact: false })).toBeInTheDocument();
  expect(screen.queryByText('W-L-T')).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/scoring/league/1/standings');
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/(recap|draft-grades)$/));
});

test("a pick'em-only league's chips describe the pool, not a draft", async () => {
  mockGetByUrl({
    '/api/league/1': pickemLeagueResponse(),
    '/api/user': userResponse(),
    '/api/pickem/league/1/standings?season=2026': pickemStandingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Teams: 1/50')).toBeInTheDocument();
  expect(screen.getByText("Pick'em", { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.getByText('Week 6')).toBeInTheDocument();
  // No playoffs in a pick'em league, so 'regular' reads as plain in-season.
  expect(screen.getByText('In season')).toBeInTheDocument();
  expect(screen.queryByText('Regular Season')).not.toBeInTheDocument();
  expect(screen.queryByText('pending')).not.toBeInTheDocument();
  // A pick'em-only league has no draft; it never renders the roster/rounds
  // chip in any phase (#162), even though pickemLeagueResponse's draft_status
  // of 'pending' would otherwise read as pre-draft on a fantasy league.
  expect(screen.queryByText(/Draft roster size/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Draft rounds/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Min to start/)).not.toBeInTheDocument();
});

test("a pick'em-only commissioner sees neither Start Draft nor Advance Week, and the season flips to complete on its own", async () => {
  mockGetByUrl({
    '/api/league/1': pickemLeagueResponse({ season_status: 'complete', min_teams: 2 }),
    '/api/user': userResponse(),
    '/api/pickem/league/1/standings?season=2026': pickemStandingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Advance Week' })).not.toBeInTheDocument();
  expect(screen.getByText('Complete')).toBeInTheDocument(); // same phase wording as LeagueCard
  // The CTA stops asking for picks once the season is over.
  expect(screen.getByRole('link', { name: 'View picks' })).toHaveAttribute('href', '/league/1/pickem');
  expect(screen.queryByRole('link', { name: 'Make your picks' })).not.toBeInTheDocument();
  // Still no draft chip in the complete phase for a pick'em-only league.
  expect(screen.queryByText(/Draft roster size/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Draft rounds/)).not.toBeInTheDocument();
});

// --- the shared useLeague entry ---

test('the dashboard reads the same league entry as the pages it links to, so a fantasy page reached from it needs no second league request', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  const { unmount } = renderDashboard();
  await screen.findByText('Sunday Ballers');
  unmount();

  apiClient.get.mockClear();
  const { unmount: unmountFantasyPage } = renderWithProviders(
    <FantasyOnly>
      <div>Draft Room body</div>
    </FantasyOnly>,
    { path: '/league/:leagueId/draft', route: '/league/1/draft' }
  );
  expect(screen.getByText('Draft Room body')).toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/league/1');
  // A clear reloads whatever is still mounted on the key: take the page down
  // before clearing so the teardown makes no request.
  unmountFantasyPage();
  clearLeagueCache();
});

// --- pick'em standings cache (#35) ---

test("the pick'em dashboard's standings are shared with the Pick'em page: a second mount within the TTL makes no request", async () => {
  clearPickemStandingsCache();
  mockGetByUrl({
    '/api/league/1': pickemLeagueResponse(),
    '/api/user': userResponse(),
    '/api/pickem/league/1/standings?season=2026': pickemStandingsResponse(),
  });
  const { unmount } = renderDashboard();
  await screen.findByText('Sunday Ballers');
  await screen.findByText('one point per correct pick', { exact: false });
  const standingsCalls = () => apiClient.get.mock.calls.filter(([url]) => url.includes('/api/pickem/league/1/standings')).length;
  expect(standingsCalls()).toBe(1);
  unmount();

  renderWithProviders(<PickemStandings leagueId={1} season={2026} />);
  expect(await screen.findByText('one point per correct pick', { exact: false })).toBeInTheDocument();
  expect(standingsCalls()).toBe(1);
  clearPickemStandingsCache();
});
