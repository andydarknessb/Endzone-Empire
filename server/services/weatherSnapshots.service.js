const pool = require('../modules/pool');
const { runSyncJob } = require('../modules/syncRun');

// An ok run that wrote nothing because NWS_USER_AGENT is unset (#1930): it stays
// ok (a failed row would not move the cadence gate), but the report names it.
const NWS_UNCONFIGURED_REASON = 'NWS_USER_AGENT not configured';

/**
 * Weather snapshots Sync run (#1883, ADR 0036): refreshes
 * `game_weather_snapshots` for every game kicking off in the future and at
 * most `MAX_HORIZON_HOURS` (168) away, on its own 6-hour cadence
 * (`cadence.due({ job: 'weather-snapshots', every: { ms } })`, which reads the
 * run row this job records).
 *
 * Why it exists: the only other writer of that table is a projection run being
 * GENERATED, and `getWeeklyProjections` returns a cached week without
 * generating, so once a week was cached nothing refreshed its forecast and the
 * Decision card showed whatever the last generation left behind. The
 * projection path still calls `getForecastsForGames`; with this job in place
 * it normally reads the bucket this job already filled.
 *
 * Games are read by kickoff window rather than by season literal: a game in
 * the next 168 hours is by definition the current slate (and is grouped by its
 * own `season`/`week` because the snapshot cache is keyed that way). An
 * `nfl_games` row exists per team, so the read is DISTINCT per `game_key`.
 *
 * Tick safety: it runs after live scoring in `TICK_JOBS`, and it waits out
 * an open game window (`inGameWindow`, as the owed nightly refill does)
 * because the worst case is two sequential 3.5 s NWS requests per outdoor game
 * and a slow run holds the tick (and its 5-minute live-scoring cadence) for
 * its whole duration. Waiting costs nothing: no row is written, so the gate is
 * still due on the first tick after the window closes. It never throws: a
 * failed run is already recorded by `runSyncJob` and is retried next tick (a
 * failed row never moves the gate). `getForecastsForGames` fails open per
 * game, so one dead NWS lookup does not fail the run on its own; `apply`
 * fails the unit when it asked NWS and got nothing (`requests > 0` and
 * `fetched === 0`) or fetched forecasts and saved none, so an outage records
 * ok: false and retries on the next tick instead of holding the gate for 6
 * hours. A partial result stays an ok run, and an unset `NWS_USER_AGENT` stays
 * an ok run whose row carries the `reason`.
 *
 * The job runs with `transaction: false` (#1913): `apply` gets no client and
 * the unit runs with no transaction and no lock, so the week's sequential NWS
 * requests never sit inside one (ADR 0036, "a feed call never runs inside a
 * transaction"). That is also what the weather lookup and its snapshot write
 * need: they log-and-continue on a failed query, which only holds in
 * autocommit.
 *
 * The cadence gate and the in-game-window wait stay with the caller
 * (scheduler.runWeatherSnapshotSync); this is the Sync run body, which throws
 * on a failed run (already recorded) for the caller to log.
 */
async function runWeatherSnapshots({ now = new Date() } = {}) {
  const { getForecastsForGames, MAX_HORIZON_HOURS } = require('./nwsWeather.service');
  const horizonEnd = new Date(now.getTime() + MAX_HORIZON_HOURS * 3600000);
  return runSyncJob({
    job: 'weather-snapshots',
    transaction: false,
    fetch: async () => {
      const result = await pool.query(
        `SELECT DISTINCT ON ("game_key") "game_key", "season", "week", "kickoff_at", "roof", "venue"
           FROM "nfl_games"
          WHERE "game_key" IS NOT NULL AND "kickoff_at" > $1 AND "kickoff_at" <= $2
          ORDER BY "game_key", "kickoff_at"`,
        [now, horizonEnd]
      );
      const byWeek = new Map();
      for (const row of result.rows) {
        const key = `${row.season}:${row.week}`;
        if (!byWeek.has(key)) byWeek.set(key, { season: row.season, week: row.week, games: [] });
        byWeek.get(key).games.push({
          gameKey: row.game_key, kickoffAt: row.kickoff_at, roof: row.roof, venue: row.venue,
        });
      }
      return [...byWeek.values()];
    },
    apply: async (_client, { season, week, games }) => {
      const { coverage } = await getForecastsForGames({ season, week, games, now });
      const requests = coverage.requests || 0;
      const fetched = coverage.fetched || 0;
      const saved = coverage.saved || 0;
      // A unit that asked NWS and got nothing, or got forecasts and saved
      // none, did not do its job: throw so `runSyncJob` records ok: false,
      // the gate stays due and the next tick retries (a game already saved
      // in its horizon bucket is read from the cache only while it is still
      // in that bucket, so only the missing games are asked again). A
      // partial result (one forecast fetched and saved) stays an ok run.
      // The no-forecast throw is tagged `fetch_failed` so the unit's
      // `detail.failed[].reason` says the feed failed; the run-level
      // `detail.reason` stays `write_failed` (ADR 0036).
      if (requests > 0 && fetched === 0) {
        const error = new Error(`NWS returned no forecast for any of ${requests} request(s) for ${season} week ${week}`);
        error.syncFailureReason = 'fetch_failed';
        throw error;
      }
      if (fetched > 0 && saved === 0) {
        throw new Error(`fetched ${fetched} NWS forecast(s) for ${season} week ${week} and saved none`);
      }
      return {
        season,
        week,
        games: games.length,
        requests,
        fetched,
        saved,
        // An unset NWS_USER_AGENT is an unconfigured optional integration,
        // an ok run: the row says why nothing was fetched.
        ...(coverage.reason ? { reason: coverage.reason } : {}),
        ...(coverage.reason === NWS_UNCONFIGURED_REASON ? { unconfigured: true } : {}),
      };
    },
  });
}

module.exports = { runWeatherSnapshots, NWS_UNCONFIGURED_REASON };
