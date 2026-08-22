const pool = require('../modules/pool');
const { deliverEmail } = require('./account.service');
const { notify } = require('./activity.service');
const { usersWanting } = require('./prefs.service');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
const { injuryDesignationName, isValidStash } = require('./irPolicy.service');

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

/**
 * Pure: problems in a lineup that should trigger a pre-lockout reminder.
 * entries: [{ slot, name, onBye, injury_status, ir_attested }] (starter
 * availability and unresolved IR stashes are flagged; BENCH is ignored and a
 * commissioner-attested stash never nags). rosterSlots:
 * [{key,count,...}] detects unfilled slots.
 * Returns human-readable problem strings (empty = lineup looks fine).
 */
function lineupProblems(entries, rosterSlots = []) {
  const problems = [];
  const starters = entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR');

  const filled = {};
  for (const s of starters) filled[s.slot] = (filled[s.slot] || 0) + 1;
  for (const { key: slot, count } of rosterSlots) {
    const have = filled[slot] || 0;
    if (have < count) {
      problems.push(`${count - have} empty ${slot} slot${count - have === 1 ? '' : 's'}`);
    }
  }

  for (const s of starters) {
    if (s.onBye) problems.push(`${s.name} (${s.slot}) is on bye`);
    else if (s.injury_status === 'O' || s.injury_status === 'IR') {
      problems.push(`${s.name} (${s.slot}) is ${s.injury_status === 'O' ? 'Out' : 'on IR'}`);
    }
  }
  for (const stash of entries.filter((entry) => entry.slot === 'IR')) {
    // A commissioner-attested stash is valid by fiat (#100) - never nagged.
    if (!isValidStash(stash)) {
      problems.push(
        `${stash.name} (IR) is no longer IR-eligible (${injuryDesignationName(stash.injury_status)})`
      );
    }
  }
  return problems;
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
       AND "waiver_claims"."processed_at" > $2`,
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

// One reminder per team-week. In-process only: a restart may re-remind, which
// beats persisting reminder state for what is inherently best-effort nudging.
const remindedTeamWeeks = new Set();

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
      const key = `${team.id}:${season}:${week}`;
      if (remindedTeamWeeks.has(key) || !wanted.has(team.owner_id)) continue;

      const lineupClient = await pool.connect();
      let entriesResult;
      try {
        await lineupClient.query('BEGIN');
        await materializeLineup(lineupClient, { leagueId, teamId: team.id, season, week });
        entriesResult = await lineupClient.query(
          `SELECT "lineup_entries"."slot", "lineup_entries"."ir_attested",
                  "players"."name", "players"."injury_status",
                  ("nfl_games"."nfl_team" IS NULL) AS "on_bye"
           FROM "lineup_entries"
           JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
             AND "team_players"."player_id" = "lineup_entries"."player_id"
           JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
           LEFT JOIN "nfl_games" ON "nfl_games"."season" = $2 AND "nfl_games"."week" = $3
             AND "nfl_games"."nfl_team" = "players"."nfl_team"
           WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
             AND "lineup_entries"."week" = $3`,
          [team.id, season, week]
        );
        await lineupClient.query('COMMIT');
      } catch (error) {
        await lineupClient.query('ROLLBACK');
        throw error;
      } finally {
        lineupClient.release();
      }
      const entries = entriesResult.rows.map((r) => ({
        slot: r.slot,
        name: r.name,
        onBye: r.on_bye,
        injury_status: r.injury_status,
        ir_attested: r.ir_attested,
      }));
      const problems = league.best_ball
        ? lineupProblems(entries.filter((entry) => entry.slot === 'IR'), [])
        : lineupProblems(entries, rosterSlots);
      if (problems.length === 0) {
        remindedTeamWeeks.add(key); // lineup is fine — don't re-check this week
        continue;
      }

      remindedTeamWeeks.add(key);
      remindersSent += 1;
      const message = `Lineup check for week ${week}: ${problems.join('; ')}`;
      try {
        const push = require('./push.service');
        await push.sendPushToUsers([team.owner_id], {
          title: 'Set your lineup before kickoff',
          body: message,
          url: `/#/league/${leagueId}/lineup`,
        });
      } catch (err) {
        console.error('lineup reminder push failed:', err.message);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await notify(client, {
          userId: team.owner_id,
          leagueId,
          type: 'lineup_reminder',
          message,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('lineup reminder notification failed:', error.message);
      } finally {
        client.release();
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
    const openKeys = slate
      .filter((game) => !pickem.isGameLocked(game, now))
      .map((game) => game.gameKey);
    if (openKeys.length === 0) continue;

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
    const madeByUser = new Map();
    for (const row of stored.rows) {
      if (!madeByUser.has(row.user_id)) madeByUser.set(row.user_id, new Set());
      madeByUser.get(row.user_id).add(row.team_pair);
    }
    const wanted = new Set(
      await usersWanting(members.rows.map((m) => m.owner_id), 'pickemReminder')
    );

    for (const member of members.rows) {
      const key = `${league.id}:${member.owner_id}:${league.season}:${league.week}`;
      if (pickemRemindedUserWeeks.has(key) || !wanted.has(member.owner_id)) continue;

      const made = madeByUser.get(member.owner_id) || new Set();
      const missing = openKeys.filter((gameKey) => !made.has(gameKey));
      pickemRemindedUserWeeks.add(key);
      if (missing.length === 0) continue; // fully picked — don't re-check this week

      remindersSent += 1;
      const message =
        `Week ${league.week} Pick'em: ${missing.length} game` +
        `${missing.length === 1 ? '' : 's'} still unpicked before kickoff.`;
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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await notify(client, {
          userId: member.owner_id,
          leagueId: league.id,
          type: 'pickem_reminder',
          message,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.error("pick'em reminder notification failed:", error.message);
      } finally {
        client.release();
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
  lineupProblems,
  sendWeeklyRecapDigest,
  sendWaiverResultsDigest,
  sendLineupReminders,
  sendPickemReminders,
};
