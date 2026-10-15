const pool = require('../modules/pool');
const nflverseSync = require('./nflverseSync.service');
const nflSeason = require('./nflSeason.service');
const pickemSeason = require('./pickemSeason.service');
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
 * nothing here moves a projection (ADR 0044); the readers are Start/sit advice
 * (`loadWeekObservations`, unavailable.js) and the Decision card's practice
 * line (`weekPracticeEntries`, #1923).
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
 * is the ESPN athlete id). `crosswalk` is `fetchPlayersCrosswalk()`,
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

/** The latest stored row per (player, season, week) from `fromWeek` on,
 * keyed by `observationKey`. */
async function loadLatestObservations(db, { season, fromWeek }) {
  const result = await db.query(
    `SELECT DISTINCT ON ("player_id", "season", "week")
            "player_id", "season", "week", "practice_status", "practice_primary_injury",
            "report_status", "report_primary_injury"
     FROM "player_practice_observations"
     WHERE "season" = $1 AND "week" >= $2
     ORDER BY "player_id", "season", "week", "observed_at" DESC, "id" DESC`,
    [season, fromWeek]
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
 * The read behind Start/sit advice and the Decision card's practice line: every observation stored for `playerIds` in
 * (season, week), oldest first, as `Map<playerId, [{ practiceStatus,
 * practicePrimaryInjury, reportPrimaryInjury, observedAt }]>`. One batched
 * query; a player with none is absent from the map.
 */
async function loadWeekObservations(db, { season, week, playerIds }) {
  const byPlayer = new Map();
  if (!playerIds || playerIds.length === 0) return byPlayer;
  const result = await db.query(
    `SELECT "player_id", "practice_status", "practice_primary_injury", "report_primary_injury", "observed_at"
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
      observedAt: r.observed_at,
    });
  }
  return byPlayer;
}

/**
 * apply() for one season unit (every fetched row from `fromWeek` on): diff
 * against the latest stored rows and append what changed. `idByExternal` and
 * `crosswalk` were loaded once by the poll, outside this transaction.
 * Insert-only; `ON CONFLICT DO NOTHING` makes a re-run of the same poll a
 * no-op.
 */
async function applyUnit(client, { season, fromWeek, rows, crosswalk, idByExternal, observedAt, sourceLastUpdated }) {
  const { rows: placed, unmapped } = attachPlayerIds(rows, { crosswalk, idByExternal });
  const latest = await loadLatestObservations(client, { season, fromWeek });
  const changed = observationsToInsert({ latest, fetched: placed });
  if (changed.length === 0) return { season, fromWeek, inserted: 0, unmapped };
  const result = await client.query(
    `INSERT INTO "player_practice_observations"
       ("player_id", "gsis_id", "season", "week", "team", "practice_status", "practice_primary_injury",
        "report_status", "report_primary_injury", "observed_at", "source_last_updated")
     SELECT u."player_id", u."gsis_id", $3::int, u."week", u."team", u."practice_status",
            u."practice_primary_injury", u."report_status", u."report_primary_injury", $10::timestamptz, $11::text
     FROM unnest($1::int[], $2::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
       AS u("player_id", "gsis_id", "week", "team", "practice_status", "practice_primary_injury",
            "report_status", "report_primary_injury")
     ON CONFLICT ("player_id", "season", "week", "observed_at") DO NOTHING`,
    [
      changed.map((r) => r.playerId),
      changed.map((r) => r.gsisId),
      season,
      changed.map((r) => r.week),
      changed.map((r) => r.team),
      changed.map((r) => r.practiceStatus),
      changed.map((r) => r.practicePrimaryInjury),
      changed.map((r) => r.reportStatus),
      changed.map((r) => r.reportPrimaryInjury),
      observedAt,
      sourceLastUpdated,
    ]
  );
  return { season, fromWeek, inserted: result.rowCount, unmapped };
}

// A week's practice reports begin on the Monday or Wednesday before its games,
// never a full week ahead of its last kickoff, so the poll asks nothing of
// nflverse until the week in play is this close.
const CAPTURE_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure: the NFL week in play at `now`, from `bounds` (`[{ week, lastKickoffAt }]`,
 * pickemSeason.getSeasonWeekBounds, read off nfl_games kickoffs): the smallest
 * week whose last kickoff is still ahead, once that kickoff is within
 * CAPTURE_LEAD_MS; null between seasons or with no schedule. Independent of any
 * league's current_week: the published report follows the NFL calendar, not a
 * commissioner's advance.
 */
function weekInPlay(bounds, now) {
  const at = now.getTime();
  const open = (bounds || [])
    .filter((b) => b.lastKickoffAt.getTime() > at)
    .sort((a, b) => a.week - b.week)[0];
  if (!open || open.lastKickoffAt.getTime() - at > CAPTURE_LEAD_MS) return null;
  return open.week;
}

/**
 * Scheduler entry point: capture the nflverse injury report for the NFL week
 * in play (`weekInPlay`) and any later week the file already carries (a
 * Thursday-game team's reports for next week begin before this week's Monday
 * game) whenever timestamp.json's `last_updated` changes. One tiny request
 * asks the timestamp; the season file and players.csv come down only when
 * (season, fromWeek) has not been captured at that timestamp (the timestamp
 * rides on the run row's detail, as the stats pass's version does). A
 * timestamp.json with no `last_updated` is a failed poll, never a download.
 * Its own Sync run job, 'nflverse-practice'.
 *
 * A failed poll (nflverse unreachable, a bad file, a failed write) is logged
 * and loses only that poll: the Sync run records no ok row, so the next poll
 * retries, and the table is only ever appended to.
 *
 * `now` is our observation time for every row this poll writes.
 */
async function syncCurrentWeeks({ now = new Date() } = {}) {
  const season = await nflSeason.upcomingNflSeason();
  const week = season == null ? null : weekInPlay(await pickemSeason.getSeasonWeekBounds({ season }), now);
  const synced = [];
  if (week == null) return { synced };
  try {
    const sourceLastUpdated = await nflverseSync.fetchInjuriesLastUpdated();
    if (sourceLastUpdated === null) throw new Error('nflverse injuries timestamp.json has no last_updated');
    const seen = await pool.query(
      `SELECT 1 FROM "data_sync_runs"
       WHERE "job" = '${JOB}' AND "ok" = true
         AND "detail"->>'sourceLastUpdated' = $1
         AND "detail"->>'season' = $2 AND "detail"->>'fromWeek' = $3
       LIMIT 1`,
      [sourceLastUpdated, String(season), String(week)]
    );
    if (seen.rows[0]) return { synced };
    const { results: [polled] } = await runSyncJob({
      job: JOB,
      lock: null,
      fetch: async () => {
        const [csv, crosswalk, known] = await Promise.all([
          nflverseSync.fetchInjuriesForSeason(season),
          nflverseSync.fetchPlayersCrosswalk(),
          pool.query(`SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`),
        ]);
        const rows = csv.map(normalizeInjuryRow).filter((r) => r && r.season === season && r.week >= week);
        const idByExternal = new Map(known.rows.map((r) => [String(r.external_id), r.id]));
        return {
          units: [{ season, fromWeek: week, rows, crosswalk, idByExternal, observedAt: now, sourceLastUpdated }],
          detail: { sourceLastUpdated },
        };
      },
      apply: (client, unit) => applyUnit(client, unit),
    });
    synced.push(polled);
  } catch (err) {
    console.error('practice participation poll failed for %s week %s:', season, week, err.message);
  }
  return { synced };
}

const PRACTICE_LABELS = [
  [/^did not participate/i, 'Did not participate'],
  [/^limited/i, 'Limited'],
  [/^full/i, 'Full'],
];

/** Pure: a practice_status -> 'Did not participate' | 'Limited' | 'Full', else null. */
function practiceLabel(status) {
  const hit = PRACTICE_LABELS.find(([pattern]) => pattern.test(status ?? ''));
  return hit ? hit[1] : null;
}

const weekdayOf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });

/**
 * Pure: one week's observations (oldest first) -> the Decision card's
 * `[{ status, day }]`, or null when no entry survives. A row with no
 * recognised status is skipped first; then a row whose label equals the last
 * entry's is skipped (a report-only change is not a new entry). `day` is the
 * America/New_York weekday we first observed it, never a practice day.
 */
function practiceEntries(observations) {
  const entries = [];
  for (const o of observations) {
    const status = practiceLabel(o.practiceStatus);
    if (status && status !== entries[entries.length - 1]?.status) {
      entries.push({ status, day: weekdayOf.format(o.observedAt) });
    }
  }
  return entries.length > 0 ? entries : null;
}

/** The Decision card's read (#1923): one player's entries for (season, week), or null. */
async function weekPracticeEntries(db, { season, week, playerId }) {
  const byPlayer = await loadWeekObservations(db, { season, week, playerIds: [playerId] });
  return practiceEntries(byPlayer.get(playerId) || []);
}

module.exports = {
  normalizeInjuryRow,
  observationKey,
  observationsToInsert,
  attachPlayerIds,
  weekInPlay,
  loadWeekObservations,
  practiceLabel,
  practiceEntries,
  weekPracticeEntries,
  syncCurrentWeeks,
};
