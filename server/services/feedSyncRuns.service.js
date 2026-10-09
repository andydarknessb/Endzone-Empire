/**
 * feed Sync runs: the six feed Sync runs (CONTEXT.md, ADR 0036) that keep the
 * NFL player pool, schedule, injuries, week stats, team defenses and season
 * rollups current — players, schedule, injuries, week stats, team defenses,
 * player season stats. Split out of scoring.service.js (#1504, spec #1492) as
 * one of the six modules the old scoring module now re-exports whole.
 *
 * Every job here is `runSyncJob({ job, lock, fetch, apply })`
 * (server/modules/syncRun.js): fetch runs first, outside any transaction and
 * outside any lock; apply runs once per unit inside its own transaction under
 * the job's lock; and the module writes the one `data_sync_runs` row per run.
 */
const pool = require('../modules/pool');
const { PLAYERS_BULK_WRITE_LOCK, NFL_GAMES_BULK_WRITE_LOCK } = require('../modules/advisoryLock');
const { tank01Get } = require('../modules/tank01Client');
const { fetchWeekGames } = require('../modules/espnScoreboard');
const { runSyncJob } = require('../modules/syncRun');
const cadence = require('../modules/cadence');
const { POSITION_GROUPS } = require('./lineup.service');
const { normalizeNflTeam } = require('./nflTeam');
const { fantasySideWhereSql } = require('./leagueType');
const { calculateFantasyPoints } = require('./scoringRules');
const {
  tank01Body, normalizeTeamAbbr, NFL_TEAM_NAME_TO_ABBR, buildGameKey,
} = require('./tank01Feed');
const {
  loadWeekMaps, applyGameBoxScore, gamesNeedingBoxScore, markFinalStatsSynced,
} = require('./boxScoreApply.service');
const { aggregateSeasonStats } = require('./seasonSummary.service');
const tank01BoxSource = require('./tank01BoxSource');
const espnAthleteClient = require('../modules/espnAthleteClient');
const { sharedRosterSweep } = require('../modules/espnFactsSync');

// Fantasy-relevant positions — an ESPN team roster lists every position (OL, C,
// G, ...); only these are useful in a lineup. Individual defenders (DL/LB/DB
// group members — DE/DT/NT/LB/ILB/OLB/CB/S/FS/SS) are included so DP-enabled
// leagues can roster them; they keep the specific position code ESPN gives
// for display (see lineup.service.js's POSITION_GROUPS, which expands DL/LB/DB
// slot eligibility to match).
const FANTASY_POSITIONS = new Set([
  'QB', 'RB', 'WR', 'TE', 'K', 'PK', 'DEF',
  ...POSITION_GROUPS.DL, ...POSITION_GROUPS.LB, ...POSITION_GROUPS.DB,
]);

// Individual-defender position codes as stored on players rows (the specific
// codes, not the DL/LB/DB roster-group keys).
const IDP_POSITIONS = [...POSITION_GROUPS.DL, ...POSITION_GROUPS.LB, ...POSITION_GROUPS.DB];

// Every position whose season rollups come from our own player_stats weeklies
// rather than the Sleeper season sync (which covers offense/K only). Safe to
// pass to syncPlayerSeasonStats({ positions }) — Sleeper never writes rows for
// these positions, so a scoped upsert cannot clobber a Sleeper rollup.
const DEFENSIVE_POSITIONS = ['DEF', ...IDP_POSITIONS];

/**
 * Normalize one row of an ESPN team roster (espnAthleteClient.normalizeTeamRoster)
 * into our player shape. Returns null for a row missing an id, name, or position,
 * and for non-fantasy positions. ESPN calls kickers 'PK' - stored as 'K' to match
 * our slot eligibility. `nflTeam` is the Team code of the roster the athlete was
 * read from (already our canonical code), `photoUrl` and `jerseyNumber` are null
 * when ESPN omits them.
 *
 * Called by applySyncPlayersUnit; exported for its unit tests, not as
 * cross-module interface: no other module calls this directly.
 */
function normalizeRosterRow(row) {
  let position = row && row.position && String(row.position).toUpperCase();
  if (position === 'PK') position = 'K';
  if (!row || !row.athleteId || !row.name || !position || !FANTASY_POSITIONS.has(position)) return null;
  return {
    externalId: String(row.athleteId),
    name: row.name,
    position,
    nflTeam: row.teamCode,
    photoUrl: row.photoUrl ?? null,
    jerseyNumber: row.jerseyNumber ?? null,
  };
}

/**
 * Discover and refresh the NFL player pool from the 32 ESPN team rosters (#2117,
 * ADR 0060: Tank01 is the fallback and Final box only). Upserts by external_id,
 * which is the ESPN athlete id (ADR 0035): existing players get their
 * name/position/team refreshed, new ones are inserted. A stored player whose
 * ESPN position is outside FANTASY_POSITIONS (a fullback stored as RB and listed
 * FB, a long snapper) still gets his team written, with his stored name and
 * position kept. Runs daily on the
 * scheduler (`player-sync`, #2115, no credentials needed) and stays hand-runnable
 * from the admin dashboard or POST /api/scoring/sync-players.
 *
 * One fetch serves both team-level ESPN jobs: this reads `sharedRosterSweep`
 * (espnFactsSync.js), the same cached sweep the roster-status Sync run reads, so
 * whichever of the two runs first in a tick pays for the 32 `teamRoster` calls.
 * `sweep` is the test seam for it.
 *
 * This is the only writer of `nfl_team` (the injuries job moved to ESPN and no
 * longer touches it, #2115, ADR 0060) and never writes `injury_status` or
 * `injury_detail`, which belong to the ESPN injuries job alone.
 *
 * Team maintenance (#1385, #1391, moved here from the injuries job by #2115):
 * a player whose roster team differs from the stored one gets it written; a
 * player on NO roster is a No NFL team candidate and gets `nfl_team` cleared, but
 * only when the sweep was `complete` (all 32 teams answered - a failed or empty
 * team would otherwise read as its whole roster departing; this replaces the old
 * Tank01 list-size floor), and never while his own team has a kicked-off game in
 * an open week (`openKickoffTeams`). Practice squad and reserve athletes are on a
 * roster and keep their team. The result carries `teamChanges`, `teamsCleared`
 * and `teamsDeferred` for the run record.
 *
 * Sync run module (ADR 0036): runSyncJob owns fetch/apply, the transaction,
 * the advisory lock and the one data_sync_runs row per run, job 'players',
 * sharing PLAYERS_BULK_WRITE_LOCK with the other players-table-family jobs
 * (#1204). The one unit (every roster row) upserts in a single transaction: a
 * mid-run upsert failure rolls the whole unit back. Resolved shape:
 * `{ season, playersUpserted, skippedNonFantasy, rosterComplete, teamChanges,
 * teamsCleared, teamsDeferred }` - a roster set listing a duplicate id counts
 * it once in `playersUpserted` (#1251's JS-side dedup).
 *
 * The #1562 identity guard (a second Tank01 `playerID` minted for an athlete
 * already stored under his ESPN id) is gone with Tank01's ids: the roster's id IS
 * `external_id`, so there is no second id to fold.
 */
async function syncPlayers({ season, now = new Date(), sweep = sharedRosterSweep }) {
  const { results: [players] } = await runSyncJob({
    job: 'players',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: async () => {
      const { units, complete } = await sweep();
      return { units: [{ season, rows: units.flatMap((u) => u.rows), complete }], detail: { complete } };
    },
    apply: (client, unit) => applySyncPlayersUnit(client, unit, now),
  });
  return players;
}

/**
 * apply(client, unit) for the players job: runs inside runSyncJob's
 * withTransaction, under PLAYERS_BULK_WRITE_LOCK.
 *
 * One bulk `unnest` upsert (#1251), the same shape #904/#929 moved
 * `syncInjuries` to and Sleeper's `upsertSeasonStats` already uses: a
 * constant number of write statements per unit, independent of row count, so
 * the hold under 23004 stays short enough that a concurrent holder's wait
 * cannot reach pool.js's statement_timeout (15s web / 30s worker, SQLSTATE
 * 57014). `ON CONFLICT DO UPDATE` raises 21000 if the same `external_id`
 * appears twice in one statement, so a duplicate key within the batch is
 * deduped in JS first (last row wins, keyed by the NUMERIC external_id - the
 * actual ::int[] conflict target - so '4432' and '04432' collide) and counted
 * once in `playersUpserted`. An empty batch issues no write statement.
 */
async function applySyncPlayersUnit(client, { season, rows: rosterRows, complete = false }, now = new Date()) {
  const existing = await client.query(
    `SELECT "id", "external_id", "name", "position", "nfl_team" FROM "players" WHERE "external_id" IS NOT NULL`
  );
  const existingByExternalId = new Map(existing.rows.map((row) => [Number(row.external_id), row]));

  let skipped = 0;
  const byExternalId = new Map();
  // Every athlete on any roster, fantasy position or not: a stored player ESPN
  // still rosters is never a clear candidate, whatever position ESPN lists.
  const onRoster = new Set();
  for (const raw of rosterRows) {
    onRoster.add(Number(raw.athleteId));
    const parsed = normalizeRosterRow(raw);
    if (parsed) {
      byExternalId.set(Number(parsed.externalId), parsed);
      continue;
    }
    // Not a fantasy row as ESPN lists him (a non-fantasy position, or no name).
    // A STORED player still moves with his roster: write the roster team and keep
    // his stored name and position. An athlete we do not store is skipped.
    const stored = existingByExternalId.get(Number(raw.athleteId));
    if (!stored || !raw.teamCode) {
      skipped += 1;
      continue;
    }
    byExternalId.set(Number(raw.athleteId), {
      externalId: String(raw.athleteId),
      name: stored.name,
      position: stored.position,
      nflTeam: raw.teamCode,
      photoUrl: raw.photoUrl ?? null,
      jerseyNumber: raw.jerseyNumber ?? null,
    });
  }
  const rows = Array.from(byExternalId.values());

  if (rows.length > 0) {
    await client.query(
      `INSERT INTO "players" ("external_id", "name", "position", "nfl_team", "photo_url", "jersey_number")
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       ON CONFLICT ("external_id")
       DO UPDATE SET "name" = EXCLUDED."name", "position" = EXCLUDED."position",
                     "nfl_team" = EXCLUDED."nfl_team",
                     -- keep an existing headshot/jersey if the roster omits it
                     "photo_url" = COALESCE(EXCLUDED."photo_url", "players"."photo_url"),
                     "jersey_number" = COALESCE(EXCLUDED."jersey_number", "players"."jersey_number")`,
      [
        rows.map((r) => r.externalId),
        rows.map((r) => r.name),
        rows.map((r) => r.position),
        rows.map((r) => r.nflTeam),
        // null (not '') survives text[], so a roster that omits photo_url/jersey_number
        // keeps the stored value through the COALESCE above rather than clearing it.
        rows.map((r) => r.photoUrl),
        rows.map((r) => r.jerseyNumber),
      ]
    );
  }
  // Team maintenance (#1385, #1391). Moves first: a player a roster put on a
  // different real team than the stored one (compared through the Team code
  // fold, so a stored WSH is not a move to WAS).
  const touchedIds = [];
  let teamChanges = 0;
  for (const parsed of rows) {
    const stored = existingByExternalId.get(Number(parsed.externalId));
    if (stored && normalizeNflTeam(stored.nfl_team) !== parsed.nflTeam) {
      teamChanges += 1;
      touchedIds.push(stored.id);
    }
  }
  // Then clear candidates: a stored player with a team who is on no roster.
  // Never decided on a sweep with a gap (not `complete`).
  const clearCandidates = complete
    ? existing.rows.filter((player) => player.nfl_team && !onRoster.has(Number(player.external_id)))
    : [];
  // #1385 ruling (4'): a candidate is DEFERRED - his label kept exactly as
  // stored - while his own team has a kicked-off game in any OPEN week (a live
  // fantasy league's own current_season/current_week), bounded to the calendar
  // by #1391. The lookup runs at most once, and not at all for a run that
  // clears nobody.
  const deferredTeams = clearCandidates.length > 0 ? await openKickoffTeams(client) : new Set();
  const clearedIds = [];
  let teamsDeferred = 0;
  for (const player of clearCandidates) {
    if (deferredTeams.has(normalizeNflTeam(player.nfl_team))) teamsDeferred += 1;
    else clearedIds.push(player.id);
  }
  if (clearedIds.length > 0) {
    await client.query(
      `UPDATE "players" SET "nfl_team" = NULL WHERE "id" = ANY($1::int[])`,
      [clearedIds]
    );
  }
  await reconcileAfterWrite(client, [...touchedIds, ...clearedIds], now, 'player sync');
  return {
    season,
    playersUpserted: rows.length,
    skippedNonFantasy: skipped,
    rosterComplete: complete,
    teamChanges,
    teamsCleared: clearedIds.length,
    teamsDeferred,
  };
}

/**
 * Pull the real NFL schedule into nfl_games — one row per team per week,
 * keyed by Tank01 team abbreviations (matching players.nfl_team from
 * syncPlayers) — powering lineup locks and bye detection. One ESPN scoreboard
 * call per regular-season week (18; free and unmetered, #2116 and ADR 0060 —
 * Tank01 is the fallback and Final box only), all 18 issued before any write.
 * Reached only by hand (the admin and scoring routes); the daily writer is
 * syncScheduleFromNflverse. `transport` is the axios-like ESPN client (tests
 * inject).
 *
 * Sync run module (ADR 0036): runSyncJob owns fetch/apply, the transaction,
 * the advisory lock and the one data_sync_runs row per run, job 'schedule'.
 * `fetchScheduleUnits` keeps the per-week tolerance the old interleaved loop
 * had — a week whose call throws, or whose body is not an array, is skipped
 * and logged rather than failing the whole run — but every fetch now runs
 * BEFORE the single write transaction, so a throwing week can no longer leave
 * some weeks upserted and others not. If every week fails, the run is
 * fetch_failed and nothing is written (today's fully-empty-feed case left the
 * same nothing-written outcome, just with no run row to show it). Otherwise
 * one unit (every game fetched across all weeks) is written in one
 * transaction under NFL_GAMES_BULK_WRITE_LOCK — the same lock
 * syncScheduleFromNflverse takes, so an ESPN run and an nflverse run started
 * together serialize instead of interleaving their upserts (#1203).
 *
 * `failedWeeks` lives ONLY in the recorded data_sync_runs row: applyScheduleUnit's
 * return value is what runSyncJob both records as the run's detail AND
 * resolves to, so this wrapper strips failedWeeks back off before returning -
 * the pre-launch lead note's "Must NOT change: both functions' resolved
 * bodies... the routes see exactly what they see today" means the RESOLVED
 * VALUE (and so the JSON both routes forward), not the run detail.
 */
async function syncSchedule({ season, transport } = {}) {
  const { results: [{ season: resultSeason, gamesUpserted }] } = await runSyncJob({
    job: 'schedule',
    lock: NFL_GAMES_BULK_WRITE_LOCK,
    fetch: () => fetchScheduleUnits({ season, transport }),
    apply: (client, unit) => applyScheduleUnit(client, unit),
  });
  return { season: resultSeason, gamesUpserted };
}

/**
 * fetch() for the schedule job: runs before any transaction or lock. Issues
 * all 18 scoreboard calls (never short-circuits on a per-week failure)
 * and returns ONE unit — every normalized game across every week that
 * answered, plus the weeks that did not (`failedWeeks: [{ week, message }]`).
 * A week whose call throws, or whose response body is not an array, is
 * caught, logged and added to `failedWeeks`; every other week still
 * contributes its games. Throws (tagged `fetch_failed`) only when EVERY week
 * failed — there is then nothing to write, and the caller sees that as a
 * failed run instead of a silent zero.
 */
async function fetchScheduleUnits({ season, transport }) {
  const games = [];
  const failedWeeks = [];
  for (let week = 1; week <= 18; week++) {
    try {
      for (const { home, away, kickoffAt } of await fetchWeekGames({ season, week, transport })) {
        games.push({ week, home, away, kickoffAt });
      }
    } catch (err) {
      console.error('schedule sync failed for week %s:', week, err.message);
      failedWeeks.push({ week, message: err.message });
    }
  }
  if (failedWeeks.length === 18) {
    const allFailed = new Error('schedule sync: every week failed to fetch');
    allFailed.syncFailureReason = 'fetch_failed';
    throw allFailed;
  }
  return [{ season, games, failedWeeks }];
}

/**
 * apply(client, unit) for the schedule job: runs inside runSyncJob's
 * withTransaction, after the module has already taken
 * NFL_GAMES_BULK_WRITE_LOCK on this client. Same per-team upsert the old
 * per-week loop ran, unchanged — game_key/home_away are additive, and the
 * scoreboard's week fetch carries no venue, roof, surface or rest data, so those columns are left
 * exactly as they are (an nflverse schedule pass fills them in) — just run on
 * the transaction client instead of the bare pool, and once per fetched game
 * rather than interleaved with the fetch.
 *
 * This return value is what runSyncJob records as the run's data_sync_runs
 * detail (so `failedWeeks` is visible there) AND what it resolves to —
 * syncSchedule strips `failedWeeks` back off before returning to ITS caller,
 * so the two stay deliberately different.
 */
async function applyScheduleUnit(client, { season, games, failedWeeks }) {
  let upserted = 0;
  for (const { week, home, away, kickoffAt } of games) {
    const gameKey = buildGameKey({ season, week, away, home });
    for (const [team, opponent, side] of [
      [home, away, 'home'],
      [away, home, 'away'],
    ]) {
      await client.query(
        `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at", "game_key", "home_away")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("season", "week", "nfl_team")
         DO UPDATE SET "opponent" = EXCLUDED."opponent", "kickoff_at" = EXCLUDED."kickoff_at",
                       "game_key" = EXCLUDED."game_key", "home_away" = EXCLUDED."home_away"`,
        [season, week, team, opponent, kickoffAt, gameKey, side]
      );
      upserted += 1;
    }
  }
  return { season, gamesUpserted: upserted, failedWeeks };
}

// #2115: the document floor. A 200 answer that lists almost nobody (32 empty team
// groups, a truncated body) would otherwise read as the whole league healthy:
// every designation cleared and a "now healthy" alert for each. The real
// document lists 800 athletes in season (278 of them non-Active); the run is
// refused as fetch_failed when the document lists fewer than this many entries
// of any status, Active included: the guard is against an empty or truncated
// document, not a quiet week. INJURY_DOC_FLOOR tunes it.
function injuryDocFloor() {
  const raw = process.env.INJURY_DOC_FLOOR;
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
}

// #2115, ADR 0060: ESPN's injuries document uses exactly five designation
// strings. Exact match, no guessing; Active is healthy, like an unlisted player.
const ESPN_INJURY_STATUS = Object.freeze({
  Questionable: 'Q', Doubtful: 'D', Out: 'O', 'Injured Reserve': 'IR', Active: null,
});

/**
 * Injury sync (#2115, ADR 0060): ESPN's league-wide injuries document is the
 * only writer of `players.injury_status` and `players.injury_detail`. One free
 * GET, every player with an external_id written: listed Questionable, Doubtful,
 * Out and Injured Reserve map to Q, D, O and IR; Active and any player the
 * document does not list are cleared back to healthy. It no longer touches
 * `nfl_team` (the Tank01 player sync owns the player row, ADR 0060). Player-row
 * locks make overlapping manual/scheduled syncs observe transitions exactly
 * once; IR flag rows commit with the designation updates before best-effort
 * push.
 *
 * `now` (#1509, spec #1493 "UTC day everywhere"): the UTC calendar day this
 * run belongs to, computed once via `cadence.utcDateKey(now)` and carried as
 * `detail.day` on the recorded row. Defaults to `new Date()` so the router
 * callers (scoring.router.js, admin.router.js) are unchanged; the scheduler
 * (`runDailyInjurySync`) passes its own `now`. `day` is also the fingerprint's
 * day for the #2106 injury alerts. `fetchInjuries` is a test seam: production
 * always calls espnAthleteClient.injuries.
 */
async function syncInjuries({ fetchInjuries = espnAthleteClient.injuries, now = new Date() } = {}) {
  // Sync run module (ADR 0036): runSyncJob owns fetch/apply, the transaction,
  // the advisory lock and the one data_sync_runs row per run - the shape
  // #961 hand-rolled here is now written once, in server/modules/syncRun.js.
  // syncInjuries has TWO outcomes and no refusal: it returns, or it throws (a
  // document listing nobody we store is a legitimate ok=true run with
  // playersUpdated 0, not a refusal, so fetchInjuryUnits never returns
  // `{ refused: true }`). The IR flag push is deliberately OUTSIDE runSyncJob:
  // it must run only after the designation write has committed, and it is not
  // part of the shape the module owns.
  const day = cadence.utcDateKey(now);
  let irFlagsForPush = [];
  let injuryChanges = [];
  const { results: [result] } = await runSyncJob({
    job: 'injuries',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: () => fetchInjuryUnits(fetchInjuries, day),
    apply: (client, unit) => applyInjuryUnit(client, unit, (flags, changes) => {
      irFlagsForPush = flags;
      injuryChanges = changes;
    }, now),
  });
  try {
    const { sendIrFlagPushes } = require('./irPolicy.service');
    await sendIrFlagPushes(irFlagsForPush);
  } catch (error) {
    console.error('IR flag push failed:', error.message);
  }
  try {
    await sendInjuryAlerts(injuryChanges, day);
  } catch (error) {
    console.error('injury alert push failed:', error.message);
  }
  return result;
}

const INJURY_ALERT_LABELS = { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'IR' };

/**
 * #2106: after the unit commits, one `injuryAlerts` push per manager per player
 * whose designation changed, across every unfinished league that rosters him.
 * Each manager's url is his own first league's lineup page, so managers are
 * grouped by that url and sendPushOnce is called once per url; the ledger
 * dedupes per user.
 */
async function sendInjuryAlerts(changes, day) {
  if (changes.length === 0) return;
  const push = require('./push.service');
  const { rows } = await pool.query(
    `SELECT tp."player_id", tp."league_id", t."owner_id", p."name", p."injury_detail"
       FROM "team_players" tp
       JOIN "teams" t ON t."id" = tp."team_id"
       JOIN "players" p ON p."id" = tp."player_id"
       JOIN "leagues" l ON l."id" = tp."league_id"
      WHERE tp."player_id" = ANY($1::int[]) AND l."season_status" != 'complete'
      ORDER BY tp."league_id", tp."id"`,
    [changes.map((c) => c.playerId)]
  );
  for (const { playerId, currentDesignation } of changes) {
    const rostered = rows.filter((row) => row.player_id === playerId);
    if (rostered.length === 0) continue;
    const label = INJURY_ALERT_LABELS[currentDesignation] || 'healthy';
    const firstLeague = new Map(); // owner -> his lowest league_id (rows arrive ordered)
    for (const row of rostered) if (!firstLeague.has(row.owner_id)) firstLeague.set(row.owner_id, row.league_id);
    const ownersByLeague = new Map();
    for (const [owner, leagueId] of firstLeague) {
      ownersByLeague.set(leagueId, [...(ownersByLeague.get(leagueId) || []), owner]);
    }
    for (const [leagueId, userIds] of ownersByLeague) {
      await push.sendPushOnce({
        userIds,
        prefKey: 'injuryAlerts',
        kind: 'injury',
        subject: String(playerId),
        fingerprint: `${label}:${day}`,
        payload: {
          title: `${rostered[0].name} is now ${label}`,
          body: rostered[0].injury_detail || '',
          url: `/#/league/${leagueId}/lineup`,
        },
      });
    }
  }
}

/**
 * fetch() for the injuries job: runs before any transaction or lock. Returns
 * one unit - `{ feedByExternal }`, the ESPN document boiled down to `{ status:
 * 'Q'|'D'|'O'|'IR'|null, detail }` per athlete id - since this job's entire
 * feed is one atomic write (ADR 0036: "injuries: one unit"). An unknown ESPN
 * status string maps to null and is logged once per run. `day` (#1509) is
 * `syncInjuries`'s already-computed UTC day key, carried as run-level `detail`.
 */
async function fetchInjuryUnits(fetchInjuries, day) {
  const rows = await fetchInjuries();
  if (!Array.isArray(rows)) {
    // The client answers null for a failed GET and for a document with no team
    // groups; an empty league would otherwise read as everyone healthy.
    const err = new Error('ESPN injuries document unavailable');
    err.syncFailureReason = 'fetch_failed';
    throw err;
  }
  if (rows.length < injuryDocFloor()) {
    const err = new Error(`ESPN injuries document too small: ${rows.length} entries listed, floor ${injuryDocFloor()}`);
    err.syncFailureReason = 'fetch_failed';
    throw err;
  }
  const feedByExternal = new Map();
  const unknown = new Set();
  for (const row of rows) {
    const known = Object.prototype.hasOwnProperty.call(ESPN_INJURY_STATUS, row.status);
    if (!known) unknown.add(String(row.status));
    const status = known ? ESPN_INJURY_STATUS[row.status] : null;
    feedByExternal.set(String(row.athleteId), {
      status,
      // A healthy (Active) entry carries a news note, not an injury: no detail.
      detail: status && row.detail ? String(row.detail).slice(0, 255) : null,
    });
  }
  if (unknown.size > 0) {
    console.warn('injury sync: unknown ESPN status treated as healthy: %s', [...unknown].join(', '));
  }
  return { units: [{ feedByExternal }], detail: { day } };
}

/**
 * #1789: the cached engine's availability verdict goes stale the instant a
 * designation or an NFL team changes - `reconcileAvailability`
 * (projection.service.js) is the one place that recompute lives, scoped to
 * exactly `playerIds`. Runs on THIS transaction's client, deliberately, rather
 * than after commit: the reconcile's own read must see the write above without
 * a race window against a concurrent reader. A SAVEPOINT (not
 * `withTransaction`/a second unit) isolates it: `SAVEPOINT`/`RELEASE
 * SAVEPOINT`/`ROLLBACK TO SAVEPOINT` never close the pooled transaction
 * (#1723, the hand-rolled-transaction guard's own carve-out), so a reconcile
 * failure rolls back only its own work and never poisons or aborts the write
 * this unit already committed to - the "log and continue" rule every trigger of
 * this reconcile follows. No ids, no work.
 */
async function reconcileAfterWrite(client, playerIds, now, label) {
  if (playerIds.length === 0) return;
  try {
    const { reconcileAvailability, liveReconcileScope } = require('./projection.service');
    await client.query('SAVEPOINT reconcile_availability');
    const scope = await liveReconcileScope(client);
    if (scope) {
      await reconcileAvailability({ ...scope, playerIds, client, now });
    }
    await client.query('RELEASE SAVEPOINT reconcile_availability');
  } catch (err) {
    console.error('%s: availability reconcile failed, continuing:', label, err.message);
    try {
      await client.query('ROLLBACK TO SAVEPOINT reconcile_availability');
    } catch (rollbackErr) {
      console.error('%s: reconcile savepoint rollback failed:', label, rollbackErr.message);
    }
  }
}

/**
 * apply(client, unit) for the injuries job: runs inside runSyncJob's
 * withTransaction, after the module has already taken PLAYERS_BULK_WRITE_LOCK
 * on this client. `onIrFlags` hands the committed IR-flag rows back to
 * syncInjuries by closure, since the push they drive must fire only once this
 * transaction has committed - after runSyncJob resolves, not inside apply.
 * `now` is `syncInjuries`'s own already-computed clock, threaded through only
 * so the #1789 availability reconcile below can inject it (the practice-squad
 * 48h freshness check and the patched rows' `updated_at`); nothing else here
 * reads it.
 *
 * Returns exactly the shape recorded as this run's data_sync_runs detail on
 * success, and returned to syncInjuries's own caller: `{ playersUpdated,
 * irFlags }`. `playersUpdated` counts players the document listed.
 */
async function applyInjuryUnit(client, { feedByExternal }, onIrFlags, now = new Date()) {
  // SERIALIZED WITH syncAdp (#904). This scan locks near the whole players
  // table FOR UPDATE and holds to commit; syncAdp locks the same rows in a
  // different order across its wipe and bulk set. Both writers take one
  // transaction-scoped advisory lock (PLAYERS_BULK_WRITE_LOCK), taken by
  // runSyncJob as the FIRST statement after BEGIN, before any row lock, so
  // they cannot interleave into a deadlock cycle. Blocking xact form
  // (pg_advisory_xact_lock): the second sync waits rather than skipping. The
  // wait ends when the other sync's transaction finishes (no network I/O
  // inside either transaction, so it is short) OR when statement_timeout
  // fires (pool.js sets it on every pooled connection, 15s web / 30s worker,
  // and it counts lock-wait time), whichever comes first. The designation
  // write below is a SINGLE bulk statement (#929), not the ~3,000 sequential
  // single-row writes the per-player loop once took. The lock is
  // transaction-scoped, so it is held for the whole transaction: the scan,
  // that one bulk write, and the IR flag pass (flagRecoveredIrStashes, still
  // inside this transaction below - a select over the current IR stashes plus
  // one notify insert per flagged stash, usually none), released at COMMIT.
  // That is a far shorter hold than the loop's, so a 57014 cancellation of a
  // blocked wait is far less likely to be reached in the first place. The lock
  // releases with the transaction either way, so there is no explicit unlock
  // and nothing strands behind the pooler (#839): with COMMIT, with ROLLBACK,
  // or, when the ROLLBACK itself rejects, with the connection withTransaction
  // destroys, which drops the socket so Postgres frees the session's locks on
  // disconnect.
  const playersResult = await client.query(
    `SELECT "id", "external_id", "injury_status"
       FROM "players" WHERE "external_id" IS NOT NULL
       FOR UPDATE`
  );
  // Three parallel arrays (ids int[], statuses/details text[]) over EVERY
  // player with an external_id, mirroring syncAdp's bulk idiom: a player the
  // document does not list is healthy, so he is written null into both text
  // columns (nulls survive into the text[] as SQL NULL). transitions is built
  // over the same players and drives the IR flag pass and the #2106 alerts.
  const transitions = [];
  const ids = [];
  const statuses = [];
  const details = [];
  let listed = 0;
  for (const player of playersResult.rows) {
    const feed = feedByExternal.get(String(player.external_id));
    if (feed) listed += 1;
    const status = feed ? feed.status : null;
    ids.push(player.id);
    statuses.push(status);
    details.push(feed ? feed.detail : null);
    transitions.push({
      playerId: player.id,
      previousDesignation: player.injury_status,
      currentDesignation: status,
    });
  }
  // One bulk UPDATE. The IS DISTINCT FROM predicate against the target row p
  // skips no-op rows, so an unchanged row costs no write. Guarded on a
  // non-empty id list the way syncAdp guards its own bulk set.
  //
  // #1789: RETURNING carries back exactly the ids the predicate actually
  // wrote - a real designation change, never a no-op match - which is the
  // "changed ids" the availability reconcile below scopes to.
  let changedIds = [];
  if (ids.length > 0) {
    const updateResult = await client.query(
      `UPDATE "players" p
          SET "injury_status" = v."status", "injury_detail" = v."detail"
         FROM (SELECT unnest($1::int[]) AS "id",
                      unnest($2::text[]) AS "status",
                      unnest($3::text[]) AS "detail") v
        WHERE p."id" = v."id"
          AND (p."injury_status" IS DISTINCT FROM v."status"
               OR p."injury_detail" IS DISTINCT FROM v."detail")
        RETURNING p."id"`,
      [ids, statuses, details]
    );
    changedIds = updateResult.rows.map((row) => row.id);
  }
  await reconcileAfterWrite(client, changedIds, now, 'injury sync');
  const { flagRecoveredIrStashes } = require('./irPolicy.service');
  const irFlags = await flagRecoveredIrStashes(client, transitions);
  onIrFlags(irFlags, transitions.filter((tr) => (tr.previousDesignation ?? null) !== (tr.currentDesignation ?? null)));
  // playersUpdated counts players the document listed, not the statement's
  // rowCount: under the no-op predicate the two legitimately differ, and the
  // count an admin reads must not silently shrink to the handful of rows that
  // changed.
  return { playersUpdated: listed, irFlags: irFlags.length };
}

/**
 * #1385 ruling (4'), bounded by #1391's ruling: the set of Team codes (folded
 * through fn_normalize_nfl_team on both sides, CONTEXT.md's Team code) with a
 * kicked-off nfl_games row for any OPEN week - a (current_season,
 * current_week) pair belonging to a league whose fantasy season is live
 * (`fantasySeasonLiveWhereSql`, leaguePhase.js: the same rule the scheduler's
 * own live-week sync uses, scheduler.js's syncAndScoreLiveWeeks) - that is
 * STILL within one NFL week of the calendar. #1385 left "open week"
 * unbounded: one league whose commissioner stops advancing pinned every
 * departure on its current-week teams, for every league, until that league's
 * season completed. #1391's bound: with N = `deriveNflWeek` (the same pure
 * function the pick'em lifecycle uses, pickemSeason.service.js) over that
 * season's `getSeasonWeekBounds`, an open week `(S, W)` counts only while
 * `W >= N - 1` - the week in play and the week just finished, one NFL week of
 * grace for the commissioner to advance. A league two or more weeks behind
 * the calendar holds nobody's label; its clear candidates on that team clear
 * and count in teamsCleared instead of teamsDeferred. N is computed once per
 * distinct season among the open weeks, not once per league.
 *
 * A season whose OWN calendar has fully closed (`seasonHasClosed`,
 * pickemSeason.service.js) is bounded differently: `deriveNflWeek` saturates
 * at REG_SEASON_WEEKS once every week has closed (its own doc comment:
 * "answers 18 both for 'week 18 is being played' and 'everything is over'"),
 * so `W >= N - 1` alone would hold forever for a league parked at week 17 or
 * 18 of a season that finished seasons ago - exactly the unbounded pin this
 * ruling removes, surviving at the tail of the season. #1391's season-tail
 * amendment (https://github.com/andydarknessb/Endzone-Empire/issues/1391#issuecomment-5680673660)
 * gives the season's own LAST week (L, the largest week in `bounds`) one more
 * NFL week of grace past its own last kickoff (T), since it has no following
 * week to hold its grace the way every other week does: an open week counts
 * only while `W >= L` AND `now < T + CLOSED_SEASON_TAIL_GRACE_MS`. Once that
 * instant passes, the season holds nobody's label - a closed season past its
 * own tail grace has no lineup left to unlock, the same as a league two-plus
 * weeks behind a still-open calendar.
 *
 * A team in the returned set is mid-lineup-lock somewhere right now: clearing
 * a departed/blank player's label while his OWN team is in it would read as a
 * departure to removeLineupEntries' as-played spent-slot check (#627) for a
 * row that has already been played - risk-001 f1. Read at most once per
 * applyInjuryUnit run, and only when there is at least one clear candidate to
 * judge against it; a run with none never queries this at all. No live league
 * at all (nobody mid-season) answers the empty set with one query, not two.
 */
// #1391 season-tail amendment: the grace of "the week just finished" ends
// when the FOLLOWING week closes for every ordinary week; a season's own last
// week (18 with a full schedule) has no following week, so its grace instead
// ends one NFL week - seven days, the calendar's own period - after its own
// last kickoff, plus the same WEEK_ROLLOVER_GRACE_HOURS every other week's
// rollover already uses. Named and commented beside its one use in
// `openKickoffTeams` rather than reused from pickemSeason.service.js's
// WEEK_SPAN_DAYS, which is also seven days but names an unrelated fact (how
// far a rescheduled game may sit from its week's median kickoff before it
// stops holding that week open) - this is a grace period, not a staleness
// allowance, and the two must not drift together by accident.
const CLOSED_SEASON_TAIL_GRACE_DAYS = 7;

async function openKickoffTeams(client) {
  const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
  const {
    deriveNflWeek, getSeasonWeekBounds, seasonHasClosed, WEEK_ROLLOVER_GRACE_HOURS,
  } = require('./pickemSeason.service');
  const openWeeks = await client.query(
    `SELECT DISTINCT "current_season", "current_week" FROM "leagues"
      WHERE ${fantasySeasonLiveWhereSql()}`
  );
  if (openWeeks.rows.length === 0) return new Set();
  // #1391: bound each open week to the NFL calendar before it can hold any
  // team's departure. clock time, not the frozen transaction timestamp,
  // matters far less here than for the kickoff read below - the calendar
  // does not move mid-transaction - so `new Date()` is fine.
  const now = new Date();
  const tailGraceMs = (CLOSED_SEASON_TAIL_GRACE_DAYS * 24 * 60 * 60 * 1000)
    + (WEEK_ROLLOVER_GRACE_HOURS * 60 * 60 * 1000);
  const seasonStateBySeason = new Map();
  const boundedWeeks = [];
  for (const row of openWeeks.rows) {
    const season = row.current_season;
    if (!seasonStateBySeason.has(season)) {
      const bounds = await getSeasonWeekBounds({ season, db: client });
      const closed = seasonHasClosed(bounds, now);
      // seasonHasClosed true implies bounds saw at least one valid week, so
      // this reduce always has a row to start from when closed is true.
      const lastWeek = closed
        ? bounds.reduce((latest, bound) => (bound.week > latest.week ? bound : latest))
        : null;
      seasonStateBySeason.set(season, {
        nflWeek: deriveNflWeek(bounds, now),
        closed,
        tailWeek: lastWeek ? lastWeek.week : null,
        tailOpen: lastWeek ? now.getTime() < lastWeek.lastKickoffAt.getTime() + tailGraceMs : false,
      });
    }
    const { nflWeek, closed, tailWeek, tailOpen } = seasonStateBySeason.get(season);
    if (closed) {
      if (tailOpen && row.current_week >= tailWeek) boundedWeeks.push(row);
    } else if (row.current_week >= nflWeek - 1) {
      boundedWeeks.push(row);
    }
  }
  if (boundedWeeks.length === 0) return new Set();
  const seasons = boundedWeeks.map((row) => row.current_season);
  const weeks = boundedWeeks.map((row) => row.current_week);
  const kickedOff = await client.query(
    // clock_timestamp(), not NOW(): this is a long-held transaction (the
    // players FOR UPDATE scan plus the advisory-lock wait ahead of it), and
    // NOW()/transaction_timestamp() freezes at BEGIN - a game that kicks off
    // mid-transaction would otherwise read as not-yet-kicked-off here.
    `SELECT DISTINCT fn_normalize_nfl_team("ng"."nfl_team") AS "team"
       FROM "nfl_games" "ng"
       JOIN (SELECT unnest($1::int[]) AS "season", unnest($2::int[]) AS "week") "ow"
         ON "ng"."season" = "ow"."season" AND "ng"."week" = "ow"."week"
      WHERE "ng"."kickoff_at" <= clock_timestamp()`,
    [seasons, weeks]
  );
  return new Set(kickedOff.rows.map((row) => row.team));
}

/**
 * Fetch a week's real-world stats from Tank01: a box score per game that still
 * needs one (see gamesNeedingBoxScore) — every player in those games whose
 * external_id we know gets a player_stats upsert.
 *
 * The week's game list comes from live_game_states, which live scoring
 * (modules/liveGameEngine.js) keeps fresh for free off ESPN. For a week we have
 * no live rows for, it comes from the same free ESPN scoreboard (#2116,
 * ADR 0060); `espnTransport` is that client (tests inject). Tank01 is only
 * asked for the box scores.
 *
 * Returns typed touchdown events (`plays`) for the live UI — see
 * applyGameBoxScore (boxScoreApply.service.js).
 *
 * A Sync run (CONTEXT.md, ADR 0036, #1202): the target-list read above stays
 * a plain pool read (it decides WHAT to fetch, same as every job's setup),
 * then `runSyncJob({ job: 'week-stats', ... })` owns the shape from there -
 * fetchWeekStatsUnits pulls every target's box outside any transaction,
 * applyWeekStatsUnit writes one game per unit inside its own transaction, and
 * exactly one `data_sync_runs` row records the whole run. No job lock: the
 * writes are per-game `player_stats` rows, the same rows the Live box poll
 * upserts, and a slate-wide lock would stall it (ADR 0036).
 */
async function syncWeekStats({ season, week, pauseMs = 0, api, espnTransport }) {
  const stateRes = await pool.query(
    `SELECT "tank01_game_id", "game_status", "final_stats_synced_at"
       FROM "live_game_states" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );

  let targets;
  if (stateRes.rows.length > 0) {
    // A final inside its Final box grace belongs to the grace timer
    // (modules/finalBox): its one essential-priority fetch serves both the
    // stamp and the recap. Fetching it here first stamped the game and left
    // the timer's recap to fetch a second box (#1221, SF at LAR 2026-09-10).
    // Past the grace, or with no timer armed after a restart, this sync is
    // still the retry path for a Final box that failed (#1186 ruling).
    const finalBox = require('../modules/finalBox');
    targets = gamesNeedingBoxScore(stateRes.rows).filter((target) => {
      if (!finalBox.isWithinGrace(target.gameId)) return true;
      console.log('syncWeekStats: %s is inside its Final box grace; leaving it to the timer', target.gameId);
      return false;
    });
  } else {
    // No live rows for this week (a historical week, or live scoring has not
    // run yet; see modules/liveGameEngine.js): fall back to one free ESPN
    // scoreboard call and treat every game as needing a fetch.
    const games = await fetchWeekGames({ season, week, transport: espnTransport });
    targets = games.map((g) => ({ gameId: g.gameId, status: null, isFinal: false }));
  }

  const gamesSkipped = Math.max(stateRes.rows.length - targets.length, 0);
  if (targets.length === 0) {
    return { season, week, playersUpdated: 0, gamesProcessed: 0, gamesSkipped, plays: [] };
  }

  const maps = await loadWeekMaps({ season, week });
  // Mutated by fetchWeekStatsUnits, read back once runSyncJob resolves: fetch
  // fully completes before any unit is applied (runSyncJob awaits it first),
  // so this is never read while still being written.
  const failedFetches = [];

  const { results: applied } = await runSyncJob({
    job: 'week-stats',
    lock: null,
    fetch: () => fetchWeekStatsUnits({ targets, pauseMs, api, failedFetches }),
    apply: (client, unit) => applyWeekStatsUnit(client, unit, { season, week, maps }),
  });

  // Notify the Live box source switch (ADR 0035) once each Final box's
  // transaction has actually COMMITted - never from inside applyWeekStatsUnit
  // itself (qa-reviewer #1202 risk review): a rolled-back unit must not leave
  // the in-memory "Final box landed" memo out of step with the DB.
  const noteFinal = require('../modules/liveBox').noteFinalBoxApplied;
  for (const r of applied) {
    if (r && r.isFinal) noteFinal(r.gameId);
  }
  return {
    season,
    week,
    playersUpdated: applied.reduce((sum, r) => sum + (r ? r.updated : 0), 0),
    gamesProcessed: applied.length,
    gamesSkipped: gamesSkipped + failedFetches.length,
    plays: applied.flatMap((r) => (r ? r.plays : [])),
  };
}

/**
 * fetch() for the week-stats job (#1202): one Tank01 box-score call per
 * target game, at the same pauseMs cadence and the same quota cost as the
 * pre-Sync-run loop - fetch-all never adds calls. A game whose call fails is
 * pushed onto the caller's `failedFetches` and left out of the returned
 * units, rather than aborting the rest of the slate the way a bare throw
 * would; zero units on a slate with live targets is tagged `fetch_failed`
 * (ADR 0036) - Tank01 answered for none of the games this pass needed.
 *
 * Returns `{ units, detail: { skipped } }` (runSyncJob's fetch-detail wrapper,
 * #1202) rather than a bare units array: `skipped` is run-level detail - it
 * belongs to the WHOLE slate, not to any one game's own apply result - and a
 * slate with two or more units has no single result to carry it on. This is
 * what makes the recorded run's `detail.skipped` reliable regardless of how
 * many games ended up applying (formal review, PR #1244 f1).
 */
async function fetchWeekStatsUnits({ targets, pauseMs, api, failedFetches }) {
  const units = [];
  for (const target of targets) {
    try {
      // Backfill callers pace the box-score calls to stay under the provider's
      // per-second rate limit; live callers leave this at 0.
      if (pauseMs > 0 && units.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
      // Every target here is Final box work (gamesNeedingBoxScore) or a
      // historical week with no live rows. The Final box is the one Tank01
      // call we never shed, so it runs at essential priority (#1186); the
      // historical backfill keeps standard so it can be shed at budget.
      const boxResponse = await tank01Get('/getNFLBoxScore', {
        params: { gameID: target.gameId, playByPlay: 'true', fantasyPoints: 'false' },
        priority: target.isFinal ? 'essential' : 'standard',
        transport: api,
      });
      const box = tank01Body(boxResponse.data) || {};
      const liveBox = tank01BoxSource.fromBox(box);
      units.push({ target, liveBox });
    } catch (err) {
      console.error('Box fetch failed for game %s:', target.gameId, err.message);
      failedFetches.push(target.gameId);
    }
  }
  if (units.length === 0) {
    const error = new Error(`syncWeekStats: every box fetch failed (${targets.length} target(s))`);
    error.syncFailureReason = 'fetch_failed';
    throw error;
  }
  return { units, detail: { skipped: failedFetches } };
}

/**
 * apply() for the week-stats job (#1202): one game per unit, each in its own
 * transaction via runSyncJob/withTransaction (ADR 0036/0033), no job lock. A
 * unit that throws is recorded write_failed and rolled back by runSyncJob;
 * the units applied in earlier iterations stay applied, since each already
 * committed in its own transaction. The failed-fetch list is NOT carried on
 * this return value - it is run-level detail, not any one unit's, and rides
 * instead on fetchWeekStatsUnits' own `{ units, detail: { skipped } }`
 * wrapper, which runSyncJob merges into the recorded row regardless of how
 * many units applied (formal review, PR #1244 f1).
 *
 * Stamps `final_stats_synced_at` inside this unit's own transaction (so the
 * stamp commits or rolls back with that game's stats), but does NOT notify
 * the Live box source switch here - that's an in-memory memo, and firing it
 * before this unit's transaction actually COMMITs would leave it out of step
 * with the DB on a ROLLBACK (qa-reviewer #1202 risk review). The caller
 * notifies once runSyncJob resolves, keyed off `isFinal` in this return value.
 */
async function applyWeekStatsUnit(client, { target, liveBox }, { season, week, maps }) {
  // The Final box landing writes stats and emits no Scoring plays (the
  // switch-pass rule, ADR 0035): its numbers may exceed the last Live box
  // and that difference is not a new play.
  const result = await applyGameBoxScore({ liveBox, season, week, maps, suppressPlays: target.isFinal, client });
  // A final game's stats are now in: never fetch this box score again.
  if (target.isFinal) {
    await markFinalStatsSynced(target.gameId, client);
  }
  return {
    gameId: target.gameId,
    isFinal: target.isFinal,
    updated: result.updated,
    plays: result.plays,
  };
}

/** 'SAN FRANCISCO 49ERS' -> 'San Francisco 49ers'. */
function titleCase(str) {
  return str.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

/**
 * Pure: which of the 32 NFL teams (from NFL_TEAM_NAME_TO_ABBR, the same list
 * syncWeekStats already uses to match box-score DST aggregates) don't yet
 * have a DEF row, given the nfl_team values of the DEF rows that already
 * exist. Matches by abbreviation via normalizeTeamAbbr, so it's correct
 * regardless of whether an existing row stores a full name or an
 * abbreviation, and unresolvable/empty values are simply ignored.
 */
function missingTeamDefenses(existingNflTeams) {
  const existingAbbrs = new Set(
    (existingNflTeams || []).map((t) => normalizeTeamAbbr(t)).filter(Boolean)
  );
  const missing = [];
  for (const [fullNameUpper, abbr] of Object.entries(NFL_TEAM_NAME_TO_ABBR)) {
    if (existingAbbrs.has(abbr)) continue;
    missing.push(titleCase(fullNameUpper));
  }
  return missing;
}

/**
 * Backfill any of the 32 NFL teams missing a rosterable DEF (team defense)
 * unit. Unlike every other position, DEF units can't be discovered through
 * syncPlayers — Tank01's player list never returns individual DEF entries
 * (see normalizeTank01DstStats) — so they're seeded directly from the same
 * 32-team list syncWeekStats matches box scores against. Idempotent: safe to
 * re-run, since missingTeamDefenses skips any team that already has a row.
 *
 * Sync run module (ADR 0036): runSyncJob owns fetch/apply, the transaction,
 * the advisory lock and the one data_sync_runs row per run, job
 * 'team-defenses', sharing PLAYERS_BULK_WRITE_LOCK with the other players-
 * table-family jobs (#1204). The one unit (every missing team this fetch
 * found) inserts in a single transaction: a mid-run insert failure now rolls
 * the whole unit back instead of leaving the teams inserted before it (the
 * previous per-team try/catch swallowed and continued past a failure).
 * Resolved value is unchanged: `{ teamsInserted, totalDefTeams }`.
 */
async function syncTeamDefenses() {
  const { results: [teamDefenses] } = await runSyncJob({
    job: 'team-defenses',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: fetchTeamDefensesUnit,
    apply: (client, unit) => applyTeamDefensesUnit(client, unit),
  });
  return teamDefenses;
}

/**
 * fetch() for the team-defenses job: the existing-DEF-rows read, before any
 * transaction or lock. NOT closed by PLAYERS_BULK_WRITE_LOCK: this read runs
 * on the bare pool before the lock is taken, so two overlapping runs can both
 * read the same "missing" list before either inserts (the lock only
 * serializes the inserts themselves, into one after the other, not this
 * read). `players` carries no UNIQUE constraint over (name, position) to
 * catch the resulting double-insert - a pre-existing gap (the old
 * unlocked, uncoordinated code had the same window), not one this ticket
 * opened or closed.
 */
async function fetchTeamDefensesUnit() {
  const existing = await pool.query(`SELECT "nfl_team" FROM "players" WHERE "position" = 'DEF'`);
  const missing = missingTeamDefenses(existing.rows.map((r) => r.nfl_team));
  return [{ missing, existingCount: existing.rows.length }];
}

/** apply(client, unit) for the team-defenses job: runs inside runSyncJob's withTransaction, under PLAYERS_BULK_WRITE_LOCK. */
async function applyTeamDefensesUnit(client, { missing, existingCount }) {
  for (const name of missing) {
    await client.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'DEF', $1)`,
      [name]
    );
  }
  return { teamsInserted: missing.length, totalDefTeams: existingCount + missing.length };
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
 *
 * WARNING: an unscoped run upserts EVERY player:season pair and would clobber
 * the richer Sleeper-sourced offense/K rollups. Pass
 * `positions: DEFENSIVE_POSITIONS` (or run
 * scripts/backfill-defense-season-stats.js) to roll up DEF/IDP only — Sleeper
 * never writes rows for those positions, so the scoped upsert is safe.
 *
 * Sync run module (ADR 0036): runSyncJob owns fetch/apply, the transaction,
 * the advisory lock and the one data_sync_runs row per run, job
 * 'season-stats', sharing PLAYERS_BULK_WRITE_LOCK with the other
 * players-table-family jobs (#1204). The one unit (every player:season
 * rollup this fetch computed) upserts in a single transaction: a mid-run
 * upsert failure now rolls the whole unit back instead of leaving the rollups
 * upserted before it (the previous per-rollup try/catch swallowed and
 * continued past a failure). Resolved value is unchanged: `{ cutoffSeason,
 * seasonsUpserted }`.
 */
async function syncPlayerSeasonStats({ currentSeason, positions } = {}) {
  const { results: [seasonStats] } = await runSyncJob({
    job: 'season-stats',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: () => fetchSyncPlayerSeasonStatsUnit({ currentSeason, positions }),
    apply: (client, unit) => applySyncPlayerSeasonStatsUnit(client, unit),
  });
  return seasonStats;
}

/** fetch() for the season-stats job: the cutoff lookup and the weekly-rollup read, before any transaction or lock. */
async function fetchSyncPlayerSeasonStatsUnit({ currentSeason, positions } = {}) {
  let cutoff = Number(currentSeason);
  if (!Number.isInteger(cutoff)) {
    // Pick'em-only leagues are excluded from the derived cutoff: their
    // current_season is seeded from the NFL schedule at creation and can
    // reach the next season before any fantasy league rolls over, which
    // would widen "strictly before" into a season whose offense/K rollups
    // are still Sleeper-sourced (the clobber the WARNING above forbids).
    const r = await pool.query(
      `SELECT MAX("current_season") AS s FROM "leagues" WHERE ${fantasySideWhereSql()}`
    );
    cutoff = r.rows[0] && r.rows[0].s != null ? Number(r.rows[0].s) : 2026;
  }

  const scoped = Array.isArray(positions) && positions.length > 0;
  const weekly = scoped
    ? await pool.query(
        `SELECT "ps"."player_id", "ps"."season", "ps"."stats", "ps"."fantasy_points"
         FROM "player_stats" "ps"
         JOIN "players" "p" ON "p"."id" = "ps"."player_id"
         WHERE "ps"."season" < $1 AND "p"."position" = ANY($2)
         ORDER BY "ps"."player_id", "ps"."season"`,
        [cutoff, positions]
      )
    : await pool.query(
        `SELECT "player_id", "season", "stats", "fantasy_points" FROM "player_stats"
         WHERE "season" < $1
         ORDER BY "player_id", "season"`,
        [cutoff]
      );

  // Group weekly rows by player+season.
  const byKey = new Map();
  for (const row of weekly.rows) {
    const key = `${row.player_id}:${row.season}`;
    if (!byKey.has(key)) byKey.set(key, { playerId: row.player_id, season: row.season, rows: [] });
    byKey.get(key).rows.push(row);
  }

  return [{ cutoff, entries: Array.from(byKey.values()) }];
}

/**
 * apply(client, unit) for the season-stats job: runs inside runSyncJob's
 * withTransaction, under PLAYERS_BULK_WRITE_LOCK.
 *
 * One bulk `unnest` upsert (#1251), the exact column list and conflict
 * clause Sleeper's `upsertSeasonStats` already uses for the same table (the
 * shape is copied, not the function): a constant number of write statements
 * per unit, independent of row count. `entries` is already unique per
 * `player:season` from the fetch's grouping, so no JS-side dedup is needed
 * here the way the players job needs one. Sleeper's own writer now takes the
 * same 23004 lock inside its own transaction (see `sleeper.service.js`), so
 * the two writers of `player_season_stats` serialize instead of racing to a
 * deadlock. An empty batch issues no write statement.
 */
async function applySyncPlayerSeasonStatsUnit(client, { cutoff, entries }) {
  const rows = entries.map(({ playerId, season, rows: weekRows }) => {
    const { games, stats } = aggregateSeasonStats(weekRows.map((r) => r.stats));
    // Sum the stored weekly points rather than scoring the aggregate: the
    // teamDefense pointsAllowed/yardsAllowed rules are per-game tier tables,
    // so scoring a season total tier-matches once instead of once per week.
    // For linear categories the two are identical under default rules.
    const points = Math.round(weekRows.reduce((sum, r) => {
      // Careful: Number(null) is 0, which would silently score a missing week
      // as zero instead of recomputing it.
      const weekPoints = r.fantasy_points == null ? NaN : Number(r.fantasy_points);
      return sum + (Number.isFinite(weekPoints) ? weekPoints : calculateFantasyPoints(r.stats));
    }, 0) * 100) / 100;
    return { playerId, season, games, stats, points };
  });
  if (rows.length > 0) {
    await client.query(
      `INSERT INTO "player_season_stats" ("player_id", "season", "games_played", "stats", "fantasy_points")
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::jsonb[], $5::numeric[])
       ON CONFLICT ("player_id", "season")
       DO UPDATE SET "games_played" = EXCLUDED."games_played",
                     "stats" = EXCLUDED."stats",
                     "fantasy_points" = EXCLUDED."fantasy_points"`,
      [
        rows.map((r) => r.playerId),
        rows.map((r) => r.season),
        rows.map((r) => r.games),
        rows.map((r) => JSON.stringify(r.stats)),
        rows.map((r) => r.points),
      ]
    );
  }
  return { cutoffSeason: cutoff, seasonsUpserted: rows.length };
}

module.exports = {
  missingTeamDefenses,
  syncTeamDefenses,
  normalizeRosterRow,
  IDP_POSITIONS,
  DEFENSIVE_POSITIONS,
  syncWeekStats,
  syncSchedule,
  syncInjuries,
  syncPlayers,
  syncPlayerSeasonStats,
};
