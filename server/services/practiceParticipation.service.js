const pool = require('../modules/pool');
const nflverseSync = require('./nflverseSync.service');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
const { runSyncJob } = require('../modules/syncRun');

/**
 * Practice participation (CONTEXT.md, #1922, ADR 0056): the nflverse injury
 * report's practice_status and report_status, captured as observations.
 *
 * nflverse's `injuries_<season>` file holds ONE row per player per week with
 * the latest values and no date, so the Wed/Thu/Fri sequence exists only if
 * each change is recorded with our own clock. A row of
 * `player_practice_observations` is one observed change, stamped with the time
 * WE saw it (`observed_at`, an approximate practice day: a Wednesday report
 * first published Thursday is observed Thursday) and the nflverse
 * timestamp.json value the fetch read (`source_last_updated`). Facts only:
 * nothing here moves a projection (ADR 0044); the one reader that uses them
 * is Start/sit advice (`loadWeekObservations`, unavailable.js).
 *
 * ESPN's injury shortComment is out of scope: ADR 0041, plain context only.
 */

const JOB = 'nflverse-practice';

/** Pure: a blank CSV cell -> null, else the trimmed text. */
function cell(value) {
  const text = value == null ? '' : String(value).trim();
  return text === '' ? null : text;
}

/**
 * Pure: one injuries CSV row -> `{ gsisId, season, week, team, practiceStatus,
 * practicePrimaryInjury, reportStatus, reportPrimaryInjury }` (blank cells
 * null, `team` as nflverse spells it), or null for a row that cannot be an
 * observation: no player (nflverse's placeholder id is "0"), a non-regular-
 * season game, or no usable season and week.
 */
function normalizeInjuryRow(row) {
  const gsisId = cell(row.gsis_id);
  if (!gsisId || gsisId === '0') return null;
  const gameType = cell(row.game_type);
  if (gameType && gameType !== 'REG') return null;
  const season = Number(cell(row.season) ?? NaN);
  const week = Number(cell(row.week) ?? NaN);
  if (!Number.isInteger(season) || !Number.isInteger(week)) return null;
  return {
    gsisId,
    season,
    week,
    team: cell(row.team),
    practiceStatus: cell(row.practice_status),
    practicePrimaryInjury: cell(row.practice_primary_injury),
    reportStatus: cell(row.report_status),
    reportPrimaryInjury: cell(row.report_primary_injury),
  };
}

const observationKey = (r) => `${r.playerId}:${r.season}:${r.week}`;
const TRACKED = ['practiceStatus', 'practicePrimaryInjury', 'reportStatus', 'reportPrimaryInjury'];

/**
 * Pure: the rows to insert, given the latest stored row per (player, season,
 * week) (`latest`, keyed by `observationKey`, camelCase fields) and the
 * fetched rows (normalized, with `playerId`). A row is new when there is no
 * stored row yet or any of the four tracked fields differ from it (null equals
 * null; a team change alone is not an observation). A player-week repeated in
 * one file counts once, the last row winning.
 */
function observationsToInsert({ latest, fetched }) {
  const lastInFile = new Map();
  for (const row of fetched) lastInFile.set(observationKey(row), row);
  const out = [];
  for (const [key, row] of lastInFile) {
    const stored = latest.get(key);
    if (!stored || TRACKED.some((field) => (stored[field] ?? null) !== (row[field] ?? null))) out.push(row);
  }
  return out;
}

/**
 * Pure: gsis_id -> players.id, through the same two hops the nflverse stats
 * pass takes (players.csv gsis_id -> espn_id, then players.external_id, which
 * is the ESPN athlete id). `crosswalk` is `fetchIdCrosswalks().gsisToEspn`,
 * `idByExternal` maps String(external_id) -> players.id. A row with no match
 * (a player we do not roster) is dropped and counted, as the stats pass does.
 */
function attachPlayerIds(rows, { crosswalk, idByExternal }) {
  const placed = [];
  let unmapped = 0;
  for (const row of rows) {
    const espnId = crosswalk.get(row.gsisId);
    const playerId = espnId ? idByExternal.get(String(espnId)) : undefined;
    if (playerId) placed.push({ ...row, playerId });
    else unmapped += 1;
  }
  return { rows: placed, unmapped };
}

/** The latest stored row per (player, season, week) for one week, keyed by
 * `observationKey`. */
async function loadLatestObservations(db, { season, week }) {
  const result = await db.query(
    `SELECT DISTINCT ON ("player_id", "season", "week")
            "player_id", "season", "week", "practice_status", "practice_primary_injury",
            "report_status", "report_primary_injury"
     FROM "player_practice_observations"
     WHERE "season" = $1 AND "week" = $2
     ORDER BY "player_id", "season", "week", "observed_at" DESC, "id" DESC`,
    [season, week]
  );
  return new Map(result.rows.map((r) => {
    const row = {
      playerId: r.player_id,
      season: r.season,
      week: r.week,
      practiceStatus: r.practice_status,
      practicePrimaryInjury: r.practice_primary_injury,
      reportStatus: r.report_status,
      reportPrimaryInjury: r.report_primary_injury,
    };
    return [observationKey(row), row];
  }));
}

/**
 * Start/sit advice's one read: every observation stored for `playerIds` in
 * (season, week), oldest first, as `Map<playerId, [{ practiceStatus,
 * practicePrimaryInjury, reportPrimaryInjury }]>`. One batched query; a player
 * with none is absent from the map.
 */
async function loadWeekObservations(db, { season, week, playerIds }) {
  const byPlayer = new Map();
  if (!playerIds || playerIds.length === 0) return byPlayer;
  const result = await db.query(
    `SELECT "player_id", "practice_status", "practice_primary_injury", "report_primary_injury"
     FROM "player_practice_observations"
     WHERE "season" = $1 AND "week" = $2 AND "player_id" = ANY($3::int[])
     ORDER BY "observed_at", "id"`,
    [season, week, playerIds]
  );
  for (const r of result.rows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push({
      practiceStatus: r.practice_status,
      practicePrimaryInjury: r.practice_primary_injury,
      reportPrimaryInjury: r.report_primary_injury,
    });
  }
  return byPlayer;
}

/**
 * apply() for one (season, week) unit: resolve players, diff against the
 * latest stored rows and append what changed. Insert-only; `ON CONFLICT DO
 * NOTHING` makes a re-run of the same poll a no-op.
 */
async function applyUnit(client, { season, week, rows, crosswalk, observedAt, sourceLastUpdated }) {
  const known = await client.query(`SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`);
  const idByExternal = new Map(known.rows.map((r) => [String(r.external_id), r.id]));
  const { rows: placed, unmapped } = attachPlayerIds(rows, { crosswalk, idByExternal });
  const latest = await loadLatestObservations(client, { season, week });
  const changed = observationsToInsert({ latest, fetched: placed });
  if (changed.length === 0) return { season, week, inserted: 0, unmapped };
  const result = await client.query(
    `INSERT INTO "player_practice_observations"
       ("player_id", "gsis_id", "season", "week", "team", "practice_status", "practice_primary_injury",
        "report_status", "report_primary_injury", "observed_at", "source_last_updated")
     SELECT u."player_id", u."gsis_id", $3::int, $4::int, u."team", u."practice_status",
            u."practice_primary_injury", u."report_status", u."report_primary_injury", $10::timestamptz, $11::text
     FROM unnest($1::int[], $2::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
       AS u("player_id", "gsis_id", "team", "practice_status", "practice_primary_injury",
            "report_status", "report_primary_injury")
     ON CONFLICT ("player_id", "season", "week", "observed_at") DO NOTHING`,
    [
      changed.map((r) => r.playerId),
      changed.map((r) => r.gsisId),
      season,
      week,
      changed.map((r) => r.team),
      changed.map((r) => r.practiceStatus),
      changed.map((r) => r.practicePrimaryInjury),
      changed.map((r) => r.reportStatus),
      changed.map((r) => r.reportPrimaryInjury),
      observedAt,
      sourceLastUpdated,
    ]
  );
  return { season, week, inserted: result.rowCount, unmapped };
}

/**
 * Scheduler entry point: for the week every in-season league sits on, capture
 * the nflverse injury report whenever its timestamp.json `last_updated`
 * changes. One tiny request per season asks the timestamp; the season file and
 * players.csv come down only when a (season, week) has not been captured at
 * that timestamp (the timestamp rides on the run row's detail, as the stats
 * pass's version does). Its own Sync run job, 'nflverse-practice'.
 *
 * A failed poll (nflverse unreachable, a bad file, a failed write) is logged
 * and loses only that poll: the Sync run records no ok row, so the next poll
 * retries, and the table is only ever appended to.
 *
 * `now` is our observation time for every row this poll writes.
 */
async function syncCurrentWeeks({ now = new Date() } = {}) {
  const leaguesResult = await pool.query(
    `SELECT "id", "current_season", "current_week" FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()}`
  );
  const weeks = new Map(); // 'season:week' -> { season, week }
  for (const league of leaguesResult.rows) {
    weeks.set(`${league.current_season}:${league.current_week}`, {
      season: league.current_season, week: league.current_week,
    });
  }

  const timestamps = new Map(); // season -> Promise<last_updated>, one request per season
  const files = new Map(); // season -> Promise<normalized rows>, one download per season
  let crosswalkRequest = null; // players.csv, one download per poll
  const loadCrosswalk = () => {
    if (!crosswalkRequest) crosswalkRequest = nflverseSync.fetchIdCrosswalks().then((c) => c.gsisToEspn);
    return crosswalkRequest;
  };
  const synced = [];
  for (const { season, week } of weeks.values()) {
    try {
      if (!timestamps.has(season)) timestamps.set(season, nflverseSync.fetchInjuriesLastUpdated());
      const sourceLastUpdated = await timestamps.get(season);
      if (sourceLastUpdated !== null) {
        const seen = await pool.query(
          `SELECT 1 FROM "data_sync_runs"
           WHERE "job" = '${JOB}' AND "ok" = true
             AND "detail"->>'sourceLastUpdated' = $1
             AND "detail"->>'season' = $2 AND "detail"->>'week' = $3
           LIMIT 1`,
          [sourceLastUpdated, String(season), String(week)]
        );
        if (seen.rows[0]) continue;
      }
      if (!files.has(season)) {
        files.set(season, nflverseSync.fetchInjuriesForSeason(season)
          .then((csv) => csv.map(normalizeInjuryRow).filter(Boolean)));
      }
      const seasonRows = await files.get(season);
      synced.push(await runSyncJob({
        job: JOB,
        lock: null,
        fetch: async () => {
          const crosswalk = await loadCrosswalk();
          const rows = seasonRows.filter((r) => r.season === season && r.week === week);
          return {
            units: [{ season, week, rows, crosswalk, observedAt: now, sourceLastUpdated }],
            detail: { sourceLastUpdated },
          };
        },
        apply: (client, unit) => applyUnit(client, unit),
      }));
    } catch (err) {
      console.error('practice participation poll failed for %s week %s:', season, week, err.message);
    }
  }
  return { synced };
}

module.exports = {
  normalizeInjuryRow,
  observationKey,
  observationsToInsert,
  attachPlayerIds,
  loadWeekObservations,
  syncCurrentWeeks,
};
