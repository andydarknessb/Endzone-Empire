const pool = require('../modules/pool');

class LineupError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const BENCH = 'BENCH';
const IR = 'IR';

/** Which player positions may occupy each starting slot. */
const SLOT_ELIGIBILITY = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  K: ['K'],
  DEF: ['DEF'],
};

const DEFAULT_LINEUP_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };

/** Pure: may a player of this position sit in this slot? BENCH/IR take anyone. */
function slotEligible(slot, position) {
  if (slot === BENCH || slot === IR) return true;
  const allowed = SLOT_ELIGIBILITY[slot];
  return Boolean(allowed && allowed.includes(position));
}

/**
 * Normalize a league row's lineup configuration (jsonb columns arrive as
 * objects from pg, but tolerate strings for safety).
 */
function parseLineupSettings(league) {
  const parse = (value, fallback) => {
    if (value == null) return fallback;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return value;
  };
  return {
    lineupSlots: parse(league.lineup_slots, DEFAULT_LINEUP_SLOTS),
    positionCaps: parse(league.position_caps, {}),
    irSlots: Number.isInteger(league.ir_slots) ? league.ir_slots : 1,
  };
}

/**
 * Pure: validate a full lineup against league settings.
 * entries: [{ playerId, position, slot }]. Returns an array of error strings
 * (empty when valid). BENCH is unbounded; starting slots and IR are capped.
 */
function validateLineup(entries, { lineupSlots = DEFAULT_LINEUP_SLOTS, irSlots = 1 } = {}) {
  const errors = [];
  const counts = {};
  for (const entry of entries) {
    const slot = entry.slot;
    if (slot !== BENCH && slot !== IR && lineupSlots[slot] === undefined) {
      errors.push(`unknown slot "${slot}"`);
      continue;
    }
    if (!slotEligible(slot, entry.position)) {
      errors.push(`a ${entry.position} cannot start at ${slot}`);
      continue;
    }
    counts[slot] = (counts[slot] || 0) + 1;
  }
  for (const [slot, count] of Object.entries(counts)) {
    if (slot === BENCH) continue;
    const max = slot === IR ? irSlots : lineupSlots[slot];
    if (count > max) errors.push(`too many players at ${slot} (${count}/${max})`);
  }
  return errors;
}

/**
 * Ensure every player currently on the team's roster has a lineup_entries row
 * for (season, week). First touch of a week copies slots forward from the
 * team's most recent earlier week; players without history default to BENCH.
 * Must run inside the caller's transaction (client).
 */
async function materializeLineup(client, { leagueId, teamId, season, week }) {
  const rosterResult = await client.query(
    `SELECT "team_players"."player_id", "players"."position"
     FROM "team_players" JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" = $1`,
    [teamId]
  );
  if (rosterResult.rows.length === 0) return;

  const existing = await client.query(
    `SELECT "player_id" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "season" = $2 AND "week" = $3`,
    [teamId, season, week]
  );
  const have = new Set(existing.rows.map((r) => r.player_id));
  const missing = rosterResult.rows.filter((r) => !have.has(r.player_id));
  if (missing.length === 0) return;

  // Copy-forward source: the team's latest earlier week this season (if any)
  const prevResult = await client.query(
    `SELECT "player_id", "slot" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "season" = $2
       AND "week" = (SELECT MAX("week") FROM "lineup_entries"
                     WHERE "team_id" = $1 AND "season" = $2 AND "week" < $3)`,
    [teamId, season, week]
  );
  const prevSlots = new Map(prevResult.rows.map((r) => [r.player_id, r.slot]));

  for (const row of missing) {
    const slot = prevSlots.get(row.player_id) || BENCH;
    await client.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("team_id", "season", "week", "player_id") DO NOTHING`,
      [leagueId, teamId, row.player_id, season, week, slot]
    );
  }
}

/**
 * The set of NFL team names whose game for (season, week) has kicked off —
 * players on those teams are locked. Empty schedule means nothing is locked.
 */
async function lockedNflTeams(client, { season, week }) {
  const result = await client.query(
    `SELECT "nfl_team" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2 AND "kickoff_at" <= now()`,
    [season, week]
  );
  return new Set(result.rows.map((r) => r.nfl_team));
}

/** NFL teams that have any scheduled game for (season, week) — for bye detection. */
async function scheduledNflTeams(client, { season, week }) {
  const result = await client.query(
    `SELECT "nfl_team" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  return new Set(result.rows.map((r) => r.nfl_team));
}

async function loadLeagueAndTeam(client, { leagueId, userId, forUpdate = false }) {
  const leagueResult = await client.query(
    `SELECT * FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = leagueResult.rows[0];
  if (!league) throw new LineupError(404, 'league not found');
  const teamResult = await client.query(
    `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [leagueId, userId]
  );
  const team = teamResult.rows[0];
  if (!team) throw new LineupError(403, 'you do not have a team in this league');
  return { league, team };
}

/**
 * Fetch (materializing if needed) the caller's lineup for a week, annotated
 * with per-player locked and onBye flags.
 */
async function getLineup({ leagueId, userId, week }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { league, team } = await loadLeagueAndTeam(client, { leagueId, userId });
    const season = league.current_season;
    const targetWeek = week || league.current_week;

    await materializeLineup(client, { leagueId, teamId: team.id, season, week: targetWeek });

    const entriesResult = await client.query(
      `SELECT "players"."id", "players"."name", "players"."position", "players"."nfl_team",
              "players"."injury_status", "lineup_entries"."slot",
              (SELECT ROUND(AVG("fantasy_points"), 1) FROM "player_stats"
               WHERE "player_stats"."player_id" = "players"."id"
                 AND "player_stats"."season" = $2) AS "projected_points"
       FROM "lineup_entries"
       JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3
       ORDER BY "players"."position", "players"."name"`,
      [team.id, season, targetWeek]
    );
    const locked = await lockedNflTeams(client, { season, week: targetWeek });
    const scheduled = await scheduledNflTeams(client, { season, week: targetWeek });
    await client.query('COMMIT');

    const settings = parseLineupSettings(league);
    return {
      leagueId: league.id,
      teamId: team.id,
      season,
      week: targetWeek,
      currentWeek: league.current_week,
      lineupSlots: settings.lineupSlots,
      irSlots: settings.irSlots,
      entries: entriesResult.rows.map((row) => ({
        ...row,
        locked: locked.has(row.nfl_team),
        onBye: scheduled.size > 0 && !scheduled.has(row.nfl_team),
      })),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Apply one or more slot moves atomically. The team row is locked so
 * concurrent edits serialize; the FINAL lineup is validated against the
 * league's slot counts, and any move touching a locked player is rejected.
 */
async function setLineup({ leagueId, userId, week, moves }) {
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new LineupError(400, 'moves must be a non-empty array of { playerId, slot }');
  }
  for (const move of moves) {
    if (!Number.isInteger(move.playerId) || typeof move.slot !== 'string') {
      throw new LineupError(400, 'each move needs an integer playerId and a string slot');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { league, team } = await loadLeagueAndTeam(client, { leagueId, userId, forUpdate: true });
    const season = league.current_season;
    const targetWeek = week || league.current_week;
    if (targetWeek < league.current_week) {
      throw new LineupError(409, 'cannot edit a past week');
    }

    await materializeLineup(client, { leagueId, teamId: team.id, season, week: targetWeek });

    const entriesResult = await client.query(
      `SELECT "lineup_entries"."player_id", "lineup_entries"."slot",
              "players"."position", "players"."nfl_team"
       FROM "lineup_entries"
       JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3`,
      [team.id, season, targetWeek]
    );
    const byPlayer = new Map(entriesResult.rows.map((r) => [r.player_id, r]));

    const locked = await lockedNflTeams(client, { season, week: targetWeek });
    const changed = [];
    for (const move of moves) {
      const entry = byPlayer.get(move.playerId);
      if (!entry) throw new LineupError(404, `player ${move.playerId} is not on your roster`);
      if (entry.slot === move.slot) continue;
      if (locked.has(entry.nfl_team)) {
        throw new LineupError(409, 'that player is locked — his game has started');
      }
      entry.slot = move.slot;
      changed.push(entry);
    }

    const settings = parseLineupSettings(league);
    const errors = validateLineup(
      Array.from(byPlayer.values()).map((e) => ({ playerId: e.player_id, position: e.position, slot: e.slot })),
      settings
    );
    if (errors.length > 0) throw new LineupError(400, errors.join('; '));

    for (const entry of changed) {
      await client.query(
        `UPDATE "lineup_entries" SET "slot" = $1, "updated_at" = now()
         WHERE "team_id" = $2 AND "season" = $3 AND "week" = $4 AND "player_id" = $5`,
        [entry.slot, team.id, season, targetWeek, entry.player_id]
      );
    }
    await client.query('COMMIT');
    return { leagueId, teamId: team.id, season, week: targetWeek, updated: changed.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  LineupError,
  DEFAULT_LINEUP_SLOTS,
  SLOT_ELIGIBILITY,
  slotEligible,
  parseLineupSettings,
  validateLineup,
  materializeLineup,
  lockedNflTeams,
  getLineup,
  setLineup,
};
