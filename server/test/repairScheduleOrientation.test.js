const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repair = require('../scripts/repair-schedule-orientation');
const holdout = require('../services/holdout.service');
const { normalizeTeamKey } = require('../services/projectionFeatures');
const { computeManifestDigest, TOTAL_GAMES } = require('../services/scheduleManifest');

/**
 * These tests exercise the repair script's PLANNING and VERIFICATION functions
 * against fixtures, with no database anywhere. That split is the point of the
 * script's shape: every decision about what to write, what to refuse, and
 * whether the result is well-formed is a pure function of (pinned CSV, frozen
 * manifest, current rows), so the only thing left to the live run is issuing
 * statements it has already been proven correct about.
 *
 * The full-season fixture is SYNTHESIZED from the committed 2026 manifest
 * rather than checked in as a second copy of the schedule. A second copy would
 * be a second thing to keep in sync, and the manifest is already the
 * tamper-evident authority the script cross-checks against.
 */

const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'nfl-schedule-2026.json');
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const SEASON = 2026;

/**
 * A games.csv in the shape nflverseSync.buildScheduleRows reads, built from the
 * manifest's game identities. `neutralWeeks` names the (week, away@home) games
 * that carry location 'Neutral'; everything else is 'Home'.
 */
function synthesizeGamesCsv({ games = MANIFEST.games, neutral = [], season = SEASON } = {}) {
  const neutralSet = new Set(neutral);
  const header = 'season,game_type,week,gameday,gametime,away_team,home_team,location,stadium,roof,surface,home_rest,away_rest';
  const lines = [header];
  for (const game of games) {
    const id = `${game.week}:${game.away}@${game.home}`;
    // A plausible Sunday afternoon; the repair reads no times at all, but
    // buildScheduleRows drops a row it cannot build a kickoff for.
    const day = `2026-09-${String(6 + (game.week % 20)).padStart(2, '0')}`;
    lines.push([
      season, 'REG', game.week, day, '13:00', game.away, game.home,
      neutralSet.has(id) ? 'Neutral' : 'Home',
      'Some Stadium', 'outdoors', 'grass', 7, 7,
    ].join(','));
  }
  // A postseason row and another season's row, both of which must be ignored.
  lines.push([season, 'POST', 1, '2027-01-16', '16:30', 'KC', 'BUF', 'Home', 'X', 'outdoors', 'grass', 7, 7].join(','));
  lines.push([season - 1, 'REG', 1, '2025-09-07', '13:00', 'KC', 'BUF', 'Home', 'X', 'outdoors', 'grass', 7, 7].join(','));
  return lines.join('\n') + '\n';
}

const FULL_CSV = synthesizeGamesCsv();
// Two neutral games chosen from the real schedule, so the derived count is 2
// and never a constant this file also hardcodes somewhere else.
const NEUTRAL_IDS = MANIFEST.games.slice(0, 2).map((g) => `${g.week}:${g.away}@${g.home}`);
const NEUTRAL_CSV = synthesizeGamesCsv({ neutral: NEUTRAL_IDS });

/** The rows nfl_games holds today: every orientation column null. */
function unorientedRows(desired) {
  return [...desired.values()].map((want) => ({
    season: want.season,
    week: want.week,
    nfl_team: want.teamKey === 'WAS' ? 'WSH' : want.teamKey, // the DB speaks Tank01
    opponent: want.opponentKey === 'WAS' ? 'WSH' : want.opponentKey,
    game_key: null,
    home_away: null,
    neutral_site: null,
  }));
}

/** The rows a completed repair leaves behind. */
function orientedRows(desired) {
  return unorientedRows(desired).map((row) => {
    const want = desired.get(`${row.week}:${normalizeTeamKey(row.nfl_team)}`);
    return { ...row, game_key: want.game_key, home_away: want.home_away, neutral_site: want.neutral_site };
  });
}

// ---------------------------------------------------------------------------
// Source pinning and the manifest cross-check
// ---------------------------------------------------------------------------

test('the pinned blob SHA is git\'s, and a single changed byte fails it', () => {
  const bytes = Buffer.from('season,week\n2026,1\n');
  const sha = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(repair.gitBlobSha(bytes), sha);
  assert.equal(repair.assertPinnedCsv(bytes, sha), sha);
  const tampered = Buffer.from('season,week\n2026,2\n');
  assert.throws(
    () => repair.assertPinnedCsv(tampered, sha),
    /does not match the pinned blob SHA/,
    'kills the "trust the file you were handed" mutant'
  );
});

test('the manifest cross-check passes on the pinned source and counts its games', () => {
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  assert.equal(desired.size, TOTAL_GAMES * repair.ROWS_PER_GAME, 'two rows per game, one per side');
  const diff = repair.assertManifestAgreement(desired, MANIFEST);
  assert.equal(diff.csvGames, TOTAL_GAMES);
  assert.equal(diff.manifestGames, TOTAL_GAMES);
  assert.deepEqual(diff.csvOnly, []);
  assert.deepEqual(diff.manifestOnly, []);
});

test('a rescheduled matchup is a fatal identity mismatch', () => {
  // Two week-1 games trade visitors. Every team still plays exactly once that
  // week and the file still holds 272 games, so nothing structural notices.
  // Kills the "compare counts only" mutant.
  const first = MANIFEST.games.findIndex((g) => g.week === 1);
  const second = MANIFEST.games.findIndex((g, i) => g.week === 1 && i > first);
  const games = MANIFEST.games.map((g, i) => {
    if (i === first) return { ...g, away: MANIFEST.games[second].away };
    if (i === second) return { ...g, away: MANIFEST.games[first].away };
    return g;
  });
  const desired = repair.desiredOrientation(synthesizeGamesCsv({ games }), { season: SEASON });
  assert.throws(() => repair.assertManifestAgreement(desired, MANIFEST), /disagree about 2026/);
  const diff = repair.manifestIdentityDiff(desired, MANIFEST);
  assert.equal(diff.csvGames, TOTAL_GAMES, 'the counts alone would have said nothing was wrong');
  assert.equal(diff.manifestGames, TOTAL_GAMES);
  assert.equal(diff.csvOnly.length, 2);
  assert.equal(diff.manifestOnly.length, 2);
});

test('a home/away SWAP is a mismatch, not a match', () => {
  // The single most dangerous silent failure for a script whose whole job is
  // orientation: an unordered pair comparison would call this identical.
  // Kills the "sort the two teams before comparing" mutant.
  const swapped = MANIFEST.games[7];
  const games = MANIFEST.games.map((g, i) => (i === 7 ? { week: g.week, away: g.home, home: g.away } : g));
  const desired = repair.desiredOrientation(synthesizeGamesCsv({ games }), { season: SEASON });
  const diff = repair.manifestIdentityDiff(desired, MANIFEST);
  assert.deepEqual(diff.csvOnly, [`${swapped.week}:${swapped.home}@${swapped.away}`]);
  assert.deepEqual(diff.manifestOnly, [`${swapped.week}:${swapped.away}@${swapped.home}`]);
  assert.equal(
    new Set([...diff.csvOnly[0].split(/[:@]/), ...diff.manifestOnly[0].split(/[:@]/)]).size, 3,
    'the two identities name the same week and the same two teams, and differ only in order'
  );
  assert.throws(() => repair.assertManifestAgreement(desired, MANIFEST), /disagree about 2026/);
});

test('a manifest that fails its own digest is refused before any comparison', () => {
  const tampered = { ...MANIFEST, games: MANIFEST.games.slice(0, TOTAL_GAMES - 1) };
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  assert.throws(() => repair.assertManifestAgreement(desired, tampered), /schedule manifest for 2026/);
  // And a manifest with a freshly recomputed digest still cannot buy its way
  // past the full-season invariants.
  const rehashed = { ...tampered };
  rehashed.digest = computeManifestDigest(rehashed);
  assert.throws(() => repair.assertManifestAgreement(desired, rehashed), /271 games, expected exactly 272/);
});

// ---------------------------------------------------------------------------
// Neutral-site derivation
// ---------------------------------------------------------------------------

test('the neutral-site count is DERIVED from the pinned CSV, never assumed', () => {
  assert.equal(repair.neutralGamesIn(repair.desiredOrientation(FULL_CSV, { season: SEASON })), 0);
  const neutral = repair.desiredOrientation(NEUTRAL_CSV, { season: SEASON });
  assert.equal(repair.neutralGamesIn(neutral), NEUTRAL_IDS.length);
  // Both sides of a neutral game are flagged, and both keep their nominal
  // orientation: the engine's neutral_site checks are what neutralize them.
  const flagged = [...neutral.values()].filter((r) => r.neutral_site === true);
  assert.equal(flagged.length, NEUTRAL_IDS.length * repair.ROWS_PER_GAME);
  assert.equal(flagged.filter((r) => r.home_away === 'home').length, NEUTRAL_IDS.length);
  assert.equal(flagged.filter((r) => r.home_away === 'away').length, NEUTRAL_IDS.length);
  // The manifest carries no neutral data at all, so switching games to neutral
  // must not disturb the identity cross-check.
  repair.assertManifestAgreement(neutral, MANIFEST);
});

// ---------------------------------------------------------------------------
// Planning: null-only, idempotent, fail-loud
// ---------------------------------------------------------------------------

test('a wholly unoriented season plans one update per row and no conflicts', () => {
  const desired = repair.desiredOrientation(NEUTRAL_CSV, { season: SEASON });
  const plan = repair.planOrientationRepair({ desired, rows: unorientedRows(desired) });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.updates.length, TOTAL_GAMES * repair.ROWS_PER_GAME);
  assert.equal(plan.unchanged.length, 0);
  for (const update of plan.updates) {
    assert.deepEqual(Object.keys(update.set).sort(), [...repair.REPAIR_COLUMNS].sort());
  }
});

test('an already-repaired season is a no-op, not a second repair', () => {
  // Idempotence, which is what makes a re-run after a partial failure safe.
  const desired = repair.desiredOrientation(NEUTRAL_CSV, { season: SEASON });
  const plan = repair.planOrientationRepair({ desired, rows: orientedRows(desired) });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.unchanged.length, TOTAL_GAMES * repair.ROWS_PER_GAME);
});

test('a stored value that disagrees with the source is a conflict, never an overwrite', () => {
  // Kills the COALESCE mutant: the sync's upsert would take the file's value
  // here and destroy the evidence that the two sources disagree.
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  const rows = unorientedRows(desired);
  const wantFor = (row) => desired.get(`${row.week}:${normalizeTeamKey(row.nfl_team)}`);
  rows[0].home_away = wantFor(rows[0]).home_away === 'home' ? 'away' : 'home';
  rows[1].game_key = '2026_01_XXX_YYY';
  rows[2].neutral_site = true; // the source says false for every game in FULL_CSV

  const plan = repair.planOrientationRepair({ desired, rows });
  const kinds = new Map(repair.summarizeConflicts(plan.conflicts));
  assert.equal(kinds.get('disagreement'), 3);
  for (const conflict of plan.conflicts) assert.equal(conflict.kind, 'disagreement');
  // The disagreeing COLUMN is refused; the row's other, still-null columns are
  // planned as usual, because refusing them would be a second decision nobody
  // asked for. What matters is that the caller treats any conflict as fatal.
  assert.ok(plan.updates.length > 0);
  assert.ok(plan.updates.every((u) => !Object.prototype.hasOwnProperty.call(u.set, 'nonsense')));
});

test('a value that already matches is left alone even when its neighbours are filled', () => {
  const desired = repair.desiredOrientation(NEUTRAL_CSV, { season: SEASON });
  const rows = unorientedRows(desired);
  const want = desired.get(`${rows[0].week}:${normalizeTeamKey(rows[0].nfl_team)}`);
  rows[0].home_away = want.home_away;

  const plan = repair.planOrientationRepair({ desired, rows });
  assert.equal(plan.conflicts.length, 0);
  const update = plan.updates.find((u) => u.week === rows[0].week && u.nflTeam === rows[0].nfl_team);
  assert.deepEqual(
    Object.keys(update.set).sort(),
    ['game_key', 'neutral_site'],
    'the already-correct column is not rewritten'
  );
});

test('a false neutral_site already stored is a match, not a null to fill', () => {
  // `false` is falsy, so a null check written as `if (!current)` would treat a
  // stored false as missing and plan a write. Kills that mutant.
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  const rows = unorientedRows(desired);
  rows[0].neutral_site = false;
  const plan = repair.planOrientationRepair({ desired, rows });
  assert.equal(plan.conflicts.length, 0);
  const update = plan.updates.find((u) => u.week === rows[0].week && u.nflTeam === rows[0].nfl_team);
  assert.deepEqual(Object.keys(update.set).sort(), ['game_key', 'home_away']);
  assert.equal(repair.sameStoredValue('neutral_site', false, false), true);
  assert.equal(repair.sameStoredValue('neutral_site', false, true), false);
  assert.equal(repair.sameStoredValue('neutral_site', true, false), false);
});

test('rows the source does not describe, and games the database is missing, both stop the repair', () => {
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  const rows = unorientedRows(desired);
  const dropped = rows.pop();
  rows.push({ ...dropped, week: 99, nfl_team: 'BUF' });

  const kinds = new Map(repair.summarizeConflicts(repair.planOrientationRepair({ desired, rows }).conflicts));
  assert.equal(kinds.get('unknown-game'), 1, 'a row with no game in the pinned source');
  assert.equal(kinds.get('missing-row'), 1, 'a game in the pinned source with no row');
});

test('a stored opponent that contradicts the source stops the repair', () => {
  // A game_key written across this gap would name a game that did not happen.
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  const rows = unorientedRows(desired);
  rows[0].opponent = rows[0].opponent === 'KC' ? 'BUF' : 'KC';
  const plan = repair.planOrientationRepair({ desired, rows });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].kind, 'opponent-disagreement');
  assert.ok(!plan.updates.some((u) => u.week === rows[0].week && u.nflTeam === rows[0].nfl_team));
});

test('WSH and WAS are the same team, not a contradiction', () => {
  // The DB speaks Tank01 (WSH), the manifest speaks normalizeTeamKey (WAS).
  // Kills the "compare raw spellings" mutant, which would report 34 conflicts
  // for Washington alone and refuse an otherwise perfect repair.
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  const rows = unorientedRows(desired);
  assert.ok(rows.some((r) => r.nfl_team === 'WSH'), 'the fixture really does spell it WSH');
  assert.equal(repair.planOrientationRepair({ desired, rows }).conflicts.length, 0);
});

// ---------------------------------------------------------------------------
// Post-fill verification
// ---------------------------------------------------------------------------

const verifyFull = (rows, expectedNeutralGames) =>
  repair.verifyOrientedRows(rows, { expectedNeutralGames });

test('the repaired season satisfies every post-fill invariant', () => {
  const desired = repair.desiredOrientation(NEUTRAL_CSV, { season: SEASON });
  const rows = repair.applyPlanToRows(
    unorientedRows(desired),
    repair.planOrientationRepair({ desired, rows: unorientedRows(desired) }).updates
  );
  assert.equal(rows.length, 544);
  assert.deepEqual(verifyFull(rows, NEUTRAL_IDS.length), []);
});

test('verification counts rows, games, sides and neutral rows independently', () => {
  const desired = repair.desiredOrientation(NEUTRAL_CSV, { season: SEASON });
  const base = orientedRows(desired);
  const expectedNeutral = NEUTRAL_IDS.length;

  // Each mutation below breaks exactly one of the counted invariants, and each
  // is a mutant the corresponding check kills.
  const halfGame = base.slice(0, base.length - 1);
  assert.match(verifyFull(halfGame, expectedNeutral).join(' '), /expected exactly 544 rows/);
  assert.match(verifyFull(halfGame, expectedNeutral).join(' '), /1 rows, expected exactly 2/);

  // A whole game gone leaves 271 keys, which the row count alone would not
  // distinguish from a game whose two rows were merged.
  const missingGame = base.slice(0, base.length - 2);
  assert.match(verifyFull(missingGame, expectedNeutral).join(' '), /expected exactly 272 distinct game_keys/);

  const unfilled = base.map((r, i) => (i === 3 ? { ...r, home_away: null } : r));
  assert.match(verifyFull(unfilled, expectedNeutral).join(' '), /home_away is still null/);

  const bothHome = base.map((r) => (r.game_key === base[0].game_key ? { ...r, home_away: 'home' } : r));
  assert.match(verifyFull(bothHome, expectedNeutral).join(' '), /2 home \/ 0 away/);

  const sharedKey = base.map((r, i) => (i < 4 ? { ...r, game_key: base[0].game_key } : r));
  assert.match(verifyFull(sharedKey, expectedNeutral).join(' '), /4 rows, expected exactly 2/);

  const halfNeutral = base.map((r, i) => (i === 0 ? { ...r, neutral_site: !r.neutral_site } : r));
  assert.match(verifyFull(halfNeutral, expectedNeutral).join(' '), /disagree about neutral_site/);

  // The neutral count is checked against the number DERIVED from the pinned
  // source, so a season with the wrong number of neutral games fails even
  // though every other invariant holds.
  assert.match(verifyFull(base, expectedNeutral + 1).join(' '), /expected \d+ neutral-site rows/);
  assert.match(verifyFull(base, undefined).join(' '), /no neutral-site count was derived/);
});

test('a well-formed season passes only when the derived neutral count matches', () => {
  const desired = repair.desiredOrientation(FULL_CSV, { season: SEASON });
  const rows = orientedRows(desired);
  assert.deepEqual(verifyFull(rows, 0), [], 'no neutral games in this pinned source');
  assert.match(verifyFull(rows, 8).join(' '), /expected 16 neutral-site rows.*found 0/);
});

// ---------------------------------------------------------------------------
// Statement construction and the holdout-ledger guard
// ---------------------------------------------------------------------------

test('every UPDATE is null-only in the SQL itself, not merely in the plan', () => {
  // Kills the "drop the IS NULL guards" mutant: without them a row filled
  // between the plan and the write would be overwritten, which is the exact
  // failure the null-only rule exists to prevent.
  const statement = repair.buildUpdateStatement({
    season: 2026, week: 3, nflTeam: 'WSH', teamKey: 'WAS',
    set: { game_key: '2026_03_DAL_WSH', home_away: 'home', neutral_site: false },
  });
  assert.match(statement.sql, /^UPDATE "nfl_games" SET /);
  for (const column of repair.REPAIR_COLUMNS) {
    assert.ok(statement.sql.includes(`"${column}" IS NULL`), `${column} must be guarded`);
  }
  assert.deepEqual(statement.values, ['2026_03_DAL_WSH', 'home', false, 2026, 3, 'WSH']);
  // The two columns this script must never touch are not in the statement at
  // all, in any form.
  assert.ok(!statement.sql.includes('opponent'));
  assert.ok(!statement.sql.includes('kickoff_at'));
});

test('a partial update only names and only guards the columns it fills', () => {
  const statement = repair.buildUpdateStatement({
    season: 2026, week: 3, nflTeam: 'BUF', teamKey: 'BUF', set: { neutral_site: true },
  });
  assert.match(statement.sql, /SET "neutral_site" = \$1/);
  assert.ok(!statement.sql.includes('"home_away" IS NULL'), 'a column it is not writing is not its business');
  assert.deepEqual(statement.values, [true, 2026, 3, 'BUF']);
  assert.throws(
    () => repair.buildUpdateStatement({ season: 2026, week: 3, nflTeam: 'BUF', teamKey: 'BUF', set: {} }),
    /sets nothing/
  );
});

test('the script refuses to send any statement naming the holdout ledger', () => {
  // The ledger's DB triggers would reject a write anyway, but a rejection
  // mid-transaction aborts a repair for a reason nobody intended. Kills the
  // "trust the triggers" mutant.
  assert.equal(repair.assertNotHoldoutSql('SELECT 1 FROM "nfl_games"'), true);
  assert.equal(repair.assertNotHoldoutSql('BEGIN'), true);
  for (const table of repair.FORBIDDEN_TABLES) {
    assert.throws(
      () => repair.assertNotHoldoutSql(`SELECT * FROM "${table}"`),
      new RegExp(`append-only holdout table "${table}"`),
      `${table} must be unreachable`
    );
  }
  assert.deepEqual(
    [...repair.FORBIDDEN_TABLES].sort(),
    ['holdout_capture_status', 'projection_snapshot_players', 'projection_snapshots']
  );
});

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------

test('the script is dry-run by default and needs --apply to write', () => {
  assert.equal(repair.parseArgs(['--csv', 'games.csv']).apply, false);
  assert.equal(repair.parseArgs(['--csv', 'games.csv', '--apply']).apply, true);
  assert.equal(repair.parseArgs(['--csv', 'games.csv']).season, 2026);
  assert.equal(repair.parseArgs(['--csv', 'g.csv', '--season', '2025']).season, 2025);
  assert.equal(repair.parseArgs(['--csv', 'g.csv']).commit, null, 'the manifest supplies the default pin');
});

test('a flag with no value is an error, not the next flag swallowed', () => {
  // `--csv --apply` would otherwise repair from a file named "--apply", find
  // nothing, and exit 0 having quietly dropped the write. Kills the
  // "argv[i + 1] unconditionally" mutant.
  assert.throws(() => repair.parseArgs(['--csv', '--apply']), /--csv requires a value/);
  assert.throws(() => repair.parseArgs(['--csv']), /--csv requires a value/);
  assert.throws(() => repair.parseArgs(['--csv', 'g.csv', '--season', '--apply']), /--season requires a value/);
  assert.equal(repair.parseArgs(['--csv', 'g.csv', '--apply']).csv, 'g.csv', 'a real value still parses');
});

test('the repair refuses to run without a source file', async () => {
  await assert.rejects(repair.main([]), /required: --csv/);
});

// ---------------------------------------------------------------------------
// Bootstrap: the environment must be loaded before anything builds a pool
// ---------------------------------------------------------------------------

test('dotenv runs before any require that can reach modules/pool', () => {
  // modules/pool builds its pg.Pool at module-evaluation time out of
  // process.env, and nflverseSync.service pulls it in transitively. dotenv
  // arriving after those requires leaves the pool on the local development
  // defaults while the script reports a successful repair against it - which,
  // for a one-shot authorized repair, also records the repair as done.
  // Static, because require order is a property of the file, not of a call.
  // Kills the "dotenv inside main" mutant.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'repair-schedule-orientation.js'), 'utf8'
  );
  const dotenvAt = source.indexOf("require('dotenv')");
  const firstServiceAt = source.indexOf("require('../services/");
  const poolAt = source.indexOf("require('../modules/pool')");
  assert.ok(dotenvAt > 0, 'the script loads dotenv at all');
  assert.ok(firstServiceAt > 0 && poolAt > 0, 'located both requires');
  assert.ok(dotenvAt < firstServiceAt, 'dotenv must precede the service requires that pull in the pool');
  assert.ok(dotenvAt < poolAt, 'dotenv must precede the pool require');
  // Exactly one dotenv call: a second one later would read as belt-and-braces
  // while doing nothing, since the pool it needed to precede is already built.
  assert.equal(source.split("require('dotenv')").length - 1, 1);
});

test('a pool built before the environment is refused, not used', () => {
  // The runtime half of the same guard: it checks the object that actually got
  // built rather than trusting the require order to stay put.
  const env = { DATABASE_URL: 'postgres://user@prod.example/endzone' };
  assert.throws(
    () => repair.assertPoolMatchesEnvironment({ options: { host: 'localhost', database: 'endzone_empire' } }, env),
    /built before the environment was loaded/,
    'kills the "assume the pool is right" mutant'
  );
  assert.equal(
    repair.assertPoolMatchesEnvironment({ options: { connectionString: env.DATABASE_URL } }, env),
    true
  );
  // DATABASE_URL_RUNTIME wins, the same way modules/pool reads it.
  const runtime = { DATABASE_URL_RUNTIME: 'postgres://runtime', DATABASE_URL: 'postgres://other' };
  assert.throws(() => repair.assertPoolMatchesEnvironment({ options: { connectionString: runtime.DATABASE_URL } }, runtime), /built before/);
  assert.equal(repair.assertPoolMatchesEnvironment({ options: { connectionString: runtime.DATABASE_URL_RUNTIME } }, runtime), true);
  // No DATABASE_URL at all is a legitimate PG* configuration, not a fault.
  assert.equal(repair.assertPoolMatchesEnvironment({ options: { host: 'localhost' } }, {}), true);
});

// ---------------------------------------------------------------------------
// Holdout sequencing: the repair invalidates evidence it cannot restate
// ---------------------------------------------------------------------------

const CAPTURE_OPENS = new Date(
  new Date(MANIFEST.captureNotAfter['1']).getTime() - repair.CAPTURE_WINDOW_HOURS * 3600 * 1000
);

test('the repair refuses to run once the capture window has opened', () => {
  // Filling game_key moves the schedule_hash a holdout snapshot stores as its
  // schedule provenance, and the ledger is append-only: a snapshot written
  // before the repair would fail its next capture pass with a provenance
  // mismatch, a failed status row and a 503 on /api/health/holdout. There is
  // nothing to fix afterwards, so the question is asked before anything is
  // read. Kills the "no sequencing guard" mutant.
  const before = repair.assertBeforeCaptureWindow(MANIFEST, new Date(CAPTURE_OPENS.getTime() - 1000));
  assert.equal(before.opensAt.getTime(), CAPTURE_OPENS.getTime());
  assert.equal(before.firstCaptureNotAfter.toISOString(), MANIFEST.captureNotAfter['1']);

  for (const at of [CAPTURE_OPENS, new Date(CAPTURE_OPENS.getTime() + 1000), new Date('2027-06-01T00:00:00Z')]) {
    assert.throws(
      () => repair.assertBeforeCaptureWindow(MANIFEST, at),
      /holdout capture window opened/,
      `must refuse at ${at.toISOString()}`
    );
  }
});

test('main REFUSES a post-window run before it reads anything', async () => {
  // The guard's CALL SITE, not the guard. Every other assertion in this file
  // exercises pure functions, so a refactor that dropped or reordered this one
  // call would leave the suite green while the repair became runnable after a
  // snapshot exists - the provenance mismatch, the failed status row and the
  // /api/health/holdout 503 the guard is the only thing preventing, against a
  // ledger with no remedy. Kills the "stub out the call" mutant.
  //
  // The path is deliberately nonsense: the refusal must arrive BEFORE any file
  // is read, so getting the missing-file error instead is itself the failure.
  await assert.rejects(
    repair.main(['--csv', 'c:/definitely/not/a/file.csv'], { now: new Date('2027-01-01T00:00:00Z') }),
    (err) => {
      assert.match(err.message, /holdout capture window opened/);
      assert.doesNotMatch(err.message, /ENOENT|no such file/, 'the guard must fire before the CSV is read');
      return true;
    }
  );
  // And the same call with the clock inside the window gets past the guard, so
  // the test above is about the window and not about main throwing at all.
  await assert.rejects(
    repair.main(['--csv', 'c:/definitely/not/a/file.csv'], { now: new Date('2026-07-01T00:00:00Z') }),
    /ENOENT|no such file/
  );
});

test('the window bound is the manifest\'s own earliest deadline, not a date in this file', () => {
  // A manifest whose week 1 deadline is already past must refuse at a moment
  // the real one still allows, or the guard is reading something other than the
  // manifest it was handed. Kills the "hardcode the 2026 date" mutant.
  const past = {
    ...MANIFEST,
    captureNotAfter: { ...MANIFEST.captureNotAfter, 1: '2020-09-10T00:20:00.000Z' },
  };
  const stillFineForTheRealSeason = new Date(CAPTURE_OPENS.getTime() - 86400000);
  repair.assertBeforeCaptureWindow(MANIFEST, stillFineForTheRealSeason);
  assert.throws(() => repair.assertBeforeCaptureWindow(past, stillFineForTheRealSeason), /holdout capture window opened/);

  // The bound is the MINIMUM deadline, so a season whose earliest window is not
  // week 1's is still handled. Kills the "read captureNotAfter['1'] directly"
  // mutant.
  const outOfOrder = { ...MANIFEST, captureNotAfter: { ...MANIFEST.captureNotAfter, 12: '2020-11-26T01:00:00.000Z' } };
  assert.throws(() => repair.assertBeforeCaptureWindow(outOfOrder, stillFineForTheRealSeason), /holdout capture window opened/);

  // And the 24h window is imported from the holdout service rather than copied.
  assert.equal(repair.CAPTURE_WINDOW_HOURS, holdout.CAPTURE_WINDOW_HOURS);
  assert.throws(
    () => repair.assertBeforeCaptureWindow({ season: 2026, captureNotAfter: {} }, new Date('2026-01-01T00:00:00Z')),
    /no captureNotAfter deadlines/,
    'a manifest that cannot say is not a manifest that says yes'
  );
});

// ---------------------------------------------------------------------------
// Pinned-source resolution
// ---------------------------------------------------------------------------

test('the manifest proves itself BEFORE its recorded pin is used', () => {
  assert.deepEqual(
    repair.resolvePinnedSource(MANIFEST, {}),
    { commit: MANIFEST.source.commit, blob: MANIFEST.source.blobSha }
  );
  assert.deepEqual(
    repair.resolvePinnedSource(MANIFEST, { commit: 'abc', blob: 'def' }),
    { commit: 'abc', blob: 'def' },
    'an explicit pin still overrides, and still faces the identity cross-check'
  );
  // A tampered manifest must be named as tampered. Reading its `source` first
  // would refuse the CSV for "not matching its pinned blob", pointing the
  // operator at the one file that is not the problem. Kills the "resolve the
  // pin, verify later" mutant.
  const tampered = {
    ...MANIFEST,
    source: { ...MANIFEST.source, blobSha: '0'.repeat(40), commit: '1'.repeat(40) },
  };
  assert.throws(() => repair.resolvePinnedSource(tampered, {}), /fails its digest check/);
});
