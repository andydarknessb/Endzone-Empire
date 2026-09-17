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
const { runSyncJob } = require('../modules/syncRun');
const cadence = require('../modules/cadence');
const { POSITION_GROUPS } = require('./lineup.service');
const { normalizeNflTeam } = require('./nflTeam');
const { fantasySideWhereSql } = require('./leagueType');
const { calculateFantasyPoints } = require('./scoringRules');
const {
  tank01Body, normalizeTeamAbbr, NFL_TEAM_NAME_TO_ABBR, buildGameKey, normalizeTank01Game, resolveHeadshotUrl,
} = require('./tank01Feed');
const {
  loadWeekMaps, applyGameBoxScore, gamesNeedingBoxScore, markFinalStatsSynced,
} = require('./boxScoreApply.service');
const { aggregateSeasonStats } = require('./seasonSummary.service');
const tank01BoxSource = require('./tank01BoxSource');

// Fantasy-relevant positions — Tank01's full player list includes every
// position (OL, C, G, ...); only these are useful in a lineup. Individual
// defenders (DL/LB/DB group members — DE/DT/NT/LB/ILB/OLB/CB/S/FS/SS) are
// included so DP-enabled leagues can roster them; they keep their specific
// Tank01 position for display (see lineup.service.js's POSITION_GROUPS,
// which expands DL/LB/DB slot eligibility to match).
const FANTASY_POSITIONS = new Set([
  'QB', 'RB', 'WR', 'TE', 'K', 'PK', 'DEF',
  ...POSITION_GROUPS.DL, ...POSITION_GROUPS.LB, ...POSITION_GROUPS.DB,
]);

// Individual-defender position codes as stored on players rows (Tank01's
// specific codes, not the DL/LB/DB roster-group keys).
const IDP_POSITIONS = [...POSITION_GROUPS.DL, ...POSITION_GROUPS.LB, ...POSITION_GROUPS.DB];

// Every position whose season rollups come from our own player_stats weeklies
// rather than the Sleeper season sync (which covers offense/K only). Safe to
// pass to syncPlayerSeasonStats({ positions }) — Sleeper never writes rows for
// these positions, so a scoped upsert cannot clobber a Sleeper rollup.
const DEFENSIVE_POSITIONS = ['DEF', ...IDP_POSITIONS];

/**
 * The NFL team a getNFLPlayerList entry actually places a player on, or null
 * for No NFL team (CONTEXT.md). Tank01 keeps a player who has left the NFL
 * in the list under his LAST team with `isFreeAgent: "True"` (2026-09-15:
 * 1,527 of 3,872 entries, every one still carrying a team label; Joe Mixon
 * "team":"HOU" six months after Houston released him). Reading `team` alone
 * kept every one of them rostered, projected at his old per-game pace and
 * ranked as a waiver Upgrade. The one reading both writers share, so the
 * unattended injury sync and the hand-run player sync can never disagree
 * about who is on a roster.
 */
function feedTeamOf(entry) {
  if (!entry || String(entry.isFreeAgent).toLowerCase() === 'true') return null;
  return entry.team ? String(entry.team) : null;
}

/**
 * Normalize one entry from Tank01's getNFLPlayerList into our player shape.
 * Returns null for entries missing an id, name, or position, and for
 * non-fantasy positions. Tank01 calls kickers 'PK' — stored as 'K' to match
 * our slot eligibility. Also carries a resolved headshot URL and jersey
 * number (both null when the feed omits them).
 *
 * Exported as a test-only seam (a player normaliser), not cross-module
 * interface: no other module calls this directly.
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
    nflTeam: feedTeamOf(entry),
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
 *
 * INSERTING new players is what this is for now. It is no longer the only
 * thing keeping an EXISTING player's team current: the daily injury sync reads
 * the same feed and corrects nfl_team on every run, so a roster move no longer
 * waits for someone to remember to press this. The one thing that
 * still needs a hand-run is a player who is not in our table at all.
 *
 * Note the two writers differ on a blank team on purpose: this one writes the
 * feed's null through (a hand-run sync is a deliberate act, and clearing a
 * released player is a legitimate outcome of it), while the unattended daily
 * pass keeps the existing label instead.
 *
 * Sync run module (ADR 0036): runSyncJob owns fetch/apply, the transaction,
 * the advisory lock and the one data_sync_runs row per run, job 'players',
 * sharing PLAYERS_BULK_WRITE_LOCK with the other players-table-family jobs
 * (#1204). The one unit (every parsed feed entry) upserts in a single
 * transaction: a mid-run upsert failure now rolls the whole unit back instead
 * of leaving the players upserted before it (the previous per-player
 * try/catch swallowed and continued past a failure). Resolved shape is
 * unchanged: `{ season, playersUpserted, skippedNonFantasy }` - but a feed
 * carrying a duplicate `external_id` now counts it once in `playersUpserted`
 * (#1251's JS-side dedup, applySyncPlayersUnit's own docblock), where the old
 * per-row loop counted it twice.
 */
async function syncPlayers({ season, api = tank01Get }) {
  return runSyncJob({
    job: 'players',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: () => fetchSyncPlayersUnit({ season, api }),
    apply: (client, unit) => applySyncPlayersUnit(client, unit),
  });
}

/**
 * fetch() for the players job: the Tank01 player-list call, before any
 * transaction or lock. `api` mirrors syncSchedule/syncInjuries's own
 * injectable default (`api = tank01Get`) — a test seam, not a behavior
 * change: production always calls the real tank01Get.
 */
async function fetchSyncPlayersUnit({ season, api }) {
  const response = await api('/getNFLPlayerList');
  const entries = tank01Body(response.data) || [];
  if (!Array.isArray(entries)) {
    const err = new Error('unexpected getNFLPlayerList response shape');
    err.statusCode = 502;
    err.syncFailureReason = 'bad_response';
    throw err;
  }
  return [{ season, entries }];
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
 * deduped in JS first (last entry wins) and counted once in
 * `playersUpserted`. An empty batch (every entry skipped) issues no write
 * statement, mirroring `syncInjuries`/`syncAdp`'s own guard.
 */
async function applySyncPlayersUnit(client, { season, entries }) {
  let skipped = 0;
  // Keyed by the NUMERIC external_id (the actual ::int[] conflict target),
  // not the parsed string, so two entries whose ids differ as text but
  // coincide as integers ('4432' vs '04432') still collide in JS instead of
  // reaching ON CONFLICT DO UPDATE as two array elements for the same row
  // (21000, qa-reviewer #1251). A duplicate within one feed batch keeps only
  // its last entry - the per-row loop's last-write-wins tolerance, preserved
  // here in JS instead.
  const byExternalId = new Map();
  for (const raw of entries) {
    const parsed = normalizePlayerEntry(raw);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    byExternalId.set(Number(parsed.externalId), parsed);
  }
  const rows = Array.from(byExternalId.values());
  if (rows.length > 0) {
    await client.query(
      `INSERT INTO "players" ("external_id", "name", "position", "nfl_team", "photo_url", "jersey_number")
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       ON CONFLICT ("external_id")
       DO UPDATE SET "name" = EXCLUDED."name", "position" = EXCLUDED."position",
                     "nfl_team" = EXCLUDED."nfl_team",
                     -- keep an existing headshot/jersey if a later feed omits it
                     "photo_url" = COALESCE(EXCLUDED."photo_url", "players"."photo_url"),
                     "jersey_number" = COALESCE(EXCLUDED."jersey_number", "players"."jersey_number")`,
      [
        rows.map((r) => r.externalId),
        rows.map((r) => r.name),
        rows.map((r) => r.position),
        rows.map((r) => r.nflTeam),
        // null (not '') survives text[], so a feed that omits photo_url/jersey_number
        // keeps the stored value through the COALESCE above rather than clearing it.
        rows.map((r) => r.photoUrl),
        rows.map((r) => r.jerseyNumber),
      ]
    );
  }
  return { season, playersUpserted: rows.length, skippedNonFantasy: skipped };
}

/**
 * Pull the real NFL schedule into nfl_games — one row per team per week,
 * keyed by Tank01 team abbreviations (matching players.nfl_team from
 * syncPlayers) — powering lineup locks and bye detection. One
 * getNFLGamesForWeek call per regular-season week (18, never more — Tank01 is
 * quota-metered), all 18 issued before any write.
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
 * syncScheduleFromNflverse takes, so a Tank01 run and an nflverse run started
 * together serialize instead of interleaving their upserts (#1203).
 *
 * `failedWeeks` lives ONLY in the recorded data_sync_runs row: applyScheduleUnit's
 * return value is what runSyncJob both records as the run's detail AND
 * resolves to, so this wrapper strips failedWeeks back off before returning -
 * the pre-launch lead note's "Must NOT change: both functions' resolved
 * bodies... the routes see exactly what they see today" means the RESOLVED
 * VALUE (and so the JSON both routes forward), not the run detail.
 */
async function syncSchedule({ season, api = tank01Get } = {}) {
  const { season: resultSeason, gamesUpserted } = await runSyncJob({
    job: 'schedule',
    lock: NFL_GAMES_BULK_WRITE_LOCK,
    fetch: () => fetchScheduleUnits({ season, api }),
    apply: (client, unit) => applyScheduleUnit(client, unit),
  });
  return { season: resultSeason, gamesUpserted };
}

/**
 * fetch() for the schedule job: runs before any transaction or lock. Issues
 * all 18 getNFLGamesForWeek calls (never short-circuits on a per-week
 * failure, since Tank01's quota is metered per call regardless of outcome)
 * and returns ONE unit — every normalized game across every week that
 * answered, plus the weeks that did not (`failedWeeks: [{ week, message }]`).
 * A week whose call throws, or whose response body is not an array, is
 * caught, logged and added to `failedWeeks`; every other week still
 * contributes its games. Throws (tagged `fetch_failed`) only when EVERY week
 * failed — there is then nothing to write, and the caller sees that as a
 * failed run instead of a silent zero.
 */
async function fetchScheduleUnits({ season, api }) {
  const games = [];
  const failedWeeks = [];
  for (let week = 1; week <= 18; week++) {
    try {
      const response = await api('/getNFLGamesForWeek', {
        params: { week, seasonType: 'reg', season },
      });
      const weekGames = tank01Body(response.data) || [];
      if (!Array.isArray(weekGames)) {
        throw new Error('unexpected getNFLGamesForWeek response shape');
      }
      for (const entry of weekGames) {
        const game = normalizeTank01Game(entry);
        if (!game) continue;
        games.push({ week, ...game });
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
 * per-week loop ran, unchanged — game_key/home_away are additive, and Tank01
 * carries no venue, roof, surface or rest data, so those columns are left
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

/**
 * Map a RapidAPI injury designation to our badge codes (Q/D/O/IR).
 *
 * Exported as a test-only seam (an injury normaliser), not cross-module
 * interface: no other module calls this directly.
 */
function normalizeInjuryStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return null;
  if (s.includes('injured reserve') || /\bir\b/.test(s)) return 'IR';
  if (s.includes('question')) return 'Q';
  if (s.includes('doubt')) return 'D';
  if (s.includes('out')) return 'O';
  return null;
}

// #1385: the size floor the unattended injury pass judges its own feed
// against before it trusts a departure. A player absent from
// getNFLPlayerList (or listed with no team) reads as "left the NFL" only
// when the feed itself looks like a real player list; a short or truncated
// response must never be able to read as the whole league departing at
// once. An absolute floor over the UNFILTERED feed (not FANTASY_POSITIONS,
// and not derived at runtime from a prior run - ruling (2)'s "a constant
// near the observed list size"). Observed (formal-001 f1, a project-lead
// read-only prod query, 2026-09-15): data_sync_runs' injuries runs report
// playersUpdated 3254 - itself a LOWER bound, since it counts only feed
// entries that matched a stored players row, never the feed's own total
// length. Set with roughly 250 of headroom below that observed floor for
// ordinary day-to-day roster churn (a cut, a signing, a practice-squad
// churn shifting who matches), while staying close enough that a feed
// truncated to a fraction of the real list still trips it - unlike the
// prior 1500, which a ~1,600-entry truncation would have cleared.
const NFL_PLAYER_LIST_FLOOR = 3000;

/**
 * Injury sync: Tank01's player list carries each player's current injury
 * designation AND his current team, so one getNFLPlayerList call refreshes
 * both. Players with no current designation are cleared back to healthy; a
 * player the feed has moved gets his nfl_team corrected in the same bulk write.
 * This is the only UNATTENDED writer of that column — syncPlayers is manual —
 * so without it a team label frozen at the last hand-run sync survives every
 * signing, trade and practice-squad elevation for the rest of the season. Player-row locks make overlapping manual/scheduled syncs observe
 * transitions exactly once; IR flag rows commit with the designation updates
 * before best-effort push.
 *
 * `now` (#1509, spec #1493 "UTC day everywhere"): the UTC calendar day this
 * run belongs to, computed once via `cadence.utcDateKey(now)` and carried as
 * `detail.day` on the recorded row alongside `floorGuardTripped` (both are
 * run-level, not any one unit's own apply result). Defaults to `new Date()`
 * so the router caller (scoring.router.js) and admin.router.js are unchanged;
 * the scheduler (`runDailyInjurySync`) passes its own `now` outside a game
 * window, where the cadence gate (server/modules/cadence.js) reads this same
 * `detail.day` back.
 *
 * #1385: this is also the only writer that ever clears nfl_team for a player
 * who has left the NFL - present in our table but absent from the feed, or
 * present with no team - and it does so only when the feed cleared
 * NFL_PLAYER_LIST_FLOOR (see applyInjuryUnit). A cleared nfl_team is a
 * display fact only (CONTEXT.md's No NFL team): it locks nothing and refuses
 * no start. Ruling (4'): the clear is itself deferred - his label kept
 * exactly as stored - while his own team has a kicked-off game in a live
 * league's current week (openKickoffTeams), since the lock helper reads this
 * same column live and a departure clear mid-lock would unlock an as-played
 * row (risk-001 f1, #627).
 */
async function syncInjuries({ api = tank01Get, now = new Date() } = {}) {
  // Sync run module (ADR 0036): runSyncJob owns fetch/apply, the transaction,
  // the advisory lock and the one data_sync_runs row per run - the shape
  // #961 hand-rolled here is now written once, in server/modules/syncRun.js.
  // syncInjuries has TWO outcomes and no refusal: it returns, or it throws (an
  // empty or fully unmatched feed is a legitimate ok=true run with
  // playersUpdated 0, not a refusal, so fetchInjuryUnits never returns
  // `{ refused: true }`). The IR flag push is deliberately OUTSIDE runSyncJob:
  // it must run only after the designation write has committed, and it is not
  // part of the shape the module owns.
  const day = cadence.utcDateKey(now);
  let irFlagsForPush = [];
  const result = await runSyncJob({
    job: 'injuries',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: () => fetchInjuryUnits(api, day),
    apply: (client, unit) => applyInjuryUnit(client, unit, (flags) => { irFlagsForPush = flags; }),
  });
  try {
    const { sendIrFlagPushes } = require('./irPolicy.service');
    await sendIrFlagPushes(irFlagsForPush);
  } catch (error) {
    console.error('IR flag push failed:', error.message);
  }
  return result;
}

/**
 * fetch() for the injuries job: runs before any transaction or lock. Returns
 * one unit - `{ feedByExternal, floorGuardTripped }`, the whole Tank01 player
 * list boiled down to what apply needs - since this job's entire feed is one
 * atomic write (ADR 0036: "injuries: one unit, the Tank01 player list").
 * `floorGuardTripped` is also carried as run-level `detail` (#1202) so a
 * short feed's guard state is logged on the run's data_sync_runs row even
 * though it belongs to the whole run, not to apply's own result. `day`
 * (#1509) is `syncInjuries`'s already-computed UTC day key, carried
 * alongside `floorGuardTripped` in the same run-level `detail`.
 */
async function fetchInjuryUnits(api, day) {
  let response;
  try {
    response = await api('/getNFLPlayerList');
  } catch (error) {
    // Upstream: the Tank01 call itself threw. Tagged here because such an error
    // carries no statusCode, so it cannot be told apart from a database failure
    // downstream without a tag - the exact conflation finding 1 called out.
    // runSyncJob tags an untagged throw fetch_failed anyway; this tag is set
    // explicitly so the site that knows WHY (an upstream call) says so.
    error.syncFailureReason = error.syncFailureReason || 'fetch_failed';
    throw error;
  }
  const entries = tank01Body(response.data) || [];
  if (!Array.isArray(entries)) {
    const err = new Error('unexpected getNFLPlayerList response shape');
    err.statusCode = 502;
    err.syncFailureReason = 'bad_response';
    throw err;
  }
  // getNFLPlayerList carries each player's CURRENT team alongside the injury
  // designation, so this one call refreshes both. `team` is read exactly
  // the way normalizePlayerEntry reads it for syncPlayers, so both
  // writers put the same vocabulary (Tank01's raw abbreviation, WSH not WAS)
  // into players.nfl_team and the nfl_games join keeps working.
  const feedByExternal = new Map();
  for (const entry of entries) {
    if (!entry || entry.playerID == null) continue;
    const injury = entry.injury || {};
    feedByExternal.set(String(entry.playerID), {
      status: normalizeInjuryStatus(injury.designation),
      detail: injury.description ? String(injury.description).slice(0, 255) : null,
      // null for a player the feed lists with no team, flags as off every
      // roster, or omits entirely (No NFL team, CONTEXT.md). Whether that
      // null actually clears the stored label depends on floorGuardTripped
      // below, checked once in applyInjuryUnit rather than per row here.
      team: feedTeamOf(entry),
    });
  }
  // #1385: below the floor, the feed is too small to trust as a real player
  // list - a transient truncation must never read as the whole league
  // departing at once - so applyInjuryUnit clears no nfl_team this run.
  const floorGuardTripped = feedByExternal.size < NFL_PLAYER_LIST_FLOOR;
  return { units: [{ feedByExternal, floorGuardTripped }], detail: { day, floorGuardTripped } };
}

/**
 * apply(client, unit) for the injuries job: runs inside runSyncJob's
 * withTransaction, after the module has already taken PLAYERS_BULK_WRITE_LOCK
 * on this client. `onIrFlags` hands the committed IR-flag rows back to
 * syncInjuries by closure, since the push they drive must fire only once this
 * transaction has committed - after runSyncJob resolves, not inside apply.
 *
 * Returns exactly the shape recorded as this run's data_sync_runs detail on
 * success, and returned to syncInjuries's own caller: `{ playersUpdated,
 * irFlags, teamChanges, teamsCleared, teamsDeferred }`.
 */
async function applyInjuryUnit(client, { feedByExternal, floorGuardTripped }, onIrFlags) {
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
    `SELECT "id", "external_id", "injury_status", "nfl_team"
       FROM "players" WHERE "external_id" IS NOT NULL
       FOR UPDATE`
  );
  // Build four parallel arrays (ids int[], statuses/details/teams text[]) over
  // every feed match - resolved immediately in the first loop below, or a
  // clear candidate resolved once deferral is known in the second - mirroring
  // syncAdp's bulk idiom. A cleared designation writes null into both text
  // columns, and nulls survive into the text[] as SQL NULL. transitions is
  // built over the SAME matches and drives both playersUpdated and the IR
  // flag pass, independent of which rows the statement actually writes or
  // which of the two loops appended them (the bulk UPDATE and
  // flagRecoveredIrStashes are both order-independent over these arrays).
  //
  // #1385: departedIds is separate from ids/statuses/details/teams on purpose.
  // A player absent from the feed gets no `feed` entry at all, so there is no
  // designation or detail to write for him - only nfl_team, cleared by its own
  // bulk UPDATE below rather than by widening this statement's arrays with
  // values that would no-op the other two columns.
  const transitions = [];
  const ids = [];
  const statuses = [];
  const details = [];
  const teams = [];
  const departedIds = [];
  let teamChanges = 0;
  let teamsCleared = 0;
  let teamsDeferred = 0;
  // #1385 ruling (4'): a clear candidate - absent from the feed, or listed
  // with a blank team, with floorGuardTripped allowing a clear at all - is
  // not decided here. Clearing his label is only safe once we know whether
  // his OWN team currently has an open week's game already kicked off
  // (openKickoffTeams below); collecting candidates first means that lookup
  // runs at most once per run, and not at all for the common run that clears
  // nobody.
  const clearCandidates = []; // { player, feed: feed-match or null for absent }
  // formal-001 f4: the append-one-feed-match shape (push the same row onto
  // all four parallel arrays plus transitions) is identical at every site
  // that resolves a feed match - only the team value differs - so it is
  // written once here instead of three times, keeping a future fifth column
  // from drifting out of sync at one of the three sites.
  const pushMatch = (player, feed, team) => {
    ids.push(player.id);
    statuses.push(feed.status);
    details.push(feed.detail);
    teams.push(team);
    transitions.push({
      playerId: player.id,
      previousDesignation: player.injury_status,
      currentDesignation: feed.status,
    });
  };
  for (const player of playersResult.rows) {
    const feed = feedByExternal.get(String(player.external_id));
    if (!feed) {
      // Not in the feed at all: below NFL_PLAYER_LIST_FLOOR this stays exactly
      // the old behavior (leave untouched - a short feed must never read as a
      // departure).
      if (!floorGuardTripped && player.nfl_team) clearCandidates.push({ player, feed: null });
      continue;
    }
    if (feed.team === null && !floorGuardTripped && player.nfl_team) {
      // A blank team, at or above the floor: same candidacy as an absent
      // player (CONTEXT.md's No NFL team), decided in the same place below.
      clearCandidates.push({ player, feed });
      continue;
    }
    // Every other case resolves immediately: a real team from the feed (a
    // move or a same-team confirmation), or a blank team kept as the stored
    // label because the floor tripped - the old behavior, unconditionally.
    const team = feed.team !== null ? feed.team : player.nfl_team;
    if (team !== player.nfl_team) teamChanges += 1;
    pushMatch(player, feed, team);
  }
  // #1385 ruling (4'): a clear candidate is DEFERRED - his label kept exactly
  // as stored - while his own team has a kicked-off game in any OPEN week (a
  // live fantasy league's own current_season/current_week). Deferring keeps
  // removeLineupEntries' as-played spent-slot check (#627) working off a real
  // team for exactly as long as that team's current week can still matter;
  // the first run after every league carrying it advances past that week
  // clears him normally. risk-001 f1: this is why the lock helper itself
  // stays untouched.
  const deferredTeams = clearCandidates.length > 0 ? await openKickoffTeams(client) : new Set();
  for (const { player, feed } of clearCandidates) {
    const deferred = deferredTeams.has(normalizeNflTeam(player.nfl_team));
    if (deferred) {
      teamsDeferred += 1;
      if (!feed) continue; // absent + deferred: untouched, same as below the floor
      // A blank-team feed match still refreshes his designation/detail
      // normally; only the team stays (the SAME row shape every other feed
      // match takes, just with the stored team instead of null).
      pushMatch(player, feed, player.nfl_team);
      continue;
    }
    teamsCleared += 1;
    if (!feed) {
      departedIds.push(player.id);
      continue;
    }
    pushMatch(player, feed, null);
  }
  // One bulk UPDATE replaces the per-player loop. The three-column
  // IS DISTINCT FROM predicate against the target row p skips no-op rows (all
  // three columns unchanged), so an unchanged row costs no write and the FOR
  // UPDATE scan does not need widening to compare injury_detail in JS. Guarded
  // on a non-empty id list the way syncAdp guards its own bulk set.
  if (ids.length > 0) {
    await client.query(
      `UPDATE "players" p
          SET "injury_status" = v."status", "injury_detail" = v."detail",
              "nfl_team" = v."team"
         FROM (SELECT unnest($1::int[]) AS "id",
                      unnest($2::text[]) AS "status",
                      unnest($3::text[]) AS "detail",
                      unnest($4::text[]) AS "team") v
        WHERE p."id" = v."id"
          AND (p."injury_status" IS DISTINCT FROM v."status"
               OR p."injury_detail" IS DISTINCT FROM v."detail"
               OR p."nfl_team" IS DISTINCT FROM v."team")`,
      [ids, statuses, details, teams]
    );
  }
  // #1385: the departure clear is its own bulk statement, touching only
  // nfl_team - a player the feed does not list at all has no status/detail
  // value to carry through the statement above.
  if (departedIds.length > 0) {
    await client.query(
      `UPDATE "players" SET "nfl_team" = NULL WHERE "id" = ANY($1::int[])`,
      [departedIds]
    );
  }
  const { flagRecoveredIrStashes } = require('./irPolicy.service');
  const irFlags = await flagRecoveredIrStashes(client, transitions);
  onIrFlags(irFlags);
  // playersUpdated counts feed matches (the length of transitions), not the
  // statement's rowCount: under the no-op predicate the two legitimately
  // differ, and the count an admin reads must not silently shrink to the
  // handful of rows that changed. It does not count a departure clear -
  // teamsCleared is that signal instead, since a departed player carries no
  // feed match (no designation, no detail) to call an "update" of him.
  //
  // teamChanges counts the matches whose nfl_team the feed moved to a
  // DIFFERENT team. It is the only signal that this pass is keeping team
  // labels current at all: a stale label is invisible until it misroutes
  // something (the bug behind this was found because a player's stat line
  // landed in a week his listed team had not played), and a run that silently
  // stopped correcting teams reads as a healthy run without it. Expect a
  // handful in-season and 0 on a quiet day.
  //
  // teamsCleared (#1385) counts every player whose label went to null this
  // run - absent from the feed, or listed with no team - which is a
  // DEPARTURE, not a move, and is kept out of teamChanges so the two counters
  // answer two different questions: how many players changed teams, and how
  // many left the NFL. teamsCleared stays 0 below NFL_PLAYER_LIST_FLOOR by
  // construction (floorGuardTripped short-circuits both sites that would
  // otherwise set it). teamChanges does NOT: a real move to a different team
  // reported by the feed is still counted and still written below the floor -
  // the floor guards only a departure/blank reading as a clear, not the
  // pass's ordinary team-correction behavior, which predates #1385 unchanged.
  //
  // teamsDeferred (#1385 ruling (4')) counts every clear candidate held back
  // this run because his own team still has a kicked-off game in an OPEN
  // week - the risk-001 f1 fix: clearing him now would read as a departure
  // to removeLineupEntries' as-played check (#627) for a slot that has
  // already been played. A deferred player is untouched, same as one below
  // the floor; the next run he is still a candidate, and clears (or defers
  // again, if a different league is still on that week) exactly the same way.
  return {
    playersUpdated: transitions.length,
    irFlags: irFlags.length,
    teamChanges,
    teamsCleared,
    teamsDeferred,
  };
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
 * (modules/liveGameEngine.js) keeps fresh for free off ESPN, so the old
 * always-on `/getNFLGamesForWeek` call is now only a fallback for a week we
 * have no live rows for.
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
async function syncWeekStats({ season, week, pauseMs = 0, api }) {
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
    // run yet; see modules/liveGameEngine.js): fall back to one counted
    // schedule call and treat every game as needing a fetch.
    const gamesResponse = await tank01Get('/getNFLGamesForWeek', {
      params: { week, seasonType: 'reg', season },
      transport: api, // tests inject; uncounted when present
    });
    const games = tank01Body(gamesResponse.data) || [];
    if (!Array.isArray(games)) {
      return { season, week, playersUpdated: 0, gamesProcessed: 0, gamesSkipped: 0, plays: [] };
    }
    targets = games
      .filter((g) => g && g.gameID)
      .map((g) => ({ gameId: String(g.gameID), status: null, isFinal: false }));
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

  const runResult = await runSyncJob({
    job: 'week-stats',
    lock: null,
    fetch: () => fetchWeekStatsUnits({ targets, pauseMs, api, failedFetches }),
    apply: (client, unit) => applyWeekStatsUnit(client, unit, { season, week, maps }),
  });

  const applied = runResult && runResult.results ? runResult.results : [runResult];
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
  return runSyncJob({
    job: 'team-defenses',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: fetchTeamDefensesUnit,
    apply: (client, unit) => applyTeamDefensesUnit(client, unit),
  });
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
  return runSyncJob({
    job: 'season-stats',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: () => fetchSyncPlayerSeasonStatsUnit({ currentSeason, positions }),
    apply: (client, unit) => applySyncPlayerSeasonStatsUnit(client, unit),
  });
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
  normalizeInjuryStatus,
  normalizePlayerEntry,
  IDP_POSITIONS,
  DEFENSIVE_POSITIONS,
  syncWeekStats,
  syncSchedule,
  syncInjuries,
  NFL_PLAYER_LIST_FLOOR,
  syncPlayers,
  syncPlayerSeasonStats,
};
