import React from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import { clearLeagueCache } from '../../hooks/useLeague';
import { clearPickemSettingsCache, setPickemSettings } from '../../hooks/usePickemSettings';
import LeagueRules from './LeagueRules';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
import apiClient from '../../api/apiClient';

const SCORING_DEFAULTS = {
  passing: { yards: 0.04, touchdowns: 4, interceptions: -2 },
  rushing: { yards: 0.1, touchdowns: 6 },
  receiving: { yards: 0.1, touchdowns: 6, reception: 0 },
  misc: { fumblesLost: -2 },
  kicking: {
    extraPoint: 1,
    fieldGoal: [
      { min: 0, max: 39, points: 3 },
      { min: 40, max: 49, points: 4 },
      { min: 50, max: null, points: 5 },
    ],
  },
  teamDefense: { sack: 1 },
  idp: { soloTackle: 1 },
};

const league = (overrides = {}) => ({
  id: 7,
  name: 'Test League',
  owner_id: 1,
  scoring_preset: 'half_ppr',
  scoring_rules: null,
  dp_enabled: false,
  roster_slots: [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ],
  bench_slots: 5,
  ir_slots: 1,
  position_caps: {},
  waiver_type: 'faab',
  faab_budget: 100,
  waiver_period_hours: 48,
  trade_review_hours: 24,
  trade_veto_votes: 0,
  trade_deadline_week: 11,
  regular_season_weeks: 14,
  playoff_teams: 6,
  playoff_consolation: true,
  keepers_enabled: false,
  keeper_count: 0,
  ...overrides,
});

const mockRequests = ({ leagueRow = league(), leagueError, defaultsError } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/scoring/rules') {
      return defaultsError
        ? Promise.reject(defaultsError)
        : Promise.resolve({ data: { defaults: SCORING_DEFAULTS, presets: {} } });
    }
    if (url.startsWith('/api/league/')) {
      return leagueError
        ? Promise.reject(leagueError)
        : Promise.resolve({ data: { league: leagueRow, teams: [] } });
    }
    return Promise.resolve({ data: {} });
  });
};

const renderPage = (route = '/league/7/rules') => renderWithProviders(<LeagueRules />, {
  route,
  path: '/league/:leagueId/rules',
  state: { user: { id: 2, username: 'member' } },
});

describe('LeagueRules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearLeagueCache();
    clearPickemSettingsCache();
  });

  it('renders every rules tab for a plain member', async () => {
    mockRequests();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'League Rules' })).toBeInTheDocument();
    for (const label of ['Scoring', 'Roster', 'Waivers & Trades', 'Playoffs & Season']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('shows scoring values and no edit controls', async () => {
    mockRequests();
    renderPage();

    expect(await screen.findByRole('region', { name: 'Passing' })).toBeInTheDocument();
    const passing = screen.getByRole('table', { name: 'Passing scoring' });
    expect(within(passing).getByText('Touchdown')).toBeInTheDocument();
    // Tier ranges from the field-goal array.
    expect(screen.getByText('40–49')).toBeInTheDocument();
    expect(screen.getByText('50+')).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('prefers the league\'s custom scoring over the defaults', async () => {
    mockRequests({ leagueRow: league({ scoring_rules: { passing: { touchdowns: 6 } } }) });
    renderPage();

    await screen.findByRole('region', { name: 'Passing' });
    const passing = screen.getByRole('table', { name: 'Passing scoring' });
    expect(within(passing).getByText('Touchdown').closest('tr')).toHaveTextContent('6');
    expect(screen.getByText('Customized')).toBeInTheDocument();
  });

  it('switches to the roster, waiver and playoff tabs', async () => {
    mockRequests();
    renderPage();
    await screen.findByRole('region', { name: 'Passing' });

    await act(async () => { await userEvent.click(screen.getByRole('tab', { name: 'Roster' })); });
    expect(screen.getByText('7 roster spots + up to 1 IR')).toBeInTheDocument();
    expect(screen.getByText('FLEX')).toBeInTheDocument();

    await act(async () => { await userEvent.click(screen.getByRole('tab', { name: 'Waivers & Trades' })); });
    expect(screen.getByText('FAAB (Bidding)')).toBeInTheDocument();
    expect(screen.getByText('Week 11')).toBeInTheDocument();

    await act(async () => { await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Season' })); });
    expect(screen.getByText('14 weeks')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('opens the tab named in the URL so rules can be linked directly', async () => {
    mockRequests();
    renderPage('/league/7/rules?tab=waivers');

    expect(await screen.findByText('FAAB (Bidding)')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Waivers & Trades' })).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to Scoring for an unknown tab in the URL', async () => {
    mockRequests();
    renderPage('/league/7/rules?tab=bogus');

    expect(await screen.findByRole('region', { name: 'Passing' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Scoring' })).toHaveAttribute('aria-selected', 'true');
  });

  it('names the commissioner and co-commissioners for every member', async () => {
    mockRequests({
      leagueRow: league({
        owner_username: 'alice',
        co_commissioners: [{ user_id: 9, username: 'bob' }],
      }),
    });
    renderPage();

    expect(await screen.findByText('alice · commissioner')).toBeInTheDocument();
    expect(screen.getByText('bob · co-commissioner')).toBeInTheDocument();
  });

  it('offers a retry when the league request fails', async () => {
    mockRequests({ leagueError: { response: { data: { error: 'nope' } } } });
    renderPage();

    expect(await screen.findByText(/Unable to load league rules: nope/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry league rules' })).toBeInTheDocument();
  });

  it('keeps the other tabs usable when scoring defaults fail to load', async () => {
    mockRequests({ defaultsError: { message: 'offline' } });
    renderPage();

    expect(await screen.findByText(/Unable to load scoring rules: offline/)).toBeInTheDocument();

    await act(async () => { await userEvent.click(screen.getByRole('tab', { name: 'Roster' })); });
    await waitFor(() => expect(screen.getByText('7 roster spots + up to 1 IR')).toBeInTheDocument());
  });
});

// --- Pick'em-only leagues ---

test("a pick'em-only league renders the pick'em rulebook instead of the four fantasy tabs", async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/scoring/rules') {
      return Promise.resolve({ data: { defaults: SCORING_DEFAULTS, presets: {} } });
    }
    if (url === '/api/pickem/league/7/settings') {
      return Promise.resolve({ data: { enabled: true, mode: 'confidence', isCommissioner: false } });
    }
    if (url.startsWith('/api/league/')) {
      return Promise.resolve({ data: { league: league({ pickem_only: true, name: 'Office Pool' }), teams: [] } });
    }
    return Promise.resolve({ data: {} });
  });
  clearLeagueCache();
  clearPickemSettingsCache();
  renderPage();

  expect(await screen.findByRole('heading', { name: 'League Rules' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Scoring' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Roster' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Waivers & Trades' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Playoffs & Season' })).not.toBeInTheDocument();

  // The mode in force comes from the league's pick'em settings.
  expect(await screen.findByText(/Confidence: rank every game/)).toBeInTheDocument();
  expect(screen.getByText(/lock at kickoff/i)).toBeInTheDocument();
  expect(screen.getByText(/tied game credits nobody/i)).toBeInTheDocument();
  expect(screen.getByText(/cumulative/i)).toBeInTheDocument();
  expect(screen.getByText(/most correct picks/i)).toBeInTheDocument();
  // A pick'em league has no scoring rules to fetch defaults for.
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/scoring/rules');
});

test("the rulebook states a mode already cached by the Pick'em page, with no request of its own", async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/league/')) {
      return Promise.resolve({ data: { league: league({ pickem_only: true, name: 'Office Pool' }), teams: [] } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  clearLeagueCache();
  clearPickemSettingsCache();
  // What a visit to the Pick'em page, or a save made there, leaves behind.
  setPickemSettings(7, { enabled: true, mode: 'straight', isCommissioner: false });
  renderPage();

  expect(await screen.findByText(/Straight up: 1 point per correct pick/)).toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/pickem/league/7/settings');
});
