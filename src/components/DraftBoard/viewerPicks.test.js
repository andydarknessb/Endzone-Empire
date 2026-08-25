import { viewerPicksFor } from './viewerPicks';

// Issue #124 acceptance criterion 4: the viewer's next three Pick numbers
// inline, the complete list behind a popover. Everything about who holds which
// slot comes from src/lib/draftTurns.js; what is tested here is that this
// module asks it the right question for the right Team.

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

const labels = (result) => result.all.map((pick) => pick.pickLabel);

describe('a snake draft', () => {
  test('gives the Team at slot 1 the ends of the rounds', () => {
    const result = viewerPicksFor({
      league: activeLeague(),
      teams: leagueTeams(10),
      rounds: 4,
      viewerTeamId: 1,
    });

    // 1.01, then the snake turn hands slot 1 the last pick of round 2.
    expect(labels(result)).toEqual(['1.01', '2.10', '3.01', '4.10']);
  });

  test('gives a middle Team its two picks either side of each turn', () => {
    const result = viewerPicksFor({
      league: activeLeague(),
      teams: leagueTeams(10),
      rounds: 4,
      viewerTeamId: 4,
    });

    expect(labels(result)).toEqual(['1.04', '2.07', '3.04', '4.07']);
  });

  test('the next three are the first three of the complete list', () => {
    const result = viewerPicksFor({
      league: activeLeague(),
      teams: leagueTeams(12),
      rounds: 15,
      viewerTeamId: 3,
    });

    expect(result.all).toHaveLength(15);
    expect(result.next).toEqual(result.all.slice(0, 3));
    expect(result.next.map((pick) => pick.pickLabel)).toEqual(['1.03', '2.10', '3.03']);
  });

  test('a Team with fewer than three picks left offers only the picks it has', () => {
    const result = viewerPicksFor({
      league: activeLeague({ current_pick: 20 }),
      teams: leagueTeams(10),
      rounds: 3,
      viewerTeamId: 5,
    });

    // Rounds 1 and 2 are behind the clock; only 3.05 remains.
    expect(labels(result)).toEqual(['3.05']);
    expect(result.next).toHaveLength(1);
  });
});

describe('a linear draft', () => {
  test('gives every Team the same slot in every round', () => {
    const result = viewerPicksFor({
      league: activeLeague({ draft_rotation: 'linear' }),
      teams: leagueTeams(8),
      rounds: 4,
      viewerTeamId: 6,
    });

    expect(labels(result)).toEqual(['1.06', '2.06', '3.06', '4.06']);
  });

  test('and differs from the snake reading of the same league', () => {
    // The rotation is read from the league, not assumed. Without that, a
    // linear league would be handed the snake answer and every label after
    // round 1 would be wrong while round 1 still looked right.
    const args = { teams: leagueTeams(8), rounds: 3, viewerTeamId: 6 };
    const linear = viewerPicksFor({ ...args, league: activeLeague({ draft_rotation: 'linear' }) });
    const snake = viewerPicksFor({ ...args, league: activeLeague({ draft_rotation: 'snake' }) });

    expect(labels(linear)).toEqual(['1.06', '2.06', '3.06']);
    expect(labels(snake)).toEqual(['1.06', '2.03', '3.06']);
  });
});

describe('dynamic league sizes', () => {
  test.each([4, 6, 8, 10, 12, 14])('a %i-team league gives every Team one pick per round', (size) => {
    const rounds = 5;
    const teams = leagueTeams(size);

    for (const team of teams) {
      const result = viewerPicksFor({
        league: activeLeague(), teams, rounds, viewerTeamId: team.teamId,
      });
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
    const seen = teams.flatMap((team) => viewerPicksFor({
      league: activeLeague(), teams, rounds, viewerTeamId: team.teamId,
    }).all.map((pick) => pick.pickNumber));

    expect([...seen].sort((a, b) => a - b))
      .toEqual(Array.from({ length: size * rounds }, (_unused, index) => index + 1));
  });
});

describe('what it refuses to answer', () => {
  test('a pending draft has no readable order, so no picks are named', () => {
    const result = viewerPicksFor({
      league: activeLeague({ draft_status: 'pending' }),
      teams: leagueTeams(10),
      rounds: 4,
      viewerTeamId: 1,
    });

    expect(result.all).toEqual([]);
    expect(result.next).toEqual([]);
  });

  test('an order with a Team missing its slot is not guessed at', () => {
    const teams = leagueTeams(10);
    teams[3].draft_position = null;

    expect(viewerPicksFor({
      league: activeLeague(), teams, rounds: 4, viewerTeamId: 1,
    }).all).toEqual([]);
  });

  test('two Teams sharing a slot is not guessed at either', () => {
    const teams = leagueTeams(10);
    teams[3].draft_position = 3;

    expect(viewerPicksFor({
      league: activeLeague(), teams, rounds: 4, viewerTeamId: 1,
    }).all).toEqual([]);
  });

  test('a spectator holds no Team, so there are no picks of theirs to name', () => {
    // The regression this guards is not a crash, it is a helpful default:
    // falling back to the first Team's picks would show a spectator a
    // confident list of picks that are not theirs. Verified to fail against
    // exactly that implementation.
    expect(viewerPicksFor({
      league: activeLeague(), teams: leagueTeams(10), rounds: 4, viewerTeamId: null,
    }).all).toEqual([]);
  });

  test('no rounds means no draft to read forward through', () => {
    expect(viewerPicksFor({
      league: activeLeague(), teams: leagueTeams(10), rounds: 0, viewerTeamId: 1,
    }).all).toEqual([]);
  });

  test('called with nothing at all it is empty rather than throwing', () => {
    expect(viewerPicksFor()).toEqual({ all: [], next: [] });
  });
});

describe('picks already off the board', () => {
  test('the pick on the clock is the viewer\'s own next one, not skipped', () => {
    // current_pick is 0-based and IS the pick on the clock. A manager on the
    // clock must see that pick in their own list, or the panel tells them
    // their next pick is the one after the one they are making.
    const result = viewerPicksFor({
      league: activeLeague({ current_pick: 3 }),
      teams: leagueTeams(10),
      rounds: 3,
      viewerTeamId: 4,
    });

    expect(result.next[0].pickLabel).toBe('1.04');
  });

  test('a keeper sitting at a future pick number is not a pick still to make', () => {
    // Keepers are pre-inserted at their pick numbers when the draft starts and
    // the live draft skips over them (src/lib/draftTurns.js).
    const teams = leagueTeams(10);
    const withoutKeeper = viewerPicksFor({
      league: activeLeague(), teams, rounds: 3, viewerTeamId: 1,
    });
    const withKeeper = viewerPicksFor({
      league: activeLeague(),
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
    const result = viewerPicksFor({
      league: activeLeague({ current_pick: 1 }),
      teams,
      rounds: 3,
      viewerTeamId: 5,
      picks: [{ pick_number: 1, teamId: 1 }],
    });

    expect(labels(result)).toEqual(['1.05', '2.06', '3.05']);
  });
});

describe('what each pick carries', () => {
  test('a 1-based Pick number beside the label a manager reads off the board', () => {
    const [first, second] = viewerPicksFor({
      league: activeLeague(), teams: leagueTeams(10), rounds: 2, viewerTeamId: 2,
    }).all;

    // draft_picks.pick_number is 1-based; leagues.current_pick is 0-based.
    // The conversion happens exactly once, here.
    expect(first).toEqual({ pickNumber: 2, pickLabel: '1.02' });
    expect(second).toEqual({ pickNumber: 19, pickLabel: '2.09' });
  });
});
