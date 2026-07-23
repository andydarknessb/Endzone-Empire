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
 * Valuation: every pick receives the signed market delta `ADP - pick number`.
 * Lower is better: a player taken at 45 with ADP 12 is -33 (a steal), while a
 * player taken at 10 with ADP 80 is +70 (a reach). Team grades use the inverse
 * composite delta as their z-score input. Projected roster value remains in
 * the payload for backwards-compatible UI display.
 */

const DRAFT_GRADE_ALGORITHM_VERSION = 2;

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

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Pure: missing/non-numeric market ADP is neutral at the actual pick. */
function draftPickValue({ pickNumber, marketAdp }) {
  const actualPick = Number(pickNumber);
  const parsedAdp = Number(marketAdp);
  const hasMarketAdp = Number.isFinite(parsedAdp) && parsedAdp > 0;
  const safeAdp = hasMarketAdp ? parsedAdp : actualPick;
  return {
    marketAdp: round2(safeAdp),
    draftValueScore: round2(safeAdp - actualPick),
    adpFallback: !hasMarketAdp,
  };
}

/**
 * Pure: smaller cumulative deltas are better, so negate the score before the
 * established z-score matrix. gradeTeams keeps exact ties deterministic by id.
 */
function gradeDraftValues(teamValues) {
  const normalized = teamValues.map((team) => ({
    ...team,
    draftValueScore: round2(team.draftValueScore),
  }));
  const originalByTeam = new Map(normalized.map((team) => [team.teamId, team]));
  const graded = gradeTeams(normalized.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    rosterValue: -team.draftValueScore,
  })));
  return graded.map(({ teamId, grade, rank }) => {
    const original = originalByTeam.get(teamId);
    return {
      ...original,
      rosterValue: round2(original.rosterValue),
      draftValueScore: round2(original.draftValueScore),
      grade,
      rank,
    };
  });
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
  if (cached.rows[0]?.data?.algorithmVersion === DRAFT_GRADE_ALGORITHM_VERSION) {
    return cached.rows[0].data;
  }
  if (league.draft_status !== 'complete') return null;

  const picksResult = await pool.query(
    `SELECT "draft_picks"."team_id", "draft_picks"."player_id", "draft_picks"."pick_number",
            "players"."position", "players"."adp", "teams"."name" AS "team_name"
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
  const { rosterSlots } = parseLineupSettings(league);

  const byTeam = new Map();
  for (const pick of picksResult.rows) {
    if (!byTeam.has(pick.team_id)) {
      byTeam.set(pick.team_id, { name: pick.team_name, picks: [] });
    }
    const value = draftPickValue({ pickNumber: pick.pick_number, marketAdp: pick.adp });
    byTeam.get(pick.team_id).picks.push({
      playerId: pick.player_id,
      position: pick.position,
      pickNumber: pick.pick_number,
      ...value,
    });
  }

  const teamValues = [];
  for (const [teamId, { name, picks }] of byTeam) {
    const players = picks.map(({ playerId, position }) => ({ playerId, position }));
    const optimal = optimalLineup(players, rosterSlots, pointsFor);
    const starterIds = new Set(optimal.starters.map((s) => s.playerId));
    const benchValue = players
      .filter((p) => !starterIds.has(p.playerId))
      .reduce((sum, p) => sum + (Number(pointsFor.get(p.playerId)) || 0), 0);
    teamValues.push({
      teamId,
      name,
      rosterValue: optimal.total + 0.25 * benchValue,
      draftValueScore: round2(picks.reduce((sum, pick) => sum + pick.draftValueScore, 0)),
      picks,
    });
  }

  const data = {
    algorithmVersion: DRAFT_GRADE_ALGORITHM_VERSION,
    computedAt: new Date().toISOString(),
    grades: gradeDraftValues(teamValues),
  };
  await pool.query(
    `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
     VALUES ($1, $2, 0, 'draft_grades', $3)
     ON CONFLICT ("league_id", "season", "week", "type")
     DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()`,
    [leagueId, season, JSON.stringify(data)]
  );
  return data;
}

module.exports = {
  draftPickValue,
  gradeDraftValues,
  gradeTeams,
  getOrComputeDraftGrades,
  DRAFT_GRADE_ALGORITHM_VERSION,
};
