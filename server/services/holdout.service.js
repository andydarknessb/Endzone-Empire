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
 *   bias (popular players over- and deep-roster players under-represented).
 *   The cohort is EVERY player at the fantasy positions, computed fresh at
 *   capture time and fingerprinted into `cohort_hash`.
 * - **Predeclared scoring profiles.** The three canonical presets
 *   (standard / half_ppr / ppr), fixed here in code — not whatever mixture
 *   of league rules happened to be active. League-specific captures can be
 *   added later as `capture_kind: 'supplemental'` without touching the
 *   scheduled identity space.
 * - **Compute path, not cache path.** Snapshots go through
 *   `generateProjections`, which computes from the feature bundle without
 *   reading or writing `projection_runs`. A cache hit, miss, or
 *   post-correction invalidation therefore cannot change what gets captured.
 * - **Idempotent by identity, immutable by schema.** Retries INSERT ... ON
 *   CONFLICT DO NOTHING against the snapshot's unique identity; a
 *   partially-written snapshot completes on the next pass. UPDATE/DELETE/
 *   TRUNCATE on either ledger table raise in the database itself (see the
 *   20260730000001 migration), and the pre-kickoff cutoff is a CHECK
 *   constraint: a capture at or after the week's first kickoff fails closed
 *   unless explicitly labeled `is_late` (= non-holdout).
 * - **No outcomes here, ever.** Evaluation joins `player_stats` at read
 *   time. Nothing in this module writes to a prediction row after capture.
 */
const crypto = require('crypto');
const pool = require('../modules/pool');
const model = require('./projectionModel');
const projection = require('./projection.service');
const { SCORING_PRESETS } = require('./scoring.service');

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

/** The deployed commit, when the platform exposes it (mirrors /api/health). */
function releaseSha() {
  return process.env.RENDER_GIT_COMMIT || process.env.RELEASE_SHA || null;
}

const CHUNK = 200;

/**
 * Capture one (season, week, profile) snapshot. Idempotent: safe to call
 * again after a partial failure — the header inserts ON CONFLICT DO NOTHING
 * and player rows fill in whatever is missing. Never updates anything.
 *
 * Throws when the database rejects the capture (the pre-kickoff CHECK is the
 * expected rejector); the caller decides whether that is fatal.
 */
async function snapshotWeek({
  season,
  week,
  profileName,
  rules,
  firstKickoffAt,
  client = pool,
}) {
  const scoringHash = model.scoringHash(rules);
  const modelVersion = model.MODEL_VERSION;

  const cohortResult = await client.query(
    `SELECT "id" FROM "players" WHERE "position" = ANY($1::text[]) ORDER BY "id"`,
    [HOLDOUT_POSITIONS]
  );
  const playerIds = cohortResult.rows.map((r) => r.id);
  if (playerIds.length === 0) {
    return { season, week, profileName, skipped: 'empty cohort' };
  }
  const cohortHash = sha256(playerIds.join(','));

  // Cheap completeness probe so a fully-captured snapshot costs one SELECT
  // per tick, not a full projection run.
  const existing = await client.query(
    `SELECT "s"."id", "s"."cohort_size", COUNT("p"."id")::int AS "rows"
     FROM "projection_snapshots" "s"
     LEFT JOIN "projection_snapshot_players" "p" ON "p"."snapshot_id" = "s"."id"
     WHERE "s"."season" = $1 AND "s"."week" = $2 AND "s"."scoring_hash" = $3
       AND "s"."model_version" = $4 AND "s"."capture_kind" = 'scheduled'
     GROUP BY "s"."id", "s"."cohort_size"`,
    [season, week, scoringHash, modelVersion]
  );
  const found = existing.rows[0];
  if (found && Number(found.rows) >= Number(found.cohort_size)) {
    return { season, week, profileName, snapshotId: found.id, skipped: 'already complete' };
  }

  // The compute path: reads the feature bundle, touches no cache table.
  const run = await projection.generateProjections({
    season, week, rules, playerIds, hashValue: scoringHash, client,
  });

  let snapshotId = found ? found.id : null;
  if (snapshotId == null) {
    // `captured_at` is the DATABASE's clock via the column default, so the
    // pre-kickoff CHECK judges the moment of the write, not a JS timestamp
    // this process could get wrong.
    const inserted = await client.query(
      `INSERT INTO "projection_snapshots"
         ("season", "week", "scoring_profile", "scoring_hash", "model_version",
          "constants_hash", "release_sha", "cohort_hash", "cohort_size",
          "capture_kind", "first_kickoff_at", "input_cutoff", "source_coverage")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10, $11, $12::jsonb)
       ON CONFLICT ("season", "week", "scoring_hash", "model_version", "capture_kind")
       DO NOTHING
       RETURNING "id"`,
      [
        season, week, profileName, scoringHash, modelVersion,
        constantsHash(), releaseSha(), cohortHash, playerIds.length,
        firstKickoffAt, run.inputCutoff || null, JSON.stringify(run.sourceCoverage || {}),
      ]
    );
    if (inserted.rows[0]) {
      snapshotId = inserted.rows[0].id;
    } else {
      // A concurrent retry won the insert; adopt its header.
      const raced = await client.query(
        `SELECT "id" FROM "projection_snapshots"
         WHERE "season" = $1 AND "week" = $2 AND "scoring_hash" = $3
           AND "model_version" = $4 AND "capture_kind" = 'scheduled'`,
        [season, week, scoringHash, modelVersion]
      );
      snapshotId = raced.rows[0] && raced.rows[0].id;
    }
  }
  if (snapshotId == null) {
    throw new Error(`holdout snapshot header missing after insert for ${season} week ${week}`);
  }

  let written = 0;
  for (let offset = 0; offset < playerIds.length; offset += CHUNK) {
    const chunk = playerIds.slice(offset, offset + CHUNK);
    const placeholders = [];
    const params = [];
    const COLS = 12;
    chunk.forEach((playerId, i) => {
      const p = run.projections.get(playerId) || {};
      const base = i * COLS;
      placeholders.push(
        `(${Array.from({ length: COLS }, (_, c) =>
          `$${base + c + 1}${c === COLS - 1 ? '::jsonb' : ''}`).join(', ')})`
      );
      params.push(
        snapshotId, playerId,
        p.mean ?? null, p.median ?? null, p.p10 ?? null, p.p25 ?? null,
        p.p75 ?? null, p.p90 ?? null, p.activeProbability ?? null,
        p.confidence ?? null, p.sampleSize || 0, JSON.stringify(p.factors || {})
      );
    });
    const result = await client.query(
      `INSERT INTO "projection_snapshot_players"
         ("snapshot_id", "player_id", "mean", "median", "p10", "p25", "p75", "p90",
          "active_probability", "confidence", "sample_size", "factors")
       VALUES ${placeholders.join(', ')}
       ON CONFLICT ("snapshot_id", "player_id") DO NOTHING`,
      params
    );
    written += Number(result && result.rowCount) || 0;
  }

  return { season, week, profileName, snapshotId, cohortSize: playerIds.length, inserted: written };
}

/**
 * The scheduled entry point: find weeks whose first kickoff is inside the
 * capture window and snapshot each predeclared profile for them. One
 * profile's failure never blocks another's attempt; failures come back in
 * the summary (and are the caller's signal to log loudly). A week whose
 * window was missed entirely fails the DB cutoff and stays absent — that is
 * the fail-closed behavior, not a bug.
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
    for (const profile of HOLDOUT_SCORING_PROFILES) {
      try {
        const outcome = await snapshotWeek({
          season: Number(row.season),
          week: Number(row.week),
          profileName: profile.name,
          rules: profile.rules,
          firstKickoffAt: row.first_kickoff,
          client,
        });
        captured.push(outcome);
      } catch (err) {
        failures.push({
          season: Number(row.season),
          week: Number(row.week),
          profileName: profile.name,
          message: err.message,
        });
      }
    }
  }
  return { captured, failures };
}

module.exports = {
  CAPTURE_WINDOW_HOURS,
  HOLDOUT_POSITIONS,
  HOLDOUT_SCORING_PROFILES,
  constantsHash,
  snapshotWeek,
  captureDueSnapshots,
};
