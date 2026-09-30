'use strict';

/**
 * The ESPN facts Sync runs (#1308, ADR 0041/0036): depth-chart rank and
 * Ownership, written to `player_depth_chart` and `player_ownership` (#1382),
 * and the NFL roster status (#1766) written to `player_nfl_roster_status`. All
 * go through `runSyncJob` (ADR 0036) so each owns exactly one `data_sync_runs`
 * row. No table is written by anything else, so no job takes an advisory lock
 * (`advisoryLock.js`'s keyspace doc: a new fixed id is only needed when two
 * writers of the SAME table could race).
 *
 * `fetch()` calls `espnAthleteClient` outside any transaction (ADR 0036);
 * `apply(client, unit)` resolves each ESPN athlete id to OUR `players.id` via
 * `external_id` (ADR 0035: `players.external_id` already is the ESPN athlete
 * id) and writes with `ON CONFLICT ("player_id", "captured_date") DO
 * NOTHING`, so a second run the same day is a recorded success with zero
 * rows written - never a duplicate snapshot, and never an error. The roster
 * status is the one exception (DO UPDATE, see `applyRosterStatusUnit`).
 */
const espnAthleteClient = require('./espnAthleteClient');
const { runSyncJob } = require('./syncRun');
const cadence = require('./cadence');

/** Today's date, local calendar day, `YYYY-MM-DD` - the `captured_date` every
 * row this run writes shares (same `en-CA` stamp the rest of this module
 * family uses for a "once a day" gate). */
function today(now) {
  return (now || new Date()).toLocaleDateString('en-CA');
}

/**
 * `players.id` for every requested ESPN athlete id, resolved in one query
 * (never one query per row). Athlete ids ESPN reports that we don't roster
 * (practice squad, a free agent we've never synced) are simply absent from
 * the returned map - callers drop those rows rather than invent a player.
 */
async function loadPlayerIdsByExternalId(client, athleteIds) {
  const ids = [...new Set(athleteIds.map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return new Map();
  const result = await client.query(
    `SELECT "id", "external_id" FROM "players" WHERE "external_id" = ANY($1::int[])`,
    [ids]
  );
  return new Map(result.rows.map((r) => [r.external_id, r.id]));
}

// A team fetch resolving `null` (ESPN failure, Ruling item 4) three times in
// a row is treated as the host being down/blocking rather than 29 more
// independent bad-luck teams, and the sweep stops rather than burning the
// remaining teams' full ESPN_TIMEOUT_MS each (formal review f3 over-fix
// guard - this is the same 32 x timeout hazard the concurrency risk review
// already flagged once for the scheduler's own ordering).
const CONSECUTIVE_FAILURE_LIMIT = 3;

/**
 * fetch() for the depth-chart job: one `teamDepthChart` call per of our 32
 * canonical Team codes (`ESPN_TEAM_NUMERIC_ID`'s keys - the same 32
 * `nflTeam.js` normalizes to), outside any transaction. `teamDepthChart`
 * resolves `null` on a fetch failure and `[]` when ESPN answered with
 * nothing for that team (Ruling item 4) - only `null` counts against the
 * circuit breaker above; an empty-but-successful team is simply not a unit.
 * Throws when either the breaker trips or every team failed, so
 * `runSyncJob` records `fetch_failed` and the once-a-day gate
 * (server/modules/cadence.js, job `'espn-depth-chart'`) stays open for the
 * next tick to retry - a same-day rerun once ESPN recovers is exactly the
 * point (formal review f3: recording `ok: true` with zero rows on a total ESPN outage
 * would otherwise look identical to a real, empty snapshot and silently
 * close that gate until tomorrow).
 */
async function fetchDepthCharts({ transport } = {}) {
  return sweepTeams({
    job: 'espn-depth-chart',
    fetchTeam: (teamCode) => espnAthleteClient.teamDepthChart(teamCode, { transport }),
  });
}

/**
 * The one team sweep both team-level ESPN jobs share: `fetchTeam(teamCode)`
 * per of our 32 canonical Team codes, sequentially, resolving `null` on a
 * failure and an array (possibly empty) when ESPN answered. Only `null`
 * counts against the circuit breaker. A team that answered with rows is one
 * unit; a failed team is simply not a unit, so it writes nothing while every
 * other team still does. Throws (`runSyncJob` then records `fetch_failed`)
 * when the breaker trips or every team failed.
 */
async function sweepTeams({ job, fetchTeam }) {
  const teamCodes = Object.keys(espnAthleteClient.ESPN_TEAM_NUMERIC_ID);
  const units = [];
  let consecutiveFailures = 0;
  let anySucceeded = false;
  for (const teamCode of teamCodes) {
    // eslint-disable-next-line no-await-in-loop -- one call per team, by
    // design: this is a once-a-day job, not a hot path, and ESPN has no bulk
    // "every team" endpoint for either read.
    const rows = await fetchTeam(teamCode);
    if (rows === null) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        throw new Error(
          `${job}: ${consecutiveFailures} consecutive team fetches failed (last: ${teamCode}); ` +
          "stopping rather than burning the remaining teams' timeouts"
        );
      }
      continue;
    }
    consecutiveFailures = 0;
    anySucceeded = true;
    if (rows.length > 0) units.push({ teamCode, rows });
  }
  if (!anySucceeded) throw new Error(`${job}: every team fetch failed`);
  return units;
}

/** apply() for the depth-chart job: one team's rows, resolved and inserted
 * in this unit's own transaction. */
function applyDepthChartUnit(capturedDate) {
  return async function applyUnit(client, { teamCode, rows }) {
    const idByExternalId = await loadPlayerIdsByExternalId(client, rows.map((r) => r.athleteId));
    const playerIds = [];
    const teamCodes = [];
    const positionGroups = [];
    const ranks = [];
    const capturedDates = [];
    for (const row of rows) {
      const playerId = idByExternalId.get(Number(row.athleteId));
      if (!playerId) continue; // ESPN reports an athlete we don't roster - skip, don't invent a player
      playerIds.push(playerId);
      teamCodes.push(row.teamCode);
      positionGroups.push(row.positionGroup);
      ranks.push(row.rank);
      capturedDates.push(capturedDate);
    }
    if (playerIds.length === 0) return { teamCode, written: 0 };
    const result = await client.query(
      `INSERT INTO "player_depth_chart" ("player_id", "team_code", "position_group", "rank", "captured_date")
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::int[], $5::date[])
       ON CONFLICT ("player_id", "captured_date") DO NOTHING`,
      [playerIds, teamCodes, positionGroups, ranks, capturedDates]
    );
    return { teamCode, written: result.rowCount };
  };
}

/**
 * The daily ESPN depth-chart Sync run (job `'espn-depth-chart'`). One unit
 * per team that returned rows; one team failing to resolve any known player
 * never stops another team's write (`runSyncJob`'s per-unit transactions).
 *
 * `now` (#1509, spec #1493 "UTC day everywhere"): the UTC calendar day this
 * run belongs to, computed once via `cadence.utcDateKey(now)` and carried as
 * `detail.day` on the recorded row - not `capturedDate` above, which stays the
 * LOCAL calendar day `player_depth_chart` rows key on (unrelated to the
 * cadence gate, and unconverted by this ticket). A `fetch_failed` throw
 * carries no `detail.day` (runSyncJob never reaches the wrapper on a throw),
 * same as every other job on the gate.
 */
async function runDepthChartSync({ now = new Date(), transport } = {}) {
  const capturedDate = today(now);
  const day = cadence.utcDateKey(now);
  return runSyncJob({
    job: 'espn-depth-chart',
    fetch: async () => ({ units: await fetchDepthCharts({ transport }), detail: { day } }),
    apply: applyDepthChartUnit(capturedDate),
  });
}

/**
 * apply() for the roster-status job: one team's rows, resolved and written in
 * this unit's own transaction. Unlike the depth chart, a second run the same
 * day UPDATES the row (only when the status or team actually changed): the
 * Saturday run after the 4pm ET elevation deadline exists to record a status
 * an earlier run of the same day saw differently, so DO NOTHING would throw
 * away the very fact it was scheduled to capture. One row per player per day.
 */
function applyRosterStatusUnit(capturedDate) {
  return async function applyUnit(client, { teamCode, rows }) {
    const idByExternalId = await loadPlayerIdsByExternalId(client, rows.map((r) => r.athleteId));
    const playerIds = [];
    const teamCodes = [];
    const statuses = [];
    const capturedDates = [];
    for (const row of rows) {
      const playerId = idByExternalId.get(Number(row.athleteId));
      if (!playerId) continue; // ESPN reports an athlete we don't roster - skip, don't invent a player
      playerIds.push(playerId);
      teamCodes.push(row.teamCode);
      statuses.push(row.rosterStatus);
      capturedDates.push(capturedDate);
    }
    if (playerIds.length === 0) return { teamCode, written: 0 };
    const result = await client.query(
      `INSERT INTO "player_nfl_roster_status" ("player_id", "team_code", "roster_status", "captured_date")
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::date[])
       ON CONFLICT ("player_id", "captured_date") DO UPDATE
         SET "team_code" = EXCLUDED."team_code",
             "roster_status" = EXCLUDED."roster_status",
             "updated_at" = now()
         WHERE ("player_nfl_roster_status"."roster_status", "player_nfl_roster_status"."team_code")
               IS DISTINCT FROM (EXCLUDED."roster_status", EXCLUDED."team_code")`,
      [playerIds, teamCodes, statuses, capturedDates]
    );
    return { teamCode, written: result.rowCount };
  };
}

/**
 * The ESPN NFL roster-status Sync run (job `'espn-roster-status'`, #1766, ADR
 * 0041 amendment): one `teamRoster` call per team, each team that answered
 * with athletes one unit. A failed team fetch writes nothing for that team and
 * never fails the run; every team failing (or the consecutive-failure breaker
 * tripping) fails it, as the depth-chart run does. `now` is handled exactly as
 * `runDepthChartSync` handles it (`capturedDate` local day, `detail.day` UTC).
 *
 * #1789: a full `reconcileAvailability` sweep follows an OK run - a moved-to-
 * or -off-practice-squad row (or the 48h staleness expiry, #1767) is exactly
 * this job's own kind of fact change, and `applyRosterStatusUnit` only knows
 * each team's row count, not which players actually moved, so there is no id
 * list to scope a targeted reconcile to the way the injury sync's changed
 * ids do (#1789 ruling item 1). The sweep runs AFTER `runSyncJob` resolves,
 * on the pool - every unit's own transaction has already committed by then,
 * so there is no ambient transaction to protect with a SAVEPOINT the way
 * `syncInjuries` protects its in-transaction call; a reconcile failure here
 * simply starts and ends its own connection and is logged, never thrown,
 * matching every other trigger's "log and continue" rule. `runSyncJob`
 * rejects on a failed or fetch_failed run (this job has no refusal path), so
 * throwing out of the `await` below already skips the sweep - it needs no
 * ok-check of its own.
 */
async function runRosterStatusSync({ now = new Date(), transport } = {}) {
  const capturedDate = today(now);
  const day = cadence.utcDateKey(now);
  const result = await runSyncJob({
    job: 'espn-roster-status',
    fetch: async () => ({
      units: await sweepTeams({
        job: 'espn-roster-status',
        fetchTeam: (teamCode) => espnAthleteClient.teamRoster(teamCode, { transport }),
      }),
      detail: { day },
    }),
    apply: applyRosterStatusUnit(capturedDate),
  });
  try {
    const { reconcileAvailability, liveReconcileScope } = require('../services/projection.service');
    const scope = await liveReconcileScope();
    if (scope) await reconcileAvailability({ ...scope, now });
  } catch (err) {
    console.error('roster status sync: availability reconcile failed, continuing:', err.message);
  }
  return result;
}

/** fetch() for the Ownership job: one bulk call for the whole pool, outside
 * any transaction, as the run's single unit. `ownership()` resolves `null`
 * on a fetch failure (Ruling item 4); this throws in that case so
 * `runSyncJob` records `fetch_failed` rather than an `ok: true` empty
 * snapshot, for the same reason `fetchDepthCharts` above does (formal review
 * f3). */
async function fetchOwnership({ transport } = {}) {
  const rows = await espnAthleteClient.ownership({ transport });
  if (rows === null) throw new Error('espn-ownership: ESPN fetch failed');
  return [rows];
}

/** apply() for the Ownership job: the whole pool's rows, resolved and
 * inserted in one transaction (one unit, ADR 0036). */
function applyOwnershipUnit(capturedDate) {
  return async function applyUnit(client, rows) {
    const idByExternalId = await loadPlayerIdsByExternalId(client, rows.map((r) => r.athleteId));
    const playerIds = [];
    const capturedDates = [];
    const percentOwned = [];
    const percentStarted = [];
    const percentChange = [];
    for (const row of rows) {
      const playerId = idByExternalId.get(Number(row.athleteId));
      if (!playerId) continue; // ESPN reports an athlete we don't roster - skip, don't invent a player
      playerIds.push(playerId);
      capturedDates.push(capturedDate);
      percentOwned.push(row.percentOwned);
      percentStarted.push(row.percentStarted);
      percentChange.push(row.percentChange);
    }
    if (playerIds.length === 0) return { written: 0 };
    const result = await client.query(
      `INSERT INTO "player_ownership" ("player_id", "captured_date", "percent_owned", "percent_started", "percent_change")
       SELECT * FROM unnest($1::int[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[])
       ON CONFLICT ("player_id", "captured_date") DO NOTHING`,
      [playerIds, capturedDates, percentOwned, percentStarted, percentChange]
    );
    return { written: result.rowCount };
  };
}

/**
 * The daily ESPN Ownership Sync run (job `'espn-ownership'`), one unit for
 * the whole pool.
 *
 * `now` (#1509, spec #1493 "UTC day everywhere"): the UTC calendar day this
 * run belongs to, computed once via `cadence.utcDateKey(now)` and carried as
 * `detail.day` on the recorded row - not `capturedDate` above, which stays
 * the LOCAL calendar day `player_ownership` rows key on, same distinction as
 * `runDepthChartSync`.
 */
async function runOwnershipSync({ now = new Date(), transport } = {}) {
  const capturedDate = today(now);
  const day = cadence.utcDateKey(now);
  return runSyncJob({
    job: 'espn-ownership',
    fetch: async () => ({ units: await fetchOwnership({ transport }), detail: { day } }),
    apply: applyOwnershipUnit(capturedDate),
  });
}

module.exports = {
  runDepthChartSync,
  runRosterStatusSync,
  runOwnershipSync,
  // exported for tests
  loadPlayerIdsByExternalId,
};
