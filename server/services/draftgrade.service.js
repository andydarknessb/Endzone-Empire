const pool = require('../modules/pool');
const { getWeekProjections } = require('./projection.service');
const { optimalLineup, parseLineupSettings } = require('./lineup.service');

/**
 * Draft grades: A–F per team, computed lazily on first request after the
 * draft completes and cached in league_analytics (type 'draft_grades',
 * week 0). Lazy beats a draft-completion hook: grades want projection data,
 * which usually lands after the draft anyway, and a re-request simply serves
 * the cached copy.
 *
 * Valuation: each team's drafted roster is scored as its optimal projected
 * lineup plus a discounted bench (depth matters, starters matter more).
 * Without ADP data the fair baseline is the league itself — grades come from
 * each team's z-score against the league mean, so a league full of sharks
 * still spreads A through F.
 */

const GRADE_THRESHOLDS = [
  { min: 1.0, grade: 'A' },
  { min: 0.33, grade: 'B' },
  { min: -0.33, grade: 'C' },
  { min: -1.0, grade: 'D' },
  { min: -Infinity, grade: 'F' },
];

/**
 * Pure: letter grades from team roster values.
 * teamValues: [{ teamId, name, rosterValue }]. Returns rows sorted best-first
 * with { grade, rank } added. All-equal values (stddev 0) grade everyone 'B'.
 */
function gradeTeams(teamValues) {
  if (teamValues.length === 0) return [];
  const values = teamValues.map((t) => t.rosterValue);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  const rows = teamValues.map((t) => {
    const z = stddev === 0 ? null : (t.rosterValue - mean) / stddev;
    const grade = z === null ? 'B' : GRADE_THRESHOLDS.find((g) => z >= g.min).grade;
    return { ...t, rosterValue: Math.round(t.rosterValue * 100) / 100, grade };
  });
  rows.sort((a, b) => b.rosterValue - a.rosterValue || a.teamId - b.teamId);
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * Cached grades for a league, computing them on first request once the
 * draft is complete. Returns null while the draft is still running.
 */
async function getOrComputeDraftGrades({ leagueId }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) return null;
  const season = league.current_season;

  const cached = await pool.query(
    `SELECT "data" FROM "league_analytics"
     WHERE "league_id" = $1 AND "season" = $2 AND "type" = 'draft_grades'`,
    [leagueId, season]
  );
  if (cached.rows[0]) return cached.rows[0].data;
  if (league.draft_status !== 'complete') return null;

  const picksResult = await pool.query(
    `SELECT "draft_picks"."team_id", "draft_picks"."player_id", "draft_picks"."pick_number",
            "players"."position", "teams"."name" AS "team_name"
     FROM "draft_picks"
     JOIN "players" ON "players"."id" = "draft_picks"."player_id"
     JOIN "teams" ON "teams"."id" = "draft_picks"."team_id"
     WHERE "draft_picks"."league_id" = $1
     ORDER BY "draft_picks"."pick_number"`,
    [leagueId]
  );
  if (picksResult.rows.length === 0) return null;

  const projections = await getWeekProjections({ season, week: league.current_week });
  const pointsFor = new Map(
    [...projections].map(([playerId, { points }]) => [playerId, points])
  );
  const { lineupSlots } = parseLineupSettings(league);

  const byTeam = new Map();
  for (const pick of picksResult.rows) {
    if (!byTeam.has(pick.team_id)) {
      byTeam.set(pick.team_id, { name: pick.team_name, players: [] });
    }
    byTeam.get(pick.team_id).players.push({ playerId: pick.player_id, position: pick.position });
  }

  const teamValues = [];
  for (const [teamId, { name, players }] of byTeam) {
    const optimal = optimalLineup(players, lineupSlots, pointsFor);
    const starterIds = new Set(optimal.starters.map((s) => s.playerId));
    const benchValue = players
      .filter((p) => !starterIds.has(p.playerId))
      .reduce((sum, p) => sum + (Number(pointsFor.get(p.playerId)) || 0), 0);
    teamValues.push({ teamId, name, rosterValue: optimal.total + 0.25 * benchValue });
  }

  const data = { computedAt: new Date().toISOString(), grades: gradeTeams(teamValues) };
  await pool.query(
    `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
     VALUES ($1, $2, 0, 'draft_grades', $3)
     ON CONFLICT ("league_id", "season", "week", "type")
     DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()`,
    [leagueId, season, JSON.stringify(data)]
  );
  return data;
}

module.exports = { gradeTeams, getOrComputeDraftGrades };
