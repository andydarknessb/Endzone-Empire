const pool = require('../modules/pool');
const { assertFantasyLeagueRow } = require('./leagueType');
const { requireMember } = require('./leagueMembership.service');
const { logTransaction, notify } = require('./activity.service');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { rosterCapacity } = require('./irPolicy.service');
// Module object, not destructured: the seam tests mock benchAcquiredPlayer.
const lineupService = require('./lineup.service');

class WaiverError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Pure: order the pending claims for ONE player, best first.
 * - 'faab': highest bid wins; ties break by waiver priority (lower = better),
 *   then earliest claim.
 * - 'priority': reverse-standings waiver priority (lower = better), then
 *   earliest claim.
 * claims: [{ id, team_id, bid, created_at }]
 * priorities: Map(team_id -> waiver_priority)
 */
function orderClaims(claims, priorities, waiverType) {
  const byPriority = (a, b) =>
    (priorities.get(a.team_id) || 999) - (priorities.get(b.team_id) || 999) ||
    new Date(a.created_at) - new Date(b.created_at) ||
    a.id - b.id;
  const sorted = [...claims];
  if (waiverType === 'faab') {
    sorted.sort((a, b) => (b.bid || 0) - (a.bid || 0) || byPriority(a, b));
  } else {
    sorted.sort(byPriority);
  }
  return sorted;
}

/**
 * When a player leaves a roster he goes on waivers for the league's waiver
 * period. Runs inside the caller's transaction. `droppedByTeamId` (when the
 * waiver hold originates from a roster drop rather than a waiver-claim swap)
 * records which team can undo it — see `undoDrop` in draft.service.js.
 *
 * `interruptedSlot` / `interruptedIrAttested` record what the drop
 * interrupted: the slot and attestation the player held in the current week
 * at the moment he was dropped (#197). The undo replays that record rather
 * than reading a leftover lineup row, because the drop deletes the row. The
 * hold is the right home for it: it already names the dropping team, it
 * already gates undo, and it is cleared when the hold clears, which is
 * exactly when the undo stops being offered.
 */
async function placeOnWaivers(client, {
  leagueId,
  playerId,
  waiverPeriodHours,
  droppedByTeamId = null,
  interruptedSlot = null,
  interruptedIrAttested = false,
}) {
  await client.query(
    `INSERT INTO "waiver_players" ("league_id", "player_id", "available_at", "dropped_by_team_id",
                                   "interrupted_slot", "interrupted_ir_attested")
     VALUES ($1, $2, now() + make_interval(hours => $3), $4, $5, $6)
     ON CONFLICT ("league_id", "player_id")
     DO UPDATE SET "available_at" = EXCLUDED."available_at", "updated_at" = now(),
                   "dropped_by_team_id" = EXCLUDED."dropped_by_team_id",
                   "interrupted_slot" = EXCLUDED."interrupted_slot",
                   "interrupted_ir_attested" = EXCLUDED."interrupted_ir_attested"`,
    [leagueId, playerId, waiverPeriodHours, droppedByTeamId, interruptedSlot, interruptedIrAttested]
  );
}

/**
 * `placeOnWaivers` plus everything an undo will need: what the dropped
 * player's current-week lineup row held, recorded on the hold before the row
 * is deleted, and the team that may replay it.
 *
 * Named for what it does, which is not the whole drop. The caller still owns
 * the roster row: delete it first, then call this inside the same
 * transaction. Both callers do exactly that.
 *
 * The order is the point, and it is why this is one function rather than
 * three calls repeated at each site: `currentWeekEntry` has to run before
 * `removeLineupEntries` takes the row away, and both have to run before the
 * hold is written, or the hold records nothing and the undo silently
 * benches him (#197).
 *
 * **Two callers, and a third that must not become one.** `draft.service`'s
 * manager drop and `commissioner.service`'s forced drop are both undoable
 * and both belong here. The waiver-claim drop in `processWaivers` below is
 * not: a claim's drop leaves no undo to offer, so it records no interrupted
 * stash and names no dropping team, and it calls `placeOnWaivers` directly.
 * That is a deliberate difference, not an oversight - hence the name. If a
 * fourth drop path appears, the question to answer before reaching for this
 * helper is whether it is undoable; if it is not, it does not want the
 * record and passing it would offer an undo that cannot work.
 */
async function placeOnWaiversUndoable(client, { league, teamId, playerId }) {
  const interrupted = await lineupService.currentWeekEntry(client, { league, teamId, playerId });
  await lineupService.removeLineupEntries(client, { league, teamId, playerId });
  await placeOnWaivers(client, {
    leagueId: league.id,
    playerId,
    waiverPeriodHours: league.waiver_period_hours,
    droppedByTeamId: teamId,
    ...lineupService.interruptedStashFields(interrupted),
  });
}

/**
 * Is this player currently on waivers in the league (not yet a free agent)?
 * True when he has an unexpired waiver_players row, or the league's post-draft
 * blanket window is still open and he is unrostered.
 */
async function isOnWaivers(client, { league, playerId }) {
  const row = await client.query(
    `SELECT 1 FROM "waiver_players"
     WHERE "league_id" = $1 AND "player_id" = $2 AND "available_at" > now()`,
    [league.id, playerId]
  );
  if (row.rows[0]) return true;
  if (!league.waivers_clear_at || new Date(league.waivers_clear_at) <= new Date()) return false;
  const rostered = await client.query(
    `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
    [league.id, playerId]
  );
  return !rostered.rows[0];
}

/**
 * The single player a manager selected from Player Browser to claim. This is
 * intentionally a targeted read rather than a second waiver list: a blanket
 * waiver window applies to every unrostered player and must not turn the
 * Waiver Wire into the entire player catalog.
 */
async function claimTarget({ leagueId, userId, playerId }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new WaiverError(404, 'league not found');
  assertFantasyLeagueRow(league);
  if (league.transactions_locked) {
    throw new WaiverError(409, 'transactions are locked by the commissioner');
  }

  const team = await requireMember(pool, { leagueId, userId });
  if (team.locked) throw new WaiverError(409, 'your team is locked by the commissioner');

  const playerResult = await pool.query(
    `SELECT "id", "name", "position", "nfl_team" FROM "players" WHERE "id" = $1`,
    [playerId]
  );
  const player = playerResult.rows[0];
  if (!player) throw new WaiverError(404, 'player not found');

  const rostered = await pool.query(
    `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
    [leagueId, playerId]
  );
  if (rostered.rows[0]) throw new WaiverError(409, 'player is already rostered in this league');
  if (!(await isOnWaivers(pool, { league, playerId }))) {
    throw new WaiverError(409, 'player is not on waivers');
  }
  return player;
}

/** Submit a waiver claim (optionally dropping a player, optionally a FAAB bid). */
async function submitClaim({ leagueId, userId, playerId, dropPlayerId, bid = 0 }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) throw new WaiverError(404, 'league not found');
    assertFantasyLeagueRow(league); // no waivers in a pick'em-only league
    if (league.transactions_locked) {
      throw new WaiverError(409, 'transactions are locked by the commissioner');
    }

    const team = await requireMember(client, { leagueId, userId });
    if (team.locked) throw new WaiverError(409, 'your team is locked by the commissioner');

    if (league.waiver_type === 'faab') {
      if (!Number.isInteger(bid) || bid < 0) throw new WaiverError(400, 'bid must be a non-negative integer');
      if (bid > team.faab_remaining) {
        throw new WaiverError(409, `bid exceeds your remaining FAAB budget (${team.faab_remaining})`);
      }
    }

    const rostered = await client.query(
      `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
      [leagueId, playerId]
    );
    if (rostered.rows[0]) throw new WaiverError(409, 'player is already rostered in this league');
    if (!(await isOnWaivers(client, { league, playerId }))) {
      throw new WaiverError(409, 'player is not on waivers');
    }

    if (dropPlayerId) {
      const onMyTeam = await client.query(
        `SELECT 1 FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
        [team.id, dropPlayerId]
      );
      if (!onMyTeam.rows[0]) throw new WaiverError(404, 'drop player is not on your roster');
    }

    const dupe = await client.query(
      `SELECT 1 FROM "waiver_claims"
       WHERE "team_id" = $1 AND "player_id" = $2 AND "status" = 'pending'`,
      [team.id, playerId]
    );
    if (dupe.rows[0]) throw new WaiverError(409, 'you already have a pending claim on this player');

    const claimResult = await client.query(
      `INSERT INTO "waiver_claims" ("league_id", "team_id", "player_id", "drop_player_id", "bid")
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [leagueId, team.id, playerId, dropPlayerId || null, league.waiver_type === 'faab' ? bid : 0]
    );
    await client.query('COMMIT');
    return claimResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Cancel one of the caller's pending claims. */
async function cancelClaim({ leagueId, userId, claimId }) {
  const result = await pool.query(
    `UPDATE "waiver_claims" SET "status" = 'cancelled', "updated_at" = now()
     FROM "teams"
     WHERE "waiver_claims"."id" = $1 AND "waiver_claims"."status" = 'pending'
       AND "teams"."id" = "waiver_claims"."team_id"
       AND "teams"."league_id" = $2 AND "teams"."owner_id" = $3
     RETURNING "waiver_claims".*`,
    [claimId, leagueId, userId]
  );
  if (!result.rows[0]) throw new WaiverError(404, 'pending claim not found');
  return result.rows[0];
}

/**
 * Resolve every DUE pending claim in a league (a claim is due once its
 * player's waiver window has expired). Winners are picked per player by
 * orderClaims; a winning claim executes the add (and optional drop)
 * atomically, deducts FAAB, and sends the winner to the back of the
 * priority order. Everything happens inside one transaction with the league
 * row locked, so the scheduler and a manual trigger can't double-process.
 */
/**
 * The post-draft blanket window (leagues.waivers_clear_at) is spent once it
 * has expired and been processed, exactly like an expired waiver_players row.
 * Left in place, an expired window keeps the league in processAllDueWaivers'
 * due list on EVERY scheduler tick for the rest of the season, and every
 * listing re-runs the waiver-results email digest (NanaGoat's 66 copies of one
 * "WON" email, 2026-09-02). Every reader already treats a past window and a
 * NULL one identically (isOnWaivers, the Player Browser's window flag), so
 * NULLing it changes no read model. Guarded on `<= now()` because a
 * commissioner may trigger processing while the window is still open, and an
 * open window must survive that. Runs inside the caller's transaction, after
 * the league row's FOR UPDATE lock.
 */
async function spendExpiredBlanketWindow(client, leagueId) {
  await client.query(
    `UPDATE "leagues" SET "waivers_clear_at" = NULL
     WHERE "id" = $1 AND "waivers_clear_at" <= now()`,
    [leagueId]
  );
}

async function processWaivers({ leagueId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new WaiverError(404, 'league not found');

    // Due = the player's individual window expired, or he has no individual
    // window and the post-draft blanket window (if any) has expired.
    const dueResult = await client.query(
      `SELECT "waiver_claims".*
       FROM "waiver_claims"
       LEFT JOIN "waiver_players" ON "waiver_players"."league_id" = "waiver_claims"."league_id"
         AND "waiver_players"."player_id" = "waiver_claims"."player_id"
       WHERE "waiver_claims"."league_id" = $1 AND "waiver_claims"."status" = 'pending'
         AND COALESCE("waiver_players"."available_at",
                      (SELECT "waivers_clear_at" FROM "leagues" WHERE "id" = $1),
                      now()) <= now()
       ORDER BY "waiver_claims"."player_id", "waiver_claims"."id"`,
      [leagueId]
    );
    if (dueResult.rows.length === 0) {
      await client.query(
        `DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "available_at" <= now()`,
        [leagueId]
      );
      await spendExpiredBlanketWindow(client, leagueId);
      await client.query('COMMIT');
      // The scheduler also reaches this path when an empty blanket window
      // expires. No roster write is needed, but the Player read model changed
      // from waiver-only to free-agent and connected managers must refetch. This
      // runs in the WORKER, so it rides the one Draft room adapter (#745).
      await getDraftRoomBroadcast().rosterChanged(leagueId);
      return { processed: 0, results: [] };
    }

    const teamsResult = await client.query(
      `SELECT "teams".*, "users"."id" AS "user_id" FROM "teams"
       JOIN "users" ON "users"."id" = "teams"."owner_id"
       WHERE "teams"."league_id" = $1`,
      [leagueId]
    );
    const teams = new Map(teamsResult.rows.map((t) => [t.id, t]));
    const priorities = new Map(teamsResult.rows.map((t) => [t.id, t.waiver_priority]));
    const teamCount = teamsResult.rows.length;

    const byPlayer = new Map();
    for (const claim of dueResult.rows) {
      if (!byPlayer.has(claim.player_id)) byPlayer.set(claim.player_id, []);
      byPlayer.get(claim.player_id).push(claim);
    }

    const finish = (claim, status, note) =>
      client.query(
        `UPDATE "waiver_claims" SET "status" = $1, "note" = $2, "processed_at" = now(), "updated_at" = now()
         WHERE "id" = $3`,
        [status, note || null, claim.id]
      );

    const results = [];
    for (const [playerId, claims] of byPlayer) {
      const ordered = orderClaims(claims, priorities, league.waiver_type);
      let winner = null;
      for (const claim of ordered) {
        if (winner) {
          await finish(claim, 'lost', 'a higher claim won this player');
          continue;
        }
        const team = teams.get(claim.team_id);
        const failure = await claimFailureReason(client, { league, team, claim });
        if (failure) {
          await finish(claim, 'invalid', failure);
          results.push({ claimId: claim.id, playerId, status: 'invalid', reason: failure });
          continue;
        }

        // Execute: optional drop (dropped player goes on waivers), then add
        if (claim.drop_player_id) {
          await client.query(
            `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
            [team.id, claim.drop_player_id]
          );
          // The lineup follows the roster (#197). No interrupted-stash
          // record here: a waiver-claim drop is not undoable, so there is
          // nothing for an undo to replay.
          //
          // This is the third drop-to-waivers sequence and the one that
          // deliberately stays open-coded: `placeOnWaiversUndoable` above
          // exists for the two that ARE undoable, and routing this one
          // through it would write a hold advertising an undo no route
          // offers (#222). The omission is the behaviour, not a shortcut.
          await lineupService.removeLineupEntries(client, {
            league, teamId: team.id, playerId: claim.drop_player_id,
          });
          await placeOnWaivers(client, {
            leagueId,
            playerId: claim.drop_player_id,
            waiverPeriodHours: league.waiver_period_hours,
          });
        }
        await client.query(
          `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
          [leagueId, team.id, playerId]
        );
        // A won claim lands on the bench, never back in an old stash (#94).
        await lineupService.benchAcquiredPlayer(client, { league, teamId: team.id, playerId });
        if (league.waiver_type === 'faab' && claim.bid > 0) {
          await client.query(
            `UPDATE "teams" SET "faab_remaining" = "faab_remaining" - $1, "updated_at" = now() WHERE "id" = $2`,
            [claim.bid, team.id]
          );
        }
        // Winner goes to the back of the waiver order
        await client.query(
          `UPDATE "teams" SET "waiver_priority" = "waiver_priority" - 1, "updated_at" = now()
           WHERE "league_id" = $1 AND "waiver_priority" > $2`,
          [leagueId, priorities.get(team.id)]
        );
        await client.query(
          `UPDATE "teams" SET "waiver_priority" = $1, "updated_at" = now() WHERE "id" = $2`,
          [teamCount, team.id]
        );
        // Keep the in-memory order consistent for later players in this run
        for (const [tid, p] of priorities) {
          if (tid === team.id) priorities.set(tid, teamCount);
          else if (p > priorities.get(team.id)) priorities.set(tid, p - 1);
        }

        await finish(claim, 'won', null);
        await logTransaction(client, {
          leagueId,
          teamId: team.id,
          type: 'waiver',
          detail: {
            playerId,
            droppedPlayerId: claim.drop_player_id || null,
            bid: league.waiver_type === 'faab' ? claim.bid : undefined,
          },
        });
        await notify(client, {
          userId: team.user_id,
          leagueId,
          type: 'waiver_result',
          message: 'Your waiver claim was successful!',
          data: { claimId: claim.id, playerId },
        });
        winner = claim;
        results.push({ claimId: claim.id, playerId, status: 'won', teamId: team.id });
      }
      // Losers get notified too
      for (const claim of ordered) {
        if (winner && claim.id !== winner.id) {
          const team = teams.get(claim.team_id);
          await notify(client, {
            userId: team.user_id,
            leagueId,
            type: 'waiver_result',
            message: 'Your waiver claim did not go through.',
            data: { claimId: claim.id, playerId },
          });
        }
      }
    }

    // Expired waiver windows are spent — clear them so players become free agents
    await client.query(
      `DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "available_at" <= now()`,
      [leagueId]
    );
    await spendExpiredBlanketWindow(client, leagueId);

    await client.query('COMMIT');
    await getDraftRoomBroadcast().rosterChanged(leagueId);
    return { processed: dueResult.rows.length, results };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Why can't this claim execute right now? null = it can. */
async function claimFailureReason(client, { league, team, claim }) {
  const rostered = await client.query(
    `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
    [league.id, claim.player_id]
  );
  if (rostered.rows[0]) return 'player is no longer available';

  if (league.waiver_type === 'faab') {
    const faab = await client.query(`SELECT "faab_remaining" FROM "teams" WHERE "id" = $1`, [team.id]);
    if (claim.bid > faab.rows[0].faab_remaining) return 'bid exceeds remaining FAAB budget';
  }

  let dropValid = false;
  if (claim.drop_player_id) {
    const onTeam = await client.query(
      `SELECT 1 FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
      [team.id, claim.drop_player_id]
    );
    dropValid = Boolean(onTeam.rows[0]);
    if (!dropValid) return 'the player you offered to drop is no longer on your roster';
  }
  const count = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
    [team.id]
  );
  const effective = count.rows[0].n - (dropValid ? 1 : 0);
  // Roster capacity, not the static roster limit: an eligible IR stash grants
  // a spot, and a dropped player's own stash grants nothing (#97). The claimed
  // player gets no restored credit either - a won claim benches him.
  const capacity = await rosterCapacity(client, {
    league,
    teamId: team.id,
    excludePlayerIds: dropValid ? [claim.drop_player_id] : [],
  });
  if (effective >= capacity) return `roster capacity of ${capacity} reached`;
  return null;
}

/** Scheduler entry point: process every league whose waiver availability changed. */
async function processAllDueWaivers() {
  const due = await pool.query(
    `SELECT DISTINCT "waiver_claims"."league_id"
     FROM "waiver_claims"
     LEFT JOIN "waiver_players" ON "waiver_players"."league_id" = "waiver_claims"."league_id"
       AND "waiver_players"."player_id" = "waiver_claims"."player_id"
     LEFT JOIN "leagues" ON "leagues"."id" = "waiver_claims"."league_id"
     WHERE "waiver_claims"."status" = 'pending'
       AND COALESCE("waiver_players"."available_at", "leagues"."waivers_clear_at", now()) <= now()
     UNION
     SELECT DISTINCT "league_id" FROM "waiver_players" WHERE "available_at" <= now()
     UNION
     SELECT "id" AS "league_id" FROM "leagues" WHERE "waivers_clear_at" <= now()`
  );
  const outcomes = [];
  for (const row of due.rows) {
    try {
      outcomes.push({ leagueId: row.league_id, ...(await processWaivers({ leagueId: row.league_id })) });
    } catch (err) {
      console.error('waiver processing failed for league %s:', row.league_id, err.message);
    }
  }
  return outcomes;
}

module.exports = {
  WaiverError,
  claimTarget,
  claimFailureReason,
  orderClaims,
  placeOnWaivers,
  placeOnWaiversUndoable,
  isOnWaivers,
  submitClaim,
  cancelClaim,
  processWaivers,
  processAllDueWaivers,
};
