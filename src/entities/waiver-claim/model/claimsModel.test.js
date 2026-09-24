import { claimsFromResponse } from './claimsModel';

const NOW = new Date('2026-09-24T12:00:00Z');
const hours = (h) => new Date(NOW.getTime() + h * 3600 * 1000).toISOString();

const claim = (over) => ({
  id: 1,
  player_id: 10,
  player_name: 'Player A',
  drop_player_id: null,
  drop_player_name: null,
  bid: 0,
  status: 'pending',
  note: null,
  claim_order: 1,
  created_at: '2026-09-20T00:00:00Z',
  processed_at: null,
  ...over,
});

const body = (myClaims, over = {}) => ({
  league: { waiver_type: 'priority', faab_budget: 0, waivers_clear_at: null },
  myTeam: { waiver_priority: 3, faab_remaining: 0 },
  myClaims,
  ...over,
});

const faabBody = (myClaims, remaining = 100) =>
  body(myClaims, {
    league: { waiver_type: 'faab', faab_budget: 100, waivers_clear_at: null },
    myTeam: { waiver_priority: 3, faab_remaining: remaining },
  });

describe('pending claims in Claim order', () => {
  test('sorts by claim_order, not the server creation order', () => {
    const m = claimsFromResponse(
      body([
        claim({ id: 1, claim_order: 3, created_at: '2026-09-20T00:00:00Z' }),
        claim({ id: 2, claim_order: 1, created_at: '2026-09-21T00:00:00Z' }),
        claim({ id: 3, claim_order: 2, created_at: '2026-09-22T00:00:00Z' }),
      ]),
      { now: NOW }
    );
    expect(m.pending.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  test('a null claim_order goes last, ties break on submission time then id', () => {
    const m = claimsFromResponse(
      body([
        claim({ id: 1, claim_order: null }),
        claim({ id: 2, claim_order: 1, created_at: '2026-09-22T00:00:00Z' }),
        claim({ id: 3, claim_order: 1, created_at: '2026-09-21T00:00:00Z' }),
      ]),
      { now: NOW }
    );
    expect(m.pending.map((c) => c.id)).toEqual([3, 2, 1]);
  });

  test('only pending claims are listed', () => {
    const m = claimsFromResponse(body([claim({ id: 1 }), claim({ id: 2, status: 'won' })]), { now: NOW });
    expect(m.pending.map((c) => c.id)).toEqual([1]);
  });
});

describe('shared drops', () => {
  test('a three-claim shared drop: each claim names the other two, and no one is predicted to win', () => {
    const m = claimsFromResponse(
      body([
        claim({ id: 1, claim_order: 1, drop_player_id: 99 }),
        claim({ id: 2, claim_order: 2, drop_player_id: 99 }),
        claim({ id: 3, claim_order: 3, drop_player_id: 99 }),
        claim({ id: 4, claim_order: 4, drop_player_id: 77 }),
        claim({ id: 5, claim_order: 5, drop_player_id: null }),
      ]),
      { now: NOW }
    );
    const byId = Object.fromEntries(m.pending.map((c) => [c.id, c]));
    expect(byId[1].sharesDropWith).toEqual([2, 3]);
    expect(byId[2].sharesDropWith).toEqual([1, 3]);
    expect(byId[3].sharesDropWith).toEqual([1, 2]);
    expect(byId[4].sharesDropWith).toEqual([]);
    expect(byId[5].sharesDropWith).toEqual([]);
    expect(m.sharedDrops).toEqual([{ dropPlayerId: 99, claimIds: [1, 2, 3] }]);
    expect(byId[1]).not.toHaveProperty('willWin');
  });

  test('resolved claims naming the same drop do not count', () => {
    const m = claimsFromResponse(
      body([claim({ id: 1, drop_player_id: 99 }), claim({ id: 2, drop_player_id: 99, status: 'lost' })]),
      { now: NOW }
    );
    expect(m.pending[0].sharesDropWith).toEqual([]);
    expect(m.sharedDrops).toEqual([]);
  });
});

describe('results', () => {
  test('won carries its bid', () => {
    const m = claimsFromResponse(faabBody([claim({ id: 1, status: 'won', bid: 12, week: 3 })]), { now: NOW });
    expect(m.results[0]).toMatchObject({ id: 1, result: 'won', bid: 12, week: 3 });
  });

  test('lost carries the winning team and Winning bid when present', () => {
    const m = claimsFromResponse(
      faabBody([
        claim({ id: 1, status: 'lost', bid: 5, winning_team_name: 'Sharks', winning_bid: 20, week: 3 }),
      ]),
      { now: NOW }
    );
    expect(m.results[0]).toMatchObject({ result: 'lost', winningTeam: 'Sharks', winningBid: 20 });
  });

  test('lost is null-safe: plain lost when both winner fields are null or absent', () => {
    const m = claimsFromResponse(
      body([
        claim({ id: 1, status: 'lost', winning_team_name: null, winning_bid: null }),
        claim({ id: 2, status: 'lost' }),
      ]),
      { now: NOW }
    );
    for (const r of m.results) {
      expect(r.result).toBe('lost');
      expect(r.winningTeam).toBeNull();
      expect(r.winningBid).toBeNull();
    }
  });

  test('invalid is a "didn\'t go through" with its stored reason', () => {
    const m = claimsFromResponse(body([claim({ id: 1, status: 'invalid', note: 'Roster full' })]), { now: NOW });
    expect(m.results[0]).toMatchObject({ result: 'didnt-go-through', reason: 'Roster full' });
    expect(JSON.stringify(m.results[0])).not.toContain('invalid');
  });

  test('cancelled claims are excluded', () => {
    const m = claimsFromResponse(body([claim({ id: 1, status: 'cancelled' })]), { now: NOW });
    expect(m.results).toEqual([]);
    expect(m.pending).toEqual([]);
  });

  test('results carry the week and group by week, newest week first', () => {
    const m = claimsFromResponse(
      body([
        claim({ id: 1, status: 'won', week: 2 }),
        claim({ id: 2, status: 'lost', week: 3 }),
        claim({ id: 3, status: 'invalid', week: 3 }),
      ]),
      { now: NOW }
    );
    expect(m.resultsByWeek.map((g) => [g.week, g.results.map((r) => r.id)])).toEqual([
      [3, [2, 3]],
      [2, [1]],
    ]);
  });
});

describe('next Clear time', () => {
  test('is the earliest clear time among pending claims', () => {
    const m = claimsFromResponse(
      body([
        claim({ id: 1, clear_at: hours(30) }),
        claim({ id: 2, clear_at: hours(5) }),
        claim({ id: 3, clear_at: null }),
        claim({ id: 4, status: 'won', clear_at: hours(1) }),
      ]),
      { now: NOW }
    );
    expect(m.nextClearTime).toBe(hours(5));
  });

  test('while the blanket clear time is in the future, that time instead', () => {
    const m = claimsFromResponse(
      body([claim({ id: 1, clear_at: hours(5) })], {
        league: { waiver_type: 'priority', waivers_clear_at: hours(48) },
      }),
      { now: NOW }
    );
    expect(m.nextClearTime).toBe(hours(48));
  });

  test('a blanket clear time already past is ignored', () => {
    const m = claimsFromResponse(
      body([claim({ id: 1, clear_at: hours(5) })], {
        league: { waiver_type: 'priority', waivers_clear_at: hours(-2) },
      }),
      { now: NOW }
    );
    expect(m.nextClearTime).toBe(hours(5));
  });

  test('none when there are no pending claims, even with a blanket time running', () => {
    expect(claimsFromResponse(body([]), { now: NOW }).nextClearTime).toBeNull();
    const m = claimsFromResponse(
      body([claim({ id: 1, status: 'won' })], { league: { waiver_type: 'priority', waivers_clear_at: hours(48) } }),
      { now: NOW }
    );
    expect(m.nextClearTime).toBeNull();
  });
});

describe('FAAB', () => {
  test('committed is the sum of pending bids and left is remaining minus it', () => {
    const m = claimsFromResponse(
      faabBody(
        [claim({ id: 1, bid: 10 }), claim({ id: 2, bid: 15 }), claim({ id: 3, status: 'won', bid: 40 })],
        80
      ),
      { now: NOW }
    );
    expect(m.faab).toEqual({ committed: 25, left: 55 });
  });

  test('zero committed when nothing is pending', () => {
    expect(claimsFromResponse(faabBody([], 80), { now: NOW }).faab).toEqual({ committed: 0, left: 80 });
  });

  test('absent in a non-FAAB league', () => {
    const m = claimsFromResponse(body([claim({ id: 1, bid: 10 })]), { now: NOW });
    expect(m.faab).toBeNull();
  });
});

describe('malformed bodies never throw', () => {
  test.each([null, undefined, 'x', {}, { myClaims: null }])('%p', (input) => {
    const m = claimsFromResponse(input, { now: NOW });
    expect(m.pending).toEqual([]);
    expect(m.results).toEqual([]);
    expect(m.nextClearTime).toBeNull();
    expect(m.faab).toBeNull();
  });
});
