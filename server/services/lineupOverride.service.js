const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const lineupService = require('./lineup.service');
const { rulesForLeague, calculateFantasyPoints } = require('./scoringRules');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
const { normalizeNflTeam } = require('./nflTeam');

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

/** A suggestion with a start/sit probability above the tossup line (ADR 0054 ruling 4): the one rule a Called shot and an Override share. */
const aboveTossupLine = (suggestion) => suggestion.probabilityBetter != null && suggestion.verdict !== 'tossup';

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
    // Both games have kicked off: the line shows live points (#1857).
    bothLocked: lockedIds.has(row.starter_player_id) && lockedIds.has(row.benched_player_id),
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
 * Both players' points so far this week under the league's scoring: a map of
 * player id to points (0 for a player with no stat line yet).
 */
async function currentPoints(db, { league, row }) {
  const ids = [row.starter_player_id, row.benched_player_id];
  const result = await db.query(
    `SELECT "player_id", "stats" FROM "player_stats"
     WHERE "season" = $1 AND "week" = $2 AND "player_id" = ANY($3::int[])`,
    [row.season, row.week, ids]
  );
  const rules = rulesForLeague(league);
  const byId = new Map(result.rows.map((r) => [r.player_id, r.stats]));
  return new Map(ids.map((id) => [id, byId.get(id) ? calculateFantasyPoints(byId.get(id), rules) : 0]));
}

/**
 * The team's called shot for the week as the wire carries it, or null.
 * Reads the stored outcome only: a shot is judged once, at Advance week, by the
 * settle follow-up (ADR 0054, #1860).
 */
async function loadCalledShot(db, { league, teamId, season, week, now = new Date() }) {
  const row = await readCalledRow(db, { teamId, season, week });
  if (!row) return null;
  const lockedIds = await lockedAmong(db, row, now);
  const payload = shotPayload(row, lockedIds);
  // Once both players have locked their points are moving: the standing line
  // shows them live (#1857). Judged numbers stay as stored.
  if (payload.bothLocked && payload.status !== 'resolved') {
    const points = await currentPoints(db, { league, row });
    payload.starter.points = points.get(row.starter_player_id);
    payload.benched.points = points.get(row.benched_player_id);
  }
  return payload;
}

/**
 * What the rest of the league may see of a team's called shot (#1857, ADR 0054
 * ruling 7): nothing until both players have locked, then the pair, both
 * players' points (live while open, the judged numbers once resolved) and the
 * outcome (null while open). Only `called` rows are ever read, so an
 * automatically captured Override is never here. Carries no projection,
 * probability or declaration time: those stay the calling manager's own.
 */
async function loadPublicCalledShot(db, { league, teamId, season, week, now = new Date() }) {
  const row = await readCalledRow(db, { teamId, season, week });
  if (!row) return null;
  if ((await lockedAmong(db, row, now)).size < 2) return null;
  const resolved = row.outcome !== 'pending';
  const live = resolved ? null : await currentPoints(db, { league, row });
  return {
    starter: {
      playerId: row.starter_player_id,
      name: row.starter_name,
      points: resolved ? num(row.starter_points_actual) : live.get(row.starter_player_id),
    },
    benched: {
      playerId: row.benched_player_id,
      name: row.benched_name,
      points: resolved ? num(row.benched_points_actual) : live.get(row.benched_player_id),
    },
    outcome: resolved ? row.outcome : null,
  };
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

  // A shot that has locked is on the record and stays: replacing it would let a
  // manager walk away from a miss in progress. A voided row has nothing to keep.
  const existing = await readCalledRow(pool, { teamId: team.id, season: league.current_season, week: targetWeek });
  if (existing && (existing.outcome === 'hit' || existing.outcome === 'miss')) {
    throw new CalledShotError(409, 'the called shot for this week has already resolved, so it cannot be replaced');
  }
  if (existing && existing.outcome === 'pending' && (await lockedAmong(pool, existing, now)).size > 0) {
    throw new CalledShotError(409, 'your called shot has locked (a game has started), so it cannot be replaced');
  }

  const advice = await loadAdvice({ leagueId, userId, week: targetWeek });
  const suggestion = (advice.suggestions || []).find(
    (s) => s.current.playerId === starterId && s.suggested.playerId === benchedId
  );
  if (!suggestion) {
    throw new CalledShotError(409, 'the advice does not name that pair as a suggestion, so there is no shot to call');
  }
  if (!aboveTossupLine(suggestion)) {
    throw new CalledShotError(409, 'that pair is too close to call, so there is no edge to call a shot against');
  }

  try {
    await withTransaction(
      pool,
      async (client) => {
        await client.query(
          `DELETE FROM "lineup_overrides"
           WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "team_id" = $4 AND "called"
           AND "outcome" IN ('pending', 'void')`,
          [leagueId, advice.season, advice.week, team.id]
        );
        await client.query(
          `INSERT INTO "lineup_overrides"
             ("league_id", "team_id", "season", "week", "slot", "starter_player_id", "benched_player_id",
              "starter_point_estimate", "benched_point_estimate", "probability", "verdict", "called", "declared_at", "captured_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $12)`,
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
  // Once either player has locked the shot is on the record: a later save that
  // moves the other player does not erase a result in progress.
  if ((await lockedAmong(db, row, new Date())).size > 0) return false;
  await db.query(
    `UPDATE "lineup_overrides" SET "outcome" = 'void', "resolved_at" = now()
     WHERE "id" = $1 AND "outcome" = 'pending'`,
    [row.id]
  );
  return true;
}

/**
 * The team's season record for the start/sit card (#1862), private to its
 * manager: `overrides` is { hits, misses } over the resolved Overrides that
 * are not Called shots (a hit is a manager who was right to keep his starter),
 * `calledShots` { hits, resolved, streak } over the resolved Called shots (a
 * void is neither; the streak is the hits in a row ending at the latest).
 * Each side is null while nothing has resolved, so the card shows no line.
 */
async function loadSeasonRecord(db, { leagueId, teamId, season }) {
  const result = await db.query(
    `SELECT "called", "outcome" FROM "lineup_overrides"
     WHERE "league_id" = $1 AND "team_id" = $2 AND "season" = $3 AND "outcome" IN ('hit', 'miss')
     ORDER BY "week", "id"`,
    [leagueId, teamId, season]
  );
  const overrides = result.rows.filter((r) => !r.called);
  const shots = result.rows.filter((r) => r.called);
  let streak = 0;
  for (let i = shots.length - 1; i >= 0 && shots[i].outcome === 'hit'; i -= 1) streak += 1;
  return {
    overrides: overrides.length === 0 ? null : {
      hits: overrides.filter((r) => r.outcome === 'hit').length,
      misses: overrides.filter((r) => r.outcome === 'miss').length,
    },
    calledShots: shots.length === 0 ? null : {
      hits: shots.filter((r) => r.outcome === 'hit').length,
      resolved: shots.length,
      streak,
    },
  };
}

// A kickoff is captured ONCE per team, on the tick that first sees it: the
// advice rewinds only the lock time, so a later run would read a lineup changed
// since the kickoff and could write pairs the advice never made at lock. A
// unit (league, kickoff, team) is remembered once captured and a failed one is
// retried by the ticks after it, for this long. ponytail: the memory is
// in-process (no table for a per-team-week marker), so a restart inside the
// window captures its kickoffs once more and a unit still failing after 30
// minutes is lost; add the marker if either bites.
const CAPTURE_LOOKBACK_MS = 30 * 60 * 1000;
const capturedUnits = new Map(); // "league:kickoff:team" -> kickoff ms
const ADVICE_LEAD_MS = 60 * 1000; // the advice is read as of a minute before kickoff

/**
 * One captured pair: an Override row (`called = false`), idempotent on the pair
 * key. A pair matching the team's Called shot updates that row's capture time
 * instead of adding a row, once: the declaration stamps `captured_at` equal to
 * `declared_at`, and the update only fires while the two are still equal.
 */
function writeOverride(db, { leagueId, teamId, season, week, suggestion, capturedAt }) {
  return db.query(
    `INSERT INTO "lineup_overrides"
       ("league_id", "team_id", "season", "week", "slot", "starter_player_id", "benched_player_id",
        "starter_point_estimate", "benched_point_estimate", "probability", "verdict", "called", "captured_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
     ON CONFLICT ON CONSTRAINT "lineup_overrides_pair_unique" DO UPDATE
       SET "captured_at" = EXCLUDED."captured_at"
       WHERE "lineup_overrides"."called" AND "lineup_overrides"."captured_at" = "lineup_overrides"."declared_at"`,
    [
      leagueId, teamId, season, week, suggestion.slot, suggestion.current.playerId, suggestion.suggested.playerId,
      suggestion.current.projection, suggestion.suggested.projection, suggestion.probabilityBetter,
      suggestion.verdict, capturedAt,
    ]
  );
}

async function captureLeague(db, { league, loadAdvice, now, seen }) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  const kicked = await db.query(
    `SELECT "nfl_team", "kickoff_at" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2 AND "kickoff_at" <= $3 AND "kickoff_at" > $4`,
    [season, week, now, new Date(now.getTime() - CAPTURE_LOOKBACK_MS)]
  );
  // The NFL teams kicking off at each instant: a player locks at HIS team's kickoff.
  const byKickoff = new Map();
  for (const game of kicked.rows) {
    const instant = new Date(game.kickoff_at).getTime();
    const team = normalizeNflTeam(game.nfl_team);
    if (team === null) continue;
    if (!byKickoff.has(instant)) byKickoff.set(instant, new Set());
    byKickoff.get(instant).add(team);
  }
  if (byKickoff.size === 0) return;

  const teams = await db.query(
    `SELECT "id", "owner_id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" IS NOT NULL`,
    [leagueId]
  );
  let firstError = null;
  for (const [instant, nflTeams] of byKickoff) {
    for (const team of teams.rows) {
      const unit = `${leagueId}:${instant}:${team.id}`;
      if (seen.has(unit)) continue;
      try {
        // As of a minute before the kickoff, so the players locking now are
        // still movable; the open Called shot is ignored so its own pair shows
        // up and updates its row.
        const advice = await loadAdvice({
          leagueId, userId: team.owner_id, week, ignoreCalledShot: true, now: new Date(instant - ADVICE_LEAD_MS),
        });
        const standing = (advice.suggestions || []).filter(aboveTossupLine);
        if (standing.length > 0) {
          const ids = [...new Set(standing.flatMap((s) => [s.current.playerId, s.suggested.playerId]))];
          const players = await db.query(`SELECT "id", "nfl_team" FROM "players" WHERE "id" = ANY($1::int[])`, [ids]);
          const locking = new Set(players.rows.filter((p) => nflTeams.has(normalizeNflTeam(p.nfl_team))).map((p) => p.id));
          for (const suggestion of standing) {
            if (!locking.has(suggestion.current.playerId) && !locking.has(suggestion.suggested.playerId)) continue;
            await writeOverride(db, { leagueId, teamId: team.id, season: advice.season, week: advice.week, suggestion, capturedAt: now });
          }
        }
        seen.set(unit, instant); // captured: never asked again, whatever the lineup does next
      } catch (err) {
        firstError = firstError || err; // one team's failure never costs the others their pairs
      }
    }
  }
  if (firstError) throw firstError;
}

/**
 * The Override capture (#1862, ADR 0054 ruling 6), run once per scheduler tick
 * beside the kickoff waiver hold (ADR 0043): for every kickoff the tick sees,
 * each team in a lineup league has every suggestion above the tossup line that
 * involves a locking player written as an Override. `loadAdvice` is the advice
 * loader (the scheduler hands it `startSitAdvice`; this module never requires
 * the decision service). A league's failure is logged and the rest go on; the
 * next tick retries only the units (league, kickoff, team) that failed.
 */
async function captureOverrides({ loadAdvice, db = pool, now = new Date(), seen = capturedUnits }) {
  for (const [unit, instant] of seen) {
    if (instant <= now.getTime() - CAPTURE_LOOKBACK_MS) seen.delete(unit); // out of the window: nothing will ask again
  }
  const leagues = await db.query(
    `SELECT "id", "current_season", "current_week" FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()} AND NOT "best_ball"`
  );
  for (const league of leagues.rows) {
    if (league.current_season == null || league.current_week == null) continue;
    try {
      await captureLeague(db, { league, loadAdvice, now, seen });
    } catch (err) {
      console.error('override capture failed for league %s:', league.id, err.message);
    }
  }
}

module.exports = {
  CalledShotError,
  loadCalledShot,
  loadPublicCalledShot,
  declareCalledShot,
  withdrawCalledShot,
  voidShotContradictedBySave,
  loadSeasonRecord,
  captureOverrides,
  writeOverride,
};
