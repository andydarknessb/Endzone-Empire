const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { leagueWrite, lockLeague } = require('../modules/leagueWrite');
const { logTransaction, notify, notifyLeague } = require('./activity.service');
const { TradeError, TRANSITIONS, assertTransition, transitionRefusal, assertDraftComplete } = require('./tradeTransitions');
// The write-time roster gate (#940). Its error type is DraftError, which does
// NOT extend TradeError - and that is load-bearing here, not incidental:
// processDueTrades permanently CANCELS a trade when it catches a TradeError, so
// a freeze refusal shaped like one would destroy every accepted trade whose
// review window ended during a freeze. As a DraftError it falls to the "log and
// retry next tick" branch, and the trade stays accepted.
const { assertRosterWriteAllowed, ROSTER_GATE } = require('./rosterGate.service');
const { rosterFit } = require('./rosterFit.service');
// The one writer of a single-player Roster move (#2535).
const rosterMove = require('./rosterMove.service');
const { getWeekOpponents } = require('./nflWeekOpponents');
const { normalizeNflTeam } = require('./nflTeam');

/**
 * Who may act on a trade (#188, recorded here rather than beside each check).
 *
 * Every owner check in the Trade transition table (tradeTransitions.js) is a
 * CALLER comparison and never a role one: `owner_id` here is a `teams` row's,
 * so it asks "is this team the signed-in manager's own", and the refusal beside
 * each one states the rule it enforces. Only the two managers in a trade may move it, and which of
 * them may do what is the whole of the rule: the receiving manager responds
 * and counters, the proposing manager cancels.
 *
 * Being a commissioner grants nothing here. The one commissioner-shaped power
 * over a trade is commissionerDecide's force-approve/veto, which authorizes
 * through the transition table's commissioner check (tradeTransitions.js), so
 * a co-commissioner holds it. A commissioner has no standing to accept a trade
 * on a manager's behalf, and nothing in here should acquire one by comparing
 * against `leagues.owner_id`.
 */
/** Load a trade with its league, both teams, and items; lock the trade row. */
async function loadTrade(client, tradeId, { forUpdate = true } = {}) {
  // Lock the League row BEFORE the trades row (#946). executeTrade's roster
  // capacity check reads team_players counts and must serialize on the League
  // row, the same row every capacity-increasing roster write locks first
  // (forceTransaction via requireCommissioner, the #944 write gate, and the
  // free-agent/waiver/pick adds). Two trades on DIFFERENT trades rows that each
  // send a player to the SAME team otherwise lock two uncontended trades rows,
  // both read the same sub-capacity count, and both commit the team over its
  // limit -- the race this ticket fixes.
  //
  // League-BEFORE-trades is the lock ORDER, not just the addition of a lock:
  // rolloverSeason locks the League row (the League write's lock) and
  // then row-locks this league's trades (`UPDATE "trades" ... WHERE
  // "league_id" = $1 ...`), i.e. League -> trades. Locking the trades row first
  // here would invert that into an AB/BA deadlock pair, so the League row is
  // locked first -- via the trade's immutable league_id, read through an
  // unlocked MVCC subquery that never blocks on a held trades-row lock -- and
  // the trades row second. forceTransaction and the gate are League-first too,
  // so this introduces no lock-order inversion on any path.
  // The trade's League is read unlocked (its league_id never changes), then locked
  // through the League write module (ADR 0070) before the trades row is touched.
  const leagueIdResult = await client.query(`SELECT "league_id" FROM "trades" WHERE "id" = $1`, [tradeId]);
  const leagueId = leagueIdResult.rows[0] ? leagueIdResult.rows[0].league_id : null;
  const league = leagueId == null ? null : await lockLeague(client, leagueId);
  // review_closed is the database's clock (review_ends_at <= now()), the predicate
  // processDueTrades selects by, read once in this transaction.
  const tradeResult = await client.query(
    `SELECT *, ("review_ends_at" <= now()) AS "review_closed" FROM "trades" WHERE "id" = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [tradeId]
  );
  const trade = tradeResult.rows[0];
  if (!trade) throw new TradeError(404, 'trade not found');
  const itemsResult = await client.query(`SELECT * FROM "trade_items" WHERE "trade_id" = $1`, [tradeId]);
  const teamsResult = await client.query(
    `SELECT * FROM "teams" WHERE "id" IN ($1, $2)`,
    [trade.proposing_team_id, trade.receiving_team_id]
  );
  const teams = new Map(teamsResult.rows.map((t) => [t.id, t]));
  return { trade, league, items: itemsResult.rows, teams };
}

function validatePlayerIds(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new TradeError(400, 'playerIds must be a non-empty array');
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new TradeError(400, 'duplicate players in trade');
  }
}

/**
 * The whole propose offer, performed on an ALREADY-OPEN transaction on the
 * given `client` (ADR 0033: work that needs the caller's transaction takes the
 * client). It BEGINs, COMMITs and ROLLBACKs nothing and never touches the
 * ambient pool - the wrapper (proposeTrade) or the counter (counterTrade) owns
 * the transaction and the post-commit push. Returns { trade, otherTeamOwnerId,
 * myTeamName }; the trade row is what proposeTrade/counterTrade resolve to.
 *
 * counterTrade calls this on the SAME client that already marked the original
 * 'countered', so the countered update and this new offer commit or roll back
 * together (#1077). It takes the League row its caller holds (the League write,
 * ADR 0070), so the freeze, draft-complete and deadline gates read the locked row
 * on the propose path and the counter's path alike. Do not re-read it unlocked here.
 */
async function proposeTradeWith(client, { league, userId, receivingTeamId, playerIds, counterOf = null }) {
  if (!league) throw new TradeError(404, 'league not found');
  const leagueId = league.id;
  // The propose transition (tradeTransitions.js): the freeze and the deadline as
  // entry gates, then the member's own checks. Execution still runs the write-time
  // gate (executeTrade).
  const ctx = { client, league, userId, receivingTeamId, trade: null };
  await assertTransition('propose', ctx);
  const { myTeam } = ctx;

  const otherResult = await client.query(
    `SELECT * FROM "teams" WHERE "id" = $1 AND "league_id" = $2`,
    [receivingTeamId, leagueId]
  );
  if (!otherResult.rows[0]) throw new TradeError(404, 'receiving team not found in this league');
  const otherTeam = otherResult.rows[0];
  // A CPU-managed team (its manager was banned) has nobody to answer an offer.
  if (otherTeam.owner_id == null) {
    throw new TradeError(409, "that team is managed by the CPU and doesn't trade");
  }

  const rosterResult = await client.query(
    `SELECT "player_id", "team_id" FROM "team_players"
     WHERE "team_id" IN ($1, $2)`,
    [myTeam.id, otherTeam.id]
  );
  const ownership = new Map(rosterResult.rows.map((r) => [r.player_id, r.team_id]));

  const tradeResult = await client.query(
    `INSERT INTO "trades" ("league_id", "proposing_team_id", "receiving_team_id", "counter_of")
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [leagueId, myTeam.id, otherTeam.id, counterOf]
  );
  const trade = tradeResult.rows[0];

  let sendsSomething = false;
  let getsSomething = false;
  for (const playerId of playerIds) {
    const fromTeamId = ownership.get(playerId);
    if (!fromTeamId) {
      throw new TradeError(400, `player ${playerId} is not on either team's roster`);
    }
    const toTeamId = fromTeamId === myTeam.id ? otherTeam.id : myTeam.id;
    if (fromTeamId === myTeam.id) sendsSomething = true;
    else getsSomething = true;
    await client.query(
      `INSERT INTO "trade_items" ("trade_id", "player_id", "from_team_id", "to_team_id")
       VALUES ($1, $2, $3, $4)`,
      [trade.id, playerId, fromTeamId, toTeamId]
    );
  }
  if (!sendsSomething || !getsSomething) {
    throw new TradeError(400, 'a trade must move at least one player in each direction');
  }

  await notify(client, {
    userId: otherTeam.owner_id,
    leagueId,
    type: 'trade_offer',
    message: `${myTeam.name} sent you a trade offer`,
    data: { tradeId: trade.id },
  });
  return { trade, otherTeamOwnerId: otherTeam.owner_id, myTeamName: myTeam.name };
}

/**
 * The pref-gated "new trade offer" web push, sent AFTER the transaction commits
 * so the connection is already back in the pool (Ruling 3). Shared by
 * proposeTrade and counterTrade so the copy is not duplicated. Best-effort: a
 * failure here never fails the trade that already committed.
 */
async function sendTradeOfferPush({ otherTeamOwnerId, myTeamName, leagueId }) {
  try {
    await require('./pushAlerts.service').sendAlert({ kind: 'trade-offer', otherTeamOwnerId, myTeamName, leagueId });
  } catch (err) {
    console.error('trade offer push failed:', err.message);
  }
}

/**
 * Propose a multi-player trade. playerIds may belong to either team; each
 * item's direction is derived from current ownership. Validated: both teams
 * in the league, every player on one of the two rosters, deadline not passed.
 * A thin wrapper: one transaction around proposeTradeWith, then the push.
 */
async function proposeTrade({ leagueId, userId, receivingTeamId, playerIds, counterOf = null }) {
  validatePlayerIds(playerIds);
  const { trade, otherTeamOwnerId, myTeamName } = await leagueWrite(
    { leagueId, label: 'proposeTrade' },
    ({ client, league }) => proposeTradeWith(client, { league, userId, receivingTeamId, playerIds, counterOf })
  );
  await sendTradeOfferPush({ otherTeamOwnerId, myTeamName, leagueId });
  return trade;
}

/**
 * Receiving owner accepts or rejects. Accepting either opens the league
 * review window (when vetoes are enabled) or executes immediately.
 */
async function respondToTrade({ tradeId, userId, action }) {
  if (!['accept', 'reject'].includes(action)) throw new TradeError(400, 'action must be accept or reject');
  const result = await withTransaction(
    pool,
    async (client) => {
      const { trade, league, items, teams } = await loadTrade(client, tradeId);
      const to = await assertTransition(action, { client, trade, league, items, teams, userId });
      const receiving = teams.get(trade.receiving_team_id);
      const proposing = teams.get(trade.proposing_team_id);

      if (to === 'rejected') {
        await client.query(
          `UPDATE "trades" SET "status" = 'rejected', "updated_at" = now() WHERE "id" = $1`,
          [tradeId]
        );
        await notify(client, {
          userId: proposing.owner_id,
          leagueId: league.id,
          type: 'trade_result',
          message: `${receiving.name} rejected your trade offer`,
          data: { tradeId },
        });
        return { tradeId, status: 'rejected' };
      }

      if (to === 'accepted') {
        await client.query(
          `UPDATE "trades" SET "status" = 'accepted', "updated_at" = now(),
           "review_ends_at" = now() + make_interval(hours => $2)
           WHERE "id" = $1`,
          [tradeId, league.trade_review_hours]
        );
        await notifyLeague(client, {
          leagueId: league.id,
          type: 'trade_review',
          message: `Trade accepted between ${proposing.name} and ${receiving.name}. League review is open`,
          data: { tradeId },
          excludeUserIds: [proposing.owner_id, receiving.owner_id],
        });
        await notify(client, {
          userId: proposing.owner_id,
          leagueId: league.id,
          type: 'trade_result',
          message: `${receiving.name} accepted your trade; it executes after league review`,
          data: { tradeId },
        });
        return { tradeId, status: 'accepted' };
      }

      await executeTrade(client, { trade, league, items, teams });
      return { tradeId, status: 'executed', leagueId: league.id };
    },
    { label: 'respondToTrade' }
  );
  return { tradeId: result.tradeId, status: result.status };
}

/** Proposer cancels their own pending offer. */
async function cancelTrade({ tradeId, userId }) {
  return withTransaction(
    pool,
    async (client) => {
      const { trade, league, teams } = await loadTrade(client, tradeId);
      await assertTransition('cancel', { client, trade, league, teams, userId });
      await client.query(
        `UPDATE "trades" SET "status" = 'cancelled', "updated_at" = now() WHERE "id" = $1`,
        [tradeId]
      );
      return { tradeId, status: 'cancelled' };
    },
    { label: 'cancelTrade' }
  );
}

/** Receiving owner counters: original becomes 'countered', a mirrored new offer is created. */
async function counterTrade({ tradeId, userId, playerIds }) {
  validatePlayerIds(playerIds);
  // ONE transaction (#1077): the original's 'countered' update and the whole
  // replacement offer commit or roll back together. The replacement runs
  // through proposeTradeWith on the SAME client, so a replacement refused for
  // any reason (validation, deadline, freeze, lock, driver error) throws that
  // same error and the countered update rolls back with it, leaving the
  // original 'pending' with no new rows. Marking it 'countered' in its own
  // committed transaction and then proposing in a second one - the shape this
  // fixes - stranded the original whenever the replacement failed.
  const { trade, otherTeamOwnerId, myTeamName } = await withTransaction(
    pool,
    async (client) => {
      const { trade, teams, league } = await loadTrade(client, tradeId);
      await assertTransition('counter', { client, trade, league, teams, userId });
      await client.query(
        `UPDATE "trades" SET "status" = 'countered', "updated_at" = now() WHERE "id" = $1`,
        [tradeId]
      );
      // proposeTradeWith takes the League row loadTrade already locked, so the
      // counter's gates read the held row. Lock order is unchanged: League before trades.
      return proposeTradeWith(client, {
        league,
        userId,
        receivingTeamId: trade.proposing_team_id,
        playerIds,
        counterOf: tradeId,
      });
    },
    { label: 'counterTrade' }
  );
  // The new offer's push, after the single transaction commits (Ruling 3),
  // through the same helper proposeTrade uses so the copy is not duplicated.
  await sendTradeOfferPush({ otherTeamOwnerId, myTeamName, leagueId: trade.league_id });
  return trade;
}

/** A non-involved team owner votes to veto a trade in review. */
async function vetoTrade({ tradeId, userId }) {
  return withTransaction(
    pool,
    async (client) => {
      const { trade, league, teams } = await loadTrade(client, tradeId);
      // The window, not the trade's status, ends the review (#2544): the trade
      // stays 'accepted' until processDueTrades executes it, which a frozen
      // League can delay for days. review_closed is the database's clock.
      const ctx = { client, trade, league, teams, userId };
      await assertTransition('veto', ctx);
      await client.query(
        `INSERT INTO "trade_votes" ("trade_id", "team_id") VALUES ($1, $2)
         ON CONFLICT ("trade_id", "team_id") DO NOTHING`,
        [tradeId, ctx.voter.id]
      );
      const votes = await client.query(
        `SELECT COUNT(*)::int AS n FROM "trade_votes" WHERE "trade_id" = $1`,
        [tradeId]
      );
      const status = TRANSITIONS.veto.to({ votes: votes.rows[0].n, league });
      if (status === 'vetoed') {
        await client.query(
          `UPDATE "trades" SET "status" = 'vetoed', "updated_at" = now() WHERE "id" = $1`,
          [tradeId]
        );
        for (const teamId of [trade.proposing_team_id, trade.receiving_team_id]) {
          await notify(client, {
            userId: teams.get(teamId).owner_id,
            leagueId: league.id,
            type: 'trade_result',
            message: 'Your trade was vetoed by league vote',
            data: { tradeId },
          });
        }
      }
      return { tradeId, votes: votes.rows[0].n, votesNeeded: league.trade_veto_votes, status };
    },
    { label: 'vetoTrade' }
  );
}

/** Commissioner (owner or co-commissioner) force-approves or vetoes a pending/accepted trade. */
async function commissionerDecide({ tradeId, userId, approve }) {
  const result = await withTransaction(
    pool,
    async (client) => {
      const { trade, league, items, teams } = await loadTrade(client, tradeId);
      const to = await assertTransition(approve ? 'approve' : 'deny', { client, trade, league, items, teams, userId });
      if (to === 'executed') {
        await executeTrade(client, { trade, league, items, teams, byCommissioner: true });
        return { tradeId, status: 'executed', leagueId: league.id };
      }
      await client.query(
        `UPDATE "trades" SET "status" = 'vetoed', "updated_at" = now() WHERE "id" = $1`,
        [tradeId]
      );
      for (const teamId of [trade.proposing_team_id, trade.receiving_team_id]) {
        await notify(client, {
          userId: teams.get(teamId).owner_id,
          leagueId: league.id,
          type: 'trade_result',
          message: 'Your trade was vetoed by the commissioner',
          data: { tradeId },
        });
      }
      return { tradeId, status: 'vetoed' };
    },
    { label: 'commissionerDecide' }
  );
  return { tradeId: result.tradeId, status: result.status };
}

/**
 * Swap the rosters atomically inside the caller's transaction. Re-validates
 * that every player is still on the expected roster and that both teams stay
 * within the roster limit after the swap.
 *
 * The write gate runs ONCE PER PLAYER, before that player's own write (#963),
 * never once up front. The release gate and then the acquire gate precede each
 * DELETE and INSERT, so both teams in a
 * trade answer for the freeze and for their own Team lock - and the Team lock
 * is new here, since this path checked neither manager's before.
 *
 * Capacity and the position cap are NET questions over the whole swap, not
 * per-item ones (#2274): a team at capacity that sends one player and receives
 * one is legal, though its incoming insert runs while the count is still full.
 * Each receiving Team's fit is asked once, before any write, with its incoming
 * players as adds and its outgoing players as drops (rosterFit). Each leg's
 * acquire then has nothing left to fit and passes an empty move set.
 */
async function executeTrade(client, { trade, league, items, teams, byCommissioner = false }) {
  // Execution refuses on its own (#2550), never trusting the offer/answer that
  // preceded it: a trade whose review window ends mid-draft is a due trade
  // here, and executeTrade is the write that would fill a half-built roster.
  assertDraftComplete(league);
  const delta = new Map([[trade.proposing_team_id, 0], [trade.receiving_team_id, 0]]);
  for (const item of items) {
    const owned = await client.query(
      `SELECT 1 FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
      [item.from_team_id, item.player_id]
    );
    if (!owned.rows[0]) {
      throw new TradeError(409, 'a player in this trade is no longer on the expected roster');
    }
    delta.set(item.from_team_id, delta.get(item.from_team_id) - 1);
    delta.set(item.to_team_id, delta.get(item.to_team_id) + 1);
  }
  // The traded players' names (for the transaction detail) and positions (for the fit), in one read.
  const tradedPlayersResult = await client.query(
    `SELECT "id", "name", "position" FROM "players" WHERE "id" = ANY($1::int[])`,
    [items.map((i) => i.player_id)]
  );
  const knownPositions = new Map(tradedPlayersResult.rows.map((p) => [p.id, p.position]));
  // A TradeError, so a due trade that can never fit is cancelled. Each receiving
  // Team's fit is one net question over the whole swap, asked before any write.
  for (const teamId of delta.keys()) {
    const refusal = await rosterFit(client, {
      league,
      teamId,
      adds: items.filter((item) => item.to_team_id === teamId).map((item) => item.player_id),
      drops: items.filter((item) => item.from_team_id === teamId).map((item) => item.player_id),
      knownPositions,
    });
    // ponytail: matches rosterFit's capacity wording (rosterFit.service.js:100); a moved string fails the trade tests, upgrade to a structured refusal if rosterFit gains more reasons.
    const capacity = /^roster capacity of (\d+) reached$/.exec(refusal ?? '');
    if (capacity) throw new TradeError(409, `trade would put ${teams.get(teamId).name} over its roster capacity of ${capacity[1]}`);
    if (refusal) throw new TradeError(409, refusal);
  }
  for (const item of items) {
    // Delete-and-insert rather than UPDATE ... SET team_id (#197). Moving the
    // row keeps the GIVING team's created_at, so "when this team acquired
    // him" is wrong on every traded player, for as long as he stays. A fresh
    // row dates the acquisition it actually records, which is what a
    // post-kickoff exclusion has to read. The delete comes first: the unique
    // constraint on (league_id, player_id) would refuse the insert otherwise.
    //
    // The receiving side's acquire gate, before this player's own delete and
    // insert: the freeze, the receiving Team's lock and the waiver hold. It runs
    // BEFORE the give-side delete because the waiver hold reads an unrostered
    // player as on waivers while the post-draft blanket window is open
    // (isOnWaivers), and once the delete has run every traded player looks
    // unrostered, so every trade in that window was refused (#2274). KICKOFF_HOLD
    // is bypassed because a trade moves an already-rostered player, never a Free
    // agent (ADR 0043; lead ruling on issue #1376). The existing waiver-row check
    // (WAIVER_HOLD) is untouched and still runs.
    //
    // This is the one acquire gate the roster move module does not own (#2535):
    // it has to run while the player is still the giving team's. The module's
    // own acquire gate bypasses WAIVER_HOLD for that reason - the check above is
    // the one that made it - and nothing else it asks changes between the two.
    // The swap's fit was settled above, before any write, so a leg has no move left
    // to fit: an empty move set. A team may sit transiently over capacity between
    // legs (#2274); the net answer on the final roster is what the trade enforces.
    const settled = { adds: [], drops: [] };
    await assertRosterWriteAllowed(client, {
      leagueId: league.id,
      teamId: item.to_team_id,
      direction: 'acquire',
      playerId: item.player_id,
      bypass: [ROSTER_GATE.KICKOFF_HOLD],
      moves: settled,
    });
    // The giving side's release and lineup step, then the receiving side's
    // roster row and bench (#2535). Not undoable, so no stash is recorded.
    // Nothing is bypassed on the release: capacity, the position cap and the
    // waiver hold are acquire-only.
    await rosterMove.drop(client, {
      league, teamId: item.from_team_id, playerId: item.player_id, undoable: false,
    });
    await rosterMove.add(client, {
      league,
      teamId: item.to_team_id,
      playerId: item.player_id,
      bypass: [ROSTER_GATE.KICKOFF_HOLD, ROSTER_GATE.WAIVER_HOLD],
      moves: settled,
    });
  }
  await client.query(
    `UPDATE "trades" SET "status" = 'executed', "updated_at" = now() WHERE "id" = $1`,
    [trade.id]
  );
  // Names are baked into the transaction detail at execution time so the
  // league activity feed can render "traded X to Y for Z" without the
  // transactions route having to re-join trade_items/players/teams later.
  // Read once, above the loop, together with the positions the gate needs.
  const playerNameById = new Map(tradedPlayersResult.rows.map((p) => [p.id, p.name]));
  await logTransaction(client, {
    leagueId: league.id,
    teamId: trade.proposing_team_id,
    type: 'trade',
    detail: {
      tradeId: trade.id,
      byCommissioner,
      proposingTeamId: trade.proposing_team_id,
      receivingTeamId: trade.receiving_team_id,
      proposingTeamName: teams.get(trade.proposing_team_id).name,
      receivingTeamName: teams.get(trade.receiving_team_id).name,
      items: items.map((i) => ({
        playerId: i.player_id,
        playerName: playerNameById.get(i.player_id),
        fromTeamId: i.from_team_id,
        toTeamId: i.to_team_id,
      })),
    },
  });
  for (const teamId of [trade.proposing_team_id, trade.receiving_team_id]) {
    await notify(client, {
      userId: teams.get(teamId).owner_id,
      leagueId: league.id,
      type: 'trade_result',
      message: 'Your trade has been executed',
      data: { tradeId: trade.id },
    });
  }
}

/** Scheduler entry point: execute accepted trades whose review window ended. */
async function processDueTrades() {
  const due = await pool.query(
    `SELECT "id" FROM "trades" WHERE "status" = 'accepted' AND "review_ends_at" <= now()`
  );
  const outcomes = [];
  for (const row of due.rows) {
    // withTransaction owns connect/BEGIN/COMMIT-or-guarded-ROLLBACK and the release
    // rule (ADR 0033); the outcome list is built from what it returns.
    let result;
    try {
      result = await withTransaction(
        pool,
        async (client) => {
          const { trade, league, items, teams } = await loadTrade(client, row.id);
          // Not a refusal to cancel: a trade that is no longer due is left for its own run.
          if (await transitionRefusal('execute', { trade, league })) return { status: trade.status };
          await executeTrade(client, { trade, league, items, teams });
          return { status: 'executed', leagueId: league.id };
        },
        { label: 'processDueTrades' }
      );
    } catch (err) {
      // A dead trade (roster changed under it) shouldn't be retried forever. The
      // cancel runs in a FRESH transaction, never on the failed one: by the time
      // this catch runs the wrapper has already rolled back and returned (or, on
      // a rejecting rollback, destroyed) the connection, so there is no open
      // transaction of ours to write into. The cancel and the owners' notices
      // commit together (#2295). The original error survives the wrapper unchanged
      // (any rollback failure rides along as err.rollbackError), so a TradeError
      // is still recognisable here. Freeze, Team lock and kickoff-hold refusals stay transient and keep waiting, by design.
      if (err instanceof TradeError) {
        try {
          await withTransaction(
            pool,
            async (client) => {
              // League lock first via loadTrade, the house order (#946): locking
              // trades first would invert it against a vote or commissioner decide.
              const { trade, league, teams } = await loadTrade(client, row.id);
              // A trade settled elsewhere since the failed attempt is not ours to cancel or announce.
              if (trade.status !== 'accepted') return;
              await client.query(
                `UPDATE "trades" SET "status" = 'cancelled', "updated_at" = now() WHERE "id" = $1 AND "status" = 'accepted'`,
                [row.id]
              );
              for (const teamId of [trade.proposing_team_id, trade.receiving_team_id]) {
                await notify(client, {
                  userId: teams.get(teamId).owner_id,
                  leagueId: league.id,
                  type: 'trade_result',
                  message: `Your trade was cancelled: ${err.message}`,
                  data: { tradeId: row.id },
                });
              }
            },
            { label: 'processDueTrades cancel' }
          );
          outcomes.push({ tradeId: row.id, status: 'cancelled', reason: err.message });
        } catch (cancelErr) {
          // Contained like the executed branch's broadcast: letting it escape would
          // abort the rest of the tick. The trade stays accepted and retries next tick.
          console.error('trade cancel failed for trade %s:', row.id, cancelErr.message);
        }
      } else {
        console.error('trade execution failed for trade %s:', row.id, err.message);
      }
      continue;
    }
    outcomes.push({ tradeId: row.id, status: result.status });
  }
  return outcomes;
}

/**
 * The items of the given trades for GET /api/trades, each carrying the week's
 * NFL opponent (CONTEXT.md, NFL opponent; #1585): a Team code, or null on a
 * bye or when the league has no current_week - present-and-null, never absent
 * (#1132). The week is the league's current week, the same one the Players
 * page reads; ONE schedule read per call, not one per item (#1405).
 * `client` is injectable; it defaults to the shared pool.
 */
async function readTradeItems({ leagueId, tradeIds }, { client = pool } = {}) {
  if (!tradeIds || tradeIds.length === 0) return [];
  const itemsResult = await client.query(
    `SELECT "trade_items".*, "players"."name", "players"."position", "players"."nfl_team"
     FROM "trade_items" JOIN "players" ON "players"."id" = "trade_items"."player_id"
     WHERE "trade_items"."trade_id" = ANY($1::int[])`,
    [tradeIds]
  );
  const leagueRow = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueRow.rows[0] || null;
  const opponentByTeam = league && league.current_week != null
    ? await getWeekOpponents(
      { season: league.current_season != null ? Number(league.current_season) : 2026, week: Number(league.current_week) },
      { client }
    )
    : new Map();
  return itemsResult.rows.map((item) => ({
    ...item,
    nfl_opponent: opponentByTeam.get(normalizeNflTeam(item.nfl_team)) ?? null,
  }));
}

module.exports = {
  TradeError,
  proposeTrade,
  respondToTrade,
  cancelTrade,
  counterTrade,
  vetoTrade,
  commissionerDecide,
  executeTrade,
  processDueTrades,
  readTradeItems,
};
