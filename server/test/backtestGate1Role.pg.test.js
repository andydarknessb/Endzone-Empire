/**
 * Disposable-Postgres LIFECYCLE tests for the Gate 1 role kit.
 *
 * The unit tests prove the runner's input handling. They cannot prove the thing
 * that actually matters: that create-role.sql produces a role with exactly
 * those privileges and no others, and that verify-role.sql would NOTICE if it
 * did not. Both of those are claims about PostgreSQL, and only PostgreSQL can
 * settle them. In particular the enumeration checks read `aclexplode` over the
 * system catalogs, which has no JS equivalent to emulate.
 *
 * These run ONLY in the CI migration-smoke job (postgres:17 service, real
 * migrations applied, so the four tables and fn_normalize_nfl_team exist),
 * gated twice: BACKTEST_PG_TESTS=1 must be set explicitly, and every
 * DATABASE_URL* variable must be ABSENT - connections are built from PG*
 * variables only, so a stray local run can never touch the shared production
 * database. Locally they report as a visible SKIP, never as silent green.
 *
 * WHAT THIS DOES TO ITS DATABASE. It creates and drops login roles named
 * `backtest_ro_pgtest_*`. That is a cluster-level mutation, not a schema one,
 * which is why every test tears its own role down in a `finally` and why the
 * suite drops any leftover at the start. It never touches the roles the CI job
 * itself runs as.
 *
 * The two RLS tests at the bottom go further: they transfer OWNERSHIP of the
 * four granted tables to an application-shaped role and ENABLE ROW LEVEL
 * SECURITY on three of them, committed, because the phases under test connect
 * separately and would not otherwise see it. Both are restored by the fixture's
 * own teardown, and neither is visible to the CI job's role, which is the
 * bootstrap superuser: it bypasses RLS and owns nothing it needs to. The role
 * that becomes the owner is dropped through `dropOwnerRole`, which REASSIGNS
 * first and sweeps only if that succeeded - `DROP OWNED BY` on a role that still
 * owns four real tables would delete them. See `installOwnedRlsFixture`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.BACKTEST_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('Gate 1 role lifecycle (skipped: BACKTEST_PG_TESTS not set - CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('Gate 1 role tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests create login roles and must only ever `
      + 'see a disposable PG* database');
  });
} else {
  const pg = require('pg');
  const gate1 = require('../scripts/run-backtest-role');

  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const pool = new pg.Pool({ ...connection, max: 2 });

  /** A throwaway password. Never printed: every assertion below checks that. */
  const TEST_PASSWORD = 'Zq4-tR8nW2vK6xB1mJ9cL5sD3gH7fY0a';
  const ROLE_PREFIX = 'backtest_ro_pgtest_';
  const futureIso = (days) => new Date(Date.now() + days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');

  let counter = 0;
  /**
   * Generated names go through the runner's own validator, so these tests
   * exercise names the real command line would actually accept. A fixture that
   * quietly used a name `--role` would reject would be testing a code path no
   * operator can reach.
   */
  const nextRole = () => gate1.assertRoleName(`${ROLE_PREFIX}${process.pid}_${++counter}`);

  /**
   * The stand-in for Supabase's hosted `postgres`: a NON-superuser that holds
   * CREATEROLE. Named under ROLE_PREFIX so the before-hook sweep cleans up
   * after a crashed run, even though it is an operator rather than a subject.
   */
  const OPERATOR_PASSWORD = 'Wm2-nH6bQ9xT4vC7kP1jR5sZ3dL8gY0e';
  const nextOperator = () => gate1.assertRoleName(`${ROLE_PREFIX}op_${process.pid}_${++counter}`);

  /** Collects log lines so the tests can assert on what an operator would see. */
  const capture = () => {
    const lines = [];
    return { lines, log: (m) => lines.push(m), text: () => lines.join('\n') };
  };

  const valuesFor = (roleName, validUntil) => ({
    roleName,
    databaseName: connection.database,
    validUntil,
    passwordVerifier: gate1.scramVerifier(TEST_PASSWORD),
    // Derived exactly as the CLI derives it, so these tests exercise the policy
    // name an operator would actually get rather than one the fixture invented.
    policyName: gate1.policyNameFor(roleName),
  });

  /**
   * The stand-in for `endzone_app`: a login role that OWNS the four granted
   * tables and holds nothing else. Distinct from the admin operator and from the
   * backtest role, because the whole point of the policy phases is that they are
   * a third authority - CREATE POLICY is gated on ownership, which CREATEROLE is
   * not.
   */
  const OWNER_ROLE_PASSWORD = 'Ct7-yU3pM8kX2nQ6bV4jS9wF1zA5rG0h';
  /**
   * Owner roles get their OWN prefix, and the before-hook sweep ROUTES on it.
   * A role named under this prefix owns the four granted tables, so it must
   * reach `dropOwnerRole` and never `forceDrop`. Derived from ROLE_PREFIX and
   * used by both the generator and the sweep, so the name a test mints and the
   * name the sweep recognises cannot drift apart - and so the sweep's
   * `LIKE '<ROLE_PREFIX>%'` still finds it.
   */
  const OWNER_ROLE_PREFIX = `${ROLE_PREFIX}own_`;
  const nextOwner = () => gate1.assertRoleName(`${OWNER_ROLE_PREFIX}${process.pid}_${++counter}`);
  /** The three tables production has RLS enabled on. player_season_stats is off. */
  const RLS_ENABLED_TABLES = ['nfl_games', 'player_stats', 'players'];
  /** Far future, and not the season backtestSnapshotClient.pg.test.js seeds. */
  const RLS_SEASON = 2032;

  /**
   * Return a pooled client to the pool ONLY if it is genuinely reusable, and
   * destroy it otherwise.
   *
   * The failure mode this exists for is cross-test contamination, and it has
   * happened: a test failed while a phase was mid-transaction, its cleanup
   * released the connection as-is, and the NEXT test drew the same connection
   * and died with "current transaction is aborted, commands ignored until end of
   * transaction block". The victim test looked broken; nothing was wrong with it.
   *
   * ROLLBACK is issued unconditionally. Outside a transaction PostgreSQL answers
   * with a WARNING ("there is no transaction in progress") and SUCCEEDS, so this
   * is safe on a clean connection; inside an aborted transaction it is the only
   * statement that succeeds and the only way back to a usable state. If it
   * fails, the connection cannot be brought to a known state at all, so it is
   * released WITH an error argument, which makes node-postgres destroy it rather
   * than hand it to the next caller.
   */
  async function releaseSafely(client) {
    let poison = null;
    try {
      await client.query('ROLLBACK');
    } catch (err) {
      // Either the transaction could not be cleared, or the connection is no
      // longer queryable at all (pg rejects on a client that hit a connection
      // error). Both mean: do not reuse this.
      poison = err;
    }
    // Exactly ONE release call. pg-pool's _releaseOnce throws on a second
    // release, and a throw from a cleanup hook would replace whatever real
    // failure the test was reporting with a confusing one about double release.
    try {
      client.release(poison || undefined);
    } catch {
      // Already released by another path. Nothing to do, and nothing worth
      // failing a cleanup hook over.
    }
  }

  /**
   * Drop a role unconditionally, for cleanup. Never used as the test's teardown.
   *
   * ONLY FOR ROLES THAT OWN NOTHING: subject roles and the CREATEROLE operator.
   * The `DROP OWNED BY` below is unconditional, so an APP-OWNER-shaped role
   * reaching this helper loses the four granted tables. Owner roles go to
   * `dropOwnerRole`, and the before-hook routes leftovers there by prefix
   * rather than trusting every caller to remember.
   */
  async function forceDrop(roleName) {
    const client = await pool.connect();
    try {
      // The connection may arrive poisoned from an earlier failure: the pool
      // hands it back exactly as it was left. Clear it BEFORE the drops, or both
      // of them fail with 25P02, get swallowed by the catches below, and this
      // helper silently does nothing while reporting success.
      await client.query('ROLLBACK').catch(() => {});
      // The HARNESS keeps DROP OWNED BY even though the kit no longer has one:
      // this runs as the bootstrap superuser and has to clear arbitrary residue
      // left by a failed test, including grants the kit never made. The kit
      // dropped it because its operator is not a superuser. Different actor,
      // different job.
      await client.query(`DROP OWNED BY ${gate1.quoteIdent(roleName)}`).catch(() => {});
      await client.query(`DROP ROLE IF EXISTS ${gate1.quoteIdent(roleName)}`).catch(() => {});
    } finally {
      await releaseSafely(client);
    }
  }

  /**
   * Drop an APP-OWNER-shaped role, WITHOUT the DROP OWNED BY that `forceDrop`
   * leads with.
   *
   * That helper is for subject roles, which own nothing. This one is for a role
   * that has deliberately been made the owner of four real tables, and
   * `DROP OWNED BY` on it would DELETE THEM. `REASSIGN OWNED BY` runs first, and
   * the sweep runs ONLY IF IT SUCCEEDED - the one statement in this file whose
   * result is not allowed to be swallowed. A REASSIGN that failed (a lock race,
   * a poisoned connection) leaves the four tables still owned by this role, and a
   * sweep that ran anyway would delete them from the CI database. Skipping it
   * usually leaves the `DROP ROLE` below failing too, which is the correct
   * trade: a leftover role is picked up by the next run's before-hook, which
   * routes it back to THIS helper on its `OWNER_ROLE_PREFIX` and never to
   * `forceDrop`, so the retry is gated the same way. A deleted `players` table
   * is not picked up by anything.
   */
  async function dropOwnerRole(roleName) {
    const client = await pool.connect();
    try {
      await client.query('ROLLBACK').catch(() => {});
      let reassigned = false;
      try {
        await client.query(`REASSIGN OWNED BY ${gate1.quoteIdent(roleName)} TO CURRENT_USER`);
        reassigned = true;
      } catch (err) {
        // Surfaced, not swallowed. This is the only path on which the fixture
        // can leave production-shaped tables owned by a role the suite wanted
        // gone, and a silent one would look identical to a clean teardown.
        console.error(`dropOwnerRole(${roleName}): REASSIGN OWNED BY failed, so the DROP OWNED BY `
          + `sweep is SKIPPED - the four granted tables may still be owned by this role: ${err.message}`);
      }
      if (reassigned) {
        await client.query(`DROP OWNED BY ${gate1.quoteIdent(roleName)}`).catch(() => {});
      }
      await client.query(`DROP ROLE IF EXISTS ${gate1.quoteIdent(roleName)}`).catch(() => {});
    } finally {
      await releaseSafely(client);
    }
  }

  /**
   * Put the four granted tables into the shape production was ACTUALLY in when
   * Gate 1 ran: owned by an application-shaped role that is neither the admin
   * operator nor the backtest role, with row-level security ENABLED and ZERO
   * POLICIES on three of the four, and seeded so that "reads nothing" and "reads
   * everything" are different answers rather than the same empty table twice.
   *
   * WHAT THIS DOES TO ITS DATABASE. The ownership transfer and the ENABLE ROW
   * LEVEL SECURITY are COMMITTED, not held in a rolled-back transaction, because
   * the phases under test run on a different connection and would not otherwise
   * see them. Both are restored by the returned function. Neither is visible to
   * the CI job's own role, which is the bootstrap superuser: it bypasses RLS and
   * its privileges do not depend on owning these tables. The seeded rows use a
   * season of their own and are deleted by the same function.
   *
   * The starting state is ASSERTED rather than assumed, because the restore
   * disables RLS unconditionally: if the CI database ever arrives with RLS
   * already on, that restore would be silently wrong and this stops first.
   */
  async function installOwnedRlsFixture(admin, ownerName) {
    const { rows: before } = await admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        ORDER BY c.relname`, [[...gate1.EXPECTED_TABLES]]
    );
    assert.equal(before.length, gate1.EXPECTED_TABLES.length,
      'the migrated database must have all four granted tables');
    assert.deepEqual(before.filter((r) => r.relrowsecurity || r.relforcerowsecurity).map((r) => r.relname), [],
      'the CI database must start with row-level security off on all four, or the restore is wrong');

    // Defensive pre-clean, in case an earlier run died between seeding and its
    // own cleanup. Deleting the players cascades to both stats tables, so this
    // cannot leave an orphan behind for a unique constraint to trip over.
    await admin.query('DELETE FROM "players" WHERE "name" LIKE $1', ['Gate1 RLS Fixture %']);
    await admin.query('DELETE FROM "nfl_games" WHERE "season" = $1', [RLS_SEASON]);

    const { rows: seeded } = await admin.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ($1, 'QB', 'KC'), ($2, 'RB', 'BUF')
       RETURNING "id"`,
      [`Gate1 RLS Fixture A ${ownerName}`, `Gate1 RLS Fixture B ${ownerName}`]
    );
    const playerIds = seeded.map((r) => r.id);
    await admin.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats")
       SELECT unnest($1::int[]), $2::int, 1, '{"passingYards": 1}'::jsonb`, [playerIds, RLS_SEASON]
    );
    await admin.query(
      `INSERT INTO "player_season_stats" ("player_id", "season", "games_played", "stats", "fantasy_points")
       SELECT unnest($1::int[]), $2::int, 1, '{"passingYards": 1}'::jsonb, 1.5`, [playerIds, RLS_SEASON]
    );
    await admin.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
       VALUES ($1::int, 1, 'KC', 'BUF', $2::timestamptz), ($1::int, 1, 'BUF', 'KC', $2::timestamptz)`,
      [RLS_SEASON, new Date(Date.UTC(2032, 8, 12, 17, 0, 0)).toISOString()]
    );

    // Ownership moves BEFORE create-role.sql runs, which is also the honest
    // order: the production tables were already owned by the application when
    // Gate 1 created the role on them.
    for (const table of gate1.EXPECTED_TABLES) {
      await admin.query(`ALTER TABLE public.${table} OWNER TO ${gate1.quoteIdent(ownerName)}`);
    }
    for (const table of RLS_ENABLED_TABLES) {
      await admin.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }

    /**
     * Counts SCOPED to the fixture's own rows. An unscoped count would race
     * backtestSnapshotClient.pg.test.js, which seeds and deletes its own season
     * in the same database and may run in a parallel process.
     */
    const scoped = {
      players: ['SELECT count(*)::int AS n FROM public.players WHERE id = ANY($1::int[])', [playerIds]],
      player_stats: ['SELECT count(*)::int AS n FROM public.player_stats WHERE season = $1', [RLS_SEASON]],
      player_season_stats: ['SELECT count(*)::int AS n FROM public.player_season_stats WHERE season = $1',
        [RLS_SEASON]],
      nfl_games: ['SELECT count(*)::int AS n FROM public.nfl_games WHERE season = $1', [RLS_SEASON]],
    };
    const countFor = async (queryable, table) => Number(
      (await queryable.query(...scoped[table])).rows[0].n
    );

    return {
      playerIds,
      countFor,
      restore: async () => {
        // The connection may arrive from a failed assertion mid-transaction;
        // clear it first or every statement below fails with 25P02 and is
        // swallowed, leaving four production tables owned by a role this suite
        // is about to try to drop.
        await admin.query('ROLLBACK').catch(() => {});
        for (const table of RLS_ENABLED_TABLES) {
          await admin.query(`ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY`).catch(() => {});
        }
        for (const row of before) {
          await admin.query(
            `ALTER TABLE public.${row.relname} OWNER TO ${gate1.quoteIdent(row.owner)}`
          ).catch(() => {});
        }
        await admin.query('DELETE FROM "player_stats" WHERE "season" = $1', [RLS_SEASON]).catch(() => {});
        await admin.query('DELETE FROM "player_season_stats" WHERE "season" = $1', [RLS_SEASON]).catch(() => {});
        await admin.query('DELETE FROM "nfl_games" WHERE "season" = $1', [RLS_SEASON]).catch(() => {});
        await admin.query('DELETE FROM "players" WHERE "id" = ANY($1::int[])', [playerIds]).catch(() => {});
      },
    };
  }

  /**
   * A client connected AS the temporary role, with an error listener attached
   * from the moment the client exists.
   *
   * `pg.Client` is an EventEmitter, and an 'error' event with no listener is
   * rethrown by EventEmitter as an uncaught exception. That is not a
   * hypothetical: pg_terminate_backend makes the server send SQLSTATE 57P01
   * before closing the socket, and on an IDLE client there is no pending query
   * promise to reject, so node-postgres surfaces it as an 'error' EVENT. With no
   * listener it failed the running test - a test whose whole point was that the
   * session gets terminated. The expected outcome was being reported as a crash.
   *
   * The listener uses `on`, not `once`: it must stay attached for the life of
   * the client, because a second error event (during `end()`, say) with no
   * listener would throw exactly the way the first one did.
   */
  function roleClient(roleName, { password = TEST_PASSWORD } = {}) {
    const client = new pg.Client({ ...connection, user: roleName, password });
    const errors = [];
    let notify = null;
    client.on('error', (err) => {
      errors.push(err);
      if (notify) notify(err);
    });
    return {
      client,
      errors,
      connect: () => client.connect(),
      query: (...args) => client.query(...args),
      /**
       * Resolve with the first connection-level error, or null if none arrives
       * within the timeout. Deliberately never REJECTS: a rejecting timeout
       * promise that nobody awaited (because an assertion failed first) would
       * become an unhandled rejection and fail the run for a second, unrelated
       * reason.
       *
       * ONE waiter only: `notify` is a single slot, and a second concurrent
       * call would silently replace the first waiter's resolver, leaving it
       * to hang until its timeout. If a test ever needs two waiters, make
       * this an array - do not call waitForError twice concurrently.
       */
      waitForError: (timeoutMs = 15000) => {
        if (errors.length > 0) return Promise.resolve(errors[0]);
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), timeoutMs);
          if (timer.unref) timer.unref();
          notify = (err) => { clearTimeout(timer); resolve(err); };
        });
      },
      /** Always safe: ending an already-terminated client can reject. */
      end: () => client.end().catch(() => {}),
    };
  }

  test.before(async () => {
    // Any role left behind by a crashed earlier run would make `create` fail on
    // its own pre-existence check for the wrong reason.
    //
    // ROUTED BY PREFIX, never swept uniformly. A leftover OWNER role still owns
    // the four granted tables - that is what the fixture does to them, and
    // dropOwnerRole's failed-REASSIGN path deliberately leaves one alive - so
    // handing it to forceDrop would run exactly the unconditional
    // `DROP OWNED BY` that dropOwnerRole exists to gate, and delete players,
    // player_stats, player_season_stats and nfl_games from the CI database one
    // run later. Subject and operator roles own nothing and take the direct
    // path.
    const { rows } = await pool.query(
      'SELECT rolname FROM pg_roles WHERE rolname LIKE $1', [`${ROLE_PREFIX}%`]
    );
    for (const row of rows) {
      if (row.rolname.startsWith(OWNER_ROLE_PREFIX)) await dropOwnerRole(row.rolname);
      else await forceDrop(row.rolname);
    }
  });

  test.after(async () => { await pool.end(); });

  // -------------------------------------------------------------------------

  test('create -> verify -> teardown, end to end, against a real database', async (t) => {
    const roleName = nextRole();
    const validUntil = futureIso(2);
    const values = valuesFor(roleName, validUntil);
    const client = await pool.connect();
    t.after(async () => { await releaseSafely(client); await forceDrop(roleName); });

    const created = capture();
    await gate1.phaseCreate(client, values, { log: created.log });

    // The flags are what the SQL said, read back from the catalog rather than
    // from the runner's own report.
    const { rows: [role] } = await client.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls,
              rolcanlogin, rolconnlimit, rolvaliduntil
       FROM pg_roles WHERE rolname = $1`, [roleName]
    );
    assert.deepEqual({
      rolsuper: role.rolsuper, rolcreatedb: role.rolcreatedb, rolcreaterole: role.rolcreaterole,
      rolinherit: role.rolinherit, rolreplication: role.rolreplication,
      rolbypassrls: role.rolbypassrls, rolcanlogin: role.rolcanlogin, rolconnlimit: role.rolconnlimit,
    }, {
      rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false,
      rolreplication: false, rolbypassrls: false, rolcanlogin: true, rolconnlimit: 1,
    });
    assert.equal(role.rolvaliduntil.toISOString().replace(/\.\d+Z$/, 'Z'), validUntil,
      'the expiry is exactly what was supplied, not a rounded or dropped one');

    // The password was stored as a SCRAM verifier. Reading pg_authid needs
    // superuser; where the CI role has it, this is the direct proof that no
    // plaintext reached the server.
    const { rows: secretRows } = await client.query(
      'SELECT rolpassword FROM pg_authid WHERE rolname = $1', [roleName]
    ).catch(() => ({ rows: [] }));
    if (secretRows.length > 0) {
      assert.match(secretRows[0].rolpassword, /^SCRAM-SHA-256\$\d+:/,
        'the stored secret must be a SCRAM verifier');
      assert.equal(secretRows[0].rolpassword.includes(TEST_PASSWORD), false);
    }

    // default_transaction_read_only, cluster-wide for the role.
    const { rows: settings } = await client.query(
      `SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
       WHERE r.rolname = $1 AND s.setdatabase = 0`, [roleName]
    );
    assert.deepEqual(settings[0].setconfig, ['default_transaction_read_only=on']);

    // create runs its own preflight and then the DDL; verify is a separate
    // phase and must pass standing alone.
    const verified = capture();
    await gate1.phaseVerify(client, values, { log: verified.log });
    assert.match(verified.text(), new RegExp(`role ${roleName} verified`));
    // The report has to say the PUBLIC caveat out loud rather than implying a
    // completeness it does not have.
    assert.match(verified.text(), /PUBLIC grants .* are NOT removed by this kit/);

    // No secret in anything an operator would see or paste into a review.
    for (const text of [created.text(), verified.text()]) {
      assert.equal(text.includes(TEST_PASSWORD), false, 'the password must never be echoed');
      assert.equal(/SCRAM-SHA-256\$/.test(text), false, 'the verifier must never be echoed');
    }

    const tornDown = capture();
    const result = await gate1.phaseTeardown(client, values, { log: tornDown.log });
    assert.deepEqual(result, { tornDown: true, noop: false });
    const { rows: after } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    assert.equal(after.length, 0, 'the role is gone');
    // Checked TEXTUALLY rather than by oid, on purpose: after the drop there is
    // no oid to look up, and a stale ACL entry naming a dropped role is exactly
    // the residue this is looking for. Casting a dangling grantee oid through
    // ::regrole would error rather than report, which would have to be caught,
    // and a caught error is indistinguishable from a clean result.
    const { rows: acl } = await client.query(
      `SELECT n.nspname, c.relname, c.relacl::text FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relacl::text LIKE '%' || $1 || '%'`, [roleName]
    );
    assert.deepEqual(acl, [], 'no ACL entry may survive the drop');
    const { rows: orphanSettings } = await client.query(
      'SELECT 1 FROM pg_db_role_setting s WHERE s.setrole NOT IN (SELECT oid FROM pg_roles)'
    );
    assert.deepEqual(orphanSettings, [], 'no orphaned per-role setting may survive the drop');
  });

  test('the granted role really can read the four tables and really cannot write', async (t) => {
    // The privileges are asserted as the ROLE, not about it. has_table_privilege
    // is the admin's opinion; an actual connection is the database's.
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const admin = await pool.connect();
    t.after(async () => { await releaseSafely(admin); await forceDrop(roleName); });
    await gate1.phaseCreate(admin, values, { log: () => {} });

    const asRole = roleClient(roleName);
    await asRole.connect();
    try {
      for (const table of gate1.EXPECTED_TABLES) {
        await assert.doesNotReject(() => asRole.query(`SELECT * FROM public.${table} LIMIT 0`),
          `the role must be able to read ${table}`);
      }
      await assert.doesNotReject(() => asRole.query("SELECT public.fn_normalize_nfl_team('KC')"));

      // The default is read-only, so even a permitted table refuses a write...
      await assert.rejects(() => asRole.query('INSERT INTO public.players (id) VALUES (-999)'),
        /read-only transaction|permission denied/);
      // ...and with the default turned off, which a client CAN do, the
      // privilege itself is what stops it. This is the distinction the SQL
      // comments make, checked rather than asserted.
      await asRole.query('SET default_transaction_read_only = off');
      await assert.rejects(() => asRole.query('INSERT INTO public.players (id) VALUES (-999)'),
        /permission denied/,
        'with the read-only default off, the missing INSERT privilege must still refuse');
      await assert.rejects(() => asRole.query('CREATE TABLE public.gate1_should_not_exist (x int)'),
        /permission denied/);
      // A table outside the four is not readable at all.
      const { rows: others } = await admin.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> ALL($1::text[])
         ORDER BY c.relname LIMIT 1`, [[...gate1.EXPECTED_TABLES]]
      );
      assert.ok(others.length === 1, 'the test database must have a fifth table to check against');
      await assert.rejects(() => asRole.query(`SELECT * FROM public.${others[0].relname} LIMIT 0`),
        /permission denied/, `the role must NOT be able to read ${others[0].relname}`);
      // Every rejection above is a QUERY rejection - a permission error leaves
      // the connection alive - so nothing here should have reached the client's
      // error event. If one did, the connection died for a reason this test is
      // not about, and the assertions above proved less than they appear to.
      // This cannot be made flaky by benign traffic: NOTICE/WARNING messages go
      // to the 'notice' event, never 'error', and an error DURING a query has
      // an active query to reject into (pg client.js:421-428 routes to the
      // error EVENT only when the client is idle). Do not relax it.
      assert.deepEqual(asRole.errors, [],
        'no connection-level error may occur while probing privileges');
    } finally {
      await asRole.end();
    }
  });

  test('verify FAILS when the role is given one extra grant', async (t) => {
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    t.after(async () => { await releaseSafely(client); await forceDrop(roleName); });
    await gate1.phaseCreate(client, values, { log: () => {} });

    // A fifth table, granted out of band - exactly the drift the enumeration
    // exists to catch, and exactly what a has_table_privilege check on the four
    // expected tables would sail straight past.
    const { rows: [extra] } = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> ALL($1::text[])
       ORDER BY c.relname LIMIT 1`, [[...gate1.EXPECTED_TABLES]]
    );
    assert.ok(extra, 'the test database must have a fifth table');
    await client.query(`GRANT SELECT ON public.${extra.relname} TO ${gate1.quoteIdent(roleName)}`);

    await assert.rejects(() => gate1.phaseVerify(client, values, { log: () => {} }),
      (err) => {
        assert.match(err.message, /relation privileges other than exactly 4 SELECTs/);
        assert.match(err.message, new RegExp(`public\\.${extra.relname}:SELECT`));
        return true;
      });

    // And once it is revoked, verify passes again - so the failure was the
    // extra grant, not something incidental about this role.
    await client.query(`REVOKE SELECT ON public.${extra.relname} FROM ${gate1.quoteIdent(roleName)}`);
    await assert.doesNotReject(() => gate1.phaseVerify(client, values, { log: () => {} }));
  });

  test('verify FAILS on a widened flag, a lost expiry, and a lost read-only default', async (t) => {
    const roleName = nextRole();
    const validUntil = futureIso(1);
    const values = valuesFor(roleName, validUntil);
    const client = await pool.connect();
    const ident = gate1.quoteIdent(roleName);
    t.after(async () => { await releaseSafely(client); await forceDrop(roleName); });
    await gate1.phaseCreate(client, values, { log: () => {} });

    // Each mutation is applied, asserted on, and reverted, so the checks are
    // shown to be independent rather than one failure masking the rest.
    const cases = [
      [`ALTER ROLE ${ident} CREATEDB`, /rolcreatedb is true, expected false/, `ALTER ROLE ${ident} NOCREATEDB`],
      [`ALTER ROLE ${ident} INHERIT`, /rolinherit is true, expected false/, `ALTER ROLE ${ident} NOINHERIT`],
      [`ALTER ROLE ${ident} CONNECTION LIMIT 10`, /rolconnlimit is 10, expected 1/,
        `ALTER ROLE ${ident} CONNECTION LIMIT 1`],
      [`ALTER ROLE ${ident} VALID UNTIL 'infinity'`, /the role never expires|not the supplied/,
        `ALTER ROLE ${ident} VALID UNTIL '${validUntil}'`],
      [`ALTER ROLE ${ident} VALID UNTIL '${futureIso(3)}'`, /not the supplied --valid-until/,
        `ALTER ROLE ${ident} VALID UNTIL '${validUntil}'`],
      [`ALTER ROLE ${ident} RESET default_transaction_read_only`,
        /default_transaction_read_only=on is not set/,
        `ALTER ROLE ${ident} SET default_transaction_read_only = on`],
      [`GRANT USAGE ON SCHEMA information_schema TO ${ident}`,
        /schema privileges are not exactly public:USAGE/,
        `REVOKE USAGE ON SCHEMA information_schema FROM ${ident}`],
      [`GRANT SELECT ON public.players TO ${ident} WITH GRANT OPTION`,
        /GRANTABLE: the role could pass its read access/,
        `REVOKE GRANT OPTION FOR SELECT ON public.players FROM ${ident}`],
    ];
    for (const [mutate, expected, revert] of cases) {
      await client.query(mutate);
      await assert.rejects(() => gate1.phaseVerify(client, values, { log: () => {} }), expected,
        `verify must catch: ${mutate}`);
      await client.query(revert);
      await assert.doesNotReject(() => gate1.phaseVerify(client, values, { log: () => {} }),
        `reverting ${mutate} must restore a clean verify`);
    }
  });

  test('verify catches a COLUMN grant, which relacl cannot see at all', async (t) => {
    // GRANT SELECT (col) writes pg_attribute.attacl and leaves pg_class.relacl
    // untouched, so the relation enumeration is blind to it. It is a real read
    // privilege on a table this role must not be able to read.
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    const ident = gate1.quoteIdent(roleName);
    t.after(async () => { await releaseSafely(client); await forceDrop(roleName); });
    await gate1.phaseCreate(client, values, { log: () => {} });

    const { rows: [other] } = await client.query(
      `SELECT c.relname, a.attname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> ALL($1::text[])
       ORDER BY c.relname, a.attnum LIMIT 1`, [[...gate1.EXPECTED_TABLES]]
    );
    assert.ok(other, 'the test database must have a fifth table with a column');

    // Proof that the relation enumeration really is blind to this: before the
    // fix, verify passed with the column grant in place.
    await client.query(
      `GRANT SELECT (${gate1.quoteIdent(other.attname)}) ON public.${other.relname} TO ${ident}`
    );
    const { rows: relacl } = await client.query(
      `SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
       WHERE c.relname = $1 AND c.relacl IS NOT NULL
         AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)`, [other.relname, roleName]
    );
    assert.deepEqual(relacl, [], 'a column grant leaves relacl empty, which is the whole problem');

    await assert.rejects(() => gate1.phaseVerify(client, values, { log: () => {} }),
      (err) => {
        assert.match(err.message, /COLUMN-level privileges, which are invisible/);
        assert.match(err.message, new RegExp(other.attname));
        return true;
      });

    // And the role really could read that column, so the check is not pedantry.
    const asRole = roleClient(roleName);
    await asRole.connect();
    try {
      await assert.doesNotReject(
        () => asRole.query(`SELECT ${gate1.quoteIdent(other.attname)} FROM public.${other.relname} LIMIT 0`),
        'the column grant is a real read privilege'
      );
      assert.deepEqual(asRole.errors, []);
    } finally { await asRole.end(); }

    await client.query(
      `REVOKE SELECT (${gate1.quoteIdent(other.attname)}) ON public.${other.relname} FROM ${ident}`
    );
    await assert.doesNotReject(() => gate1.phaseVerify(client, values, { log: () => {} }));
  });

  test('the real function has a NAMED parameter, and that must not break resolution', async (t) => {
    // THE CI DEFECT, pinned against the real catalog. fn_normalize_nfl_team is
    // declared `(raw_team text)`, so pg_get_function_identity_arguments renders
    // the parameter name. The first version of the preflight compared that
    // rendering against the literal 'text' and refused a correct database.
    const client = await pool.connect();
    t.after(() => releaseSafely(client));

    const { rows: [shape] } = await client.query(
      `SELECT pg_get_function_identity_arguments(p.oid) AS identity_arguments,
              to_regprocedure('public.fn_normalize_nfl_team(text)') IS NOT NULL AS resolves
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'fn_normalize_nfl_team'`
    );
    // If this ever stops being true the regression is gone and so is the test's
    // meaning, so assert the hazard itself rather than assuming it.
    assert.equal(shape.identity_arguments, 'raw_team text',
      'the identity rendering carries the parameter name - this is what broke CI');
    assert.notEqual(shape.identity_arguments, gate1.EXPECTED_FUNCTION.args,
      'a string comparison against EXPECTED_FUNCTION.args is exactly the defect');
    assert.equal(shape.resolves, true, 'to_regprocedure ignores the parameter name');
  });

  test('an ADDITIONAL overload confuses neither the preflight nor the enumeration', async (t) => {
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    t.after(async () => {
      // ROLLBACK first: on a failure path this connection may be mid- or
      // post-abort, in which case the DROP below would fail with 25P02 and be
      // swallowed, leaving the extra overload behind for every later test.
      await client.query('ROLLBACK').catch(() => {});
      await client.query('DROP FUNCTION IF EXISTS public.fn_normalize_nfl_team(integer)').catch(() => {});
      await releaseSafely(client);
      await forceDrop(roleName);
    });

    // A second overload of the same name. Everything that resolves by name
    // rather than by signature now has two candidates to choose wrongly from.
    await client.query(
      'CREATE FUNCTION public.fn_normalize_nfl_team(integer) RETURNS text LANGUAGE sql IMMUTABLE '
      + "AS $$ SELECT ''::text $$"
    );
    const log = [];
    await gate1.phaseCreate(client, values, { log: (m) => log.push(m) });

    // The grant landed on the TEXT overload, and on that one only.
    const { rows: granted } = await client.query(
      `SELECT p.oid = to_regprocedure('public.fn_normalize_nfl_team(text)') AS is_text_overload,
              pg_get_function_identity_arguments(p.oid) AS identity_arguments
       FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
       WHERE p.proacl IS NOT NULL
         AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)`, [roleName]
    );
    assert.equal(granted.length, 1, 'exactly one overload may be granted');
    assert.equal(granted[0].is_text_overload, true, 'and it must be the text one');
    assert.equal(granted[0].identity_arguments, 'raw_team text');

    // Verify agrees, with both overloads present the whole time.
    await assert.doesNotReject(() => gate1.phaseVerify(client, values, { log: () => {} }),
      'a second overload must not make a correct role look wrong');

    // And if the grant is moved to the WRONG overload, verify catches it - the
    // case a rendered-name comparison could never distinguish.
    await client.query(
      `REVOKE EXECUTE ON FUNCTION public.fn_normalize_nfl_team(text) FROM ${gate1.quoteIdent(roleName)}`
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION public.fn_normalize_nfl_team(integer) TO ${gate1.quoteIdent(roleName)}`
    );
    await assert.rejects(() => gate1.phaseVerify(client, values, { log: () => {} }),
      /not the expected overload: public\.fn_normalize_nfl_team\(integer\):EXECUTE/);

    await client.query(
      `REVOKE EXECUTE ON FUNCTION public.fn_normalize_nfl_team(integer) FROM ${gate1.quoteIdent(roleName)}`
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION public.fn_normalize_nfl_team(text) TO ${gate1.quoteIdent(roleName)}`
    );
    await assert.doesNotReject(() => gate1.phaseVerify(client, values, { log: () => {} }));

    // Teardown still works with the extra overload in place: its REVOKE targets
    // a signature, which is name-insensitive.
    assert.equal((await gate1.phaseTeardown(client, values, { log: () => {} })).tornDown, true);
  });

  test('a NON-superuser CREATEROLE operator gets the PG 16+ implicit creator-admin grant', async (t) => {
    // THE PRODUCTION FAILURE, reproduced. CI's operator is the bootstrap
    // superuser, and a superuser-created role gets no implicit grant, so no
    // test here could ever see the thing that stopped the real Gate 1 run. This
    // test manufactures the production shape: a non-superuser holding
    // CREATEROLE, which is exactly what Supabase's hosted `postgres` is.
    const operatorName = nextOperator();
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const admin = await pool.connect();
    const opIdent = gate1.quoteIdent(operatorName);
    let operator = null;
    t.after(async () => {
      if (operator) await operator.end();
      await releaseSafely(admin);
      await forceDrop(roleName);
      await forceDrop(operatorName);
    });

    await admin.query(
      `CREATE ROLE ${opIdent} LOGIN NOSUPERUSER CREATEROLE PASSWORD ${gate1.quoteLiteral(OPERATOR_PASSWORD)}`
    );
    // The operator must be able to make the grants create-role.sql issues, and a
    // bare CREATEROLE role owns none of these objects. WITH GRANT OPTION is the
    // narrow way to let it re-grant exactly what the kit grants, and nothing
    // else. In production the hosted `postgres` already has this standing.
    await admin.query(`GRANT CONNECT ON DATABASE ${gate1.quoteIdent(connection.database)} TO ${opIdent} WITH GRANT OPTION`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${opIdent} WITH GRANT OPTION`);
    await admin.query(
      `GRANT SELECT ON TABLE ${gate1.EXPECTED_TABLES.map((tbl) => `public.${tbl}`).join(', ')} `
      + `TO ${opIdent} WITH GRANT OPTION`
    );
    await admin.query(
      `GRANT EXECUTE ON FUNCTION public.fn_normalize_nfl_team(text) TO ${opIdent} WITH GRANT OPTION`
    );

    const { rows: [opShape] } = await admin.query(
      'SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = $1', [operatorName]
    );
    assert.deepEqual(opShape, { rolsuper: false, rolcreaterole: true },
      'the operator must match the production shape, or this test proves nothing');

    // Everything from here runs THROUGH the operator, exactly as Gate 1 does.
    operator = roleClient(operatorName, { password: OPERATOR_PASSWORD });
    await operator.connect();

    const created = capture();
    await gate1.phaseCreate(operator.client, values, { log: created.log });

    // The implicit grant appears, with the exact tuple the production probe saw.
    const { rows: membership } = await admin.query(
      `SELECT m.rolname AS member_name, g.oid AS grantor_oid, g.rolsuper AS grantor_is_superuser,
              am.admin_option, am.inherit_option, am.set_option
       FROM pg_auth_members am
       JOIN pg_roles m ON m.oid = am.member
       JOIN pg_roles g ON g.oid = am.grantor
       WHERE am.roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)`, [roleName]
    );
    assert.equal(membership.length, 1, 'PG 16+ grants the new role back to a CREATEROLE creator');
    assert.deepEqual(membership[0], {
      member_name: operatorName,
      grantor_oid: gate1.BOOTSTRAP_SUPERUSER_OID,
      grantor_is_superuser: true,
      admin_option: true,
      inherit_option: false,
      set_option: false,
    }, 'the tuple must match the one the production probe recorded');

    // The CLI's create phase is phaseCreate followed by phaseVerify on the
    // same log (see main in run-backtest-role.js); phaseCreate alone never
    // verifies. Run the same composition, so this asserts what an operator
    // actually sees from a real create run: verify passes WITH the allowance,
    // and says so.
    await gate1.phaseVerify(operator.client, values, { log: created.log });
    assert.match(created.text(), /allowed: the PostgreSQL 16\+ implicit creator-admin grant/);
    assert.match(created.text(), new RegExp(`${operatorName} holds ADMIN on this role`));

    // Standalone verify, through the operator, passes and logs the same line.
    const verified = capture();
    await gate1.phaseVerify(operator.client, values, { log: verified.log });
    assert.match(verified.text(), /allowed: the PostgreSQL 16\+ implicit creator-admin grant/);

    // A WIDENED grant is a different relationship and must fail. SET TRUE would
    // let the operator BECOME this role.
    await admin.query(`GRANT ${gate1.quoteIdent(roleName)} TO ${opIdent} WITH ADMIN TRUE, SET TRUE`);
    await assert.rejects(() => gate1.phaseVerify(operator.client, values, { log: () => {} }),
      /memberships beyond the implicit creator-admin grant/,
      'a SET-widened creator grant must not be tolerated');
    // Restore the implicit shape.
    await admin.query(`GRANT ${gate1.quoteIdent(roleName)} TO ${opIdent} WITH ADMIN TRUE, SET FALSE, INHERIT FALSE`);
    await assert.doesNotReject(() => gate1.phaseVerify(operator.client, values, { log: () => {} }));

    // A THIRD role holding membership is never the implicit grant.
    const thirdName = nextRole();
    t.after(async () => { await forceDrop(thirdName); });
    await admin.query(`CREATE ROLE ${gate1.quoteIdent(thirdName)}`);
    await admin.query(`GRANT ${gate1.quoteIdent(roleName)} TO ${gate1.quoteIdent(thirdName)}`);
    await assert.rejects(() => gate1.phaseVerify(operator.client, values, { log: () => {} }),
      /memberships beyond the implicit creator-admin grant/);
    // Teardown must abort on it too, and drop nothing.
    await assert.rejects(() => gate1.phaseTeardown(operator.client, values, { log: () => {} }),
      /ABORTED.*Nothing has been dropped/s);
    const { rows: survived } = await admin.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]
    );
    assert.equal(survived.length, 1, 'the role must survive an aborted teardown');
    await admin.query(`REVOKE ${gate1.quoteIdent(roleName)} FROM ${gate1.quoteIdent(thirdName)}`);

    // THE PREMISE OF THE NO-SWEEPER DESIGN, pinned rather than left in a
    // comment. The teardown has no DROP OWNED BY because this operator cannot
    // execute one: ADMIN OPTION authorizes DROP ROLE but confers none of the
    // role's privileges, and PG 16 removed the CREATEROLE shortcut that used to
    // permit it. If a future PostgreSQL quietly allows this, the design's
    // justification has changed and somebody should be told - a failing
    // assertion here is that signal, where prose would just rot.
    await assert.rejects(
      () => operator.query(`DROP OWNED BY ${gate1.quoteIdent(roleName)}`),
      (err) => {
        assert.match(err.message, /permission denied to drop objects/,
          'this is DropOwnedObjects own message, and the reason the sweeper was removed');
        assert.equal(err.code, '42501');
        return true;
      },
      'a non-superuser CREATEROLE operator must NOT be able to DROP OWNED BY a role it created'
    );
    // Confirm the MECHANISM, not just the symptom: ADMIN yes, privileges no.
    // pg_has_role(..., 'USAGE') is the has_privs_of_role test - the one
    // DROP OWNED BY gates on - and admin_option is read straight from the
    // catalog rather than through pg_has_role's MEMBER, whose meaning is tied
    // to SET ROLE in PG 16+ and would muddle the two halves being separated.
    const { rows: [power] } = await admin.query(
      `SELECT pg_has_role($1, $2, 'USAGE') AS has_privs_of_role,
              (SELECT am.admin_option
                 FROM pg_auth_members am
                 JOIN pg_roles m ON m.oid = am.member
                 JOIN pg_roles r ON r.oid = am.roleid
                WHERE m.rolname = $1 AND r.rolname = $2) AS admin_option`,
      [operatorName, roleName]
    );
    assert.deepEqual(power, { has_privs_of_role: false, admin_option: true },
      'the operator holds ADMIN on the role but NOT the privileges of it, which is exactly '
      + 'the gap DROP OWNED BY falls into and DROP ROLE does not');

    // And with only the implicit grant left, teardown SUCCEEDS through the
    // operator connection - the grant is tolerated, never revoked, and the DROP
    // removes it.
    const tornDown = capture();
    const result = await gate1.phaseTeardown(operator.client, values, { log: tornDown.log });
    assert.deepEqual(result, { tornDown: true, noop: false });
    assert.match(tornDown.text(), /allowed: the PostgreSQL 16\+ implicit creator-admin grant/);
    const { rows: gone } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    assert.equal(gone.length, 0, 'the role is dropped by its non-superuser creator');
    const { rows: leftover } = await admin.query(
      'SELECT 1 FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member WHERE m.rolname = $1',
      [operatorName]
    );
    assert.equal(leftover.length, 0, 'DROP ROLE removes the membership without an explicit revoke');
    assert.deepEqual(operator.errors, [], 'the operator connection must survive the whole lifecycle');
  });

  test('the teardown confirmation probes by CAPTURED OID, not a post-drop lookup', async (t) => {
    // Two of the three confirmations used to resolve the role through
    // `(SELECT oid FROM pg_roles WHERE rolname = ...)` and `usename`, both of
    // which go NULL the moment DROP ROLE succeeds - so they returned 0
    // regardless of the truth and confirmed nothing but their own phrasing.
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    t.after(async () => { await releaseSafely(client); await forceDrop(roleName); });
    await gate1.phaseCreate(client, values, { log: () => {} });

    const { rows: [before] } = await client.query(
      'SELECT oid FROM pg_roles WHERE rolname = $1', [roleName]
    );
    const oid = gate1.assertRoleOid(before.oid);

    // The post-drop lookup really is vacuous: run the OLD phrasing after the
    // drop and watch it report a clean zero for an OID that is still present in
    // pg_shdepend at the moment of asking.
    const { rows: shBefore } = await client.query(
      'SELECT count(*)::int AS n FROM pg_shdepend WHERE refobjid = $1', [oid]
    );
    assert.ok(shBefore[0].n > 0, 'the granted role has shdepend rows while it exists');

    await gate1.phaseTeardown(client, values, { log: () => {} });

    const { rows: vacuous } = await client.query(
      `SELECT (SELECT count(*)::int FROM pg_shdepend
                WHERE refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS old_phrasing,
              (SELECT count(*)::int FROM pg_shdepend WHERE refobjid = $2) AS captured_oid`,
      [roleName, oid]
    );
    assert.equal(vacuous[0].old_phrasing, 0,
      'the old phrasing returns 0 by construction, which is why it proved nothing');
    assert.equal(vacuous[0].captured_oid, 0, 'and the captured-OID probe agrees, this time meaningfully');
  });

  test('create FAILS when the role already exists, and changes nothing', async (t) => {
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    t.after(async () => { await releaseSafely(client); await forceDrop(roleName); });

    // A pre-existing role that is NOT what this kit would have made: superuser
    // -ish attributes the kit never grants. Adopting it would be the worst
    // possible outcome, because verify would then be asked to bless it.
    await client.query(`CREATE ROLE ${gate1.quoteIdent(roleName)} LOGIN CREATEDB CONNECTION LIMIT 5`);
    await assert.rejects(() => gate1.phaseCreate(client, values, { log: () => {} }),
      /ALREADY EXISTS.*never adopted/s);

    // Untouched: the pre-existing role keeps its own attributes, so the failure
    // really did happen before any DDL.
    const { rows: [role] } = await client.query(
      'SELECT rolcreatedb, rolconnlimit, rolvaliduntil FROM pg_roles WHERE rolname = $1', [roleName]
    );
    assert.equal(role.rolcreatedb, true);
    assert.equal(role.rolconnlimit, 5);
    assert.equal(role.rolvaliduntil, null);
    const { rows: grants } = await client.query(
      `SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
       WHERE c.relacl IS NOT NULL AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [roleName]
    );
    assert.equal(grants.length, 0, 'no grant was made to the pre-existing role');
  });

  test('create FAILS closed when an expected object is missing, before any DDL', async (t) => {
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    t.after(async () => {
      // This test deliberately runs inside explicit transactions, so a failed
      // assertion leaves one open by construction. releaseSafely rolls back
      // again and destroys the connection if it cannot.
      await client.query('ROLLBACK').catch(() => {});
      await releaseSafely(client);
      await forceDrop(roleName);
    });

    // Rename a required table inside a transaction that is rolled back, so the
    // preflight sees a database genuinely missing it without the test having to
    // damage the shared CI database.
    //
    // CONSTRAINT for future cases in this test: every case must fail during
    // PREFLIGHT. phaseCreate opens its own BEGIN for the mutating blocks; if a
    // case ever got past preflight while this client holds the outer
    // transaction, the inner COMMIT would commit the outer transaction too and
    // the ROLLBACK cleanup would be a no-op, leaving a renamed table in the
    // shared CI database. A case that must reach the DDL belongs in its own
    // test with its own cleanup, not here.
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.nfl_games RENAME TO nfl_games_gate1_tmp');
    await assert.rejects(() => gate1.phaseCreate(client, values, { log: () => {} }),
      /expected tables missing from public: nfl_games.*Nothing has been changed/s);
    await client.query('ROLLBACK');

    // Same for the function: a missing fn_normalize_nfl_team(text) means the
    // extraction could not join team keys the way production does. The message
    // must carry the overload listing, because that listing is what makes this
    // class of failure diagnosable.
    await client.query('BEGIN');
    await client.query('ALTER FUNCTION public.fn_normalize_nfl_team(text) RENAME TO fn_gate1_tmp');
    await assert.rejects(() => gate1.phaseCreate(client, values, { log: () => {} }),
      /fn_normalize_nfl_team\(text\) did not resolve \(overloads present: none\).*Nothing has been changed/s);
    await client.query('ROLLBACK');

    // A function of the right NAME but the wrong signature is still absent.
    await client.query('BEGIN');
    await client.query('ALTER FUNCTION public.fn_normalize_nfl_team(text) RENAME TO fn_gate1_tmp2');
    await client.query(
      'CREATE FUNCTION public.fn_normalize_nfl_team(integer) RETURNS text LANGUAGE sql IMMUTABLE '
      + "AS $$ SELECT ''::text $$"
    );
    await assert.rejects(() => gate1.phaseCreate(client, values, { log: () => {} }),
      /did not resolve \(overloads present: integer\)/,
      'the overload listing must name what WAS found, so the mismatch is obvious');
    await client.query('ROLLBACK');

    // And a VIEW where a table is expected: the grant would succeed, and would
    // widen the read surface to whatever the view selects from.
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.players RENAME TO players_gate1_tmp');
    await client.query('CREATE VIEW public.players AS SELECT * FROM public.players_gate1_tmp');
    await assert.rejects(() => gate1.phaseCreate(client, values, { log: () => {} }),
      /players is relkind v.*Granting SELECT on a view can widen the read surface/s);
    await client.query('ROLLBACK');

    const { rows } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    assert.equal(rows.length, 0, 'no role was created by any failed preflight');
  });

  test('teardown ABORTS when the role owns an object, and drops nothing', async (t) => {
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    const ident = gate1.quoteIdent(roleName);
    t.after(async () => {
      // ROLLBACK before the DROP: if the test failed mid-transaction the DROP
      // would fail with 25P02, get swallowed, and leave a table owned by a role
      // that forceDrop is then unable to remove.
      await client.query('ROLLBACK').catch(() => {});
      await client.query(`DROP TABLE IF EXISTS public.gate1_owned_${process.pid}`).catch(() => {});
      await releaseSafely(client);
      await forceDrop(roleName);
    });
    await gate1.phaseCreate(client, values, { log: () => {} });

    // The role comes to own a table. In production this would mean something
    // has gone wrong; the point is that the kit stops rather than deleting it.
    const owned = `gate1_owned_${process.pid}`;
    await client.query(`CREATE TABLE public.${owned} (x int)`);
    await client.query(`ALTER TABLE public.${owned} OWNER TO ${ident}`);

    await assert.rejects(() => gate1.phaseTeardown(client, values, { log: () => {} }),
      /ABORTED.*owns objects.*never auto-drops owned objects/s);

    // Nothing was dropped: not the table, not the role, not the grants.
    const { rows: table } = await client.query('SELECT 1 FROM pg_class WHERE relname = $1', [owned]);
    assert.equal(table.length, 1, 'the owned table must survive the aborted teardown');
    const { rows: role } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    assert.equal(role.length, 1, 'the role must survive the aborted teardown');

    // Once ownership is handed back, teardown proceeds normally - so the abort
    // was the ownership, not a permanent wedge.
    await client.query(`ALTER TABLE public.${owned} OWNER TO CURRENT_USER`);
    const result = await gate1.phaseTeardown(client, values, { log: () => {} });
    assert.equal(result.tornDown, true);
  });

  test('teardown ABORTS on a role membership in either direction', async (t) => {
    const roleName = nextRole();
    const otherName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    t.after(async () => {
      await releaseSafely(client);
      await forceDrop(roleName);
      await forceDrop(otherName);
    });
    await gate1.phaseCreate(client, values, { log: () => {} });
    await client.query(`CREATE ROLE ${gate1.quoteIdent(otherName)}`);

    // The role is granted membership of another: dropping it is fine, but its
    // privileges are no longer described by create-role.sql, so verify must
    // fail and teardown must stop for a human.
    await client.query(`GRANT ${gate1.quoteIdent(otherName)} TO ${gate1.quoteIdent(roleName)}`);
    await assert.rejects(() => gate1.phaseVerify(client, values, { log: () => {} }),
      /the role has role memberships/);
    await assert.rejects(() => gate1.phaseTeardown(client, values, { log: () => {} }),
      /ABORTED.*has role memberships.*Nothing has been dropped/s);
    await client.query(`REVOKE ${gate1.quoteIdent(otherName)} FROM ${gate1.quoteIdent(roleName)}`);

    // The other direction: somebody else has been given this role's login.
    await client.query(`GRANT ${gate1.quoteIdent(roleName)} TO ${gate1.quoteIdent(otherName)}`);
    await assert.rejects(() => gate1.phaseTeardown(client, values, { log: () => {} }),
      /ABORTED.*has role memberships/s);
    await client.query(`REVOKE ${gate1.quoteIdent(roleName)} FROM ${gate1.quoteIdent(otherName)}`);

    assert.equal((await gate1.phaseTeardown(client, values, { log: () => {} })).tornDown, true);
  });

  test('teardown on a role that does not exist is a clear no-op, not an error', async (t) => {
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const client = await pool.connect();
    t.after(() => releaseSafely(client));

    const first = capture();
    const result = await gate1.phaseTeardown(client, values, { log: first.log });
    assert.deepEqual(result, { tornDown: false, noop: true });
    assert.match(first.text(), /does not exist: nothing to tear down/);

    // Idempotent for real: create, tear down, tear down again.
    await gate1.phaseCreate(client, values, { log: () => {} });
    assert.equal((await gate1.phaseTeardown(client, values, { log: () => {} })).tornDown, true);
    const again = capture();
    assert.deepEqual(await gate1.phaseTeardown(client, values, { log: again.log }),
      { tornDown: false, noop: true });
    assert.match(again.text(), /nothing to tear down/);
  });

  test('teardown terminates the role own open session', async (t) => {
    // VALID UNTIL does not close a session that is already open, and DROP ROLE
    // does not either - it just fails or leaves the connection live. This is
    // the step that makes the credential actually temporary.
    //
    // The termination is therefore the BEHAVIOUR UNDER TEST, and the 57P01 the
    // driver raises for it is a signal to be asserted on, not an accident to be
    // survived. Getting that backwards is what broke this test in CI.
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const admin = await pool.connect();
    let session = null;
    // ONE cleanup hook, so the ordering is explicit rather than emergent from
    // hook-registration order. It awaits the same two things the body does, in
    // the same order: the role's client is shut down FIRST, and only then is the
    // admin connection handed back. Releasing the admin client while
    // phaseTeardown is still in flight is what poisoned the pool and made the
    // next test fail on an aborted transaction.
    t.after(async () => {
      if (session) await session.end();
      await releaseSafely(admin);
      await forceDrop(roleName);
    });
    await gate1.phaseCreate(admin, values, { log: () => {} });

    session = roleClient(roleName);
    await session.connect();
    await session.query('SELECT 1');
    // Registered BEFORE anything can terminate the session. If the watcher were
    // installed after phaseTeardown, the event would already have fired against
    // no listener and the process would be dead before the assertion ran.
    const terminated = session.waitForError();

    const { rows: before } = await admin.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1', [roleName]
    );
    assert.equal(before[0].n, 1, 'the role has one live session');

    const log = capture();
    await gate1.phaseTeardown(admin, values, { log: log.log });
    assert.match(log.text(), /terminated 1 open session/);

    // Await the termination, and assert it is the one PostgreSQL documents for
    // an administrative disconnect. teardown_terminate_sessions uses the
    // two-argument pg_terminate_backend(pid, 10000), which does not return until
    // the backend has actually exited, so by this point the socket is closed and
    // the event has been delivered to the listener installed above.
    const err = await terminated;
    assert.ok(err, 'terminating the backend must surface an error on the role client');
    assert.equal(err.code, '57P01',
      `expected 57P01 (admin_shutdown), got ${err.code}: ${err.message}`);
    assert.match(err.message, /terminating connection due to administrator command/);

    // Shut the role client down BEFORE touching the admin connection again.
    await session.end();
    session = null;

    const { rows: after } = await admin.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1', [roleName]
    );
    assert.equal(after[0].n, 0);
  });

  test('the accident guard refuses a database name that is not the connected one', async (t) => {
    const roleName = nextRole();
    const client = await pool.connect();
    t.after(async () => { await releaseSafely(client); await forceDrop(roleName); });
    const wrong = { ...valuesFor(roleName, futureIso(1)), databaseName: 'not_the_database' };

    // All three phases, including verify: it is meant to be run standalone days
    // later, from a shell that is not the one that created the role.
    for (const phase of [gate1.phaseCreate, gate1.phaseVerify, gate1.phaseTeardown]) {
      await assert.rejects(() => phase(client, wrong, { log: () => {} }),
        /connected to database .* but --database says "not_the_database"/);
    }
    const { rows } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    assert.equal(rows.length, 0, 'the guard fired before any DDL');
  });

  test('CONNECTION LIMIT 1 is real: a second simultaneous login is refused', async (t) => {
    // Not decoration. "One connection, one transaction, one snapshot" is a
    // property Gate 2's extraction relies on.
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const admin = await pool.connect();
    let first = null;
    // Cleanup shuts the role's own client down before the admin connection goes
    // back to the pool, same ordering discipline as the termination test.
    t.after(async () => {
      if (first) await first.end();
      await releaseSafely(admin);
      await forceDrop(roleName);
    });
    await gate1.phaseCreate(admin, values, { log: () => {} });

    first = roleClient(roleName);
    await first.connect();
    try {
      // The refusal arrives as a REJECTED CONNECT PROMISE, not an error event:
      // Client.connect() used as a promise installs a connection callback, and
      // node-postgres delivers a connect failure to that callback instead of
      // emitting. The listener roleClient attaches is inert insurance here, and
      // the assertion below proves it stayed inert.
      const second = roleClient(roleName);
      await assert.rejects(() => second.connect(), /too many connections for role/);
      assert.deepEqual(second.errors, [],
        'a refused connect must reject its promise, not raise an unhandled error event');
      await second.end();
      assert.deepEqual(first.errors, [],
        "the first session must be untouched by the second's refusal");
    } finally {
      await first.end();
      first = null;
    }
  });

  // -------------------------------------------------------------------------
  // The RLS amendment
  //
  // THE SECOND PRODUCTION FAILURE, reproduced. Gate 1 created the role, verify
  // proved all five grants, and Gate 2's extraction then read ZERO rows from
  // three of the four tables. Those tables carry relrowsecurity = true with no
  // policies, which is deny-all for every role but the owner, and the
  // application never noticed because it connects AS the owner. No JS test can
  // settle any of that: whether a SELECT privilege without a policy returns
  // rows is a claim about PostgreSQL.
  // -------------------------------------------------------------------------

  test('a valid SELECT grant reads ZERO rows under RLS, and the policy is what changes it', async (t) => {
    const ownerName = nextOwner();
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const admin = await pool.connect();
    let fixture = null;
    let owner = null;
    let asRole = null;
    t.after(async () => {
      if (asRole) await asRole.end();
      if (owner) await owner.end();
      if (fixture) await fixture.restore();
      await releaseSafely(admin);
      await forceDrop(roleName);
      await dropOwnerRole(ownerName);
    });

    await admin.query(
      `CREATE ROLE ${gate1.quoteIdent(ownerName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE `
      + `PASSWORD ${gate1.quoteLiteral(OWNER_ROLE_PASSWORD)}`
    );
    fixture = await installOwnedRlsFixture(admin, ownerName);

    // The fixture is the whole premise, so assert its shape rather than assume
    // it. These five columns are exactly what the production probe recorded.
    const { rows: shape } = await admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              pg_get_userbyid(c.relowner) AS owner,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        ORDER BY c.relname`, [[...gate1.EXPECTED_TABLES]]
    );
    assert.deepEqual(
      shape.map((r) => [r.relname, r.relrowsecurity, r.relforcerowsecurity, r.owner, r.policies]),
      [['nfl_games', true, false, ownerName, 0],
        ['player_season_stats', false, false, ownerName, 0],
        ['player_stats', true, false, ownerName, 0],
        ['players', true, false, ownerName, 0]],
      'the fixture must reproduce the probe: RLS on with ZERO policies on three of four, force off'
    );

    await gate1.phaseCreate(admin, values, { log: () => {} });

    // (1) THE FINDING. The grant is present and correct, and the role reads
    // nothing. has_table_privilege says yes; the database returns no rows.
    asRole = roleClient(roleName);
    await asRole.connect();
    for (const table of RLS_ENABLED_TABLES) {
      const { rows: [priv] } = await admin.query(
        'SELECT has_table_privilege($1, $2, $3) AS granted', [roleName, `public.${table}`, 'SELECT']
      );
      assert.equal(priv.granted, true, `${table}: the SELECT grant must really be there`);
      assert.ok(await fixture.countFor(admin, table) > 0, `${table}: the owner must see rows`);
      assert.equal(await fixture.countFor(asRole, table), 0,
        `${table}: RLS with no policy is deny-all, even with SELECT granted`);
    }
    // And the ONE table without RLS answers normally, from the same connection
    // with the same grant. That asymmetry is exactly what the dry run reported.
    const seasonStatsBefore = await fixture.countFor(asRole, 'player_season_stats');
    assert.equal(seasonStatsBefore, await fixture.countFor(admin, 'player_season_stats'));
    assert.ok(seasonStatsBefore > 0, 'the RLS-off table reads normally under the same grant');

    // Verify SAYS SO. This is the measurement whose absence let the original run
    // reach Gate 2 with an empty read surface and a clean report.
    const preGrant = capture();
    await gate1.phaseVerify(admin, values, { log: preGrant.log });
    assert.match(preGrant.text(),
      /players: rowsecurity=true, force=false, owner=.*RLS ON WITH NO KIT POLICY: the role reads ZERO rows/);
    assert.match(preGrant.text(), /player_season_stats: rowsecurity=false, force=false, .*RLS off/);
    assert.match(preGrant.text(), new RegExp(`no policy named ${values.policyName} exists yet`));

    // The ADMIN operator cannot fix it. In CI the admin is the bootstrap
    // superuser, which COULD create the policy - the kit refuses anyway, because
    // it resolves ownership from pg_class rather than inferring authority from a
    // role attribute, and in production the admin is not a superuser at all.
    await assert.rejects(() => gate1.phaseGrantPolicies(admin, values, { log: () => {} }),
      /does not own .*CREATE POLICY .*gated on table ownership/s,
      'the policy phases must refuse an operator that does not own the tables');

    // (2) The owner runs the grant phase, and the same read returns rows.
    owner = roleClient(ownerName, { password: OWNER_ROLE_PASSWORD });
    await owner.connect();
    const granted = capture();
    assert.deepEqual(await gate1.phaseGrantPolicies(owner.client, values, { log: granted.log }),
      { granted: true, noop: false });
    assert.match(granted.text(), new RegExp(`4 policies named ${values.policyName} created`));

    // The catalog tuple, read independently of the runner's own report. `qual`
    // is the one rendered-expression comparison in the kit, so pin the rendering
    // itself: if a future PostgreSQL deparses `USING (true)` as anything but
    // `true`, the grant phase would start failing closed against production and
    // this is where that has to surface first.
    const { rows: policies } = await admin.query(
      `SELECT c.relname, p.polname, p.polcmd, p.polpermissive,
              p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = $1)]::oid[] AS roles_exact,
              pg_get_expr(p.polqual, p.polrelid) AS qual,
              p.polwithcheck IS NULL AS no_with_check
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($2::text[])
        ORDER BY c.relname`, [roleName, [...gate1.EXPECTED_TABLES]]
    );
    assert.equal(policies.length, gate1.EXPECTED_TABLES.length, 'one policy per granted table');
    for (const row of policies) {
      assert.deepEqual({
        polname: row.polname, polcmd: row.polcmd, polpermissive: row.polpermissive,
        roles_exact: row.roles_exact, qual: row.qual, no_with_check: row.no_with_check,
      }, {
        polname: values.policyName, polcmd: 'r', polpermissive: true,
        roles_exact: true, qual: 'true', no_with_check: true,
      }, `${row.relname}: the policy must be exactly what grant-rls-policies.sql says`);
    }

    for (const table of RLS_ENABLED_TABLES) {
      assert.equal(await fixture.countFor(asRole, table), await fixture.countFor(admin, table),
        `${table}: the policy must admit the role to every row the owner can see`);
    }
    // (3) The dormant policy on the RLS-off table changes NOTHING. PostgreSQL
    // consults policies only when relrowsecurity is on, which is why creating it
    // there is free and why leaving it out would make a later flip silent.
    assert.equal(await fixture.countFor(asRole, 'player_season_stats'), seasonStatsBefore,
      'a policy on a table with RLS off is inert: same rows before and after');

    const postGrant = capture();
    await gate1.phaseVerify(admin, values, { log: postGrant.log });
    assert.match(postGrant.text(), /players: rowsecurity=true, force=false, .*RLS on, and the kit policy admits the role/);
    assert.equal(postGrant.text().includes('ZERO rows'), false);

    // Re-running the grant is a clean no-op, not a duplicate-object error.
    assert.deepEqual(await gate1.phaseGrantPolicies(owner.client, values, { log: () => {} }),
      { granted: false, noop: true });

    // (4) TEARDOWN IS REFUSED while the policies stand, twice over. First by the
    // kit, with a message that names the phase and the operator that fixes it.
    await assert.rejects(() => gate1.phaseTeardown(admin, values, { log: () => {} }),
      (err) => {
        assert.match(err.message, /ABORTED.*Nothing has been dropped/s);
        assert.match(err.message, /RLS POLICIES naming the role/);
        assert.match(err.message, /--phase drop-policies/);
        return true;
      });
    const { rows: survived } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    assert.equal(survived.length, 1, 'the role must survive an aborted teardown');

    // And then by the SERVER, which is the authority the kit relies on rather
    // than reimplements. This is a raw DROP ROLE, past every check the kit
    // makes, and its refusal is the passing assertion. If a future PostgreSQL
    // stopped refusing, the ordering the drop-policies phase depends on would
    // have quietly become a convention, and somebody should be told.
    await assert.rejects(() => admin.query(`DROP ROLE ${gate1.quoteIdent(roleName)}`),
      (err) => {
        assert.equal(err.code, '2BP01',
          `expected 2BP01 (dependent_objects_still_exist), got ${err.code}: ${err.message}`);
        assert.match(err.message, /cannot be dropped because some objects depend on it/);
        const detail = String(err.detail || '');
        assert.match(detail, /policy/i, 'the DETAIL must name the policies among the blockers');
        assert.ok(detail.includes(values.policyName),
          `the DETAIL must name ${values.policyName}; got ${JSON.stringify(detail)}`);
        return true;
      });

    // (5) Drop the policies, then the teardown completes clean.
    const dropped = capture();
    assert.deepEqual(await gate1.phaseDropPolicies(owner.client, values, { log: dropped.log }),
      { dropped: true, noop: false });
    assert.match(dropped.text(), /dropped, and confirmed absent/);
    assert.deepEqual(await gate1.phaseDropPolicies(owner.client, values, { log: () => {} }),
      { dropped: false, noop: true }, 'dropping policies that are gone is a no-op, not an error');

    // RLS itself is untouched: the tables arrived with it enabled and leave with
    // it enabled. Neither policy file contains an ALTER TABLE, and this is where
    // that claim meets a real catalog.
    const { rows: stillOn } = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
          AND c.relrowsecurity AND NOT c.relforcerowsecurity
        ORDER BY c.relname`, [RLS_ENABLED_TABLES]
    );
    assert.deepEqual(stillOn.map((r) => r.relname), [...RLS_ENABLED_TABLES].sort(),
      'dropping the policies must not disable, enable or force row-level security');
    assert.equal(await fixture.countFor(asRole, 'players'), 0,
      'and the role is back to reading nothing, which is the state teardown is for');
    assert.deepEqual(asRole.errors, [], 'no connection-level error may occur while probing visibility');

    await asRole.end();
    asRole = null;
    assert.equal((await gate1.phaseTeardown(admin, values, { log: () => {} })).tornDown, true);
    const { rows: gone } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    assert.equal(gone.length, 0, 'the role is dropped once nothing depends on it');
    assert.deepEqual(owner.errors, [], 'the owner connection must survive the whole sequence');
  });

  test('a same-named policy of the WRONG shape aborts the grant phase, and is never dropped', async (t) => {
    // The dangerous case: the row that anything matching on the NAME alone would
    // adopt as its own, or delete. It is never adopted and never replaced,
    // because nothing in grant-rls-policies.sql describes what it permits.
    const ownerName = nextOwner();
    const roleName = nextRole();
    const values = valuesFor(roleName, futureIso(1));
    const admin = await pool.connect();
    let fixture = null;
    let owner = null;
    t.after(async () => {
      if (owner) await owner.end();
      if (fixture) await fixture.restore();
      await releaseSafely(admin);
      await forceDrop(roleName);
      await dropOwnerRole(ownerName);
    });

    await admin.query(
      `CREATE ROLE ${gate1.quoteIdent(ownerName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE `
      + `PASSWORD ${gate1.quoteLiteral(OWNER_ROLE_PASSWORD)}`
    );
    fixture = await installOwnedRlsFixture(admin, ownerName);
    await gate1.phaseCreate(admin, values, { log: () => {} });

    owner = roleClient(ownerName, { password: OWNER_ROLE_PASSWORD });
    await owner.connect();

    // The kit's name, the kit's role, and a ROW PREDICATE. A snapshot taken
    // through this would be a filtered copy of production with nothing in the
    // extraction to say so.
    await owner.query(
      `CREATE POLICY ${gate1.quoteIdent(values.policyName)} ON public.players `
      + `AS PERMISSIVE FOR SELECT TO ${gate1.quoteIdent(roleName)} USING (id < 0)`
    );
    await assert.rejects(() => gate1.phaseGrantPolicies(owner.client, values, { log: () => {} }),
      /exists in a DIFFERENT shape.*Nothing has been changed/s);

    // The other three tables were not touched: the abort is before any BEGIN.
    const named = async () => (await admin.query(
      `SELECT c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY c.relname`,
      [[...gate1.EXPECTED_TABLES]]
    )).rows.map((r) => r.relname);
    assert.deepEqual(await named(), ['players'],
      'the abort must leave the other three tables with no policy at all');

    // Verify fails on it too, and for the same reason.
    await assert.rejects(() => gate1.phaseVerify(admin, values, { log: () => {} }),
      /exists in a DIFFERENT shape/);

    // And the drop phase will not delete it either. Deleting a policy this kit
    // did not create would destroy the evidence of whatever made it.
    await assert.rejects(() => gate1.phaseDropPolicies(owner.client, values, { log: () => {} }),
      /exists in a DIFFERENT shape/);
    assert.deepEqual(await named(), ['players'], 'the impostor must survive the refused drop');

    // Removed by hand, deliberately, which is the only route there is. The grant
    // phase then proceeds normally, so the abort was the shape and not a wedge.
    await owner.query(`DROP POLICY ${gate1.quoteIdent(values.policyName)} ON public.players`);
    assert.equal((await gate1.phaseGrantPolicies(owner.client, values, { log: () => {} })).granted, true);
    assert.deepEqual(await named(), [...gate1.EXPECTED_TABLES].sort());
    await assert.doesNotReject(() => gate1.phaseVerify(admin, values, { log: () => {} }));

    assert.equal((await gate1.phaseDropPolicies(owner.client, values, { log: () => {} })).dropped, true);
    assert.equal((await gate1.phaseTeardown(admin, values, { log: () => {} })).tornDown, true);
    assert.deepEqual(owner.errors, []);
  });
}
