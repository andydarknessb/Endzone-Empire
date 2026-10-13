const pool = require('../modules/pool');
const { runSyncJob } = require('../modules/syncRun');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');

/**
 * Nightly projection run (#1305): for every fantasy league whose season is
 * live (`fantasySeasonLiveWhereSql` - draft complete, season not yet
 * complete, the same eligibility the hourly odds/game-context syncs in
 * the scheduler use), generate `free_baseline_v2` Weekly projections for EVERY
 * player in `players` (#1403; it was every currently rostered player until then, which
 * left every unrostered row the Players list and Waivers page show - most of
 * the pool - to be generated on demand, page by page, 17 weeks at a time),
 * for every week from the league's current week through its last playoff
 * week (`season.service.lastPlayoffWeek`). `getWeeklyProjections`
 * (projection.service.js) owns the cache itself: a (season, week,
 * scoring_hash, model_version) run that already has every player's row is a
 * cache hit and is never regenerated here, which is what lets this run every
 * night at no cost once a season's weeks are filled. A full-pool week is
 * ~12 s to generate and ~0.5 s to confirm cached, so a cold season is a few
 * minutes per league and a warm one seconds.
 *
 * A Sync run per ADR 0036: `runSyncJob` owns the one `data_sync_runs` row for
 * the whole pass, exactly as every other feed sync in this module does.
 * `fetch()` reads the eligible leagues and the player pool once (no
 * transaction, no lock: nothing else bulk-writes these rows); `apply(client,
 * unit)` fills one league's remaining weeks, one per unit. One league
 * throwing does not stop another's: `runSyncJob` attempts every unit and only
 * rethrows the first failure after every unit has been tried, so a prior
 * unit's weeks are already committed regardless. That rethrow is caught by the
 * caller and the day is deliberately left UNSTAMPED whenever it fires,
 * success-path stamp only: a transient failure gets retried inside the same off-peak
 * window rather than losing the whole night, and a league that keeps failing
 * just means the other, now-cached leagues are cheap no-ops on the retry.
 *
 * `apply` deliberately never passes its `client` argument into
 * `getWeeklyProjections` (#1305 f5): that function's cache writer
 * (`saveProjections`) and the weather lookup it calls both log-and-continue on
 * a failed query, a contract that only holds in autocommit. Hosted inside
 * `runSyncJob`'s per-unit transaction, a swallowed failure either aborts the
 * transaction so the NEXT week's query throws a misleading 25P02 (rolling
 * back every earlier week for that league too), or - worse, when the failure
 * lands on the unit's LAST query - leaves nothing left to run, so
 * `withTransaction`'s own COMMIT is answered with a silent ROLLBACK and no
 * error: `ok: true` gets recorded with real-looking `weeksGenerated` counts
 * for a league that persisted nothing. Calling it with no `client` runs it
 * against the pool instead, autocommitting per statement exactly as it does
 * on the live request path and as it did before this file routed through
 * `runSyncJob`; each week's cache row is already an idempotent upsert, so
 * nothing here needs the unit's transaction anyway. The job runs with
 * `transaction: false` (#1913), so the unit runs with no transaction and no
 * lock and the weather provider's HTTP fetches never sit inside one (ADR
 * 0036, "a feed call never runs inside a transaction").
 *
 * The gate (UTC hour window, cadence, game window) stays with the scheduler's
 * nightly-projection-fill TICK_JOBS row. This is the Sync run body plus the
 * reconcile and explanation passes. A failed run is recorded (ok=false, which
 * does not settle the day) and rethrown for the caller to log. Dependencies are reached
 * through their module objects, never destructured at load, so test stubs bite.
 * Returns `{ weeksGenerated, weeksSkipped, leagues, elapsedMs }`.
 */
async function runNightlyFill({ now = new Date() } = {}) {
  // #2081: Render logs are the only place the engine's cost is observable.
  const startedAt = process.hrtime.bigint();
  const outcome = await runSyncJob({
    job: 'nightly-projection-run',
    transaction: false,
    fetch: async () => {
      // The WHOLE row, not an enumerated column list: getWeeklyProjections
      // hashes `rulesForLeague(league)` to pick the run it fills, and a
      // league row without `scoring_rules` hashes to the DEFAULT profile.
      // With five named columns the fill wrote 3,702 rows a week under a
      // hash no custom-scoring league ever looks up, and reported the
      // second league's weeks "already cached" off the first league's
      // default run - it had never warmed either (found verifying #1447).
      const leaguesResult = await pool.query(
        `SELECT * FROM "leagues" WHERE ${fantasySeasonLiveWhereSql()}`
      );
      const units = [];
      if (leaguesResult.rows.length === 0) return units;
      // Every player, once, shared by every league's unit (#1403).
      const playersResult = await pool.query(`SELECT "id" FROM "players"`);
      const playerIds = playersResult.rows.map((r) => r.id);
      if (playerIds.length === 0) return units;
      for (const league of leaguesResult.rows) units.push({ league, playerIds });
      return units;
    },
    // `transaction: false` hands no client (#1305 f5, see docblock above):
    // getWeeklyProjections must run against the pool, in autocommit.
    apply: async (_client, { league, playerIds }) => {
      const projection = require('./projection.service');
      const { lastPlayoffWeek } = require('./season.service');
      const throughWeek = lastPlayoffWeek(league);
      let weeksGenerated = 0;
      let weeksSkipped = 0;
      for (let week = league.current_week; week <= throughWeek; week++) {
        const run = await projection.getWeeklyProjections({
          season: league.current_season, week, league, playerIds,
        });
        // A week is a cache HIT only when every player's row came
        // back already cached (getWeeklyProjections's own hit/miss rule,
        // mirrored here rather than re-decided); any generation at all,
        // partial included, counts this week as generated.
        const allCached = playerIds.every((id) => {
          const p = run.projections.get(id);
          return !!p && p.cached === true;
        });
        if (allCached) weeksSkipped += 1; else weeksGenerated += 1;
      }
      // Matchup previews (ADR 0063): the current week's projections are
      // cached by now. Best-effort display text; never fails the fill.
      try {
        await require('./matchupNarrative.service').writePreviews({ league, now });
      } catch (err) {
        console.error('nightly projection fill: matchup previews failed for league %s:', league.id, err.message);
      }
      return { leagueId: league.id, weeksGenerated, weeksSkipped };
    },
  });

  // #1789: belt and braces after the fill itself - a day both the injury
  // sync and the roster-status sync fail still owes a fresh verdict for the
  // 48h practice-squad expiry and a No NFL team clear, and this job runs
  // regardless of either. A full sweep (no id list: the fill just touched
  // every live league's players, not a "who changed" set) on the pool, after
  // `runSyncJob` has already finished every unit above (none ran in a
  // transaction, #1913) - same reasoning as the roster-status sync's sweep, no ambient transaction
  // to protect with a SAVEPOINT. Logged and swallowed, never thrown: a
  // reconcile failure must not turn a real fill into a failed run the
  // cadence gate retries.
  try {
    const projection = require('./projection.service');
    const scope = await projection.liveReconcileScope();
    if (scope) await projection.reconcileAvailability({ ...scope, now });
  } catch (err) {
    console.error('nightly projection fill: availability reconcile failed, continuing:', err.message);
  }
  // ADR 0063: Projection explanations for the current week, template first.
  // Logged and swallowed like the sweep above: prose never fails the fill.
  try {
    // The NFL calendar's week in play, not a league's current_week (a league
    // that has not advanced would pin this to last week).
    const season = await require('./nflSeason.service').upcomingNflSeason();
    const week = season == null ? null : require('./practiceParticipation.service').weekInPlay(
      await require('./pickemSeason.service').getSeasonWeekBounds({ season }), now
    );
    if (week != null) {
      const explanationStart = Date.now();
      const counts = await require('./projectionExplanation.service')
        .generateForWeek({ season, week }, { now });
      console.log('nightly projection fill: projection explanations', JSON.stringify(counts),
        `in ${Date.now() - explanationStart} ms`);
    }
  } catch (err) {
    console.error('nightly projection fill: projection explanations failed, continuing:', err.message);
  }
  // One result per league's unit (`fetch` above has no refusal path).
  const perLeague = outcome.results;
  const weeksGenerated = perLeague.reduce((sum, r) => sum + (r.weeksGenerated || 0), 0);
  const weeksSkipped = perLeague.reduce((sum, r) => sum + (r.weeksSkipped || 0), 0);
  const elapsedMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  if (weeksGenerated > 0 || weeksSkipped > 0) {
    console.log(
      `scheduler: nightly projection fill generated ${weeksGenerated} week(s), ` +
      `skipped ${weeksSkipped} already-cached week(s) across ${perLeague.length} league(s) in ${elapsedMs} ms`
    );
  }
  return { weeksGenerated, weeksSkipped, leagues: perLeague.length, elapsedMs };
}

module.exports = { runNightlyFill };
