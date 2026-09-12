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
 * row per run (job 'line-sync'). No lock: this UPDATE only ever touches the
 * seven columns it owns (never score/status/clock/Situation, which stay the
 * poll's alone), so a concurrent poll tick and this job can never race on the
 * same column.
 *
 * UPDATE, never INSERT/upsert: a game whose `live_game_states` row does not
 * exist yet (the poll only creates one once the kickoff window opens, up to
 * 8 hours out) simply has nothing to update this hour and picks up its Venue/
 * Broadcast/Record on the next hourly run after the poll creates the row —
 * always well before kickoff, since the window opens 8 hours out and this
 * job runs hourly. Minting a row here would mean guessing at season/week/
 * team/status defaults this job has no business owning.
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

const UPDATE_SQL = `
  UPDATE "live_game_states" AS "l" SET
    "venue_name" = "u"."venue_name",
    "venue_city" = "u"."venue_city",
    "is_indoor" = "u"."is_indoor",
    "is_neutral_site" = "u"."is_neutral_site",
    "broadcast" = "u"."broadcast",
    "home_record" = "u"."home_record",
    "away_record" = "u"."away_record",
    "updated_at" = now()
  FROM (
    SELECT * FROM unnest(
      $1::text[], $2::text[], $3::text[], $4::bool[], $5::bool[],
      $6::text[], $7::jsonb[], $8::jsonb[]
    ) AS t(
      tank01_game_id, venue_name, venue_city, is_indoor, is_neutral_site,
      broadcast, home_record, away_record
    )
  ) AS "u"
  WHERE "l"."tank01_game_id" = "u"."tank01_game_id"
  RETURNING "l"."tank01_game_id"
`;

/**
 * `apply(client, unit)`: one bulk UPDATE for the whole unit's rows, inside
 * the transaction `runSyncJob` opens. A game with no existing row is simply
 * not matched by the WHERE and is not an error (see the module doc above).
 */
async function applyLineUnit(client, { rows }) {
  const result = await client.query(UPDATE_SQL, [
    rows.map((r) => r.tank01GameId),
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
