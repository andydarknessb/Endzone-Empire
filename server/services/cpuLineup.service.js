/**
 * The CPU manager: sets the lineup of every CPU-managed team (owner_id NULL,
 * a banned manager's team after the draft, commissioner.service's banTeam).
 *
 * Run by the scheduler every tick (`cpu-lineups`). For each such team in a
 * live, non-best-ball fantasy league it materializes the current week, then
 * starts the best legal lineup by this league's projections: kicked-off
 * starters keep their slot and kicked-off bench players stay put (heldLineup),
 * an unavailable player (out, bye) is never started, IR is never touched.
 * Only rows whose slot changes are written, so a settled lineup costs a read
 * and no write. A lineup the validator would refuse is left alone and logged:
 * the CPU never forces a save a manager could not make.
 */
const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
const lineupService = require('./lineup.service');
const { optimalLineup } = require('./lineupOptimizer');

const BENCH = 'BENCH';
const IR = 'IR';

// A player with no projection is worth a token amount: he beats an empty slot
// but loses to anyone with a real estimate.
const UNPROJECTED_POINTS = 0.01;

/**
 * Pure: the slot changes that turn `entries` into the best legal lineup.
 *
 * entries: [{ playerId, position, slot, locked }]
 * pointsOf: playerId -> { unavailable, points }
 * Returns [{ playerId, slot }] for every movable player whose slot changes.
 */
function planCpuLineup({ entries, rosterSlots, pointsOf }) {
  const { pinned, candidates } = lineupService.heldLineup(entries);
  const pointsFor = new Map();
  const startable = [];
  for (const candidate of candidates) {
    const verdict = pointsOf(candidate.playerId) || {};
    if (verdict.unavailable) continue;
    pointsFor.set(candidate.playerId, verdict.points == null ? UNPROJECTED_POINTS : verdict.points);
    startable.push(candidate);
  }
  const { byPlayer } = optimalLineup({ rosterSlots, candidates: startable, pointsFor, pinned });
  const moves = [];
  for (const entry of entries) {
    if (entry.slot === IR || entry.locked) continue;
    const slot = byPlayer.get(entry.playerId) || BENCH;
    if (slot !== entry.slot) moves.push({ playerId: entry.playerId, slot });
  }
  return moves;
}

/** Set one CPU team's current-week lineup. Returns the number of rows moved. */
async function setCpuTeamLineup(client, { league, teamId, now, projections }) {
  const season = league.current_season;
  const week = league.current_week;
  await lineupService.materializeLineup(client, { leagueId: league.id, teamId, season, week, league });
  const rowsResult = await client.query(
    `SELECT "lineup_entries"."player_id", "lineup_entries"."slot",
            "players"."position", "players"."nfl_team"
     FROM "lineup_entries"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
       AND "team_players"."player_id" = "lineup_entries"."player_id"
     WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
       AND "lineup_entries"."week" = $3`,
    [teamId, season, week]
  );
  const rows = rowsResult.rows;
  if (rows.length === 0) return 0;

  const locked = await lineupService.lockedPlayerIds(client, {
    season,
    week,
    now,
    players: rows.map((r) => ({ id: r.player_id, nflTeam: r.nfl_team })),
  });
  const entries = rows.map((r) => ({
    playerId: r.player_id,
    position: r.position,
    slot: r.slot,
    locked: locked.has(r.player_id),
  }));
  const run = await projections.getWeeklyProjections({
    season,
    week,
    league,
    playerIds: rows.map((r) => r.player_id),
  });
  const settings = lineupService.parseLineupSettings(league);
  const moves = planCpuLineup({
    entries,
    rosterSlots: settings.rosterSlots,
    pointsOf: (playerId) => run.classify(playerId),
  });
  if (moves.length === 0) return 0;

  const slotOf = new Map(moves.map((m) => [m.playerId, m.slot]));
  const spent = await lineupService.spentStartingSlots(client, { teamId, season, week });
  const errors = lineupService.validateLineup(
    entries.map((e) => ({ playerId: e.playerId, position: e.position, slot: slotOf.get(e.playerId) || e.slot })),
    { ...settings, baseline: rows.map((r) => ({ player_id: r.player_id, slot: r.slot })), spent }
  );
  if (errors.length > 0) {
    console.warn('cpu lineup for team %s refused: %s', teamId, errors.join('; '));
    return 0;
  }
  for (const move of moves) {
    await client.query(
      `UPDATE "lineup_entries" SET "slot" = $1, "updated_at" = now()
       WHERE "team_id" = $2 AND "season" = $3 AND "week" = $4 AND "player_id" = $5`,
      [move.slot, teamId, season, week, move.playerId]
    );
  }
  return moves.length;
}

/**
 * The scheduler job: every CPU team in every live lineup league. A team's
 * failure is logged and the rest go on; the next tick retries it.
 */
async function setCpuLineups({ db = pool, now = new Date(), projections = require('./projection.service') } = {}) {
  const teams = await db.query(
    `SELECT "teams"."id" AS "team_id", "leagues".*
     FROM "teams" JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
     WHERE "teams"."owner_id" IS NULL
       AND ${fantasySeasonLiveWhereSql('leagues')} AND NOT "leagues"."best_ball"`
  );
  let moved = 0;
  for (const row of teams.rows) {
    const { team_id: teamId, ...league } = row;
    if (league.current_season == null || league.current_week == null) continue;
    try {
      moved += await withTransaction(
        db,
        (client) => setCpuTeamLineup(client, { league, teamId, now, projections }),
        { label: 'cpu-lineup' }
      );
    } catch (err) {
      console.error('cpu lineup failed for team %s:', teamId, err.message);
    }
  }
  return { teams: teams.rows.length, moved };
}

module.exports = { planCpuLineup, setCpuTeamLineup, setCpuLineups };
