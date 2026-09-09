/**
 * Disposable-Postgres test for #1043: the runtime proof behind the source guard.
 *
 * The guard (server/test/teamInsertLockGuard.test.js) asserts, from source, that
 * every Team-insert takes a League row lock first. This asserts the PROPERTY
 * that lock buys, which only a real Postgres row lock can demonstrate: a join
 * issued while a Draft act holds the League row FOR UPDATE BLOCKS until the act
 * commits, and then completes consistently - the new Team is a clean row, never
 * one carrying a roster the act's wipe already passed.
 *
 * A matcher fake cannot express any of this: fakePool does not implement row
 * locks or blocking, so the whole claim is about what real Postgres does when
 * two transactions contend for one `leagues` row.
 *
 * Build:
 *  1. Seed an owner, a joiner, a pre-draft (joinable) league, and the owner's
 *     Team with one roster row.
 *  2. Connection A models the Draft act: BEGIN, take the League row FOR UPDATE
 *     (exactly draftAct.service.runDraftAct's first statement), and hold it.
 *  3. Connection B issues a real joinLeague (its own BEGIN, its own League FOR
 *     UPDATE, then the Team insert). It must BLOCK on B's FOR UPDATE.
 *  4. Observe B waiting on a lock in pg_stat_activity, and assert B's promise is
 *     still pending - the block is real, not a race we happened to win.
 *  5. A wipes the rosters (the act's per-league delete) and COMMITs.
 *  6. B unblocks, its join commits, and the new Team exists with an EMPTY roster
 *     - it serialized behind the act, so it was created against the committed
 *     post-reset state, not lost between the snapshot and the wipe.
 *
 * Gated twice, exactly like the other *.pg.test.js files: PG_TESTS=1 (or the
 * per-file TEAM_INSERT_LOCK_PG_TESTS=1) must be set, and every DATABASE_URL*
 * variable must be ABSENT, so a stray local run can never touch shared
 * production. The gate is a strict `=== '1'` string compare (`=true` or `=0`
 * does NOT enable it - it would silently skip and look like a pass). CI's
 * migration-smoke job, which runs every migration to latest and then this
 * suite, is the binding run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { joinLeague } = require('../services/leagueMembership.service');

const ENABLED = process.env.PG_TESTS === '1' || process.env.TEAM_INSERT_LOCK_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('team-insert-lock PG test (skipped: set PG_TESTS=1 or TEAM_INSERT_LOCK_PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('team-insert-lock PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
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
  // A, B and the poller each need a live connection at once.
  const pool = new pg.Pool({ ...connection, max: 5 });

  const seeded = { users: [], leagues: [], teams: [], players: [] };

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    const id = res.rows[0].id;
    seeded.users.push(id);
    return id;
  }
  async function seedLeague(name, ownerId, code) {
    // invite_code is varchar(12) (initial_schema): the code MUST be 12 chars or
    // fewer, or the INSERT fails 22001 before any assertion runs. See the same
    // warning at draftActivity.pg.test.js. `code` is assumed already <= 12.
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "max_teams")
       VALUES ($1, $2, $3, 12) RETURNING "id", "draft_status"`,
      [name, ownerId, code]
    );
    seeded.leagues.push(res.rows[0].id);
    return res.rows[0];
  }
  async function seedTeam(leagueId, ownerId, name) {
    const res = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, $3) RETURNING "id"`,
      [leagueId, ownerId, name]
    );
    seeded.teams.push(res.rows[0].id);
    return res.rows[0].id;
  }
  async function seedPlayer(name) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'RB', 'MIN') RETURNING "id"`,
      [name]
    );
    seeded.players.push(res.rows[0].id);
    return res.rows[0].id;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Wait until a backend is blocked on a lock while running a `FOR UPDATE` read,
  // which is B waiting on A's held League row. Returns true once seen. Scoped to
  // THIS database and to backends other than the poller's own, so an unrelated
  // connection elsewhere cannot satisfy it (belt-and-braces: the runner already
  // serialises pg files with --test-concurrency=1).
  async function waitForBlockedLock(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE%'
            AND datname = current_database() AND pid <> pg_backend_pid()`
      );
      if (res.rows[0].n > 0) return true;
      await sleep(100);
    }
    return false;
  }

  test.after(async () => {
    // Own cleanup, children before parents (FKs). Best-effort: the disposable DB
    // is thrown away regardless, but a clean teardown keeps a reused local DB sane.
    try {
      for (const leagueId of seeded.leagues) {
        await pool.query(`DELETE FROM "team_players" WHERE "league_id" = $1`, [leagueId]);
      }
      for (const teamId of seeded.teams) {
        await pool.query(`DELETE FROM "teams" WHERE "id" = $1`, [teamId]);
      }
      // A team the join created is not in seeded.teams; sweep by league too.
      for (const leagueId of seeded.leagues) {
        await pool.query(`DELETE FROM "teams" WHERE "league_id" = $1`, [leagueId]);
        await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
      }
      for (const playerId of seeded.players) {
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [playerId]);
      }
      for (const userId of seeded.users) {
        await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [userId]);
      }
    } finally {
      await pool.end();
    }
  });

  test('a join blocks while a Draft act holds the League lock, then completes consistently', async () => {
    const owner = await seedUser(`til_owner_${Date.now()}`);
    const joiner = await seedUser(`til_joiner_${Date.now()}`);
    // invite_code is varchar(12); base-36 of Date.now() keeps `TIL<...>` to 11
    // chars and unique enough for a single seed in a disposable database.
    const inviteCode = `TIL${Date.now().toString(36)}`.slice(0, 12);
    const league = await seedLeague('Team Insert Lock League', owner, inviteCode);
    assert.equal(league.draft_status, 'pending', 'a fresh league must be pre-draft (joinable) for the join to be admissible');
    const ownerTeam = await seedTeam(league.id, owner, 'Owner Team');
    const player = await seedPlayer(`TIL Player ${Date.now()}`);
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [league.id, ownerTeam, player]
    );

    // A: the Draft act takes and holds the League row lock.
    const actClient = await pool.connect();
    let joinResolved = false;
    let joinError = null;
    let joinResult = null;
    let joinPromise = null;
    let settled = null;
    try {
      await actClient.query('BEGIN');
      await actClient.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`, [league.id]);

      // B: a real join, on its own connection and transaction. Launched, not
      // awaited, so we can observe it block.
      joinPromise = (async () => {
        const joinClient = await pool.connect();
        try {
          await joinClient.query('BEGIN');
          const out = await joinLeague(joinClient, { leagueId: league.id, userId: joiner, teamName: 'Joiner Team' });
          await joinClient.query('COMMIT');
          return out;
        } catch (error) {
          await joinClient.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          joinClient.release();
        }
      })();
      // `settled` never rejects (both handlers return), so awaiting it later
      // cannot throw a raw error past our assertions.
      settled = joinPromise.then(
        (out) => { joinResolved = true; joinResult = out; },
        (err) => { joinResolved = true; joinError = err; }
      );

      // The block must be real: observe B waiting on a lock, and confirm it has
      // not resolved while A still holds the row.
      const blocked = await waitForBlockedLock();
      assert.ok(blocked, 'expected the join to block on the League row lock while the act holds it');
      assert.equal(joinResolved, false, 'the join must not complete while the act holds the League lock');

      // The act wipes the rosters (its per-league delete) and commits.
      await actClient.query(`DELETE FROM "team_players" WHERE "league_id" = $1`, [league.id]);
      await actClient.query('COMMIT');
    } catch (error) {
      await actClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      actClient.release();
    }

    // B now unblocks and commits. Awaiting `settled` (which never rejects)
    // guarantees the handler captured joinResult/joinError.
    await settled;
    assert.equal(joinError, null, joinError ? `the join should succeed once unblocked, got: ${joinError.message}` : '');
    assert.ok(joinResult && joinResult.team && joinResult.team.id, 'the join returns the created Team');

    // The block is the proof, and it was already made: `joinResolved === false`
    // while the act held the lock, above. Having unblocked, the join committed a
    // durable Team, so the two transactions serialized and neither lost its work.
    const teamRow = await pool.query(`SELECT "id" FROM "teams" WHERE "id" = $1`, [joinResult.team.id]);
    assert.equal(teamRow.rows.length, 1, 'the joined Team row is present after both transactions commit');
    // NOT a proof of anything about stranding: joinLeague never creates roster
    // rows, so a freshly joined Team has an empty roster under every ordering.
    // Kept only as a sanity check that the join produced a clean row; the
    // serialization guarantee rests entirely on the block assertion above.
    const roster = await pool.query(
      `SELECT count(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [joinResult.team.id]
    );
    assert.equal(roster.rows[0].n, 0, 'sanity: a freshly joined Team carries no roster rows');
  });
}
