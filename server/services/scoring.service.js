const axios = require('axios');
const pool = require('../modules/pool');
const { materializeLineup } = require('./lineup.service');
const { getIo } = require('../modules/io');

// Default fantasy scoring rules (points per unit of each stat) — half-PPR
const SCORING_RULES = {
  passingYards: 0.04,
  rushingYards: 0.1,
  receivingYards: 0.1,
  passingTDs: 4,
  rushingTDs: 6,
  receivingTDs: 6,
  receptions: 0.5, // half-PPR
  fumbles: -2,
  interceptions: -2,
  passingTwoPt: 2,
  rushingTwoPt: 2,
  receivingTwoPt: 2,
  sack: 1,
  interceptionReturn: 2,
  fumbleRecovery: 2,
  defensiveTD: 6,
  fieldGoal: 3,
  extraPoint: 1,
};

// League-selectable presets; each is a full rule set based on the defaults
const SCORING_PRESETS = {
  standard: { ...SCORING_RULES, receptions: 0 },
  half_ppr: { ...SCORING_RULES, receptions: 0.5 },
  ppr: { ...SCORING_RULES, receptions: 1 },
};

/**
 * A league's effective scoring rules: its scoring_rules jsonb merged over
 * the defaults (null/missing column = defaults). Unknown keys are dropped.
 */
function rulesForLeague(league) {
  let custom = league && league.scoring_rules;
  if (typeof custom === 'string') {
    try { custom = JSON.parse(custom); } catch { custom = null; }
  }
  if (!custom || typeof custom !== 'object') return SCORING_RULES;
  const rules = { ...SCORING_RULES };
  for (const [key, value] of Object.entries(custom)) {
    if (key in rules && Number.isFinite(Number(value))) rules[key] = Number(value);
  }
  return rules;
}

/** Pure function: stats object -> fantasy points under the given rules. */
function calculateFantasyPoints(stats, rules = SCORING_RULES) {
  let score = 0;
  for (const [stat, value] of Object.entries(stats || {})) {
    const pointsPerStat = rules[stat];
    if (pointsPerStat !== undefined && Number.isFinite(Number(value))) {
      score += Number(value) * pointsPerStat;
    }
  }
  return Math.round(score * 100) / 100;
}

function rapidApiClient() {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) {
    const err = new Error('RAPID_API_KEY / RAPID_API_HOST not configured');
    err.statusCode = 503;
    throw err;
  }
  return axios.create({
    baseURL: `https://${process.env.RAPID_API_HOST}`,
    headers: {
      'X-RapidAPI-Key': process.env.RAPID_API_KEY,
      'X-RapidAPI-Host': process.env.RAPID_API_HOST,
    },
    timeout: 15000,
  });
}

/**
 * Map one entry of the RapidAPI player-statistics payload to our flat stat
 * names. The API groups stats by category; unknown categories are ignored.
 */
function normalizeApiStats(groups) {
  const find = (categoryName, statName) => {
    const cat = (groups || []).find(
      (g) => g.name && g.name.toLowerCase() === categoryName
    );
    const stat = cat && (cat.statistics || []).find(
      (s) => s.name && s.name.toLowerCase() === statName
    );
    const value = stat && Number(String(stat.value).replace(/,/g, ''));
    return Number.isFinite(value) ? value : 0;
  };
  return {
    passingYards: find('passing', 'yards'),
    passingTDs: find('passing', 'passing touch downs'),
    interceptions: find('passing', 'interceptions'),
    rushingYards: find('rushing', 'yards'),
    rushingTDs: find('rushing', 'rushing touch downs'),
    receivingYards: find('receiving', 'yards'),
    receivingTDs: find('receiving', 'receiving touch downs'),
    receptions: find('receiving', 'receptions'),
    fumbles: find('fumbles', 'fumbles lost'),
  };
}

/**
 * Fetch weekly real-world stats from RapidAPI for every player that has an
 * external_id, compute fantasy points, and upsert into player_stats.
 */
async function syncWeekStats({ season, week }) {
  const api = rapidApiClient();
  const playersResult = await pool.query(
    `SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`
  );
  let updated = 0;
  for (const player of playersResult.rows) {
    try {
      const response = await api.get('/players/statistics', {
        params: { id: player.external_id, season },
      });
      const entry = (response.data && response.data.response) || [];
      const groups = entry[0] && entry[0].teams && entry[0].teams[0]
        ? entry[0].teams[0].groups
        : entry[0] && entry[0].groups;
      const stats = normalizeApiStats(groups);
      const points = calculateFantasyPoints(stats);
      await pool.query(
        `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("player_id", "season", "week")
         DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
        [player.id, season, week, JSON.stringify(stats), points]
      );
      updated += 1;
    } catch (err) {
      console.error(`Stat sync failed for player ${player.id}:`, err.message);
    }
  }
  return { season, week, playersUpdated: updated };
}

/**
 * Pull the real NFL schedule for a season from RapidAPI into nfl_games —
 * one row per team per week — powering lineup locks and bye detection.
 * Unparseable entries are skipped; the sync is idempotent (upsert).
 */
async function syncSchedule({ season }) {
  const api = rapidApiClient();
  const response = await api.get('/games', { params: { league: 1, season } });
  const games = (response.data && response.data.response) || [];
  let upserted = 0;
  for (const entry of games) {
    try {
      const week = Number(String(entry.game && entry.game.week || '').replace(/\D/g, ''));
      const kickoff = entry.game && entry.game.date && entry.game.date.timestamp
        ? new Date(entry.game.date.timestamp * 1000)
        : null;
      const home = entry.teams && entry.teams.home && entry.teams.home.name;
      const away = entry.teams && entry.teams.away && entry.teams.away.name;
      if (!Number.isInteger(week) || week < 1 || !kickoff || !home || !away) continue;
      for (const [team, opponent] of [[home, away], [away, home]]) {
        await pool.query(
          `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("season", "week", "nfl_team")
           DO UPDATE SET "opponent" = EXCLUDED."opponent", "kickoff_at" = EXCLUDED."kickoff_at"`,
          [season, week, team, opponent, kickoff]
        );
        upserted += 1;
      }
    } catch (err) {
      console.error('schedule sync: skipping malformed entry:', err.message);
    }
  }
  return { season, gamesUpserted: upserted };
}

/**
 * Generate round-robin head-to-head pairings for a league week (idempotent —
 * skips if matchups already exist). Odd team counts give one team a bye.
 */
async function generateMatchups({ leagueId, season, week }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT 1 FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 LIMIT 1`,
      [leagueId, season, week]
    );
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return { created: 0, reason: 'matchups already exist for this week' };
    }
    const teamsResult = await client.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 ORDER BY "id"`,
      [leagueId]
    );
    const ids = teamsResult.rows.map((r) => r.id);
    if (ids.length < 2) {
      await client.query('ROLLBACK');
      return { created: 0, reason: 'need at least 2 teams' };
    }
    // Circle-method round robin, rotated by week for variety
    const rotation = week % Math.max(1, ids.length - 1);
    const fixed = ids[0];
    const rest = ids.slice(1);
    const rotated = rest.slice(rotation).concat(rest.slice(0, rotation));
    const order = [fixed, ...rotated];
    let created = 0;
    for (let i = 0; i < Math.floor(order.length / 2); i++) {
      const home = order[i];
      const away = order[order.length - 1 - i];
      await client.query(
        `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id")
         VALUES ($1, $2, $3, $4, $5)`,
        [leagueId, season, week, home, away]
      );
      created += 1;
    }
    await client.query('COMMIT');
    return { created };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Score every matchup for a league week: each team's score is the sum of its
 * STARTERS' fantasy points for that week (bench and IR don't count), computed
 * from raw stats under the LEAGUE'S scoring rules. Lineups are materialized
 * first so teams that never touched theirs still get their carried-forward
 * (or default-bench) lineup. Transactional per league.
 */
async function scoreMatchups({ leagueId, season, week }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const rules = rulesForLeague(leagueResult.rows[0]);
    const matchupsResult = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 FOR UPDATE`,
      [leagueId, season, week]
    );
    const teamScore = async (teamId) => {
      await materializeLineup(client, { leagueId, teamId, season, week });
      const r = await client.query(
        `SELECT "player_stats"."stats"
         FROM "lineup_entries"
         JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
           AND "team_players"."player_id" = "lineup_entries"."player_id"
         JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
           AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')`,
        [teamId, season, week]
      );
      const total = r.rows.reduce((sum, row) => sum + calculateFantasyPoints(row.stats, rules), 0);
      return Math.round(total * 100) / 100;
    };
    const scored = [];
    for (const matchup of matchupsResult.rows) {
      const homeScore = await teamScore(matchup.home_team_id);
      const awayScore = await teamScore(matchup.away_team_id);
      await client.query(
        `UPDATE "matchups" SET "home_score" = $1, "away_score" = $2 WHERE "id" = $3`,
        [homeScore, awayScore, matchup.id]
      );
      scored.push({
        matchupId: matchup.id,
        homeTeamId: matchup.home_team_id,
        awayTeamId: matchup.away_team_id,
        homeScore,
        awayScore,
      });
    }
    await client.query('COMMIT');
    // Live scoring: push fresh scores to anyone watching this league
    const io = getIo();
    if (io) io.to(`league:${leagueId}`).emit('scores:updated', { leagueId, season, week, scored });
    return { scored };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  SCORING_RULES,
  SCORING_PRESETS,
  rulesForLeague,
  calculateFantasyPoints,
  normalizeApiStats,
  syncWeekStats,
  syncSchedule,
  generateMatchups,
  scoreMatchups,
};
