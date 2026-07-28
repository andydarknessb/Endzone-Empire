const pool = require('../modules/pool');
const scoring = require('./scoring.service');
const { logTransaction, notify, notifyLeague } = require('./activity.service');

/**
 * Stat corrections: the NFL routinely adjusts box scores on Tuesday/Wednesday
 * after games. This service re-pulls a past week's stats and re-scores every
 * affected league, then reports what changed.
 *
 * Deliberately narrow: it re-runs stat sync and scoring ONLY. Waiver
 * processing and playoff advancement are never invoked from here — a
 * correction that flips a settled playoff result is surfaced to the
 * commissioner (who can rebuild the bracket with their tools) rather than
 * silently rewriting rounds that teams already played.
 */

const CORRECTION_WINDOW_ERROR = Object.freeze({
  code: 'CORRECTION_WINDOW_EXPIRED',
  message: 'Manual score modifications for this week are locked.',
});

class CorrectionWindowError extends Error {
  constructor() {
    super(CORRECTION_WINDOW_ERROR.message);
    this.name = 'CorrectionWindowError';
    this.code = CORRECTION_WINDOW_ERROR.code;
    this.statusCode = 403;
  }
}

/** Parse only unambiguous instants. Client-local timestamps without a UTC offset are rejected. */
function correctionInstant(timestamp) {
  if (timestamp === undefined) return new Date();
  if (
    typeof timestamp === 'string' &&
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)
  ) {
    throw new CorrectionWindowError();
  }
  const instant = timestamp instanceof Date
    ? new Date(timestamp.getTime())
    : new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) throw new CorrectionWindowError();
  return instant;
}

/** Pure: is `timestamp` in the UTC Tuesday/Wednesday correction window? */
function isCorrectionDay(timestamp) {
  const day = correctionInstant(timestamp).getUTCDay();
  return day === 2 || day === 3;
}

/**
 * Fail-closed authorization for manual corrections. The active season/week
 * must come from the league row, never request data. `timestamp` exists for
 * deterministic tests and trusted callers; the HTTP route always uses the
 * server clock.
 */
function assertManualCorrectionWindow({
  requestedSeason,
  requestedWeek,
  activeSeason,
  activeWeek,
  timestamp,
}) {
  const values = [requestedSeason, requestedWeek, activeSeason, activeWeek].map(Number);
  if (!values.every(Number.isInteger)) throw new CorrectionWindowError();
  const [requestSeason, requestWeek, leagueSeason, leagueWeek] = values;
  const immediatePastWeek = leagueWeek - 1;
  const checkedAt = correctionInstant(timestamp);
  const targetsImmediatePastWeek =
    leagueWeek > 1 &&
    requestSeason === leagueSeason &&
    requestWeek === immediatePastWeek;

  if (!targetsImmediatePastWeek || !isCorrectionDay(checkedAt)) {
    throw new CorrectionWindowError();
  }

  return {
    activeSeason: leagueSeason,
    activeWeek: leagueWeek,
    correctionWeek: immediatePastWeek,
    checkedAt,
  };
}

/**
 * Pure: compare a week's matchup rows before/after a re-score.
 * Returns one entry per matchup whose score moved:
 *   { matchupId, week, final, isPlayoff, before: {home, away},
 *     after: {home, away}, winnerFlipped }
 * winnerFlipped covers win<->loss in either direction and tie<->win/loss.
 */
function diffMatchupScores(before, after) {
  const afterById = new Map(after.map((m) => [m.id, m]));
  const changes = [];
  for (const prev of before) {
    const next = afterById.get(prev.id);
    if (!next) continue;
    const b = { home: Number(prev.home_score), away: Number(prev.away_score) };
    const a = { home: Number(next.home_score), away: Number(next.away_score) };
    if (b.home === a.home && b.away === a.away) continue;
    changes.push({
      matchupId: prev.id,
      week: prev.week,
      final: Boolean(prev.final),
      isPlayoff: Boolean(prev.is_playoff),
      before: b,
      after: a,
      winnerFlipped: Math.sign(b.home - b.away) !== Math.sign(a.home - a.away),
    });
  }
  return changes;
}

/**
 * Re-score one league week (stats must already be synced) and record any
 * changes: a transaction-log entry plus a league-wide notification, and a
 * commissioner alert when a settled playoff result flipped.
 */
async function correctLeagueWeek({ leagueId, season, week }) {
  const before = await pool.query(
    `SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"
     FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
    [leagueId, season, week]
  );
  if (before.rows.length === 0) return { leagueId, changes: [] };

  await scoring.scoreMatchups({ leagueId, season, week });

  let after;
  try {
    after = await pool.query(
      `SELECT "id", "home_score", "away_score" FROM "matchups"
       WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
      [leagueId, season, week]
    );
  } catch (error) {
    // Scores have committed. Retrying the whole correction would replace the
    // original before-snapshot and could hide a correction from the audit log.
    error.retrySafe = false;
    throw error;
  }
  const changes = diffMatchupScores(before.rows, after.rows);
  if (changes.length === 0) return { leagueId, changes };

  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    // Scores already committed above; replaying would lose the before-snapshot.
    error.retrySafe = false;
    throw error;
  }
  try {
    await client.query('BEGIN');
    await logTransaction(client, {
      leagueId,
      type: 'stat_correction',
      detail: { season, week, changes },
    });
    await notifyLeague(client, {
      leagueId,
      type: 'stat_correction',
      message: `Week ${week} scores were updated after an NFL stat correction.`,
      data: { season, week, matchupIds: changes.map((c) => c.matchupId) },
    });

    const playoffFlips = changes.filter((c) => c.final && c.isPlayoff && c.winnerFlipped);
    if (playoffFlips.length > 0) {
      const ownerResult = await client.query(
        `SELECT "owner_id" FROM "leagues" WHERE "id" = $1`,
        [leagueId]
      );
      if (ownerResult.rows[0]) {
        await notify(client, {
          userId: ownerResult.rows[0].owner_id,
          leagueId,
          type: 'stat_correction',
          message:
            `A stat correction flipped the result of ${playoffFlips.length} settled playoff ` +
            `matchup(s) in week ${week}. Later rounds were NOT changed automatically. ` +
            `Review the bracket with your commissioner tools.`,
          data: { season, week, matchupIds: playoffFlips.map((c) => c.matchupId) },
        });
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    error.retrySafe = false;
    // The corrected scores are already committed and a later run won't
    // re-detect them (its "before" snapshot is post-correction) — dump the
    // full change set to the server log so the record isn't lost entirely.
    console.error(
      'stat correction: league %s week %s scores changed but logging failed;',
      leagueId,
      week,
      JSON.stringify(changes)
    );
    throw error;
  } finally {
    client.release();
  }
  return { leagueId, changes };
}

/**
 * Scheduler entry point: re-sync last week's stats and re-score it for every
 * in-season league. Groups leagues by (season, prior week) so each week's
 * stats are pulled once.
 *
 * The source is nflverse, not Tank01 — free, and by Tuesday it's the better
 * data (nflverse publishes nightly, "cleanest by Thursday", and the NFL's own
 * stat corrections land there). The Tank01-based re-sync stays reachable
 * through the manual admin/commissioner correction route for anyone who wants
 * to spend quota on demand; scheduled corrections no longer do.
 *
 * @param {{source?: 'nflverse'|'tank01'}} [opts]
 */
async function resyncPriorWeeks({ source = 'nflverse' } = {}) {
  if (source === 'tank01' && (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST)) {
    return { skipped: 'RapidAPI credentials not configured' };
  }
  const leaguesResult = await pool.query(
    `SELECT "id", "current_season", "current_week" FROM "leagues"
     WHERE "draft_status" = 'complete' AND "season_status" != 'complete' AND "current_week" > 1`
  );
  const weeks = new Map(); // 'season:week' -> { season, week, leagueIds }
  for (const league of leaguesResult.rows) {
    const week = league.current_week - 1;
    const key = `${league.current_season}:${week}`;
    if (!weeks.has(key)) weeks.set(key, { season: league.current_season, week, leagueIds: [] });
    weeks.get(key).leagueIds.push(league.id);
  }

  const results = [];
  const cacheFailures = [];
  for (const { season, week, leagueIds } of weeks.values()) {
    try {
      if (source === 'nflverse') {
        // Lazy require: nflverseSync requires this module at load time.
        const nflverseSync = require('./nflverseSync.service');
        // League re-scoring happens per-league below, through the same
        // correctLeagueWeek path, so skip its own re-score loop.
        await nflverseSync.correctWeekFromNflverse({ season, week, rescoreLeagues: false });
      } else {
        await scoring.syncWeekStats({ season, week });
      }
    } catch (err) {
      console.error('stat correction: sync failed for %s week %s:', season, week, err.message);
      continue; // don't re-score leagues from stale stats
    }
    // Corrected stats shift season averages, so every LATER week's cached
    // projections were computed from history that no longer exists. There are
    // TWO caches and they need opposite treatment:
    //
    //  1. `player_projections` (legacy, pool-wide, default scoring) has a
    //     refresh path and is cheap to rebuild for the whole pool at once.
    //  2. `projection_runs` + `player_week_projections` (the versioned engine)
    //     is per-scoring-profile and per-player. Regenerating it here would
    //     mean enumerating every league's scoring profile and every league's
    //     roster, so it is INVALIDATED instead — from week+1 THROUGH THE END
    //     OF THE SEASON, because the advice API caches arbitrary future weeks
    //     — and rebuilt lazily by whoever asks next. Without this it was never
    //     invalidated at all: corrected stats moved the legacy numbers while
    //     the start/sit engine kept serving pre-correction ones.
    //
    // Both run ONCE per corrected (season, week) — this loop is already keyed
    // that way — not once per league, and neither failing is allowed to skip
    // the other or the league corrections below, so failures are RECORDED
    // rather than thrown here and surfaced as one aggregate error after the
    // whole pass finishes (see the end of this function).
    const nextWeek = week + 1;
    const projection = require('./projection.service');
    try {
      await projection.getWeekProjections({ season, week: nextWeek, refresh: true });
    } catch (err) {
      console.error(
        'stat correction: legacy projection refresh failed for %s week %s:',
        season,
        nextWeek,
        err.message
      );
      cacheFailures.push({ op: 'legacy refresh', season, week: nextWeek, message: err.message });
    }
    try {
      await projection.invalidateWeeklyProjectionRuns({ season, fromWeek: nextWeek });
    } catch (err) {
      console.error(
        'stat correction: weekly projection cache invalidation failed for %s week %s:',
        season,
        nextWeek,
        err.message
      );
      cacheFailures.push({ op: 'run invalidation', season, week: nextWeek, message: err.message });
    }
    for (const leagueId of leagueIds) {
      try {
        const outcome = await correctLeagueWeek({ leagueId, season, week });
        if (outcome.changes.length > 0) results.push(outcome);
      } catch (err) {
        console.error('stat correction failed for league %s:', leagueId, err.message);
      }
    }
  }
  // Cache maintenance failures surface AFTER the whole pass so the scheduler's
  // stamp-only-on-success design actually covers them: swallowing one here
  // would mark the correction day complete with stale projection rows still
  // being served, and the five-minute retry the scheduler documents would
  // never fire. Every week's sync, cache work and league corrections have
  // already run by this point, so the retry the throw buys re-enters an
  // idempotent pass.
  if (cacheFailures.length > 0) {
    const summary = cacheFailures
      .map((f) => `${f.op} (${f.season} week ${f.week}): ${f.message}`)
      .join('; ');
    const err = new Error(
      `stat correction: ${cacheFailures.length} projection cache maintenance operation(s) failed — ${summary}`
    );
    err.cacheFailures = cacheFailures;
    err.corrected = results;
    throw err;
  }
  return { corrected: results };
}

module.exports = {
  CORRECTION_WINDOW_ERROR,
  CorrectionWindowError,
  correctionInstant,
  isCorrectionDay,
  assertManualCorrectionWindow,
  diffMatchupScores,
  correctLeagueWeek,
  resyncPriorWeeks,
};
