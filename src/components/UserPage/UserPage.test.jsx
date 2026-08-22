import React from 'react';
import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  my_team_id: 10,
  my_team_name: "alice's Team",
  draft_status: 'pending',
  owner_id: 1,
  ...overrides,
});

// The hero's Create/Join League buttons are always on screen; the rich empty
// state repeats the same two CTAs when there are no leagues yet. Scope to the
// hero so these tests keep working regardless of which state is showing.
const heroButton = (name) => within(screen.getByTestId('dashboard-hero')).getByRole('button', { name });

// UserPage also fetches the news/activity widgets on mount via apiClient.get,
// so raw call counts aren't meaningful for the leagues fetch anymore — filter
// to the URL under test instead.
const getCallsTo = (url) => apiClient.get.mock.calls.filter(([calledUrl]) => calledUrl === url).length;

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton cards (not the empty state) while leagues are loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<UserPage />, { state: baseState });

  expect(screen.getAllByTestId('league-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
});

test('renders the title and a welcome message with the username', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(screen.getByText('Endzone Empire')).toBeInTheDocument();
  expect(screen.getByText('Welcome, alice!')).toBeInTheDocument();
});

test("the hero names weekly picks alongside the fantasy features, so a pick'em-only manager is not promised rosters", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  const hero = within(screen.getByTestId('dashboard-hero'));
  expect(hero.getByText(/drafts, matchups, waivers, trades, and weekly picks, all in one place./)).toBeInTheDocument();
});

test("fetches and renders the user's leagues on mount", async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText("Team: alice's Team")).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league');
});

test('shows an error alert when fetching leagues fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'server exploded' } } });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
});

test('renders a rich empty state with an icon and CTAs once loading finishes with no leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  const emptyState = await screen.findByTestId('leagues-empty-state');
  expect(within(emptyState).getByText("You aren't managing any teams yet.")).toBeInTheDocument();
  expect(within(emptyState).getByTestId('SportsFootballIcon')).toBeInTheDocument();
  expect(within(emptyState).getByRole('button', { name: 'Create League' })).toBeInTheDocument();
  expect(within(emptyState).getByRole('button', { name: 'Join League' })).toBeInTheDocument();
});

test('does not render the empty state once leagues are present', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });

  await screen.findByText('Sunday Ballers');
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
});

test('renders NFL news headlines and cross-league activity from their own endpoints', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/news') {
      return Promise.resolve({
        data: [{ title: 'Star RB questionable for Sunday', link: 'https://example.com/news/1' }],
      });
    }
    if (url === '/api/notifications') {
      return Promise.resolve({
        data: {
          notifications: [
            { id: 5, message: 'Sunday Ballers completed a trade', league_name: 'Sunday Ballers', created_at: '2026-01-01T00:00:00.000Z' },
          ],
          unread: 0,
        },
      });
    }
    return Promise.resolve({ data: [] }); // /api/league
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'Star RB questionable for Sunday' })).toHaveAttribute(
    'href',
    'https://example.com/news/1'
  );
  expect(screen.getAllByText('Sunday Ballers completed a trade')).toHaveLength(2);
});

test('shows a friendly message when the news or activity widgets fail to load', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/news' || url === '/api/notifications') {
      return Promise.reject(new Error('network error'));
    }
    return Promise.resolve({ data: [] }); // /api/league
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText("Couldn't load the latest news right now.")).toBeInTheDocument();
  expect(screen.getByText("Couldn't load recent activity right now.")).toBeInTheDocument();
});

// --- "Next up" hero (nextUpFor) -------------------------------------------
// The hero distills the user's leagues + recent activity into one prioritized
// CTA. Priority: an actionable notification (trade/invite/join request) > a
// live draft > a scheduled draft > an in-season/playoff lineup nudge > the
// create/join fallback. The action renders as a link, so assert on its href.
const mockDashboard = ({ leagues = [], notifications = [] }) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications, unread: 0 } });
    if (url === '/api/news') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: leagues }); // /api/league
  });
};

test('Next up hero prioritizes an actionable trade notification over league phase', async () => {
  mockDashboard({
    leagues: [league({ id: 9, draft_status: 'active' })], // a live draft would otherwise win
    notifications: [{ id: 1, message: 'Bob proposed a trade', league_id: 9 }],
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'Review trades' })).toHaveAttribute('href', '/league/9/trades');
  expect(screen.getByText('Action needed')).toBeInTheDocument();
});

test('Next up hero surfaces a live draft when nothing needs action', async () => {
  mockDashboard({
    leagues: [league({ id: 1, draft_status: 'active' })],
    notifications: [{ id: 1, message: 'Week 1 scores posted' }],
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'Open Draft Room' })).toHaveAttribute('href', '/league/1/draft');
  // "Draft live" also appears in the league card's phase chip, so scope to the hero region.
  const hero = screen.getByRole('region', { name: /is on the clock/i });
  expect(within(hero).getByText('Draft live')).toBeInTheDocument();
});

test('Next up hero nudges the in-season lineup once the draft is complete', async () => {
  mockDashboard({
    leagues: [league({ id: 3, draft_status: 'complete', season_status: 'regular', current_week: 5 })],
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'Set Lineup' })).toHaveAttribute('href', '/league/3/lineup');
});

test('Next up hero points to browsing leagues when the user has none', async () => {
  mockDashboard({ leagues: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'View leagues' })).toHaveAttribute('href', '/league');
});

test('creating a league posts the form data, shows a notice, and refetches leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Monday Mayhem');
  await userEvent.type(screen.getByLabelText(/Team Name/), "Alice's Squad");
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Monday Mayhem',
      teamName: "Alice's Squad",
      maxTeams: 2,
      leagueType: 'fantasy',
    })
  );
  expect(await screen.findByText('League created!')).toBeInTheDocument();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(2));
});

test('the approval toggle only appears once Public league is on, and only the fields the user sets are sent', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  expect(screen.queryByLabelText('Require commissioner approval to join')).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('League Name'), 'Plain League');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Plain Squad');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Plain League',
      teamName: 'Plain Squad',
      maxTeams: 2,
      leagueType: 'fantasy',
    })
  );
});

test('creating a public, approval-required, best-ball, half-PPR league with a draft date sends all the fields', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Full League');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Full Squad');
  await userEvent.click(screen.getByLabelText('Public league'));
  await userEvent.click(screen.getByLabelText('Require commissioner approval to join'));
  await userEvent.click(screen.getByLabelText('Best ball mode'));
  expect(screen.getByText(/optimal lineup is set automatically/i)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Scoring'));
  await userEvent.click(await screen.findByRole('option', { name: 'Half PPR' }));
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });
  // #116 AC3: a scheduled draft's zone requires explicit acknowledgement
  // before Create is enabled.
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  await userEvent.click(screen.getByLabelText('Draft time zone'));
  await userEvent.click(await screen.findByRole('option', { name: 'America/New_York' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /confirm this draft date and time/i }));
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Full League',
      teamName: 'Full Squad',
      maxTeams: 2,
      leagueType: 'fantasy',
      isPublic: true,
      joinApproval: true,
      bestBall: true,
      scoringPreset: 'half_ppr',
      // #116 AC4: the wall time above is 1pm in the selected zone
      // (America/New_York, EDT/UTC-4 in September), not the test runner's
      // own zone.
      draftDate: '2026-09-04T17:00:00.000Z',
      draftTimezone: 'America/New_York',
    })
  );
});

test('the Create button is disabled until both a league name and a Team name are entered', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Create League'));
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('League Name'), 'X');
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/Team Name/), 'Y');
  expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
});

test('creating a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'name already taken' } } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Dup League');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Dup Squad');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByText('name already taken')).toBeInTheDocument();
});

test('joining a league posts the trimmed invite code, shows a notice, and refetches leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Join League'));
  expect(getCallsTo('/api/league')).toBe(1); // opening the dialog fetches nothing — no browse list
  await userEvent.type(screen.getByLabelText('Invite Code'), '  abc123  ');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Joiner FC');
  await userEvent.click(screen.getByRole('button', { name: 'Join' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'abc123', teamName: 'Joiner FC' })
  );
  expect(await screen.findByText('Joined league!')).toBeInTheDocument();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(2));
});

test('the Join button is disabled until both an invite code and a Team name are entered', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Join League'));
  expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Invite Code'), 'x');
  expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/Team Name/), 'y');
  expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled();
});

test('joining a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'no league with that invite code' } } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Join League'));
  await userEvent.type(screen.getByLabelText('Invite Code'), 'bogus');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Joiner FC');
  await userEvent.click(screen.getByRole('button', { name: 'Join' }));

  expect(await screen.findByText('no league with that invite code')).toBeInTheDocument();
});

test('Cancel closes the Create League dialog without making a write request', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Create League'));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByText('Create a New League')).not.toBeInTheDocument());
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('surfaces the public-layer highlights section (lazy) for logged-in users', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/rankings') {
      return Promise.resolve({
        data: { rankings: [{ rank: 1, playerId: 7, name: 'Top Back', position: 'RB', nflTeam: 'KC', seasonPoints: 300 }] },
      });
    }
    if (url === '/api/public/recaps') return Promise.resolve({ data: { recaps: [] } });
    if (url === '/api/notifications') return Promise.resolve({ data: { notifications: [] } });
    return Promise.resolve({ data: [] });
  });
  renderWithProviders(<UserPage />, { state: baseState });

  // The section is a lazy chunk (it carries the strategy-article registry),
  // so it arrives after the initial render.
  expect(await screen.findByText('Around the League')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: '#1 Top Back' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Waiver Wire' })).toHaveAttribute('href', '/waiver-wire');
  expect(screen.getByRole('link', { name: 'All strategy articles' })).toHaveAttribute('href', '/strategy');
});

// --- League type at creation ---

test("the create dialog defaults to a fantasy league and always names the type in the payload", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  expect(screen.getByRole('radio', { name: /Fantasy football league/ })).toBeChecked();
  expect(screen.getByText('Draft, rosters, lineups, and weekly matchups.')).toBeInTheDocument();
  expect(screen.getByText('Pick winners every week. No draft and no rosters.')).toBeInTheDocument();
  expect(screen.getByText('A full fantasy league with pick\'em turned on from day one.')).toBeInTheDocument();
  // The mode picker only applies once the type includes pick'em.
  expect(screen.queryByRole('radio', { name: /Straight up/ })).not.toBeInTheDocument();
});

test("creating an NFL pick'em league sends leagueType, pickemMode and an explicit maxTeams, and none of the fantasy fields", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Office Pool');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Office Champs');
  // Fantasy-only state set BEFORE the switch must not leak into the payload.
  await userEvent.click(screen.getByLabelText('Best ball mode'));
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });

  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  expect(screen.queryByLabelText('Best ball mode')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Scoring')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Draft date')).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Straight up/ })).toBeChecked();

  // A pick'em pool takes up to 50 managers, entered as a number.
  const teams = screen.getByLabelText('Teams');
  expect(teams).toHaveAttribute('type', 'number');
  expect(teams).toHaveAttribute('max', '50');
  await userEvent.clear(teams);
  await userEvent.type(teams, '30');

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Office Pool',
      teamName: 'Office Champs',
      maxTeams: 30,
      leagueType: 'pickem',
      pickemMode: 'straight',
    })
  );
  expect(await screen.findByText('League created!')).toBeInTheDocument();

  // Post-create reset: the next dialog starts from a fantasy league again.
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(heroButton('Create League'));
  expect(screen.getByRole('radio', { name: /Fantasy football league/ })).toBeChecked();
  expect(screen.getByLabelText('Scoring')).toBeInTheDocument();
});

test("choosing Both sends leagueType 'both' with the chosen confidence mode and keeps the fantasy fields", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Everything League');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Everything Squad');
  await userEvent.click(screen.getByRole('radio', { name: /^Both/ }));
  await userEvent.click(screen.getByRole('radio', { name: /Confidence/ }));
  await userEvent.click(screen.getByLabelText('Best ball mode'));
  expect(screen.getByLabelText('Scoring')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Everything League',
      teamName: 'Everything Squad',
      maxTeams: 2,
      leagueType: 'both',
      pickemMode: 'confidence',
      bestBall: true,
    })
  );
});

test("Next up hero sends a pick'em-only manager to make this week's picks", async () => {
  mockDashboard({
    leagues: [league({ id: 4, name: 'Office Pool', pickem_only: true, draft_status: 'pending', season_status: 'regular', current_week: 7 })],
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'Make picks' })).toHaveAttribute('href', '/league/4/pickem');
  expect(screen.getByText('Make your week 7 picks for Office Pool.')).toBeInTheDocument();
});

test("the pick'em team count must be a whole number from 2 to 50 before Create is enabled", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Office Pool');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Pool Shark');
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  const teams = screen.getByLabelText('Teams');

  await userEvent.clear(teams);
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  await userEvent.type(teams, '99');
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  await userEvent.clear(teams);
  await userEvent.type(teams, '2.5');
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  await userEvent.clear(teams);
  await userEvent.type(teams, '30');
  expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

test("a fractional pick'em count is rounded down, not carried into the fantasy team Select", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Odd Pool');
  await userEvent.type(screen.getByLabelText(/Team Name/), 'Odd Squad');
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  const teams = screen.getByLabelText('Teams');
  await userEvent.clear(teams);
  await userEvent.type(teams, '12.5');
  await userEvent.click(screen.getByRole('radio', { name: /Fantasy football league/ }));

  expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', expect.objectContaining({ maxTeams: 12, leagueType: 'fantasy' }))
  );
});
