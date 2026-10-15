import { isBestBallManagedSlot, moveLegality } from './moveLegality';

const entry = (overrides = {}) => ({
  playerId: 1,
  slot: 'QB',
  locked: false,
  spent: false,
  validStash: false,
  eligibleSlots: ['BENCH', 'QB'],
  ...overrides,
});
const bench = (overrides = {}) => entry({ playerId: 2, slot: 'BENCH', ...overrides });
// A locked IR occupant who no longer qualifies for the stash (the server's stale-stash exception).
const staleStash = (overrides = {}) =>
  entry({ playerId: 3, slot: 'IR', locked: true, validStash: false, eligibleSlots: ['BENCH', 'RB'], ...overrides });

const base = { targetEntry: null, bestBall: false, leagueUnsettled: false };

describe('isBestBallManagedSlot', () => {
  test.each([
    ['BENCH', true],
    ['IR', true],
    ['QB', false],
    ['FLEX', false],
  ])('%s -> %s', (slot, expected) => {
    expect(isBestBallManagedSlot(slot)).toBe(expected);
  });
});

describe('moveLegality', () => {
  test.each([
    ['an ordinary move into an empty eligible slot', { entry: bench(), targetSlot: 'QB' }, { ok: true }],
    [
      'an ordinary swap, eligible both ways',
      { entry: bench(), targetEntry: entry(), targetSlot: 'QB' },
      { ok: true },
    ],
    [
      'a locked stale stash moving to BENCH',
      { entry: staleStash(), targetSlot: 'BENCH' },
      { ok: true },
    ],
    [
      'a locked stale stash swapping with an unlocked bench player',
      { entry: staleStash({ eligibleSlots: ['BENCH', 'IR'] }), targetEntry: bench({ eligibleSlots: ['BENCH', 'IR'] }), targetSlot: 'BENCH' },
      { ok: true },
    ],
    ['the league is unsettled', { entry: bench(), targetSlot: 'QB', leagueUnsettled: true }, { ok: false, reason: 'unsettled' }],
    ['no entry to move', { entry: null, targetSlot: 'QB' }, { ok: false, reason: 'ineligible' }],
    ['best ball, source in a starting slot', { entry: entry(), targetSlot: 'BENCH', bestBall: true }, { ok: false, reason: 'best_ball' }],
    ['best ball, target a starting slot', { entry: bench(), targetSlot: 'QB', bestBall: true }, { ok: false, reason: 'best_ball' }],
    ['best ball BENCH/IR management', { entry: bench({ eligibleSlots: ['BENCH', 'IR'] }), targetSlot: 'IR', bestBall: true }, { ok: true }],
    ['a spent mover', { entry: bench({ spent: true }), targetSlot: 'QB' }, { ok: false, reason: 'spent' }],
    ['a spent target', { entry: bench(), targetEntry: entry({ spent: true }), targetSlot: 'QB' }, { ok: false, reason: 'spent' }],
    ['a locked mover', { entry: bench({ locked: true }), targetSlot: 'QB' }, { ok: false, reason: 'locked' }],
    ['a locked target', { entry: bench(), targetEntry: entry({ locked: true }), targetSlot: 'QB' }, { ok: false, reason: 'locked' }],
    [
      'a locked IR occupant who is still a valid stash',
      { entry: staleStash({ validStash: true }), targetSlot: 'BENCH' },
      { ok: false, reason: 'locked' },
    ],
    [
      'a locked stale stash in best ball (BENCH scores there)',
      { entry: staleStash(), targetSlot: 'BENCH', bestBall: true },
      { ok: false, reason: 'locked' },
    ],
    [
      'a locked stale stash into a starting slot',
      { entry: staleStash(), targetSlot: 'RB' },
      { ok: false, reason: 'stash_only_to_bench' },
    ],
    [
      'a locked stale stash swapping with a starter',
      { entry: staleStash(), targetEntry: entry({ slot: 'RB', eligibleSlots: ['BENCH', 'RB', 'IR'] }), targetSlot: 'RB' },
      { ok: false, reason: 'stash_only_to_bench' },
    ],
    ['a mover not eligible for the target slot', { entry: bench({ eligibleSlots: ['BENCH'] }), targetSlot: 'QB' }, { ok: false, reason: 'ineligible' }],
    [
      'a target occupant not eligible for the mover\'s slot (reciprocal)',
      { entry: entry(), targetEntry: bench({ eligibleSlots: ['BENCH'] }), targetSlot: 'BENCH' },
      { ok: false, reason: 'ineligible' },
    ],
    ['a mover with no eligibleSlots fact', { entry: bench({ eligibleSlots: undefined }), targetSlot: 'QB' }, { ok: false, reason: 'ineligible' }],
  ])('%s', (_name, args, expected) => {
    expect(moveLegality({ ...base, ...args })).toEqual(expected);
  });
});
