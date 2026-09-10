/**
 * The engine-owned Live box poll (#1185, ADR 0035).
 *
 * liveGameEngine's 30-second ESPN tick already knows which games moved: the
 * scoreboard upsert compares each in-progress game's score, quarter and clock
 * against the row it is replacing. Only those games have their Live box
 * fetched (modules/liveBox picks the source) and applied, so halftime and
 * timeouts cost nothing. A league is then re-scored only when a player it
 * rosters changed in that pass, and at most once every 60 seconds per league;
 * the Scoring plays for a league that is inside its floor are accumulated and
 * ride its next run, never dropped.
 *
 * Nothing here spends Tank01 quota unless liveBox is in fallback.
 */
const pool = require('./pool');
const liveBox = require('./liveBox');
const { fantasySeasonLiveWhereSql } = require('../services/leaguePhase');

const RESCORE_FLOOR_MS = 60 * 1000;

/**
 * Pure: which in-progress games moved since the row they replace.
 *
 * @param {Map<string, object>} priorRows tank01_game_id -> the live_game_states
 *   row before this upsert (game_status, current_score_*, quarter,
 *   time_remaining, espn_event_id, final_stats_synced_at)
 * @param {Array<object>} rows normalized rows this tick is writing
 * @returns {Array<{gameId: string, espnEventId: ?string, status: string}>}
 */
function changedGames(priorRows, rows) {
  const out = [];
  for (const row of rows || []) {
    if (!row || row.gameStatus !== 'in_progress') continue;
    const prior = priorRows.get(row.tank01GameId);
    if (prior && prior.final_stats_synced_at) continue; // Final box landed: never again
    const moved =
      !prior ||
      Number(prior.current_score_home) !== Number(row.currentScoreHome) ||
      Number(prior.current_score_away) !== Number(row.currentScoreAway) ||
      (prior.quarter ?? null) !== (row.quarter ?? null) ||
      (prior.time_remaining ?? null) !== (row.timeRemaining ?? null) ||
      prior.game_status !== 'in_progress';
    if (!moved) continue;
    const espnEventId = row.espnEventId != null
      ? String(row.espnEventId)
      : (prior && prior.espn_event_id != null ? String(prior.espn_event_id) : null);
    out.push({ gameId: row.tank01GameId, espnEventId, status: row.gameStatus });
  }
  return out;
}

/**
 * The per-league re-score floor. `collect` notes leagues that need a run and
 * the plays that should ride it; `due(now)` lists the leagues whose floor has
 * passed (or never ran), with their accumulated plays; `markRan` stamps a run.
 */
function createRescoreGate({ floorMs = RESCORE_FLOOR_MS } = {}) {
  const lastRunAt = new Map(); // leagueId -> epoch ms
  const pendingPlays = new Map(); // leagueId -> plays[] (presence = a run is owed)
  return {
    collect(leagueIds, plays) {
      for (const leagueId of leagueIds) {
        const bucket = pendingPlays.get(leagueId) || [];
        bucket.push(...(plays || []));
        pendingPlays.set(leagueId, bucket);
      }
    },
    due(now) {
      const out = [];
      for (const [leagueId, plays] of pendingPlays.entries()) {
        const last = lastRunAt.get(leagueId);
        if (last == null || now - last >= floorMs) out.push({ leagueId, plays });
      }
      return out;
    },
    markRan(leagueId, now) {
      lastRunAt.set(leagueId, now);
      pendingPlays.delete(leagueId);
    },
    pendingCount: () => pendingPlays.size,
  };
}

let gate = createRescoreGate();
const mapsCache = new Map(); // `${season}:${week}` -> { maps, loadedAt }
const MAPS_TTL_MS = 5 * 60 * 1000;

/**
 * Week lookup maps, cached briefly: the pool of known players and DEF units
 * moves slowly, and prevById is kept current by applyGameBoxScore itself.
 */
async function weekMaps({ season, week, now }) {
  const key = `${season}:${week}`;
  const cached = mapsCache.get(key);
  if (cached && now - cached.loadedAt < MAPS_TTL_MS) return cached.maps;
  const scoring = require('../services/scoring.service');
  const maps = await scoring.loadWeekMaps({ season, week });
  mapsCache.set(key, { maps, loadedAt: now });
  return maps;
}

/** Leagues on this (season, week) whose rosters hold any of these players. */
async function leaguesRostering({ playerIds, season, week }) {
  if (!playerIds || playerIds.length === 0) return [];
  const res = await pool.query(
    `SELECT DISTINCT "team_players"."league_id"
       FROM "team_players"
       JOIN "leagues" ON "leagues"."id" = "team_players"."league_id"
      WHERE "team_players"."player_id" = ANY($1::int[])
        AND "leagues"."current_season" = $2 AND "leagues"."current_week" = $3
        AND ${fantasySeasonLiveWhereSql('leagues')}`,
    [playerIds, season, week]
  );
  return res.rows.map((r) => r.league_id);
}

/**
 * One tick's Live box work for one (season, week): fetch and apply the Live box
 * of every changed game, then re-score the leagues that are due.
 *
 * @param {object} args
 * @param {number} args.season
 * @param {number} args.week
 * @param {Array<{gameId, espnEventId, status}>} args.games from changedGames
 * @param {Set<string>} args.finalSyncedGameIds games whose Final box has landed
 * @param {string} [args.quotaMode]
 * @param {number} [args.now]
 * @returns {Promise<{changedPlayerIds: number[], plays: object[], rescored: number[]}>}
 */
async function pollChangedGames({ season, week, games, finalSyncedGameIds, quotaMode, now = Date.now() }) {
  const changedPlayerIds = [];
  const plays = [];
  if (games.length > 0) {
    const maps = await weekMaps({ season, week, now });
    maps.finalSyncedGameIds = finalSyncedGameIds || new Set();
    for (const game of games) {
      try {
        const fetched = await liveBox.fetchLiveBox({
          gameId: game.gameId,
          espnEventId: game.espnEventId,
          inProgress: game.status === 'in_progress',
          now,
          quotaMode,
        });
        if (fetched.skipped || !fetched.liveBox) continue;
        // Snapshot the diff baseline for this game's players so the pass can
        // name exactly which players moved without changing applyGameBoxScore's
        // return shape.
        const before = new Map();
        for (const p of fetched.liveBox.players || []) {
          const id = maps.idByExternal.get(String(p.externalId));
          if (id) before.set(id, JSON.stringify(maps.prevById.get(id) || null));
        }
        for (const teamCode of Object.keys(fetched.liveBox.teamDefense || {})) {
          const unit = maps.defByTeamCode.get(teamCode);
          if (unit) before.set(unit.id, JSON.stringify(maps.prevById.get(unit.id) || null));
        }
        const result = await liveBox.applyLiveBox({ liveBox: fetched.liveBox, season, week, maps });
        if (result.skipped) continue;
        for (const [id, prev] of before.entries()) {
          if (JSON.stringify(maps.prevById.get(id) || null) !== prev) changedPlayerIds.push(id);
        }
        plays.push(...result.plays);
      } catch (err) {
        console.error('liveBoxPoll: Live box failed for %s:', game.gameId, err.message);
      }
    }
  }

  if (changedPlayerIds.length > 0) {
    const leagueIds = await leaguesRostering({ playerIds: changedPlayerIds, season, week });
    gate.collect(leagueIds, plays);
  }

  const rescored = [];
  const due = gate.due(now);
  if (due.length > 0) {
    const scoring = require('../services/scoring.service');
    const scheduler = require('./scheduler');
    for (const { leagueId, plays: leaguePlays } of due) {
      try {
        const { scored } = await scoring.scoreMatchups({ leagueId, season, week, plays: leaguePlays });
        gate.markRan(leagueId, now);
        rescored.push(leagueId);
        await scheduler.alertCloseMatchups({ leagueId, week, scored });
      } catch (err) {
        // Left pending: the next tick retries and the plays are still owed.
        console.error('liveBoxPoll: re-score failed for league %s:', leagueId, err.message);
      }
    }
  }
  return { changedPlayerIds, plays, rescored };
}

module.exports = {
  changedGames,
  createRescoreGate,
  pollChangedGames,
  leaguesRostering,
  RESCORE_FLOOR_MS,
  // test seam
  __resetPollState() {
    gate = createRescoreGate();
    mapsCache.clear();
  },
};
