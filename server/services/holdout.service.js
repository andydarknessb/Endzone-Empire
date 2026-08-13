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
 * - **Candidate arms ride the scheduled capture** (protocol 2, the
 *   `holdout-confirm-2026` study): each capture transaction also writes the
 *   preregistered candidate cells (`CANDIDATE_ARMS`) as their own
 *   `capture_kind` rows, computed in the SAME transaction from the SAME
 *   REPEATABLE READ snapshot, differing from the scheduled arm only in the
 *   constant leaves their `constants_hash` fingerprints. A candidate mean
 *   diverging from the scheduled mean aborts the whole capture: the
 *   candidate kernels touch dispersion only, so divergence proves the arms
 *   did not share a snapshot.
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
 * - **The deadline is the MANIFEST's, enforced by the database clock.** Each
 *   manifest week carries an independently sourced, conservative
 *   `captureNotAfter` deadline. The observed schedule may TIGHTEN the
 *   effective cutoff (an earlier synced kickoff closes the window sooner)
 *   but can never extend it: shifting every stored kickoff later moves
 *   nothing, so a consistently stale schedule cannot admit a post-game
 *   capture labeled pre-kickoff. `captured_at` is the DB clock, the header
 *   CHECK rejects unlabeled post-deadline captures, a BEFORE INSERT trigger
 *   rejects post-deadline child rows independently, and the service
 *   rechecks `clock_timestamp()` immediately before COMMIT. Late means
 *   absent (or explicitly `is_late` = non-holdout), never quietly included.
 * - **Validated schedule, not a heuristic floor.** The week's earliest
 *   kickoff is derived in-transaction from `nfl_games` after structural
 *   validation: reciprocal home/away pairs sharing a game key, non-null
 *   kickoffs and keys, and team accounting against the season's full team
 *   set (byes must be an even count of at most six). The validated count
 *   and digest are stored on the header. The observed first kickoff is a
 *   tightening input to the cutoff, never its source.
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
const {
  verifySeasonManifest,
  CANONICAL_TEAM_KEYS,
  SEASON_WEEKS,
  GAMES_PER_TEAM,
} = require('./scheduleManifest');

/**
 * Bumped whenever the capture protocol changes shape or meaning.
 *
 * 2: a complete capture is now THREE arms - the scheduled snapshot plus the
 *    two `holdout-confirm-2026` candidate cells - committed in one
 *    transaction from one feature snapshot. A protocol-1 week (scheduled
 *    arm only) must never skip-match as "already complete" under this
 *    meaning, which the per-header protocol check enforces.
 */
const HOLDOUT_PROTOCOL_VERSION = 2;

/** Capture opens this long before a week's first kickoff. */
const CAPTURE_WINDOW_HOURS = 24;

// The EXPECTED domain - 32 canonical franchises, 18 weeks, 17 games per
// team - lives in scheduleManifest.js (constants, never inferred from
// observed rows), shared by the manifest verifier, the generator, and the
// schedule validation below. Deriving any of these from observed
// `nfl_games` rows would make schedule validation self-referential - a
// wholly missing team or week creates no absence to detect against a
// universe built only from what was observed.

/**
 * The INDEPENDENT schedule authority: exact (week, away, home) identities
 * AND a per-week `captureNotAfter` deadline per season, frozen in the
 * repository from nflverse's public schedule data - not derived from the
 * database it validates. Counts and closure cannot catch a game quietly
 * moved between weeks or a reciprocal opponent swap; only identity equality
 * against an authority can, and only an authority with all 18 weeks can
 * make an entirely absent week visible. Likewise a cutoff derived from
 * stored kickoffs would move when the stored kickoffs move; only an
 * independent deadline pins it.
 *
 * Every manifest passes `verifySeasonManifest` at registration: shape,
 * a deadline for every week, and a digest that must reproduce - a manifest
 * that cannot prove it is the one that was generated is not an authority.
 *
 * The registry is a mutable Map ON PURPOSE: tests register synthetic
 * seasons and remove them again. A season with no manifest cannot be
 * captured and produces no obligations - the ledger never guesses.
 */
const SEASON_MANIFESTS = new Map();

function registerSeasonManifest(manifest) {
  verifySeasonManifest(manifest);
  SEASON_MANIFESTS.set(Number(manifest.season), manifest);
  return manifest;
}

registerSeasonManifest(require('../data/nfl-schedule-2026.json'));

function manifestGamesForWeek(season, week) {
  const manifest = SEASON_MANIFESTS.get(Number(season));
  if (!manifest) return null;
  return manifest.games.filter((g) => Number(g.week) === Number(week));
}

/** The manifest's independent, conservative capture deadline for a week. */
function captureNotAfterFor(season, week) {
  const manifest = SEASON_MANIFESTS.get(Number(season));
  if (!manifest) return null;
  const iso = manifest.captureNotAfter && manifest.captureNotAfter[String(Number(week))];
  return iso ? new Date(iso) : null;
}

/**
 * The effective cutoff: the manifest deadline, tightened by the observed
 * first kickoff when one is known and EARLIER. Observed data can close the
 * window sooner (a game moved up) but can never hold it open past the
 * independent deadline - that asymmetry is the whole point.
 */
function effectiveCutoff(deadline, observedFirstKickoff) {
  if (!deadline) return null;
  if (observedFirstKickoff && observedFirstKickoff < deadline) return observedFirstKickoff;
  return deadline;
}

/** The projectable cohort. IDP joins when IDP players exist in `players`. */
const HOLDOUT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Predeclared profiles; the ONLY rule sets the scheduled capture writes. */
const HOLDOUT_SCORING_PROFILES = Object.freeze(
  Object.entries(SCORING_PRESETS).map(([name, rules]) => Object.freeze({ name, rules }))
);

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * Constants fingerprint. JSON.stringify is deterministic for a given
 * build (object-literal key order), which is exactly the scope a constants
 * hash needs: two builds that serialize differently ARE different constants
 * provenance until proven otherwise. Defaults to production's constants;
 * candidate arms pass their own resolved object.
 */
function constantsHash(constants = model.MODEL_CONSTANTS) {
  return sha256(JSON.stringify(constants));
}

/**
 * The candidate arms of `holdout-confirm-2026` (see
 * backtest-artifacts/holdout-confirm-2026/PREREGISTRATION.md, sections 1-2).
 * Each names its `capture_kind` - the ledger's unique key is
 * (season, week, scoring_hash, model_version, capture_kind), so DISTINCT
 * kinds are what give two same-model arms distinct identities without
 * touching the scheduled identity space - and the exact constant leaves it
 * changes from production's MODEL_CONSTANTS.
 *
 * Frozen: the study is sealed against these values, and a runtime mutation
 * would silently capture an arm the preregistration never named.
 */
const CANDIDATE_ARMS = Object.freeze([
  Object.freeze({
    kind: 'candidate:bw-20',
    overrides: Object.freeze({ smoothingBandwidth: 0.2, intervalScale: 1.0 }),
  }),
  Object.freeze({
    kind: 'candidate:bw-15',
    overrides: Object.freeze({ smoothingBandwidth: 0.15, intervalScale: 1.0 }),
  }),
]);

/**
 * A candidate cell's full constants: production's MODEL_CONSTANTS with
 * EXACTLY the named `simulation` leaves changed and nothing else.
 *
 * Every override key must already exist on the production object. That is a
 * correctness rule, not pedantry: JSON key order is insertion order, the
 * constants hash is JSON.stringify, and ASSIGNING an existing key preserves
 * order while ADDING one appends it - so a typo'd override key would produce
 * an object whose hash differs from production's for a structural reason on
 * top of the value change, and the provenance record would be lying about
 * what the arm varied.
 */
function resolveCandidateConstants(overrides) {
  const resolved = JSON.parse(JSON.stringify(model.MODEL_CONSTANTS));
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in resolved.simulation)) {
      throw new Error(`candidate arm override "${key}" is not an existing simulation constant`);
    }
    resolved.simulation[key] = value;
  }
  return resolved;
}

/**
 * Every arm one capture transaction writes, in fixed order, scheduled first.
 * Resolved fresh per call so a test that mocks MODEL_CONSTANTS sees its mock.
 */
function captureArms() {
  return [
    { kind: 'scheduled', constants: model.MODEL_CONSTANTS, hash: constantsHash() },
    ...CANDIDATE_ARMS.map((arm) => {
      const constants = resolveCandidateConstants(arm.overrides);
      return { kind: arm.kind, constants, hash: constantsHash(constants) };
    }),
  ];
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
 *
 * Three layers:
 *
 * 1. **Identity equality against the manifest.** `manifestGames` is the
 *    week's authoritative (away, home) list from the frozen independent
 *    manifest. Every manifest game must be present as exactly its two
 *    reciprocal rows with identical kickoffs, and NO row may exist outside
 *    the manifest. Counts and closure cannot see a game quietly moved into
 *    a shared bye week or a reciprocal opponent swap - identity equality
 *    can. The returned `firstKickoffAt` is the OBSERVED earliest kickoff,
 *    which may tighten the manifest's `captureNotAfter` deadline but never
 *    replaces it.
 *
 * 2. **Per-game shape.** Reciprocity and kickoff agreement always;
 *    `home_away` and `game_key`, WHEN the sync populated them, must be
 *    internally consistent and match the manifest orientation. (The 2026
 *    sync stores identities and kickoffs but not orientation or keys;
 *    orientation authority is the manifest either way.)
 *
 * 3. **Season completeness against the canonical domain.** 32 teams,
 *    18 weeks, 17 appearances each - defense in depth for the season-wide
 *    sync, kept even though the manifest is the decisive authority for the
 *    captured week.
 *
 * `seasonMatrix` is [{ team_key, weeks }] for the whole season, read
 * in-transaction by `snapshotWeek` so it shares the snapshot the schedule
 * hash certifies.
 */
function validateSchedule({ rows, seasonMatrix, manifestGames, season, week }) {
  if (!manifestGames || manifestGames.length === 0) {
    throw new Error(`no schedule manifest for ${season} week ${week} - captures without an authority are not evidence`);
  }
  if (!rows || rows.length === 0) {
    throw new Error(`no schedule rows for ${season} week ${week}`);
  }
  const byTeam = new Map();
  for (const row of rows) {
    if (!row.kickoff_at) throw new Error(`schedule row without kickoff for ${season} week ${week} (${row.nfl_team})`);
    if (!row.opponent) throw new Error(`schedule row without opponent for ${season} week ${week} (${row.nfl_team})`);
    byTeam.set(normalizeTeamKey(row.nfl_team), row);
  }
  if (byTeam.size !== rows.length) {
    throw new Error(`schedule for ${season} week ${week} lists a team twice`);
  }

  // Layer 1: identity equality, manifest-first.
  const orientationByTeam = new Map();
  const manifestTeams = new Set();
  for (const game of manifestGames) {
    const away = normalizeTeamKey(game.away);
    const home = normalizeTeamKey(game.home);
    manifestTeams.add(away);
    manifestTeams.add(home);
    orientationByTeam.set(home, 'home');
    orientationByTeam.set(away, 'away');
    const homeRow = byTeam.get(home);
    const awayRow = byTeam.get(away);
    if (!homeRow || !awayRow) {
      throw new Error(
        `schedule for ${season} week ${week} is missing manifest game ${away}@${home}` +
        (homeRow || awayRow ? ' (one side present)' : '')
      );
    }
    if (normalizeTeamKey(homeRow.opponent) !== away || normalizeTeamKey(awayRow.opponent) !== home) {
      throw new Error(
        `schedule for ${season} week ${week}: rows for ${away}@${home} do not match the manifest pairing ` +
        `(${homeRow.nfl_team} vs ${homeRow.opponent}, ${awayRow.nfl_team} vs ${awayRow.opponent})`
      );
    }
    if (new Date(homeRow.kickoff_at).getTime() !== new Date(awayRow.kickoff_at).getTime()) {
      throw new Error(`schedule for ${season} week ${week}: ${away}@${home} rows disagree on kickoff`);
    }
    // Layer 2: orientation/keys are validated when the sync provides them.
    if (homeRow.home_away != null && homeRow.home_away !== 'home') {
      throw new Error(`schedule for ${season} week ${week}: ${home} marked ${homeRow.home_away}, manifest says home`);
    }
    if (awayRow.home_away != null && awayRow.home_away !== 'away') {
      throw new Error(`schedule for ${season} week ${week}: ${away} marked ${awayRow.home_away}, manifest says away`);
    }
    if ((homeRow.game_key || awayRow.game_key) && homeRow.game_key !== awayRow.game_key) {
      throw new Error(`schedule for ${season} week ${week}: ${away}@${home} rows disagree on game key`);
    }
  }
  const outsideManifest = [...byTeam.keys()].filter((t) => !manifestTeams.has(t));
  if (outsideManifest.length > 0) {
    throw new Error(
      `schedule for ${season} week ${week} contains game rows the manifest does not: ${outsideManifest.join(', ')}`
    );
  }

  // Layer 3: the expected canonical domain, checked as EXPECTATION.
  const matrix = new Map(
    (seasonMatrix || []).map((r) => [normalizeTeamKey(r.team_key), (r.weeks || []).map(Number)])
  );
  const canonical = new Set(CANONICAL_TEAM_KEYS);
  const missingTeams = CANONICAL_TEAM_KEYS.filter((t) => !matrix.has(t));
  if (missingTeams.length > 0) {
    throw new Error(`season ${season} schedule is missing team(s) entirely: ${missingTeams.join(', ')}`);
  }
  const unknownTeams = [...matrix.keys()].filter((t) => !canonical.has(t));
  if (unknownTeams.length > 0) {
    throw new Error(`season ${season} schedule contains unknown team(s): ${unknownTeams.join(', ')}`);
  }
  const observedWeeks = new Set();
  const byeByTeam = new Map();
  for (const [teamKey, weeks] of matrix) {
    const outOfRange = weeks.filter((w) => w < 1 || w > SEASON_WEEKS);
    if (outOfRange.length > 0) {
      throw new Error(`season ${season}: ${teamKey} has out-of-range week(s) ${outOfRange.join(', ')}`);
    }
    const played = new Set(weeks);
    if (played.size !== GAMES_PER_TEAM) {
      throw new Error(
        `season ${season} schedule is incomplete: ${teamKey} appears in ${played.size} week(s), expected exactly ${GAMES_PER_TEAM}`
      );
    }
    for (const w of played) observedWeeks.add(w);
    for (let w = 1; w <= SEASON_WEEKS; w++) {
      if (!played.has(w)) byeByTeam.set(teamKey, w);
    }
  }
  for (let w = 1; w <= SEASON_WEEKS; w++) {
    if (!observedWeeks.has(w)) {
      throw new Error(`season ${season} schedule is missing week ${w} entirely`);
    }
  }
  const byesByWeek = new Map();
  for (const [teamKey, byeWeek] of byeByTeam) {
    if (!byesByWeek.has(byeWeek)) byesByWeek.set(byeWeek, []);
    byesByWeek.get(byeWeek).push(teamKey);
  }
  for (const [byeWeek, teams] of byesByWeek) {
    if (teams.length > 6 || teams.length % 2 !== 0) {
      throw new Error(`season ${season} week ${byeWeek} fails bye accounting: ${teams.length} bye team(s)`);
    }
  }
  // Target-week cross-check: the rows must cover exactly canonical-minus-byes.
  const byeTeams = new Set(byesByWeek.get(Number(week)) || []);
  for (const teamKey of byTeam.keys()) {
    if (!canonical.has(teamKey)) {
      throw new Error(`schedule for ${season} week ${week}: unknown team ${teamKey}`);
    }
    if (byeTeams.has(teamKey)) {
      throw new Error(`schedule for ${season} week ${week}: ${teamKey} both plays and is on bye`);
    }
  }
  const absent = CANONICAL_TEAM_KEYS.filter((t) => !byTeam.has(t));
  const unexplained = absent.filter((t) => !byeTeams.has(t));
  if (unexplained.length > 0) {
    throw new Error(
      `schedule for ${season} week ${week}: ${unexplained.join(', ')} absent without this week being their bye`
    );
  }
  const digestInput = rows
    .map((r) => `${normalizeTeamKey(r.nfl_team)}|${normalizeTeamKey(r.opponent)}|${orientationByTeam.get(normalizeTeamKey(r.nfl_team)) || ''}|${new Date(r.kickoff_at).toISOString()}|${r.game_key || ''}`)
    .sort()
    .join('\n');
  const kickoffs = rows.map((r) => new Date(r.kickoff_at).getTime());
  return {
    firstKickoffAt: new Date(Math.min(...kickoffs)),
    scheduleGames: manifestGames.length,
    scheduleHash: sha256(digestInput),
    byTeam,
    orientationByTeam,
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
  const manifestGames = manifestGamesForWeek(season, week);
  if (!manifestGames || manifestGames.length === 0) {
    throw new Error(`no schedule manifest for season ${season} week ${week} - refusing to capture without an authority`);
  }
  const deadline = captureNotAfterFor(season, week);
  if (!deadline) {
    throw new Error(`no captureNotAfter deadline for season ${season} week ${week} - refusing to capture without an independent cutoff`);
  }
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
    // The season's full team-week matrix, from the SAME snapshot: which
    // weeks each team appears in. validateSchedule checks it against the
    // canonical expected domain (32 teams, 18 weeks, 17 games each), which
    // never shrinks to fit what happened to be synced.
    const seasonMatrix = await conn.query(
      `SELECT fn_normalize_nfl_team("nfl_team") AS "team_key",
              array_agg(DISTINCT "week") AS "weeks"
       FROM "nfl_games" WHERE "season" = $1 AND "week" BETWEEN 1 AND ${SEASON_WEEKS}
       GROUP BY fn_normalize_nfl_team("nfl_team")`,
      [season]
    );
    const schedule = validateSchedule({
      rows: scheduleResult.rows,
      seasonMatrix: seasonMatrix.rows,
      manifestGames,
      season,
      week,
    });

    // The effective cutoff: the manifest's independent deadline, tightened
    // (never extended) by the validated observed first kickoff. Every guard
    // below - both clock checks, the header CHECK, the child trigger - uses
    // THIS instant, so stale stored kickoffs cannot reopen a closed window.
    const cutoff = effectiveCutoff(deadline, schedule.firstKickoffAt);

    const clockBefore = await conn.query('SELECT clock_timestamp() AS "now"');
    if (new Date(clockBefore.rows[0].now) >= cutoff) {
      throw new Error(
        `capture window for ${season} week ${week} has closed (capture deadline ${cutoff.toISOString()})`
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

    // Every arm this transaction writes, fixed order, scheduled first. The
    // candidate arms belong to holdout-confirm-2026 (see PREREGISTRATION.md
    // there): same cohort, same schedule, same deadline, same transaction -
    // they differ from the scheduled arm ONLY in the two simulation leaves
    // their constants_hash fingerprints.
    const arms = captureArms();

    // Conflict handling under the identity lock: an existing capture is
    // honored ONLY as an exact, complete provenance match across EVERY arm.
    // Anything else is an anomaly the ledger must not paper over - completing
    // any part of it with a NEW projection run would put rows from two
    // different computations under one week's evidence.
    const existing = await conn.query(
      `SELECT "s"."id", "s"."capture_kind", "s"."cohort_size", "s"."cohort_hash",
              "s"."constants_hash", "s"."schedule_hash", "s"."release_sha",
              "s"."protocol_version", COUNT("p"."id")::int AS "rows"
       FROM "projection_snapshots" "s"
       LEFT JOIN "projection_snapshot_players" "p" ON "p"."snapshot_id" = "s"."id"
       WHERE "s"."season" = $1 AND "s"."week" = $2 AND "s"."scoring_hash" = $3
         AND "s"."model_version" = $4 AND "s"."capture_kind" = ANY($5::text[])
       GROUP BY "s"."id"`,
      [season, week, scoringHash, modelVersion, arms.map((a) => a.kind)]
    );
    if (existing.rows.length > 0) {
      const foundByKind = new Map(existing.rows.map((r) => [r.capture_kind, r]));
      // Validate every arm that exists BEFORE judging completeness of the
      // set, so a corrupted arm reports its own defect rather than hiding
      // behind "some arms are missing".
      for (const arm of arms) {
        const found = foundByKind.get(arm.kind);
        if (!found) continue;
        // EXACTLY the cohort, not "at least": extra rows are as much of an
        // anomaly as missing ones.
        const complete = Number(found.rows) === Number(found.cohort_size);
        const matches = found.cohort_hash === cohortHash
          && found.constants_hash === arm.hash
          && found.schedule_hash === schedule.scheduleHash
          && found.release_sha === releaseSha
          && Number(found.protocol_version) === HOLDOUT_PROTOCOL_VERSION;
        if (!complete || !matches) {
          throw new Error(
            `holdout snapshot conflict for ${season} week ${week} ${profileName} (${arm.kind}): ` +
            (complete ? 'provenance mismatch' : `incomplete (${found.rows}/${found.cohort_size} rows)`) +
            ' - refusing to touch an existing snapshot'
          );
        }
        // Trust nothing about the child rows either: their actual player-id
        // digest must reproduce the header's cohort hash before the skip is
        // honored as "this exact snapshot already exists".
        const childIds = await conn.query(
          `SELECT "player_id" FROM "projection_snapshot_players"
           WHERE "snapshot_id" = $1 ORDER BY "player_id"`,
          [found.id]
        );
        const childDigest = sha256(childIds.rows.map((r) => r.player_id).join(','));
        if (childDigest !== found.cohort_hash) {
          throw new Error(
            `holdout snapshot conflict for ${season} week ${week} ${profileName} (${arm.kind}): ` +
            'child rows do not reproduce the header cohort digest - refusing to touch an existing snapshot'
          );
        }
      }
      const missing = arms.filter((a) => !foundByKind.has(a.kind)).map((a) => a.kind);
      if (missing.length > 0) {
        // Some arms exist and check out; others were never written. Appending
        // the missing ones NOW would come from a different computation on a
        // different day - mixed provenance under one week. The week is
        // lost for capture; the evaluation's symmetric-drop rule handles it.
        throw new Error(
          `holdout snapshot conflict for ${season} week ${week} ${profileName}: ` +
          `partial arm set - existing [${[...foundByKind.keys()].sort().join(', ')}], ` +
          `missing [${missing.sort().join(', ')}] - refusing to append arms to an existing capture`
        );
      }
      await conn.query('ROLLBACK');
      return {
        season, week, profileName,
        snapshotId: foundByKind.get('scheduled').id,
        armSnapshotIds: Object.fromEntries(arms.map((a) => [a.kind, foundByKind.get(a.kind).id])),
        skipped: 'already complete',
      };
    }

    const playerIds = cohort.map((r) => r.id);
    // The compute path, through THIS connection: no cache table is read or
    // written, and every input comes from the transaction's snapshot.
    // Weather is EXCLUDED deliberately: it ships at maxEffect 0 (pure
    // context, cannot move a point), its provider makes network calls, and
    // its snapshot store reads through the global pool - all three violate
    // the one-transaction, one-snapshot contract this capture certifies.
    //
    // One run per arm, every run inside THIS transaction, so all three read
    // the identical REPEATABLE READ snapshot; only modelConstants varies.
    const runsByKind = new Map();
    for (const arm of arms) {
      runsByKind.set(arm.kind, await projection.generateProjections({
        season, week, rules, playerIds, hashValue: scoringHash, client: conn,
        weatherService: false, modelConstants: arm.constants,
      }));
    }

    // The prereg's mean bit-equality assertion (holdout-confirm-2026 §9.1),
    // enforced where the rows are BORN rather than discovered at evaluation:
    // the candidate kernels touch dispersion only, so a diverging mean means
    // the arms did not compute from one snapshot, and the capture must die
    // here rather than write a week the study will void anyway.
    const controlRun = runsByKind.get('scheduled');
    for (const arm of arms) {
      if (arm.kind === 'scheduled') continue;
      const candidateRun = runsByKind.get(arm.kind);
      for (const playerId of playerIds) {
        const controlMean = (controlRun.projections.get(playerId) || {}).mean ?? null;
        const candidateMean = (candidateRun.projections.get(playerId) || {}).mean ?? null;
        if (controlMean !== candidateMean) {
          throw new Error(
            `capture for ${season} week ${week} ${profileName}: arm ${arm.kind} mean diverged from ` +
            `the scheduled arm for player ${playerId} (${candidateMean} vs ${controlMean}) - ` +
            'the arms did not share a feature snapshot; rolling back'
          );
        }
      }
    }

    const armSnapshotIds = {};
    for (const arm of arms) {
      const run = runsByKind.get(arm.kind);
      const header = await conn.query(
        `INSERT INTO "projection_snapshots"
           ("season", "week", "scoring_profile", "scoring_hash", "model_version",
            "constants_hash", "release_sha", "cohort_hash", "cohort_size",
            "schedule_games", "schedule_hash", "protocol_version", "capture_kind",
            "capture_not_after", "input_cutoff", "source_coverage")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
         RETURNING "id"`,
        [
          season, week, profileName, scoringHash, modelVersion,
          arm.hash, releaseSha, cohortHash, cohort.length,
          schedule.scheduleGames, schedule.scheduleHash, HOLDOUT_PROTOCOL_VERSION,
          arm.kind, cutoff, run.inputCutoff || null, JSON.stringify(run.sourceCoverage || {}),
        ]
      );
      const snapshotId = header.rows[0].id;
      armSnapshotIds[arm.kind] = snapshotId;

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
            game ? game.opponent : null,
            // Orientation from the MANIFEST (the authority), not the row: the
            // 2026 sync never populated home_away.
            game ? (schedule.orientationByTeam.get(normalizeTeamKey(playerRow.nfl_team)) ?? null) : null,
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
    }

    // The deadline, rechecked at the last possible moment: computation took
    // real time, and a capture that slid past kickoff while computing must
    // not commit.
    const clockAfter = await conn.query('SELECT clock_timestamp() AS "now"');
    if (new Date(clockAfter.rows[0].now) >= cutoff) {
      throw new Error(
        `capture for ${season} week ${week} ${profileName} missed its deadline during computation - rolling back`
      );
    }

    await conn.query('COMMIT');
    return {
      season, week, profileName,
      snapshotId: armSnapshotIds.scheduled,
      armSnapshotIds,
      cohortSize: cohort.length,
      inserted: cohort.length,
    };
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
 * The scheduled entry point: find weeks whose capture deadline is inside
 * the capture window and capture each predeclared profile for them.
 *
 * Due selection is keyed on the MANIFEST deadline, tightened (never
 * extended) by the observed minimum kickoff: shifting every stored kickoff
 * later cannot postpone or reopen a window, and a week the sync lost
 * entirely is still attempted on the manifest's schedule - the attempt then
 * fails schedule validation LOUDLY and durably instead of never happening.
 *
 * One profile's failure never blocks another's attempt; every attempt's
 * outcome is persisted to `holdout_capture_status`. A week whose window was
 * missed entirely fails the deadline checks and stays absent - that is the
 * fail-closed behavior, not a bug.
 */
async function captureDueSnapshots({ now = new Date(), client = pool } = {}) {
  const windowEnd = new Date(now.getTime() + CAPTURE_WINDOW_HOURS * 3600 * 1000);
  const seasons = [...SEASON_MANIFESTS.keys()];
  const observed = seasons.length > 0
    ? await client.query(
        `SELECT "season", "week", MIN("kickoff_at") AS "first_kickoff"
         FROM "nfl_games"
         WHERE "season" = ANY($1::int[]) AND "week" BETWEEN 1 AND ${SEASON_WEEKS}
         GROUP BY "season", "week"`,
        [seasons]
      )
    : { rows: [] };
  const observedMin = new Map(observed.rows.map((r) => [
    `${Number(r.season)}:${Number(r.week)}`,
    r.first_kickoff ? new Date(r.first_kickoff) : null,
  ]));

  const due = [];
  for (const season of seasons) {
    for (let week = 1; week <= SEASON_WEEKS; week++) {
      const cutoff = effectiveCutoff(
        captureNotAfterFor(season, week),
        observedMin.get(`${season}:${week}`) || null
      );
      if (cutoff && cutoff > now && cutoff <= windowEnd) due.push({ season, week });
    }
  }

  const captured = [];
  const failures = [];
  for (const { season, week } of due) {
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

/**
 * Reconcile every obligation the MANIFEST defines - all SEASON_WEEKS x
 * profiles per manifest season - against the runtime schedule, the
 * immutable ledger, and the durable status table.
 *
 * Obligations derive from the manifest, never from `nfl_games`: a week the
 * sync lost entirely still owes its three snapshots, and shows up as a
 * schedule problem instead of silently producing no obligation at all.
 *
 * Schedule health per week is judged by the SAME `validateSchedule` the
 * capture path runs - identity equality against the manifest, reciprocity,
 * kickoff agreement between a game's two rows, canonical-domain
 * completeness. A lighter check here would let a schedule the capture
 * would refuse read as green (e.g. a pair whose two rows disagree on
 * kickoff), which is exactly the false health a reconciler exists to
 * prevent.
 *
 * Deadlines come from the manifest, tightened (never extended) by the
 * VALIDATED observed first kickoff; when validation fails, the manifest
 * deadline stands alone. So `missed` is judged against an instant no
 * amount of stale or shifted stored kickoffs can move.
 *
 * Per obligation: `captured` (an immutable, NON-LATE, child-complete,
 * NONEMPTY snapshot exists for the obligation's stored `scoring_profile` -
 * a late, hollow, or empty one does not count, and matching is by the
 * PROFILE NAME the header recorded, never by recomputing today's scoring
 * hash, so a later change to a preset's rules cannot orphan history), else
 * `missed` (deadline passed - permanently uncapturable, retained for the
 * whole season), else `failed` (durable status says the last attempt
 * failed, window still open), else `schedule-invalid`, else `pending`
 * (window open), else `scheduled` (future). `ok` only when every
 * obligation is captured, pending, or scheduled.
 *
 * The public output carries NO stored failure message: durable status
 * messages can embed raw database errors, and this result feeds a public
 * health route. States, attempts, and our own schedule-validation findings
 * are the vocabulary; the message column is not even selected.
 *
 * VERSIONED ACTIVATION: an obligation is satisfied by the snapshot captured
 * under whatever model version was active before that week's deadline, so
 * the ledger query carries NO model-version filter. A midseason version
 * bump adds new-version snapshots for later weeks; obligations already
 * satisfied stay satisfied.
 *
 * FAIL-CLOSED: both ledger relations are probed on EVERY call, before any
 * verdict - months from kickoff, a missing or unreadable ledger is an
 * error the caller must surface, not a quiet 200.
 */
async function reconcileObligations({ now = new Date(), client = pool } = {}) {
  const windowEnd = new Date(now.getTime() + CAPTURE_WINDOW_HOURS * 3600 * 1000);
  const seasons = [...SEASON_MANIFESTS.keys()];
  const snapshots = await client.query(
    `SELECT "s"."season", "s"."week", "s"."scoring_profile"
     FROM "projection_snapshots" "s"
     WHERE "s"."season" = ANY($1::int[]) AND "s"."capture_kind" = 'scheduled'
       AND "s"."is_late" = false
       AND "s"."cohort_size" > 0
       AND "s"."cohort_size" = (
         SELECT COUNT(*) FROM "projection_snapshot_players" "p"
         WHERE "p"."snapshot_id" = "s"."id"
       )`,
    [seasons]
  );
  const statuses = await client.query(
    `SELECT "season", "week", "scoring_profile", "status", "attempts"
     FROM "holdout_capture_status" WHERE "season" = ANY($1::int[])`,
    [seasons]
  );
  const scheduleRows = await client.query(
    `SELECT "season", "week", "nfl_team", "opponent", "home_away", "kickoff_at", "game_key"
     FROM "nfl_games"
     WHERE "season" = ANY($1::int[]) AND "week" BETWEEN 1 AND ${SEASON_WEEKS}`,
    [seasons]
  );

  const snapshotKeys = new Set(
    snapshots.rows.map((r) => `${r.season}:${r.week}:${r.scoring_profile}`)
  );
  const statusByKey = new Map(
    statuses.rows.map((r) => [`${r.season}:${r.week}:${r.scoring_profile}`, r])
  );
  const rowsBySeason = new Map();
  for (const row of scheduleRows.rows) {
    const season = Number(row.season);
    if (!rowsBySeason.has(season)) rowsBySeason.set(season, []);
    rowsBySeason.get(season).push(row);
  }

  const obligations = [];
  for (const season of seasons) {
    const manifest = SEASON_MANIFESTS.get(season);
    const seasonRows = rowsBySeason.get(season) || [];
    // The same season matrix the capture transaction reads via SQL, built
    // here from the already-fetched rows (same normalization vocabulary).
    const matrixMap = new Map();
    const rowsByWeek = new Map();
    for (const row of seasonRows) {
      const week = Number(row.week);
      const teamKey = normalizeTeamKey(row.nfl_team);
      if (!matrixMap.has(teamKey)) matrixMap.set(teamKey, new Set());
      matrixMap.get(teamKey).add(week);
      if (!rowsByWeek.has(week)) rowsByWeek.set(week, []);
      rowsByWeek.get(week).push(row);
    }
    const seasonMatrix = [...matrixMap].map(([team_key, weeks]) => ({ team_key, weeks: [...weeks] }));

    for (let week = 1; week <= SEASON_WEEKS; week++) {
      const manifestGames = manifest.games.filter((g) => Number(g.week) === week);
      const deadline = captureNotAfterFor(season, week);
      let observedFirstKickoff = null;
      let scheduleIssues;
      try {
        const validated = validateSchedule({
          rows: rowsByWeek.get(week) || [],
          seasonMatrix,
          manifestGames,
          season,
          week,
        });
        observedFirstKickoff = validated.firstKickoffAt;
      } catch (err) {
        scheduleIssues = [err.message];
      }
      const cutoff = effectiveCutoff(deadline, observedFirstKickoff);

      for (const profile of HOLDOUT_SCORING_PROFILES) {
        const statusRow = statusByKey.get(`${season}:${week}:${profile.name}`) || null;
        let state;
        if (snapshotKeys.has(`${season}:${week}:${profile.name}`)) state = 'captured';
        else if (!cutoff || cutoff <= now) state = 'missed';
        else if (statusRow && statusRow.status === 'failed') state = 'failed';
        else if (scheduleIssues) state = 'schedule-invalid';
        else if (cutoff <= windowEnd) state = 'pending';
        else state = 'scheduled';
        obligations.push({
          season,
          week,
          profile: profile.name,
          state,
          captureNotAfter: cutoff,
          scheduleIssues,
          attempts: statusRow ? statusRow.attempts : 0,
        });
      }
    }
  }
  return {
    ok: obligations.every(
      (o) => o.state === 'captured' || o.state === 'pending' || o.state === 'scheduled'
    ),
    obligations,
  };
}

module.exports = {
  HOLDOUT_PROTOCOL_VERSION,
  CAPTURE_WINDOW_HOURS,
  SEASON_MANIFESTS,
  CANONICAL_TEAM_KEYS,
  SEASON_WEEKS,
  GAMES_PER_TEAM,
  HOLDOUT_POSITIONS,
  HOLDOUT_SCORING_PROFILES,
  CANDIDATE_ARMS,
  constantsHash,
  resolveCandidateConstants,
  captureArms,
  registerSeasonManifest,
  manifestGamesForWeek,
  captureNotAfterFor,
  effectiveCutoff,
  validateSchedule,
  snapshotWeek,
  recordCaptureStatus,
  captureDueSnapshots,
  reconcileObligations,
};
