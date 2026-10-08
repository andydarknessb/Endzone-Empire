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
const { nflRosterStatusColumn } = require('./nflRosterStatus');

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
    await deliverEmail({
      to: member.email,
      subject: `Week ${week} recap: ${member.league_name}`,
      text: `${recap.narrative}\n\nFull standings and matchups: ${appOrigin()}/#/league/${leagueId}`,
    });
    sent += 1;
  }
  return { sent };
}

// Per-league watermark so staggered waiver clears within the same hour don't
// re-email already-digested claims. In-process: a restart falls back to the
// 1-hour lookback, worst case repeating one recent digest.
//
// The watermark is a JS Date, which is MILLISECOND precision; processed_at is
// timestamptz, which is MICROSECOND precision. pg hands the row back already
// truncated, so a plain `processed_at > $watermark` re-selects the very claim
// the watermark was advanced to (03:09:53.450243 > 03:09:53.450) on every
// scheduler tick, and the manager gets the same "WON" email every five
// minutes until the worker restarts (66 copies, 2026-09-02). The query
// truncates its side to milliseconds too so both sides compare at the same
// precision; a claim sharing the newest claim's millisecond is in the same
// batch, so nothing falls through the gap.
const lastWaiverDigestAt = new Map();

/**
 * Summarize just-resolved waiver claims per owner. Called right after a
 * league's waivers process; only claims resolved since the league's last
 * digest are included.
 */
async function sendWaiverResultsDigest({ leagueId }) {
  const since =
    lastWaiverDigestAt.get(leagueId) || new Date(Date.now() - 60 * 60 * 1000);
  const claims = await pool.query(
    `SELECT "waiver_claims"."status", "waiver_claims"."note", "waiver_claims"."bid",
            "waiver_claims"."processed_at",
            "players"."name" AS "player_name",
            "teams"."owner_id", "users"."email", "leagues"."name" AS "league_name"
     FROM "waiver_claims"
     JOIN "teams" ON "teams"."id" = "waiver_claims"."team_id"
     JOIN "users" ON "users"."id" = "teams"."owner_id"
     JOIN "players" ON "players"."id" = "waiver_claims"."player_id"
     JOIN "leagues" ON "leagues"."id" = "waiver_claims"."league_id"
     WHERE "waiver_claims"."league_id" = $1
       AND "waiver_claims"."status" IN ('won', 'lost')
       AND date_trunc('milliseconds', "waiver_claims"."processed_at") > $2`,
    [leagueId, since]
  );
  if (claims.rows.length === 0) return { sent: 0 };
  // Advance to the newest digested claim (not now()) so nothing processed
  // between this query and the watermark write can slip through the gap.
  const newest = claims.rows.reduce(
    (max, r) => (new Date(r.processed_at) > max ? new Date(r.processed_at) : max),
    since
  );
  lastWaiverDigestAt.set(leagueId, newest);

  const byOwner = new Map();
  for (const row of claims.rows) {
    if (!byOwner.has(row.owner_id)) {
      byOwner.set(row.owner_id, { email: row.email, leagueName: row.league_name, lines: [] });
    }
    const bid = Number(row.bid) > 0 ? ` ($${row.bid})` : '';
    byOwner.get(row.owner_id).lines.push(
      row.status === 'won'
        ? `WON: ${row.player_name}${bid}`
        : `LOST: ${row.player_name}${bid}${row.note ? ` · ${row.note}` : ''}`
    );
  }
  const wanted = new Set(await usersWanting([...byOwner.keys()], 'waiverResults'));

  let sent = 0;
  for (const [ownerId, { email, leagueName, lines }] of byOwner) {
    if (!wanted.has(ownerId)) continue;
    await deliverEmail({
      to: email,
      subject: `Waiver results: ${leagueName}`,
      text: `Your waiver claims cleared:\n\n${lines.join('\n')}\n\n${appOrigin()}/#/league/${leagueId}/waivers`,
    });
    try {
      const push = require('./push.service');
      await push.sendPushToUsers([ownerId], {
        title: `Waiver results: ${leagueName}`,
        body: lines.join(' · '),
        url: `/#/league/${leagueId}/waivers`,
      });
    } catch (err) {
      console.error('waiver results push failed:', err.message);
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
        // `on_bye` is read off the LEFT JOIN, so the join predicate IS the
        // bye rule here. `nfl_games` keys teams by Tank01 abbreviation (DEN,
        // WSH) while `players.nfl_team` holds a FULL TEAM NAME for every DEF
        // unit and the app's own WAS for Washington, so raw equality never
        // matched a DEF unit and told the manager his defense was on bye in
        // all 17 weeks it plays (#287). `fn_normalize_nfl_team` on BOTH sides is
        // the same fold `bye.service.computeByeWeeks` uses, and the functional
        // index `idx_players_nfl_team_normalized` backs the players side.
        // This is a SQL join, so it normalises in SQL; `services/nflTeam.js`
        // is for consumers that have already read a side into memory.
        // A WAS row beside a WSH row would make this LEFT JOIN fold two Raw
        // team codes into one Team code; `nfl_games_season_week_team_code_unique`
        // (ADR 0011, #421) makes that second row a rejected insert, not a case
        // this query has to survive.
        // `on_bye` also guards `players.nfl_team IS NOT NULL` (#1791): for a
        // No NFL team row `fn_normalize_nfl_team(NULL)` is NULL, so the LEFT
        // JOIN never matches and `nfl_games.nfl_team IS NULL` alone would
        // misread a free agent as on bye, feeding `unavailableFor` the wrong
        // precedence.
        return lineupClient.query(
          `SELECT "lineup_entries"."slot", "lineup_entries"."ir_attested",
                  "players"."name", "players"."injury_status", "players"."nfl_team",
                  ("players"."nfl_team" IS NOT NULL AND "nfl_games"."nfl_team" IS NULL) AS "on_bye",
                  ${nflRosterStatusColumn()}
           FROM "lineup_entries"
           JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
             AND "team_players"."player_id" = "lineup_entries"."player_id"
           JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
           LEFT JOIN "nfl_games" ON "nfl_games"."season" = $2 AND "nfl_games"."week" = $3
             AND fn_normalize_nfl_team("nfl_games"."nfl_team")
                 = fn_normalize_nfl_team("players"."nfl_team")
           WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
             AND "lineup_entries"."week" = $3`,
          [team.id, season, week]
        );
        },
        { label: 'reminders' }
      );
      const entries = entriesResult.rows.map((row) => ({
        ...lineupEntryFromRow(row), nflTeam: row.nfl_team, nflRosterStatus: row.nfl_roster_status ?? null,
      }));
      const { problems } = lineupStatus({
        entries,
        rosterSlots,
        bestBall: Boolean(league.best_ball),
        kickoffByTeam: weekKickoffs.byTeam,
        weekLastKickoff: weekKickoffs.last,
        now: new Date(),
      });
      if (problems.length === 0) continue;

      // One reminder per team-week, held by the push_events ledger (so a
      // restart or a second instance does not re-remind). A skipped push means
      // this team-week was already reminded, so the notification and email
      // below are skipped with it. A ledger error fails open: best-effort nudge.
      const message = `Lineup check for week ${week}: ${problems.join('; ')}`;
      try {
        const push = require('./push.service');
        const { skipped } = await push.sendPushOnce({
          userIds: [team.owner_id],
          prefKey: 'lineupReminder',
          kind: 'lineup-reminder',
          subject: `${team.id}:${season}:${week}`,
          fingerprint: 'sent',
          payload: {
            title: 'Set your lineup before kickoff',
            body: message,
            url: `/#/league/${leagueId}/lineup`,
          },
        });
        if (skipped) continue;
      } catch (err) {
        console.error('lineup reminder push failed:', err.message);
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
      await deliverEmail({
        to: team.email,
        subject: `Set your lineup before kickoff (${team.name})`,
        text: `${message}\n\nFix it here: ${appOrigin()}/#/league/${leagueId}/lineup`,
      });
    }
  }
  return { remindersSent };
}

// Same in-process, one-shot-per-(league, user, week) bookkeeping as
// remindedTeamWeeks above, kept separate so a lineup reminder and a Pick'em
// reminder don't suppress each other.
const pickemRemindedUserWeeks = new Set();

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
    const wanted = new Set(
      await usersWanting(members.rows.map((m) => m.owner_id), 'pickemReminder')
    );

    for (const member of members.rows) {
      const key = `${league.id}:${member.owner_id}:${league.season}:${league.week}`;
      if (pickemRemindedUserWeeks.has(key) || !wanted.has(member.owner_id)) continue;

      const { missing } = pickemStatus({ slate, made: madeByUser.get(member.owner_id), now });
      pickemRemindedUserWeeks.add(key);
      if (missing === 0) continue; // fully picked — don't re-check this week

      remindersSent += 1;
      const message =
        `Week ${league.week} Pick'em: ${missing} game` +
        `${missing === 1 ? '' : 's'} still unpicked before kickoff.`;
      try {
        const push = require('./push.service');
        await push.sendPushToUsers([member.owner_id], {
          title: "Make your Pick'em picks before kickoff",
          body: message,
          url: `/#/league/${league.id}/pickem`,
        });
      } catch (err) {
        console.error("pick'em reminder push failed:", err.message);
      }
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
      await deliverEmail({
        to: member.email,
        subject: `Pick'em picks due: ${league.name}`,
        text: `${message}\n\nMake them here: ${appOrigin()}/#/league/${league.id}/pickem`,
      });
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
