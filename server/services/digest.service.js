const pool = require('../modules/pool');
const { deliverEmail } = require('./account.service');
const { notify } = require('./activity.service');
const { usersWanting } = require('./prefs.service');

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
 * entries: [{ slot, name, onBye, injury_status }] (starters only get flagged;
 * BENCH/IR are ignored). lineupSlots: {QB:1,...} to detect unfilled slots.
 * Returns human-readable problem strings (empty = lineup looks fine).
 */
function lineupProblems(entries, lineupSlots = {}) {
  const problems = [];
  const starters = entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR');

  const filled = {};
  for (const s of starters) filled[s.slot] = (filled[s.slot] || 0) + 1;
  for (const [slot, count] of Object.entries(lineupSlots)) {
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
      subject: `Week ${week} recap — ${member.league_name}`,
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
        : `LOST: ${row.player_name}${bid}${row.note ? ` — ${row.note}` : ''}`
    );
  }
  const wanted = new Set(await usersWanting([...byOwner.keys()], 'waiverResults'));

  let sent = 0;
  for (const [ownerId, { email, leagueName, lines }] of byOwner) {
    if (!wanted.has(ownerId)) continue;
    await deliverEmail({
      to: email,
      subject: `Waiver results — ${leagueName}`,
      text: `Your waiver claims cleared:\n\n${lines.join('\n')}\n\n${appOrigin()}/#/league/${leagueId}/waivers`,
    });
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
 * starting slots or starters who are Out/IR/on bye.
 */
async function sendLineupReminders() {
  const leagues = await pool.query(
    `SELECT * FROM "leagues"
     WHERE "draft_status" = 'complete' AND "season_status" != 'complete' AND "best_ball" = false`
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

    const { parseLineupSettings } = require('./lineup.service');
    const { lineupSlots } = parseLineupSettings(league);

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

      const entriesResult = await pool.query(
        `SELECT "lineup_entries"."slot", "players"."name", "players"."injury_status",
                ("nfl_games"."nfl_team" IS NULL) AS "on_bye"
         FROM "lineup_entries"
         JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
         LEFT JOIN "nfl_games" ON "nfl_games"."season" = $2 AND "nfl_games"."week" = $3
           AND "nfl_games"."nfl_team" = "players"."nfl_team"
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3`,
        [team.id, season, week]
      );
      const entries = entriesResult.rows.map((r) => ({
        slot: r.slot,
        name: r.name,
        onBye: r.on_bye,
        injury_status: r.injury_status,
      }));
      const problems = lineupProblems(entries, lineupSlots);
      if (problems.length === 0) {
        remindedTeamWeeks.add(key); // lineup is fine — don't re-check this week
        continue;
      }

      remindedTeamWeeks.add(key);
      remindersSent += 1;
      const message = `Lineup check for week ${week}: ${problems.join('; ')}`;
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
        subject: `Set your lineup — kickoff soon (${team.name})`,
        text: `${message}\n\nFix it here: ${appOrigin()}/#/league/${leagueId}/lineup`,
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
};
