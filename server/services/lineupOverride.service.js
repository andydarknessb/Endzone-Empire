const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const lineupService = require('./lineup.service');
const { calculateFantasyPoints, rulesForLeague } = require('./scoringRules');

/**
 * Called shots (spec #1846, #1856; CONTEXT.md "Start/sit advice"): a Manager
 * keeps the current starter over the player the Forecast would start, and the
 * server records the pair with both Point estimates and the start/sit
 * probability as they stood. Storage is `lineup_overrides`, which later also
 * holds automatically captured overrides (`called = false`); every query here
 * says `called` so those rows never read as shots.
 *
 * This module owns the rows and their rules. It never builds advice itself:
 * `declareCalledShot` takes the advice loader as an argument (the router hands
 * it `startSitAdvice`), because the decision service reads shots to pin their
 * pairs and the two modules must not require each other.
 */

class CalledShotError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const BENCH = 'BENCH';
const IR = 'IR';
const isStartingSlot = (slot) => slot != null && slot !== BENCH && slot !== IR;

const num = (value) => (value == null ? null : Number(value));

const SHOT_COLUMNS = `"lineup_overrides"."id", "lineup_overrides"."team_id", "lineup_overrides"."season",
  "lineup_overrides"."week", "lineup_overrides"."slot",
  "lineup_overrides"."starter_player_id", "lineup_overrides"."benched_player_id",
  "lineup_overrides"."starter_point_estimate", "lineup_overrides"."benched_point_estimate",
  "lineup_overrides"."probability", "lineup_overrides"."verdict", "lineup_overrides"."declared_at",
  "lineup_overrides"."outcome", "lineup_overrides"."starter_points_actual",
  "lineup_overrides"."benched_points_actual", "lineup_overrides"."resolved_at"`;

/** The team's called row for the week with both players' names and NFL teams, or null. */
async function readCalledRow(db, { teamId, season, week }) {
  const result = await db.query(
    `SELECT ${SHOT_COLUMNS},
            "starter"."name" AS "starter_name", "starter"."nfl_team" AS "starter_nfl_team",
            "benched"."name" AS "benched_name", "benched"."nfl_team" AS "benched_nfl_team"
     FROM "lineup_overrides"
     JOIN "players" AS "starter" ON "starter"."id" = "lineup_overrides"."starter_player_id"
     JOIN "players" AS "benched" ON "benched"."id" = "lineup_overrides"."benched_player_id"
     WHERE "lineup_overrides"."team_id" = $1 AND "lineup_overrides"."season" = $2
       AND "lineup_overrides"."week" = $3 AND "lineup_overrides"."called"`,
    [teamId, season, week]
  );
  return result.rows[0] || null;
}

/**
 * The wire shape of a shot. `status` is `pending` (neither player has
 * locked), `locked` (the first of the two has: it can no longer be withdrawn)
 * or `resolved` (settled, `outcome` says how: hit, miss or void).
 */
function shotPayload(row, lockedIds) {
  const resolved = row.outcome !== 'pending';
  const locked = lockedIds.has(row.starter_player_id) || lockedIds.has(row.benched_player_id);
  const status = resolved ? 'resolved' : locked ? 'locked' : 'pending';
  return {
    id: row.id,
    season: row.season,
    week: row.week,
    slot: row.slot,
    starter: { playerId: row.starter_player_id, name: row.starter_name, projection: num(row.starter_point_estimate), points: num(row.starter_points_actual) },
    benched: { playerId: row.benched_player_id, name: row.benched_name, projection: num(row.benched_point_estimate), points: num(row.benched_points_actual) },
    probability: num(row.probability),
    verdict: row.verdict,
    declaredAt: row.declared_at,
    status,
    outcome: resolved ? row.outcome : null,
    resolvedAt: row.resolved_at,
    canWithdraw: status === 'pending',
  };
}

async function lockedAmong(db, row, now) {
  return lineupService.lockedPlayerIds(db, {
    season: row.season,
    week: row.week,
    now,
    players: [
      { id: row.starter_player_id, nflTeam: row.starter_nfl_team },
      { id: row.benched_player_id, nflTeam: row.benched_nfl_team },
    ],
  });
}

/**
 * Settles a pending shot once every matchup of its week is final: hit when the
 * starter scored at least as much as the benched player, miss when he scored
 * less, void when either player has no stat line (never played). Both players
 * are priced the settle pass's way, under this league's rules (#739).
 */
async function resolveIfSettled(db, { league, row }) {
  if (row.outcome !== 'pending') return row;
  const settled = await db.query(
    `SELECT COUNT(*)::int AS "n", BOOL_AND("final") AS "all_final"
     FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
    [league.id, row.season, row.week]
  );
  if (!(Number(settled.rows[0].n) > 0 && settled.rows[0].all_final === true)) return row;

  const statRows = await db.query(
    `SELECT "player_id", "stats" FROM "player_stats"
     WHERE "player_id" = ANY($1::int[]) AND "season" = $2 AND "week" = $3`,
    [[row.starter_player_id, row.benched_player_id], row.season, row.week]
  );
  const rules = rulesForLeague(league);
  const pointsOf = new Map(statRows.rows.map((r) => [r.player_id, calculateFantasyPoints(r.stats, rules)]));
  const starterPoints = pointsOf.has(row.starter_player_id) ? pointsOf.get(row.starter_player_id) : null;
  const benchedPoints = pointsOf.has(row.benched_player_id) ? pointsOf.get(row.benched_player_id) : null;
  let outcome = 'void';
  if (starterPoints != null && benchedPoints != null) outcome = starterPoints >= benchedPoints ? 'hit' : 'miss';
  await db.query(
    `UPDATE "lineup_overrides"
     SET "outcome" = $1, "starter_points_actual" = $2, "benched_points_actual" = $3, "resolved_at" = now()
     WHERE "id" = $4 AND "outcome" = 'pending'`,
    [outcome, starterPoints, benchedPoints, row.id]
  );
  return {
    ...row, outcome, starter_points_actual: starterPoints, benched_points_actual: benchedPoints, resolved_at: new Date(),
  };
}

/**
 * The team's called shot for the week as the wire carries it, or null.
 * Resolves the shot first when its week has settled.
 */
async function loadCalledShot(db, { league, teamId, season, week, now = new Date() }) {
  const row = await readCalledRow(db, { teamId, season, week });
  if (!row) return null;
  const current = await resolveIfSettled(db, { league, row });
  const lockedIds = await lockedAmong(db, current, now);
  return shotPayload(current, lockedIds);
}

async function loadLeagueAndTeam(leagueId, userId) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new CalledShotError(404, 'league not found');
  const teamResult = await pool.query(
    `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  const team = teamResult.rows[0];
  if (!team) throw new CalledShotError(403, 'you do not manage a team in this league');
  if (league.best_ball) {
    throw new CalledShotError(409, 'best-ball leagues set lineups automatically, so there is no shot to call');
  }
  return { league, team };
}

function requireCurrentWeek(league, week) {
  const target = week === undefined || week === null ? league.current_week : week;
  if (target !== league.current_week) {
    throw new CalledShotError(409, 'a shot can be called or withdrawn only for the current week');
  }
  return target;
}

/**
 * Declares (or replaces) the caller's called shot for the current week. The
 * pair must be a current suggestion with a probability above the tossup line
 * (`loadAdvice` computes the advice with any open shot ignored, so re-calling
 * a pair works), and neither player may have locked. The numbers stored are the
 * advice's own, as they stand.
 */
async function declareCalledShot({ leagueId, userId, week, starterId, benchedId, loadAdvice, now = new Date() }) {
  if (!Number.isInteger(starterId) || !Number.isInteger(benchedId) || starterId === benchedId) {
    throw new CalledShotError(400, 'starterId and benchedId (two different integers) are required');
  }
  const { league, team } = await loadLeagueAndTeam(leagueId, userId);
  const targetWeek = requireCurrentWeek(league, week);

  const playersResult = await pool.query(
    `SELECT "id", "nfl_team" FROM "players" WHERE "id" = ANY($1::int[])`,
    [[starterId, benchedId]]
  );
  const locked = await lineupService.lockedPlayerIds(pool, {
    season: league.current_season,
    week: targetWeek,
    now,
    players: playersResult.rows.map((p) => ({ id: p.id, nflTeam: p.nfl_team })),
  });
  if (locked.size > 0) {
    throw new CalledShotError(409, 'a shot cannot be called once either player has locked; his game has started');
  }

  const advice = await loadAdvice({ leagueId, userId, week: targetWeek });
  const suggestion = (advice.suggestions || []).find(
    (s) => s.current.playerId === starterId && s.suggested.playerId === benchedId
  );
  if (!suggestion) {
    throw new CalledShotError(409, 'the advice does not name that pair as a suggestion, so there is no shot to call');
  }
  if (suggestion.probabilityBetter == null || suggestion.verdict === 'tossup') {
    throw new CalledShotError(409, 'that pair is too close to call, so there is no edge to call a shot against');
  }

  try {
    await withTransaction(
      pool,
      async (client) => {
        await client.query(
          `DELETE FROM "lineup_overrides"
           WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "team_id" = $4 AND "called"`,
          [leagueId, advice.season, advice.week, team.id]
        );
        await client.query(
          `INSERT INTO "lineup_overrides"
             ("league_id", "team_id", "season", "week", "slot", "starter_player_id", "benched_player_id",
              "starter_point_estimate", "benched_point_estimate", "probability", "verdict", "called", "declared_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12)`,
          [
            leagueId, team.id, advice.season, advice.week, suggestion.slot, starterId, benchedId,
            suggestion.current.projection, suggestion.suggested.projection, suggestion.probabilityBetter,
            suggestion.verdict, now,
          ]
        );
      },
      { label: 'declare-called-shot' }
    );
  } catch (error) {
    // Two declares for one team-week racing each other: the partial unique
    // index lets one row in and refuses the other.
    if (error && error.code === '23505') {
      throw new CalledShotError(409, 'another shot was called for this week at the same moment; try again');
    }
    throw error;
  }
  return loadCalledShot(pool, { league, teamId: team.id, season: advice.season, week: advice.week, now });
}

/** Withdraws the caller's open shot; refused once either player has locked or it resolved. */
async function withdrawCalledShot({ leagueId, userId, week, now = new Date() }) {
  const { league, team } = await loadLeagueAndTeam(leagueId, userId);
  const targetWeek = requireCurrentWeek(league, week);
  const row = await readCalledRow(pool, { teamId: team.id, season: league.current_season, week: targetWeek });
  if (!row || row.outcome !== 'pending') throw new CalledShotError(404, 'there is no open called shot to withdraw');
  const locked = await lockedAmong(pool, row, now);
  if (locked.size > 0) {
    throw new CalledShotError(409, 'a shot cannot be withdrawn once either player has locked; his game has started');
  }
  await pool.query(`DELETE FROM "lineup_overrides" WHERE "id" = $1 AND "called"`, [row.id]);
  return { withdrawn: true };
}

/**
 * After a lineup save: a pending shot whose pair the saved lineup no longer
 * matches (the starter left his starting slot, or the benched player took one)
 * stops describing what the Manager did, so it is voided. Best effort by
 * contract (the caller logs and swallows any error): it never blocks a save.
 */
async function voidShotContradictedBySave(db, { teamId, season, week }) {
  const row = await readCalledRow(db, { teamId, season, week });
  if (!row || row.outcome !== 'pending') return false;
  const slots = await db.query(
    `SELECT "player_id", "slot" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "season" = $2 AND "week" = $3 AND "player_id" = ANY($4::int[])`,
    [teamId, season, week, [row.starter_player_id, row.benched_player_id]]
  );
  const slotOf = new Map(slots.rows.map((r) => [r.player_id, r.slot]));
  const holds = isStartingSlot(slotOf.get(row.starter_player_id)) && !isStartingSlot(slotOf.get(row.benched_player_id));
  if (holds) return false;
  await db.query(
    `UPDATE "lineup_overrides" SET "outcome" = 'void', "resolved_at" = now()
     WHERE "id" = $1 AND "outcome" = 'pending'`,
    [row.id]
  );
  return true;
}

module.exports = {
  CalledShotError,
  loadCalledShot,
  declareCalledShot,
  withdrawCalledShot,
  voidShotContradictedBySave,
};
