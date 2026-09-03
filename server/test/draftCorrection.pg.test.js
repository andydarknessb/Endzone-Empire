/**
 * Disposable-Postgres race test for Commissioner correction (#439, AC8
 * concurrency).
 *
 * The whole ticket rests on ONE mechanism: a correction and a pick serialize on
 * the league row lock, so a correction "cannot race a manager or autopick".
 * draftPlayer takes `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE` before
 * touching draft_picks; correctLatestPick takes the identical lock on the same
 * row. The fast suites assert both paths ISSUE that lock (a check on the code);
 * only a real Postgres can show that two real transactions actually SERIALIZE on
 * it - that the second to want the row blocks until the first commits, then sees
 * the committed state. So this gets a real Postgres.
 *
 * The scenario the lead asked for: one transaction begins a correction and holds
 * the league lock; the other attempts a pick on the same league. Exactly one
 * proceeds while the other BLOCKS, and when it unblocks it OBSERVES THE CORRECTED
 * (paused) STATE and is refused - never a torn interleave.
 *
 * Why the correction side runs as raw statements on a held transaction rather
 * than a bare correctLatestPick() call: a service opens and COMMITS its own
 * transaction atomically, so it cannot yield an in-flight lock to another
 * transaction for the pick to block on. This models the correction transaction
 * with the exact statements correctLatestPick commits (the same DELETE / paused
 * UPDATE, and the REAL appendCorrectionActivity), while the pick side is the
 * REAL draftPlayer. correctLatestPick's own atomicity and error contract are
 * proven in draftCorrection.route.test.js and .socket.test.js.
 *
 * WHAT THIS DOES NOT COVER, and where its sibling does. This proves a claim
 * about POSTGRES: given that SOME transaction holds the league row FOR UPDATE,
 * the real draftPlayer blocks and then observes the committed state. It does NOT
 * prove that correctLatestPick is the code that takes that lock - it replays the
 * statements rather than calling the service. The static half,
 * draftCorrection.route.test.js's "locks the league FOR UPDATE before any
 * mutation" test, proves correctLatestPick issues the same lock draftPlayer
 * does. Neither is sufficient alone: this one is blind to the service issuing the
 * lock; that one is blind to Postgres actually serialising on it. The residual
 * gap is precise and left open on purpose - if correctLatestPick's statements
 * DRIFT from what this file replays, neither test catches it. Closing it would
 * mean refactoring correctLatestPick to accept an injected client; that is a
 * design change, not a test fix. (The same static/runtime split #474's guards
 * use: one half proves the code says the right thing, the other that the system
 * does it.)
 *
 * Gated twice, exactly like draftActivity.pg.test.js: DRAFT_CORRECTION_PG_TESTS=1
 * (or the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must
 * be ABSENT, so a stray local run can never touch shared production. It self-skips
 * on a developer machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DRAFT_CORRECTION_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('draft correction PG race test (skipped: set PG_TESTS=1 or DRAFT_CORRECTION_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('draft correction PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // commitPick (the Pick commit moved to pick.service, #782) uses the module-level
  // pool singleton; with DATABASE_URL* absent it reads the standard PG* variables -
  // the disposable database. The same pool serves seeding and the lock holder, so
  // all three contend on one real DB. commitPick, not landPick, so no room
  // broadcast is required in this transaction-lock test.
  const pool = require('../modules/pool');
  const { commitPick } = require('../services/pick.service');
  const { appendCorrectionActivity } = require('../services/draftActivity');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });
  const REASON_MIGRATION = '20260826000007_draft_activity_correction_reason.js';

  const REASON = 'entered against the wrong team; correcting this before we resume play';
  let ownerA = null;
  let ownerB = null;
  let leagueId = null;
  let teamA = null;
  let playerCorrected = null;
  let playerNext = null;

  const delay = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    return res.rows[0].id;
  }

  test.before(async () => {
    // In migration-smoke the schema is already at latest, so this is a no-op;
    // a standalone local run brings the disposable DB up to date first.
    const applied = await knex('knex_migrations').where({ name: REASON_MIGRATION }).first();
    if (!applied) await knex.migrate.latest();

    ownerA = await seedUser('draft_correction_pg_a');
    ownerB = await seedUser('draft_correction_pg_b');
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      ['Draft Correction PG', ownerA, 'draftcorrpg']
    );
    leagueId = league.rows[0].id;
    // Active, unpaused, with T2 on the clock at pick index 1 (0-based) and one
    // committed live pick (pick_number 1, T1) as the latest non-keeper Pick.
    await pool.query(
      `UPDATE "leagues"
       SET "draft_status" = 'active', "draft_paused" = false, "current_pick" = 1,
           "roster_limit" = 10, "ir_slots" = 0, "current_season" = 2026, "current_week" = 1
       WHERE "id" = $1`,
      [leagueId]
    );
    const t1 = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position") VALUES ($1, $2, $3, 1) RETURNING "id"`,
      [leagueId, ownerA, 'Alpha']
    );
    teamA = t1.rows[0].id;
    // Bravo (T2) is on the clock at pick index 1; the correction reverses T1's
    // committed pick, so Bravo's id is never read back - seed it without capturing.
    await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position") VALUES ($1, $2, $3, 2) RETURNING "id"`,
      [leagueId, ownerB, 'Bravo']
    );
    const p1 = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('Wrong Guy', 'RB', 'KC') RETURNING "id"`
    );
    playerCorrected = p1.rows[0].id;
    const p2 = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('Next Up', 'WR', 'BUF') RETURNING "id"`
    );
    playerNext = p2.rows[0].id;
    // The latest reached live Pick that the correction will reverse.
    await pool.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number") VALUES ($1, $2, $3, 1)`,
      [leagueId, teamA, playerCorrected]
    );
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, teamA, playerCorrected]
    );
  });

  test.after(async () => {
    // CASCADE from leagues removes teams, picks, rosters and draft_activity, so
    // the append-only guard sees an empty table when migration-smoke rolls back.
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (playerCorrected) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerCorrected]);
    if (playerNext) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerNext]);
    if (ownerA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerA]);
    if (ownerB) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerB]);
    await knex.destroy();
    await pool.end();
  });

  test('a pick blocks on the league lock a correction holds, then observes the paused state and is refused', async () => {
    // The correction transaction: BEGIN and take the league row lock, exactly as
    // correctLatestPick does, and hold it open.
    const correction = await pool.connect();
    await correction.query('BEGIN');
    await correction.query('SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE', [leagueId]);

    // The pick, the REAL commitPick, for the team on the clock. Its first
    // statement after BEGIN is the same SELECT ... FOR UPDATE, so it blocks on
    // the row the correction holds.
    const pickOutcome = commitPick({ leagueId, userId: ownerB, playerId: playerNext }).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    );

    // While the correction holds the lock, the pick makes no progress.
    const whileBlocked = await Promise.race([pickOutcome, delay(500).then(() => ({ status: 'blocked' }))]);
    assert.equal(whileBlocked.status, 'blocked', 'the pick blocks while the correction holds the league lock');

    // The correction proceeds: reverse the latest non-keeper Pick, pause and
    // rewind, and append the REAL correction activity - then commit.
    await correction.query('DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = 1', [leagueId]);
    await correction.query('DELETE FROM "team_players" WHERE "league_id" = $1 AND "team_id" = $2 AND "player_id" = $3', [leagueId, teamA, playerCorrected]);
    await correction.query(
      `UPDATE "leagues" SET "draft_paused" = true, "current_pick" = 0, "pick_deadline_at" = NULL WHERE "id" = $1`,
      [leagueId]
    );
    const activity = await appendCorrectionActivity(correction, {
      leagueId,
      team: { id: teamA, name: 'Alpha' },
      player: { id: playerCorrected, name: 'Wrong Guy', position: 'RB', nfl_team: 'KC' },
      round: 1,
      pickNumber: 1,
      reason: REASON,
    });
    assert.equal(activity.kind, 'correction');
    await correction.query('COMMIT');
    correction.release();

    // The pick now unblocks, re-reads the league under the freed lock, sees the
    // paused state the correction committed, and is refused - never committing a
    // pick over a reversed one.
    const settled = await pickOutcome;
    assert.equal(settled.status, 'rejected', 'the pick is refused, not committed');
    assert.equal(settled.reason.statusCode, 409);
    assert.match(settled.reason.message, /paused/, 'refused because the correction left the draft paused');

    // Final state is the corrected one, with no torn interleave.
    const picks = await pool.query('SELECT "pick_number" FROM "draft_picks" WHERE "league_id" = $1 ORDER BY "pick_number"', [leagueId]);
    assert.deepEqual(picks.rows.map((r) => r.pick_number), [], 'the corrected Pick is gone and no new Pick was committed');
    const league = await pool.query('SELECT "draft_paused", "current_pick" FROM "leagues" WHERE "id" = $1', [leagueId]);
    assert.equal(league.rows[0].draft_paused, true, 'the draft is left paused');
    assert.equal(league.rows[0].current_pick, 0, 'the clock rewound to the corrected slot');
    const corrections = await pool.query(`SELECT "reason" FROM "draft_activity" WHERE "league_id" = $1 AND "kind" = 'correction'`, [leagueId]);
    assert.equal(corrections.rows.length, 1, 'one append-only correction entry');
    assert.equal(corrections.rows[0].reason, REASON);
  });
}
