'use strict';

const { runSyncJob } = require('../modules/syncRun');
const espnScoreboard = require('../modules/espnScoreboard');

/**
 * The hourly Line Sync run (#1262, ADR 0038): Record, Venue and Broadcast for
 * every game on a week's slate, read off the same free ESPN scoreboard the
 * clock engine already polls (modules/espnScoreboard.js), and written onto
 * `live_game_states` — the row the thirty-second poll (liveGameEngine.js)
 * already owns for the clock, score and Situation. Split from that poll
 * because these three facts change on the timescale of an hour (a broadcast
 * swap, a record after last night's game), not thirty seconds; polling the
 * free endpoint hourly just for these costs nothing extra since
 * espnScoreboard.js already resolves each event's Tank01-style game id.
 *
 * A Sync run (ADR 0036) like every other feed sync: `fetch()` outside any
 * transaction, `apply()` once inside its own transaction, one `data_sync_runs`
 * row per run (job 'line-sync'). No lock: the ON CONFLICT SET clause below
 * only ever touches the seven columns this job owns (never score/status/
 * clock/Situation/win probability/linescores/headline, which stay the
 * poll's alone), so the two writers can never clobber each other's columns —
 * though see qa-reviewer #1262 finding 4: that is true at column
 * granularity, not row-lock granularity, so a genuine (bounded, retried)
 * deadlock between this job's bulk write and the poll's is possible, not a
 * data-correctness risk.
 *
 * UPSERT, not a plain UPDATE (qa-reviewer #1262 finding 1): the poll's own
 * window (`liveGameEngine.js`'s `nfl_games.kickoff_at BETWEEN now() -
 * interval '8 hours' AND now()`) opens once a kickoff has ALREADY happened,
 * not up to 8 hours before it — the poll mints a game's `live_game_states`
 * row only from kickoff onward. Pick'em needs Venue/Broadcast/Record before
 * lock, i.e. before kickoff, so this job cannot wait for the poll to create
 * the row first; it INSERTs one itself when absent, using the same
 * season/week/home_team/away_team/game_status/start_time/scores this run's
 * own scoreboard fetch already computed (identical to what the poll would
 * insert for the same event). ON CONFLICT, only this job's seven columns are
 * written — every other column, including one the poll has already advanced
 * (score, clock, Situation), is left exactly as the poll last wrote it.
 */
const LINE_SYNC_JOB = 'line-sync';

/**
 * `fetch()`: one scoreboard fetch for the whole (season, week) slate, then
 * keep only the events that actually carry at least one Venue/Broadcast/
 * Record field — an event with none of the three needs no write, same
 * "never a placeholder, never a no-op write" discipline as espnOdds.provider.
 * Zero such events resolves to zero units, not a refusal: an early-week
 * scoreboard with no venue/broadcast assigned yet is an expected state.
 */
async function fetchLineUnits({ season, week, transport }) {
  const { rows } = await espnScoreboard.fetchLiveRows({ season, week, transport });
  const withLineFields = rows.filter(
    (r) =>
      r.venueName != null ||
      r.venueCity != null ||
      r.isIndoor != null ||
      r.isNeutralSite != null ||
      r.broadcast != null ||
      r.homeRecord != null ||
      r.awayRecord != null
  );
  return withLineFields.length > 0 ? [{ rows: withLineFields }] : [];
}

const UPSERT_SQL = `
  INSERT INTO "live_game_states"
    ("tank01_game_id", "season", "week", "home_team", "away_team", "game_status",
     "start_time", "current_score_home", "current_score_away",
     "venue_name", "venue_city", "is_indoor", "is_neutral_site", "broadcast",
     "home_record", "away_record")
  SELECT * FROM unnest(
    $1::text[], $2::int[], $3::int[], $4::text[], $5::text[],
    $6::text[]::game_status_type[], $7::timestamptz[], $8::int[], $9::int[],
    $10::text[], $11::text[], $12::bool[], $13::bool[], $14::text[],
    $15::jsonb[], $16::jsonb[]
  )
  -- Only the seven Venue/Broadcast/Record columns are ever written on
  -- conflict: a row the poll already advanced (score, clock, Situation, win
  -- probability, linescores, headline) is never touched here.
  ON CONFLICT ("tank01_game_id") DO UPDATE SET
    "venue_name" = EXCLUDED."venue_name",
    "venue_city" = EXCLUDED."venue_city",
    "is_indoor" = EXCLUDED."is_indoor",
    "is_neutral_site" = EXCLUDED."is_neutral_site",
    "broadcast" = EXCLUDED."broadcast",
    "home_record" = EXCLUDED."home_record",
    "away_record" = EXCLUDED."away_record",
    "updated_at" = now()
  RETURNING "tank01_game_id"
`;

/**
 * `apply(client, unit)`: one bulk upsert for the whole unit's rows, inside
 * the transaction `runSyncJob` opens. A game with no existing row gets one
 * minted here (see the module doc above); a game the poll already has a row
 * for gets only its seven Line Sync columns touched.
 */
async function applyLineUnit(client, { rows }) {
  const result = await client.query(UPSERT_SQL, [
    rows.map((r) => r.tank01GameId),
    rows.map((r) => r.season),
    rows.map((r) => r.week),
    rows.map((r) => r.homeTeam),
    rows.map((r) => r.awayTeam),
    rows.map((r) => r.gameStatus),
    rows.map((r) => r.startTime),
    rows.map((r) => r.currentScoreHome),
    rows.map((r) => r.currentScoreAway),
    rows.map((r) => r.venueName),
    rows.map((r) => r.venueCity),
    rows.map((r) => (typeof r.isIndoor === 'boolean' ? r.isIndoor : null)),
    rows.map((r) => (typeof r.isNeutralSite === 'boolean' ? r.isNeutralSite : null)),
    rows.map((r) => r.broadcast),
    rows.map((r) => (r.homeRecord != null ? JSON.stringify(r.homeRecord) : null)),
    rows.map((r) => (r.awayRecord != null ? JSON.stringify(r.awayRecord) : null)),
  ]);
  return { gamesUpdated: result.rowCount };
}

/**
 * Run the Line Sync for one (season, week) slate. `transport` is
 * test-injected; production hits ESPN's free scoreboard directly, same as
 * espnScoreboard.js and espnOdds.provider.js.
 */
async function syncLine({ season, week, transport } = {}) {
  return runSyncJob({
    job: LINE_SYNC_JOB,
    lock: null,
    fetch: () => fetchLineUnits({ season, week, transport }),
    apply: (client, unit) => applyLineUnit(client, unit),
  });
}

module.exports = {
  LINE_SYNC_JOB,
  fetchLineUnits,
  applyLineUnit,
  syncLine,
};
