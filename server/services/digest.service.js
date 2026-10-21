const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { deliverEmail } = require('./account.service');
const { notify } = require('./activity.service');
const { usersWanting } = require('./prefs.service');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
// The lineup and Pick'em verdicts live in homeStatus.service so the Home
// to-do list, the league cards and the reminders read the same answers
// (Home v2): a reminder goes out only when the status Home reads has
// something to fix.
const {
  lineupEntryFromRow,
  lineupStatus,
  loadWeekKickoffs,
  picksMadeByUser,
  pickemStatus,
} = require('./homeStatus.service');

/**
 * Email/notification digests: pre-lockout lineup reminders, waiver-results
 * summaries, and the weekly recap. Every send filters recipients through
 * notification_prefs (opt-out model) and rides account.service.deliverEmail,
 * which falls back to console logging without SMTP_URL — so digests are
 * always safe to fire.
 */

function appOrigin() {
  return process.env.APP_ORIGIN || 'http://localhost:3000';
}

/** Email the stored weekly recap to league members who want it. */
async function sendWeeklyRecapDigest({ leagueId, season, week }) {
  const recapResult = await pool.query(
    `SELECT "data" FROM "league_analytics"
     WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "type" = 'weekly_recap'`,
    [leagueId, season, week]
  );
  const recap = recapResult.rows[0] && recapResult.rows[0].data;
  if (!recap || !recap.narrative) return { sent: 0 };

  const members = await pool.query(
    `SELECT DISTINCT "users"."id", "users"."email", "leagues"."name" AS "league_name"
     FROM "teams"
     JOIN "users" ON "users"."id" = "teams"."owner_id"
     JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
     WHERE "teams"."league_id" = $1`,
    [leagueId]
  );
  if (members.rows.length === 0) return { sent: 0 };
  const wanted = new Set(await usersWanting(members.rows.map((m) => m.id), 'weeklyRecap'));

  let sent = 0;
  for (const member of members.rows) {
    if (!wanted.has(member.id)) continue;
    try {
      await deliverEmail({
        to: member.email,
        subject: `Week ${week} recap: ${member.league_name}`,
        text: `${recap.narrative}\n\nFull standings and matchups: ${appOrigin()}/#/league/${leagueId}`,
      });
    } catch (error) {
      console.error('weekly recap email failed for user %s:', member.id, error.message);
      continue;
    }
    sent += 1;
  }
  return { sent };
}

/**
 * Summarize just-resolved waiver claims per owner. Called right after a
 * league's waivers process; the push (pushAlerts.service, 'waiver-results')
 * owns the claims query and the digest window, and each owner it pushed to
 * gets the email.
 */
async function sendWaiverResultsDigest({ leagueId }) {
  const { sendAlert } = require('./pushAlerts.service');
  const { fresh } = await sendAlert({ kind: 'waiver-results', leagueId });
  let sent = 0;
  for (const { userId, email, leagueName, lines } of fresh) {
    // The push ledger row is already written, so a failed email is never retried: log and move on.
    try {
      await deliverEmail({
        to: email,
        subject: `Waiver results: ${leagueName}`,
        text: `Your waiver claims cleared:\n\n${lines.join('\n')}\n\n${appOrigin()}/#/league/${leagueId}/waivers`,
      });
    } catch (error) {
      console.error('waiver results email failed for user %s:', userId, error.message);
      continue;
    }
    sent += 1;
  }
  return { sent };
}

/**
 * Pre-lockout lineup reminders: when a league's current week has an NFL game
 * kicking off within the next 2 hours, warn owners whose lineups have empty
 * starting slots, starters who are Out/IR/on bye, or unresolved IR stashes.
 */
async function sendLineupReminders() {
  const leagues = await pool.query(
    `SELECT * FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()}`
  );
  let remindersSent = 0;

  for (const league of leagues.rows) {
    const { id: leagueId, current_season: season, current_week: week } = league;
    const upcoming = await pool.query(
      `SELECT 1 FROM "nfl_games"
       WHERE "season" = $1 AND "week" = $2
         AND "kickoff_at" BETWEEN now() AND now() + interval '2 hours'
       LIMIT 1`,
      [season, week]
    );
    if (!upcoming.rows[0]) continue;

    const { materializeLineup, parseLineupSettings } = require('./lineup.service');
    const { rosterSlots } = parseLineupSettings(league);
    // The week's kickoffs, read once for the league and week (not per Team):
    // the status drops what a kicked-off game has locked, as Home does.
    const kickoffs = await loadWeekKickoffs(pool, { weeks: [{ season, week }] });
    const weekKickoffs = kickoffs.values().next().value;

    const teams = await pool.query(
      `SELECT "teams"."id", "teams"."name", "teams"."owner_id", "users"."email"
       FROM "teams" JOIN "users" ON "users"."id" = "teams"."owner_id"
       WHERE "teams"."league_id" = $1`,
      [leagueId]
    );
    const wanted = new Set(
      await usersWanting(teams.rows.map((t) => t.owner_id), 'lineupReminder')
    );

    for (const team of teams.rows) {
      if (!wanted.has(team.owner_id)) continue;

      // withTransaction owns connect/BEGIN/COMMIT-or-guarded-ROLLBACK and the
      // release rule (ADR 0033). This is the lineup transaction whose catch
      // rethrows; the notify-only sub-transaction lower in this function is the
      // swallow-at-the-call-site shape (#1072), also routed through the wrapper
      // with its log-and-continue in a catch here. No early return and no
      // catch-side mapping.
      const entriesResult = await withTransaction(
        pool,
        async (lineupClient) => {
        await materializeLineup(lineupClient, { leagueId, teamId: team.id, season, week, league });
        // The rows carry no availability fact: the Start verdict comes from the
        // Weekly projection read below (ADR 0061).
        return lineupClient.query(
          `SELECT "lineup_entries"."slot", "lineup_entries"."player_id", "lineup_entries"."ir_attested",
                  "players"."name", "players"."injury_status", "players"."nfl_team",
                  ("team_players"."player_id" IS NULL) AS "spent"
           FROM "lineup_entries"
           LEFT JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
             AND "team_players"."player_id" = "lineup_entries"."player_id"
           JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
           WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
             AND "lineup_entries"."week" = $3
             AND ("team_players"."player_id" IS NOT NULL
               OR "lineup_entries"."slot" NOT IN ('BENCH', 'IR'))`,
          [team.id, season, week]
        );
        },
        { label: 'reminders' }
      );
      const entries = entriesResult.rows.map((row) => ({
        ...lineupEntryFromRow(row), nflTeam: row.nfl_team,
      }));
      // The Start verdict (ADR 0061), from the Weekly projection read. Without
      // it the team's availability is unknown, so the tick skips the team (a
      // fail-closed read, like the ledger below) and the next tick retries.
      let weekly;
      try {
        weekly = await require('./projection.service').getWeeklyProjections({
          season, week, league, playerIds: entries.map((e) => e.playerId),
        });
      } catch (err) {
        console.error('lineup reminder: weekly projection read failed, skipping team:', team.id, err.message);
        continue;
      }
      const { problems } = lineupStatus({
        entries,
        rosterSlots,
        bestBall: Boolean(league.best_ball),
        startVerdictFor: (playerId) => weekly.startVerdictFor(playerId),
        kickoffByTeam: weekKickoffs.byTeam,
        weekLastKickoff: weekKickoffs.last,
        now: new Date(),
      });
      if (problems.length === 0) continue;

      // One reminder per team-week, held by the push_events ledger (so a
      // restart or a second instance does not re-remind). A skipped push means
      // this team-week was already reminded, so the notification and email
      // below are skipped with it. sendAlert never throws; a ledger error leaves
      // fresh empty, so the tick is skipped and the next one retries, rather
      // than re-sending the email on every tick of the 2-hour window.
      const message = `Lineup check for week ${week}: ${problems.join('; ')}`;
      try {
        const { sendAlert } = require('./pushAlerts.service');
        const { fresh } = await sendAlert({ kind: 'lineup-reminder', leagueId, team, season, week, problems });
        if (fresh.length === 0) continue;
      } catch (err) {
        console.error('lineup reminder push failed:', err.message);
        continue;
      }
      remindersSent += 1;
      // Notify-only, best-effort: the swallow sits here at the call site around
      // withTransaction (ADR 0033, #1072). The ROLLBACK was unguarded before, so
      // a rejecting rollback escaped this swallow and aborted the whole digest
      // run; the wrapper now contains it (destroying the connection), which is
      // the log-and-continue this catch always intended. A connect failure now
      // reaches this catch too (the checkout moved inside the wrapper) and is
      // swallowed the same way, which is correct for best-effort nudging.
      try {
        await withTransaction(
          pool,
          (client) =>
            notify(client, {
              userId: team.owner_id,
              leagueId,
              type: 'lineup_reminder',
              message,
            }),
          { label: 'lineup-reminder-notify' }
        );
      } catch (error) {
        console.error('lineup reminder notification failed:', error.message);
      }
      try {
        await deliverEmail({
          to: team.email,
          subject: `Set your lineup before kickoff (${team.name})`,
          text: `${message}\n\nFix it here: ${appOrigin()}/#/league/${leagueId}/lineup`,
        });
      } catch (error) {
        console.error('lineup reminder email failed for team %s:', team.id, error.message);
      }
    }
  }
  return { remindersSent };
}

/**
 * Pre-kickoff Pick'em reminders: when a Pick'em-enabled league's current week
 * has an NFL game kicking off within the next 2 hours, nudge members who still
 * have unpicked games that HAVEN'T locked yet. Games already past kickoff are
 * excluded — there is nothing left for the manager to do about those.
 */
async function sendPickemReminders() {
  let leagues;
  try {
    // A pick'em job, not a fantasy weekly job: it selects every pick'em-enabled
    // league (fantasy-with-pick'em and pick'em-only alike) whose season is
    // still going, so the fantasy "season live" phase fragment does not apply.
    leagues = await pool.query(
      `SELECT "leagues"."id", "leagues"."name",
              "leagues"."current_season" AS "season", "leagues"."current_week" AS "week"
         FROM "leagues"
         JOIN "pickem_settings" ON "pickem_settings"."league_id" = "leagues"."id"
        WHERE "pickem_settings"."enabled" = true
          AND "leagues"."season_status" != 'complete'`
    );
  } catch (error) {
    // undefined_table: the Pick'em migration hasn't been applied to this
    // database yet. Nothing to remind anyone about, and the scheduler tick
    // shouldn't log an error every minute until it is.
    if (error && error.code === '42P01') return { remindersSent: 0 };
    throw error;
  }
  let remindersSent = 0;

  for (const league of leagues.rows) {
    const upcoming = await pool.query(
      `SELECT 1 FROM "nfl_games"
       WHERE "season" = $1 AND "week" = $2
         AND "kickoff_at" BETWEEN now() AND now() + interval '2 hours'
       LIMIT 1`,
      [league.season, league.week]
    );
    if (!upcoming.rows[0]) continue;

    const pickem = require('./pickem.service');
    const slate = await pickem.getWeekSlate({ season: league.season, week: league.week });
    const now = new Date();
    // Nothing open in the slate (every game at or past kickoff): nothing to nudge.
    if (pickemStatus({ slate, now }).missing === 0) continue;

    const members = await pool.query(
      `SELECT "teams"."owner_id", "users"."email"
         FROM "teams" JOIN "users" ON "users"."id" = "teams"."owner_id"
        WHERE "teams"."league_id" = $1`,
      [league.id]
    );
    const stored = await pool.query(
      `SELECT "user_id", "team_pair" FROM "pickem_picks"
        WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
      [league.id, league.season, league.week]
    );
    const madeByUser = picksMadeByUser(stored.rows);

    for (const member of members.rows) {
      const { missing } = pickemStatus({ slate, made: madeByUser.get(member.owner_id), now });
      if (missing === 0) continue; // fully picked

      // One reminder per (league, user, week), held by the push_events ledger.
      // A skipped push means this week was already reminded (or the user opted
      // out), so the notification and email below are skipped with it.
      const { fresh } = await require('./pushAlerts.service').sendAlert({ kind: 'pickem-reminder', league, member, missing });
      if (fresh.length === 0) continue;

      remindersSent += 1;
      const message =
        `Week ${league.week} Pick'em: ${missing} game` +
        `${missing === 1 ? '' : 's'} still unpicked before kickoff.`;
      // Notify-only, best-effort: the swallow sits here at the call site around
      // withTransaction (ADR 0033, #1072). The ROLLBACK was unguarded before, so
      // a rejecting rollback escaped this swallow and aborted the whole digest
      // run; the wrapper now contains it (destroying the connection), which is
      // the log-and-continue this catch always intended. A connect failure now
      // reaches this catch too (the checkout moved inside the wrapper) and is
      // swallowed the same way, which is correct for best-effort nudging.
      try {
        await withTransaction(
          pool,
          (client) =>
            notify(client, {
              userId: member.owner_id,
              leagueId: league.id,
              type: 'pickem_reminder',
              message,
            }),
          { label: 'pickem-reminder-notify' }
        );
      } catch (error) {
        console.error("pick'em reminder notification failed:", error.message);
      }
      try {
        await deliverEmail({
          to: member.email,
          subject: `Pick'em picks due: ${league.name}`,
          text: `${message}\n\nMake them here: ${appOrigin()}/#/league/${league.id}/pickem`,
        });
      } catch (error) {
        console.error("pick'em reminder email failed for user %s:", member.owner_id, error.message);
      }
    }
  }
  return { remindersSent };
}

module.exports = {
  sendWeeklyRecapDigest,
  sendWaiverResultsDigest,
  sendLineupReminders,
  sendPickemReminders,
};
