const pool = require('../modules/pool');
const { notifyLeague } = require('./activity.service');
const { notifyCommissioners } = require('./leagueRole.service');
const { fantasySideWhereSql } = require('./leagueType');

const HOUR_MS = 60 * 60 * 1000;

/**
 * Pure: given a pending league, its current team count, and the current time,
 * decide the single scheduled-draft action that is due right now.
 * Returns one of: 'start', 'auction_unsupported', 'understaffed', 'remind_1h',
 * 'remind_24h', or null.
 *
 * league fields used: draft_status, draft_date, draft_type, min_teams,
 * draft_reminder_stage (0 none / 1 24h / 2 1h), draft_autostart_failed.
 */
function scheduledDraftAction(league, teamCount, now) {
  if (league.draft_status !== 'pending' || !league.draft_date) return null;
  const ms = new Date(league.draft_date).getTime() - now.getTime();
  if (ms <= 0) {
    // Auction drafts have no draft workflow yet — starting would always 501,
    // so don't retry every tick; flag it once like the understaffed case.
    if (league.draft_type === 'auction') {
      return league.draft_autostart_failed ? null : 'auction_unsupported';
    }
    if (teamCount >= league.min_teams) return 'start';
    return league.draft_autostart_failed ? null : 'understaffed';
  }
  if (ms <= HOUR_MS && league.draft_reminder_stage < 2) return 'remind_1h';
  if (ms <= 24 * HOUR_MS && league.draft_reminder_stage < 1) return 'remind_24h';
  return null;
}

/** Best-effort web push to a league's owners who still want draft reminders. */
async function pushDraftAlert(leagueId, ownerIds, { title, body }) {
  try {
    const push = require('./push.service');
    const { usersWanting } = require('./prefs.service');
    const wanting = await usersWanting(ownerIds, 'draftReminders');
    if (wanting.length > 0) {
      await push.sendPushToUsers(wanting, { title, body, url: `/#/league/${leagueId}/draft` });
    }
  } catch (err) {
    console.error('draft push failed for league %s:', leagueId, err.message);
  }
}

/**
 * Scheduler job: for every pending league with a draft_date, run the one due
 * action — auto-start once the minimum is met (notifying the league), send the
 * 24h / 1h reminders once each, or nudge the commissioner once when the time
 * arrives understaffed. Returns the actions taken (for logging/tests).
 */
async function processScheduledDrafts({ now = new Date() } = {}) {
  const leaguesResult = await pool.query(
    `SELECT "id", "name", "owner_id", "draft_status", "draft_date", "draft_type", "min_teams",
            "pick_time_seconds", "draft_reminder_stage", "draft_autostart_failed",
            (SELECT COUNT(*)::int FROM "teams" WHERE "teams"."league_id" = "leagues"."id") AS "team_count"
     FROM "leagues"
     WHERE "draft_status" = 'pending' AND "draft_date" IS NOT NULL
       AND ${fantasySideWhereSql()}`
  );

  const actions = [];
  for (const league of leaguesResult.rows) {
    const action = scheduledDraftAction(league, league.team_count, now);
    if (!action) continue;
    try {
      await runAction(league, action);
      actions.push({ leagueId: league.id, action });
    } catch (err) {
      console.error('scheduled draft %s failed for league %s:', action, league.id, err.message);
    }
  }
  return actions;
}

async function runAction(league, action) {
  // 'start' delegates entirely to draftStart.service's startDraft(), which
  // does its own fresh SELECT ... FOR UPDATE + re-validation — running that
  // under this function's own lock too would have the two connections
  // deadlock on the same league row.
  if (action === 'start') return runStartAction(league);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-read under a row lock so a concurrent join/start/reschedule can't race us.
    const fresh = await client.query(
      `SELECT "draft_status", "draft_date", "draft_type", "min_teams", "draft_reminder_stage",
              "draft_autostart_failed",
              (SELECT COUNT(*)::int FROM "teams" WHERE "teams"."league_id" = "leagues"."id") AS "team_count"
       FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [league.id]
    );
    const row = fresh.rows[0];
    // Recompute against the locked row; bail if the situation changed.
    if (!row || scheduledDraftAction({ ...row, draft_status: row.draft_status }, row.team_count, new Date()) !== action) {
      await client.query('ROLLBACK');
      return;
    }

    if (action === 'understaffed') {
      await client.query(
        `UPDATE "leagues" SET "draft_autostart_failed" = true WHERE "id" = $1`,
        [league.id]
      );
      await notifyCommissioners(client, {
        leagueId: league.id,
        ownerId: league.owner_id,
        type: 'draft_understaffed',
        message: `${league.name} couldn't auto-start: it needs at least ${row.min_teams} teams (has ${row.team_count}).`,
        data: { url: `/#/league/${league.id}` },
      });
    } else if (action === 'auction_unsupported') {
      await client.query(
        `UPDATE "leagues" SET "draft_autostart_failed" = true WHERE "id" = $1`,
        [league.id]
      );
      await notifyCommissioners(client, {
        leagueId: league.id,
        ownerId: league.owner_id,
        type: 'draft_understaffed',
        message: `${league.name} couldn't auto-start: salary-cap auction drafts aren't supported yet. Change the draft type or start it manually once that ships.`,
        data: { url: `/#/league/${league.id}` },
      });
    } else {
      // reminders
      const stage = action === 'remind_1h' ? 2 : 1;
      const when = action === 'remind_1h' ? 'in about an hour' : 'in about 24 hours';
      await client.query(
        `UPDATE "leagues" SET "draft_reminder_stage" = $2 WHERE "id" = $1`,
        [league.id, stage]
      );
      await notifyLeague(client, {
        leagueId: league.id,
        type: 'draft_reminder',
        message: `${league.name}'s draft starts ${when}.`,
        data: { url: `/#/league/${league.id}/draft`, draftDate: league.draft_date },
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Push happens after commit (best-effort, off the critical path).
  if (action === 'remind_24h' || action === 'remind_1h') {
    const owners = await pool.query(`SELECT "owner_id" FROM "teams" WHERE "league_id" = $1`, [league.id]);
    await pushDraftAlert(league.id, owners.rows.map((r) => r.owner_id), {
      title: 'Draft reminder',
      body: `${league.name}'s draft starts ${action === 'remind_1h' ? 'in about an hour' : 'in about 24 hours'}.`,
    });
  }
}

/** The 'start' scheduled action: start the draft, or flag+notify if it can't start right now. */
async function runStartAction(league) {
  const { startDraft } = require('./draftStart.service');
  try {
    await startDraft({ leagueId: league.id, userId: null });
  } catch (err) {
    if (!err.statusCode) throw err;
    // Can't start right now (race lost to a concurrent change, stale
    // overrides/keepers, etc.) — flag it so the scheduler doesn't spin on it
    // every tick, and let the commissioner intervene.
    await pool.query(
      `UPDATE "leagues" SET "draft_autostart_failed" = true WHERE "id" = $1 AND "draft_status" = 'pending'`,
      [league.id]
    );
    await notifyCommissioners(pool, {
      leagueId: league.id,
      ownerId: league.owner_id,
      type: 'draft_understaffed',
      message: `${league.name} couldn't auto-start: ${err.message}`,
      data: { url: `/#/league/${league.id}` },
    });
    return;
  }

  await notifyLeague(pool, {
    leagueId: league.id,
    type: 'draft_starting',
    message: `The draft for ${league.name} is starting now!`,
    data: { url: `/#/league/${league.id}/draft` },
  });
  const owners = await pool.query(`SELECT "owner_id" FROM "teams" WHERE "league_id" = $1`, [league.id]);
  await pushDraftAlert(league.id, owners.rows.map((r) => r.owner_id), {
    title: 'Draft starting now',
    body: `${league.name}'s draft is live. Join the room.`,
  });
}

module.exports = { scheduledDraftAction, processScheduledDrafts };
