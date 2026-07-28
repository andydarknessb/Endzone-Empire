/**
 * Prospective-holdout capture: append-only, pre-kickoff projection snapshots.
 *
 * The evaluation problem this solves: every historical backtest of this
 * engine re-derives its inputs from a database that has since moved (teams,
 * injuries, corrected stats), so none of its numbers are what the model
 * actually knew at the time. The only evaluation that cannot be argued with
 * is one against predictions that were WRITTEN DOWN before the games were
 * played and physically cannot change afterwards. This service writes those.
 *
 * Design constraints, all deliberate:
 *
 * - **Scheduled and cohort-complete, never traffic-driven.** A ledger built
 *   from whatever players users happened to request would inherit request
 *   bias. The cohort is EVERY player at the fantasy positions, read inside
 *   the capture transaction and fingerprinted into `cohort_hash`.
 * - **Predeclared scoring profiles.** The three canonical presets
 *   (standard / half_ppr / ppr), fixed here in code. League-specific
 *   captures can be added later as `capture_kind: 'supplemental'` without
 *   touching the scheduled identity space.
 * - **All-or-nothing.** One capture = ONE transaction holding an advisory
 *   lock on the snapshot identity: schedule validation, cohort read,
 *   projection computation, header, and every child row commit together or
 *   not at all. There is no such thing as a partial snapshot; a crash mid
 *   -capture leaves nothing, and the next tick starts clean.
 * - **Consistent inputs.** The transaction runs REPEATABLE READ and the
 *   projection engine reads through the same connection, so schedule,
 *   cohort, and features all come from one database snapshot.
 * - **No completion of existing snapshots, ever.** On conflict the capture
 *   either skips an EXACT match - complete, with identical constants /
 *   cohort / schedule / release / protocol provenance - or fails loudly.
 *   Appending rows computed later under an old header would be mixed
 *   provenance, which is the one thing a ledger must never contain.
 * - **The deadline is the database's.** `captured_at` is the DB clock, the
 *   header CHECK rejects unlabeled post-kickoff captures, a BEFORE INSERT
 *   trigger rejects post-kickoff child rows independently, and the service
 *   rechecks `clock_timestamp()` immediately before COMMIT. Late means
 *   absent (or explicitly `is_late` = non-holdout), never quietly included.
 * - **Validated schedule, not a heuristic floor.** The week's earliest
 *   kickoff is derived in-transaction from `nfl_games` after structural
 *   validation: reciprocal home/away pairs sharing a game key, non-null
 *   kickoffs and keys, and team accounting against the season's full team
 *   set (byes must be an even count of at most six). The validated count
 *   and digest are stored on the header.
 * - **No outcomes here, ever.** Evaluation joins `player_stats` at read
 *   time. Nothing in this module writes to a prediction row after capture.
 *
 * `holdout_capture_status` is the operational companion (mutable, upserted
 * every attempt) so completeness and failures survive worker restarts and
 * surface in the web process's health reporting.
 */
const crypto = require('crypto');
const pool = require('../modules/pool');
const model = require('./projectionModel');
const projection = require('./projection.service');
const { normalizeTeamKey } = require('./projectionFeatures');
const { SCORING_PRESETS } = require('./scoring.service');

/** Bumped whenever the capture protocol changes shape or meaning. */
const HOLDOUT_PROTOCOL_VERSION = 1;

/** Capture opens this long before a week's first kickoff. */
const CAPTURE_WINDOW_HOURS = 24;

/** The projectable cohort. IDP joins when IDP players exist in `players`. */
const HOLDOUT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Predeclared profiles; the ONLY rule sets the scheduled capture writes. */
const HOLDOUT_SCORING_PROFILES = Object.freeze(
  Object.entries(SCORING_PRESETS).map(([name, rules]) => Object.freeze({ name, rules }))
);

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * MODEL_CONSTANTS fingerprint. JSON.stringify is deterministic for a given
 * build (object-literal key order), which is exactly the scope a constants
 * hash needs: two builds that serialize differently ARE different constants
 * provenance until proven otherwise.
 */
function constantsHash() {
  return sha256(JSON.stringify(model.MODEL_CONSTANTS));
}

/**
 * The deployed commit (mirrors /api/health). REQUIRED: a snapshot that
 * cannot say what code produced it is not evidence, so capture refuses to
 * run without one rather than writing an unattributable row.
 */
function requireReleaseSha() {
  const sha = process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null;
  if (!sha) {
    throw new Error('holdout capture requires a release SHA (RENDER_GIT_COMMIT or APP_RELEASE)');
  }
  return String(sha).slice(0, 64);
}

/**
 * Structurally validate one week's schedule rows and derive what the header
 * records from them. Throws on anything that smells like a partial sync
 * (the Tank01 TBD-game history makes this a real hazard, not paranoia).
 */
function validateSchedule({ rows, seasonTeamCount, season, week }) {
  if (!rows || rows.length === 0) {
    throw new Error(`no schedule rows for ${season} week ${week}`);
  }
  if (rows.length % 2 !== 0) {
    throw new Error(`schedule for ${season} week ${week} has an odd row count (${rows.length})`);
  }
  const byTeam = new Map();
  for (const row of rows) {
    if (!row.kickoff_at) throw new Error(`schedule row without kickoff for ${season} week ${week} (${row.nfl_team})`);
    if (!row.game_key) throw new Error(`schedule row without game key for ${season} week ${week} (${row.nfl_team})`);
    if (!row.opponent) throw new Error(`schedule row without opponent for ${season} week ${week} (${row.nfl_team})`);
    byTeam.set(normalizeTeamKey(row.nfl_team), row);
  }
  if (byTeam.size !== rows.length) {
    throw new Error(`schedule for ${season} week ${week} lists a team twice`);
  }
  for (const [teamKey, row] of byTeam) {
    const reciprocal = byTeam.get(normalizeTeamKey(row.opponent));
    if (!reciprocal || normalizeTeamKey(reciprocal.opponent) !== teamKey) {
      throw new Error(`schedule for ${season} week ${week} is missing the reciprocal of ${row.nfl_team} vs ${row.opponent}`);
    }
    if (reciprocal.game_key !== row.game_key) {
      throw new Error(`schedule for ${season} week ${week}: ${row.nfl_team} and ${row.opponent} disagree on game key`);
    }
  }
  // Team accounting against the season's own authoritative team set: every
  // team either plays or is on bye, and NFL byes come in even groups of at
  // most six.
  const byes = Number(seasonTeamCount) - rows.length;
  if (byes < 0 || byes > 6 || byes % 2 !== 0) {
    throw new Error(
      `schedule for ${season} week ${week} fails team accounting: ${rows.length} of ${seasonTeamCount} teams playing (${byes} byes)`
    );
  }
  const digestInput = rows
    .map((r) => `${normalizeTeamKey(r.nfl_team)}|${normalizeTeamKey(r.opponent)}|${r.home_away || ''}|${new Date(r.kickoff_at).toISOString()}|${r.game_key}`)
    .sort()
    .join('\n');
  const kickoffs = rows.map((r) => new Date(r.kickoff_at).getTime());
  return {
    firstKickoffAt: new Date(Math.min(...kickoffs)),
    scheduleGames: rows.length / 2,
    scheduleHash: sha256(digestInput),
    byTeam,
  };
}

const CHUNK = 200;
const CHILD_COLS = 18;

/**
 * Capture one (season, week, profile) snapshot, all-or-nothing.
 *
 * Returns `{ skipped: 'already complete' }` ONLY for an exact provenance
 * match; any other conflict, validation failure, or missed deadline throws
 * and leaves the ledger untouched.
 */
async function snapshotWeek({ season, week, profileName, rules, client = pool }) {
  const releaseSha = requireReleaseSha();
  const scoringHash = model.scoringHash(rules);
  const modelVersion = model.MODEL_VERSION;
  const identity = `${season}:${week}:${scoringHash}:${modelVersion}:scheduled`;

  const conn = await client.connect();
  try {
    await conn.query('BEGIN');
    // One snapshot of the database for every read below - schedule, cohort,
    // and the projection engine's feature bundle all agree.
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    // Serialize concurrent captures of the SAME identity; unrelated
    // identities proceed in parallel. Released automatically at tx end.
    await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity]);

    const scheduleResult = await conn.query(
      `SELECT "nfl_team", "opponent", "home_away", "kickoff_at", "game_key"
       FROM "nfl_games" WHERE "season" = $1 AND "week" = $2 ORDER BY "nfl_team"`,
      [season, week]
    );
    const teamCountResult = await conn.query(
      `SELECT COUNT(DISTINCT "nfl_team")::int AS "teams" FROM "nfl_games" WHERE "season" = $1`,
      [season]
    );
    const schedule = validateSchedule({
      rows: scheduleResult.rows,
      seasonTeamCount: teamCountResult.rows[0].teams,
      season,
      week,
    });

    const clockBefore = await conn.query('SELECT clock_timestamp() AS "now"');
    if (new Date(clockBefore.rows[0].now) >= schedule.firstKickoffAt) {
      throw new Error(
        `capture window for ${season} week ${week} has closed (first kickoff ${schedule.firstKickoffAt.toISOString()})`
      );
    }

    const cohortResult = await conn.query(
      `SELECT "id", "position", "nfl_team", "injury_status"
       FROM "players" WHERE "position" = ANY($1::text[]) ORDER BY "id"`,
      [HOLDOUT_POSITIONS]
    );
    const cohort = cohortResult.rows;
    if (cohort.length === 0) {
      throw new Error(`empty player cohort for ${season} week ${week}`);
    }
    const cohortHash = sha256(cohort.map((r) => r.id).join(','));

    // Conflict handling under the identity lock: an existing snapshot is
    // honored ONLY as an exact, complete provenance match. Anything else is
    // an anomaly the ledger must not paper over - completing it with a NEW
    // projection run would put rows from two different computations under
    // one header.
    const existing = await conn.query(
      `SELECT "s"."id", "s"."cohort_size", "s"."cohort_hash", "s"."constants_hash",
              "s"."schedule_hash", "s"."release_sha", "s"."protocol_version",
              COUNT("p"."id")::int AS "rows"
       FROM "projection_snapshots" "s"
       LEFT JOIN "projection_snapshot_players" "p" ON "p"."snapshot_id" = "s"."id"
       WHERE "s"."season" = $1 AND "s"."week" = $2 AND "s"."scoring_hash" = $3
         AND "s"."model_version" = $4 AND "s"."capture_kind" = 'scheduled'
       GROUP BY "s"."id"`,
      [season, week, scoringHash, modelVersion]
    );
    const found = existing.rows[0];
    if (found) {
      const complete = Number(found.rows) >= Number(found.cohort_size);
      const matches = found.cohort_hash === cohortHash
        && found.constants_hash === constantsHash()
        && found.schedule_hash === schedule.scheduleHash
        && found.release_sha === releaseSha
        && Number(found.protocol_version) === HOLDOUT_PROTOCOL_VERSION;
      if (complete && matches) {
        await conn.query('ROLLBACK');
        return { season, week, profileName, snapshotId: found.id, skipped: 'already complete' };
      }
      throw new Error(
        `holdout snapshot conflict for ${season} week ${week} ${profileName}: ` +
        (complete ? 'provenance mismatch' : `incomplete (${found.rows}/${found.cohort_size} rows)`) +
        ' - refusing to touch an existing snapshot'
      );
    }

    const playerIds = cohort.map((r) => r.id);
    // The compute path, through THIS connection: no cache table is read or
    // written, and every input comes from the transaction's snapshot.
    const run = await projection.generateProjections({
      season, week, rules, playerIds, hashValue: scoringHash, client: conn,
    });

    const header = await conn.query(
      `INSERT INTO "projection_snapshots"
         ("season", "week", "scoring_profile", "scoring_hash", "model_version",
          "constants_hash", "release_sha", "cohort_hash", "cohort_size",
          "schedule_games", "schedule_hash", "protocol_version", "capture_kind",
          "first_kickoff_at", "input_cutoff", "source_coverage")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'scheduled', $13, $14, $15::jsonb)
       RETURNING "id"`,
      [
        season, week, profileName, scoringHash, modelVersion,
        constantsHash(), releaseSha, cohortHash, cohort.length,
        schedule.scheduleGames, schedule.scheduleHash, HOLDOUT_PROTOCOL_VERSION,
        schedule.firstKickoffAt, run.inputCutoff || null, JSON.stringify(run.sourceCoverage || {}),
      ]
    );
    const snapshotId = header.rows[0].id;

    for (let offset = 0; offset < cohort.length; offset += CHUNK) {
      const chunk = cohort.slice(offset, offset + CHUNK);
      const placeholders = [];
      const params = [];
      chunk.forEach((playerRow, i) => {
        const p = run.projections.get(playerRow.id) || {};
        const game = schedule.byTeam.get(normalizeTeamKey(playerRow.nfl_team)) || null;
        const base = i * CHILD_COLS;
        placeholders.push(
          `(${Array.from({ length: CHILD_COLS }, (_, c) =>
            `$${base + c + 1}${c === 11 ? '::jsonb' : ''}`).join(', ')})`
        );
        params.push(
          snapshotId, playerRow.id,
          p.mean ?? null, p.median ?? null, p.p10 ?? null, p.p25 ?? null,
          p.p75 ?? null, p.p90 ?? null, p.activeProbability ?? null,
          p.confidence ?? null, p.sampleSize || 0, JSON.stringify(p.factors || {}),
          playerRow.position ?? null, playerRow.nfl_team ?? null, playerRow.injury_status ?? null,
          game ? game.opponent : null, game ? game.home_away : null,
          game ? game.kickoff_at : null
        );
      });
      await conn.query(
        `INSERT INTO "projection_snapshot_players"
           ("snapshot_id", "player_id", "mean", "median", "p10", "p25", "p75", "p90",
            "active_probability", "confidence", "sample_size", "factors",
            "position", "nfl_team", "injury_status", "opponent", "home_away", "game_kickoff_at")
         VALUES ${placeholders.join(', ')}`,
        params
      );
    }

    // The deadline, rechecked at the last possible moment: computation took
    // real time, and a capture that slid past kickoff while computing must
    // not commit.
    const clockAfter = await conn.query('SELECT clock_timestamp() AS "now"');
    if (new Date(clockAfter.rows[0].now) >= schedule.firstKickoffAt) {
      throw new Error(
        `capture for ${season} week ${week} ${profileName} missed its deadline during computation - rolling back`
      );
    }

    await conn.query('COMMIT');
    return { season, week, profileName, snapshotId, cohortSize: cohort.length, inserted: cohort.length };
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch (rollbackErr) { /* connection already aborted */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Durable per-attempt outcome, upserted OUTSIDE the capture transaction so
 * failures are recorded even when the capture rolled back. This is the
 * operational record health/admin reporting reads; it is not the ledger.
 */
async function recordCaptureStatus({ season, week, profileName, status, message = null, snapshotId = null, client = pool }) {
  await client.query(
    `INSERT INTO "holdout_capture_status"
       ("season", "week", "scoring_profile", "status", "message", "snapshot_id", "attempts", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, 1, now())
     ON CONFLICT ("season", "week", "scoring_profile")
     DO UPDATE SET "status" = EXCLUDED."status",
                   "message" = EXCLUDED."message",
                   "snapshot_id" = COALESCE(EXCLUDED."snapshot_id", "holdout_capture_status"."snapshot_id"),
                   "attempts" = "holdout_capture_status"."attempts" + 1,
                   "updated_at" = now()`,
    [season, week, profileName, status, message ? String(message).slice(0, 500) : null, snapshotId]
  );
}

/**
 * The scheduled entry point: find weeks whose first kickoff is inside the
 * capture window and capture each predeclared profile for them. One
 * profile's failure never blocks another's attempt; every attempt's outcome
 * is persisted to `holdout_capture_status`. A week whose window was missed
 * entirely fails the deadline checks and stays absent - that is the
 * fail-closed behavior, not a bug.
 */
async function captureDueSnapshots({ now = new Date(), client = pool } = {}) {
  const due = await client.query(
    `SELECT "season", "week", MIN("kickoff_at") AS "first_kickoff"
     FROM "nfl_games"
     GROUP BY "season", "week"
     HAVING MIN("kickoff_at") > $1
        AND MIN("kickoff_at") <= $2`,
    [now, new Date(now.getTime() + CAPTURE_WINDOW_HOURS * 3600 * 1000)]
  );

  const captured = [];
  const failures = [];
  for (const row of due.rows) {
    const season = Number(row.season);
    const week = Number(row.week);
    for (const profile of HOLDOUT_SCORING_PROFILES) {
      let statusRow;
      try {
        const outcome = await snapshotWeek({
          season, week, profileName: profile.name, rules: profile.rules, client,
        });
        captured.push(outcome);
        statusRow = {
          status: outcome.skipped ? 'skipped' : 'captured',
          message: outcome.skipped || null,
          snapshotId: outcome.snapshotId ?? null,
        };
      } catch (err) {
        failures.push({ season, week, profileName: profile.name, message: err.message });
        statusRow = { status: 'failed', message: err.message, snapshotId: null };
      }
      try {
        await recordCaptureStatus({
          season, week, profileName: profile.name, client, ...statusRow,
        });
      } catch (statusErr) {
        console.error(
          'holdout status write failed for %s week %s profile %s:',
          season, week, profile.name, statusErr.message
        );
      }
    }
  }
  return { captured, failures };
}

module.exports = {
  HOLDOUT_PROTOCOL_VERSION,
  CAPTURE_WINDOW_HOURS,
  HOLDOUT_POSITIONS,
  HOLDOUT_SCORING_PROFILES,
  constantsHash,
  validateSchedule,
  snapshotWeek,
  recordCaptureStatus,
  captureDueSnapshots,
};
