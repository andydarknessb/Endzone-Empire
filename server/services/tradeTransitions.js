const { assertFantasyLeagueRow } = require('./leagueType');
const { isLeagueFrozen } = require('./rosterGate.service');
const { requireMember } = require('./leagueMembership.service');
const { isLeagueCommissioner } = require('./leagueRole.service');

/**
 * The Trade transition table: every Trade action checks its transition here,
 * inside its League write: the statuses it may leave, the actors allowed, the
 * gates that apply and the status it lands in. A refusal keeps today's status
 * code and message.
 *
 * The review window is the database's clock. loadTrade reads `review_closed`
 * (review_ends_at <= clock_timestamp()) after the League lock is granted, so a
 * veto that queued behind the lock judges the window as it stands when it writes.
 * processDueTrades selects by review_ends_at <= now(). Nothing here reads the
 * app's clock.
 *
 * A TradeError thrown by executeTrade cancels a due trade. The execute transition's
 * refusals (not yet due, a freeze, a Team lock) are returned and skipped, so the
 * trade waits. A DraftError (the roster gate's) is transient. Keep the two apart.
 */
class TradeError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Trades open only once the League's draft is complete (#2550). */
function assertDraftComplete(league) {
  if (league.draft_status !== 'complete') {
    throw new TradeError(409, 'trades open once the draft is complete');
  }
}

/**
 * The trade-window gate every offer and answer runs through: no trades at all
 * in a pick'em-only league, none until the draft is complete, and none past
 * the deadline.
 */
function assertBeforeDeadline(league) {
  assertFantasyLeagueRow(league);
  assertDraftComplete(league);
  if (league.trade_deadline_week != null && league.current_week > league.trade_deadline_week) {
    throw new TradeError(409, `the trade deadline (week ${league.trade_deadline_week}) has passed`);
  }
}

const reviewed = (league) => league.trade_veto_votes > 0 && league.trade_review_hours > 0;
const pendingRefusal = (status) => `trade is ${status}, not pending`;
const statusRefusal = (status) => `trade is ${status}`;

/*
 * Who may act on a trade (#188, recorded beside each check rather than in the caller).
 *
 * Every owner check here is a CALLER comparison and never a role one: `owner_id`
 * is a `teams` row's, so it asks "is this team the signed-in manager's own", and
 * the refusal beside each one states the rule it enforces. Only the two managers
 * in a trade may move it: the receiving manager responds and counters, the
 * proposing manager cancels.
 *
 * Being a commissioner grants nothing here. The one commissioner-shaped power over
 * a trade is approve/deny, which authorizes through the commissioner check, so a
 * co-commissioner holds it. A commissioner has no standing to accept a trade on a
 * manager's behalf, and nothing here should acquire one by comparing against
 * `leagues.owner_id`.
 */
// Each check throws a TradeError, or does nothing. ctx carries the trade, the
// League, the teams, the caller and a client for the member and commissioner reads.
const CHECKS = {
  status: (ctx, row) => {
    if (!row.from.includes(ctx.trade.status)) throw new TradeError(409, row.refusal(ctx.trade.status));
  },
  receiving: ({ trade, teams, userId }, row) => {
    const receiving = teams.get(trade.receiving_team_id);
    if (receiving.owner_id !== userId) throw new TradeError(403, row.actorRefusal);
  },
  proposing: ({ trade, teams, userId }, row) => {
    if (teams.get(trade.proposing_team_id).owner_id !== userId) throw new TradeError(403, row.actorRefusal);
  },
  frozen: ({ league }) => {
    if (isLeagueFrozen(league)) throw new TradeError(409, 'transactions are locked by the commissioner');
  },
  deadline: ({ league }) => assertBeforeDeadline(league),
  receivingLocked: ({ trade, teams }) => {
    if (teams.get(trade.receiving_team_id).locked) throw new TradeError(409, 'your team is locked by the commissioner');
  },
  // A lock on either Team holds a trade; its refusal must not read as a cancel.
  lockedParties: ({ trade, teams }) => {
    if ([trade.proposing_team_id, trade.receiving_team_id].some((id) => teams.get(id)?.locked)) {
      throw new TradeError(409, 'a team in this trade is locked by the commissioner');
    }
  },
  member: async (ctx) => {
    const myTeam = await requireMember(ctx.client, { leagueId: ctx.league.id, userId: ctx.userId });
    if (myTeam.locked) throw new TradeError(409, 'your team is locked by the commissioner');
    if (myTeam.id === ctx.receivingTeamId) throw new TradeError(400, 'cannot trade with yourself');
    ctx.myTeam = myTeam;
  },
  commissioner: async (ctx) => {
    if (!(await isLeagueCommissioner(ctx.client, ctx.league.id, ctx.userId))) {
      throw new TradeError(403, 'only the commissioner can do this');
    }
  },
  // The commissioner never decides a trade their own team is in.
  ownTeam: ({ trade, teams, userId }) => {
    if ([trade.proposing_team_id, trade.receiving_team_id].some((id) => teams.get(id)?.owner_id === userId)) {
      throw new TradeError(403, "a commissioner can't decide a trade their own team is in");
    }
  },
  vetoesEnabled: ({ league }) => {
    if (league.trade_veto_votes < 1) throw new TradeError(409, 'vetoes are disabled in this league');
  },
  voter: async (ctx) => {
    const voter = await requireMember(ctx.client, { leagueId: ctx.league.id, userId: ctx.userId });
    const { trade } = ctx;
    if (voter.id === trade.proposing_team_id || voter.id === trade.receiving_team_id) {
      throw new TradeError(403, 'teams in the trade cannot vote on it');
    }
    ctx.voter = voter;
  },
  reviewWindowOpen: ({ trade }) => {
    if (trade.review_closed) throw new TradeError(409, 'the review window has closed');
  },
  reviewWindowClosed: ({ trade }) => {
    if (!trade.review_closed) throw new TradeError(409, 'the review window is still open');
  },
};

// `from` is the statuses the action may leave; propose has none (it creates the
// row). `to` is the status it lands in. A check order here is the order the
// refusals are tested in.
const TRANSITIONS = {
  propose: { from: [], to: () => 'pending', checks: ['frozen', 'deadline', 'member'] },
  accept: {
    from: ['pending'],
    to: ({ league }) => (reviewed(league) ? 'accepted' : 'executed'),
    checks: ['status', 'receiving', 'deadline', 'frozen', 'receivingLocked'],
    actorRefusal: 'only the receiving owner can respond',
    refusal: pendingRefusal,
  },
  reject: {
    from: ['pending'],
    to: () => 'rejected',
    checks: ['status', 'receiving'],
    actorRefusal: 'only the receiving owner can respond',
    refusal: pendingRefusal,
  },
  counter: {
    from: ['pending'],
    to: () => 'countered',
    checks: ['status', 'receiving'],
    actorRefusal: 'only the receiving owner can counter',
    refusal: pendingRefusal,
  },
  cancel: {
    from: ['pending'],
    to: () => 'cancelled',
    checks: ['status', 'proposing'],
    actorRefusal: 'only the proposer can cancel',
    refusal: pendingRefusal,
  },
  // `to` is 'vetoed' once the votes reach the threshold; the write passes its count.
  veto: {
    from: ['accepted'],
    to: ({ votes, league }) => (votes >= league.trade_veto_votes ? 'vetoed' : 'accepted'),
    checks: ['status', 'vetoesEnabled', 'voter', 'reviewWindowOpen'],
    refusal: () => 'trade is not in league review',
  },
  approve: {
    from: ['pending', 'accepted'],
    to: () => 'executed',
    checks: ['commissioner', 'ownTeam', 'status'],
    refusal: statusRefusal,
  },
  deny: {
    from: ['pending', 'accepted'],
    to: () => 'vetoed',
    checks: ['commissioner', 'ownTeam', 'status'],
    refusal: statusRefusal,
  },
  // A due trade: accepted, its window closed. The due run skips a refusal rather than
  // cancelling, so a freeze or a Team lock holds it before the fit check can cancel it.
  execute: {
    from: ['accepted'],
    to: () => 'executed',
    checks: ['status', 'reviewWindowClosed', 'frozen', 'lockedParties'],
    refusal: statusRefusal,
  },
};

/** The TradeError the action's checks raise, or null if it is allowed. */
async function transitionRefusal(action, ctx) {
  const row = TRANSITIONS[action];
  try {
    for (const name of row.checks) await CHECKS[name](ctx, row);
    return null;
  } catch (err) {
    if (err instanceof TradeError) return err;
    throw err;
  }
}

/** Throws the action's refusal; otherwise returns the status it lands in. */
async function assertTransition(action, ctx) {
  const refusal = await transitionRefusal(action, ctx);
  if (refusal) throw refusal;
  return TRANSITIONS[action].to(ctx);
}

module.exports = {
  TradeError,
  TRANSITIONS,
  assertTransition,
  transitionRefusal,
  assertDraftComplete,
};
