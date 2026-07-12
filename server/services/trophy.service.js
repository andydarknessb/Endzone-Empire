const pool = require('../modules/pool');
const { computeStandings } = require('./season.service');
const { notify } = require('./activity.service');

/**
 * Trophies: automatic awards written after weekly scoring (and, once the
 * season completes, the season-level set). Awarding is idempotent — the
 * trophies table's UNIQUE(league_id, season, week, type) plus
 * ON CONFLICT DO NOTHING means re-running an advance-week (or a stat
 * correction re-triggering the pipeline) never duplicates an award.
 */

/** Pure: longest consecutive-'W' run in an ordered result list ('W'|'L'|'T'). */
function longestWinStreak(results) {
  let best = 0;
  let run = 0;
  for (const r of results) {
    run = r === 'W' ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Pure: the comeback team — among playoff qualifiers, the one with the worst
 * midpoint record (they climbed from furthest back). Only counts as a
 * comeback if they were actually under .500 at the midpoint; returns null
 * otherwise. standingsAtMidpoint: computeStandings rows; qualifierIds: Set.
 */
function comebackTeam(standingsAtMidpoint, qualifierIds) {
  let worst = null;
  for (const row of standingsAtMidpoint) {
    if (!qualifierIds.has(row.teamId)) continue;
    if (!worst || row.winPct < worst.winPct) worst = row;
  }
  return worst && worst.winPct < 0.5 ? worst : null;
}

/** Insert one trophy; returns true when newly awarded (false = already existed). */
async function award(client, { leagueId, teamId, season, week, type, label, data }) {
  const result = await client.query(
    `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("league_id", "season", "week", "type") DO NOTHING
     RETURNING "id"`,
    [leagueId, teamId, season, week, type, label, JSON.stringify(data || {})]
  );
  return Boolean(result.rows[0]);
}

/** Notify a team's owner about a new trophy. */
async function notifyOwner(client, { leagueId, teamId, label }) {
  const owner = await client.query(`SELECT "owner_id" FROM "teams" WHERE "id" = $1`, [teamId]);
  if (!owner.rows[0]) return;
  await notify(client, {
    userId: owner.rows[0].owner_id,
    leagueId,
    type: 'trophy',
    message: `Trophy earned: ${label}`,
  });
}

/**
 * Award everything due after a week finalizes: the weekly high score, and —
 * once the league's season is complete — the season-level set (champion,
 * longest win streak, biggest comeback, best draft grade).
 */
async function awardWeeklyTrophies({ leagueId, season, week }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) return [];
  const awarded = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Weekly high score
    const weekMatchups = await client.query(
      `SELECT * FROM "matchups"
       WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "final" = true`,
      [leagueId, season, week]
    );
    let high = null;
    for (const m of weekMatchups.rows) {
      for (const side of [
        { teamId: m.home_team_id, points: Number(m.home_score) },
        { teamId: m.away_team_id, points: Number(m.away_score) },
      ]) {
        if (!high || side.points > high.points) high = side;
      }
    }
    if (high) {
      const label = `Week ${week} High Score`;
      if (
        await award(client, {
          leagueId, teamId: high.teamId, season, week,
          type: 'weekly_high', label, data: { points: high.points },
        })
      ) {
        awarded.push({ type: 'weekly_high', teamId: high.teamId, label });
      }
    }

    if (league.season_status === 'complete') {
      const all = await client.query(
        `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, season]
      );
      const teams = await client.query(
        `SELECT "id", "name" FROM "teams" WHERE "league_id" = $1`,
        [leagueId]
      );
      const matchups = all.rows;

      // Champion — league_history is authoritative (season rollover writes
      // it); fall back to the last decided playoff matchup when the trophy
      // run happens before rollover.
      let championTeamId = null;
      const history = await client.query(
        `SELECT "champion_team_id" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, season]
      );
      if (history.rows[0] && history.rows[0].champion_team_id) {
        championTeamId = history.rows[0].champion_team_id;
      } else {
        const playoffFinals = matchups
          .filter((m) => m.is_playoff && !m.is_consolation && m.final)
          .sort((a, b) => b.week - a.week);
        const last = playoffFinals[0];
        if (last) {
          championTeamId =
            Number(last.home_score) >= Number(last.away_score)
              ? last.home_team_id
              : last.away_team_id;
        }
      }
      if (championTeamId) {
        const label = `${season} League Champion`;
        if (
          await award(client, {
            leagueId, teamId: championTeamId, season, week: 0,
            type: 'champion', label, data: {},
          })
        ) {
          awarded.push({ type: 'champion', teamId: championTeamId, label });
        }
      }

      // Longest win streak across regular-season finals
      const regular = matchups
        .filter((m) => m.final && !m.is_playoff)
        .sort((a, b) => a.week - b.week);
      const resultsByTeam = new Map(teams.rows.map((t) => [t.id, []]));
      for (const m of regular) {
        const hs = Number(m.home_score);
        const as = Number(m.away_score);
        const homeResult = hs > as ? 'W' : hs < as ? 'L' : 'T';
        const awayResult = homeResult === 'W' ? 'L' : homeResult === 'L' ? 'W' : 'T';
        if (resultsByTeam.has(m.home_team_id)) resultsByTeam.get(m.home_team_id).push(homeResult);
        if (resultsByTeam.has(m.away_team_id)) resultsByTeam.get(m.away_team_id).push(awayResult);
      }
      let bestStreak = null;
      for (const [teamId, results] of resultsByTeam) {
        const length = longestWinStreak(results);
        if (length > 1 && (!bestStreak || length > bestStreak.length)) {
          bestStreak = { teamId, length };
        }
      }
      if (bestStreak) {
        const label = `Longest Win Streak (${bestStreak.length})`;
        if (
          await award(client, {
            leagueId, teamId: bestStreak.teamId, season, week: 0,
            type: 'win_streak', label, data: { length: bestStreak.length },
          })
        ) {
          awarded.push({ type: 'win_streak', teamId: bestStreak.teamId, label });
        }
      }

      // Biggest comeback: worst midpoint record among playoff qualifiers
      const midWeek = Math.floor(league.regular_season_weeks / 2);
      const midStandings = computeStandings(
        teams.rows,
        regular.filter((m) => m.week <= midWeek)
      );
      const qualifierIds = new Set(
        matchups
          .filter((m) => m.is_playoff && !m.is_consolation)
          .flatMap((m) => [m.home_team_id, m.away_team_id])
      );
      const comeback = comebackTeam(midStandings, qualifierIds);
      if (comeback) {
        const label = 'Biggest Comeback';
        if (
          await award(client, {
            leagueId, teamId: comeback.teamId, season, week: 0,
            type: 'comeback', label,
            data: { midpointWinPct: comeback.winPct },
          })
        ) {
          awarded.push({ type: 'comeback', teamId: comeback.teamId, label });
        }
      }

      // Best draft grade (only when grades were computed for this season)
      const grades = await client.query(
        `SELECT "data" FROM "league_analytics"
         WHERE "league_id" = $1 AND "season" = $2 AND "type" = 'draft_grades'`,
        [leagueId, season]
      );
      const gradeRows = grades.rows[0] && grades.rows[0].data.grades;
      if (Array.isArray(gradeRows) && gradeRows.length > 0) {
        const top = gradeRows.find((g) => g.rank === 1) || gradeRows[0];
        const label = `Best Draft (${top.grade})`;
        if (
          await award(client, {
            leagueId, teamId: top.teamId, season, week: 0,
            type: 'draft_grade', label, data: { grade: top.grade },
          })
        ) {
          awarded.push({ type: 'draft_grade', teamId: top.teamId, label });
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Notifications AFTER the commit, each best-effort: a notify failure must
  // never roll back an award — awardWeeklyTrophies runs once per week, so a
  // rolled-back trophy would be lost for good.
  for (const trophyAwarded of awarded) {
    try {
      await notifyOwner(pool, {
        leagueId,
        teamId: trophyAwarded.teamId,
        label: trophyAwarded.label,
      });
    } catch (err) {
      console.error(`trophy notification failed (${trophyAwarded.type}):`, err.message);
    }
  }
  return awarded;
}

/** All trophies a team has earned, newest first. */
async function getTeamTrophies({ teamId }) {
  const result = await pool.query(
    `SELECT "trophies".*, "teams"."name" AS "team_name"
     FROM "trophies" JOIN "teams" ON "teams"."id" = "trophies"."team_id"
     WHERE "team_id" = $1 ORDER BY "awarded_at" DESC`,
    [teamId]
  );
  return result.rows;
}

/** A league's trophies (optionally one season), newest first. */
async function getLeagueTrophies({ leagueId, season }) {
  const params = [leagueId];
  let where = `"league_id" = $1`;
  if (season != null) {
    params.push(season);
    where += ` AND "season" = $2`;
  }
  const result = await pool.query(
    `SELECT "trophies".*, "teams"."name" AS "team_name"
     FROM "trophies" JOIN "teams" ON "teams"."id" = "trophies"."team_id"
     WHERE ${where} ORDER BY "awarded_at" DESC`,
    params
  );
  return result.rows;
}

module.exports = {
  longestWinStreak,
  comebackTeam,
  awardWeeklyTrophies,
  getTeamTrophies,
  getLeagueTrophies,
};
