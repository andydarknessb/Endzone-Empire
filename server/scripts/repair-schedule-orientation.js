/**
 * Repair the MISSING schedule orientation on one season's `nfl_games` rows
 * (`game_key`, `home_away`, `neutral_site`) from nflverse's PUBLIC games.csv at
 * a pinned revision, cross-checked against the frozen season manifest before a
 * single byte is written.
 *
 * Usage:
 *   node server/scripts/repair-schedule-orientation.js --csv <path-to-games.csv>
 *     [--season 2026] [--commit <sha>] [--blob <sha>] [--apply]
 *   node server/scripts/repair-schedule-orientation.js --verify [--season 2026]
 *     [--purge-stale-cache]
 *
 * DRY RUN BY DEFAULT. Without `--apply` the script reads everything, plans
 * everything, runs the full post-fill verification against the rows the plan
 * WOULD produce, prints the report, and writes nothing.
 *
 * `--verify` is the separate, read-only mode that answers "did it take, and is
 * anything still serving the old schedule?" after the fact. It needs no CSV: it
 * reads the season's rows, applies the same invariants, and reports any cached
 * `free_baseline_v3.1` runs still sitting in `projection_runs`, exiting nonzero
 * if either check has something to say. Its transaction is opened READ ONLY, so
 * the mode's read-only claim is enforced by Postgres rather than by review.
 * `--purge-stale-cache` is the one exception and must be asked for by name: it
 * deletes cache rows for that season and model version and nothing else.
 *
 * Why this exists as a separate script rather than another sync pass:
 *
 * - The sync's upsert (nflverseSync.syncScheduleFromNflverse) fills these
 *   columns with `COALESCE(EXCLUDED.x, existing.x)`, which prefers the FILE
 *   over the database on every column it touches. That is right for a sync and
 *   catastrophic for a repair: a stored value that disagrees with the file
 *   would be overwritten silently, and the one thing a repair must never do is
 *   destroy the evidence that the repair was wrong. Here a disagreement rolls
 *   the whole transaction back and exits nonzero.
 * - The repair is NULL-ONLY. Every write is guarded by `IS NULL` in the SQL
 *   itself, not merely by the plan that was computed a moment earlier, so the
 *   property survives even a snapshot this script reasoned about incorrectly.
 *   A stored value that already MATCHES the source is left alone, which is what
 *   makes a re-run a no-op rather than a second repair.
 * - `opponent` and `kickoff_at` are never named in any statement. A
 *   Tank01-synced kickoff stays authoritative, and who played whom is not what
 *   is broken.
 *
 * Provenance, in the order it is established, because each step is only worth
 * anything if the one before it held:
 *
 * 1. The CSV's bytes are hashed as a git blob and compared to the pinned blob
 *    SHA, so the file provably IS the named revision.
 * 2. The manifest (server/data/nfl-schedule-<season>.json) verifies its own
 *    digest and full-season invariants.
 * 3. The CSV's game identities (week, away, home) are compared to the
 *    manifest's, oriented, so a home/away SWAP is a mismatch and not a match.
 *    Any difference at all is fatal. The manifest carries NO neutral-site
 *    information - it was never in the digest - so the neutral flags come from
 *    the CSV alone and the expected neutral count is DERIVED from the pinned
 *    file rather than asserted from memory.
 *
 * Cache invalidation is the last thing inside the transaction: filling
 * orientation changes an input the weekly projection engine reads, so every
 * cached run for the season under the current model is dropped. It is dropped
 * rather than regenerated for exactly the reasons invalidateWeeklyProjectionRuns
 * documents.
 *
 * WHAT CHANGES, AND WHEN, because the two halves of this work have opposite
 * properties and conflating them is how a release gets misjudged:
 *
 * - DEPLOYING the code is the byte-identical step. On today's all-null rows the
 *   engine produces the same numbers AND the same factor payloads it always
 *   did; the home/away factor keeps reporting 'home/away unknown' because the
 *   scoring gate is checked below the unknown-orientation check.
 * - RUNNING this repair is not. Every number stays exactly what it was - the
 *   factor is gated off, so orientation cannot move a projection by a hundredth
 *   of a point - but the payload WORDING moves: 'home/away unknown' becomes
 *   'home/away gated off' now that orientation is known, and filling `game_key`
 *   gives the weather lookup a key to miss on, which moves the run's weather
 *   source-coverage string. Cached rows would otherwise keep serving the old
 *   wording indefinitely. That is precisely why the cache invalidation below
 *   exists, and why the quiesce procedure below is not optional.
 *
 * IN-FLIGHT RACE, stated plainly because it cannot be closed from inside this
 * script. A projection request that READ the pre-repair schedule can finish
 * computing and upsert its `projection_runs` row AFTER this transaction
 * commits. No lock taken here helps: the window spans read, compute and write
 * across the commit boundary, and holding `nfl_games` locked for the length of
 * a stranger's HTTP request is a worse problem than the one it solves. The
 * decision is operational rather than architectural:
 *
 *   1. Quiesce. Drain projection traffic and pause the schedule sync / any
 *      scheduled job that generates runs.
 *   2. Repair. Dry run, read the report, then `--apply`.
 *   3. Verify. `--verify` reports any cached run that survived; a straggler
 *      means something was still computing, and `--verify --purge-stale-cache`
 *      removes exactly those rows.
 *   4. Reopen.
 *
 * Skipping step 1 does not corrupt anything - a stale run is wrong about
 * payload wording, never about a number - but it leaves rows that claim a
 * schedule the database no longer holds, which is the kind of discrepancy
 * nobody enjoys debugging six weeks later.
 *
 * The append-only holdout ledger, in both halves, because only one of them is
 * about writes:
 *
 * - This script never WRITES to `projection_snapshots`,
 *   `projection_snapshot_players` or `holdout_capture_status`.
 *   `assertNotHoldoutSql` refuses to send a statement that so much as names
 *   one, so the tables' own rejection triggers stay a second line of defence
 *   rather than the first.
 * - It does, however, change the EVIDENCE those rows certify. A snapshot's
 *   `schedule_hash` is built from `game_key` among other columns
 *   (holdout.service.validateSchedule), so filling `game_key` moves the hash
 *   for every week of the repaired season. A snapshot taken BEFORE the repair
 *   would then fail the provenance check on its next capture pass - a hard
 *   throw, a failed status row, and a 503 on /api/health/holdout - instead of
 *   the already-complete skip. There is no way to repair that from here and no
 *   honest way to rewrite an append-only ledger, so the repair refuses to run
 *   at all once the season's first capture window has opened
 *   (`assertBeforeCaptureWindow`). The sequencing constraint is enforced, not
 *   documented and hoped for.
 *
 * Note on what this does NOT do: filling orientation does not activate the
 * home/away factor. That is gated by MODEL_CONSTANTS.homeAway.enabled, which
 * ships false precisely so a data repair cannot double as the activation of an
 * adjustment nobody has backtested.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The environment, BEFORE any require below can reach `modules/pool`. This
// ordering is load-bearing and not stylistic: pool builds its pg.Pool at
// MODULE-EVALUATION time out of process.env, and `nflverseSync.service` pulls
// it in transitively. dotenv arriving afterwards leaves that pool silently
// pointed at the local development defaults (host localhost, database
// endzone_empire) while every line after it reports a successful repair
// against a database nobody meant to touch - the one failure mode a one-shot
// authorized repair cannot survive, because it also reports itself as done.
// `require.main` guards it so importing this module for tests has no
// environment side effect, and `assertPoolMatchesEnvironment` re-checks the
// OUTCOME at run time rather than trusting this comment to stay true.
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
}

const { parseCsv, buildScheduleRows } = require('../services/nflverseSync.service');
const { normalizeTeamKey } = require('../services/projectionFeatures');
const { verifySeasonManifest, TOTAL_GAMES } = require('../services/scheduleManifest');
const { CAPTURE_WINDOW_HOURS } = require('../services/holdout.service');
const model = require('../services/projectionModel');

/**
 * The ONLY columns this script may write. Every dynamic fragment of SQL below
 * is assembled from this frozen list, so a column name can never reach a
 * statement from data.
 */
const REPAIR_COLUMNS = Object.freeze(['game_key', 'home_away', 'neutral_site']);

/** Two rows per game, one per team's perspective. */
const ROWS_PER_GAME = 2;

/**
 * The append-only holdout ledger. Its immutability is enforced by database
 * triggers, which makes an attempted write a caught error rather than a silent
 * corruption - but a caught error inside this transaction would still abort a
 * repair halfway through for a reason nobody intended. Refusing to SEND such a
 * statement keeps the failure at the point the mistake was made.
 */
const FORBIDDEN_TABLES = Object.freeze([
  'projection_snapshots',
  'projection_snapshot_players',
  'holdout_capture_status',
]);

/**
 * Pure: throw if a statement so much as names a holdout-ledger table.
 *
 * Deliberately a NAME match and not a verb match: there is no read this script
 * needs from those tables either, so "mentions it at all" is a check that
 * cannot be defeated by a statement shape nobody anticipated.
 */
function assertNotHoldoutSql(sql) {
  const text = String(sql || '');
  for (const table of FORBIDDEN_TABLES) {
    if (text.includes(table)) {
      throw new Error(
        `refusing to run a statement naming the append-only holdout table "${table}": ${text.slice(0, 120)}`
      );
    }
  }
  return true;
}

/**
 * Pure: refuse a connection pool that was built before the environment was.
 *
 * The require-order comment at the top of this file is a claim about a thing
 * that is easy to break and impossible to notice: `modules/pool` falls back to
 * localhost/endzone_empire when DATABASE_URL was not yet in process.env, and a
 * repair run against a local development copy prints exactly the same
 * "verification: OK / COMMITTED" an operator is waiting to see. This turns that
 * claim into a check on the object that actually got built, so a future edit
 * that moves a require cannot quietly reintroduce it.
 *
 * AN EXPLICIT DATABASE_URL IS REQUIRED HERE, and this is deliberately stricter
 * than `modules/pool` itself. That module accepts the standard PG* variables as
 * a perfectly good way to reach a database, which is right for a long-lived
 * service with a deployment that configures it. It is inverted for a one-shot
 * production repair: pool's PG* branch DEFAULTS the host to localhost and the
 * database to `endzone_empire`, so a .env that failed to load, or loaded
 * without DATABASE_URL, silently produces a pool aimed at a developer's local
 * copy - and an earlier version of this guard waved exactly that through on the
 * grounds that nothing was configured to disagree with. "Nothing configured"
 * is not agreement; it is the absence of a target, and a script that will
 * report "COMMITTED" needs to have been told which database that was about.
 * PG*-only is therefore refused here with an instruction rather than accepted.
 */
function assertPoolMatchesEnvironment(pool, env = process.env) {
  const configured = (env && (env.DATABASE_URL_RUNTIME || env.DATABASE_URL)) || null;
  const options = (pool && pool.options) || {};
  if (!configured) {
    throw new Error(
      'no DATABASE_URL (or DATABASE_URL_RUNTIME) is configured, so this pool fell back to its local ' +
      `development defaults (host ${options.host || 'unknown'} / database ${options.database || 'unknown'}). ` +
      'A one-shot production repair will not run against a database nobody named: set DATABASE_URL in .env ' +
      'or the environment. PG* variables alone are not accepted here'
    );
  }
  if (options.connectionString !== configured) {
    throw new Error(
      'the connection pool was built before the environment was loaded: DATABASE_URL names a database ' +
      `this pool is not connected to (it targets host ${options.host || 'unknown'} / database ` +
      `${options.database || 'unknown'}) - refusing to report a repair against the wrong database`
    );
  }
  return true;
}

/**
 * Pure: refuse to run once the season's first holdout capture window has
 * opened.
 *
 * The coupling this enforces is indirect and therefore easy to miss. Filling
 * `game_key` changes the `schedule_hash` a holdout snapshot stores as its
 * schedule provenance, so a snapshot written before the repair would fail its
 * next capture pass with a provenance mismatch. The ledger is append-only by
 * design: there is nothing to fix afterwards, which makes this a pre-flight
 * question or nothing at all.
 *
 * Derived entirely from the manifest this script already loads, so it needs no
 * read of any holdout table and `assertNotHoldoutSql` stays intact. The bound
 * is the EARLIEST `captureNotAfter` in the season (week 1's, by construction,
 * but taken as a minimum rather than assumed) less CAPTURE_WINDOW_HOURS, which
 * is how far ahead of a deadline holdout.captureDueSnapshots starts looking for
 * work. That constant is imported rather than copied: if the window widens, the
 * refusal has to widen with it.
 *
 * WHAT THIS BOUND IS NOT, stated plainly because a guard nobody can size is a
 * guard nobody can trust: it is the MANIFEST-derived opening, and capture can
 * genuinely open a little earlier than it. holdout.effectiveCutoff takes the
 * OBSERVED first kickoff when that is earlier than the manifest deadline, and
 * runtime schedule data may only ever TIGHTEN a deadline, never extend it - so
 * the true window can open before this one does, by hours. Closing that gap
 * exactly would require reading the runtime schedule, which is the database
 * work this guard exists to avoid doing. The mitigation is headroom, not
 * precision: run the repair with months in hand, not on the eve of week 1, and
 * the difference between the two bounds cannot matter.
 *
 * There is deliberately no override flag. A repair that would invalidate stored
 * evidence is not a thing to make easier to do anyway.
 */
function assertBeforeCaptureWindow(manifest, now = new Date()) {
  const deadlines = Object.values((manifest && manifest.captureNotAfter) || {})
    .map((iso) => new Date(iso).getTime())
    .filter((t) => Number.isFinite(t));
  if (deadlines.length === 0) {
    throw new Error(
      `the ${manifest && manifest.season} manifest carries no captureNotAfter deadlines, so there is no way ` +
      'to tell whether holdout snapshots may already exist - refusing to repair blind'
    );
  }
  const firstDeadline = new Date(Math.min(...deadlines));
  const opensAt = new Date(firstDeadline.getTime() - CAPTURE_WINDOW_HOURS * 3600 * 1000);
  if (now.getTime() >= opensAt.getTime()) {
    throw new Error(
      `the ${manifest.season} holdout capture window opened at ${opensAt.toISOString()} ` +
      `(week 1 captureNotAfter ${firstDeadline.toISOString()} less ${CAPTURE_WINDOW_HOURS}h), so a snapshot ` +
      'may already record this season\'s schedule provenance. Filling game_key would change the schedule_hash ' +
      'those rows were written against, and the ledger is append-only - refusing to invalidate stored evidence'
    );
  }
  return { opensAt, firstCaptureNotAfter: firstDeadline };
}

/**
 * Pure: which pinned revision the CSV will be checked against.
 *
 * The digest is verified FIRST, before a single field of the manifest is used.
 * A tampered manifest that supplied a bogus blob SHA would otherwise surface
 * one step later as "games.csv does not match the pinned blob", which points
 * the operator at the one file that is not the problem.
 */
function resolvePinnedSource(manifest, { commit = null, blob = null } = {}) {
  verifySeasonManifest(manifest);
  const source = manifest.source || {};
  const resolved = { commit: commit || source.commit || null, blob: blob || source.blobSha || null };
  if (!resolved.commit || !resolved.blob) {
    throw new Error('no pinned revision: the manifest records none and none was passed with --commit/--blob');
  }
  return resolved;
}

/** Pure: git's blob SHA for a byte buffer - sha1("blob <len>\0" + bytes). */
function gitBlobSha(bytes) {
  return crypto.createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/** Pure: prove the bytes in hand are the pinned revision, or refuse them. */
function assertPinnedCsv(bytes, blobSha) {
  const actual = gitBlobSha(bytes);
  if (actual !== blobSha) {
    throw new Error(
      `games.csv does not match the pinned blob SHA (file hashes to ${actual}, pinned ${blobSha}) - ` +
      'refusing to repair production rows from bytes that are not the named revision'
    );
  }
  return actual;
}

/**
 * Pure: pinned games.csv text -> the orientation every `nfl_games` row of one
 * season should carry, keyed by `${week}:${canonical team}`.
 *
 * Built by nflverseSync.buildScheduleRows, not by a second parser written here.
 * That function is what the sync itself writes through, so the repair fills in
 * BYTE-FOR-BYTE what a sync would have written - the same Tank01 team
 * vocabulary, the same `game_key` construction, the same neutral-site reading
 * of the `location` column. A private reimplementation would be a second
 * opinion about the same file, and two opinions is how a `game_key` ends up
 * spelled WAS on one row and WSH on the other.
 *
 * The map key is normalized separately (`normalizeTeamKey`) because it has to
 * match rows the DATABASE holds, which may be spelled either way.
 */
function desiredOrientation(csvText, { season }) {
  const scheduleRows = buildScheduleRows(parseCsv(csvText), { season });
  const desired = new Map();
  for (const row of scheduleRows) {
    const teamKey = normalizeTeamKey(row.nflTeam);
    const key = `${row.week}:${teamKey}`;
    if (desired.has(key)) {
      throw new Error(`games.csv lists ${teamKey} twice in ${season} week ${row.week}`);
    }
    desired.set(key, {
      season: Number(season),
      week: row.week,
      teamKey,
      opponentKey: normalizeTeamKey(row.opponent),
      game_key: row.gameKey,
      home_away: row.homeAway,
      neutral_site: row.neutralSite,
    });
  }
  return desired;
}

/** Pure: how many distinct games the pinned CSV flags as neutral-site. */
function neutralGamesIn(desired) {
  const games = new Set();
  for (const row of desired.values()) {
    if (row.neutral_site === true) games.add(row.game_key);
  }
  return games.size;
}

/**
 * Pure: ORIENTED game identities from each source, compared as sets.
 *
 * `${week}:${away}@${home}` rather than an unordered pair: this script exists
 * to write orientation, so a source that has the two teams the right way round
 * and a source that does not must not compare equal.
 */
function manifestIdentityDiff(desired, manifest) {
  const csvIds = new Set();
  for (const row of desired.values()) {
    if (row.home_away !== 'home') continue;
    csvIds.add(`${row.week}:${row.opponentKey}@${row.teamKey}`);
  }
  const manifestIds = new Set(
    (manifest && manifest.games ? manifest.games : []).map(
      (g) => `${Number(g.week)}:${normalizeTeamKey(g.away)}@${normalizeTeamKey(g.home)}`
    )
  );
  return {
    csvGames: csvIds.size,
    manifestGames: manifestIds.size,
    csvOnly: [...csvIds].filter((id) => !manifestIds.has(id)).sort(),
    manifestOnly: [...manifestIds].filter((id) => !csvIds.has(id)).sort(),
  };
}

/**
 * Pure: the CSV may only be used as a repair source if the tamper-evident
 * manifest agrees with it about every game identity in the season. Throws
 * otherwise - there is no partial-agreement mode, because a source that is
 * wrong about one game has no standing to be trusted about the other 271.
 */
function assertManifestAgreement(desired, manifest) {
  verifySeasonManifest(manifest);
  const diff = manifestIdentityDiff(desired, manifest);
  const problems = [];
  if (diff.csvGames !== TOTAL_GAMES) {
    problems.push(`games.csv yields ${diff.csvGames} games, expected exactly ${TOTAL_GAMES}`);
  }
  for (const id of diff.csvOnly.slice(0, 10)) problems.push(`in games.csv but not the manifest: ${id}`);
  for (const id of diff.manifestOnly.slice(0, 10)) problems.push(`in the manifest but not games.csv: ${id}`);
  if (problems.length > 0) {
    throw new Error(
      `games.csv and the frozen manifest disagree about ${manifest.season}: ${problems.join('; ')}`
    );
  }
  return diff;
}

/**
 * Pure: does a value already in the database say the same thing as the source?
 *
 * `neutral_site` comes back from pg as a real boolean and the other two as
 * text, so the comparison is per column rather than one loose `==` that would
 * make `false` and `'false'` and `0` all agree with each other.
 */
function sameStoredValue(column, current, target) {
  if (column === 'neutral_site') return (current === true) === (target === true);
  return String(current) === String(target);
}

/**
 * Pure: what a repair would do to the rows currently in `nfl_games`.
 *
 * Three outcomes per column, and the third is the reason this function exists:
 *
 * - stored NULL          -> fill it (this is the repair)
 * - stored, and matching -> leave it (this is what makes a re-run idempotent)
 * - stored, disagreeing  -> a CONFLICT, which the caller must treat as fatal
 *
 * A conflict is never resolved here, in either direction. Preferring the file
 * would overwrite whatever a live sync learned; preferring the database would
 * silently accept that the pinned source is wrong about production. Both are
 * decisions a script has no business making at 3am, so the answer is to stop.
 *
 * Rows the CSV does not describe, CSV rows the database does not have, and a
 * stored `opponent` that contradicts the source are all conflicts too: each one
 * means the two sides are not describing the same season, and a `game_key`
 * written across that gap would name a game that did not happen.
 */
function planOrientationRepair({ desired, rows }) {
  const updates = [];
  const conflicts = [];
  const unchanged = [];
  const seen = new Set();

  for (const row of rows || []) {
    const week = Number(row.week);
    const teamKey = normalizeTeamKey(row.nfl_team);
    const key = `${week}:${teamKey}`;
    const where = `${row.season} week ${week} ${row.nfl_team}`;
    if (seen.has(key)) {
      conflicts.push({ kind: 'duplicate-row', where, detail: `${key} appears more than once in nfl_games` });
      continue;
    }
    seen.add(key);

    const want = desired.get(key);
    if (!want) {
      conflicts.push({ kind: 'unknown-game', where, detail: 'no game for this team and week in the pinned source' });
      continue;
    }
    const storedOpponent = normalizeTeamKey(row.opponent);
    if (storedOpponent && storedOpponent !== want.opponentKey) {
      conflicts.push({
        kind: 'opponent-disagreement',
        where,
        detail: `nfl_games says ${storedOpponent}, the pinned source says ${want.opponentKey}`,
      });
      continue;
    }

    const set = {};
    const kept = [];
    for (const column of REPAIR_COLUMNS) {
      const current = row[column];
      const target = want[column];
      if (target === null || target === undefined) {
        conflicts.push({
          kind: 'source-silent',
          where,
          detail: `the pinned source carries no ${column}, so there is nothing to repair it with`,
        });
        continue;
      }
      if (current === null || current === undefined) {
        set[column] = target;
      } else if (sameStoredValue(column, current, target)) {
        kept.push(column);
      } else {
        conflicts.push({
          kind: 'disagreement',
          where,
          detail: `${column} is already ${JSON.stringify(current)}, the pinned source says ${JSON.stringify(target)}`,
        });
      }
    }

    if (Object.keys(set).length > 0) {
      updates.push({ season: Number(row.season), week, nflTeam: row.nfl_team, teamKey, set });
    } else {
      unchanged.push({ where, kept });
    }
  }

  for (const [key, want] of desired) {
    if (seen.has(key)) continue;
    conflicts.push({
      kind: 'missing-row',
      where: `${want.season} week ${want.week} ${want.teamKey}`,
      detail: 'the pinned source has this game but nfl_games has no row for it',
    });
  }

  return { updates, conflicts, unchanged };
}

/**
 * Pure: the rows a plan would leave behind, without writing any of them. This
 * is what lets a dry run put the SAME verification over its result that the
 * apply path puts over the re-read rows, instead of a weaker approximation of
 * it.
 */
function applyPlanToRows(rows, updates) {
  const setByKey = new Map(
    (updates || []).map((u) => [`${Number(u.week)}:${u.teamKey}`, u.set])
  );
  return (rows || []).map((row) => {
    const set = setByKey.get(`${Number(row.week)}:${normalizeTeamKey(row.nfl_team)}`);
    return set ? { ...row, ...set } : { ...row };
  });
}

/**
 * Pure: the post-fill invariants, checked against rows rather than against the
 * plan that produced them. A plan that is internally consistent and still
 * leaves the season malformed is exactly the failure this catches, which is why
 * it runs on the SELECT taken after the writes and inside the same transaction.
 *
 * `expectedNeutralGames` is derived from the pinned CSV by the caller and
 * passed in. It is not a constant here on purpose: a hardcoded count would be
 * this script asserting a fact about the 2026 season from memory, and the whole
 * design is that the pinned file is the only thing allowed to say.
 */
function verifyOrientedRows(rows, { expectedGames = TOTAL_GAMES, expectedNeutralGames } = {}) {
  const errors = [];
  const expectedRows = expectedGames * ROWS_PER_GAME;
  if (!Array.isArray(rows) || rows.length !== expectedRows) {
    errors.push(`expected exactly ${expectedRows} rows, found ${Array.isArray(rows) ? rows.length : 0}`);
  }

  const sidesByGameKey = new Map();
  let neutralRows = 0;
  for (const row of rows || []) {
    const where = `${row.season} week ${row.week} ${row.nfl_team}`;
    for (const column of REPAIR_COLUMNS) {
      if (row[column] === null || row[column] === undefined) errors.push(`${where}: ${column} is still null`);
    }
    if (row.neutral_site === true) neutralRows += 1;
    if (!row.game_key) continue;
    if (!sidesByGameKey.has(row.game_key)) sidesByGameKey.set(row.game_key, []);
    sidesByGameKey.get(row.game_key).push(row);
  }

  if (sidesByGameKey.size !== expectedGames) {
    errors.push(`expected exactly ${expectedGames} distinct game_keys, found ${sidesByGameKey.size}`);
  }
  for (const [gameKey, sides] of sidesByGameKey) {
    if (sides.length !== ROWS_PER_GAME) {
      errors.push(`${gameKey}: ${sides.length} rows, expected exactly ${ROWS_PER_GAME}`);
      continue;
    }
    const home = sides.filter((r) => r.home_away === 'home').length;
    const away = sides.filter((r) => r.home_away === 'away').length;
    if (home !== 1 || away !== 1) {
      errors.push(`${gameKey}: ${home} home / ${away} away, expected exactly one of each`);
    }
    // Neutral is a property of the GAME, so the two rows of one game cannot
    // disagree about it. They are written from a single CSV row, so a
    // disagreement here means something else wrote one of them.
    if ((sides[0].neutral_site === true) !== (sides[1].neutral_site === true)) {
      errors.push(`${gameKey}: its two rows disagree about neutral_site`);
    }
  }

  if (!Number.isInteger(expectedNeutralGames)) {
    errors.push('no neutral-site count was derived from the pinned source to verify against');
  } else if (neutralRows !== expectedNeutralGames * ROWS_PER_GAME) {
    errors.push(
      `expected ${expectedNeutralGames * ROWS_PER_GAME} neutral-site rows ` +
      `(${expectedNeutralGames} games x ${ROWS_PER_GAME}), found ${neutralRows}`
    );
  }

  return errors;
}

/**
 * Pure: the null-only UPDATE for one planned row. Column names come from the
 * frozen REPAIR_COLUMNS list and every value is a bind parameter; the `IS NULL`
 * guards make "null-only" a property of the STATEMENT rather than of the plan
 * that was computed before it, so a row filled in between the plan and the
 * write is left alone and reports rowCount 0 instead of being overwritten.
 */
function buildUpdateStatement(update) {
  const columns = REPAIR_COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(update.set, c));
  if (columns.length === 0) throw new Error('refusing to build an UPDATE that sets nothing');
  const assignments = columns.map((c, i) => `"${c}" = $${i + 1}`);
  const guards = columns.map((c) => `"${c}" IS NULL`);
  const values = columns.map((c) => update.set[c]);
  const sql =
    `UPDATE "nfl_games" SET ${assignments.join(', ')}\n` +
    `     WHERE "season" = $${columns.length + 1} AND "week" = $${columns.length + 2} ` +
    `AND "nfl_team" = $${columns.length + 3}\n` +
    `       AND ${guards.join(' AND ')}`;
  return { sql, values: [...values, update.season, update.week, update.nflTeam] };
}

/** The season's orientation columns, the one shape every mode reads them in. */
const SEASON_ROWS_SQL =
  `SELECT "season", "week", "nfl_team", "opponent", "game_key", "home_away", "neutral_site"
   FROM "nfl_games" WHERE "season" = $1 ORDER BY "week", "nfl_team"`;

const STALE_RUNS_SQL =
  `SELECT COUNT(*)::int AS "runs" FROM "projection_runs"
   WHERE "season" = $1 AND "model_version" = $2`;

/**
 * The read-only after-the-fact check: did the repair take, and is anything
 * still serving projections computed from the schedule it replaced?
 *
 * The second question is the one that needs a separate mode. A projection
 * request that read the pre-repair schedule can commit its `projection_runs`
 * row after the repair transaction has already committed, and no lock this
 * script could take would close a window that spans read, compute and write
 * across that boundary. The answer is procedural - quiesce, repair, verify -
 * and this is the "verify". A straggler is not corruption (the home/away factor
 * is gated off, so no number can differ) but it is a row asserting a schedule
 * the database no longer holds.
 *
 * `query` is injected rather than a client captured from module scope, which is
 * what lets the read-only property be tested by recording statements instead of
 * by trusting this comment. Purging is the sole write, must be asked for by
 * name, and is scoped to (season, model_version): no week predicate, no player
 * predicate, nothing that could widen if a caller passed something odd.
 */
async function runVerify({
  query,
  season,
  expectedNeutralGames,
  modelVersion = model.MODEL_VERSION,
  purge = false,
}) {
  const rows = (await query(SEASON_ROWS_SQL, [season])).rows;
  const errors = verifyOrientedRows(rows, { expectedNeutralGames });
  const staleRuns = Number((await query(STALE_RUNS_SQL, [season, modelVersion])).rows[0].runs) || 0;
  let purged = null;
  if (purge && staleRuns > 0) {
    const deleted = await query(
      `DELETE FROM "projection_runs" WHERE "season" = $1 AND "model_version" = $2`,
      [season, modelVersion]
    );
    purged = Number(deleted.rowCount) || 0;
  }
  const remainingStale = purged === null ? staleRuns : 0;
  return {
    rows: rows.length,
    distinctGameKeys: new Set(rows.map((r) => r.game_key).filter(Boolean)).size,
    neutralRows: rows.filter((r) => r.neutral_site === true).length,
    errors,
    staleRuns,
    purged,
    remainingStale,
    // Nonzero exit is this boolean. Orientation errors and surviving cache rows
    // are separate failures with one shared meaning: the season is not yet in
    // the state the repair was supposed to leave it in.
    ok: errors.length === 0 && remainingStale === 0,
  };
}

/** Pure: a short, stable summary line per conflict kind, for the report. */
function summarizeConflicts(conflicts) {
  const byKind = new Map();
  for (const conflict of conflicts || []) {
    byKind.set(conflict.kind, (byKind.get(conflict.kind) || 0) + 1);
  }
  return [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * The seasons this script will accept at all. Not a guess at how long the app
 * will live: a bound exists so that `--season` is a CHOICE FROM A SMALL SET
 * rather than a free string, and 2020-2099 covers every season this codebase
 * could hold data for while excluding everything that is obviously a typo.
 */
const MIN_SEASON = 2020;
const MAX_SEASON = 2099;
const DEFAULT_SEASON = 2026;

/**
 * Pure: `--season` -> a bounded integer, or a refusal that says which part was
 * wrong.
 *
 * `Number(value)` on its own was not validation. It answered NaN for 'twenty',
 * 20266 for a fat-fingered extra digit, and - the reason this is a security fix
 * and not only an ergonomic one - it let an operand like '../../etc/passwd'
 * travel as far as the manifest filename before anything objected. The
 * downstream `path.join` is anchored to `__dirname` and a season that reached it
 * as NaN would merely have failed to open, but "merely" is doing load-bearing
 * work in that sentence, and a repair script should not be relying on the next
 * function's error handling to contain its own unvalidated input.
 *
 * Both halves matter. The shape test rejects anything that is not exactly four
 * digits - no signs, no decimals, no whitespace-padded numerics, no path
 * separators, nothing `Number()` would coerce - and the range test then rejects
 * four-digit values that are not plausible seasons. What survives is an integer
 * in [2020, 2099], so the string interpolated into the manifest filename is
 * provably `nfl-schedule-NNNN.json` and cannot contain a separator or a
 * traversal segment.
 *
 * A typo refuses BY NAME rather than turning into a confusing "manifest not
 * found" three steps later, which is the operator-facing half of the same fix.
 */
function parseSeason(value, fallback = DEFAULT_SEASON) {
  // Only an ABSENT flag takes the default. An explicitly supplied `--season ""`
  // is a command that meant to say something and did not, so it refuses rather
  // than quietly repairing whatever year the default happens to be.
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (!/^\d{4}$/.test(text)) {
    throw new Error(
      `--season must be a four-digit year, got ${JSON.stringify(String(value))} - ` +
      'refusing to build a manifest path out of an operand that is not one'
    );
  }
  const season = Number(text);
  if (!Number.isInteger(season) || season < MIN_SEASON || season > MAX_SEASON) {
    throw new Error(
      `--season ${text} is outside the supported range ${MIN_SEASON}-${MAX_SEASON}`
    );
  }
  return season;
}

function parseArgs(argv) {
  // A flag whose value is missing takes the NEXT FLAG as its value if nobody
  // stops it, and `--csv --apply` then reads as "repair from a file called
  // --apply", dry run, exit 0. That is a typo silently turning a write into a
  // no-op, which for a one-shot repair is the same failure as a write into the
  // wrong database: the operator is told it went fine.
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return null;
    const value = argv[i + 1];
    if (value === undefined || String(value).startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    return value;
  };
  const args = {
    csv: flag('csv'),
    // Validated to a bounded integer here, before it is used for anything -
    // and in particular before it reaches the manifest filename.
    season: parseSeason(flag('season')),
    commit: flag('commit'),
    blob: flag('blob'),
    apply: argv.includes('--apply'),
    verify: argv.includes('--verify'),
    purgeStaleCache: argv.includes('--purge-stale-cache'),
  };
  assertModeCombination(args);
  return args;
}

/**
 * Pure: the mode combinations that mean something, and refusing the ones that
 * do not.
 *
 * `--verify` and `--apply` are different jobs on opposite sides of the repair,
 * not flags that compose, and a command asking for both has been misunderstood
 * by whoever typed it. `--purge-stale-cache` deletes cache rows and must
 * therefore never be something a repair run does incidentally: it is the
 * deliberate answer to a straggler `--verify` just reported, so it requires
 * `--verify` and says so.
 */
function assertModeCombination(args) {
  if (args.verify && args.apply) {
    throw new Error('--verify and --apply are separate runs: verify reads, apply writes. Pick one');
  }
  if (args.purgeStaleCache && !args.verify) {
    throw new Error('--purge-stale-cache is only meaningful with --verify, which is what reports the stale rows');
  }
  return true;
}

/**
 * The `--verify` mode's connection handling. Separate from the repair path
 * because it shares none of it: no CSV, no plan, no writes beyond an explicitly
 * requested purge.
 *
 * The transaction is opened READ ONLY unless a purge was asked for by name, so
 * "this mode does not write" is enforced by Postgres - a stray statement gets
 * an error from the server, not a code review. `expectedNeutralGames` comes
 * from the manifest's own game count only as a fallback; there is no CSV here,
 * so the neutral count is read from what the season actually holds and checked
 * for INTERNAL consistency (both rows of a game agreeing) rather than against a
 * source this mode never loaded.
 */
async function runVerifyMode(args, manifest) {
  const pool = require('../modules/pool');
  assertPoolMatchesEnvironment(pool);
  const client = await pool.connect();
  const query = (sql, values) => {
    assertNotHoldoutSql(sql);
    return client.query(sql, values);
  };
  try {
    await query(args.purgeStaleCache ? 'BEGIN' : 'BEGIN READ ONLY');
    const rows = (await query(SEASON_ROWS_SQL, [args.season])).rows;
    const neutralRows = rows.filter((r) => r.neutral_site === true).length;
    const result = await runVerify({
      query,
      season: args.season,
      // Derived from what is stored, because no pinned CSV was loaded in this
      // mode. This makes the neutral assertion a consistency check rather than
      // a provenance one, which is the honest thing for a mode that never saw
      // the source.
      expectedNeutralGames: neutralRows / ROWS_PER_GAME,
      purge: args.purgeStaleCache,
    });
    console.log(
      `${manifest.season}: ${result.rows} rows, ${result.distinctGameKeys} distinct game_keys, ` +
      `${result.neutralRows} neutral-site rows`
    );
    if (result.errors.length > 0) {
      console.error(`ORIENTATION INCOMPLETE (${result.errors.length}):`);
      for (const e of result.errors.slice(0, 20)) console.error('  ' + e);
    } else {
      console.log('orientation: complete and consistent');
    }
    console.log(`cached ${model.MODEL_VERSION} runs for ${args.season}: ${result.staleRuns}`);
    if (result.purged !== null) {
      console.log(`purged ${result.purged} stale cached run(s) (children cascade)`);
    } else if (result.staleRuns > 0) {
      console.error(
        'stale cached runs survive: something computed a projection from the pre-repair schedule. ' +
        'Re-run with --purge-stale-cache once traffic is quiesced'
      );
    }
    await query(args.purgeStaleCache ? 'COMMIT' : 'ROLLBACK');
    if (!result.ok) throw new Error('verification failed: see the report above');
    console.log('VERIFIED');
    return result;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * THE SUPPORTED ENTRY POINT IS THE CLI. `main` assumes its caller has already
 * loaded the environment, which the CLI path does at the top of this file and a
 * REPL or wrapper script does not: the `require.main === module` guard on that
 * dotenv call means a programmatic invocation builds its pool from whatever
 * process.env happens to hold, and `assertPoolMatchesEnvironment` cannot catch
 * it, because it consults the SAME unloaded environment and takes its
 * "no DATABASE_URL configured, nothing to disagree with" early exit (it now
 * refuses that case outright, but the environment still has to have been loaded
 * for it to have anything to check). Call this from anywhere other than the
 * command line and you are responsible for loading .env first. `now` is
 * injectable only so the capture-window guard can be driven from a test.
 */
async function main(argv, { now = new Date() } = {}) {
  const args = parseArgs(argv);

  // `args.season` is a NUMBER in [MIN_SEASON, MAX_SEASON] by the time it gets
  // here: parseSeason rejects anything that is not exactly four digits before
  // parseArgs returns, so this interpolation cannot introduce a separator, a
  // traversal segment, or an absolute path, and the join is anchored to
  // __dirname besides. Do not relax parseSeason without revisiting this line.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const manifestPath = path.join(__dirname, '..', 'data', `nfl-schedule-${args.season}.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // The manifest's own recorded provenance is the default pin, so the ordinary
  // invocation cannot repair from a revision the manifest never saw. An
  // explicit --commit/--blob is still accepted, and still has to survive the
  // identity cross-check below. The digest is checked inside, before either
  // field is read.
  const { commit, blob } = resolvePinnedSource(manifest, args);
  const csvUrl = `https://raw.githubusercontent.com/nflverse/nfldata/${commit}/data/games.csv`;

  // Before the CSV is read and before any database access. The manifest is
  // necessarily read first, because it is what this guard takes as input; what
  // matters is that nothing is fetched, opened or connected to on the strength
  // of a repair that is already disallowed.
  const window = assertBeforeCaptureWindow(manifest, now);
  console.log(
    `holdout capture for ${args.season} opens ${window.opensAt.toISOString()}; repairing before it`
  );

  if (args.verify) return runVerifyMode(args, manifest);

  // Deliberately AFTER the manifest and the window guard, so the error that
  // sends an operator to fetch a file can name the exact file. The bytes are
  // never fetched by this script: it takes a path, and verifies what it is
  // handed against the pinned blob SHA, which is a property a download inside
  // the script could not give anybody.
  if (!args.csv) {
    throw new Error(
      'required: --csv <path to the pinned nflverse games.csv>\n' +
      `  fetch it from: ${csvUrl}\n` +
      `  its bytes must hash to the pinned git blob ${blob}, which this script verifies before ` +
      'deriving anything from them\n' +
      `  e.g. curl -sSL -o games.csv "${csvUrl}" && node ${path.relative(process.cwd(), __filename)} --csv games.csv`
    );
  }

  const csvBytes = fs.readFileSync(args.csv);
  assertPinnedCsv(csvBytes, blob);
  console.log(`source: ${csvUrl}`);
  console.log(`blob ${blob} verified against the file on disk`);

  const desired = desiredOrientation(csvBytes.toString('utf8'), { season: args.season });
  const diff = assertManifestAgreement(desired, manifest);
  const expectedNeutralGames = neutralGamesIn(desired);
  console.log(
    `manifest ${manifest.digest.slice(0, 12)} agrees with games.csv on all ${diff.csvGames} game identities`
  );
  console.log(
    `neutral-site games DERIVED from the pinned source: ${expectedNeutralGames} ` +
    `(${expectedNeutralGames * ROWS_PER_GAME} rows)`
  );

  // dotenv already ran at the top of this file, before the requires that build
  // this pool. The assertion is what proves it still does.
  const pool = require('../modules/pool');
  assertPoolMatchesEnvironment(pool);
  const client = await pool.connect();
  const query = (sql, values) => {
    assertNotHoldoutSql(sql);
    return client.query(sql, values);
  };

  let committed = false;
  try {
    await query('BEGIN');

    // FOR UPDATE, so the rows the plan was computed from cannot be changed by
    // anything else between the plan and the writes. The season's 544 rows are
    // a small, bounded lock held for the length of one script run.
    const before = await query(
      `SELECT "season", "week", "nfl_team", "opponent", "game_key", "home_away", "neutral_site"
       FROM "nfl_games" WHERE "season" = $1
       ORDER BY "week", "nfl_team"
       FOR UPDATE`,
      [args.season]
    );
    console.log(`nfl_games rows for ${args.season}: ${before.rows.length}`);

    const plan = planOrientationRepair({ desired, rows: before.rows });
    console.log(`plan: ${plan.updates.length} rows to fill, ${plan.unchanged.length} already correct, ${plan.conflicts.length} conflicts`);
    const filled = new Map();
    for (const update of plan.updates) {
      for (const column of Object.keys(update.set)) filled.set(column, (filled.get(column) || 0) + 1);
    }
    for (const column of REPAIR_COLUMNS) console.log(`  ${column}: ${filled.get(column) || 0} rows would be filled`);

    if (plan.conflicts.length > 0) {
      console.error('REPAIR REFUSED - the database and the pinned source disagree:');
      for (const [kind, count] of summarizeConflicts(plan.conflicts)) console.error(`  ${kind}: ${count}`);
      for (const conflict of plan.conflicts.slice(0, 20)) {
        console.error(`  ${conflict.kind} @ ${conflict.where}: ${conflict.detail}`);
      }
      throw new Error(
        `${plan.conflicts.length} conflict(s): a null-only repair cannot proceed over stored values that ` +
        'disagree with its source'
      );
    }

    let rowsWritten = 0;
    if (args.apply) {
      for (const update of plan.updates) {
        const statement = buildUpdateStatement(update);
        const result = await query(statement.sql, statement.values);
        if (result.rowCount !== 1) {
          throw new Error(
            `null-only UPDATE for ${update.season} week ${update.week} ${update.nflTeam} touched ` +
            `${result.rowCount} rows, expected exactly 1 - the row changed under the plan`
          );
        }
        rowsWritten += 1;
      }
      console.log(`applied: ${rowsWritten} rows updated`);
    }

    // Verification runs on rows, inside the transaction, before anything is
    // durable. The apply path re-reads what it just wrote rather than trusting
    // its own plan; the dry run puts the identical check over the rows the plan
    // would have produced.
    const after = args.apply
      ? (await query(
        `SELECT "season", "week", "nfl_team", "opponent", "game_key", "home_away", "neutral_site"
           FROM "nfl_games" WHERE "season" = $1 ORDER BY "week", "nfl_team"`,
        [args.season]
      )).rows
      : applyPlanToRows(before.rows, plan.updates);

    const errors = verifyOrientedRows(after, { expectedNeutralGames });
    const neutralRows = after.filter((r) => r.neutral_site === true).length;
    console.log(
      `verification: ${after.length} rows, ` +
      `${new Set(after.map((r) => r.game_key)).size} distinct game_keys, ` +
      `${neutralRows} neutral-site rows`
    );
    if (errors.length > 0) {
      console.error(`POST-FILL VERIFICATION FAILED (${errors.length}):`);
      for (const e of errors.slice(0, 20)) console.error('  ' + e);
      throw new Error('rolling back: the repaired season does not satisfy its own invariants');
    }
    console.log('verification: OK');

    // Cache invalidation, last and still inside the transaction. Orientation is
    // an input the weekly engine reads, so every cached run for this season
    // under the CURRENT model was computed from a schedule that no longer
    // matches the one on disk. Older model versions are unreachable through
    // findRun already and are somebody else's cleanup.
    //
    // A plan with nothing in it invalidates nothing. Everything here is one
    // transaction, so a run that wrote rows and then failed took the rows back
    // with it: an empty plan really does mean the schedule this cache was built
    // from is the schedule still on disk, and dropping a season of warm cache
    // to re-derive identical numbers is a cost with no purchase.
    const changedSomething = plan.updates.length > 0;
    const staleRuns = await query(
      `SELECT COUNT(*)::int AS "runs" FROM "projection_runs"
       WHERE "season" = $1 AND "model_version" = $2`,
      [args.season, model.MODEL_VERSION]
    );
    console.log(`cached ${model.MODEL_VERSION} runs for ${args.season}: ${staleRuns.rows[0].runs}`);

    // Children go with the parent through ON DELETE CASCADE, but that is
    // asserted against the live catalog rather than assumed from a migration
    // file: a cascade that was dropped would otherwise leave orphaned
    // projections behind with no complaint.
    const fk = await query(
      `SELECT "confdeltype" FROM "pg_constraint"
       WHERE "conrelid" = 'player_week_projections'::regclass
         AND "confrelid" = 'projection_runs'::regclass
         AND "contype" = 'f'`
    );
    const cascades = fk.rows.length > 0 && fk.rows.every((r) => r.confdeltype === 'c');
    console.log(`player_week_projections -> projection_runs cascades on delete: ${cascades}`);

    if (!changedSomething) {
      console.log(
        `no rows changed, so the ${staleRuns.rows[0].runs} cached run(s) were computed from this exact ` +
        'schedule and are left in place'
      );
    }

    if (args.apply) {
      if (changedSomething) {
        if (!cascades) {
          const children = await query(
            `DELETE FROM "player_week_projections"
             WHERE "run_id" IN (SELECT "id" FROM "projection_runs" WHERE "season" = $1 AND "model_version" = $2)`,
            [args.season, model.MODEL_VERSION]
          );
          console.log(`no ON DELETE CASCADE: deleted ${children.rowCount} player_week_projections rows explicitly`);
        }
        const deleted = await query(
          `DELETE FROM "projection_runs" WHERE "season" = $1 AND "model_version" = $2`,
          [args.season, model.MODEL_VERSION]
        );
        console.log(`invalidated ${deleted.rowCount} cached run(s)${cascades ? ' (children cascaded)' : ''}`);
      }
      await query('COMMIT');
      committed = true;
      console.log(
        `COMMITTED: ${args.season} schedule orientation ${changedSomething ? 'repaired' : 'already correct, nothing written'}`
      );
    } else {
      console.log(
        changedSomething
          ? `dry run: would invalidate ${staleRuns.rows[0].runs} cached run(s)${cascades ? ' (children cascade)' : ''}`
          : 'dry run: would invalidate nothing'
      );
      await query('ROLLBACK');
      console.log('DRY RUN - nothing was written. Re-run with --apply to commit.');
    }
  } finally {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch (_) { /* already resolved */ }
    }
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  REPAIR_COLUMNS,
  ROWS_PER_GAME,
  FORBIDDEN_TABLES,
  CAPTURE_WINDOW_HOURS,
  MIN_SEASON,
  MAX_SEASON,
  DEFAULT_SEASON,
  parseSeason,
  SEASON_ROWS_SQL,
  STALE_RUNS_SQL,
  assertNotHoldoutSql,
  assertModeCombination,
  runVerify,
  assertPoolMatchesEnvironment,
  assertBeforeCaptureWindow,
  resolvePinnedSource,
  gitBlobSha,
  assertPinnedCsv,
  desiredOrientation,
  neutralGamesIn,
  manifestIdentityDiff,
  assertManifestAgreement,
  sameStoredValue,
  planOrientationRepair,
  applyPlanToRows,
  verifyOrientedRows,
  buildUpdateStatement,
  summarizeConflicts,
  parseArgs,
  main,
};
