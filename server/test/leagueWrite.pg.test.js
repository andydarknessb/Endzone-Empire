'use strict';

/**
 * Disposable-Postgres test for the League write (ADR 0070): the League-row lock is
 * FOR NO KEY UPDATE, so a second League write for the same League waits, while an
 * ordinary insert that references the League (lineup_entries, through its foreign
 * key) does not. Only a real Postgres can show lock conflicts, so the fake pool in
 * leagueWrite.test.js cannot stand in for this file.
 *
 * Gated twice, like commissionerLockOrder.pg.test.js: PG_TESTS=1 (or
 * LEAGUE_WRITE_PG_TESTS=1) must be set, and every DATABASE_URL* variable must be
 * ABSENT, so a stray local run never touches the shared production database. It
 * self-skips on a developer machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LEAGUE_WRITE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('league write PG test (skipped: set PG_TESTS=1 or LEAGUE_WRITE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('league write PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  // The test's own reads and the second connection. The League write itself
  // connects through server/modules/pool, which reads the same PG* variables.
  const pool = new pg.Pool({ ...connection, max: 2 });
  const modulePool = require('../modules/pool');
  const { leagueWrite } = require('../modules/leagueWrite');

  // Arbitrary: nothing here reads season-scoped rows beyond the one lineup row.
  const SEASON = 2090;

  let leagueId = null;
  let playerId = null;
  let ownerId = null;
  let teamId = null;

  /** Wait until `n` backends are blocked on a lock, so the next step runs only once the last one is parked. */
  async function waitForBlocked(n, what) {
    const deadline = Date.now() + 10000;
    for (;;) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "pg_stat_activity"
          WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`
      );
      if (result.rows[0].n >= n) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} blocked backend(s): ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  const gate = () => {
    let open;
    const promise = new Promise((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };

  test.before(async () => {
    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('lw_pg_owner', 'lw-pg-owner@example.invalid', 'x') RETURNING "id"`
    );
    ownerId = users.rows[0].id;

    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status")
       VALUES ('PG League Write', $1, 'lwpg01', $2, 1, 10, 0, 24, 'complete')
       RETURNING "id"`,
      [ownerId, SEASON]
    );
    leagueId = league.rows[0].id;

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'PG Write Team') RETURNING "id"`,
      [leagueId, ownerId]
    );
    teamId = teams.rows[0].id;

    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('PG Write Player', 'RB', 'LWP') RETURNING "id"`
    );
    playerId = players.rows[0].id;
  });

  test.after(async () => {
    if (leagueId != null) await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    if (playerId != null) await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [playerId]);
    if (ownerId != null) await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [ownerId]);
    await pool.end();
    await modulePool.end();
  });

  test('a second League write for the same League waits until the first commits', async () => {
    const held = gate();
    const release = gate();
    const first = leagueWrite({ leagueId, label: 'lw-pg-first' }, async () => {
      held.open();
      await release.promise;
    });
    await held.promise;

    let secondDone = false;
    const second = leagueWrite({ leagueId, label: 'lw-pg-second' }, async () => {}).then(() => {
      secondDone = true;
    });
    await waitForBlocked(1, 'the second League write parked behind the first');
    assert.equal(secondDone, false, 'the second write has not run while the first holds the League row');

    release.open();
    await first;
    await second;
    assert.equal(secondDone, true, 'the second write runs once the first commits');
  });

  test('while a League write holds the lock, an insert into lineup_entries for that League completes without waiting', async () => {
    const held = gate();
    const release = gate();
    const writing = leagueWrite({ leagueId, label: 'lw-pg-holder' }, async () => {
      held.open();
      await release.promise;
    });
    await held.promise;

    // FOR NO KEY UPDATE does not conflict with the FOR KEY SHARE an FK check takes,
    // so the insert completes while the write still holds the League row.
    const insert = pool.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
       VALUES ($1, $2, $3, $4, 1, 'BENCH')`,
      [leagueId, teamId, playerId, SEASON]
    );
    const outcome = await Promise.race([
      insert.then(() => 'completed'),
      new Promise((resolve) => setTimeout(() => resolve('waited'), 3000).unref()),
    ]);
    release.open();
    await writing;
    assert.equal(outcome, 'completed', 'the lineup insert does not wait behind the League write');
  });

  test('a nested League write reads the outer write\'s uncommitted change', async () => {
    let seenByInner = null;
    await leagueWrite({ leagueId, label: 'lw-pg-outer' }, async (outer) => {
      await outer.client.query(`UPDATE "leagues" SET "name" = 'PG Uncommitted' WHERE "id" = $1`, [leagueId]);
      await leagueWrite({ leagueId, label: 'lw-pg-inner', within: outer }, async (inner) => {
        const row = await inner.client.query(`SELECT "name" FROM "leagues" WHERE "id" = $1`, [leagueId]);
        seenByInner = row.rows[0].name;
      });
    });
    assert.equal(seenByInner, 'PG Uncommitted', 'the nested write reads the outer write\'s change on the same transaction');
  });
}
