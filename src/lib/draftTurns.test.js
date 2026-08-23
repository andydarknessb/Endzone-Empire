import {
  isPermutationOf,
  teamIndexForPick,
  teamIdForPick,
  pickLabelFor,
  remainingPickNumbersFor,
  turnSummaryFor,
  teamsInDraftOrder,
  draftOrderIsSettled,
} from './draftTurns';

// Ids are deliberately NOT 1..N and not in id order: any function that returns
// a base-order INDEX where an ID is expected (or vice versa) fails loudly.
const IDS_10 = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const T = IDS_10.length;
const ROUNDS = 4;
const TOTAL = T * ROUNDS; // 40

const remaining = (teamId, overrides = {}) =>
  remainingPickNumbersFor({
    teamId, teamIds: IDS_10, fromPick0: 0, totalPicks: TOTAL, ...overrides,
  });

describe('teamIndexForPick', () => {
  // Hand table, T=10: rounds 0 and 2 run 0..9, round 1 runs 9..0.
  const expected = [
    ...Array.from({ length: 10 }, (_, i) => i),
    ...Array.from({ length: 10 }, (_, i) => 9 - i),
    ...Array.from({ length: 10 }, (_, i) => i),
  ];

  test.each(expected.map((index, n) => [n, index]))(
    'snake pick %i belongs to base index %i',
    (n, index) => {
      expect(teamIndexForPick(n, T)).toBe(index);
    }
  );

  test('linear repeats the same order every round', () => {
    for (let n = 0; n < 30; n++) {
      expect(teamIndexForPick(n, T, { rotation: 'linear' })).toBe(n % T);
    }
  });

  test('returns -1 rather than dividing by zero when there are no teams', () => {
    expect(teamIndexForPick(0, 0)).toBe(-1);
  });
});

describe('teamIdForPick', () => {
  test('maps base order to ids, not indices', () => {
    expect(teamIdForPick(0, IDS_10)).toBe(101);
    expect(teamIdForPick(9, IDS_10)).toBe(110);
    expect(teamIdForPick(10, IDS_10)).toBe(110); // snake turn
    expect(teamIdForPick(19, IDS_10)).toBe(101);
  });

  test('returns null with no teams', () => {
    expect(teamIdForPick(3, [])).toBeNull();
  });

  describe('overrides', () => {
    const reversed = [...IDS_10].reverse();

    test('apply to the named round only, keyed 1-based', () => {
      const overrides = { 2: reversed };
      // Round 1 (picks 0-9) stays linear.
      expect(teamIdForPick(0, IDS_10, { rotation: 'linear', overrides })).toBe(101);
      // Round 2 (picks 10-19) is reversed.
      expect(teamIdForPick(10, IDS_10, { rotation: 'linear', overrides })).toBe(110);
      // Round 3 (picks 20-29) is linear again.
      expect(teamIdForPick(20, IDS_10, { rotation: 'linear', overrides })).toBe(101);
    });

    test('key "0" is never consulted (rounds are 1-based)', () => {
      const overrides = { 0: reversed };
      expect(teamIdForPick(0, IDS_10, { rotation: 'linear', overrides })).toBe(101);
    });

    test.each([
      ['wrong length', [101, 102]],
      ['a departed team id', [999, ...IDS_10.slice(1)]],
      ['a duplicate', [101, 101, ...IDS_10.slice(2)]],
      ['not an array', { 0: 101 }],
      ['null', null],
    ])('a stale override (%s) falls through to the rotation', (_label, order) => {
      const overrides = { 1: order };
      expect(teamIdForPick(0, IDS_10, { overrides })).toBe(101);
      expect(teamIdForPick(9, IDS_10, { overrides })).toBe(110);
    });
  });
});

describe('pickLabelFor', () => {
  test.each([
    [0, T, '1.01'],
    [9, T, '1.10'],
    [10, T, '2.01'],
    [19, T, '2.10'],
    [119, T, '12.10'],
    [6, 12, '1.07'],
  ])('pick %i of %i teams reads %s', (n, teamCount, label) => {
    expect(pickLabelFor(n, teamCount)).toBe(label);
  });

  test('is null when there is nothing to label', () => {
    expect(pickLabelFor(0, 0)).toBeNull();
    expect(pickLabelFor(-1, T)).toBeNull();
  });
});

describe('remainingPickNumbersFor', () => {
  test('draft slot 1 turns back to back across the round 2/3 boundary', () => {
    expect(remaining(101)).toEqual([0, 19, 20, 39]);
  });

  test('the last draft slot turns back to back across the round 1/2 boundary', () => {
    expect(remaining(110)).toEqual([9, 10, 29, 30]);
  });

  test('a middle draft slot alternates gaps and never picks back to back', () => {
    expect(remaining(105)).toEqual([4, 15, 24, 35]);
  });

  test('linear rotation gives every slot a constant gap', () => {
    expect(remaining(105, { rotation: 'linear' })).toEqual([4, 14, 24, 34]);
    expect(remaining(110, { rotation: 'linear' })).toEqual([9, 19, 29, 39]);
  });

  test('includes the pick currently on the clock', () => {
    expect(remaining(110, { fromPick0: 9 })).toEqual([9, 10, 29, 30]);
  });

  test('skips keeper picks the team already holds', () => {
    // Slot 1 owns 0, 19, 20, 39. A keeper sitting on 20 is not a pick to come.
    const takenPickNumbers = new Set([20]);
    expect(remaining(101, { takenPickNumbers })).toEqual([0, 19, 39]);
  });

  test('a keeper on another team does not change this team’s picks', () => {
    expect(remaining(101, { takenPickNumbers: new Set([5, 6, 7]) })).toEqual([0, 19, 20, 39]);
  });

  test('honours limit', () => {
    expect(remaining(101, { limit: 2 })).toEqual([0, 19]);
  });

  test.each([
    ['no teams', { teamIds: [] }],
    ['an unknown team', { teamId: 999 }],
    ['a null team', { teamId: null }],
    ['no picks left', { fromPick0: TOTAL }],
    ['a zero-round draft', { totalPicks: 0 }],
  ])('returns an empty list for %s', (_label, overrides) => {
    expect(remaining(101, overrides)).toEqual([]);
  });
});

describe('turnSummaryFor', () => {
  const summary = (teamId, overrides = {}) =>
    turnSummaryFor({
      teamId, teamIds: IDS_10, fromPick0: 0, totalPicks: TOTAL, ...overrides,
    });

  test('the last slot is flagged back to back on its own turn', () => {
    const result = summary(110, { fromPick0: 9 });
    expect(result.remainingPicks).toBe(4);
    expect(result.nextPick.label).toBe('1.10');
    expect(result.followingPick.label).toBe('2.01');
    expect(result.backToBack).toBe(true);
  });

  test('a middle slot is never back to back', () => {
    const result = summary(105);
    expect(result.nextPick.label).toBe('1.05');
    expect(result.followingPick.label).toBe('2.06');
    expect(result.backToBack).toBe(false);
  });

  test('the final pick of the draft has no following pick', () => {
    const result = summary(101, { fromPick0: 39 });
    expect(result.remainingPicks).toBe(1);
    expect(result.nextPick.label).toBe('4.10');
    expect(result.followingPick).toBeNull();
    expect(result.backToBack).toBe(false);
  });

  test('a finished draft reports nothing rather than a fabricated pick', () => {
    const result = summary(101, { fromPick0: TOTAL });
    expect(result).toMatchObject({
      remainingPicks: 0, nextPick: null, followingPick: null, backToBack: false,
    });
  });
});

// The whole point of this module is that it agrees with the server. Anything
// less makes "Next pick 4.04" a lie. See the SYNC OBLIGATION in draftTurns.js.
describe('parity with server/services/draftOrder.service.js', () => {
  // eslint-disable-next-line global-require
  const { teamForPick } = require('../../server/services/draftOrder.service');

  // Deterministic pseudo-random sweep: no Math.random, so a failure reproduces.
  const lcg = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  test.each([4, 7, 10, 12, 14])('matches teamForPick across a %i-team draft', (teamCount) => {
    const teamIds = Array.from({ length: teamCount }, (_, i) => 200 + i * 3);
    const teams = teamIds.map((id) => ({ id }));
    const rand = lcg(teamCount * 7919);

    for (const rotation of ['snake', 'linear']) {
      // A stale override on round 3 must fall through identically on both sides.
      const overrides = {
        2: [...teamIds].reverse(),
        3: teamIds.slice(0, -1),
        5: [...teamIds].sort(() => (rand() < 0.5 ? -1 : 1)),
      };
      for (let n = 0; n < teamCount * 8; n++) {
        const mine = teamIdForPick(n, teamIds, { rotation, overrides });
        const theirs = teamForPick(n, teams, { rotation, overrides });
        expect(mine).toBe(theirs ? theirs.id : null);
      }
    }
  });
});

// teamsInDraftOrder and draftOrderIsSettled moved here from two hand-copies
// (rosterViewFor in DraftBoard.jsx, and upcomingTeams.js) that had already
// begun to diverge. Both are mirrors of server ordering, so they are tested
// where the sync obligation is recorded rather than beside each consumer.
describe('teamsInDraftOrder', () => {
  const team = (teamId, draft_position) => ({ teamId, draft_position });

  test('orders by draft_position, lowest first', () => {
    const ordered = teamsInDraftOrder([team(9, 3), team(7, 1), team(8, 2)]);
    expect(ordered.map((t) => t.teamId)).toEqual([7, 8, 9]);
  });

  test('puts teams with no slot last, not first', () => {
    // NULLS LAST on the server. Sorting them first would silently hand slot 1
    // to a team that does not hold it.
    const ordered = teamsInDraftOrder([team(9, null), team(7, 2), team(8, 1)]);
    expect(ordered.map((t) => t.teamId)).toEqual([8, 7, 9]);
  });

  test('breaks ties on Team ID rather than returning NaN', () => {
    // The load-bearing case: with two null positions a comparator written as
    // (a ?? Infinity) - (b ?? Infinity) returns NaN, which is unspecified
    // behaviour rather than merely unstable ordering.
    const ordered = teamsInDraftOrder([team(9, null), team(7, null), team(8, null)]);
    expect(ordered.map((t) => t.teamId)).toEqual([7, 8, 9]);
  });

  test('does not reorder the array it was given', () => {
    const teams = [team(9, 3), team(7, 1)];
    teamsInDraftOrder(teams);
    expect(teams.map((t) => t.teamId)).toEqual([9, 7]);
  });
});

describe('draftOrderIsSettled', () => {
  const ORDERED = [
    { teamId: 7, draft_position: 1 },
    { teamId: 8, draft_position: 2 },
  ];
  const settled = (overrides = {}, orderedTeams = ORDERED, rounds = 4) =>
    draftOrderIsSettled({ league: { draft_status: 'active', ...overrides }, orderedTeams, rounds });

  test('an active draft with every slot held and distinct is settled', () => {
    expect(settled()).toBe(true);
  });

  test('a pending draft is never settled, however complete its order looks', () => {
    expect(settled({ draft_status: 'pending' })).toBe(false);
  });

  test('an unheld slot or a duplicated one is not settled', () => {
    expect(settled({}, [ORDERED[0], { teamId: 8, draft_position: null }])).toBe(false);
    expect(settled({}, [ORDERED[0], { teamId: 8, draft_position: 1 }])).toBe(false);
  });

  test('no teams and no rounds are each unsettled rather than vacuously true', () => {
    expect(settled({}, [])).toBe(false);
    expect(settled({}, ORDERED, 0)).toBe(false);
  });

  test('no league at all is unsettled rather than a throw', () => {
    expect(draftOrderIsSettled({ league: null, orderedTeams: ORDERED, rounds: 4 })).toBe(false);
    expect(draftOrderIsSettled()).toBe(false);
  });
});
