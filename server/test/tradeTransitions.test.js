const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select } = require('./helpers/fakePool');
const { TradeError, assertTransition, transitionRefusal } = require('../services/tradeTransitions');

// The Trade transition table (CONTEXT.md, Trade), one row per allowed transition
// and one per refusal. Each row runs the table's own checks with a fake client
// standing in for the League's member and commissioner reads. The veto's clock
// is the trade's review_closed fact, read by the database (see
// tradeReviewClock.pg.test.js for the real clock).

const TEAMS = new Map([
  [41, { id: 41, owner_id: 7 }],
  [42, { id: 42, owner_id: 8 }],
]);

const pending = (over = {}) => ({
  id: 9, status: 'pending', proposing_team_id: 41, receiving_team_id: 42, review_closed: false, ...over,
});

const league = (over = {}) => ({
  id: 1,
  pickem_only: false,
  draft_status: 'complete',
  trade_deadline_week: null,
  current_week: 6,
  trade_veto_votes: 2,
  trade_review_hours: 24,
  transactions_locked: false,
  ...over,
});

// A league read answers the commissioner question; a teams read answers the
// caller's own Team (requireMember). `team` is the Team the caller holds.
function fakeClient({ team = { id: 43, league_id: 1, owner_id: 99 }, commissioner = false } = {}) {
  return createFakePool([
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: commissioner ? [{ '?column?': 1 }] : [] })],
    [select('teams'), () => ({ rows: [team] })],
  ]);
}

function ctxFor(action, over = {}) {
  const { team, commissioner, ...rest } = over;
  return {
    action,
    client: fakeClient({ team, commissioner }),
    userId: 8,
    teams: TEAMS,
    trade: pending(),
    league: league(),
    ...rest,
  };
}

const ROWS = [
  // accept: the receiving owner accepts; a reviewed League opens the window
  { action: 'accept', name: 'a reviewed league opens the review window', to: 'accepted' },
  { action: 'accept', name: 'an unreviewed league executes at once', over: { league: league({ trade_veto_votes: 0 }) }, to: 'executed' },
  { action: 'accept', name: 'a countered trade is refused', over: { trade: pending({ status: 'countered' }) }, refuse: [409, 'trade is countered, not pending'] },
  { action: 'accept', name: 'an accepted trade is refused', over: { trade: pending({ status: 'accepted' }) }, refuse: [409, 'trade is accepted, not pending'] },
  { action: 'accept', name: 'the proposing owner cannot respond', over: { userId: 7 }, refuse: [403, 'only the receiving owner can respond'] },
  { action: 'accept', name: 'a trade before the draft completes is refused', over: { league: league({ draft_status: 'active' }) }, refuse: [409, 'trades open once the draft is complete'] },
  { action: 'accept', name: 'a trade past the deadline week is refused', over: { league: league({ trade_deadline_week: 5 }) }, refuse: [409, 'the trade deadline (week 5) has passed'] },
  { action: 'accept', name: 'a frozen League refuses the acceptance', over: { league: league({ transactions_locked: true }) }, refuse: [409, 'transactions are locked by the commissioner'] },
  { action: 'accept', name: 'a locked receiving team refuses the acceptance', over: { teams: new Map([[41, { id: 41, owner_id: 7 }], [42, { id: 42, owner_id: 8, locked: true }]]) }, refuse: [409, 'your team is locked by the commissioner'] },

  // reject: no deadline gate of its own
  { action: 'reject', name: 'the receiving owner rejects', to: 'rejected' },
  { action: 'reject', name: 'a reject past the deadline week still goes through', over: { league: league({ trade_deadline_week: 5 }) }, to: 'rejected' },
  { action: 'reject', name: 'a countered trade is refused', over: { trade: pending({ status: 'countered' }) }, refuse: [409, 'trade is countered, not pending'] },

  // counter: the original is countered; the replacement is a propose (its own row)
  { action: 'counter', name: 'the receiving owner counters', to: 'countered' },
  { action: 'counter', name: 'the proposing owner cannot counter', over: { userId: 7 }, refuse: [403, 'only the receiving owner can counter'] },

  // cancel: the proposer withdraws a pending offer
  { action: 'cancel', name: 'the proposing owner cancels', over: { userId: 7 }, to: 'cancelled' },
  { action: 'cancel', name: 'the receiving owner cannot cancel', refuse: [403, 'only the proposer can cancel'] },
  { action: 'cancel', name: 'a non-pending trade cannot be cancelled', over: { userId: 7, trade: pending({ status: 'accepted' }) }, refuse: [409, 'trade is accepted, not pending'] },

  // veto: a non-involved member votes inside the review window
  { action: 'veto', name: 'a non-involved member votes inside the window', over: { trade: pending({ status: 'accepted' }) }, to: 'accepted' },
  { action: 'veto', name: 'a veto of a pending trade is refused', refuse: [409, 'trade is not in league review'] },
  { action: 'veto', name: 'a veto with vetoes disabled is refused', over: { trade: pending({ status: 'accepted' }), league: league({ trade_veto_votes: 0 }) }, refuse: [409, 'vetoes are disabled in this league'] },
  { action: 'veto', name: 'a vote after the review window is refused', over: { trade: pending({ status: 'accepted', review_closed: true }) }, refuse: [409, 'the review window has closed'] },
  { action: 'veto', name: 'a team in the trade cannot vote on it', over: { trade: pending({ status: 'accepted' }), team: { id: 41, league_id: 1, owner_id: 7 }, userId: 7 }, refuse: [403, 'teams in the trade cannot vote on it'] },

  // approve and deny: the commissioner decides a pending or accepted trade
  { action: 'approve', name: 'the commissioner approves a pending trade', over: { commissioner: true, userId: 99 }, to: 'executed' },
  { action: 'approve', name: 'the commissioner approves an accepted trade', over: { commissioner: true, userId: 99, trade: pending({ status: 'accepted' }) }, to: 'executed' },
  { action: 'approve', name: 'a non-commissioner cannot approve', over: { userId: 99 }, refuse: [403, 'only the commissioner can do this'] },
  { action: 'approve', name: 'a commissioner cannot decide a trade their own team is in', over: { commissioner: true, userId: 7 }, refuse: [403, "a commissioner can't decide a trade their own team is in"] },
  { action: 'approve', name: 'an executed trade cannot be approved', over: { commissioner: true, userId: 99, trade: pending({ status: 'executed' }) }, refuse: [409, 'trade is executed'] },
  { action: 'deny', name: 'the commissioner denies a pending trade', over: { commissioner: true, userId: 99 }, to: 'vetoed' },

  // execute: an accepted trade whose window has closed is due
  { action: 'execute', name: 'an accepted trade is due', over: { trade: pending({ status: 'accepted', review_closed: true }) }, to: 'executed' },
  { action: 'execute', name: 'a pending trade is never due', refuse: [409, 'trade is pending'] },
  { action: 'execute', name: 'an accepted trade whose window is still open is not yet due', over: { trade: pending({ status: 'accepted', review_closed: false }) }, refuse: [409, 'the review window is still open'] },
  // A freeze or a Team lock holds a due trade for its own run; the fit check never cancels it.
  { action: 'execute', name: 'a frozen League holds a due trade', over: { trade: pending({ status: 'accepted', review_closed: true }), league: league({ transactions_locked: true }) }, refuse: [409, 'transactions are locked by the commissioner'] },
  { action: 'execute', name: 'a locked team holds a due trade', over: { trade: pending({ status: 'accepted', review_closed: true }), teams: new Map([[41, { id: 41, owner_id: 7, locked: true }], [42, { id: 42, owner_id: 8 }]]) }, refuse: [409, 'a team in this trade is locked by the commissioner'] },

  // propose: a new offer, with the freeze and deadline gates and the member's own checks
  { action: 'propose', name: 'a member proposes to another team', over: { trade: null, userId: 7, receivingTeamId: 42, team: { id: 41, league_id: 1, owner_id: 7 } }, to: 'pending' },
  { action: 'propose', name: 'a frozen League refuses a proposal', over: { trade: null, userId: 7, receivingTeamId: 42, team: { id: 41, league_id: 1, owner_id: 7 }, league: league({ transactions_locked: true }) }, refuse: [409, 'transactions are locked by the commissioner'] },
  { action: 'propose', name: 'a locked team cannot propose', over: { trade: null, userId: 7, receivingTeamId: 42, team: { id: 41, league_id: 1, owner_id: 7, locked: true } }, refuse: [409, 'your team is locked by the commissioner'] },
  { action: 'propose', name: 'a team cannot trade with itself', over: { trade: null, userId: 7, receivingTeamId: 41, team: { id: 41, league_id: 1, owner_id: 7 } }, refuse: [400, 'cannot trade with yourself'] },
  { action: 'propose', name: 'a proposal past the deadline week is refused', over: { trade: null, userId: 7, receivingTeamId: 42, team: { id: 41, league_id: 1, owner_id: 7 }, league: league({ trade_deadline_week: 5 }) }, refuse: [409, 'the trade deadline (week 5) has passed'] },
];

for (const row of ROWS) {
  test(`${row.action}: ${row.name}`, async () => {
    const ctx = ctxFor(row.action, row.over ?? {});
    if (row.refuse) {
      const [statusCode, message] = row.refuse;
      const refusal = await transitionRefusal(row.action, ctx);
      assert.ok(refusal instanceof TradeError, `expected a refusal, got ${refusal}`);
      assert.equal(refusal.statusCode, statusCode);
      assert.equal(refusal.message, message);
      await assert.rejects(assertTransition(row.action, ctx), { statusCode, message });
    } else {
      assert.equal(await transitionRefusal(row.action, ctx), null);
      assert.equal(await assertTransition(row.action, ctx), row.to);
    }
  });
}
