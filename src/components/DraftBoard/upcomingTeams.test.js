import { upcomingTeamsFor } from './upcomingTeams';

// Issue #123 acceptance criterion 2: the compact Upcoming strip showing the
// next three Teams. "Next" means after the Team currently On the clock, which
// is shown persistently above the rail and is not repeated here.

const TEAMS = [
  { teamId: 11, teamName: 'Ridge Runners', draft_position: 1 },
  { teamId: 22, teamName: 'Harbor Hawks', draft_position: 2 },
  { teamId: 33, teamName: 'Iron Elk', draft_position: 3 },
];

const league = (overrides = {}) => ({
  draft_status: 'active',
  current_pick: 0,
  draft_rotation: 'snake',
  draft_order_overrides: null,
  ...overrides,
});

test('names the three Teams after the one on the clock, in Draft order', () => {
  const upcoming = upcomingTeamsFor({
    league: league({ current_pick: 0 }), teams: TEAMS, picks: [], rounds: 4,
  });

  expect(upcoming.map((entry) => entry.teamName)).toEqual([
    'Harbor Hawks', 'Iron Elk', 'Iron Elk',
  ]);
  expect(upcoming.map((entry) => entry.teamId)).toEqual([22, 33, 33]);
});

test('a snake turn names the same Team twice rather than deduplicating it', () => {
  // Iron Elk holds 1.03 and 2.01 back to back. Collapsing that to one entry
  // would tell a manager they wait one turn when they wait two.
  const upcoming = upcomingTeamsFor({
    league: league({ current_pick: 1 }), teams: TEAMS, picks: [], rounds: 4,
  });

  expect(upcoming.map((entry) => entry.pickLabel)).toEqual(['1.03', '2.01', '2.02']);
  expect(upcoming.map((entry) => entry.teamName)).toEqual(['Iron Elk', 'Iron Elk', 'Harbor Hawks']);
});

test('a linear rotation does not reverse at the turn', () => {
  const upcoming = upcomingTeamsFor({
    league: league({ current_pick: 1, draft_rotation: 'linear' }), teams: TEAMS, picks: [], rounds: 4,
  });

  expect(upcoming.map((entry) => entry.teamName)).toEqual(['Iron Elk', 'Ridge Runners', 'Harbor Hawks']);
});

test('the pick number shown is the 1-based one a manager sees on the board', () => {
  // leagues.current_pick is 0-based; draft_picks.pick_number is 1-based.
  const [next] = upcomingTeamsFor({
    league: league({ current_pick: 0 }), teams: TEAMS, picks: [], rounds: 4,
  });

  expect(next.pickNumber).toBe(2);
  expect(next.pickLabel).toBe('1.02');
});

test('a keeper already sitting at a future pick number is skipped, not announced', () => {
  // Keepers are pre-inserted at their future pick numbers when the draft
  // starts and the live draft skips over them, so nobody is ever on the clock
  // for one.
  const picks = [{ pick_number: 2, teamId: 22 }];
  const upcoming = upcomingTeamsFor({
    league: league({ current_pick: 0 }), teams: TEAMS, picks, rounds: 4,
  });

  expect(upcoming.map((entry) => entry.pickNumber)).toEqual([3, 4, 5]);
});

test('honours a per-round Draft order override the same way the server does', () => {
  const overrides = { 1: [33, 22, 11] };
  const upcoming = upcomingTeamsFor({
    league: league({ current_pick: 0, draft_order_overrides: overrides }), teams: TEAMS, picks: [], rounds: 4,
  });

  expect(upcoming.map((entry) => entry.teamName)).toEqual(['Harbor Hawks', 'Ridge Runners', 'Iron Elk']);
});

test('runs out honestly at the end of the draft rather than inventing picks', () => {
  const upcoming = upcomingTeamsFor({
    league: league({ current_pick: 7 }), teams: TEAMS, picks: [], rounds: 3,
  });

  expect(upcoming.map((entry) => entry.pickNumber)).toEqual([9]);
});

test('a pending draft has no upcoming picks - the order is not settled yet', () => {
  expect(upcomingTeamsFor({
    league: league({ draft_status: 'pending' }), teams: TEAMS, picks: [], rounds: 4,
  })).toEqual([]);
});

test('a completed draft has no upcoming picks either', () => {
  // Its order IS settled, and deliberately stays so: My Roster reads pick
  // labels off the same predicate to render a finished team. Nothing is
  // upcoming once the draft is over, and current_pick is not what says so -
  // a completed draft can carry any value there.
  expect(upcomingTeamsFor({
    league: league({ draft_status: 'complete', current_pick: 0 }), teams: TEAMS, picks: [], rounds: 4,
  })).toEqual([]);
});

test('an incomplete or duplicated Draft order yields nothing rather than a guess', () => {
  const unset = [{ ...TEAMS[0] }, { ...TEAMS[1], draft_position: null }, TEAMS[2]];
  expect(upcomingTeamsFor({ league: league(), teams: unset, picks: [], rounds: 4 })).toEqual([]);

  const duplicated = [TEAMS[0], { ...TEAMS[1], draft_position: 1 }, TEAMS[2]];
  expect(upcomingTeamsFor({ league: league(), teams: duplicated, picks: [], rounds: 4 })).toEqual([]);
});

test('no teams, no rounds and no league each answer with nothing at all', () => {
  expect(upcomingTeamsFor({ league: league(), teams: [], picks: [], rounds: 4 })).toEqual([]);
  expect(upcomingTeamsFor({ league: league(), teams: TEAMS, picks: [], rounds: 0 })).toEqual([]);
  expect(upcomingTeamsFor({ league: null, teams: TEAMS, picks: [], rounds: 4 })).toEqual([]);
});

test('carries a Team name through untouched, with no former-manager fallback', () => {
  // These are the league's CURRENT teams, and a current team always has a
  // name (src/lib/teamIdentity.js). Routing them through teamNameLabel would
  // turn a data bug into a plausible-looking "Former manager" that nobody
  // investigates, which is the failure that label exists to prevent.
  const [next] = upcomingTeamsFor({
    league: league({ current_pick: 0 }), teams: TEAMS, picks: [], rounds: 4,
  });

  expect(next.teamName).toBe('Harbor Hawks');
});
