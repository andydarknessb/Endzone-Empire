import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import CommissionerTools from './CommissionerTools';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// userEvent calls below are awaited directly, never re-wrapped in act(): see
// docs/adr/0007-user-event-is-never-wrapped-in-act.md. Work that outlives a
// click (a save PUT, the refresh behind it) is awaited at the call site.

// Settles background work that isn't tied to a mocked promise the test can
// await directly: MUI's Tabs indicator, which repositions via a
// MutationObserver that fires asynchronously after a mount/rerender, and the
// join-requests panel's own mount-effect GET. A single tick is what these
// need in practice, but this loops (matching NavigationGuard.test.jsx's own
// flush helper) so the wait isn't pinned to a fragile exact-hop-count guess.
const flush = async (times = 6) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  owner_id: 1,
  draft_status: 'pending',
  min_teams: 8,
  max_teams: 10,
  roster_slots: [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ],
  bench_slots: 5,
  ir_slots: 1,
  dp_enabled: false,
  transactions_locked: false,
  is_public: false,
  join_approval: false,
  playoff_teams: 4,
  regular_season_weeks: 14,
  playoff_consolation: false,
  trade_deadline_week: null,
  waiver_type: 'priority',
  waiver_period_hours: 24,
  trade_review_hours: 24,
  trade_veto_votes: 4,
  ...overrides,
});

// Both `id` and `teamId`, because GET /api/league/:id selects both: the raw
// column and the contract alias teamIdentityColumns() puts beside it. A
// fixture carrying only `id` would let a comparison against the legacy column
// pass while the contract one silently matched nothing.
const teams = [
  { id: 1, teamId: 1, name: "Alice's Team", owner: 'alice', faab_remaining: 100, locked: false },
  { id: 2, teamId: 2, name: "Bob's Team", owner: 'bob', faab_remaining: 60, locked: false },
];

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) {
        return value && value.reject ? Promise.reject(value.reject) : Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
};

const renderTools = (props = {}) =>
  renderWithProviders(
    <SnackbarProvider>
      <CommissionerTools
        leagueId={1}
        league={league()}
        teams={teams}
        viewerTeamId={1}
        onRefresh={jest.fn()}
        {...props}
      />
    </SnackbarProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByUrl();
});

test('renders all six tabs, defaulting to General Settings', async () => {
  renderTools();
  // MUI's Tabs indicator repositions via a MutationObserver that fires
  // asynchronously after mount (see the hash-only-navigation test below for
  // the full explanation). Let it settle before this, the first test in the
  // file, ends.
  await flush();
  expect(screen.getByRole('tab', { name: 'General Settings' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Roster Settings' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Scoring Settings' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Playoffs & Schedule' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Waivers & Trades' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'System Overrides' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Lock Transactions' })).toBeInTheDocument();
});

test('calls out immediate general-setting effects and destructive team removal', async () => {
  renderTools({ league: league({ is_public: true, join_approval: true }) });
  // is_public + join_approval mounts the join-requests panel, which fires its
  // own GET on mount (unrelated to what this test asserts). Let that settle
  // inside act before asserting, or its setJoinRequests(...) update lands
  // after the test has already finished reading the screen.
  await flush();

  expect(screen.getByText(/Applies immediately\. Freezes adds/)).toBeInTheDocument();
  expect(screen.getByText('Destructive actions')).toBeInTheDocument();
  expect(screen.getByText('Remove a team')).toBeInTheDocument();
  expect(screen.getByText('Approve and deny decisions apply immediately.')).toBeInTheDocument();
});

// The removable-teams guard answers "which of these is me" by Team ID, not by
// the owner username string (#185). Both cases below assert list membership
// (which control is offered, not just that the section renders) and would
// fail against a username comparison: the first because a stale/renamed
// owner string no longer matches the signed-in username, the second because
// #115 drops the owner field from league-shared team rows entirely, which
// makes `undefined !== username` true for every team.
test("excludes the viewer's own team by Team ID even once its owner string is stale (a username change)", () => {
  const staleOwnerTeams = teams.map((t) => (t.id === 1 ? { ...t, owner: 'alice_old_handle' } : t));
  renderTools({ viewerTeamId: 1, teams: staleOwnerTeams });

  expect(screen.queryByRole('button', { name: "Remove Alice's Team" })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Remove Bob's Team" })).toBeInTheDocument();
});

test("excludes the viewer's own team by Team ID once the owner username field is gone from the payload (#115 shape)", () => {
  const teamsWithoutOwner = teams.map(({ owner, ...rest }) => rest);
  renderTools({ viewerTeamId: 1, teams: teamsWithoutOwner });

  expect(screen.queryByRole('button', { name: "Remove Alice's Team" })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Remove Bob's Team" })).toBeInTheDocument();
});

// #188. Team identity on a league-shared payload is `teamId`, and every other
// "which of these is me" comparison in src/ reads it. This filter read the raw
// `teams.id` that GET /api/league/:id still selects beside it, and the failure
// direction is the bad one: drop the legacy column and `undefined !==
// viewerTeamId` is true for every row, so the viewer's own team becomes
// removable. The fixture below carries Team identity and no legacy id.
test("excludes the viewer's own team by teamId, the contract field, not the legacy id", () => {
  const contractTeams = [
    { teamId: 1, name: "Alice's Team", faab_remaining: 100, locked: false },
    { teamId: 2, name: "Bob's Team", faab_remaining: 60, locked: false },
  ];
  renderTools({ viewerTeamId: 1, teams: contractTeams });

  expect(screen.queryByRole('button', { name: "Remove Alice's Team" })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Remove Bob's Team" })).toBeInTheDocument();
});

// #188. Two rules bound removal and the server enforces both: no commissioner
// may remove their OWN team, and whoever the caller is, the creator's team
// cannot be removed (leagueRole.service's invariant; commissioner.service's
// removeTeam raises 409 for each). The client mirrored only the first, so a
// co-commissioner was offered a Remove button that could only ever fail. The
// viewer here is a co-commissioner, which is what makes the two rules
// distinguishable: for the creator, their own team is already excluded by the
// first rule.
test("offers a co-commissioner no Remove button for the creator's team", () => {
  const withTeamIds = [
    { id: 1, teamId: 1, name: "Alice's Team", owner: 'alice', owner_id: 1 },
    { id: 2, teamId: 2, name: "Bob's Team", owner: 'bob', owner_id: 2 },
    { id: 3, teamId: 3, name: "Carol's Team", owner: 'carol', owner_id: 3 },
  ];
  // Bob is a co-commissioner; Alice created the league.
  renderTools({
    viewerTeamId: 2,
    teams: withTeamIds,
    league: league({ ownerTeamId: 1, ownerTeamName: "Alice's Team" }),
  });

  expect(screen.queryByRole('button', { name: "Remove Alice's Team" })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: "Remove Bob's Team" })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Remove Carol's Team" })).toBeInTheDocument();
});

// #188 follow-up. Filtering the creator's team out of the removal list is
// right, but the 409 it used to produce ("the league creator's team can't be
// removed") was the ONLY place that rule was ever stated to a user. Hiding the
// button without saying why leaves a co-commissioner looking for a team that
// is simply absent - and because the whole Paper was gated on the list being
// non-empty, in a two-team league the overline, the subheading and the list
// vanished from the DOM together, so there was no trace of the section at all.
test('states the creator-team rule instead of silently omitting the team', () => {
  const twoTeams = [
    { id: 1, teamId: 1, name: "Alice's Team", owner: 'alice' },
    { id: 2, teamId: 2, name: "Bob's Team", owner: 'bob' },
  ];
  // Bob is a co-commissioner; Alice created the league. Nothing is removable:
  // Bob's own team by the first rule, Alice's by the second.
  renderTools({
    viewerTeamId: 2,
    teams: twoTeams,
    league: league({ ownerTeamId: 1, ownerTeamName: "Alice's Team" }),
  });

  expect(screen.getByText('Remove a team')).toBeInTheDocument();
  expect(screen.getByText(/the league creator's team can't be removed/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: "Remove Alice's Team" })).not.toBeInTheDocument();
});

// The rule is stated whenever the section is, not only when the list empties:
// a co-commissioner who CAN remove someone still needs to know why one name is
// missing from the list in front of them.
test('states the rule alongside a non-empty removal list too', () => {
  const threeTeams = [
    { id: 1, teamId: 1, name: "Alice's Team", owner: 'alice' },
    { id: 2, teamId: 2, name: "Bob's Team", owner: 'bob' },
    { id: 3, teamId: 3, name: "Carol's Team", owner: 'carol' },
  ];
  renderTools({
    viewerTeamId: 2,
    teams: threeTeams,
    league: league({ ownerTeamId: 1, ownerTeamName: "Alice's Team" }),
  });

  expect(screen.getByRole('button', { name: "Remove Carol's Team" })).toBeInTheDocument();
  expect(screen.getByText(/the league creator's team can't be removed/i)).toBeInTheDocument();
});

// The list row's React key moved to `teamId` with the filter above it, or
// the file contradicts itself (#188). There is no test for it: a React key
// is not observable from the DOM, and the one probe that exists - React's
// own "unique key prop" warning - is emitted at most once per component per
// run, so a test asserting on it passes or fails depending on which other
// test rendered this panel first. A green that depends on file order would
// certify nothing, which is the failure this whole sweep is about. The
// change is verified by reading it.

// --- Roster Settings ---

test('Roster Settings renders configured slots and separates drafted spots from IR', async () => {
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  expect(screen.getAllByLabelText('Slot Name')).toHaveLength(2);
  // 1 QB + 1 FLEX starters + 5 bench = 7 drafted spots; the IR slot is not one.
  expect(screen.getByText(/roster spots \+ up to/)).toHaveTextContent('7 roster spots + up to 1 IR (2 starters + 5 bench)');
});

test('Roster Settings reads exactly as before for a league with no IR slot', async () => {
  renderTools({ league: league({ ir_slots: 0 }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  expect(screen.getByText(/Total roster size:/)).toHaveTextContent('Total roster size: 7 (2 starters + 5 bench + 0 IR)');
  expect(screen.queryByText(/roster spots \+ up to/)).not.toBeInTheDocument();
});

test('Roster Settings is frozen once the draft has started', async () => {
  renderTools({ league: league({ draft_status: 'active' }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  expect(screen.getByText(/locks once the draft starts/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Roster Settings' })).toBeDisabled();
  expect(screen.getAllByLabelText('Slot Name')[0]).toBeDisabled();
});

test('Save Roster Settings sends the slot array plus bench/IR/DP payload', async () => {
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  await userEvent.click(screen.getByRole('button', { name: 'Save Roster Settings' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      rosterSlots: [
        { key: 'QB', count: 1, eligiblePositions: ['QB'] },
        { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
      ],
      benchSlots: 5,
      irSlots: 1,
      dpEnabled: false,
    })
  );
  expect(await screen.findByText('Roster settings saved')).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

test('Add Slot appends an empty slot row for the commissioner to configure', async () => {
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  await userEvent.click(screen.getByRole('button', { name: '+ Add Slot' }));
  expect(screen.getAllByLabelText('Slot Name')).toHaveLength(3);
});

// --- Scoring Settings ---

const SCORING_DEFAULTS_FIXTURE = {
  passing: { yards: 0.04, touchdowns: 4, interceptions: -2, twoPointConversions: 2 },
  kicking: {
    extraPoint: 1,
    fieldGoal: [
      { min: 0, max: 39, points: 3 },
      { min: 40, max: 49, points: 4 },
      { min: 50, max: null, points: 5 },
    ],
  },
  idp: { soloTackle: 1, sack: 2 },
};

const mockScoringRules = () => mockGetByUrl({
  '/api/scoring/rules': { data: { defaults: SCORING_DEFAULTS_FIXTURE, presets: {} } },
});

test('Scoring Settings always lists IDP — locked with an enable hint while dpEnabled is false', async () => {
  mockScoringRules();
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByText('Passing')).toBeInTheDocument();
  expect(screen.getByLabelText('Per Yard')).toHaveValue(0.04);
  expect(screen.getByLabelText('Touchdown')).toHaveValue(4);
  expect(screen.getByText('Field Goal (by distance)')).toBeInTheDocument();
  expect(screen.getAllByLabelText('Min')).toHaveLength(3); // 3 FG tiers
  // The section is visible for discoverability, but locked until DP is on.
  expect(screen.getByText('Individual Defense (IDP)')).toBeInTheDocument();
  expect(screen.getByText(/Enable Defensive Players \(IDP\) in Roster Settings/)).toBeInTheDocument();
  expect(screen.getByLabelText('Solo Tackle')).toBeDisabled();
});

test('Scoring Settings unlocks the IDP fields when the league has DP enabled', async () => {
  mockScoringRules();
  renderTools({ league: league({ dp_enabled: true }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByText('Individual Defense (IDP)')).toBeInTheDocument();
  expect(screen.queryByText(/Enable Defensive Players \(IDP\) in Roster Settings/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Solo Tackle')).toHaveValue(1);
  expect(screen.getByLabelText('Solo Tackle')).toBeEnabled();
});

test('the PPR preset chips set only the reception rate', async () => {
  mockGetByUrl({
    '/api/scoring/rules': { data: { defaults: {
      ...SCORING_DEFAULTS_FIXTURE,
      receiving: { yards: 0.1, reception: 0.5, touchdowns: 6 },
    }, presets: {} } },
  });
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByLabelText('Reception')).toHaveValue(0.5);
  await userEvent.click(screen.getByRole('button', { name: 'Full PPR' }));
  expect(screen.getByLabelText('Reception')).toHaveValue(1);
  expect(screen.getAllByLabelText('Per Yard')[1]).toHaveValue(0.1); // receiving yards untouched
  await userEvent.click(screen.getByRole('button', { name: 'Standard' }));
  expect(screen.getByLabelText('Reception')).toHaveValue(0);
});

test('tier rows can be added and removed', async () => {
  mockScoringRules();
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  await screen.findByText('Field Goal (by distance)');
  expect(screen.getAllByLabelText('Min')).toHaveLength(3);

  await userEvent.click(screen.getByRole('button', { name: '+ Add Tier' }));
  expect(screen.getAllByLabelText('Min')).toHaveLength(4);

  await userEvent.click(screen.getByRole('button', { name: 'Remove Field Goal (by distance) tier 4' }));
  expect(screen.getAllByLabelText('Min')).toHaveLength(3);
});

test('Scoring Settings is frozen once the draft has started', async () => {
  mockScoringRules();
  renderTools({ league: league({ draft_status: 'active' }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByText(/lock once the draft starts/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Scoring Settings' })).toBeDisabled();
  expect(screen.getByLabelText('Per Yard')).toBeDisabled();
});

test('editing a leaf value and a tier field, then saving, sends the full nested payload', async () => {
  mockScoringRules();
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  const touchdownField = await screen.findByLabelText('Touchdown');
  await userEvent.clear(touchdownField);
  await userEvent.type(touchdownField, '6');

  const pointsFields = screen.getAllByLabelText('Points');
  await userEvent.clear(pointsFields[0]);
  await userEvent.type(pointsFields[0], '4');

  await userEvent.click(screen.getByRole('button', { name: 'Save Scoring Settings' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      scoringRules: {
        passing: { yards: 0.04, touchdowns: 6, interceptions: -2, twoPointConversions: 2 },
        kicking: {
          extraPoint: 1,
          fieldGoal: [
            { min: 0, max: 39, points: 4 },
            { min: 40, max: 49, points: 4 },
            { min: 50, max: null, points: 5 },
          ],
        },
        idp: { soloTackle: 1, sack: 2 },
      },
    })
  );
  expect(await screen.findByText('Scoring settings saved')).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

test('Reset Scoring Settings requires a confirming second click before reverting', async () => {
  mockScoringRules();
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  const touchdownField = await screen.findByLabelText('Touchdown');
  await userEvent.clear(touchdownField);
  await userEvent.type(touchdownField, '99');
  expect(touchdownField).toHaveValue(99);

  await userEvent.click(screen.getByRole('button', { name: 'Reset Scoring Settings' }));
  expect(touchdownField).toHaveValue(99); // first click only arms the reset

  await userEvent.click(screen.getByRole('button', { name: 'Click again to confirm reset' }));
  expect(touchdownField).toHaveValue(4);
});

test('+ IDP Flex Slot appends a DL/LB/DB slot and enables DP; a second click raises its count', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  await userEvent.click(screen.getByRole('button', { name: '+ IDP Flex Slot (DL/LB/DB)' }));
  const slotNames = screen.getAllByLabelText('Slot Name').map((el) => el.value);
  expect(slotNames).toContain('IDP FLEX');
  expect(screen.getByLabelText('Enable Defensive Players (IDP)')).toBeChecked();

  // Second click must NOT duplicate the row (names are unique identifiers) —
  // it bumps the existing slot's count, the model for two identical spots.
  await userEvent.click(screen.getByRole('button', { name: '+ IDP Flex Slot (DL/LB/DB)' }));
  expect(screen.getAllByLabelText('Slot Name').map((el) => el.value).filter((v) => v === 'IDP FLEX')).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Save Roster Settings' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
  const payload = apiClient.put.mock.calls[0][1];
  expect(payload.rosterSlots).toContainEqual({ key: 'IDP FLEX', count: 2, eligiblePositions: ['DL', 'LB', 'DB'] });
  expect(payload.dpEnabled).toBe(true);
});

test('an invalid slot name is rejected client-side with a specific message, no request sent', async () => {
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  await userEvent.click(screen.getByRole('button', { name: '+ Add Slot' }));
  const nameFields = screen.getAllByLabelText('Slot Name');
  await userEvent.type(nameFields[nameFields.length - 1], 'FLEX!');
  await userEvent.click(screen.getByRole('button', { name: 'Save Roster Settings' }));

  expect(await screen.findByText(/slot names are 1-20 characters/i)).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a lineup template chip stamps in its slots and enables DP for the IDP template', async () => {
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  expect(screen.getAllByLabelText('Slot Name')).toHaveLength(2);
  await userEvent.click(screen.getByRole('button', { name: 'IDP starter' }));

  const slotNames = screen.getAllByLabelText('Slot Name').map((el) => el.value);
  expect(slotNames).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'DL', 'LB', 'DB']);
  expect(screen.getByLabelText('Enable Defensive Players (IDP)')).toBeChecked();
});

test('a league\'s existing custom scoring_rules seed the editor over the defaults', async () => {
  mockScoringRules();
  renderTools({ league: league({ scoring_rules: { passing: { touchdowns: 8 } } }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByLabelText('Touchdown')).toHaveValue(8);
  expect(screen.getByLabelText('Per Yard')).toHaveValue(0.04); // untouched default
});

// --- Playoffs & Schedule ---

test('Playoff structure fields are disabled once the draft has started, but the trade deadline stays editable', async () => {
  renderTools({ league: league({ draft_status: 'active' }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));

  expect(screen.getByText(/locks once the draft starts/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Playoff Settings' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save Trade Deadline' })).toBeEnabled();
});

test('Save Playoff Settings sends the playoff-teams/start-week/consolation payload', async () => {
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));

  await userEvent.click(screen.getByRole('button', { name: 'Save Playoff Settings' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      playoffTeams: 4,
      regularSeasonWeeks: 14,
      playoffConsolation: false,
    })
  );
  expect(await screen.findByText('Playoff settings saved')).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

test('Save Trade Deadline sends the selected week', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));

  await userEvent.click(screen.getByLabelText('Trade Deadline'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 11' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save Trade Deadline' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', { tradeDeadlineWeek: 11 })
  );
  expect(await screen.findByText('Trade deadline saved')).toBeInTheDocument();
});

test('Save Trade Deadline sends null when the commissioner picks No deadline (the clear path, #65)', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools({ league: league({ trade_deadline_week: 11 }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));

  await userEvent.click(screen.getByLabelText('Trade Deadline'));
  await userEvent.click(await screen.findByRole('option', { name: 'No deadline' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save Trade Deadline' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', { tradeDeadlineWeek: null })
  );
  expect(await screen.findByText('Trade deadline saved')).toBeInTheDocument();
});

// --- Waivers & Trades ---

test('Save Waiver Rules maps the Trade Review radio choice to review-hours/veto-votes', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Waivers & Trades' }));

  await userEvent.click(screen.getByRole('radio', { name: 'FAAB (Bidding)' }));
  await userEvent.click(screen.getByRole('radio', { name: 'Instant Process' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save Waiver Rules' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      waiverType: 'faab',
      waiverPeriodHours: 24,
      tradeReviewHours: 0,
      tradeVetoVotes: 0,
    })
  );
});

test('League Vote review mode reveals a votes-needed field and includes it in the save', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Waivers & Trades' }));

  await userEvent.click(screen.getByRole('radio', { name: 'League Vote' }));
  const votesField = screen.getByLabelText('Votes needed to veto');
  await userEvent.clear(votesField);
  await userEvent.type(votesField, '5');
  await userEvent.click(screen.getByRole('button', { name: 'Save Waiver Rules' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', expect.objectContaining({
      tradeReviewHours: 24,
      tradeVetoVotes: 5,
    }))
  );
});

test('toggling Continuous Waivers hides the clear-period select and saves 0 hours', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Waivers & Trades' }));

  expect(screen.getByLabelText('Waiver Clear Period')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: /Continuous waivers/ }));
  expect(screen.queryByLabelText('Waiver Clear Period')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Save Waiver Rules' }));
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', expect.objectContaining({
      waiverPeriodHours: 0,
    }))
  );
});

// --- System Overrides ---

test('Force Roster Move requires confirmation before calling force-transaction', async () => {
  apiClient.post.mockResolvedValue({});
  mockGetByUrl({
    '/api/players': { data: { players: [{ id: 55, name: 'Puka Nacua', position: 'WR', nfl_team: 'LAR' }] } },
  });
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  await userEvent.click(screen.getAllByLabelText('Team')[0]); // Force Roster Move's Team select
  await userEvent.click(await screen.findByRole('option', { name: "Bob's Team" }));
  await userEvent.type(screen.getByLabelText('Player Search'), 'Puka');
  await userEvent.click(await screen.findByText('Puka Nacua'));

  const forceButton = screen.getByRole('button', { name: 'Force Transaction' });
  await userEvent.click(forceButton);
  expect(await screen.findByText(/Force add Puka Nacua\?/)).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();

  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Force Transaction' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/commissioner/league/1/force-transaction', {
      teamId: 2, action: 'add', playerId: 55,
    })
  );
});

test('FAAB Budget Editor pre-fills the selected team\'s remaining FAAB and saves an edit', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  const teamSelects = screen.getAllByLabelText('Team');
  await userEvent.click(teamSelects[1]); // FAAB editor's Team select
  await userEvent.click(await screen.findByRole('option', { name: "Bob's Team" }));

  const faabInput = screen.getByLabelText('Remaining FAAB');
  expect(faabInput).toHaveValue(60);
  await userEvent.clear(faabInput);
  await userEvent.type(faabInput, '35');
  await userEvent.click(screen.getByRole('button', { name: 'Save FAAB Budget' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/commissioner/league/1/teams/2/faab', {
      faabRemaining: 35,
    })
  );
});

test('Manual Score Correction fetches the matchup and applies a point adjustment', async () => {
  mockGetByUrl({
    '/matchups': {
      data: [
        { id: 9, season: 2026, week: 3, home_team_id: 1, away_team_id: 2, home_score: 100, away_score: 90, home_team_name: "Alice's Team", away_team_name: "Bob's Team" },
      ],
    },
  });
  apiClient.post.mockResolvedValue({
    data: { id: 9, season: 2026, week: 3, home_team_id: 1, away_team_id: 2, home_score: 105, away_score: 90 },
  });
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  const teamSelects = screen.getAllByLabelText('Team');
  await userEvent.click(teamSelects[2]); // Score correction's Team select
  await userEvent.click(await screen.findByRole('option', { name: "Alice's Team" }));
  await userEvent.click(screen.getByLabelText('Week'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 3' }));

  expect(await screen.findByText(/Current score:/)).toBeInTheDocument();
  const adjustmentInput = screen.getByLabelText('Adjustment (+/-)');
  await userEvent.type(adjustmentInput, '5');
  await userEvent.click(screen.getByRole('button', { name: 'Apply Correction' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/correct-week', {
      season: 2026,
      week: 3,
      matchupId: 9,
      homeScore: 105,
      awayScore: 90,
    })
  );
});

test('Matchup Scheduling & Scoring can generate matchups and score a week', async () => {
  apiClient.post.mockResolvedValue({ data: {} });
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  // Defaults (season 2025, week 1) are used as-is.
  await userEvent.click(screen.getByRole('button', { name: 'Generate Matchups' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/matchups', { season: 2025, week: 1 })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Score Week' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/score', { season: 2025, week: 1 })
  );
  expect(onRefresh).toHaveBeenCalled();
});

test('Matchup Scheduling & Scoring surfaces a toast and skips refresh when an op fails', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { error: 'No teams to schedule' } } });
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  await userEvent.click(screen.getByRole('button', { name: 'Generate Matchups' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/matchups', { season: 2025, week: 1 })
  );
  expect(await screen.findByText('No teams to schedule')).toBeInTheDocument();
  expect(onRefresh).not.toHaveBeenCalled();

  // Score Week fails independently and likewise reports rather than refreshing.
  await userEvent.click(screen.getByRole('button', { name: 'Score Week' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/score', { season: 2025, week: 1 })
  );
  expect(onRefresh).not.toHaveBeenCalled();
});

test('Manual Score Correction preserves input and locks submission after the correction window expires', async () => {
  mockGetByUrl({
    '/matchups': {
      data: [
        { id: 9, season: 2026, week: 3, home_team_id: 1, away_team_id: 2, home_score: 100, away_score: 90, home_team_name: "Alice's Team", away_team_name: "Bob's Team" },
      ],
    },
  });
  apiClient.post.mockRejectedValue({
    response: {
      status: 403,
      data: {
        error: 'CORRECTION_WINDOW_EXPIRED',
        message: 'Manual score modifications for this week are locked.',
      },
    },
  });
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  const teamSelects = screen.getAllByLabelText('Team');
  await userEvent.click(teamSelects[2]);
  await userEvent.click(await screen.findByRole('option', { name: "Alice's Team" }));
  await userEvent.click(screen.getByLabelText('Week'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 3' }));

  expect(await screen.findByText(/Current score:/)).toBeInTheDocument();
  const adjustmentInput = screen.getByLabelText('Adjustment (+/-)');
  await userEvent.type(adjustmentInput, '5');
  const submitButton = screen.getByRole('button', { name: 'Apply Correction' });
  await userEvent.click(submitButton);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Manual score modifications for this week are locked.'
  );
  expect(submitButton).toBeDisabled();
  expect(adjustmentInput).toHaveValue(5);
  expect(screen.getByText(/Current score:/)).toHaveTextContent('Current score: 100');
  expect(screen.getByText('Manual Score Correction')).toBeInTheDocument();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('Lock Specific Team toggles a single team without touching the league-wide lock', async () => {
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  await userEvent.click(screen.getByRole('checkbox', { name: "Lock Bob's Team" }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/commissioner/league/1/teams/2/lock', {
      locked: true,
    })
  );
  expect(onRefresh).toHaveBeenCalled();
});

// --- Co-commissioners (owner-only) ---

const withOwnerIds = [
  { id: 1, teamId: 1, name: "Alice's Team", owner: 'alice', owner_id: 1, faab_remaining: 100, locked: false },
  { id: 2, teamId: 2, name: "Bob's Team", owner: 'bob', owner_id: 2, faab_remaining: 60, locked: false },
];

test('the co-commissioner section is owner-only', () => {
  const { unmount } = renderTools({ isOwner: false, teams: withOwnerIds });
  expect(screen.queryByText('Co-commissioners')).not.toBeInTheDocument();
  unmount();

  renderTools({ isOwner: true, teams: withOwnerIds });
  expect(screen.getByText('Co-commissioners')).toBeInTheDocument();
});

// #188: a role prop defaults to the answer that grants nothing. `isOwner`
// defaulted to true, so a caller that forgot to pass it was handed the two
// powers the creator cannot delegate. There is one caller today and it passes
// the prop, so this was latent rather than live - but a role question whose
// unanswered state is "yes" is the kind of thing this sweep exists to find.
test('owner-only controls stay hidden when no role is passed at all', () => {
  renderTools({ teams: withOwnerIds });
  expect(screen.queryByText('Co-commissioners')).not.toBeInTheDocument();
});

// #188: listCoCommissioners LEFT JOINs each grant to its Team and ships
// `teamId` / `teamName` (#112), and LeagueRules' LeagueOfficials renders that
// same array the contract way. This card instead rebuilt the join client-side
// by matching `c.user_id` against `teams[].owner_id` - re-deriving, from
// account fields, an answer the payload already carried. The fixture below is
// the shape that separates the two: the grant names its own Team and the team
// rows carry no owner account id to re-join on.
test("names each grant's Team from the payload rather than re-joining on account ids", () => {
  const contractTeams = [
    { id: 1, teamId: 1, name: "Alice's Team" },
    { id: 2, teamId: 2, name: "Bob's Team" },
  ];
  renderTools({
    isOwner: true,
    teams: contractTeams,
    league: league({
      co_commissioners: [{ user_id: 2, username: 'bob', teamId: 2, teamName: 'Deputy FC' }],
    }),
  });

  // Scoped to the grant's own row: "Deputy FC" is the Team name the grant
  // carries, and it appears nowhere else on the page, so finding it proves the
  // card read the payload rather than rebuilding a null.
  const grantRow = screen.getByRole('button', { name: 'Remove bob as co-commissioner' }).closest('li');
  expect(within(grantRow).getByText('Deputy FC')).toBeInTheDocument();
});

test('the owner promotes a member by user id and refreshes', async () => {
  apiClient.post.mockResolvedValue({ data: { coCommissioners: [] } });
  const onRefresh = jest.fn();
  renderTools({ isOwner: true, teams: withOwnerIds, onRefresh });

  await userEvent.click(screen.getByRole('combobox', { name: 'Add a co-commissioner' }));
  await userEvent.click(await screen.findByRole('option', { name: /bob/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Promote' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/co-commissioners', { userId: 2 })
  );
  expect(onRefresh).toHaveBeenCalled();
});

test('the owner is never offered as a co-commissioner candidate', async () => {
  renderTools({ isOwner: true, teams: withOwnerIds });

  await userEvent.click(screen.getByRole('combobox', { name: 'Add a co-commissioner' }));

  expect(await screen.findByRole('option', { name: /bob/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /alice/ })).not.toBeInTheDocument();
});

test('an existing co-commissioner is listed and can be revoked after confirming', async () => {
  apiClient.delete.mockResolvedValue({ data: { coCommissioners: [] } });
  const onRefresh = jest.fn();
  renderTools({
    isOwner: true,
    teams: withOwnerIds,
    onRefresh,
    league: league({ co_commissioners: [{ user_id: 2, username: 'bob' }] }),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Remove bob as co-commissioner' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/league/1/co-commissioners/2')
  );
  expect(onRefresh).toHaveBeenCalled();
});

test('cancelling the revoke dialog leaves the co-commissioner in place', async () => {
  renderTools({
    isOwner: true,
    teams: withOwnerIds,
    league: league({ co_commissioners: [{ user_id: 2, username: 'bob' }] }),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Remove bob as co-commissioner' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(apiClient.delete).not.toHaveBeenCalled();
});

test('an already-promoted member drops out of the candidate list', () => {
  renderTools({
    isOwner: true,
    teams: withOwnerIds,
    league: league({ co_commissioners: [{ user_id: 2, username: 'bob' }] }),
  });

  expect(screen.getByRole('combobox', { name: 'Add a co-commissioner' })).toHaveAttribute('aria-disabled', 'true');
});

// --- Pick'em-only leagues ---

const pickemLeague = (overrides = {}) =>
  league({ pickem_only: true, draft_status: 'pending', season_status: 'regular', min_teams: 2, max_teams: 50, ...overrides });

test("a pick'em-only league gets only General Settings and a Season tab, with no fantasy controls", () => {
  renderTools({ league: pickemLeague() });

  expect(screen.getByRole('tab', { name: 'General Settings' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Season' })).toBeInTheDocument();
  for (const name of ['Roster Settings', 'Scoring Settings', 'Playoffs & Schedule', 'Waivers & Trades', 'System Overrides']) {
    expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
  }
  // Transactions (adds, drops, waivers, trades) do not exist here.
  expect(screen.queryByRole('checkbox', { name: 'Lock Transactions' })).not.toBeInTheDocument();
  // Membership stays editable all season, up to the pick'em cap.
  expect(screen.getByText('Team limit')).toBeInTheDocument();
  expect(screen.getByLabelText('Max teams')).toHaveAttribute('max', '50');
  expect(screen.queryByLabelText('Min teams')).not.toBeInTheDocument();
  expect(screen.getByText('Remove a team')).toBeInTheDocument();
});

test("the pick'em Season tab explains the automatic season and offers rollover only once it is complete", async () => {
  const { unmount } = renderTools({ league: pickemLeague() });
  await userEvent.click(screen.getByRole('tab', { name: 'Season' }));
  expect(screen.getByText(/weeks follow the NFL calendar/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start New Season' })).not.toBeInTheDocument();
  unmount();

  const onRefresh = jest.fn();
  apiClient.post.mockResolvedValue({ data: {} });
  renderTools({ league: pickemLeague({ season_status: 'complete' }), onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'Season' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start New Season' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/commissioner/league/1/rollover', {})
  );
  expect(await screen.findByText('New season started!')).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

test('a fantasy league keeps the General Settings rollover and shows no Season tab', () => {
  // Season completion is read from the league row (phase), not a standings row.
  renderTools({ league: league({ draft_status: 'complete', season_status: 'complete', current_week: 17 }) });
  expect(screen.queryByRole('tab', { name: 'Season' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start New Season' })).toBeInTheDocument();
});

// Hash-only navigation between two leagues keeps LeagueDashboard (and this
// component) mounted, so a fantasy tab left selected must not carry over into
// a pick'em-only league. Rendered without renderWithProviders so the rerender
// keeps the same tree shape and the component instance (and its tab state).
const StableShell = ({ children }) => (
  <Provider store={configureMockStore([])({ user: {}, errors: { loginMessage: '', registrationMessage: '' } })}>
    <MemoryRouter>
      <SnackbarProvider>{children}</SnackbarProvider>
    </MemoryRouter>
  </Provider>
);

test("a fantasy tab left selected does not survive a switch to a pick'em-only league (hash-only navigation keeps the component mounted)", async () => {
  const { rerender } = render(
    <StableShell>
      <CommissionerTools leagueId={1} league={league()} teams={teams} viewerTeamId={1} onRefresh={jest.fn()} />
    </StableShell>
  );
  // MUI's Tabs indicator repositions via a MutationObserver that fires
  // asynchronously after mount, outside render()'s own synchronous act()
  // flush. Let it settle before interacting so its update lands inside act.
  await flush();
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));
  expect(screen.getByRole('button', { name: 'Save Scoring Settings' })).toBeInTheDocument();

  rerender(
    <StableShell>
      <CommissionerTools leagueId={2} league={pickemLeague({ id: 2 })} teams={teams} viewerTeamId={1} onRefresh={jest.fn()} />
    </StableShell>
  );
  // The rerender swaps in a whole new tab set, so Tabs repositions its
  // indicator again - same MutationObserver settling as after the initial
  // render above.
  await flush();

  expect(screen.getByRole('tab', { name: 'General Settings' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('button', { name: 'Save Scoring Settings' })).not.toBeInTheDocument();
  expect(screen.getByText('Remove a team')).toBeInTheDocument(); // the General panel body is showing
  expect(screen.queryByRole('tab', { name: 'Scoring Settings' })).not.toBeInTheDocument();
});

test("a pick'em-only league edits only its max teams (min gates nothing without a draft)", async () => {
  apiClient.put.mockResolvedValue({ data: {} });
  renderTools({ league: pickemLeague({ min_teams: 2, max_teams: 20 }) });

  expect(screen.queryByLabelText('Min teams')).not.toBeInTheDocument();
  const max = screen.getByLabelText('Max teams');
  await userEvent.clear(max);
  await userEvent.type(max, '12');
  await userEvent.click(screen.getByRole('button', { name: 'Save Limits' }));

  // handleSaveLimits awaits apiClient.put before its own notify()/onRefresh()
  // calls, so asserting on the call alone resolves before that trailing
  // consequence lands. Await the visible toast instead, matching the other
  // save-settings tests in this file - by the time it appears, the put call
  // has already happened with its final args, so no separate waitFor is
  // needed for that.
  expect(await screen.findByText('Team limits updated')).toBeInTheDocument();
  expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', { maxTeams: 12 });
});

// --- Settings freeze keys on League phase (#57) ---
// The greyed-out state follows the same past-pre-draft rule the server's
// frozenSettingKeys enforces, so the UI never offers an edit the server
// refuses for phase reasons: frozen for the whole fantasy season (including
// after it completes), never for a pick'em-only league (it has no draft).

test('the freeze holds all season for a fantasy league: roster, scoring, playoff structure and team limits stay locked once the season is complete', async () => {
  mockScoringRules();
  renderTools({ league: league({ draft_status: 'complete', season_status: 'complete', current_week: 17 }) });

  expect(screen.queryByLabelText('Min teams')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save Limits' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));
  expect(screen.getByRole('button', { name: 'Save Roster Settings' })).toBeDisabled();

  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));
  expect(await screen.findByRole('button', { name: 'Save Scoring Settings' })).toBeDisabled();

  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));
  expect(screen.getByRole('button', { name: 'Save Playoff Settings' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save Trade Deadline' })).toBeEnabled();
});

test("a pick'em-only league's team limit stays editable whatever its draft or season status (nothing is draft-frozen without a draft)", () => {
  renderTools({ league: pickemLeague({ draft_status: 'complete', season_status: 'complete', max_teams: 20 }) });
  expect(screen.getByLabelText('Max teams')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save Limits' })).toBeEnabled();
});
