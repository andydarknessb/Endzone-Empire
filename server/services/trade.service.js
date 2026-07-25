const pool = require('../modules/pool');
const { logTransaction, notify, notifyLeague } = require('./activity.service');
const { isLeagueCommissioner } = require('./leagueRole.service');

class TradeError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Load a trade with its league, both teams, and items; lock the trade row. */
async function loadTrade(client, tradeId, { forUpdate = true } = {}) {
  const tradeResult = await client.query(
    `SELECT * FROM "trades" WHERE "id" = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [tradeId]
  );
  const trade = tradeResult.rows[0];
  if (!trade) throw new TradeError(404, 'trade not found');
  const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [trade.league_id]);
  const itemsResult = await client.query(`SELECT * FROM "trade_items" WHERE "trade_id" = $1`, [tradeId]);
  const teamsResult = await client.query(
    `SELECT * FROM "teams" WHERE "id" IN ($1, $2)`,
    [trade.proposing_team_id, trade.receiving_team_id]
  );
  const teams = new Map(teamsResult.rows.map((t) => [t.id, t]));
  return { trade, league: leagueResult.rows[0], items: itemsResult.rows, teams };
}

function assertBeforeDeadline(league) {
  if (league.trade_deadline_week != null && league.current_week > league.trade_deadline_week) {
    throw new TradeError(409, `the trade deadline (week ${league.trade_deadline_week}) has passed`);
  }
}

/**
 * Propose a multi-player trade. playerIds may belong to either team; each
 * item's direction is derived from current ownership. Validated: both teams
 * in the league, every player on one of the two rosters, deadline not passed.
 */
async function proposeTrade({ leagueId, userId, receivingTeamId, playerIds, counterOf = null }) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new TradeError(400, 'playerIds must be a non-empty array');
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new TradeError(400, 'duplicate players in trade');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) throw new TradeError(404, 'league not found');
    if (league.transactions_locked) {
      throw new TradeError(409, 'transactions are locked by the commissioner');
    }
    assertBeforeDeadline(league);

    const myTeamResult = await client.query(
      `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, userId]
    );
    const myTeam = myTeamResult.rows[0];
    if (!myTeam) throw new TradeError(403, 'you do not have a team in this league');
    if (myTeam.locked) throw new TradeError(409, 'your team is locked by the commissioner');
    if (myTeam.id === receivingTeamId) throw new TradeError(400, 'cannot trade with yourself');

    const otherResult = await client.query(
      `SELECT * FROM "teams" WHERE "id" = $1 AND "league_id" = $2`,
      [receivingTeamId, leagueId]
    );
    if (!otherResult.rows[0]) throw new TradeError(404, 'receiving team not found in this league');
    const otherTeam = otherResult.rows[0];

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
    await client.query('COMMIT');
    // Web push after commit, best-effort, pref-gated
    try {
      const { usersWanting } = require('./prefs.service');
      const wanting = await usersWanting([otherTeam.owner_id], 'tradeOffers');
      if (wanting.length > 0) {
        const push = require('./push.service');
        await push.sendPushToUsers(wanting, {
          title: 'New trade offer',
          body: `${myTeam.name} sent you a trade offer`,
          url: `/#/league/${leagueId}/trades`,
        });
      }
    } catch (err) {
      console.error('trade offer push failed:', err.message);
    }
    return trade;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Receiving owner accepts or rejects. Accepting either opens the league
 * review window (when vetoes are enabled) or executes immediately.
 */
async function respondToTrade({ tradeId, userId, action }) {
  if (!['accept', 'reject'].includes(action)) throw new TradeError(400, 'action must be accept or reject');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { trade, league, items, teams } = await loadTrade(client, tradeId);
    if (trade.status !== 'pending') throw new TradeError(409, `trade is ${trade.status}, not pending`);
    const receiving = teams.get(trade.receiving_team_id);
    if (receiving.owner_id !== userId) throw new TradeError(403, 'only the receiving owner can respond');
    const proposing = teams.get(trade.proposing_team_id);

    if (action === 'reject') {
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
      await client.query('COMMIT');
      return { tradeId, status: 'rejected' };
    }

    assertBeforeDeadline(league);
    const reviewed = league.trade_veto_votes > 0 && league.trade_review_hours > 0;
    if (reviewed) {
      await client.query(
        `UPDATE "trades" SET "status" = 'accepted', "updated_at" = now(),
         "review_ends_at" = now() + make_interval(hours => $2)
         WHERE "id" = $1`,
        [tradeId, league.trade_review_hours]
      );
      await notifyLeague(client, {
        leagueId: league.id,
        type: 'trade_review',
        message: `Trade accepted between ${proposing.name} and ${receiving.name} — league review is open`,
        data: { tradeId },
        excludeUserIds: [proposing.owner_id, receiving.owner_id],
      });
      await notify(client, {
        userId: proposing.owner_id,
        leagueId: league.id,
        type: 'trade_result',
        message: `${receiving.name} accepted your trade — it executes after league review`,
        data: { tradeId },
      });
      await client.query('COMMIT');
      return { tradeId, status: 'accepted' };
    }

    await executeTrade(client, { trade, league, items, teams });
    await client.query('COMMIT');
    return { tradeId, status: 'executed' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Proposer cancels their own pending offer. */
async function cancelTrade({ tradeId, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { trade, teams } = await loadTrade(client, tradeId);
    if (trade.status !== 'pending') throw new TradeError(409, `trade is ${trade.status}, not pending`);
    if (teams.get(trade.proposing_team_id).owner_id !== userId) {
      throw new TradeError(403, 'only the proposer can cancel');
    }
    await client.query(
      `UPDATE "trades" SET "status" = 'cancelled', "updated_at" = now() WHERE "id" = $1`,
      [tradeId]
    );
    await client.query('COMMIT');
    return { tradeId, status: 'cancelled' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Receiving owner counters: original becomes 'countered', a mirrored new offer is created. */
async function counterTrade({ tradeId, userId, playerIds }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { trade, teams } = await loadTrade(client, tradeId);
    if (trade.status !== 'pending') throw new TradeError(409, `trade is ${trade.status}, not pending`);
    const receiving = teams.get(trade.receiving_team_id);
    if (receiving.owner_id !== userId) throw new TradeError(403, 'only the receiving owner can counter');
    await client.query(
      `UPDATE "trades" SET "status" = 'countered', "updated_at" = now() WHERE "id" = $1`,
      [tradeId]
    );
    await client.query('COMMIT');
    // New offer flows through proposeTrade for full validation
    return await proposeTrade({
      leagueId: trade.league_id,
      userId,
      receivingTeamId: trade.proposing_team_id,
      playerIds,
      counterOf: tradeId,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** A non-involved team owner votes to veto a trade in review. */
async function vetoTrade({ tradeId, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { trade, league, teams } = await loadTrade(client, tradeId);
    if (trade.status !== 'accepted') throw new TradeError(409, 'trade is not in league review');
    if (league.trade_veto_votes < 1) throw new TradeError(409, 'vetoes are disabled in this league');

    const voterResult = await client.query(
      `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [league.id, userId]
    );
    const voter = voterResult.rows[0];
    if (!voter) throw new TradeError(403, 'you do not have a team in this league');
    if (voter.id === trade.proposing_team_id || voter.id === trade.receiving_team_id) {
      throw new TradeError(403, 'teams in the trade cannot vote on it');
    }
    await client.query(
      `INSERT INTO "trade_votes" ("trade_id", "team_id") VALUES ($1, $2)
       ON CONFLICT ("trade_id", "team_id") DO NOTHING`,
      [tradeId, voter.id]
    );
    const votes = await client.query(
      `SELECT COUNT(*)::int AS n FROM "trade_votes" WHERE "trade_id" = $1`,
      [tradeId]
    );
    let status = 'accepted';
    if (votes.rows[0].n >= league.trade_veto_votes) {
      status = 'vetoed';
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
    await client.query('COMMIT');
    return { tradeId, votes: votes.rows[0].n, votesNeeded: league.trade_veto_votes, status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Commissioner (owner or co-commissioner) force-approves or vetoes a pending/accepted trade. */
async function commissionerDecide({ tradeId, userId, approve }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { trade, league, items, teams } = await loadTrade(client, tradeId);
    if (!(await isLeagueCommissioner(client, league.id, userId))) {
      throw new TradeError(403, 'only the commissioner can do this');
    }
    if (!['pending', 'accepted'].includes(trade.status)) {
      throw new TradeError(409, `trade is ${trade.status}`);
    }
    if (approve) {
      await executeTrade(client, { trade, league, items, teams, byCommissioner: true });
      await client.query('COMMIT');
      return { tradeId, status: 'executed' };
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
    await client.query('COMMIT');
    return { tradeId, status: 'vetoed' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Swap the rosters atomically inside the caller's transaction. Re-validates
 * that every player is still on the expected roster and that both teams stay
 * within the roster limit after the swap.
 */
async function executeTrade(client, { trade, league, items, teams, byCommissioner = false }) {
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
  for (const [teamId, change] of delta) {
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [teamId]
    );
    if (count.rows[0].n + change > league.roster_limit) {
      throw new TradeError(409, `trade would put ${teams.get(teamId).name} over the roster limit`);
    }
  }
  for (const item of items) {
    await client.query(
      `UPDATE "team_players" SET "team_id" = $1, "updated_at" = now()
       WHERE "team_id" = $2 AND "player_id" = $3`,
      [item.to_team_id, item.from_team_id, item.player_id]
    );
  }
  await client.query(
    `UPDATE "trades" SET "status" = 'executed', "updated_at" = now() WHERE "id" = $1`,
    [trade.id]
  );
  // Names are baked into the transaction detail at execution time so the
  // league activity feed can render "traded X to Y for Z" without the
  // transactions route having to re-join trade_items/players/teams later.
  const playerNamesResult = await client.query(
    `SELECT "id", "name" FROM "players" WHERE "id" = ANY($1::int[])`,
    [items.map((i) => i.player_id)]
  );
  const playerNameById = new Map(playerNamesResult.rows.map((p) => [p.id, p.name]));
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { trade, league, items, teams } = await loadTrade(client, row.id);
      if (trade.status === 'accepted') {
        await executeTrade(client, { trade, league, items, teams });
      }
      await client.query('COMMIT');
      outcomes.push({ tradeId: row.id, status: 'executed' });
    } catch (err) {
      await client.query('ROLLBACK');
      // A dead trade (roster changed under it) shouldn't be retried forever
      if (err instanceof TradeError) {
        await pool.query(
          `UPDATE "trades" SET "status" = 'cancelled', "updated_at" = now() WHERE "id" = $1`,
          [row.id]
        );
        outcomes.push({ tradeId: row.id, status: 'cancelled', reason: err.message });
      } else {
        console.error('trade execution failed for trade %s:', row.id, err.message);
      }
    } finally {
      client.release();
    }
  }
  return outcomes;
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
};
