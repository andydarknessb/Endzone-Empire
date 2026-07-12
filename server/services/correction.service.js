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

/** Pure: is `date` in the NFL stat-correction window (Tuesday or Wednesday)? */
function isCorrectionDay(date = new Date()) {
  const day = date.getDay();
  return day === 2 || day === 3;
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

  const after = await pool.query(
    `SELECT "id", "home_score", "away_score" FROM "matchups"
     WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
    [leagueId, season, week]
  );
  const changes = diffMatchupScores(before.rows, after.rows);
  if (changes.length === 0) return { leagueId, changes };

  const client = await pool.connect();
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
            `matchup(s) in week ${week}. Later rounds were NOT changed automatically — ` +
            `review the bracket with your commissioner tools.`,
          data: { season, week, matchupIds: playoffFlips.map((c) => c.matchupId) },
        });
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // The corrected scores are already committed and a later run won't
    // re-detect them (its "before" snapshot is post-correction) — dump the
    // full change set to the server log so the record isn't lost entirely.
    console.error(
      `stat correction: league ${leagueId} week ${week} scores changed but logging failed;`,
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
 * stats are pulled from RapidAPI once. No-ops without API credentials.
 */
async function resyncPriorWeeks() {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) {
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
  for (const { season, week, leagueIds } of weeks.values()) {
    try {
      await scoring.syncWeekStats({ season, week });
    } catch (err) {
      console.error(`stat correction: sync failed for ${season} week ${week}:`, err.message);
      continue; // don't re-score leagues from stale stats
    }
    for (const leagueId of leagueIds) {
      try {
        const outcome = await correctLeagueWeek({ leagueId, season, week });
        if (outcome.changes.length > 0) results.push(outcome);
      } catch (err) {
        console.error(`stat correction failed for league ${leagueId}:`, err.message);
      }
    }
  }
  return { corrected: results };
}

module.exports = {
  isCorrectionDay,
  diffMatchupScores,
  correctLeagueWeek,
  resyncPriorWeeks,
};
