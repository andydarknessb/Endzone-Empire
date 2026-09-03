import { draftOrderWindowFor } from './draftOrderWindow';

// Issue #793: the Draft order windowed once. One module answers who picks next
// (the Upcoming strip), which of those picks are the viewer's own, and the
// viewer's turn facts. This suite carries every case from the retired
// upcomingTeams.test.js and viewerPicks.test.js (titles preserved), the turn
// cases that used to render the whole room in DraftBoard.test.jsx, and the
// combined readings only one call can make.
//
// The window derives its own `rounds` through draftRounds(league), so these
// leagues carry draft_rounds (an active league reads it straight through) or a
// roster shape (a legacy row without draft_rounds) rather than a rounds arg.

// ---------------------------------------------------------------------------
// The Upcoming strip: the next Teams after the one on the clock.
// ---------------------------------------------------------------------------

const TEAMS = [
  { teamId: 11, teamName: 'Ridge Runners', draft_position: 1 },
  { teamId: 22, teamName: 'Harbor Hawks', draft_position: 2 },
  { teamId: 33, teamName: 'Iron Elk', draft_position: 3 },
];

const orderLeague = (overrides = {}) => ({
  draft_status: 'active',
  current_pick: 0,
  draft_rotation: 'snake',
  draft_order_overrides: null,
  ...overrides,
});

describe('the Upcoming strip', () => {
  test('names the three Teams after the one on the clock, in Draft order', () => {
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 0, draft_rounds: 4 }), teams: TEAMS, picks: [],
    });

    expect(upcoming.map((entry) => entry.teamName)).toEqual([
      'Harbor Hawks', 'Iron Elk', 'Iron Elk',
    ]);
    expect(upcoming.map((entry) => entry.teamId)).toEqual([22, 33, 33]);
  });

  test('a snake turn names the same Team twice rather than deduplicating it', () => {
    // Iron Elk holds 1.03 and 2.01 back to back. Collapsing that to one entry
    // would tell a manager they wait one turn when they wait two.
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 1, draft_rounds: 4 }), teams: TEAMS, picks: [],
    });

    expect(upcoming.map((entry) => entry.pickLabel)).toEqual(['1.03', '2.01', '2.02']);
    expect(upcoming.map((entry) => entry.teamName)).toEqual(['Iron Elk', 'Iron Elk', 'Harbor Hawks']);
  });

  test('a linear rotation does not reverse at the turn', () => {
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 1, draft_rotation: 'linear', draft_rounds: 4 }), teams: TEAMS, picks: [],
    });

    expect(upcoming.map((entry) => entry.teamName)).toEqual(['Iron Elk', 'Ridge Runners', 'Harbor Hawks']);
  });

  test('the pick number shown is the 1-based one a manager sees on the board', () => {
    // leagues.current_pick is 0-based; draft_picks.pick_number is 1-based.
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 0, draft_rounds: 4 }), teams: TEAMS, picks: [],
    });
    const [next] = upcoming;

    expect(next.pickNumber).toBe(2);
    expect(next.pickLabel).toBe('1.02');
  });

  test('a keeper already sitting at a future pick number is skipped, not announced', () => {
    // Keepers are pre-inserted at their future pick numbers when the draft
    // starts and the live draft skips over them, so nobody is ever on the clock
    // for one.
    const picks = [{ pick_number: 2, teamId: 22 }];
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 0, draft_rounds: 4 }), teams: TEAMS, picks,
    });

    expect(upcoming.map((entry) => entry.pickNumber)).toEqual([3, 4, 5]);
  });

  test('honours a per-round Draft order override the same way the server does', () => {
    const overrides = { 1: [33, 22, 11] };
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 0, draft_order_overrides: overrides, draft_rounds: 4 }), teams: TEAMS, picks: [],
    });

    expect(upcoming.map((entry) => entry.teamName)).toEqual(['Harbor Hawks', 'Ridge Runners', 'Iron Elk']);
  });

  test('runs out honestly at the end of the draft rather than inventing picks', () => {
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 7, draft_rounds: 3 }), teams: TEAMS, picks: [],
    });

    expect(upcoming.map((entry) => entry.pickNumber)).toEqual([9]);
  });

  test('a pending draft has no upcoming picks - the order is not settled yet', () => {
    expect(draftOrderWindowFor({
      league: orderLeague({ draft_status: 'pending', draft_rounds: 4 }), teams: TEAMS, picks: [],
    }).upcoming).toEqual([]);
  });

  test('a completed draft has no upcoming picks either', () => {
    // Its order IS settled, and deliberately stays so: My Roster reads pick
    // labels off the same predicate to render a finished team. Nothing is
    // upcoming once the draft is over, and current_pick is not what says so -
    // a completed draft can carry any value there.
    expect(draftOrderWindowFor({
      league: orderLeague({ draft_status: 'complete', current_pick: 0, draft_rounds: 4 }), teams: TEAMS, picks: [],
    }).upcoming).toEqual([]);
  });

  test('an incomplete or duplicated Draft order yields nothing rather than a guess', () => {
    const unset = [{ ...TEAMS[0] }, { ...TEAMS[1], draft_position: null }, TEAMS[2]];
    expect(draftOrderWindowFor({ league: orderLeague({ draft_rounds: 4 }), teams: unset, picks: [] }).upcoming).toEqual([]);

    const duplicated = [TEAMS[0], { ...TEAMS[1], draft_position: 1 }, TEAMS[2]];
    expect(draftOrderWindowFor({ league: orderLeague({ draft_rounds: 4 }), teams: duplicated, picks: [] }).upcoming).toEqual([]);
  });

  test('no teams, no rounds and no league each answer with nothing at all', () => {
    expect(draftOrderWindowFor({ league: orderLeague({ draft_rounds: 4 }), teams: [], picks: [] }).upcoming).toEqual([]);
    expect(draftOrderWindowFor({ league: orderLeague({ draft_rounds: 0 }), teams: TEAMS, picks: [] }).upcoming).toEqual([]);
    expect(draftOrderWindowFor({ league: null, teams: TEAMS, picks: [] }).upcoming).toEqual([]);
  });

  test('carries a Team name through untouched, with no former-manager fallback', () => {
    // These are the league's CURRENT teams, and a current team always has a
    // name (src/lib/teamIdentity.js). Routing them through teamNameLabel would
    // turn a data bug into a plausible-looking "Former manager" that nobody
    // investigates, which is the failure that label exists to prevent.
    const { upcoming } = draftOrderWindowFor({
      league: orderLeague({ current_pick: 0, draft_rounds: 4 }), teams: TEAMS, picks: [],
    });
    const [next] = upcoming;

    expect(next.teamName).toBe('Harbor Hawks');
  });
});

// ---------------------------------------------------------------------------
// The viewer's own picks: which of the upcoming picks are mine.
// ---------------------------------------------------------------------------

/** `size` teams in draft order, Team IDs 1..size. */
const leagueTeams = (size) => Array.from({ length: size }, (_unused, index) => ({
  teamId: index + 1,
  teamName: `Team ${index + 1}`,
  draft_position: index + 1,
}));

const activeLeague = (overrides = {}) => ({
  draft_status: 'active',
  current_pick: 0,
  draft_rotation: 'snake',
  ...overrides,
});

/** The viewer's picks off the window, translating a rounds count into the
 *  active league's own draft_rounds (which the window reads through
 *  draftRounds). */
const viewerPicksOf = ({ league = activeLeague(), teams, rounds, viewerTeamId, picks = [] }) =>
  draftOrderWindowFor({
    league: league ? { ...league, draft_rounds: rounds } : league,
    teams,
    picks,
    viewerTeamId,
  }).viewerPicks;

const labels = (result) => result.all.map((pick) => pick.pickLabel);

describe('a snake draft', () => {
  test('gives the Team at slot 1 the ends of the rounds', () => {
    const result = viewerPicksOf({ teams: leagueTeams(10), rounds: 4, viewerTeamId: 1 });

    // 1.01, then the snake turn hands slot 1 the last pick of round 2.
    expect(labels(result)).toEqual(['1.01', '2.10', '3.01', '4.10']);
  });

  test('gives a middle Team its two picks either side of each turn', () => {
    const result = viewerPicksOf({ teams: leagueTeams(10), rounds: 4, viewerTeamId: 4 });

    expect(labels(result)).toEqual(['1.04', '2.07', '3.04', '4.07']);
  });

  test('the next three are the first three of the complete list', () => {
    const result = viewerPicksOf({ teams: leagueTeams(12), rounds: 15, viewerTeamId: 3 });

    expect(result.all).toHaveLength(15);
    expect(result.next).toEqual(result.all.slice(0, 3));
    expect(result.next.map((pick) => pick.pickLabel)).toEqual(['1.03', '2.10', '3.03']);
  });

  test('a Team with fewer than three picks left offers only the picks it has', () => {
    const result = viewerPicksOf({
      league: activeLeague({ current_pick: 20 }), teams: leagueTeams(10), rounds: 3, viewerTeamId: 5,
    });

    // Rounds 1 and 2 are behind the clock; only 3.05 remains.
    expect(labels(result)).toEqual(['3.05']);
    expect(result.next).toHaveLength(1);
  });
});

describe('a linear draft', () => {
  test('gives every Team the same slot in every round', () => {
    const result = viewerPicksOf({
      league: activeLeague({ draft_rotation: 'linear' }), teams: leagueTeams(8), rounds: 4, viewerTeamId: 6,
    });

    expect(labels(result)).toEqual(['1.06', '2.06', '3.06', '4.06']);
  });

  test('and differs from the snake reading of the same league', () => {
    // The rotation is read from the league, not assumed. Without that, a
    // linear league would be handed the snake answer and every label after
    // round 1 would be wrong while round 1 still looked right.
    const args = { teams: leagueTeams(8), rounds: 3, viewerTeamId: 6 };
    const linear = viewerPicksOf({ ...args, league: activeLeague({ draft_rotation: 'linear' }) });
    const snake = viewerPicksOf({ ...args, league: activeLeague({ draft_rotation: 'snake' }) });

    expect(labels(linear)).toEqual(['1.06', '2.06', '3.06']);
    expect(labels(snake)).toEqual(['1.06', '2.03', '3.06']);
  });
});

describe('dynamic league sizes', () => {
  test.each([4, 6, 8, 10, 12, 14])('a %i-team league gives every Team one pick per round', (size) => {
    const rounds = 5;
    const teams = leagueTeams(size);

    for (const team of teams) {
      const result = viewerPicksOf({ teams, rounds, viewerTeamId: team.teamId });
      expect(result.all).toHaveLength(rounds);
      // Slot width follows the league, so a 14-team league reads 1.14 and not
      // a two-digit label padded to some fixed width.
      expect(result.all[0].pickLabel).toBe(`1.${String(team.teamId).padStart(2, '0')}`);
    }
  });

  test('every pick in the draft belongs to exactly one Team', () => {
    // The union across Teams is the whole draft with nothing repeated, which
    // catches a rotation error that merely re-attributes picks rather than
    // losing them.
    const size = 6;
    const rounds = 4;
    const teams = leagueTeams(size);
    const seen = teams.flatMap((team) => viewerPicksOf({
      teams, rounds, viewerTeamId: team.teamId,
    }).all.map((pick) => pick.pickNumber));

    expect([...seen].sort((a, b) => a - b))
      .toEqual(Array.from({ length: size * rounds }, (_unused, index) => index + 1));
  });
});

describe('what it refuses to answer', () => {
  test('a pending draft has no readable order, so no picks are named', () => {
    const result = viewerPicksOf({
      league: activeLeague({ draft_status: 'pending' }), teams: leagueTeams(10), rounds: 4, viewerTeamId: 1,
    });

    expect(result.all).toEqual([]);
    expect(result.next).toEqual([]);
  });

  test('an order with a Team missing its slot is not guessed at', () => {
    const teams = leagueTeams(10);
    teams[3].draft_position = null;

    expect(viewerPicksOf({ teams, rounds: 4, viewerTeamId: 1 }).all).toEqual([]);
  });

  test('two Teams sharing a slot is not guessed at either', () => {
    const teams = leagueTeams(10);
    teams[3].draft_position = 3;

    expect(viewerPicksOf({ teams, rounds: 4, viewerTeamId: 1 }).all).toEqual([]);
  });

  test('a spectator holds no Team, so there are no picks of theirs to name', () => {
    // The regression this guards is not a crash, it is a helpful default:
    // falling back to the first Team's picks would show a spectator a
    // confident list of picks that are not theirs. Verified to fail against
    // exactly that implementation.
    expect(viewerPicksOf({ teams: leagueTeams(10), rounds: 4, viewerTeamId: null }).all).toEqual([]);
  });

  test('no rounds means no draft to read forward through', () => {
    expect(viewerPicksOf({ teams: leagueTeams(10), rounds: 0, viewerTeamId: 1 }).all).toEqual([]);
  });

  test('called with nothing at all it is empty rather than throwing', () => {
    expect(draftOrderWindowFor().viewerPicks).toEqual({ all: [], next: [] });
  });
});

describe('picks already off the board', () => {
  test('the pick on the clock is the viewer\'s own next one, not skipped', () => {
    // current_pick is 0-based and IS the pick on the clock. A manager on the
    // clock must see that pick in their own list, or the panel tells them
    // their next pick is the one after the one they are making.
    const result = viewerPicksOf({
      league: activeLeague({ current_pick: 3 }), teams: leagueTeams(10), rounds: 3, viewerTeamId: 4,
    });

    expect(result.next[0].pickLabel).toBe('1.04');
  });

  test('a keeper sitting at a future pick number is not a pick still to make', () => {
    // Keepers are pre-inserted at their pick numbers when the draft starts and
    // the live draft skips over them (src/lib/draftTurns.js).
    const teams = leagueTeams(10);
    const withoutKeeper = viewerPicksOf({ teams, rounds: 3, viewerTeamId: 1 });
    const withKeeper = viewerPicksOf({
      teams,
      rounds: 3,
      viewerTeamId: 1,
      // 1-based on the wire, as draft_picks.pick_number is. 3.01 is pick 21.
      picks: [{ pick_number: 21, teamId: 1 }],
    });

    expect(labels(withoutKeeper)).toEqual(['1.01', '2.10', '3.01']);
    expect(labels(withKeeper)).toEqual(['1.01', '2.10']);
  });

  test('another Team\'s taken pick does not shift the viewer\'s remaining ones', () => {
    const teams = leagueTeams(10);
    const result = viewerPicksOf({
      league: activeLeague({ current_pick: 1 }), teams, rounds: 3, viewerTeamId: 5,
      picks: [{ pick_number: 1, teamId: 1 }],
    });

    expect(labels(result)).toEqual(['1.05', '2.06', '3.05']);
  });
});

describe('what each pick carries', () => {
  test('a 1-based Pick number beside the label a manager reads off the board', () => {
    const { all } = viewerPicksOf({ teams: leagueTeams(10), rounds: 2, viewerTeamId: 2 });
    const [first, second] = all;

    // draft_picks.pick_number is 1-based; leagues.current_pick is 0-based.
    // The conversion happens exactly once, here.
    expect(first).toEqual({ pickNumber: 2, pickLabel: '1.02' });
    expect(second).toEqual({ pickNumber: 19, pickLabel: '2.09' });
  });
});

// ---------------------------------------------------------------------------
// The viewer's turn facts: remaining count and next label, for My Roster.
// These moved from DraftBoard.test.jsx (issue #793 AC4) - they used to render
// the whole room to read a label the window now returns directly.
// ---------------------------------------------------------------------------

/** Two teams, snake, the third pick of a 19-round draft on the clock (a 12
 *  starter / 7 bench / 1 IR league derives roster_limit 20, so draftRounds is
 *  20 less the undraftable IR slot = 19). */
const rosterLeague = (overrides = {}) => ({
  draft_status: 'active',
  current_pick: 2,
  draft_rotation: 'snake',
  roster_limit: 20,
  bench_slots: 7,
  ir_slots: 1,
  ...overrides,
});

const rosterTeams = [
  { teamId: 1, teamName: 'Team A', draft_position: 1 },
  { teamId: 2, teamName: 'Team B', draft_position: 2 },
];

const firstPick = { pick_number: 1, teamId: 1 };

test('names the next pick from the league’s own rotation', () => {
  // Two teams, snake, the third pick overall on the clock and Team A has made
  // 1.01, so Team A is next up at 2.02.
  const { viewerTurn } = draftOrderWindowFor({
    league: rosterLeague(), teams: rosterTeams, picks: [firstPick], viewerTeamId: 1,
  });

  expect(viewerTurn.nextPickLabel).toBe('2.02');
});

test('names the viewer’s own next three Picks, with the rest behind the popover', () => {
  const { viewerPicks } = draftOrderWindowFor({
    league: rosterLeague(), teams: rosterTeams, picks: [firstPick], viewerTeamId: 1,
  });

  expect(viewerPicks.next.map((pick) => pick.pickLabel)).toEqual(['2.02', '3.01', '4.02']);
  // 19 Draft rounds (roster_limit 20 less the undraftable IR slot), less the
  // pick already made.
  expect(viewerPicks.all).toHaveLength(18);
  expect(viewerPicks.all[0].pickLabel).toBe('2.02');
  expect(viewerPicks.all[viewerPicks.all.length - 1].pickLabel).toBe('19.01');
});

test('reads the viewer’s Picks off a linear league’s own rotation, not a snake assumption', () => {
  const { viewerPicks } = draftOrderWindowFor({
    league: rosterLeague({ draft_rotation: 'linear', current_pick: 1 }),
    teams: rosterTeams,
    picks: [],
    viewerTeamId: 1,
  });

  // Linear: slot 1 in every round. Under a snake reading the second of these
  // would be 2.02, which is a wait of one turn rather than three.
  expect(viewerPicks.next.map((pick) => pick.pickLabel)).toEqual(['2.01', '3.01', '4.01']);
});

test('a spectator with no Team here is offered no picks of their own', () => {
  // A spectator is a viewer whose join ack carried no Team (#112). The window
  // still answers the league-wide questions; only the viewer-relative ones go
  // empty. Verified to fail against a reading that defaults a spectator to the
  // first Team's picks.
  const { upcoming, viewerPicks, viewerTurn } = draftOrderWindowFor({
    league: rosterLeague(), teams: rosterTeams, picks: [firstPick], viewerTeamId: null,
  });

  expect(viewerPicks).toEqual({ all: [], next: [] });
  expect(viewerTurn).toBeNull();
  expect(upcoming.length).toBeGreaterThan(0);
});

test('skips a keeper the team already holds when naming the next pick', () => {
  const { viewerTurn } = draftOrderWindowFor({
    league: rosterLeague(),
    teams: rosterTeams,
    picks: [firstPick, { pick_number: 4, teamId: 1, is_keeper: true }],
    viewerTeamId: 1,
  });

  // 2.02 is Team A's next turn by rotation, but a keeper is already sitting on
  // it, so the next pick they actually make is 3.01.
  expect(viewerTurn.nextPickLabel).toBe('3.01');
});

// ---------------------------------------------------------------------------
// One settled reading: the whole window in a single call (issue #793 AC1).
// ---------------------------------------------------------------------------

describe('the whole window at once', () => {
  test('an unsettled order answers every question empty in one call', () => {
    const window = draftOrderWindowFor({
      league: orderLeague({ draft_status: 'pending', draft_rounds: 4 }),
      teams: TEAMS,
      picks: [],
      viewerTeamId: 11,
    });

    expect(window.settled).toBe(false);
    expect(window.upcoming).toEqual([]);
    expect(window.viewerPicks).toEqual({ all: [], next: [] });
    expect(window.viewerTurn).toBeNull();
  });

  test('a settled snake league gives a viewer their turn and a spectator none', () => {
    const league = { ...activeLeague(), draft_rounds: 4 };
    const forViewer = draftOrderWindowFor({
      league, teams: leagueTeams(10), picks: [], viewerTeamId: 4,
    });
    const forSpectator = draftOrderWindowFor({
      league, teams: leagueTeams(10), picks: [], viewerTeamId: null,
    });

    expect(forViewer.settled).toBe(true);
    expect(forViewer.viewerTurn.remainingPicks).toBe(4);
    expect(forViewer.viewerTurn.nextPickLabel).toBe('1.04');
    expect(forSpectator.viewerTurn).toBeNull();
  });

  test('a linear league\'s viewerTurn names the next pick off the linear rotation', () => {
    const window = draftOrderWindowFor({
      league: { ...activeLeague({ draft_rotation: 'linear', current_pick: 6 }), draft_rounds: 4 },
      teams: leagueTeams(8),
      picks: [],
      viewerTeamId: 6,
    });

    // Linear: slot 6 in every round. Past the viewer's 1.06 (pick index 5, now
    // behind the clock at pick 6), their next is 2.06. A snake reading would
    // reverse round 2 and give 2.03 instead.
    expect(window.viewerTurn.nextPickLabel).toBe('2.06');
  });

  test('derives rounds from draftRounds, so a legacy row without draft_rounds still reads', () => {
    // No draft_rounds on the row: draftRounds falls back to the roster shape
    // (roster_limit 5 less 0 IR = 5 rounds). Reading league.draft_rounds
    // directly would make totalPicks NaN, the order unsettled, and this empty.
    const window = draftOrderWindowFor({
      league: {
        draft_status: 'active', current_pick: 0, draft_rotation: 'snake', roster_limit: 5, ir_slots: 0,
      },
      teams: leagueTeams(4),
      picks: [],
      viewerTeamId: 1,
    });

    expect(window.settled).toBe(true);
    expect(window.viewerPicks.all).toHaveLength(5);
    expect(window.viewerPicks.all[0].pickLabel).toBe('1.01');
  });
});
