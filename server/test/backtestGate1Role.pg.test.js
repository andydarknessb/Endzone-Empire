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
  });

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

  /** Drop a role unconditionally, for cleanup. Never used as the test's teardown. */
  async function forceDrop(roleName) {
    const client = await pool.connect();
    try {
      // The connection may arrive poisoned from an earlier failure: the pool
      // hands it back exactly as it was left. Clear it BEFORE the drops, or both
      // of them fail with 25P02, get swallowed by the catches below, and this
      // helper silently does nothing while reporting success.
      await client.query('ROLLBACK').catch(() => {});
      await client.query(`DROP OWNED BY ${gate1.quoteIdent(roleName)}`).catch(() => {});
      await client.query(`DROP ROLE IF EXISTS ${gate1.quoteIdent(roleName)}`).catch(() => {});
    } finally {
      await releaseSafely(client);
    }
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
    const { rows } = await pool.query(
      'SELECT rolname FROM pg_roles WHERE rolname LIKE $1', [`${ROLE_PREFIX}%`]
    );
    for (const row of rows) await forceDrop(row.rolname);
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
    // a signature, which is name-insensitive, and DROP OWNED BY sweeps the rest.
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
}
