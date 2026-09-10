import { commissionerFacts } from './commissionerFacts';

/**
 * Pure-function tests for `commissionerFacts` (ADR 0034): moved here from
 * `widgets/commissioner-panel/ui/CommissionerPanel.test.jsx`'s `--- facts ---`
 * block along with the function itself. That widget test file keeps one
 * lean composition case (does the widget still render what this function
 * returns, off the league it was already given, with no request of its
 * own); every edge case of the function's own derivation lives here instead,
 * against plain fixtures with no rendering and no apiClient.
 */

// A league carrying every field the fact grid reads: 9 starters across six
// slots, a bench, an IR slot, half-PPR reception, a FAAB waiver window and a
// trade deadline.
const fullyConfiguredLeague = (overrides = {}) => ({
  transactions_locked: true,
  trade_deadline_week: 11,
  waiver_type: 'faab',
  waiver_period_hours: 24,
  trade_review_hours: 24,
  bench_slots: 5,
  ir_slots: 1,
  roster_slots: [
    { key: 'QB', count: 1 },
    { key: 'RB', count: 2 },
    { key: 'WR', count: 3 },
    { key: 'TE', count: 1 },
    { key: 'FLEX', count: 1 },
    { key: 'K', count: 1 },
  ],
  scoring_rules: { receiving: { reception: 0.5 } },
  ...overrides,
});

const teamsWithLocks = (n, lockedCount) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    teamName: `Team ${i + 1}`,
    locked: i < lockedCount,
  }));

const factByKey = (facts, key) => facts.find((fact) => fact.key === key);

test('states every fact a fully-configured league carries', () => {
  const facts = commissionerFacts(fullyConfiguredLeague(), teamsWithLocks(12, 2));
  expect(factByKey(facts, 'transactions').value).toBe('Locked');
  expect(factByKey(facts, 'teams-locked').value).toBe('2 of 12');
  expect(factByKey(facts, 'trade-deadline').value).toBe('Week 11');
  expect(factByKey(facts, 'waivers').value).toBe('FAAB · 24h');
  expect(factByKey(facts, 'trade-review').value).toBe('24h');
  expect(factByKey(facts, 'roster').value).toBe('9 starters · 5 bench · 1 IR');
  expect(factByKey(facts, 'scoring').value).toBe('Half PPR');
});

test('an unlocked league reads Open, and a null deadline reads None', () => {
  // `trade_deadline_week` is the one nullable source behind a fact: null is
  // the answer, not an absence, and it must not read as week 0
  // (`Number(null)`).
  const facts = commissionerFacts(
    fullyConfiguredLeague({ transactions_locked: false, trade_deadline_week: null }),
    teamsWithLocks(12, 0)
  );
  expect(factByKey(facts, 'transactions').value).toBe('Open');
  expect(factByKey(facts, 'trade-deadline').value).toBe('None');
  expect(factByKey(facts, 'teams-locked').value).toBe('0 of 12');
});

test('a league carrying none of the source fields returns no facts at all', () => {
  const facts = commissionerFacts({}, [{ teamId: 1, id: 1 }]);
  expect(facts).toEqual([]);
});

test('a missing league returns no facts', () => {
  expect(commissionerFacts(null, [])).toEqual([]);
});

test("a pick'em-only league states no fantasy facts", () => {
  // Transactions, roster freezes, waivers, trades, lineup slots and scoring
  // are all fantasy concepts; the legacy tools hide every one of them for a
  // pick'em-only league, and so does the grid.
  const facts = commissionerFacts(
    fullyConfiguredLeague({ pickem_only: true }),
    teamsWithLocks(20, 3)
  );
  expect(facts).toEqual([]);
});
