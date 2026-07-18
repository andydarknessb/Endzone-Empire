const axios = require('axios');
const pool = require('../modules/pool');
const { materializeLineup, optimalLineup, parseLineupSettings } = require('./lineup.service');
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
 * Unwrap a Tank01 response. Every endpoint answers with
 * { statusCode, body } — the payload lives in `body`. Tolerates a raw
 * payload too, in case the envelope ever disappears.
 */
function tank01Body(data) {
  if (data && typeof data === 'object' && 'body' in data) return data.body;
  return data;
}

/**
 * Map one Tank01 box-score playerStats entry to our flat stat names.
 * Tank01 groups stats into Passing/Rushing/Receiving/Kicking/Defense
 * category objects with string values; missing categories mean zero.
 */
function normalizeTank01Stats(entry) {
  const num = (...values) => {
    for (const value of values) {
      const parsed = Number(String(value ?? '').replace(/,/g, ''));
      if (Number.isFinite(parsed) && String(value ?? '') !== '') return parsed;
    }
    return 0;
  };
  const e = entry || {};
  const passing = e.Passing || {};
  const rushing = e.Rushing || {};
  const receiving = e.Receiving || {};
  const kicking = e.Kicking || {};
  const defense = e.Defense || {};
  return {
    passingYards: num(passing.passYds),
    passingTDs: num(passing.passTD),
    interceptions: num(passing.int),
    rushingYards: num(rushing.rushYds),
    rushingTDs: num(rushing.rushTD),
    receivingYards: num(receiving.recYds),
    receivingTDs: num(receiving.recTD),
    receptions: num(receiving.receptions),
    // Tank01 has reported fumblesLost under Defense and at the top level
    // across versions — accept either.
    fumbles: num(defense.fumblesLost, e.fumblesLost),
    fieldGoal: num(kicking.fgMade),
    extraPoint: num(kicking.xpMade),
  };
}

// Stat keys that represent a scored touchdown, mapped to the cutscene's event
// type. Detection keys off the stat itself incrementing — never a fantasy-point
// jump — so a stat correction that moves points without a TD never fires a
// cutscene.
const TD_STAT_EVENTS = {
  passingTDs: 'passing',
  rushingTDs: 'rushing',
  receivingTDs: 'receiving',
  defensiveTD: 'defensive',
  returnTDs: 'return',
  kickReturnTDs: 'return',
  puntReturnTDs: 'return',
};

/**
 * Pure: diff a player's previous vs. new stat line and return one typed
 * scoring event per touchdown-stat that increased. Yardage and other stat
 * changes produce nothing. `prevStats` null/undefined is treated as all-zero
 * (first observation of the week) — so re-running a sync with unchanged stats
 * yields no events (idempotent), but a genuinely new TD does.
 */
function detectScoringEvents(prevStats, newStats) {
  const prev = prevStats || {};
  const next = newStats || {};
  const events = [];
  for (const [statKey, type] of Object.entries(TD_STAT_EVENTS)) {
    const before = Number(prev[statKey]) || 0;
    const after = Number(next[statKey]) || 0;
    if (after > before) {
      events.push({ type, statKey, tdDelta: after - before });
    }
  }
  return events;
}

/**
 * Fetch a week's real-world stats from Tank01: one getNFLGamesForWeek call,
 * then a box score per game (~16 calls) — every player in those games whose
 * external_id we know gets a player_stats upsert.
 *
 * Returns typed touchdown events (`plays`) detected by diffing each player's
 * prior stored stats against the fresh pull, decorated with the scoring
 * player's real NFL team and that week's opponent so the live UI can render a
 * team-accurate cutscene. Only genuine TD-stat increments produce a play, so a
 * re-sync or a stat correction never fabricates one.
 */
async function syncWeekStats({ season, week }) {
  const api = rapidApiClient();
  const gamesResponse = await api.get('/getNFLGamesForWeek', {
    params: { week, seasonType: 'reg', season },
  });
  const games = tank01Body(gamesResponse.data) || [];
  if (!Array.isArray(games) || games.length === 0) {
    return { season, week, playersUpdated: 0, gamesProcessed: 0, plays: [] };
  }

  const knownPlayers = await pool.query(
    `SELECT "id", "external_id", "name", "position", "nfl_team"
     FROM "players" WHERE "external_id" IS NOT NULL`
  );
  const idByExternal = new Map(
    knownPlayers.rows.map((r) => [String(r.external_id), r.id])
  );
  const metaById = new Map(knownPlayers.rows.map((r) => [r.id, r]));

  // Prior stats for this week, so we can diff for new touchdowns.
  const priorStats = await pool.query(
    `SELECT "player_id", "stats" FROM "player_stats"
     WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const prevById = new Map(priorStats.rows.map((r) => [r.player_id, r.stats]));

  // This week's real-game opponents, keyed by nfl_team, for the defender sprite.
  const schedule = await pool.query(
    `SELECT "nfl_team", "opponent" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const opponentByTeam = new Map(schedule.rows.map((r) => [r.nfl_team, r.opponent]));

  let updated = 0;
  let gamesProcessed = 0;
  const plays = [];
  for (const game of games) {
    if (!game || !game.gameID) continue;
    try {
      const boxResponse = await api.get('/getNFLBoxScore', {
        params: { gameID: game.gameID, playByPlay: 'false', fantasyPoints: 'false' },
      });
      const box = tank01Body(boxResponse.data) || {};
      const playerStats = box.playerStats || {};
      gamesProcessed += 1;
      for (const entry of Object.values(playerStats)) {
        const playerId = idByExternal.get(String(entry && entry.playerID));
        if (!playerId) continue; // not in our pool
        const stats = normalizeTank01Stats(entry);
        const points = calculateFantasyPoints(stats);
        const prev = prevById.get(playerId);
        const events = detectScoringEvents(prev, stats);
        if (events.length > 0) {
          const meta = metaById.get(playerId) || {};
          const pointsDelta =
            Math.round((points - calculateFantasyPoints(prev || {})) * 100) / 100;
          for (const ev of events) {
            plays.push({
              playerId,
              name: meta.name,
              position: meta.position,
              nflTeam: meta.nfl_team,
              opponent: opponentByTeam.get(meta.nfl_team) || null,
              type: ev.type,
              tdDelta: ev.tdDelta,
              pointsDelta,
            });
          }
        }
        await pool.query(
          `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("player_id", "season", "week")
           DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
          [playerId, season, week, JSON.stringify(stats), points]
        );
        updated += 1;
      }
    } catch (err) {
      console.error(`Stat sync failed for game ${game.gameID}:`, err.message);
    }
  }
  return { season, week, playersUpdated: updated, gamesProcessed, plays };
}

/** Map a RapidAPI injury designation to our badge codes (Q/D/O/IR). */
function normalizeInjuryStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return null;
  if (s.includes('injured reserve') || /\bir\b/.test(s)) return 'IR';
  if (s.includes('question')) return 'Q';
  if (s.includes('doubt')) return 'D';
  if (s.includes('out')) return 'O';
  return null;
}

/**
 * Injury sync: Tank01's player list carries each player's current injury
 * designation, so one getNFLPlayerList call refreshes everyone. Players with
 * no current designation are cleared back to healthy.
 */
async function syncInjuries() {
  const api = rapidApiClient();
  const response = await api.get('/getNFLPlayerList');
  const entries = tank01Body(response.data) || [];
  if (!Array.isArray(entries)) {
    const err = new Error('unexpected getNFLPlayerList response shape');
    err.statusCode = 502;
    throw err;
  }
  const injuryByExternal = new Map();
  for (const entry of entries) {
    if (!entry || entry.playerID == null) continue;
    const injury = entry.injury || {};
    injuryByExternal.set(String(entry.playerID), {
      status: normalizeInjuryStatus(injury.designation),
      detail: injury.description ? String(injury.description).slice(0, 255) : null,
    });
  }

  const playersResult = await pool.query(
    `SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`
  );
  let updated = 0;
  for (const player of playersResult.rows) {
    const injury = injuryByExternal.get(String(player.external_id));
    if (!injury) continue; // not in the feed — leave untouched
    try {
      await pool.query(
        `UPDATE "players" SET "injury_status" = $1, "injury_detail" = $2 WHERE "id" = $3`,
        [injury.status, injury.detail, player.id]
      );
      updated += 1;
    } catch (err) {
      console.error(`Injury sync failed for player ${player.id}:`, err.message);
    }
  }
  return { playersUpdated: updated };
}

/**
 * Pure: one Tank01 game entry -> { home, away, kickoffAt } (team
 * abbreviations; null when the entry is missing anything load-bearing).
 */
function normalizeTank01Game(entry) {
  if (!entry || !entry.home || !entry.away) return null;
  const epoch = Number(entry.gameTime_epoch);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return { home: entry.home, away: entry.away, kickoffAt: new Date(epoch * 1000) };
}

/**
 * Pull the real NFL schedule into nfl_games — one row per team per week,
 * keyed by Tank01 team abbreviations (matching players.nfl_team from
 * syncPlayers) — powering lineup locks and bye detection. One
 * getNFLGamesForWeek call per regular-season week; idempotent upserts.
 */
async function syncSchedule({ season }) {
  const api = rapidApiClient();
  let upserted = 0;
  for (let week = 1; week <= 18; week++) {
    try {
      const response = await api.get('/getNFLGamesForWeek', {
        params: { week, seasonType: 'reg', season },
      });
      const games = tank01Body(response.data) || [];
      if (!Array.isArray(games)) continue;
      for (const entry of games) {
        const game = normalizeTank01Game(entry);
        if (!game) continue;
        for (const [team, opponent] of [[game.home, game.away], [game.away, game.home]]) {
          await pool.query(
            `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT ("season", "week", "nfl_team")
             DO UPDATE SET "opponent" = EXCLUDED."opponent", "kickoff_at" = EXCLUDED."kickoff_at"`,
            [season, week, team, opponent, game.kickoffAt]
          );
          upserted += 1;
        }
      }
    } catch (err) {
      console.error(`schedule sync failed for week ${week}:`, err.message);
    }
  }
  return { season, gamesUpserted: upserted };
}

// Fantasy-relevant positions — Tank01's full player list includes every
// position (OL, LB, ...); only these are useful in a lineup.
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'PK', 'DEF']);

/**
 * Resolve a headshot URL for a Tank01 player entry. Prefer the provider's own
 * `espnHeadshot` URL when present; otherwise build the public ESPN headshot
 * URL from the player's `espnID` (a stable, keyed pattern). Returns null when
 * neither is available, so the UI falls back to an initials avatar.
 */
function resolveHeadshotUrl(entry) {
  const provided = entry && entry.espnHeadshot;
  if (provided && String(provided).startsWith('http')) return String(provided);
  const espnId = entry && entry.espnID;
  if (espnId != null && /^\d+$/.test(String(espnId))) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }
  return null;
}

/**
 * Normalize one entry from Tank01's getNFLPlayerList into our player shape.
 * Returns null for entries missing an id, name, or position, and for
 * non-fantasy positions. Tank01 calls kickers 'PK' — stored as 'K' to match
 * our slot eligibility. Also carries a resolved headshot URL and jersey
 * number (both null when the feed omits them).
 */
function normalizePlayerEntry(entry) {
  const externalId = entry && entry.playerID;
  const name = entry && entry.longName;
  let position = entry && entry.pos && String(entry.pos).toUpperCase();
  if (position === 'PK') position = 'K';
  if (!externalId || !name || !position || !FANTASY_POSITIONS.has(position)) return null;
  const jersey = entry.jerseyNum != null && String(entry.jerseyNum) !== ''
    ? String(entry.jerseyNum).slice(0, 8)
    : null;
  return {
    externalId: String(externalId),
    name,
    position,
    nflTeam: entry.team ? String(entry.team) : null,
    photoUrl: resolveHeadshotUrl(entry),
    jerseyNumber: jersey,
  };
}

/**
 * Discover and refresh the NFL player pool from Tank01's getNFLPlayerList —
 * a single call covering the whole league. Upserts by external_id (safe to
 * re-run; existing players get their name/position/team refreshed, new ones
 * are inserted). Not on the scheduler — trigger from the admin dashboard or
 * POST /api/scoring/sync-players.
 */
async function syncPlayers({ season }) {
  const api = rapidApiClient();
  const response = await api.get('/getNFLPlayerList');
  const entries = tank01Body(response.data) || [];
  if (!Array.isArray(entries)) {
    const err = new Error('unexpected getNFLPlayerList response shape');
    err.statusCode = 502;
    throw err;
  }
  let upserted = 0;
  let skipped = 0;
  for (const raw of entries) {
    const parsed = normalizePlayerEntry(raw);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    try {
      await pool.query(
        `INSERT INTO "players" ("external_id", "name", "position", "nfl_team", "photo_url", "jersey_number")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("external_id")
         DO UPDATE SET "name" = EXCLUDED."name", "position" = EXCLUDED."position",
                       "nfl_team" = EXCLUDED."nfl_team",
                       -- keep an existing headshot/jersey if a later feed omits it
                       "photo_url" = COALESCE(EXCLUDED."photo_url", "players"."photo_url"),
                       "jersey_number" = COALESCE(EXCLUDED."jersey_number", "players"."jersey_number")`,
        [parsed.externalId, parsed.name, parsed.position, parsed.nflTeam, parsed.photoUrl, parsed.jerseyNumber]
      );
      upserted += 1;
    } catch (err) {
      console.error(`player sync: upsert failed for external_id ${parsed.externalId}:`, err.message);
    }
  }
  return { season, playersUpserted: upserted, skippedNonFantasy: skipped };
}

/**
 * Pure: sum an array of weekly stat objects into one season total. Every
 * numeric stat key is added up; `games` counts the rows (weeks played).
 * Non-numeric / unknown values are ignored.
 */
function aggregateSeasonStats(weeklyStats) {
  const totals = {};
  let games = 0;
  for (const raw of weeklyStats || []) {
    let stats = raw;
    if (typeof stats === 'string') {
      try { stats = JSON.parse(stats); } catch { stats = null; }
    }
    if (!stats || typeof stats !== 'object') continue;
    games += 1;
    for (const [key, value] of Object.entries(stats)) {
      const n = Number(value);
      if (Number.isFinite(n)) totals[key] = Math.round(((totals[key] || 0) + n) * 100) / 100;
    }
  }
  return { games, stats: totals };
}

/**
 * Pure: assemble the player quick-view summary payload from already-fetched
 * rows. Kept free of DB access so it's unit-testable.
 *   - player:      the players row
 *   - weeklyRows:  player_stats rows [{ season, week, stats }] (any order)
 *   - seasonRows:  player_season_stats rows [{ season, games_played, stats }]
 *   - rules:       scoring rules to price every stat line under
 *   - byeWeek:     precomputed bye week (number) or null
 * currentSeason is the player's most recent weekly season (null when none);
 * previousSeasons lists the rolled-up seasons (newest first), excluding the
 * current one, with points RE-SCORED under `rules` — so [] means "no prior
 * data", the dialog's graceful-degradation case.
 */
function buildPlayerSummary({ player, weeklyRows = [], seasonRows = [], rules = SCORING_RULES, byeWeek = null }) {
  const sorted = [...weeklyRows].sort((a, b) =>
    a.season !== b.season ? b.season - a.season : a.week - b.week
  );
  const latestSeason = sorted.length ? sorted[0].season : null;
  const seasonWeeks = sorted.filter((r) => r.season === latestSeason);
  const weekly = seasonWeeks.map((r) => ({
    week: r.week,
    stats: r.stats,
    fantasy_points: calculateFantasyPoints(r.stats, rules),
  }));
  const currentPoints = Math.round(weekly.reduce((s, w) => s + w.fantasy_points, 0) * 100) / 100;
  const currentSeason = latestSeason === null ? null : {
    season: latestSeason,
    weekly,
    games: weekly.length,
    points: currentPoints,
    perGame: weekly.length ? Math.round((currentPoints / weekly.length) * 10) / 10 : 0,
  };

  const previousSeasons = [...seasonRows]
    .filter((r) => r.season !== latestSeason)
    .sort((a, b) => b.season - a.season)
    .map((r) => {
      const points = calculateFantasyPoints(r.stats, rules);
      const games = Number(r.games_played) || 0;
      return {
        season: r.season,
        games,
        stats: r.stats,
        points,
        perGame: games ? Math.round((points / games) * 10) / 10 : 0,
      };
    });

  return {
    player: {
      id: player.id,
      name: player.name,
      position: player.position,
      nfl_team: player.nfl_team,
      jersey_number: player.jersey_number,
      external_id: player.external_id,
      injury_status: player.injury_status,
      injury_detail: player.injury_detail,
      news: player.news,
      photo_url: player.photo_url,
      bye_week: byeWeek,
    },
    currentSeason,
    previousSeasons,
  };
}

/**
 * Backfill / refresh season-level totals in player_season_stats by rolling up
 * every completed prior season's weekly rows in player_stats. "Prior" means
 * strictly before `currentSeason` (defaults to the newest league's current
 * season, else 2026). Idempotent — re-running recomputes and upserts each
 * (player, season). The stored fantasy_points uses the default scoring rules;
 * the summary API recomputes points from `stats` under a league's own rules.
 *
 * This is a one-time/on-demand job (admin dashboard or POST
 * /api/scoring/backfill-seasons), not on the scheduler. Seasons for which we
 * have no weekly data simply produce no rows, so players without prior-season
 * history degrade gracefully to the dialog's "no data" state.
 */
async function syncPlayerSeasonStats({ currentSeason } = {}) {
  let cutoff = Number(currentSeason);
  if (!Number.isInteger(cutoff)) {
    const r = await pool.query(`SELECT MAX("current_season") AS s FROM "leagues"`);
    cutoff = r.rows[0] && r.rows[0].s != null ? Number(r.rows[0].s) : 2026;
  }

  const weekly = await pool.query(
    `SELECT "player_id", "season", "stats" FROM "player_stats"
     WHERE "season" < $1
     ORDER BY "player_id", "season"`,
    [cutoff]
  );

  // Group weekly rows by player+season.
  const byKey = new Map();
  for (const row of weekly.rows) {
    const key = `${row.player_id}:${row.season}`;
    if (!byKey.has(key)) byKey.set(key, { playerId: row.player_id, season: row.season, rows: [] });
    byKey.get(key).rows.push(row.stats);
  }

  let upserted = 0;
  for (const { playerId, season, rows } of byKey.values()) {
    const { games, stats } = aggregateSeasonStats(rows);
    const points = calculateFantasyPoints(stats);
    try {
      await pool.query(
        `INSERT INTO "player_season_stats" ("player_id", "season", "games_played", "stats", "fantasy_points")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("player_id", "season")
         DO UPDATE SET "games_played" = EXCLUDED."games_played",
                       "stats" = EXCLUDED."stats",
                       "fantasy_points" = EXCLUDED."fantasy_points"`,
        [playerId, season, games, JSON.stringify(stats), points]
      );
      upserted += 1;
    } catch (err) {
      console.error(`season-stat backfill failed for player ${playerId} season ${season}:`, err.message);
    }
  }
  return { cutoffSeason: cutoff, seasonsUpserted: upserted };
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
 *
 * Finality changes the semantics so re-scoring is idempotent (stat
 * corrections re-run this for settled weeks):
 * - Live weeks join against team_players, the CURRENT roster — a player
 *   dropped mid-week stops scoring immediately.
 * - Final weeks score straight from that week's lineup_entries, the
 *   historical record: a player traded or dropped SINCE then still counts,
 *   and the lineup is never re-materialized against today's roster.
 *
 * Best-ball leagues ignore the slots owners set: the score is the OPTIMAL
 * legal lineup over that week's players (same live/final population rules),
 * computed server-side every time — there is no lineup to manage.
 */
async function scoreMatchups({ leagueId, season, week, plays = [] }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    const rules = rulesForLeague(league);
    const matchupsResult = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 FOR UPDATE`,
      [leagueId, season, week]
    );
    const teamScore = async (teamId, isFinal) => {
      if (!isFinal) {
        await materializeLineup(client, { leagueId, teamId, season, week });
      }
      const currentRosterJoin = isFinal
        ? ''
        : `JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
           AND "team_players"."player_id" = "lineup_entries"."player_id"`;
      if (league.best_ball) {
        // Best ball: every rostered player counts as a candidate; the score
        // is the best legal lineup regardless of the slots stored.
        const r = await client.query(
          `SELECT "lineup_entries"."player_id", "players"."position", "player_stats"."stats"
           FROM "lineup_entries"
           ${currentRosterJoin}
           JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
           LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
             AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
           WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
             AND "lineup_entries"."week" = $3`,
          [teamId, season, week]
        );
        const candidates = r.rows.map((row) => ({ playerId: row.player_id, position: row.position }));
        const pointsFor = new Map(
          r.rows.map((row) => [row.player_id, calculateFantasyPoints(row.stats, rules)])
        );
        const { lineupSlots } = parseLineupSettings(league);
        return optimalLineup(candidates, lineupSlots, pointsFor).total;
      }
      const r = await client.query(
        `SELECT "player_stats"."stats"
         FROM "lineup_entries"
         ${currentRosterJoin}
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
      const homeScore = await teamScore(matchup.home_team_id, matchup.final);
      const awayScore = await teamScore(matchup.away_team_id, matchup.final);
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
    // `plays` (typed touchdown events) rides the same emit that carries fresh
    // scores. It's populated only on the live sync path — the stat-correction
    // path passes none — so a cutscene can never fire from a correction.
    if (io) io.to(`league:${leagueId}`).emit('scores:updated', { leagueId, season, week, scored, plays });
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
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01Game,
  normalizeInjuryStatus,
  normalizePlayerEntry,
  resolveHeadshotUrl,
  aggregateSeasonStats,
  buildPlayerSummary,
  detectScoringEvents,
  syncWeekStats,
  syncSchedule,
  syncInjuries,
  syncPlayers,
  syncPlayerSeasonStats,
  generateMatchups,
  scoreMatchups,
};
