const express = require('express');
const crypto = require('crypto');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');

const router = express.Router();
router.use(requireAuth);

function intParam(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

// POST /api/league — create a private league (plus the owner's team) atomically
router.post('/', async (req, res) => {
  const { name, rosterLimit, maxTeams, teamName } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'league name is required' });
  }
  const limit = rosterLimit === undefined ? 15 : Number(rosterLimit);
  const teams = maxTeams === undefined ? 10 : Number(maxTeams);
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
    return res.status(400).json({ error: 'rosterLimit must be an integer between 1 and 30' });
  }
  if (!Number.isInteger(teams) || teams < 2 || teams > 20) {
    return res.status(400).json({ error: 'maxTeams must be an integer between 2 and 20' });
  }

  const inviteCode = crypto.randomBytes(4).toString('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "roster_limit", "max_teams")
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, req.user.id, inviteCode, limit, teams]
    );
    const league = leagueResult.rows[0];
    await client.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, 1)`,
      [league.id, req.user.id, teamName || `${req.user.username}'s Team`]
    );
    await client.query('COMMIT');
    res.status(201).json(league);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating league', error);
    res.status(500).json({ error: 'failed to create league' });
  } finally {
    client.release();
  }
});

// POST /api/league/join — join a league by invite code (creates your team)
router.post('/join', async (req, res) => {
  const { inviteCode, teamName } = req.body || {};
  if (!inviteCode) return res.status(400).json({ error: 'inviteCode is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "invite_code" = $1 FOR UPDATE`,
      [inviteCode]
    );
    const league = leagueResult.rows[0];
    if (!league) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'no league with that invite code' });
    }
    if (league.draft_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'league draft already started' });
    }
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "teams" WHERE "league_id" = $1`,
      [league.id]
    );
    if (countResult.rows[0].n >= league.max_teams) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'league is full' });
    }
    const teamResult = await client.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [league.id, req.user.id, teamName || `${req.user.username}'s Team`, countResult.rows[0].n + 1]
    );
    await client.query('COMMIT');
    res.status(201).json({ league, team: teamResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'you already have a team in this league' });
    }
    console.error('Error joining league', error);
    res.status(500).json({ error: 'failed to join league' });
  } finally {
    client.release();
  }
});

// GET /api/league — leagues the caller belongs to
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "leagues".*, "teams"."id" AS "my_team_id", "teams"."name" AS "my_team_name"
       FROM "leagues"
       JOIN "teams" ON "teams"."league_id" = "leagues"."id"
       WHERE "teams"."owner_id" = $1
       ORDER BY "leagues"."created_at" DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leagues', error);
    res.status(500).json({ error: 'failed to fetch leagues' });
  }
});

// GET /api/league/:id — league detail: teams, owners, roster counts
router.get('/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) return res.status(404).json({ error: 'league not found' });

    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    const teamsResult = await pool.query(
      `SELECT "teams"."id", "teams"."name", "teams"."draft_position",
              "users"."username" AS "owner",
              COUNT("team_players"."id")::int AS "roster_count",
              COALESCE(SUM(CASE WHEN "matchups"."home_team_id" = "teams"."id" THEN "matchups"."home_score"
                                WHEN "matchups"."away_team_id" = "teams"."id" THEN "matchups"."away_score"
                                ELSE 0 END), 0) AS "total_points"
       FROM "teams"
       JOIN "users" ON "users"."id" = "teams"."owner_id"
       LEFT JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
       LEFT JOIN "matchups" ON "matchups"."league_id" = "teams"."league_id"
         AND ("matchups"."home_team_id" = "teams"."id" OR "matchups"."away_team_id" = "teams"."id")
       WHERE "teams"."league_id" = $1
       GROUP BY "teams"."id", "users"."username"
       ORDER BY "total_points" DESC, "teams"."draft_position"`,
      [leagueId]
    );
    // Only the owner should see the invite code
    if (league.owner_id !== req.user.id) delete league.invite_code;
    res.json({ league, teams: teamsResult.rows });
  } catch (error) {
    console.error('Error fetching league details', error);
    res.status(500).json({ error: 'failed to fetch league details' });
  }
});

// PUT /api/league/:id — owner updates name / roster limit / lineup config (before draft)
router.put('/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const {
    name, rosterLimit, lineupSlots, positionCaps, irSlots,
    waiverType, waiverPeriodHours, faabBudget,
    tradeDeadlineWeek, tradeReviewHours, tradeVetoVotes,
    scoringPreset, scoringRules, regularSeasonWeeks, playoffTeams, playoffConsolation,
    pickTimeSeconds,
  } = req.body || {};
  const limit = rosterLimit === undefined ? null : Number(rosterLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 30)) {
    return res.status(400).json({ error: 'rosterLimit must be an integer between 1 and 30' });
  }
  const validSlotMap = (map, allowedKeys) =>
    map && typeof map === 'object' && !Array.isArray(map) &&
    Object.entries(map).every(
      ([key, count]) => allowedKeys.includes(key) && Number.isInteger(count) && count >= 0 && count <= 10
    );
  const slotKeys = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  const positionKeys = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  if (lineupSlots !== undefined && !validSlotMap(lineupSlots, slotKeys)) {
    return res.status(400).json({ error: `lineupSlots must map ${slotKeys.join('/')} to integers 0-10` });
  }
  if (positionCaps !== undefined && !validSlotMap(positionCaps, positionKeys)) {
    return res.status(400).json({ error: `positionCaps must map ${positionKeys.join('/')} to integers 0-10` });
  }
  if (irSlots !== undefined && (!Number.isInteger(irSlots) || irSlots < 0 || irSlots > 5)) {
    return res.status(400).json({ error: 'irSlots must be an integer between 0 and 5' });
  }
  if (waiverType !== undefined && !['priority', 'faab'].includes(waiverType)) {
    return res.status(400).json({ error: "waiverType must be 'priority' or 'faab'" });
  }
  const intInRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (waiverPeriodHours !== undefined && !intInRange(waiverPeriodHours, 0, 168)) {
    return res.status(400).json({ error: 'waiverPeriodHours must be an integer between 0 and 168' });
  }
  if (faabBudget !== undefined && !intInRange(faabBudget, 0, 1000)) {
    return res.status(400).json({ error: 'faabBudget must be an integer between 0 and 1000' });
  }
  if (tradeDeadlineWeek !== undefined && tradeDeadlineWeek !== null && !intInRange(tradeDeadlineWeek, 1, 18)) {
    return res.status(400).json({ error: 'tradeDeadlineWeek must be an integer between 1 and 18 (or null)' });
  }
  if (tradeReviewHours !== undefined && !intInRange(tradeReviewHours, 0, 168)) {
    return res.status(400).json({ error: 'tradeReviewHours must be an integer between 0 and 168' });
  }
  if (tradeVetoVotes !== undefined && !intInRange(tradeVetoVotes, 0, 20)) {
    return res.status(400).json({ error: 'tradeVetoVotes must be an integer between 0 and 20' });
  }
  const { SCORING_PRESETS, SCORING_RULES } = require('../services/scoring.service');
  if (scoringPreset !== undefined && !SCORING_PRESETS[scoringPreset]) {
    return res.status(400).json({ error: `scoringPreset must be one of ${Object.keys(SCORING_PRESETS).join(', ')}` });
  }
  if (scoringRules !== undefined) {
    const valid = scoringRules && typeof scoringRules === 'object' && !Array.isArray(scoringRules) &&
      Object.entries(scoringRules).every(
        ([key, value]) => key in SCORING_RULES && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 50
      );
    if (!valid) {
      return res.status(400).json({ error: 'scoringRules must map known stat names to numbers (|value| <= 50)' });
    }
  }
  if (regularSeasonWeeks !== undefined && !intInRange(regularSeasonWeeks, 1, 17)) {
    return res.status(400).json({ error: 'regularSeasonWeeks must be an integer between 1 and 17' });
  }
  if (playoffTeams !== undefined && !intInRange(playoffTeams, 2, 8)) {
    return res.status(400).json({ error: 'playoffTeams must be an integer between 2 and 8' });
  }
  if (playoffConsolation !== undefined && typeof playoffConsolation !== 'boolean') {
    return res.status(400).json({ error: 'playoffConsolation must be a boolean' });
  }
  if (pickTimeSeconds !== undefined && !intInRange(pickTimeSeconds, 0, 3600)) {
    return res.status(400).json({ error: 'pickTimeSeconds must be an integer between 0 and 3600 (0 = untimed)' });
  }
  // A preset is just a prefilled full rule set; explicit scoringRules win
  const effectiveRules = scoringRules !== undefined
    ? scoringRules
    : scoringPreset !== undefined
      ? SCORING_PRESETS[scoringPreset]
      : undefined;
  try {
    // Game-integrity settings freeze once the draft starts; administrative
    // ones (name, waivers, trades) stay editable all season.
    const preDraftOnly = {
      rosterLimit, lineupSlots, positionCaps, irSlots,
      scoringRules: effectiveRules, regularSeasonWeeks, playoffTeams,
      playoffConsolation, pickTimeSeconds,
    };
    const frozenRequested = Object.entries(preDraftOnly)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    if (frozenRequested.length > 0) {
      const statusResult = await pool.query(
        `SELECT "draft_status" FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,
        [leagueId, req.user.id]
      );
      if (statusResult.rows[0] && statusResult.rows[0].draft_status !== 'pending') {
        return res.status(409).json({
          error: `these settings are locked once the draft starts: ${frozenRequested.join(', ')}`,
        });
      }
    }
    const result = await pool.query(
      `UPDATE "leagues"
       SET "name" = COALESCE($1, "name"),
           "roster_limit" = COALESCE($2, "roster_limit"),
           "lineup_slots" = COALESCE($3, "lineup_slots"),
           "position_caps" = COALESCE($4, "position_caps"),
           "ir_slots" = COALESCE($5, "ir_slots"),
           "waiver_type" = COALESCE($6, "waiver_type"),
           "waiver_period_hours" = COALESCE($7, "waiver_period_hours"),
           "faab_budget" = COALESCE($8, "faab_budget"),
           "trade_deadline_week" = COALESCE($9, "trade_deadline_week"),
           "trade_review_hours" = COALESCE($10, "trade_review_hours"),
           "trade_veto_votes" = COALESCE($11, "trade_veto_votes"),
           "scoring_rules" = COALESCE($12, "scoring_rules"),
           "regular_season_weeks" = COALESCE($13, "regular_season_weeks"),
           "playoff_teams" = COALESCE($14, "playoff_teams"),
           "playoff_consolation" = COALESCE($15, "playoff_consolation"),
           "pick_time_seconds" = COALESCE($16, "pick_time_seconds"),
           "updated_at" = now()
       WHERE "id" = $17 AND "owner_id" = $18
       RETURNING *`,
      [
        name || null,
        limit,
        lineupSlots === undefined ? null : JSON.stringify(lineupSlots),
        positionCaps === undefined ? null : JSON.stringify(positionCaps),
        irSlots === undefined ? null : irSlots,
        waiverType === undefined ? null : waiverType,
        waiverPeriodHours === undefined ? null : waiverPeriodHours,
        faabBudget === undefined ? null : faabBudget,
        tradeDeadlineWeek === undefined ? null : tradeDeadlineWeek,
        tradeReviewHours === undefined ? null : tradeReviewHours,
        tradeVetoVotes === undefined ? null : tradeVetoVotes,
        effectiveRules === undefined ? null : JSON.stringify(effectiveRules),
        regularSeasonWeeks === undefined ? null : regularSeasonWeeks,
        playoffTeams === undefined ? null : playoffTeams,
        playoffConsolation === undefined ? null : playoffConsolation,
        pickTimeSeconds === undefined ? null : pickTimeSeconds,
        leagueId,
        req.user.id,
      ]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found or you are not the owner' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating league', error);
    res.status(500).json({ error: 'failed to update league' });
  }
});

// POST /api/league/:id/start-draft — owner starts the live draft
router.post('/:id/start-draft', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const result = await pool.query(
      `UPDATE "leagues"
       SET "draft_status" = 'active', "current_pick" = 0, "updated_at" = now(),
           "pick_deadline_at" = CASE WHEN "pick_time_seconds" > 0
             THEN now() + make_interval(secs => "pick_time_seconds") ELSE NULL END
       WHERE "id" = $1 AND "owner_id" = $2 AND "draft_status" = 'pending'
       RETURNING *`,
      [leagueId, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found, not owner, or draft already started' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error starting draft', error);
    res.status(500).json({ error: 'failed to start draft' });
  }
});

// DELETE /api/league/:id — owner deletes the league
router.delete('/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const result = await pool.query(
      `DELETE FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2 RETURNING "id"`,
      [leagueId, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'league not found or you are not the owner' });
    }
    res.sendStatus(204);
  } catch (error) {
    console.error('Error deleting league', error);
    res.status(500).json({ error: 'failed to delete league' });
  }
});

// GET /api/league/:id/rosters — every team's roster (for trade building, matchup views)
router.get('/:id/rosters', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    const result = await pool.query(
      `SELECT "teams"."id" AS "team_id", "teams"."name" AS "team_name", "teams"."owner_id",
              "players"."id", "players"."name", "players"."position", "players"."nfl_team"
       FROM "teams"
       LEFT JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
       LEFT JOIN "players" ON "players"."id" = "team_players"."player_id"
       WHERE "teams"."league_id" = $1
       ORDER BY "teams"."id", "players"."position", "players"."name"`,
      [leagueId]
    );
    const teams = new Map();
    for (const row of result.rows) {
      if (!teams.has(row.team_id)) {
        teams.set(row.team_id, { teamId: row.team_id, teamName: row.team_name, ownerId: row.owner_id, players: [] });
      }
      if (row.id) {
        teams.get(row.team_id).players.push({
          id: row.id, name: row.name, position: row.position, nfl_team: row.nfl_team,
        });
      }
    }
    res.json(Array.from(teams.values()));
  } catch (error) {
    console.error('Error fetching league rosters', error);
    res.status(500).json({ error: 'failed to fetch rosters' });
  }
});

// GET /api/league/:id/transactions — league-wide activity log (adds, drops, waivers, trades)
router.get('/:id/transactions', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    const result = await pool.query(
      `SELECT "transactions".*, "teams"."name" AS "team_name",
              "players"."name" AS "player_name"
       FROM "transactions"
       LEFT JOIN "teams" ON "teams"."id" = "transactions"."team_id"
       LEFT JOIN "players" ON "players"."id" = ("transactions"."detail"->>'playerId')::int
       WHERE "transactions"."league_id" = $1
       ORDER BY "transactions"."created_at" DESC
       LIMIT 100`,
      [leagueId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions', error);
    res.status(500).json({ error: 'failed to fetch transactions' });
  }
});

// GET /api/league/:id/matchups?week=N — head-to-head results
router.get('/:id/matchups', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const week = req.query.week === undefined ? null : intParam(req.query.week);
  if (req.query.week !== undefined && !week) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const params = [leagueId];
    let weekSql = '';
    if (week) {
      params.push(week);
      weekSql = `AND "matchups"."week" = $2`;
    }
    const result = await pool.query(
      `SELECT "matchups".*,
              home."name" AS "home_team_name", away."name" AS "away_team_name"
       FROM "matchups"
       JOIN "teams" home ON home."id" = "matchups"."home_team_id"
       JOIN "teams" away ON away."id" = "matchups"."away_team_id"
       WHERE "matchups"."league_id" = $1 ${weekSql}
       ORDER BY "matchups"."season" DESC, "matchups"."week" DESC, "matchups"."id"`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching matchups', error);
    res.status(500).json({ error: 'failed to fetch matchups' });
  }
});

module.exports = router;
