/**
 * Gate 1 role kit: the checks that need no database.
 *
 * Everything here is about the boundary between an operator's input and a
 * statement that mutates production privileges. The lifecycle itself - does the
 * role actually come out with these flags, does verify actually catch an extra
 * grant - is in backtestGate1Role.pg.test.js, against a real Postgres, because
 * a JS test asserting on JS would only prove the runner agrees with itself.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gate1 = require('../scripts/run-backtest-role');

const SQL_DIR = path.join(__dirname, '..', 'scripts', 'gate1');
const readSql = (name) => fs.readFileSync(path.join(SQL_DIR, name), 'utf8');

/**
 * Strip `--` comments, so the assertions below read what EXECUTES rather than
 * what is explained. This matters more than it sounds: create-role.sql
 * deliberately spells out `GRANT SELECT ON ALL TABLES IN SCHEMA public` in a
 * comment, to say that it is not doing that. A prose-blind check would report
 * the warning as the danger. No statement in the kit contains a string literal
 * with `--` inside it, which is what would make this naive stripper wrong.
 */
const sqlOnly = (text) => text.replace(/--[^\n]*/g, '');

/**
 * EVERY `c.relname IN (...)` list in a statement, each sorted. Empty when the
 * statement scopes itself to no table list at all.
 *
 * Two things this is shaped for. Every check on these lists used to be an
 * INCLUSION check - "does it name players?" - and a fifth table added to all of
 * them left the whole suite passing, so callers need the list itself to compare
 * exactly. And it collects ALL the lists rather than the first, because a
 * statement with a second `OR c.relname IN (...)` appended is a widened read
 * that a first-match parser would never see; a caller comparing against a
 * one-element array of lists rejects that by construction.
 */
const scopedTableLists = (sql) => [...sql.matchAll(/c\.relname IN \(([^)]*)\)/g)]
  .map((m) => m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort());

const VALUES = {
  roleName: 'backtest_ro_pit01',
  databaseName: 'endzone_empire',
  validUntil: '2026-08-06T00:00:00Z',
  passwordVerifier: 'SCRAM-SHA-256$4096:abc$def:ghi',
  roleOid: '16471',
  policyName: 'backtest_ro_pit01_select',
};

/** Every .sql file in the kit, so a new one cannot skip the shared pins below. */
const SQL_FILES = ['create-role.sql', 'verify-role.sql', 'teardown-role.sql',
  'grant-rls-policies.sql', 'drop-rls-policies.sql'];

// ---------------------------------------------------------------------------
// Row-level security fixtures
//
// Modelled on the production probe of 2026-07-30, not on a tidy invention:
// players, player_stats and nfl_games carry relrowsecurity = true with zero
// policies, player_season_stats carries false, all four are relforcerowsecurity
// = false and owned by the application role. That combination is what made a
// role with five correct grants read zero rows from three of four tables.
// ---------------------------------------------------------------------------

const POLICY_NAME = 'backtest_ro_pit01_select';
const TABLE_OIDS = Object.freeze({
  nfl_games: 20001, player_season_stats: 20002, player_stats: 20003, players: 20004,
});
/** EXPECTED_TABLES, in the order the SQL's `ORDER BY c.relname` returns them. */
const TABLES_IN_ORDER = [...gate1.EXPECTED_TABLES].sort();

/** The four granted tables. `overrides` is keyed by table name. */
const productionTables = (overrides = {}) => TABLES_IN_ORDER.map((name) => ({
  table_oid: TABLE_OIDS[name],
  schema_name: 'public',
  table_name: name,
  table_kind: 'r',
  table_owner: 'endzone_app',
  owner_is_connected_role: true,
  row_security_enabled: name !== 'player_season_stats',
  row_security_forced: false,
  ...(overrides[name] || {}),
}));

/** One kit policy per table, in exactly the shape grant-rls-policies.sql makes. */
const kitPolicies = (overrides = {}) => TABLES_IN_ORDER.map((name, i) => ({
  policy_oid: 30001 + i,
  table_oid: TABLE_OIDS[name],
  schema_name: 'public',
  table_name: name,
  policy_name: POLICY_NAME,
  policy_command: 'r',
  policy_permissive: true,
  roles_are_exactly_the_role: true,
  applies_to_public: false,
  policy_roles: ['backtest_ro_pit01'],
  using_is_unconditional: true,
  using_expression: 'true',
  has_no_with_check: true,
  ...(overrides[name] || {}),
}));

/** The pg_shdepend rows the kit's own policies produce once they exist. */
const kitPolicyDependencies = () => kitPolicies().map((p) => ({
  dependency_type: 'r',
  catalog_name: 'pg_policy',
  object_oid: p.policy_oid,
  database_name: 'endzone_empire',
  is_policy_dependency: true,
  policy_name: p.policy_name,
  policy_schema: 'public',
  policy_table: p.table_name,
}));

// ---------------------------------------------------------------------------
// The SCRAM verifier: pinned to the published RFC 7677 vector
// ---------------------------------------------------------------------------

test('the SCRAM-SHA-256 verifier reproduces the RFC 7677 test vector', () => {
  const crypto = require('node:crypto');
  // RFC 7677 section 3: username "user", password "pencil", i=4096, and this
  // salt. The RFC publishes the resulting ClientProof and ServerSignature but
  // not StoredKey/ServerKey directly, so the check reconstructs both published
  // values FROM the verifier this code produces. That tests the derivation
  // against an outside authority rather than against itself: a wrong StoredKey
  // cannot produce the RFC's proof, and a wrong ServerKey cannot produce its
  // signature.
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const verifier = gate1.scramVerifier('pencil', { iterations: 4096, salt });

  const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
  assert.ok(match, `verifier is not in PostgreSQL's stored format: ${verifier}`);
  const [, iterations, saltB64, storedKeyB64, serverKeyB64] = match;
  assert.equal(iterations, '4096');
  assert.equal(saltB64, 'W22ZaJ0SNY7soEsUEjb6gQ==');

  const authMessage = 'n=user,r=rOprNGfwEbeRWgbNEkqO'
    + ',r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096'
    + ',c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';

  // ClientKey is recomputed independently here (the verifier stores only its
  // hash), then ClientProof = ClientKey XOR HMAC(StoredKey, AuthMessage).
  const saltedPassword = crypto.pbkdf2Sync(Buffer.from('pencil', 'utf8'), salt, 4096, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = Buffer.from(storedKeyB64, 'base64');
  assert.deepEqual(storedKey, crypto.createHash('sha256').update(clientKey).digest(),
    'StoredKey must be SHA256(ClientKey)');
  const clientSignature = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
  const clientProof = Buffer.from(clientKey.map((b, i) => b ^ clientSignature[i]));
  assert.equal(clientProof.toString('base64'), 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
    'the RFC 7677 published ClientProof');

  const serverSignature = crypto.createHmac('sha256', Buffer.from(serverKeyB64, 'base64'))
    .update(authMessage).digest();
  assert.equal(serverSignature.toString('base64'), '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
    'the RFC 7677 published ServerSignature');
});

test('the verifier is randomly salted, and refuses a weakened iteration count', () => {
  // Two calls with the same password must differ, or the salt is not a salt.
  const a = gate1.scramVerifier('a-long-enough-password-x');
  const b = gate1.scramVerifier('a-long-enough-password-x');
  assert.notEqual(a, b, 'each verifier gets a fresh random salt');
  assert.ok(a.startsWith(`SCRAM-SHA-256$${gate1.SCRAM_ITERATIONS}:`));
  // 16 random bytes is 24 base64 characters.
  assert.equal(/^SCRAM-SHA-256\$\d+:([^$]+)\$/.exec(a)[1].length, 24);

  assert.throws(() => gate1.scramVerifier('x'.repeat(30), { iterations: 1 }), /at least 4096/);
  assert.throws(() => gate1.scramVerifier('x'.repeat(30), { iterations: 4095 }), /at least 4096/);
  assert.throws(() => gate1.scramVerifier(''), /a password is required/);
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

test('the password, the verifier and the admin URL are redacted from every string', () => {
  const password = 'S3cr3t-p4ssw0rd-not-in-logs';
  const verifier = gate1.scramVerifier(password);
  const url = 'postgres://admin:S3cr3t-p4ssw0rd-not-in-logs@db.example.com:5432/endzone_empire';
  const redact = gate1.makeRedactor([password, verifier, url, password]);

  // The realistic leak is a driver error quoting the statement it failed on.
  const leak = `create: statement create_role failed: syntax error at or near "x"\n`
    + `CREATE ROLE "backtest_ro_x" PASSWORD '${verifier}';\nconnecting to ${url}`;
  const clean = redact(leak);
  assert.equal(clean.includes(password), false, 'the password must not survive');
  assert.equal(clean.includes(verifier), false, 'the verifier must not survive');
  assert.equal(clean.includes(url), false, 'the admin URL must not survive');
  assert.match(clean, /\[REDACTED\]/);
  // The non-secret part still has to be readable, or redaction has destroyed
  // the diagnostic it was protecting.
  assert.match(clean, /syntax error at or near/);
  assert.match(clean, /backtest_ro_x/);

  // The longest secret is replaced first, so the URL does not leave a
  // half-redacted fragment of the password behind.
  assert.equal(redact(url), '[REDACTED]');
  // Non-strings and empties are handled rather than thrown on: this runs on
  // error paths, where the input is whatever went wrong.
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
  assert.equal(redact(12345), '12345');
  // Short strings are ignored, or the output would be shredded into uselessness.
  assert.equal(gate1.makeRedactor(['ab'])('a table'), 'a table');
});

// ---------------------------------------------------------------------------
// Credentials are environment-only
// ---------------------------------------------------------------------------

test('a mistyped command NEVER prints the password, on any of the four paths', async () => {
  // Every one of these was a REAL cleartext leak, demonstrated by a review. The
  // redactor used to be constructed after argv parsing and validation, so the
  // messages that rejected a mis-typed argument echoed it verbatim - and the
  // top-level handler printed err.stack raw.
  const PASSWORD = 'P4ssw0rd-LEAK-CANARY-abcdefgh';
  const ADMIN_PW = 'AdminP4ss-CANARY-xyz';
  const env = {
    BACKTEST_RO_ROLE_PASSWORD: PASSWORD,
    BACKTEST_ADMIN_DATABASE_URL: `postgres://admin:${ADMIN_PW}@db.example.com/endzone_empire`,
  };
  const ok = ['--phase', 'create', '--database', 'endzone_empire', '--role', 'backtest_ro_x',
    '--valid-until', '2026-08-02T00:00:00Z'];
  const swap = (flag, value) => ok.map((t, i) => (ok[i - 1] === flag ? value : t));

  const paths = {
    'as a stray positional argument': [...ok, PASSWORD],
    'mis-ordered into --role': swap('--role', PASSWORD),
    'mis-ordered into --database': swap('--database', PASSWORD),
    'mis-ordered into --valid-until': swap('--valid-until', PASSWORD),
  };
  for (const [how, argv] of Object.entries(paths)) {
    let error = null;
    await gate1.main(argv, { env, out: { log: () => {} } }).catch((err) => { error = err; });
    assert.ok(error, `${how}: expected a rejection`);
    // Message AND stack: the entry point prints `err.stack || err.message`.
    for (const [what, text] of [['message', error.message], ['stack', error.stack || '']]) {
      assert.equal(text.includes(PASSWORD), false, `${how}: the password leaked in the ${what}`);
      assert.equal(text.includes(ADMIN_PW), false, `${how}: the admin password leaked in the ${what}`);
    }
    // And the message still has to be useful, or "redacted" just means "broken".
    assert.match(error.message, /--role|--database|--valid-until|unrecognised argument/,
      `${how}: the operator must still learn which argument was wrong`);
  }

  // The positional path is covered TWICE over, and the second cover is the one
  // that matters: redactArgument describes the token by length, so it holds
  // even when the password was typed on argv and never exported, which is a
  // secret the redactor has never been told about and cannot know.
  let bare = null;
  await gate1.main([...ok, PASSWORD], { env: {}, out: { log: () => {} } })
    .catch((err) => { bare = err; });
  assert.ok(bare);
  assert.equal(bare.message.includes(PASSWORD), false,
    'an unexported password typed as a positional must still not be echoed');
  assert.match(bare.message, /<redacted 29-character non-flag argument>/);
});

test('an ADMIN CONNECTION STRING pasted into the wrong argument does not leak either', () => {
  // The other half of the mis-ordering hazard. The password is what an operator
  // typing the Gate 1 sequence has most recently exported, but the admin URL is
  // what they most recently COPIED, and it carries a credential that can create
  // roles. Both must be in the redactor before argv is parsed.
  const ADMIN_PW = 'AdminP4ss-CANARY-xyz';
  const url = `postgres://admin:${ADMIN_PW}@db.example.com/endzone_empire`;
  const env = { BACKTEST_ADMIN_DATABASE_URL: url, BACKTEST_RO_ROLE_PASSWORD: 'x'.repeat(30) };
  const ok = ['--phase', 'verify', '--database', 'endzone_empire', '--role', 'backtest_ro_x',
    '--valid-until', '2026-08-02T00:00:00Z'];
  const swap = (flag, value) => ok.map((t, i) => (ok[i - 1] === flag ? value : t));

  return Promise.all(['--role', '--database', '--valid-until'].map(async (flag) => {
    let error = null;
    await gate1.main(swap(flag, url), { env, out: { log: () => {} } })
      .catch((err) => { error = err; });
    assert.ok(error, `${flag}: expected a rejection`);
    for (const text of [error.message, error.stack || '']) {
      assert.equal(text.includes(ADMIN_PW), false, `${flag}: the admin password leaked`);
      assert.equal(text.includes(url), false, `${flag}: the whole admin URL leaked`);
    }
  }));
});

test('a driver error quoting the CREATE ROLE statement comes back with NO verifier', (t) => {
  // dbSsl.sslForConnection reads the real process.env rather than an injected
  // one, so reaching the pool at all means setting a CA here. Restored
  // immediately; node --test gives each FILE its own process, and tests within
  // a file run in order, so the window is this test only.
  const priorCa = process.env.DB_SSL_CA;
  process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\nnot-a-real-ca\n-----END CERTIFICATE-----';
  t.after(() => {
    if (priorCa === undefined) delete process.env.DB_SSL_CA; else process.env.DB_SSL_CA = priorCa;
  });
  // The realistic verifier leak: node-postgres raises, something upstream
  // attaches the failing statement, and CREATE ROLE's statement contains the
  // SCRAM verifier. This drives the whole of main with a fake pool so the
  // registration of the verifier - which happens after the redactor is built -
  // is proven rather than assumed.
  const password = 'Kq7-vZ2mR9tB4xN6wL1cJ8sH0dF3gY5a';
  let sawVerifier = null;
  const createPool = () => ({
    connect: async () => ({
      query: async (text) => {
        const sql = String(text);
        const found = /SCRAM-SHA-256\$[^']+/.exec(sql);
        if (found) {
          sawVerifier = found[0];
          // Exactly what a driver does: echo the statement it choked on. The
          // verifier ALSO rides in DETAIL and HINT here: runBlock now appends
          // both to the message, so if a server ever echoed statement text
          // through them, this is the path it would take into the error. The
          // redaction of that path is pinned below, not inferred from the
          // message-only case.
          const err = new Error(`syntax error at or near "x"\nSTATEMENT: ${sql}`);
          err.detail = `offending statement was ${sql}`;
          err.hint = `verifier ${found[0]} is malformed`;
          throw err;
        }
        // Enough preflight to reach CREATE ROLE, which is the only statement
        // that carries the verifier.
        if (sql.includes('current_database()')) {
          return { rows: [{ database_name: 'endzone_empire', admin_role: 'admin',
            admin_is_superuser: true, admin_can_create_role: true }] };
        }
        if (sql.includes("c.relname IN ('players'")) {
          return { rows: gate1.EXPECTED_TABLES.map((t) => ({ schema_name: 'public',
            object_name: t, object_kind: 'r' })) };
        }
        if (sql.includes('to_regprocedure')) {
          // Modelled on the REAL database: the parameter is named, so the
          // identity rendering is "raw_team text" and never "text". A fake that
          // returned the tidy form would re-hide the defect that broke CI.
          return { rows: [{ function_resolved: true,
            resolved_signature: 'fn_normalize_nfl_team(text)',
            overloads_present: ['raw_team text'] }] };
        }
        return { rows: [] }; // role absent, and every other lookup empty
      },
      release: () => {},
    }),
    end: async () => {},
  });
  const env = {
    BACKTEST_RO_ROLE_PASSWORD: password,
    BACKTEST_ADMIN_DATABASE_URL: 'postgres://admin:AdminP4ss-CANARY-xyz@db.example.com/endzone_empire',
    DB_SSL_CA: '-----BEGIN CERTIFICATE-----\nnot-a-real-ca\n-----END CERTIFICATE-----',
    NODE_ENV: 'production',
  };
  return gate1.main(['--phase', 'create', '--database', 'endzone_empire',
    '--role', 'backtest_ro_pit01', '--valid-until', '2026-08-02T00:00:00Z'],
  { env, out: { log: () => {} }, createPool }).then(
    () => assert.fail('the fake driver was supposed to raise'),
    (err) => {
      assert.ok(sawVerifier, 'the fake driver never saw a CREATE ROLE with a verifier in it');
      assert.match(sawVerifier, /^SCRAM-SHA-256\$4096:/);
      for (const [what, text] of [['message', err.message], ['stack', err.stack || '']]) {
        assert.equal(text.includes(sawVerifier), false, `the verifier leaked in the ${what}`);
        assert.equal(text.includes(password), false, `the password leaked in the ${what}`);
        assert.equal(text.includes('AdminP4ss-CANARY-xyz'), false, `the admin password leaked in the ${what}`);
      }
      assert.match(err.message, /syntax error at or near/, 'the diagnostic must survive redaction');
      assert.match(err.message, /DETAIL: offending statement was/,
        'the DETAIL channel must actually be exercised, or this pin is vacuous');
      assert.match(err.message, /HINT: verifier \[REDACTED\] is malformed/,
        'HINT survives with the verifier redacted, proving redaction covers the appended fields');
    }
  );
});

test('redactArgument echoes flag names and describes everything else by length', () => {
  assert.equal(gate1.redactArgument('--phase'), '--phase');
  assert.equal(gate1.redactArgument('--valid-until'), '--valid-until');
  assert.match(gate1.redactArgument('postgres://u:p@h/db'), /^<redacted 19-character non-flag argument>$/);
  assert.match(gate1.redactArgument('hunter2'), /^<redacted 7-character non-flag argument>$/);
  // Not a recognised flag SHAPE, so not echoed: `--Weird=thing` could carry a
  // value after the equals sign.
  assert.match(gate1.redactArgument('--Weird=thing'), /^<redacted/);
  assert.match(gate1.redactArgument('--phase=create'), /^<redacted/);
  assert.match(gate1.redactArgument(''), /^<redacted 0-character/);
  assert.match(gate1.redactArgument(null), /^<redacted 0-character/);
});

test('the redactor accepts secrets discovered after it is built', () => {
  // This is what lets it be constructed before argv is parsed: the SCRAM
  // verifier does not exist until part-way through a run.
  const redact = gate1.makeRedactor(['first-secret-value']);
  assert.equal(redact('a first-secret-value b'), 'a [REDACTED] b');
  assert.equal(redact('a second-secret-value b'), 'a second-secret-value b');
  redact.add('second-secret-value');
  assert.equal(redact('a second-secret-value b'), 'a [REDACTED] b');
  // Still longest-first after a late addition, so a URL added after its own
  // password does not leave a half-redacted fragment.
  const late = gate1.makeRedactor(['hunter2xxxxxxxx']);
  late.add('postgres://admin:hunter2xxxxxxxx@db/x');
  assert.equal(late('postgres://admin:hunter2xxxxxxxx@db/x'), '[REDACTED]');
  assert.equal(redact.add('short'), redact, 'add is chainable and ignores short strings');
  assert.equal(redact('short'), 'short');
  assert.equal(gate1.makeRedactor()('anything'), 'anything', 'the secret list is optional');
});

test('--print-sql needs NO credentials at all', async () => {
  // A reviewer asked to approve a production privilege change must be able to
  // render the exact SQL without holding the admin password. Requiring one
  // would either block the review or push people into exporting production
  // credentials they do not need.
  for (const phase of ['create', 'verify', 'teardown']) {
    const lines = [];
    const argv = ['--phase', phase, '--database', 'endzone_empire', '--role', 'backtest_ro_pit01',
      '--print-sql', ...(phase === 'teardown' ? [] : ['--valid-until', '2026-08-02T00:00:00Z'])];
    const code = await gate1.main(argv, { env: {}, out: { log: (m) => lines.push(m) } });
    assert.equal(code, 0, `${phase} --print-sql must succeed with an empty environment`);
    assert.ok(lines.join('\n').includes('backtest_ro_pit01'), `${phase} rendered nothing`);
  }
  // Teardown's confirmation needs an OID that only exists at runtime, so review
  // mode must still render it rather than throwing on a missing value.
  const teardown = [];
  await gate1.main(['--phase', 'teardown', '--database', 'endzone_empire',
    '--role', 'backtest_ro_pit01', '--print-sql'], { env: {}, out: { log: (m) => teardown.push(m) } });
  assert.match(teardown.join('\n'), /teardown_confirm_absent/);
});

test('the admin credential comes from ONE variable, with no fallback to the app URL', () => {
  assert.equal(gate1.ADMIN_ENV_VAR, 'BACKTEST_ADMIN_DATABASE_URL');
  assert.equal(gate1.readAdminCredential({ BACKTEST_ADMIN_DATABASE_URL: '  postgres://a/b  ' }),
    'postgres://a/b');
  assert.throws(() => gate1.readAdminCredential({}), /BACKTEST_ADMIN_DATABASE_URL is not set/);
  assert.throws(() => gate1.readAdminCredential({ BACKTEST_ADMIN_DATABASE_URL: '   ' }),
    /BACKTEST_ADMIN_DATABASE_URL is not set/);
  // The app's own credential must NOT be picked up, and the error has to say so
  // out loud - the next thing a blocked operator tries is the URL their shell
  // already has.
  for (const env of [{ DATABASE_URL: 'postgres://app/x' }, { PGUSER: 'endzone' },
    { DATABASE_URL_RUNTIME: 'postgres://app/x' }, { PGHOST: 'db' }]) {
    assert.throws(() => gate1.readAdminCredential(env), /deliberately NOT used as a fallback/);
  }
});

test('the role password comes from ONE variable, and must be strong printable ASCII', () => {
  assert.equal(gate1.PASSWORD_ENV_VAR, 'BACKTEST_RO_ROLE_PASSWORD');
  const good = 'Kq7-vZ2mR9tB4xN6wL1cJ8sH0dF3gY5a';
  assert.equal(gate1.readRolePassword({ BACKTEST_RO_ROLE_PASSWORD: good }), good);

  assert.throws(() => gate1.readRolePassword({}), /BACKTEST_RO_ROLE_PASSWORD is not set/);
  assert.throws(() => gate1.readRolePassword({ BACKTEST_RO_ROLE_PASSWORD: '' }), /is not set/);
  assert.throws(() => gate1.readRolePassword({ BACKTEST_RO_ROLE_PASSWORD: 'x'.repeat(23) }),
    /23 characters; at least 24/);
  // The correctness constraint, not a policy one: no SASLprep implementation
  // here, so anything outside printable ASCII would produce a verifier the
  // password cannot authenticate against.
  for (const bad of [`${'x'.repeat(30)}\n`, `${'x'.repeat(30)} `, ` ${'x'.repeat(30)}`,
    `${'x'.repeat(30)} `, `café${'x'.repeat(30)}`, `${'x'.repeat(30)}\t`]) {
    assert.throws(() => gate1.readRolePassword({ BACKTEST_RO_ROLE_PASSWORD: bad }),
      /printable ASCII/, `${JSON.stringify(bad.slice(-3))} must be refused`);
  }
  // The error must not echo the password back.
  try {
    gate1.readRolePassword({ BACKTEST_RO_ROLE_PASSWORD: 'short-secret-abc' });
    assert.fail('expected a throw');
  } catch (err) {
    assert.equal(err.message.includes('short-secret-abc'), false,
      'the rejection message must not quote the password');
  }
});

// ---------------------------------------------------------------------------
// Identifier, database and timestamp validation
// ---------------------------------------------------------------------------

test('the role name is pattern-bound, and nothing that could break quoting survives', () => {
  assert.equal(gate1.assertRoleName('backtest_ro_pit01'), 'backtest_ro_pit01');
  assert.equal(gate1.assertRoleName('backtest_ro_a'), 'backtest_ro_a');
  for (const bad of [
    'postgres', 'admin', 'backtest_ro_', 'BACKTEST_RO_X', 'backtest_ro_X',
    'backtest_ro_a-b', 'backtest_ro_a b', 'backtest_ro_a"b', "backtest_ro_a'b",
    'backtest_ro_a;DROP ROLE postgres', 'backtest_ro_a\0b', 'x_backtest_ro_a',
    `backtest_ro_${'a'.repeat(41)}`, '', null, undefined, 42, {},
  ]) {
    assert.throws(() => gate1.assertRoleName(bad), /--role must match/,
      `${JSON.stringify(bad)} must be refused`);
  }
});

test('the database name is pattern-bound too', () => {
  assert.equal(gate1.assertDatabaseName('endzone_empire'), 'endzone_empire');
  for (const bad of ['Endzone', '1db', 'a b', 'a"b', 'a;b', '', null, 'a'.repeat(64)]) {
    assert.throws(() => gate1.assertDatabaseName(bad), /--database must match/,
      `${JSON.stringify(bad)} must be refused`);
  }
});

test('the expiry must carry a timezone, be in the future, and be within seven days', () => {
  const now = new Date('2026-07-30T12:00:00Z');
  assert.equal(gate1.assertValidUntil('2026-08-02T00:00:00Z', { now }), '2026-08-02T00:00:00Z');
  assert.equal(gate1.assertValidUntil('2026-08-02T00:00:00+02:00', { now }), '2026-08-02T00:00:00+02:00');

  // No timezone means "whose clock?", and the answer would be the server's.
  for (const bad of ['2026-08-02T00:00:00', '2026-08-02', 'tomorrow', 'infinity',
    '2026-08-02 00:00:00Z', '', null, 20260802]) {
    assert.throws(() => gate1.assertValidUntil(bad, { now }), /ISO-8601 timestamp with an explicit timezone/,
      `${JSON.stringify(bad)} must be refused`);
  }
  // A past or present expiry creates a role that cannot log in.
  assert.throws(() => gate1.assertValidUntil('2026-07-30T11:59:59Z', { now }), /not in the future/);
  assert.throws(() => gate1.assertValidUntil('2026-07-30T12:00:00Z', { now }), /not in the future/);
  assert.throws(() => gate1.assertValidUntil('2020-01-01T00:00:00Z', { now }), /not in the future/);
  // An unbounded expiry is a standing production credential wearing a temporary
  // one's name.
  assert.equal(gate1.MAX_VALID_UNTIL_DAYS, 7);
  assert.throws(() => gate1.assertValidUntil('2026-08-06T12:00:01Z', { now }), /the maximum is 7/);
  assert.throws(() => gate1.assertValidUntil('2027-01-01T00:00:00Z', { now }), /the maximum is 7/);
  // The boundary itself is allowed.
  assert.equal(gate1.assertValidUntil('2026-08-06T12:00:00Z', { now }), '2026-08-06T12:00:00Z');
});

test('quoting refuses what it cannot safely quote rather than escaping it', () => {
  assert.equal(gate1.quoteIdent('backtest_ro_x'), '"backtest_ro_x"');
  assert.equal(gate1.quoteLiteral('2026-08-02T00:00:00Z'), "'2026-08-02T00:00:00Z'");
  assert.equal(gate1.quoteLiteral("o'brien"), "'o''brien'");
  assert.throws(() => gate1.quoteIdent('a"b'), /refusing to quote/);
  assert.throws(() => gate1.quoteIdent('a\0b'), /refusing to quote/);
  assert.throws(() => gate1.quoteIdent(''), /refusing to quote/);
  // A backslash in a literal means something different depending on
  // standard_conforming_strings, which this file does not control.
  assert.throws(() => gate1.quoteLiteral('a\\b'), /refusing to quote/);
  assert.throws(() => gate1.quoteLiteral('a\0b'), /refusing to quote/);
});

// ---------------------------------------------------------------------------
// The SQL files and their placeholders
// ---------------------------------------------------------------------------

test('each .sql file parses into named, non-empty, unique statement blocks', () => {
  for (const [file, expected] of [
    ['create-role.sql', ['preflight_context', 'preflight_role_absent', 'preflight_objects_present',
      'preflight_function_present', 'create_role', 'set_read_only', 'grant_connect', 'grant_usage',
      'grant_select', 'grant_execute']],
    ['verify-role.sql', ['verify_role_flags', 'verify_role_settings', 'verify_effective_privileges',
      'verify_relation_acl_enumeration', 'verify_column_acl_enumeration',
      'verify_function_acl_enumeration', 'verify_schema_acl_enumeration',
      'verify_database_acl_enumeration', 'verify_default_acl_enumeration',
      'verify_table_rls_state', 'verify_table_policies',
      'verify_no_ownership', 'verify_memberships']],
    ['teardown-role.sql', ['teardown_role_present', 'teardown_check_ownership',
      'teardown_check_memberships', 'teardown_terminate_sessions', 'teardown_revoke',
      'teardown_reset_settings', 'teardown_drop_role', 'teardown_confirm_absent']],
    ['grant-rls-policies.sql', ['policy_preflight_context', 'policy_preflight_role_present',
      'policy_table_rls_state', 'policy_table_policies', 'create_policies']],
    ['drop-rls-policies.sql', ['policy_preflight_context', 'policy_preflight_role_present',
      'policy_table_rls_state', 'policy_table_policies', 'drop_policies']],
  ]) {
    const blocks = gate1.loadStatements(readSql(file), { label: file });
    assert.deepEqual([...blocks.keys()], expected, `${file} blocks, in order`);
  }
  assert.throws(() => gate1.loadStatements('SELECT 1;'), /no "-- @statement:" blocks found/);
  assert.throws(() => gate1.loadStatements('-- @statement: a\nSELECT 1;\n-- @statement: a\nSELECT 2;'),
    /duplicate statement block/);
  assert.throws(() => gate1.loadStatements('-- @statement: a\n\n-- @statement: b\nSELECT 2;'),
    /statement block "a" is empty/);
});

test('ONLY the allowlisted placeholders can reach a statement', () => {
  // The repo lints server tests with react-app/jest. testing-library's
  // render-result-naming-convention matches any `render*` callee - and, with
  // its default aggressive reporting, anything that wraps one - then insists
  // the result be called `view` or `utils`. This is a SQL string, not a
  // rendered component, and naming it `view` in a file about database views
  // would be actively confusing.
  // eslint-disable-next-line testing-library/render-result-naming-convention
  const sql = gate1.renderStatement(
    'CREATE ROLE :"role_ident" VALID UNTIL :\'valid_until\';\n'
    + 'SELECT :\'role_name\', :\'database_name\';\nGRANT CONNECT ON DATABASE :"database_ident" TO :"role_ident";',
    VALUES
  );
  assert.match(sql, /CREATE ROLE "backtest_ro_pit01" VALID UNTIL '2026-08-06T00:00:00Z'/);
  assert.match(sql, /SELECT 'backtest_ro_pit01', 'endzone_empire'/);
  assert.match(sql, /GRANT CONNECT ON DATABASE "endzone_empire" TO "backtest_ro_pit01"/);

  // An unrecognised placeholder is the whole point: a future edit to a .sql
  // file cannot introduce an unvalidated substitution point, because there is
  // no default branch that passes text through.
  assert.throws(() => gate1.renderStatement("SELECT :'schema_name';", VALUES),
    /unknown placeholder :'schema_name'/);
  assert.throws(() => gate1.renderStatement('SELECT :"anything";', VALUES), /unknown placeholder/);
  // Kind confusion is refused: a role name is not an identifier just because
  // someone wrote double quotes around the wrong name.
  assert.throws(() => gate1.renderStatement('SELECT :"valid_until";', VALUES),
    /is a ident placeholder but valid_until is an literal value/);
  assert.throws(() => gate1.renderStatement("SELECT :'role_ident';", VALUES),
    /is a literal placeholder but role_ident is an ident value/);
  // A phase that does not supply a value cannot silently render an empty one.
  assert.throws(() => gate1.renderStatement("SELECT :'valid_until';", { ...VALUES, validUntil: null }),
    /required by this phase but no value was supplied/);
  assert.throws(() => gate1.renderStatement("SELECT :'password_verifier';",
    { ...VALUES, passwordVerifier: null }), /required by this phase but no value was supplied/);

  // A PostgreSQL cast is not a placeholder.
  assert.equal(gate1.renderStatement("SELECT now()::text, 'a:b';", VALUES), "SELECT now()::text, 'a:b';");

  // The policy name is an IDENTIFIER only. There is no literal form, so a .sql
  // file cannot filter the catalog on it in SQL and then be told a different
  // name in JavaScript; the two would be one place to disagree.
  assert.equal(gate1.renderStatement('DROP POLICY :"policy_ident" ON public.players;', VALUES),
    'DROP POLICY "backtest_ro_pit01_select" ON public.players;');
  assert.throws(() => gate1.renderStatement("SELECT :'policy_ident';", VALUES),
    /is a literal placeholder but policy_ident is an ident value/);
  assert.throws(() => gate1.renderStatement('SELECT :"policy_name";', VALUES),
    /unknown placeholder/);
  assert.throws(() => gate1.renderStatement('SELECT :"policy_ident";', { ...VALUES, policyName: null }),
    /required by this phase but no value was supplied/);
});

test("each .sql header documents EXACTLY the placeholders its statements use", () => {
  // The whole claim of these files is that a DBA can review them, and run them
  // with psql, as SQL. An earlier create-role.sql header documented
  // `database_name` and set it in its own psql example, while the statements
  // used `database_ident` - so the documented command did not work, and the
  // one placeholder a reader would have checked against was the wrong one.
  // Comparing the sets mechanically is the only way that does not drift.
  // Read from the STATEMENTS only, never the header: a header that documents
  // itself proves nothing. Comments inside the blocks are stripped too, so an
  // explanatory comment that merely mentions a placeholder cannot force it
  // into the documented set.
  const used = (text) => new Set(
    [...sqlOnly([...gate1.loadStatements(text).values()].join('\n'))
      .matchAll(/:(['"])([a-zA-Z_][a-zA-Z0-9_]*)\1/g)].map((m) => m[2])
  );

  for (const file of SQL_FILES) {
    const text = readSql(file);
    const declared = /^--[ \t]*@placeholders:[ \t]*(.+)$/m.exec(text);
    assert.ok(declared, `${file} must carry a "-- @placeholders:" line`);
    const documented = declared[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(documented, [...used(text)].sort(),
      `${file}: the documented placeholder set must equal the set the statements actually use`);

    // The prose list and the psql example have to name them too, or the header
    // is machine-correct and human-wrong.
    for (const name of documented) {
      assert.ok(text.includes(`:'${name}'`) || text.includes(`:"${name}"`),
        `${file}: ${name} is documented but never used`);
      assert.match(text, new RegExp(`-v ${name}=`), `${file}: the psql example must set ${name}`);
    }
    // And nothing outside the declared set may be set in the example, which is
    // how the stale `-v database_name=` survived in create-role.sql.
    for (const [, exampleVar] of text.matchAll(/-v ([a-z_]+)=/g)) {
      assert.ok(documented.includes(exampleVar),
        `${file}: the psql example sets ${exampleVar}, which the file does not use`);
    }
  }
});

test('a role OID reaching a statement is validated like everything else', () => {
  assert.equal(gate1.assertRoleOid(16471), '16471');
  assert.equal(gate1.assertRoleOid('16471'), '16471');
  for (const bad of [0, '0', -1, '16471; DROP ROLE postgres', '1.5', '', null, undefined,
    'sixteen', '01', '12345678901']) {
    assert.throws(() => gate1.assertRoleOid(bad), /expected a positive integer OID/,
      `${JSON.stringify(bad)} must be refused`);
  }
});

test('every placeholder actually written in the .sql files is one the runner allows', () => {
  // The reverse direction of the test above: the allowlist protects against new
  // placeholders, and this protects against a .sql file using one the runner
  // will reject at 3am in the middle of a production gate.
  for (const file of SQL_FILES) {
    for (const [name, text] of gate1.loadStatements(readSql(file), { label: file })) {
      assert.doesNotThrow(() => gate1.renderStatement(text, VALUES, { label: `${file}:${name}` }),
        `${file}:${name} uses a placeholder the runner does not allow`);
    }
  }
});

test('the SQL grants exactly the four tables the runner expects, and no wildcard', () => {
  // The runner's EXPECTED_TABLES is what the enumeration check compares
  // against; create-role.sql is what actually grants. If they drifted apart,
  // verify would either pass on a wrong grant set or fail on a right one.
  const create = gate1.loadStatements(readSql('create-role.sql'), { label: 'create' });
  const grantSelect = sqlOnly(create.get('grant_select'));
  for (const table of gate1.EXPECTED_TABLES) {
    assert.match(grantSelect, new RegExp(`\\bpublic\\.${table}\\b`), `grant_select must name ${table}`);
  }
  const named = [...grantSelect.matchAll(/\bpublic\.([a-z_]+)\b/g)].map((m) => m[1]).sort();
  assert.deepEqual(named, [...gate1.EXPECTED_TABLES].sort(),
    'grant_select must name EXACTLY the tables the verify enumeration expects');

  // The single most likely way this kit could become a full-database read
  // grant. Checked across the whole file, not just this block.
  const wholeFile = readSql('create-role.sql');
  const statementsOnly = sqlOnly([...create.values()].join('\n'));
  assert.equal(/ALL TABLES IN SCHEMA/i.test(statementsOnly), false, 'no wildcard table grant');
  assert.equal(/ALL FUNCTIONS IN SCHEMA/i.test(statementsOnly), false, 'no wildcard function grant');
  assert.equal(/ALTER DEFAULT PRIVILEGES/i.test(statementsOnly), false, 'no default privileges');
  assert.equal(/\bSUPERUSER\b/.test(statementsOnly.replace(/NOSUPERUSER/g, '')), false);
  assert.equal(/\bBYPASSRLS\b/.test(statementsOnly.replace(/NOBYPASSRLS/g, '')), false);
  assert.equal(/WITH GRANT OPTION/i.test(statementsOnly), false, 'the role may not re-grant');
  // Nothing is revoked from PUBLIC: that would change behaviour for the
  // application and every other role in the cluster.
  assert.equal(/FROM\s+PUBLIC/i.test(statementsOnly), false, 'must not revoke from PUBLIC');
  assert.equal(/TO\s+PUBLIC/i.test(statementsOnly), false, 'must not grant to PUBLIC');
  // And the file has to say so, since a reviewer reads the file, not this test.
  assert.match(wholeFile, /PUBLIC/);
});

test('teardown revokes exactly what create granted', () => {
  const create = gate1.loadStatements(readSql('create-role.sql'), { label: 'c' });
  const teardown = gate1.loadStatements(readSql('teardown-role.sql'), { label: 't' });
  const revoke = sqlOnly(teardown.get('teardown_revoke'));
  const targets = (text) => [...text.matchAll(/\bpublic\.([a-z_]+)\b/g)].map((m) => m[1]).sort();
  assert.deepEqual(targets(revoke),
    targets(sqlOnly([create.get('grant_select'), create.get('grant_execute')].join('\n'))),
    'the revoke set and the grant set must name the same objects');
  for (const fragment of ['ON SCHEMA public', 'ON DATABASE']) {
    assert.ok(revoke.includes(fragment), `teardown must also revoke ${fragment}`);
  }
  const teardownSql = sqlOnly([...teardown.values()].join('\n'));

  // NO SWEEPER, and this is a hard requirement rather than a preference. A
  // non-superuser CREATEROLE operator cannot execute DROP OWNED BY on a role it
  // created - ADMIN OPTION is not the privileges OF the role - so a sweeper
  // makes the whole teardown unrunnable by the real Gate 1 operator. CI proved
  // that with "permission denied to drop objects". It is also the wrong
  // instrument: it would delete the evidence of an over-grant rather than
  // report it.
  assert.equal(/DROP\s+OWNED\s+BY/i.test(teardownSql), false,
    'DROP OWNED BY must not be reachable by the teardown');
  assert.equal(/DROP\s+ROLE[^;]*CASCADE/i.test(teardownSql), false);

  // The ordering that makes the drop safe: both checks come before it, and the
  // revokes clear the kit's own ACL entries before DROP ROLE tests for residue.
  const order = [...teardown.keys()];
  for (const before of ['teardown_check_ownership', 'teardown_check_memberships',
    'teardown_terminate_sessions', 'teardown_revoke']) {
    assert.ok(order.indexOf(before) < order.indexOf('teardown_drop_role'),
      `${before} must come before DROP ROLE`);
  }
  // DROP ROLE is now the last fail-closed check rather than a formality, so the
  // block has to document it: what PostgreSQL reports, and what a failure MEANS
  // for the operator reading it. A reviewer approving this file is approving
  // the removal of the sweeper on the strength of exactly this explanation.
  const dropBlock = teardown.get('teardown_drop_role');
  assert.match(dropBlock, /cannot be dropped because some objects depend on it/,
    'the drop block must name the refusal it now relies on');
  assert.match(dropBlock, /DETAIL/,
    'and that the blocking dependencies arrive in DETAIL');
  assert.match(dropBlock, /rolls back|rolled back/,
    'and that a failure aborts rather than half-dropping');
  assert.match(dropBlock, /nothing is dropped/i);
  assert.match(dropBlock, /DROP ROLE automatically revokes\s+--?\s*memberships|memberships of the target role/,
    'and why no membership revoke is needed');
});

test('a failed statement surfaces the server DETAIL, never the statement text', () => {
  // DROP ROLE's refusal puts the summary in the message and the actual list of
  // blocking dependencies in DETAIL. Teardown's last fail-closed check would be
  // useless if the runner reported that something depends on the role while
  // withholding what.
  const client = scriptedClient();
  client.query = async () => {
    const err = new Error('role "backtest_ro_pit01" cannot be dropped because some objects depend on it');
    err.detail = 'privileges for table players\nprivileges for table nfl_games';
    err.hint = 'do the thing';
    // `where` and `internalQuery` can carry SQL text, which for create_role
    // would carry the SCRAM verifier.
    err.where = "PL/pgSQL function inline_code_block line 1 at SQL statement CREATE ROLE x PASSWORD 'SCRAM-SHA-256$4096:leak'";
    err.internalQuery = "CREATE ROLE x PASSWORD 'SCRAM-SHA-256$4096:leak'";
    throw err;
  };
  return gate1.phaseVerify(client, PHASE_VALUES, { log: () => {} }).then(
    () => assert.fail('expected a rejection'),
    (err) => {
      assert.match(err.message, /cannot be dropped because some objects depend on it/);
      assert.match(err.message, /DETAIL: privileges for table players/);
      assert.match(err.message, /HINT: do the thing/);
      assert.equal(err.message.includes('SCRAM-SHA-256'), false,
        'where/internalQuery can echo the statement and must stay out');
      assert.equal(err.message.includes('inline_code_block'), false);
    }
  );
});

test('the create SQL states every role flag explicitly', () => {
  // sqlOnly, not the raw block: the comment above CREATE ROLE explains what
  // NOINHERIT and CONNECTION LIMIT 1 do, so a check against the raw text is
  // satisfied by the explanation even after the flag itself is deleted. A
  // mutation run found exactly that, twice.
  const createRole = sqlOnly(
    gate1.loadStatements(readSql('create-role.sql'), { label: 'c' }).get('create_role')
  );
  for (const flag of ['LOGIN', 'NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOINHERIT',
    'NOREPLICATION', 'NOBYPASSRLS', 'CONNECTION LIMIT 1', 'VALID UNTIL']) {
    assert.ok(createRole.includes(flag), `create_role must state ${flag} rather than rely on a default`);
  }
  // The plaintext-password trap this whole design exists to avoid.
  assert.match(createRole, /PASSWORD :'password_verifier'/);
});

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------

test('argv carries only the accident guards, never a secret', () => {
  assert.deepEqual(gate1.parseArgs(['--phase', 'create', '--database', 'endzone_empire',
    '--role', 'backtest_ro_x', '--valid-until', '2026-08-02T00:00:00Z']),
  { phase: 'create', database: 'endzone_empire', role: 'backtest_ro_x',
    validUntil: '2026-08-02T00:00:00Z', printSql: false });
  assert.equal(gate1.parseArgs(['--print-sql']).printSql, true);
  assert.throws(() => gate1.parseArgs(['--phase']), /--phase needs a value/);
  assert.throws(() => gate1.parseArgs(['--role', '--database']), /--role needs a value/);
  // A stray positional is refused loudly, because the way a password ends up on
  // a command line is somebody appending it and nothing complaining. It is
  // refused by LENGTH, not by value: the token could be the password itself.
  assert.throws(() => gate1.parseArgs(['--phase', 'create', 'hunter2']),
    /unrecognised argument\(s\): <redacted 7-character non-flag argument>/);
  assert.throws(() => gate1.parseArgs(['--phase', 'create', 'hunter2']), /read from the environment only/);
  try {
    gate1.parseArgs(['--phase', 'create', 'hunter2']);
    assert.fail('expected a throw');
  } catch (err) {
    assert.equal(err.message.includes('hunter2'), false, 'the token must not be echoed');
  }
  // A misspelled flag IS echoed, because a flag name is not a secret and the
  // operator needs to see their typo.
  assert.throws(() => gate1.parseArgs(['--password', 'x']), /unrecognised argument/);
  assert.throws(() => gate1.parseArgs(['--phase', 'create', '--rolle']), /--rolle/);
});

test('main refuses a bad phase, a bad role and a bad expiry before opening anything', async () => {
  // No BACKTEST_ADMIN_DATABASE_URL is set in these envs, so if any of these
  // validations did NOT fire first, the failure would be the credential error
  // instead - which is itself the assertion that nothing connects.
  const env = {};
  const base = ['--database', 'endzone_empire', '--role', 'backtest_ro_x',
    '--valid-until', '2026-08-02T00:00:00Z'];
  await assert.rejects(() => gate1.main(['--phase', 'destroy', ...base], { env }),
    /--phase must be one of create, verify, teardown/);
  await assert.rejects(() => gate1.main([...base], { env }), /--phase must be one of/);
  await assert.rejects(() => gate1.main(['--phase', 'create', '--database', 'endzone_empire',
    '--role', 'postgres', '--valid-until', '2026-08-02T00:00:00Z'], { env }), /--role must match/);
  await assert.rejects(() => gate1.main(['--phase', 'create', '--database', 'Endzone',
    '--role', 'backtest_ro_x', '--valid-until', '2026-08-02T00:00:00Z'], { env }),
  /--database must match/);
  await assert.rejects(() => gate1.main(['--phase', 'create', '--database', 'endzone_empire',
    '--role', 'backtest_ro_x', '--valid-until', '2020-01-01T00:00:00Z'], { env }),
  /not in the future/);
  // Teardown does not need an expiry: the role is going away regardless of when
  // it would have. It still needs the credential, which is what it fails on.
  await assert.rejects(() => gate1.main(['--phase', 'teardown', '--database', 'endzone_empire',
    '--role', 'backtest_ro_x'], { env }), /BACKTEST_ADMIN_DATABASE_URL is not set/);
  // Verify DOES need it, because the expiry is one of the things it checks.
  await assert.rejects(() => gate1.main(['--phase', 'verify', '--database', 'endzone_empire',
    '--role', 'backtest_ro_x'], { env }), /ISO-8601 timestamp with an explicit timezone/);
});

test('--print-sql renders for review, connects to nothing, and never prints the verifier', async () => {
  const lines = [];
  const env = { BACKTEST_ADMIN_DATABASE_URL: 'postgres://admin:hunter2xxxxxxxx@db/endzone_empire',
    BACKTEST_RO_ROLE_PASSWORD: 'Kq7-vZ2mR9tB4xN6wL1cJ8sH0dF3gY5a' };
  const code = await gate1.main(['--phase', 'create', '--database', 'endzone_empire',
    '--role', 'backtest_ro_pit01', '--valid-until', '2026-08-02T00:00:00Z', '--print-sql'],
  { env, out: { log: (m) => lines.push(m) } });
  assert.equal(code, 0);
  const text = lines.join('\n');
  assert.match(text, /CREATE ROLE "backtest_ro_pit01"/);
  assert.match(text, /GRANT SELECT ON TABLE/);
  assert.match(text, /public\.player_season_stats/);
  assert.match(text, /VALID UNTIL '2026-08-02T00:00:00Z'/);
  // The verifier is never derived into the printed string at all: the marker is
  // substituted in its place, rather than the real one being redacted after.
  assert.match(text, /PASSWORD 'SCRAM-SHA-256\$\[REDACTED\]'/);
  assert.equal(/SCRAM-SHA-256\$\d+:/.test(text), false, 'no real verifier may be rendered');
  assert.equal(text.includes('hunter2xxxxxxxx'), false, 'no admin password in review output');

  // A future-dated expiry is still validated, so --print-sql cannot be used to
  // preview something the real run would refuse.
  await assert.rejects(() => gate1.main(['--phase', 'create', '--database', 'endzone_empire',
    '--role', 'backtest_ro_pit01', '--valid-until', '2030-01-01T00:00:00Z', '--print-sql'],
  { env, out: { log: () => {} } }), /the maximum is 7/);
});

// ---------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------

test('Gate 1 refuses any connection that does not verify the server certificate', () => {
  const url = 'postgres://admin:pw@db.example.com/endzone_empire';
  assert.equal(gate1.assertVerifiedTls(url, { resolveSsl: () => ({ rejectUnauthorized: true }) }), true);
  // TLS off entirely: the realistic case is an SSH tunnel on localhost, where a
  // "is a CA configured" check would pass while carrying an admin credential in
  // the clear.
  assert.throws(() => gate1.assertVerifiedTls(url, { resolveSsl: () => false }),
    /TLS is disabled entirely/);
  assert.throws(() => gate1.assertVerifiedTls(url, { resolveSsl: () => null }),
    /TLS is disabled entirely/);
  assert.throws(() => gate1.assertVerifiedTls(url, { resolveSsl: () => ({ rejectUnauthorized: false }) }),
    /TLS is on but unverified/);
  // Not "truthy" - exactly true.
  assert.throws(() => gate1.assertVerifiedTls(url, { resolveSsl: () => ({ rejectUnauthorized: 'true' }) }),
    /TLS is on but unverified/);
  assert.throws(() => gate1.assertVerifiedTls(url, { resolveSsl: () => ({}) }), /TLS is on but unverified/);
  assert.throws(() => gate1.assertVerifiedTls(url, { resolveSsl: () => { throw new Error('bad CA path'); } }),
    /TLS configuration is invalid \(bad CA path\)/);
  assert.throws(() => gate1.assertVerifiedTls(url, { resolveSsl: () => false, env: { NODE_ENV: 'test' } }),
    /NODE_ENV is "test"/);
});

// ---------------------------------------------------------------------------
// The phase control flow, driven by a scripted client
// ---------------------------------------------------------------------------

/**
 * A fake pg client that answers each statement by matching a distinctive
 * fragment of it. This does NOT replace backtestGate1Role.pg.test.js: only a
 * real Postgres can say what `aclexplode` returns or whether a GRANT took. What
 * it does cover is the runner's own control flow - which result it reads, what
 * it does with an unexpected row, and which values it substitutes - none of
 * which needs a database to be wrong.
 */
function scriptedClient(overrides = {}) {
  const seen = [];
  const answers = {
    // Matched on `AS admin_is_superuser` rather than `current_database()`: the
    // ownership blocks resolve the current database's OID in a subquery, so a
    // `current_database()` key would answer them with the context row.
    'AS admin_is_superuser': [{ database_name: 'endzone_empire', admin_role: 'admin',
      admin_is_superuser: true, admin_can_create_role: true }],
    // The four granted tables as production has them: RLS on for three, off for
    // player_season_stats, FORCE off everywhere, owned by the application.
    'AS row_security_forced': productionTables(),
    // No policies, which is the state between create and grant-policies and the
    // state drop-policies leaves behind. It is the baseline rather than the
    // post-amendment one because ONE key answers both verify_no_ownership and
    // teardown_check_ownership - they are the same statement - so a fixture with
    // policies present but no pg_shdepend rows for them would be a database that
    // cannot exist. The complete state is exercised explicitly below, with its
    // dependency rows.
    'AS using_is_unconditional': [],
    'AS role_oid': [{ role_oid: 16471, role_name: 'backtest_ro_pit01', valid_until: null,
      already_expired: false }],
    'AS valid_until_matches': [{
      role_name: 'backtest_ro_pit01', rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolinherit: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true,
      rolconnlimit: 1, rolvaliduntil: new Date('2026-08-06T00:00:00Z'),
      valid_until_matches: true, valid_until_in_future: true,
    }],
    'pg_db_role_setting': [{ set_database_oid: 0, set_config: ['default_transaction_read_only=on'] }],
    'has_database_privilege': [{
      db_connect: true, schema_usage: true, select_players: true, select_player_stats: true,
      select_player_season_stats: true, select_nfl_games: true, execute_normalize: true,
      insert_players: false, update_players: false, delete_players: false,
      update_nfl_games: false, schema_create: false,
    }],
    'aclexplode(c.relacl)': gate1.EXPECTED_TABLES.map((t) => ({
      schema_name: 'public', object_name: t, object_kind: 'r', privilege_type: 'SELECT',
      is_grantable: false,
    })),
    'aclexplode(att.attacl)': [],
    // identity_arguments carries the parameter name, exactly as the real
    // database renders it. Matching is on is_expected_function, which is an OID
    // comparison, so this row must pass DESPITE the name being present.
    'aclexplode(p.proacl)': [{ schema_name: 'public', object_name: 'fn_normalize_nfl_team',
      identity_arguments: 'raw_team text', is_expected_function: true,
      privilege_type: 'EXECUTE', is_grantable: false }],
    'aclexplode(n.nspacl)': [{ object_name: 'public', privilege_type: 'USAGE', is_grantable: false }],
    'aclexplode(d.datacl)': [{ object_name: 'endzone_empire', privilege_type: 'CONNECT',
      is_grantable: false }],
    'pg_default_acl': [],
    "deptype IN ('o', 'r')": [],
    // Zero memberships: the superuser-created case, which is what CI produces
    // and what the kit expected exclusively until production proved otherwise.
    'pg_auth_members': [],
    'pg_terminate_backend': [],
    'AS role_rows': [{ role_rows: '0', shdepend_rows: '0', live_sessions: '0' }],
  };
  return {
    seen,
    query: async (text) => {
      seen.push(String(text));
      for (const [fragment, rows] of Object.entries({ ...answers, ...overrides })) {
        if (String(text).includes(fragment)) return { rows };
      }
      return { rows: [] };
    },
  };
}

const PHASE_VALUES = {
  roleName: 'backtest_ro_pit01', databaseName: 'endzone_empire',
  validUntil: '2026-08-06T00:00:00Z', passwordVerifier: null,
  policyName: POLICY_NAME,
};

/**
 * A fake client for the two POLICY phases, which need something the flat
 * scriptedClient cannot give: a catalog that CHANGES when the mutation runs.
 * Every post-condition in those phases is asserted inside the transaction, so a
 * fixture that answered the same rows before and after would make the passing
 * path indistinguishable from the rolling-back one.
 *
 * `policiesAfter` and `tablesAfter` are what the catalog reports once a CREATE
 * or DROP POLICY has been issued. Leaving them null means the mutation changed
 * nothing, which is exactly the shape of a post-condition failure.
 */
function policyClient(options = {}) {
  const {
    databaseName = 'endzone_empire',
    connectedRole = 'endzone_app',
    role = [{ role_name: 'backtest_ro_pit01', can_login: true }],
    tables = productionTables(),
    policies = [],
    tablesAfter = null,
    policiesAfter = null,
    mutationError = null,
  } = options;
  const seen = [];
  let mutated = false;
  return {
    seen,
    mutated: () => mutated,
    query: async (text) => {
      const sql = String(text);
      seen.push(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
      // Comments first: policy_preflight_role_present EXPLAINS what
      // `CREATE POLICY ... TO` does to an absent role, and a raw scan would read
      // that sentence as the mutation.
      if (/\b(?:CREATE|DROP)\s+POLICY\b/i.test(sqlOnly(sql))) {
        if (mutationError) throw mutationError;
        mutated = true;
        return { rows: [] };
      }
      if (sql.includes('AS connected_role')) {
        return { rows: [{ database_name: databaseName, connected_role: connectedRole }] };
      }
      if (sql.includes('AS can_login')) return { rows: role };
      if (sql.includes('AS row_security_forced')) {
        return { rows: mutated && tablesAfter !== null ? tablesAfter : tables };
      }
      if (sql.includes('AS using_is_unconditional')) {
        return { rows: mutated && policiesAfter !== null ? policiesAfter : policies };
      }
      throw new Error(`policyClient: no answer scripted for: ${sql.slice(0, 120)}`);
    },
  };
}

test('verify reads EVERY enumeration, including the column ACLs relacl cannot see', async () => {
  const clean = scriptedClient();
  await assert.doesNotReject(() => gate1.phaseVerify(clean, PHASE_VALUES, { log: () => {} }));
  // All six ACL classes were actually queried, not just declared in the file.
  for (const fragment of ['aclexplode(c.relacl)', 'aclexplode(att.attacl)', 'aclexplode(p.proacl)',
    'aclexplode(n.nspacl)', 'aclexplode(d.datacl)', 'pg_default_acl']) {
    assert.ok(clean.seen.some((q) => q.includes(fragment)), `verify never ran ${fragment}`);
  }

  // A column grant is reported. This is the class that leaves pg_class.relacl
  // completely untouched, so the relation enumeration above stays clean and
  // only this check can fail.
  const withColumn = scriptedClient({
    'aclexplode(att.attacl)': [{ schema_name: 'public', object_name: 'users', column_name: 'email',
      privilege_type: 'SELECT', is_grantable: false }],
  });
  await assert.rejects(() => gate1.phaseVerify(withColumn, PHASE_VALUES, { log: () => {} }),
    /COLUMN-level privileges, which are invisible to the relation enumeration/);
});

test('teardown substitutes the OID it captured BEFORE the drop', async () => {
  const client = scriptedClient();
  const result = await gate1.phaseTeardown(client, PHASE_VALUES, { log: () => {} });
  assert.deepEqual(result, { tornDown: true, noop: false });

  // The confirmation must carry the captured OID as a literal. If it fell back
  // to looking the role up in pg_roles it would be asking a question whose
  // answer is NULL, and counting zero for any residue that survived.
  const confirm = client.seen.find((q) => q.includes('AS role_rows'));
  assert.ok(confirm, 'the confirmation never ran');
  assert.match(confirm, /refobjid = '16471'/, 'shdepend must be probed by the captured OID');
  assert.match(confirm, /usesysid = '16471'/, 'sessions must be probed by the captured OID');
  assert.equal(/refobjid =\s*\n?\s*\(SELECT oid FROM pg_roles/.test(confirm), false,
    'a post-drop pg_roles lookup resolves NULL and confirms nothing');

  // A confirmation that still sees residue is a failure, not a shrug.
  const dirty = scriptedClient({ 'AS role_rows': [{ role_rows: '0', shdepend_rows: '2', live_sessions: '0' }] });
  await assert.rejects(() => gate1.phaseTeardown(dirty, PHASE_VALUES, { log: () => {} }),
    /reported success but the role is still visible/);
  const stillThere = scriptedClient({ 'AS role_rows': [{ role_rows: '1', shdepend_rows: '0', live_sessions: '0' }] });
  await assert.rejects(() => gate1.phaseTeardown(stillThere, PHASE_VALUES, { log: () => {} }),
    /reported success but the role is still visible/);

  // A role_present row with no usable OID must stop the teardown rather than
  // render an empty value into the confirmation.
  const noOid = scriptedClient({ 'AS role_oid': [{ role_oid: null, role_name: 'backtest_ro_pit01' }] });
  await assert.rejects(() => gate1.phaseTeardown(noOid, PHASE_VALUES, { log: () => {} }),
    /expected a positive integer OID/);
});

test('the function is resolved by OID, never by a rendered signature string', () => {
  // THE CI DEFECT. The function is declared fn_normalize_nfl_team(raw_team
  // text), so pg_get_function_identity_arguments renders "raw_team text". The
  // preflight compared that against the literal 'text' and refused a correct
  // database. Renaming a parameter is not a signature change.
  const create = gate1.loadStatements(readSql('create-role.sql'), { label: 'c' });
  const preflight = sqlOnly(create.get('preflight_function_present'));
  assert.match(preflight, /to_regprocedure\('public\.fn_normalize_nfl_team\(text\)'\)/,
    'resolution must go through to_regprocedure, which ignores parameter names');
  assert.match(preflight, /IS NOT NULL AS function_resolved/,
    'to_regprocedure returns NULL for an absent function, and that must stay fail-closed');
  // The overload listing is retained, but only as diagnostics.
  assert.match(preflight, /AS overloads_present/);
  assert.match(preflight, /pg_get_function_identity_arguments/);
  // The old defect must not be reintroducible in this block: nothing may
  // compare a rendered identity against a bare type literal.
  assert.equal(/identity_arguments\s*=\s*'/.test(preflight), false);
  assert.equal(/pg_get_function_identity_arguments\([^)]*\)\s*=/.test(preflight), false);

  const verify = gate1.loadStatements(readSql('verify-role.sql'), { label: 'v' });
  const fnAcl = sqlOnly(verify.get('verify_function_acl_enumeration'));
  assert.match(fnAcl, /p\.oid = to_regprocedure\('public\.fn_normalize_nfl_team\(text\)'\)/,
    'the ACL enumeration must match the overload by OID too');
  assert.match(fnAcl, /AS is_expected_function/);
  assert.equal(/pg_get_function_identity_arguments\([^)]*\)\s*=/.test(fnAcl), false);

  // GRANT and REVOKE resolve by signature in SQL itself, which is already
  // parameter-name-insensitive, so those stay as they are.
  assert.match(sqlOnly(create.get('grant_execute')),
    /GRANT EXECUTE ON FUNCTION public\.fn_normalize_nfl_team\(text\)/);
});

test('preflight accepts a NAMED parameter and fails closed on a genuinely absent function', async () => {
  // (a) The named-argument reality is the passing baseline. This is the exact
  // row shape the real database produces.
  const named = scriptedClient({
    'to_regprocedure': [{ function_resolved: true, resolved_signature: 'fn_normalize_nfl_team(text)',
      overloads_present: ['raw_team text'] }],
    "c.relname IN ('players'": gate1.EXPECTED_TABLES.map((t) => ({ schema_name: 'public',
      object_name: t, object_kind: 'r' })),
  });
  await assert.doesNotReject(
    () => gate1.phaseCreate(named, { ...PHASE_VALUES, passwordVerifier: 'SCRAM-SHA-256$4096:a$b:c' },
      { log: () => {} }),
    'a parameter name must not make a present function look absent'
  );

  // (b) An ADDITIONAL overload must not confuse resolution: to_regprocedure
  // still names the text one, so the preflight proceeds.
  const overloaded = scriptedClient({
    'to_regprocedure': [{ function_resolved: true, resolved_signature: 'fn_normalize_nfl_team(text)',
      overloads_present: ['raw_team text', 'n integer'] }],
    "c.relname IN ('players'": gate1.EXPECTED_TABLES.map((t) => ({ schema_name: 'public',
      object_name: t, object_kind: 'r' })),
  });
  await assert.doesNotReject(
    () => gate1.phaseCreate(overloaded, { ...PHASE_VALUES, passwordVerifier: 'SCRAM-SHA-256$4096:a$b:c' },
      { log: () => {} }),
    'a second overload must not block the one we actually want'
  );

  // (c) Genuinely absent: to_regprocedure yields NULL. Fail closed, with the
  // overload listing in the message, because that listing is how this class of
  // problem gets diagnosed.
  const absent = scriptedClient({
    'to_regprocedure': [{ function_resolved: false, resolved_signature: null,
      overloads_present: ['n integer'] }],
    "c.relname IN ('players'": gate1.EXPECTED_TABLES.map((t) => ({ schema_name: 'public',
      object_name: t, object_kind: 'r' })),
  });
  await assert.rejects(
    () => gate1.phaseCreate(absent, { ...PHASE_VALUES, passwordVerifier: 'SCRAM-SHA-256$4096:a$b:c' },
      { log: () => {} }),
    /did not resolve \(overloads present: n integer\)\. Nothing has been changed/
  );
  assert.equal(absent.seen.some((q) => /^CREATE ROLE/m.test(q)), false, 'no DDL may have run');

  // No overloads at all reports "none" rather than an empty parenthesis.
  const nothing = scriptedClient({
    'to_regprocedure': [{ function_resolved: false, resolved_signature: null, overloads_present: null }],
    "c.relname IN ('players'": gate1.EXPECTED_TABLES.map((t) => ({ schema_name: 'public',
      object_name: t, object_kind: 'r' })),
  });
  await assert.rejects(
    () => gate1.phaseCreate(nothing, { ...PHASE_VALUES, passwordVerifier: 'SCRAM-SHA-256$4096:a$b:c' },
      { log: () => {} }),
    /overloads present: none/
  );

  // A preflight that returns NO ROW is not a pass. The query as written always
  // returns exactly one row, so this guards the case where a future edit gives
  // it a FROM clause that filters everything out - the same shape of mistake
  // as reading an absent function as present.
  const noRow = scriptedClient({
    'to_regprocedure': [],
    "c.relname IN ('players'": gate1.EXPECTED_TABLES.map((t) => ({ schema_name: 'public',
      object_name: t, object_kind: 'r' })),
  });
  await assert.rejects(
    () => gate1.phaseCreate(noRow, { ...PHASE_VALUES, passwordVerifier: 'SCRAM-SHA-256$4096:a$b:c' },
      { log: () => {} }),
    /did not resolve \(overloads present: none\)/
  );
  assert.equal(noRow.seen.some((q) => /^CREATE ROLE/m.test(q)), false, 'no DDL may have run');
});

test('verify accepts the named-parameter function and rejects the WRONG overload', async () => {
  // The passing baseline: identity text carries the parameter name and the row
  // is still accepted, because the match is the OID flag.
  await assert.doesNotReject(() => gate1.phaseVerify(scriptedClient(), PHASE_VALUES, { log: () => {} }));

  // A grant that landed on a DIFFERENT overload renders as a plausible-looking
  // function of the same name. Only the OID comparison can tell them apart.
  const wrongOverload = scriptedClient({
    'aclexplode(p.proacl)': [{ schema_name: 'public', object_name: 'fn_normalize_nfl_team',
      identity_arguments: 'n integer', is_expected_function: false,
      privilege_type: 'EXECUTE', is_grantable: false }],
  });
  await assert.rejects(() => gate1.phaseVerify(wrongOverload, PHASE_VALUES, { log: () => {} }),
    /not the expected overload: public\.fn_normalize_nfl_team\(n integer\):EXECUTE/);

  // Both overloads granted is still wrong: exactly one EXECUTE is expected.
  const both = scriptedClient({
    'aclexplode(p.proacl)': [
      { schema_name: 'public', object_name: 'fn_normalize_nfl_team',
        identity_arguments: 'raw_team text', is_expected_function: true,
        privilege_type: 'EXECUTE', is_grantable: false },
      { schema_name: 'public', object_name: 'fn_normalize_nfl_team',
        identity_arguments: 'n integer', is_expected_function: false,
        privilege_type: 'EXECUTE', is_grantable: false },
    ],
  });
  await assert.rejects(() => gate1.phaseVerify(both, PHASE_VALUES, { log: () => {} }),
    /function privileges are not exactly one EXECUTE/);

  // An absent function makes is_expected_function NULL, not true. NULL must not
  // be read as a pass.
  const nullFlag = scriptedClient({
    'aclexplode(p.proacl)': [{ schema_name: 'public', object_name: 'fn_normalize_nfl_team',
      identity_arguments: 'raw_team text', is_expected_function: null,
      privilege_type: 'EXECUTE', is_grantable: false }],
  });
  await assert.rejects(() => gate1.phaseVerify(nullFlag, PHASE_VALUES, { log: () => {} }),
    /function privileges are not exactly one EXECUTE/);

  // A non-EXECUTE privilege on the right function is still wrong.
  const wrongPriv = scriptedClient({
    'aclexplode(p.proacl)': [{ schema_name: 'public', object_name: 'fn_normalize_nfl_team',
      identity_arguments: 'raw_team text', is_expected_function: true,
      privilege_type: 'UPDATE', is_grantable: false }],
  });
  await assert.rejects(() => gate1.phaseVerify(wrongPriv, PHASE_VALUES, { log: () => {} }),
    /function privileges are not exactly one EXECUTE/);

  // NO function grant at all is a failure too. Nothing is "wrong" in this set
  // because the set is empty, so only the count can catch it - and the
  // has_function_privilege check above cannot help, since EXECUTE is granted to
  // PUBLIC by default and reports true regardless.
  const missing = scriptedClient({ 'aclexplode(p.proacl)': [] });
  await assert.rejects(() => gate1.phaseVerify(missing, PHASE_VALUES, { log: () => {} }),
    /function privileges are not exactly one EXECUTE.*actual: \(none\)/s);
});

/** The exact tuple PostgreSQL 16+ writes when a CREATEROLE non-superuser creates a role. */
const CREATOR_ADMIN_ROW = Object.freeze({
  direction: 'members',
  other_role: 'postgres',
  other_role_is_connected_role: true,
  grantor_oid: 10,
  grantor_name: 'supabase_admin',
  grantor_is_superuser: true,
  grantor_is_bootstrap: true,
  admin_option: true,
  inherit_option: false,
  set_option: false,
});

test('the implicit creator-admin grant is identified STRUCTURALLY, not by role name', () => {
  // This tuple is verbatim from the production probe that diagnosed the failed
  // Gate 1 run: PostgreSQL 17.6, operator `postgres` (rolsuper=false,
  // rolcreaterole=true), grantor oid 10 (supabase_admin), createrole_self_grant
  // empty so inherit and set are both false.
  assert.equal(gate1.isImplicitCreatorAdminGrant(CREATOR_ADMIN_ROW), true);
  assert.equal(gate1.BOOTSTRAP_SUPERUSER_OID, 10);
  // The grantor OID arrives from pg as a number, but a string must work too:
  // nothing about the allowance may depend on driver type coercion.
  assert.equal(gate1.isImplicitCreatorAdminGrant({ ...CREATOR_ADMIN_ROW, grantor_oid: '10' }), true);

  // Every field is load-bearing. Each of these is a DIFFERENT grant that merely
  // resembles the allowed one.
  const rejects = {
    'the other direction (the role is a member of something)': { direction: 'member_of' },
    'a member who is not the connected role': { other_role_is_connected_role: false },
    'a grantor that is not the bootstrap OID': { grantor_oid: 16384, grantor_is_bootstrap: false },
    'a bootstrap flag that disagrees with the OID': { grantor_is_bootstrap: false },
    'an OID that disagrees with the bootstrap flag': { grantor_oid: 16384 },
    'a non-superuser grantor': { grantor_is_superuser: false },
    'ADMIN false, which means a human wrote the GRANT': { admin_option: false },
    'INHERIT widened, so the creator reads AS this role': { inherit_option: true },
    'SET widened, so the creator can BECOME this role': { set_option: true },
  };
  for (const [why, override] of Object.entries(rejects)) {
    assert.equal(gate1.isImplicitCreatorAdminGrant({ ...CREATOR_ADMIN_ROW, ...override }), false,
      `must reject: ${why}`);
  }
  // A missing field may never be read as absent-and-therefore-fine. Only the
  // fields the predicate actually decides on are listed: `other_role` and
  // `grantor_name` are carried for the human-readable line and are deliberately
  // NOT identity, because a name is exactly the thing that must not be trusted.
  for (const key of ['direction', 'other_role_is_connected_role', 'grantor_oid',
    'grantor_is_bootstrap', 'grantor_is_superuser', 'admin_option', 'inherit_option', 'set_option']) {
    const partial = { ...CREATOR_ADMIN_ROW };
    delete partial[key];
    assert.equal(gate1.isImplicitCreatorAdminGrant(partial), false, `must reject a row missing ${key}`);
  }
  for (const bad of [null, undefined, 'members', 42, []]) {
    assert.equal(gate1.isImplicitCreatorAdminGrant(bad), false);
  }
});

test('verify allows EXACTLY ONE creator-admin grant, logs it, and rejects the rest', async () => {
  // Zero rows still passes: superuser-created roles get no implicit grant, and
  // the kit must keep working where the behaviour does not occur.
  const none = scriptedClient();
  const quiet = [];
  await assert.doesNotReject(() => gate1.phaseVerify(none, PHASE_VALUES, { log: (m) => quiet.push(m) }));
  assert.equal(quiet.join('\n').includes('allowed:'), false,
    'nothing to report when there is no membership');

  // The production case: one implicit grant. Passes, and SAYS SO.
  const one = scriptedClient({ 'pg_auth_members': [CREATOR_ADMIN_ROW] });
  const spoken = [];
  await assert.doesNotReject(() => gate1.phaseVerify(one, PHASE_VALUES, { log: (m) => spoken.push(m) }));
  const output = spoken.join('\n');
  assert.match(output, /allowed: the PostgreSQL 16\+ implicit creator-admin grant/);
  assert.match(output, /postgres holds ADMIN on this role/);
  assert.match(output, /granted by the bootstrap superuser supabase_admin/);
  assert.match(output, /INHERIT false, SET false/);
  assert.match(output, /NOT revoked by teardown/);

  // A SECOND copy is impossible for the server to produce, so two of them means
  // something else made one.
  const twice = scriptedClient({
    'pg_auth_members': [CREATOR_ADMIN_ROW, { ...CREATOR_ADMIN_ROW, other_role: 'postgres2' }],
  });
  await assert.rejects(() => gate1.phaseVerify(twice, PHASE_VALUES, { log: () => {} }),
    /more than one creator-admin membership/);

  // Every rejection shape, through the phase rather than just the predicate.
  for (const [why, override] of Object.entries({
    'a widened SET': { set_option: true },
    'a widened INHERIT': { inherit_option: true },
    'a manual grant (admin false)': { admin_option: false },
    'a third-party member': { other_role: 'someone_else', other_role_is_connected_role: false },
    'a non-bootstrap grantor': { grantor_oid: 16384, grantor_is_bootstrap: false },
    'the member_of direction': { direction: 'member_of' },
  })) {
    const client = scriptedClient({ 'pg_auth_members': [{ ...CREATOR_ADMIN_ROW, ...override }] });
    await assert.rejects(() => gate1.phaseVerify(client, PHASE_VALUES, { log: () => {} }),
      /memberships beyond the implicit creator-admin grant/, `must reject ${why}`);
  }

  // The allowed grant alongside a disallowed one still fails.
  const mixed = scriptedClient({
    'pg_auth_members': [CREATOR_ADMIN_ROW,
      { ...CREATOR_ADMIN_ROW, other_role: 'attacker', other_role_is_connected_role: false }],
  });
  await assert.rejects(() => gate1.phaseVerify(mixed, PHASE_VALUES, { log: () => {} }),
    /memberships beyond the implicit creator-admin grant/);
});

test('teardown tolerates the same one grant, never revokes it, and aborts on anything else', async () => {
  const allowed = scriptedClient({ 'pg_auth_members': [CREATOR_ADMIN_ROW] });
  const spoken = [];
  const result = await gate1.phaseTeardown(allowed, PHASE_VALUES, { log: (m) => spoken.push(m) });
  assert.deepEqual(result, { tornDown: true, noop: false });
  assert.match(spoken.join('\n'), /allowed: the PostgreSQL 16\+ implicit creator-admin grant/);

  // Read what EXECUTED, not what was explained: several teardown comments
  // discuss DROP ROLE and REVOKE by name, so a raw scan of the issued text
  // reports the commentary as the action.
  const executed = (client) => client.seen.map(sqlOnly);
  const ranDropRole = (client) => executed(client).some((q) => /\bDROP\s+ROLE\b/i.test(q));

  // NOT revoked. The creator cannot modify a bootstrap-superuser grant, and the
  // ADMIN OPTION it carries is what authorizes the DROP ROLE.
  assert.equal(
    executed(allowed).some((q) => new RegExp(`REVOKE\\s+"${PHASE_VALUES.roleName}"`, 'i').test(q)),
    false, 'teardown must never revoke the role membership itself'
  );
  assert.equal(ranDropRole(allowed), true, 'the drop is what removes the membership');

  // With no sweeper behind them, the explicit REVOKEs are the ONLY thing that
  // clears the kit's own ACL entries. If they stopped running, DROP ROLE would
  // refuse over the residue and teardown would abort on every clean run.
  const revoked = executed(allowed).join('\n');
  for (const target of ['public.players', 'public.player_stats', 'public.player_season_stats',
    'public.nfl_games', 'public.fn_normalize_nfl_team', 'ON SCHEMA public', 'ON DATABASE']) {
    assert.ok(/REVOKE/i.test(revoked) && revoked.includes(target),
      `teardown must revoke ${target} before dropping the role`);
  }
  // And DROP OWNED BY must never be issued: the real operator cannot run it.
  assert.equal(/DROP\s+OWNED\s+BY/i.test(revoked), false,
    'no sweeper may be issued - a non-superuser CREATEROLE operator is denied it');

  // The EXECUTION order, not just the order the blocks appear in the file. With
  // no sweeper, revoking after the drop would mean DROP ROLE meets the kit's own
  // ACL entries and refuses every clean teardown.
  const statements = executed(allowed);
  const firstRevoke = statements.findIndex((q) => /\bREVOKE\b/i.test(q));
  const dropRoleAt = statements.findIndex((q) => /\bDROP\s+ROLE\b/i.test(q));
  assert.ok(firstRevoke >= 0 && dropRoleAt >= 0, 'both statements must have run');
  assert.ok(firstRevoke < dropRoleAt,
    'the revokes must be ISSUED before DROP ROLE, not merely written above it');
  const resetAt = statements.findIndex((q) => /\bRESET ALL\b/i.test(q));
  assert.ok(resetAt >= 0 && resetAt < dropRoleAt, 'RESET ALL must also precede the drop');

  for (const override of [{ set_option: true }, { admin_option: false }, { direction: 'member_of' },
    { other_role_is_connected_role: false }, { grantor_is_superuser: false }]) {
    const client = scriptedClient({ 'pg_auth_members': [{ ...CREATOR_ADMIN_ROW, ...override }] });
    await assert.rejects(() => gate1.phaseTeardown(client, PHASE_VALUES, { log: () => {} }),
      /ABORTED.*memberships beyond the implicit creator-admin grant.*Nothing has been dropped/s);
    assert.equal(ranDropRole(client), false, `nothing may be dropped for ${JSON.stringify(override)}`);
  }

  // Two allowed-shaped rows abort too.
  const twice = scriptedClient({
    'pg_auth_members': [CREATOR_ADMIN_ROW, { ...CREATOR_ADMIN_ROW, other_role: 'postgres2' }],
  });
  await assert.rejects(() => gate1.phaseTeardown(twice, PHASE_VALUES, { log: () => {} }),
    /ABORTED/);
  assert.equal(ranDropRole(twice), false);
});

test('the membership SQL reports identity from the catalog, not as constants', () => {
  // A scripted client cannot judge these: it returns whatever rows the fixture
  // says, so the SQL could hardcode `true AS grantor_is_bootstrap` and every
  // JS-level test would still pass while the allowance became "any membership
  // at all". These are the pins for the columns the predicate decides on.
  for (const [file, block] of [
    ['verify-role.sql', 'verify_memberships'],
    ['teardown-role.sql', 'teardown_check_memberships'],
  ]) {
    const sql = sqlOnly(gate1.loadStatements(readSql(file), { label: file }).get(block));

    // The member identity must come from comparing the catalog to the CONNECTED
    // role, which is what makes the allowance structural.
    assert.match(sql, /\(m\.rolname = current_user\)\s+AS other_role_is_connected_role/,
      `${block}: the member match must be current_user, not a constant`);
    assert.match(sql, /\(r\.rolname = current_user\)/,
      `${block}: the member_of branch must report the same comparison`);
    assert.equal(/true\s+AS other_role_is_connected_role/.test(sql), false,
      `${block}: a constant true here would accept any member`);

    // The grantor must be the bootstrap superuser, checked by OID.
    assert.match(sql, /\(g\.oid = 10\)\s+AS grantor_is_bootstrap/,
      `${block}: the bootstrap check must compare the OID`);
    assert.equal(/true\s+AS grantor_is_bootstrap/.test(sql), false,
      `${block}: a constant true here would accept any grantor`);
    assert.match(sql, /g\.rolsuper\s+AS grantor_is_superuser/);

    // Every pg_roles join must be a LEFT join. An INNER join would enforce
    // "no unresolvable member or grantor" by silently dropping the row before
    // the predicate could reject it; fail-closed means the row must SURFACE
    // with NULL identity columns and be rejected in the runner.
    assert.match(sql, /LEFT JOIN pg_roles g ON g\.oid = am\.grantor/,
      `${block}: the grantor must be resolved without discarding unresolvable rows`);
    assert.match(sql, /LEFT JOIN pg_roles m ON m\.oid = am\.member/,
      `${block}: the member must be resolved without discarding unresolvable rows`);
    const roleJoins = (sql.match(/JOIN pg_roles/g) || []).length;
    const leftRoleJoins = (sql.match(/LEFT JOIN pg_roles/g) || []).length;
    assert.equal(roleJoins, 4, `${block}: both branches must join member and grantor`);
    assert.equal(leftRoleJoins, roleJoins,
      `${block}: an inner pg_roles join would drop the row instead of surfacing it`);

    // BOTH directions must be reported. Collapsing member_of into members would
    // hide the direction that gives this role somebody else's privileges.
    assert.match(sql, /'members'::text/);
    assert.match(sql, /'member_of'::text/, `${block}: the member_of direction must still be queried`);
    assert.match(sql, /WHERE am\.member = \(SELECT oid FROM pg_roles WHERE rolname = :'role_name'\)/,
      `${block}: the member_of branch must filter on am.member`);
    assert.match(sql, /WHERE am\.roleid = \(SELECT oid FROM pg_roles WHERE rolname = :'role_name'\)/,
      `${block}: the members branch must filter on am.roleid`);

    // The three option flags must be selected, or the predicate reads undefined.
    for (const column of ['admin_option', 'inherit_option', 'set_option']) {
      assert.match(sql, new RegExp(`am\\.${column}\\s+AS ${column}`), `${block}: ${column} must be selected`);
    }
  }

  // The two files must ask the SAME question. A divergence would let teardown
  // tolerate something verify rejects, or the reverse.
  const strip = (t) => t.replace(/\s+/g, ' ').trim();
  const verifyBlock = strip(sqlOnly(
    gate1.loadStatements(readSql('verify-role.sql'), { label: 'v' }).get('verify_memberships')
  ));
  const teardownBlock = strip(sqlOnly(
    gate1.loadStatements(readSql('teardown-role.sql'), { label: 't' }).get('teardown_check_memberships')
  ));
  assert.equal(verifyBlock, teardownBlock,
    'verify and teardown must apply the same membership query, or their allowances can drift apart');
});

test('the SQL each phase depends on reads the catalog it claims to read', () => {
  // Static pins for query shapes whose correctness a scripted client cannot
  // judge, and which only a real Postgres would otherwise catch.
  const verify = gate1.loadStatements(readSql('verify-role.sql'), { label: 'v' });
  const column = sqlOnly(verify.get('verify_column_acl_enumeration'));
  assert.match(column, /FROM pg_attribute att/, 'column ACLs live in pg_attribute, not pg_class');
  assert.match(column, /aclexplode\(att\.attacl\)/);
  assert.match(column, /att\.attacl IS NOT NULL/);
  assert.equal(/aclexplode\(c\.relacl\)/.test(column), false,
    'reading relacl here would duplicate the relation check and miss every column grant');

  const teardown = gate1.loadStatements(readSql('teardown-role.sql'), { label: 't' });
  const present = sqlOnly(teardown.get('teardown_role_present'));
  assert.match(present, /\boid\s+AS role_oid\b/,
    'the OID must be captured before the drop, or the confirmation cannot probe for residue');
  const confirm = sqlOnly(teardown.get('teardown_confirm_absent'));
  assert.match(confirm, /usesysid = :'role_oid'/,
    'usename resolves NULL after the drop; usesysid keeps the numeric OID');
  assert.match(confirm, /refobjid = :'role_oid'/);
});

// ---------------------------------------------------------------------------
// The RLS policy amendment
//
// Gate 1 created the role with five correct grants and verify proved all five.
// Gate 2's extraction then read ZERO rows from three of the four tables, because
// those tables have row-level security enabled and no policies at all, which is
// deny-all for every non-owner. Everything below is about the two things that
// answers: the policies themselves, and the measurement that would have caught
// it.
// ---------------------------------------------------------------------------

test('the policy name is DERIVED from the role, never handed in', () => {
  assert.equal(gate1.policyNameFor('backtest_ro_pit01'), 'backtest_ro_pit01_select');
  assert.equal(gate1.POLICY_NAME_SUFFIX, '_select');
  // Deriving it from an invalid role fails on the ROLE, before any policy name
  // exists: there is no path from a bad --role to a good policy name.
  assert.throws(() => gate1.policyNameFor('postgres'), /--role must match/);
  assert.throws(() => gate1.policyNameFor('backtest_ro_a"b'), /--role must match/);

  for (const bad of ['backtest_ro_pit01', 'backtest_ro_pit01_SELECT', 'pit01_select',
    'backtest_ro__select', 'backtest_ro_pit01_select_select_x', 'backtest_ro_a b_select',
    '', null, undefined, 42, {}]) {
    assert.throws(() => gate1.assertPolicyName(bad), /kit-owned policy name matching/,
      `${JSON.stringify(bad)} must be refused`);
  }
  // The arithmetic that makes a separate truncation guard unnecessary, pinned
  // rather than asserted in prose: PostgreSQL truncates identifiers at 63, and a
  // truncated policy name would make every later check target the wrong policy.
  const longest = gate1.policyNameFor(`backtest_ro_${'a'.repeat(40)}`);
  assert.equal(longest.length, 59);
  assert.ok(longest.length <= 63, 'the longest derivable policy name must survive PostgreSQL intact');
});

test('the policy SQL creates exactly four SELECT policies and never touches RLS itself', () => {
  const grant = gate1.loadStatements(readSql('grant-rls-policies.sql'), { label: 'g' });
  const drop = gate1.loadStatements(readSql('drop-rls-policies.sql'), { label: 'd' });
  const create = sqlOnly(grant.get('create_policies'));
  const remove = sqlOnly(drop.get('drop_policies'));

  // EXACTLY the four tables create-role.sql grants on, and no fifth. Same check
  // the grant_select block gets, for the same reason: a policy on a table
  // outside the read surface would be a privilege this kit cannot account for.
  const named = (text) => [...text.matchAll(/\bpublic\.([a-z_]+)\b/g)].map((m) => m[1]).sort();
  assert.deepEqual(named(create), [...gate1.EXPECTED_TABLES].sort());
  assert.deepEqual(named(remove), [...gate1.EXPECTED_TABLES].sort());
  assert.equal((create.match(/CREATE POLICY/g) || []).length, gate1.EXPECTED_TABLES.length);
  assert.equal((remove.match(/DROP POLICY/g) || []).length, gate1.EXPECTED_TABLES.length);

  // Every clause stated explicitly, including the defaults, so a reader does not
  // have to know PostgreSQL's to know what this permits.
  for (const clause of ['AS PERMISSIVE', 'FOR SELECT', 'TO :"role_ident"', 'USING (true)']) {
    assert.equal((create.split(clause).length - 1), gate1.EXPECTED_TABLES.length,
      `every CREATE POLICY must state ${clause}`);
  }
  assert.equal(/RESTRICTIVE/i.test(create), false, 'a restrictive policy would NARROW the read');
  assert.equal(/WITH CHECK/i.test(create), false, 'FOR SELECT takes no WITH CHECK');
  assert.equal(/FOR\s+ALL/i.test(create), false, 'FOR ALL would cover writes too');
  assert.equal(/TO\s+PUBLIC/i.test(create), false, 'a policy naming PUBLIC applies to every role');
  // No IF EXISTS on the drop: a policy that is not there is a finding, and the
  // runner has already decided between "all four" and "none" before this runs.
  assert.equal(/IF\s+EXISTS/i.test(remove), false);

  // The claim the header makes, checked across BOTH whole files rather than the
  // mutating block: nothing here enables, disables or forces row-level security.
  for (const [file, blocks] of [['grant-rls-policies.sql', grant], ['drop-rls-policies.sql', drop]]) {
    const statements = sqlOnly([...blocks.values()].join('\n'));
    assert.equal(/ROW\s+LEVEL\s+SECURITY/i.test(statements), false,
      `${file} must contain no ENABLE/DISABLE/FORCE ROW LEVEL SECURITY`);
    assert.equal(/\bALTER\s+TABLE\b/i.test(statements), false, `${file} must contain no ALTER TABLE`);
    assert.equal(/\bBYPASSRLS\b/i.test(statements), false, `${file} must not reach for BYPASSRLS`);
    assert.equal(/\bALTER\s+ROLE\b/i.test(statements), false, `${file} must not alter the role`);
    assert.equal(/\bGRANT\b/i.test(statements), false, `${file} must grant no privilege`);
  }
  // And the reviewer reads the file, not this test: the refusal of BYPASSRLS has
  // to be argued in the SQL, with both reasons.
  const header = readSql('grant-rls-policies.sql');
  assert.match(header, /WHY NOT BYPASSRLS/);
  assert.match(header, /Only a SUPERUSER may grant BYPASSRLS/);
  assert.match(header, /ROLE attribute, not a table one/);
});

test('the kit policy shape is checked field by field, and every field is load-bearing', () => {
  const [good] = kitPolicies();
  assert.equal(gate1.isExpectedKitPolicy(good, POLICY_NAME), true);

  const rejects = {
    'a different name entirely': { policy_name: 'something_else' },
    'RESTRICTIVE, which NARROWS the read rather than widening it':
      { policy_permissive: false },
    'FOR ALL rather than FOR SELECT': { policy_command: '*' },
    'FOR UPDATE': { policy_command: 'w' },
    'a role array that is not exactly this role': { roles_are_exactly_the_role: false },
    'a policy that also reaches PUBLIC': { applies_to_public: true },
    'a row predicate instead of an unconditional USING':
      { using_is_unconditional: false, using_expression: 'season > 2024' },
    'a WITH CHECK clause, which FOR SELECT cannot have': { has_no_with_check: false },
  };
  for (const [why, override] of Object.entries(rejects)) {
    assert.equal(gate1.isExpectedKitPolicy({ ...good, ...override }, POLICY_NAME), false,
      `must reject: ${why}`);
  }
  // A missing field may never be read as absent-and-therefore-fine.
  for (const key of ['policy_name', 'policy_permissive', 'policy_command',
    'roles_are_exactly_the_role', 'applies_to_public', 'using_is_unconditional',
    'has_no_with_check']) {
    const partial = { ...good };
    delete partial[key];
    assert.equal(gate1.isExpectedKitPolicy(partial, POLICY_NAME), false,
      `must reject a row missing ${key}`);
  }
  // NULL is what the catalog reports when the role does not exist, and NULL is
  // not true.
  assert.equal(gate1.isExpectedKitPolicy({ ...good, roles_are_exactly_the_role: null }, POLICY_NAME),
    false);
  for (const bad of [null, undefined, 'policy', 42, []]) {
    assert.equal(gate1.isExpectedKitPolicy(bad, POLICY_NAME), false);
  }
  // The catalog's own code for FOR SELECT, not a rendered command name.
  assert.equal(gate1.EXPECTED_POLICY_COMMAND, 'r');
});

test('the policy state is classified as absent, complete or partial, and nothing else passes', () => {
  const opts = { policyName: POLICY_NAME };
  const tables = productionTables();

  // ABSENT is legitimate: it is the state between create and grant-policies.
  const absent = gate1.classifyPolicyState(tables, [], opts);
  assert.equal(absent.status, 'absent');
  assert.deepEqual(absent.problems, []);

  const complete = gate1.classifyPolicyState(tables, kitPolicies(), opts);
  assert.equal(complete.status, 'complete');
  assert.deepEqual(complete.problems, []);
  assert.equal(complete.kit.length, 4);

  // PARTIAL is not a state the grant phase can produce: it commits four or none.
  const partial = gate1.classifyPolicyState(tables, kitPolicies().slice(0, 3), opts);
  assert.equal(partial.status, 'partial');
  assert.match(partial.problems.join('\n'), /PARTIAL set/);
  assert.match(partial.problems.join('\n'), /missing on players/);

  // A same-named policy of a DIFFERENT shape is the dangerous case: it is what
  // anything matching on the name alone would adopt, or drop.
  const impostor = gate1.classifyPolicyState(tables,
    kitPolicies({ players: { policy_permissive: false } }), opts);
  assert.match(impostor.problems.join('\n'), new RegExp(`a policy named ${POLICY_NAME} exists in a DIFFERENT shape`));
  assert.equal(impostor.impostors.length, 1);
  assert.equal(impostor.status, 'partial', 'an impostor does not count as coverage');

  // A FOREIGN policy on a granted table fails even though it is nobody's
  // business but the app's: a RESTRICTIVE one would shrink the snapshot silently.
  const foreign = gate1.classifyPolicyState(tables,
    [...kitPolicies(), { ...kitPolicies()[0], policy_oid: 40001, policy_name: 'app_tenant_isolation',
      policy_permissive: false, roles_are_exactly_the_role: false }], opts);
  assert.match(foreign.problems.join('\n'), /policies this kit did not create/);
  assert.match(foreign.problems.join('\n'), /app_tenant_isolation/);
  assert.match(foreign.problems.join('\n'), /RESTRICTIVE policy narrows/);

  // FORCE applies RLS to the owner as well, which here is the application.
  const forced = gate1.classifyPolicyState(
    productionTables({ nfl_games: { row_security_forced: true } }), kitPolicies(), opts
  );
  assert.match(forced.problems.join('\n'), /FORCE ROW LEVEL SECURITY is on nfl_games/);

  // A missing table is a table whose row visibility nothing here describes.
  const short = gate1.classifyPolicyState(tables.filter((t) => t.table_name !== 'players'), [], opts);
  assert.match(short.problems.join('\n'), /expected tables missing from public: players/);

  // relkind is ASSERTED, not merely selected. A view is the dangerous shape: it
  // carries no row-level security of its own, so relrowsecurity is false by
  // construction and the per-table line would read "RLS off, so the SELECT grant
  // is the whole story" about a relation whose row visibility is whatever it
  // selects from. create-role.sql's preflight already refuses to GRANT on one;
  // before this, the policy and verify paths did not.
  const asView = gate1.classifyPolicyState(
    productionTables({ players: { table_kind: 'v', row_security_enabled: false } }),
    kitPolicies(), opts
  );
  assert.match(asView.problems.join('\n'), /not an ordinary table: players is relkind "v"/);
  assert.match(asView.problems.join('\n'), /A view has no row-level security of its own/);
  // A partitioned table is refused too, even though create's preflight tolerates
  // one: nothing here has checked what a policy on it means.
  assert.match(
    gate1.classifyPolicyState(productionTables({ nfl_games: { table_kind: 'p' } }), kitPolicies(), opts)
      .problems.join('\n'),
    /nfl_games is relkind "p"/
  );
  // And a row with no relkind at all fails closed rather than passing by absence.
  assert.match(
    gate1.classifyPolicyState(productionTables({ player_stats: { table_kind: undefined } }),
      kitPolicies(), opts).problems.join('\n'),
    /player_stats is relkind undefined/
  );

  // relrowsecurity is REPORTED, never asserted: whether RLS is on is the
  // database owner's decision and can change without the role changing.
  const rlsEverywhere = gate1.classifyPolicyState(
    productionTables({ player_season_stats: { row_security_enabled: true } }), kitPolicies(), opts
  );
  assert.deepEqual(rlsEverywhere.problems, [],
    'enabling RLS on the fourth table later must not fail verify: the dormant policy is already there');
  const rlsNowhere = gate1.classifyPolicyState(
    productionTables({ players: { row_security_enabled: false },
      player_stats: { row_security_enabled: false }, nfl_games: { row_security_enabled: false } }),
    kitPolicies(), opts
  );
  assert.deepEqual(rlsNowhere.problems, []);

  // The classifier is the one place the three phases agree on what a policy is,
  // so it refuses to run at all without a validated policy name.
  assert.throws(() => gate1.classifyPolicyState(tables, [], { policyName: undefined }),
    /kit-owned policy name matching/);
});

test('rlsFlagsChanged reports exactly what moved, and nothing when nothing did', () => {
  const before = productionTables();
  assert.deepEqual(gate1.rlsFlagsChanged(before, productionTables()), []);
  assert.deepEqual(
    gate1.rlsFlagsChanged(before, productionTables({ players: { row_security_enabled: false } })),
    ['players: rowsecurity=true, force=false -> rowsecurity=false, force=false']
  );
  assert.deepEqual(
    gate1.rlsFlagsChanged(before, productionTables({ nfl_games: { row_security_forced: true } })),
    ['nfl_games: rowsecurity=true, force=false -> rowsecurity=true, force=true']
  );
  // A table that disappeared between the two readings is a change too.
  assert.deepEqual(
    gate1.rlsFlagsChanged(before, before.filter((t) => t.table_name !== 'players')),
    ['players: rowsecurity=true, force=false -> (absent)']
  );
  assert.deepEqual(gate1.rlsFlagsChanged([], []), []);
});

test('grant-policies creates exactly four policies, and is a clean no-op when they exist', async () => {
  const client = policyClient({ policies: [], policiesAfter: kitPolicies() });
  const log = [];
  assert.deepEqual(await gate1.phaseGrantPolicies(client, PHASE_VALUES, { log: (m) => log.push(m) }),
    { granted: true, noop: false });

  const executed = client.seen.map(sqlOnly);
  const created = executed.filter((q) => /CREATE POLICY/i.test(q));
  assert.equal(created.length, 1, 'the four CREATE POLICY statements run as one block');
  for (const table of gate1.EXPECTED_TABLES) {
    assert.ok(created[0].includes(`public.${table}`), `the block must name ${table}`);
  }
  assert.match(created[0], new RegExp(`TO "${PHASE_VALUES.roleName}"`));
  assert.match(created[0], new RegExp(`CREATE POLICY "${POLICY_NAME}"`));
  // The mutation is transactional and COMMITTED only after the post-conditions.
  const beginAt = executed.findIndex((q) => /^\s*BEGIN\s*$/i.test(q));
  const createAt = executed.findIndex((q) => /CREATE POLICY/i.test(q));
  const commitAt = executed.findIndex((q) => /^\s*COMMIT\s*$/i.test(q));
  assert.ok(beginAt >= 0 && beginAt < createAt && createAt < commitAt);
  const rereadAt = executed.findIndex((q, i) => i > createAt && q.includes('AS using_is_unconditional'));
  assert.ok(rereadAt > createAt && rereadAt < commitAt,
    'the post-condition must be read INSIDE the transaction, before the commit');
  assert.match(log.join('\n'), /4 policies named backtest_ro_pit01_select created/);

  // Already there, in exactly the right shape: nothing to do, and no BEGIN.
  const already = policyClient({ policies: kitPolicies() });
  const quiet = [];
  assert.deepEqual(await gate1.phaseGrantPolicies(already, PHASE_VALUES, { log: (m) => quiet.push(m) }),
    { granted: false, noop: true });
  assert.equal(already.mutated(), false);
  assert.equal(already.seen.some((q) => /^\s*BEGIN\s*$/i.test(q)), false);
  assert.match(quiet.join('\n'), /already present, in exactly the expected shape/);
});

test('grant-policies ABORTS on every unexpected state, having changed nothing', async () => {
  const cases = {
    'a same-named policy of a different shape': [
      { policies: kitPolicies({ players: { using_is_unconditional: false, using_expression: 'false' } }) },
      /a policy named backtest_ro_pit01_select exists in a DIFFERENT shape/,
    ],
    'a policy this kit did not create': [
      { policies: [{ ...kitPolicies()[0], policy_oid: 41000, policy_name: 'app_tenant_isolation' }] },
      /policies this kit did not create/,
    ],
    'a partial set': [{ policies: kitPolicies().slice(0, 2) }, /PARTIAL set/],
    'FORCE ROW LEVEL SECURITY': [
      { tables: productionTables({ players: { row_security_forced: true } }) },
      /FORCE ROW LEVEL SECURITY is on players/,
    ],
    'a table that is not there': [
      { tables: productionTables().filter((t) => t.table_name !== 'nfl_games') },
      /expected tables missing from public: nfl_games/,
    ],
    'a granted name that now resolves to a VIEW': [
      { tables: productionTables({ players: { table_kind: 'v', row_security_enabled: false } }) },
      /not an ordinary table: players is relkind "v"/,
    ],
  };
  for (const [why, [options, expected]] of Object.entries(cases)) {
    const client = policyClient(options);
    await assert.rejects(() => gate1.phaseGrantPolicies(client, PHASE_VALUES, { log: () => {} }),
      expected, `must abort on ${why}`);
    assert.equal(client.mutated(), false, `nothing may be created for ${why}`);
    assert.equal(client.seen.some((q) => /^\s*BEGIN\s*$/i.test(q)), false,
      `the abort must come before any transaction for ${why}`);
  }
});

test('the policy phases refuse an operator that does not own the tables, and an absent role', async () => {
  // CREATE POLICY is gated on table ownership, and the Gate 1 admin operator
  // holds CREATEROLE rather than ownership. Ownership is resolved from pg_class,
  // not inferred from which connection string was used.
  for (const phase of [gate1.phaseGrantPolicies, gate1.phaseDropPolicies]) {
    const notOwner = policyClient({
      connectedRole: 'postgres',
      tables: productionTables({ players: { owner_is_connected_role: false } }),
      policies: kitPolicies(),
    });
    await assert.rejects(() => phase(notOwner, PHASE_VALUES, { log: () => {} }),
      /"postgres" does not own players \(owner endzone_app\)/);
    await assert.rejects(() => phase(notOwner, PHASE_VALUES, { log: () => {} }),
      /BACKTEST_OWNER_DATABASE_URL and not BACKTEST_ADMIN_DATABASE_URL/);
    assert.equal(notOwner.mutated(), false);

    // An absent role: every policy this phase manages names it and nothing else.
    const noRole = policyClient({ role: [], policies: kitPolicies() });
    await assert.rejects(() => phase(noRole, PHASE_VALUES, { log: () => {} }),
      /role backtest_ro_pit01 does not exist/);
    assert.equal(noRole.mutated(), false);

    // The accident guard: a correct command aimed at the wrong connection.
    const elsewhere = policyClient({ databaseName: 'some_other_database', policies: kitPolicies() });
    await assert.rejects(() => phase(elsewhere, PHASE_VALUES, { log: () => {} }),
      /connected to database "some_other_database" but --database says "endzone_empire"/);
    assert.equal(elsewhere.mutated(), false);

    // A policy name that was not derived is refused BEFORE any statement runs.
    // It is the value that becomes an IDENTIFIER in CREATE POLICY, so a phase
    // that read three catalog blocks first would be doing work on the way to a
    // refusal it had already earned.
    const unvalidated = policyClient({ policies: kitPolicies() });
    await assert.rejects(
      () => phase(unvalidated, { ...PHASE_VALUES, policyName: 'anything_i_like' }, { log: () => {} }),
      /expected a kit-owned policy name matching/);
    assert.deepEqual(unvalidated.seen, [], 'not one statement may run before the argument is validated');
  }
});

test('grant-policies ROLLS BACK when the post-conditions do not hold', async () => {
  // The post-conditions run inside the transaction precisely so that a mutation
  // which looked right and was not leaves nothing behind to explain.
  const didNotLand = policyClient({ policies: [], policiesAfter: kitPolicies().slice(0, 2) });
  await assert.rejects(() => gate1.phaseGrantPolicies(didNotLand, PHASE_VALUES, { log: () => {} }),
    /did not land as exactly 4 kit policies \(status partial\)/);
  const rolled = (client) => client.seen.map(sqlOnly).some((q) => /^\s*ROLLBACK\s*$/i.test(q));
  const committed = (client) => client.seen.map(sqlOnly).some((q) => /^\s*COMMIT\s*$/i.test(q));
  assert.equal(rolled(didNotLand), true);
  assert.equal(committed(didNotLand), false);

  // A policy of the right name in the wrong shape after the fact.
  const wrongShape = policyClient({
    policies: [], policiesAfter: kitPolicies({ nfl_games: { applies_to_public: true } }),
  });
  await assert.rejects(() => gate1.phaseGrantPolicies(wrongShape, PHASE_VALUES, { log: () => {} }),
    /DIFFERENT shape/);
  assert.equal(rolled(wrongShape), true);
  assert.equal(committed(wrongShape), false);

  // Neither policy file contains an ALTER TABLE, so a row-security flag that
  // moved during the phase means something else did it, inside our transaction.
  // The case chosen is one the classifier is deliberately silent about -
  // relrowsecurity going from false to true is REPORTED, never asserted on - so
  // this failure can only come from the flag comparison itself.
  const flagMoved = policyClient({
    policies: [], policiesAfter: kitPolicies(),
    tablesAfter: productionTables({ player_season_stats: { row_security_enabled: true } }),
  });
  await assert.rejects(() => gate1.phaseGrantPolicies(flagMoved, PHASE_VALUES, { log: () => {} }),
    /row-security flags moved during this phase: player_season_stats: rowsecurity=false, force=false -> rowsecurity=true, force=false/);
  assert.equal(rolled(flagMoved), true);
  assert.equal(committed(flagMoved), false);

  // A driver failure mid-block rolls back too, and the message names the block
  // rather than the rendered statement.
  const boom = policyClient({ policies: [], mutationError: Object.assign(new Error('boom'), { detail: 'why' }) });
  await assert.rejects(() => gate1.phaseGrantPolicies(boom, PHASE_VALUES, { log: () => {} }),
    /statement create_policies failed: boom DETAIL: why/);
  assert.equal(rolled(boom), true);
});

test('drop-policies drops exactly the four kit policies, and confirms them absent', async () => {
  const client = policyClient({ policies: kitPolicies(), policiesAfter: [] });
  const log = [];
  assert.deepEqual(await gate1.phaseDropPolicies(client, PHASE_VALUES, { log: (m) => log.push(m) }),
    { dropped: true, noop: false });
  const executed = client.seen.map(sqlOnly);
  const dropped = executed.filter((q) => /DROP POLICY/i.test(q));
  assert.equal(dropped.length, 1);
  for (const table of gate1.EXPECTED_TABLES) assert.ok(dropped[0].includes(`public.${table}`));
  assert.match(dropped[0], new RegExp(`DROP POLICY "${POLICY_NAME}"`));
  assert.equal(executed.some((q) => /^\s*COMMIT\s*$/i.test(q)), true);
  assert.match(log.join('\n'), /dropped, and confirmed absent/);

  // Nothing to drop is a no-op and exit 0, so an operator unsure whether this
  // already ran can simply run it again.
  const empty = policyClient({ policies: [] });
  const quiet = [];
  assert.deepEqual(await gate1.phaseDropPolicies(empty, PHASE_VALUES, { log: (m) => quiet.push(m) }),
    { dropped: false, noop: true });
  assert.equal(empty.mutated(), false);
  assert.match(quiet.join('\n'), /nothing to drop/);
});

test('drop-policies never drops a wrong-shape namesake, and rolls back if one survives', async () => {
  // Deleting a policy this kit did not create would destroy the evidence of
  // whatever made it, which is the same judgement teardown makes about a
  // residual ACL entry.
  const impostor = policyClient({
    policies: kitPolicies({ players: { policy_command: '*' } }),
  });
  await assert.rejects(() => gate1.phaseDropPolicies(impostor, PHASE_VALUES, { log: () => {} }),
    /a policy named backtest_ro_pit01_select exists in a DIFFERENT shape/);
  assert.equal(impostor.mutated(), false);

  // The drop ran and a policy is still there: roll back rather than report a
  // success the catalog disagrees with.
  const survived = policyClient({ policies: kitPolicies(), policiesAfter: kitPolicies().slice(0, 1) });
  await assert.rejects(() => gate1.phaseDropPolicies(survived, PHASE_VALUES, { log: () => {} }),
    /not absent after the drop \(status partial\)/);
  assert.equal(survived.seen.map(sqlOnly).some((q) => /^\s*ROLLBACK\s*$/i.test(q)), true);
  assert.equal(survived.seen.map(sqlOnly).some((q) => /^\s*COMMIT\s*$/i.test(q)), false);

  // Dropping a policy does not disable row-level security, and this file has no
  // ALTER TABLE, so a flag that moved is somebody else in our transaction.
  const disabled = policyClient({
    policies: kitPolicies(), policiesAfter: [],
    tablesAfter: productionTables({ players: { row_security_enabled: false } }),
  });
  await assert.rejects(() => gate1.phaseDropPolicies(disabled, PHASE_VALUES, { log: () => {} }),
    /row-security flags moved during this phase/);
  assert.equal(disabled.seen.map(sqlOnly).some((q) => /^\s*ROLLBACK\s*$/i.test(q)), true);
});

test('verify measures ROW VISIBILITY, not just privilege', async () => {
  // THE MEASUREMENT GAP, closed. Before this, a role with five correct grants
  // over three deny-all tables passed verify with no line of output that could
  // have told anyone.
  const preGrant = scriptedClient();
  const said = [];
  await assert.doesNotReject(() => gate1.phaseVerify(preGrant, PHASE_VALUES, { log: (m) => said.push(m) }));
  const output = said.join('\n');
  for (const table of ['players', 'player_stats', 'nfl_games']) {
    assert.match(output, new RegExp(`${table}: rowsecurity=true, force=false, owner=endzone_app `
      + '\\(RLS ON WITH NO KIT POLICY: the role reads ZERO rows here despite its SELECT grant\\)'));
  }
  assert.match(output, /player_season_stats: rowsecurity=false, force=false, owner=endzone_app \(RLS off/);
  assert.match(output, /no policy named backtest_ro_pit01_select exists yet/);
  // Absent is NOT a failure: it is the state between create and grant-policies,
  // and create runs verify automatically.
  assert.ok(preGrant.seen.some((q) => q.includes('AS row_security_forced')), 'verify never read the flags');
  assert.ok(preGrant.seen.some((q) => q.includes('AS using_is_unconditional')), 'verify never read the policies');

  // After the grant phase, with the pg_shdepend rows the policies produce.
  const postGrant = scriptedClient({
    'AS using_is_unconditional': kitPolicies(),
    "deptype IN ('o', 'r')": kitPolicyDependencies(),
  });
  const after = [];
  await assert.doesNotReject(() => gate1.phaseVerify(postGrant, PHASE_VALUES, { log: (m) => after.push(m) }));
  assert.match(after.join('\n'), /players: rowsecurity=true, force=false, owner=endzone_app \(RLS on, and the kit policy admits the role\)/);
  assert.equal(after.join('\n').includes('ZERO rows'), false);

  // And the failure shapes, through the phase.
  for (const [why, overrides, expected] of [
    ['FORCE, which filters the application itself',
      { 'AS row_security_forced': productionTables({ players: { row_security_forced: true } }) },
      /FORCE ROW LEVEL SECURITY is on players/],
    ['a same-named policy of a different shape',
      { 'AS using_is_unconditional': kitPolicies({ players: { policy_permissive: false } }),
        "deptype IN ('o', 'r')": kitPolicyDependencies() },
      /DIFFERENT shape/],
    ['a policy this kit did not create',
      { 'AS using_is_unconditional': [{ ...kitPolicies()[0], policy_name: 'app_isolation' }] },
      /policies this kit did not create/],
    ['a partial set',
      { 'AS using_is_unconditional': kitPolicies().slice(0, 3),
        "deptype IN ('o', 'r')": kitPolicyDependencies().slice(0, 3) },
      /PARTIAL set/],
    ['a granted name that now resolves to a VIEW, whose rows nothing here measures',
      { 'AS row_security_forced': productionTables({
        players: { table_kind: 'v', row_security_enabled: false } }) },
      /not an ordinary table: players is relkind "v"/],
  ]) {
    await assert.rejects(() => gate1.phaseVerify(scriptedClient(overrides), PHASE_VALUES, { log: () => {} }),
      expected, `verify must catch ${why}`);
  }

  // A caller that does not supply the derived policy name is a programming
  // error, not a role with no policies: it must throw rather than silently
  // classify every policy in the database as foreign. And it must throw BEFORE
  // any I/O, because nine catalog blocks read on the way to a refusal is work
  // done on a question the phase has already decided not to answer.
  const unvalidated = scriptedClient();
  await assert.rejects(
    () => gate1.phaseVerify(unvalidated, { ...PHASE_VALUES, policyName: undefined }, { log: () => {} }),
    /verify: expected a kit-owned policy name matching/
  );
  assert.deepEqual(unvalidated.seen, [], 'not one statement may run before the argument is validated');
});

test('verify tolerates the shdepend rows its OWN policies produce, and nothing else', async () => {
  // The four deptype 'r' rows are the intended state after grant-policies. The
  // allowance is anchored to policy OIDs verify has itself just matched field by
  // field, so it cannot be walked through by a row that merely claims to be a
  // policy.
  const clean = scriptedClient({
    'AS using_is_unconditional': kitPolicies(),
    "deptype IN ('o', 'r')": kitPolicyDependencies(),
  });
  await assert.doesNotReject(() => gate1.phaseVerify(clean, PHASE_VALUES, { log: () => {} }));

  const deps = kitPolicyDependencies();
  const rejects = {
    'an ownership row, which is never tolerated': [
      { ...deps[0], dependency_type: 'o', catalog_name: 'pg_class', is_policy_dependency: false }],
    // deptype and classid disagreeing is a row PostgreSQL should never write,
    // which is precisely why a fail-closed check has to reject it rather than
    // decide from whichever column it happened to read.
    'an OWNERSHIP row wearing a policy dependency\'s clothes': [
      { ...deps[0], dependency_type: 'o' }],
    'a policy OID verify did not just approve': [{ ...deps[0], object_oid: 99999 }],
    'a dependency in ANOTHER database wearing a local policy OID': [
      { ...deps[0], is_policy_dependency: false, database_name: 'some_other_database' }],
    'a policy dependency alongside the four expected ones': [
      ...deps, { ...deps[0], object_oid: 50505, policy_name: 'app_isolation', policy_table: 'players' }],
  };
  for (const [why, rows] of Object.entries(rejects)) {
    const client = scriptedClient({
      'AS using_is_unconditional': kitPolicies(),
      "deptype IN ('o', 'r')": rows,
    });
    await assert.rejects(() => gate1.phaseVerify(client, PHASE_VALUES, { log: () => {} }),
      /owns objects, or is named by an RLS policy this kit did not create/, `must reject ${why}`);
  }

  // With NO kit policies approved, a policy dependency has nothing to match
  // against and fails - so the tolerance cannot outlive the policies.
  const orphaned = scriptedClient({ "deptype IN ('o', 'r')": kitPolicyDependencies() });
  await assert.rejects(() => gate1.phaseVerify(orphaned, PHASE_VALUES, { log: () => {} }),
    /is named by an RLS policy this kit did not create/);
});

test('teardown names the drop-policies phase when policies are what block the drop', async () => {
  // The two phases run as DIFFERENT operators - drop-policies needs table
  // ownership, teardown needs CREATEROLE - so an abort that did not say which
  // command fixes it would read as a dead end to whoever is holding the admin
  // credential.
  const blocked = scriptedClient({ "deptype IN ('o', 'r')": kitPolicyDependencies() });
  await assert.rejects(() => gate1.phaseTeardown(blocked, PHASE_VALUES, { log: () => {} }),
    (err) => {
      assert.match(err.message, /ABORTED.*Nothing has been dropped/s);
      assert.match(err.message, /4 of these are RLS POLICIES naming the role/);
      assert.match(err.message, /public\.players: backtest_ro_pit01_select/);
      assert.match(err.message, /--phase drop-policies --database endzone_empire --role backtest_ro_pit01/);
      assert.match(err.message, /SQLSTATE 2BP01/);
      return true;
    });
  assert.equal(blocked.seen.map(sqlOnly).some((q) => /\bDROP\s+ROLE\b/i.test(q)), false,
    'nothing may be dropped');

  // An OWNERSHIP row gets the original message and no policy sentence: there is
  // no phase that fixes it, and suggesting one would be a lie.
  const owns = scriptedClient({
    "deptype IN ('o', 'r')": [{ dependency_type: 'o', catalog_name: 'pg_class', object_oid: 60001,
      database_name: 'endzone_empire', is_policy_dependency: false, policy_name: null,
      policy_schema: null, policy_table: null }],
  });
  await assert.rejects(() => gate1.phaseTeardown(owns, PHASE_VALUES, { log: () => {} }),
    (err) => {
      assert.match(err.message, /never auto-drops owned objects/);
      assert.equal(err.message.includes('drop-policies'), false,
        'an ownership dependency has no phase that fixes it');
      return true;
    });
});

test('the policy phases read the OWNER credential, and nothing else falls back to it', async () => {
  assert.equal(gate1.OWNER_ENV_VAR, 'BACKTEST_OWNER_DATABASE_URL');
  assert.deepEqual([...gate1.OWNER_PHASES], ['grant-policies', 'drop-policies']);
  assert.equal(gate1.readOwnerCredential({ BACKTEST_OWNER_DATABASE_URL: '  postgres://a/b  ' }),
    'postgres://a/b');
  for (const env of [{}, { BACKTEST_OWNER_DATABASE_URL: '   ' },
    { DATABASE_URL: 'postgres://app/x' }, { BACKTEST_ADMIN_DATABASE_URL: 'postgres://admin/x' }]) {
    assert.throws(() => gate1.readOwnerCredential(env),
      /BACKTEST_OWNER_DATABASE_URL is not set/);
  }
  assert.throws(() => gate1.readOwnerCredential({}), /NO fallback to DATABASE_URL/);

  // Through main: the policy phases refuse the ADMIN credential, and the other
  // three refuse the owner one. Neither substitutes for the other.
  const base = ['--database', 'endzone_empire', '--role', 'backtest_ro_pit01'];
  for (const phase of gate1.OWNER_PHASES) {
    await assert.rejects(
      () => gate1.main(['--phase', phase, ...base],
        { env: { BACKTEST_ADMIN_DATABASE_URL: 'postgres://admin:pw@db/endzone_empire' },
          out: { log: () => {} } }),
      /BACKTEST_OWNER_DATABASE_URL is not set/, `${phase} must not run on the admin credential`
    );
  }
  await assert.rejects(
    () => gate1.main(['--phase', 'teardown', ...base],
      { env: { BACKTEST_OWNER_DATABASE_URL: 'postgres://owner:pw@db/endzone_empire' },
        out: { log: () => {} } }),
    /BACKTEST_ADMIN_DATABASE_URL is not set/, 'teardown must not run on the owner credential'
  );
  // The policy phases need no expiry: a policy has none.
  await assert.rejects(
    () => gate1.main(['--phase', 'grant-policies', ...base], { env: {}, out: { log: () => {} } }),
    /BACKTEST_OWNER_DATABASE_URL is not set/,
    'the missing credential must be what stops it, not a missing --valid-until'
  );
});

test('the OWNER connection string is redacted from a mis-ordered argument too', () => {
  // Same hazard as the admin URL, same fix: it is registered with the redactor
  // from the environment, before argv is parsed. It is a production write
  // credential; the only thing that makes it less alarming than the admin one is
  // that it cannot create roles.
  const OWNER_PW = 'OwnerP4ss-CANARY-xyz';
  const url = `postgres://endzone_app:${OWNER_PW}@db.example.com/endzone_empire`;
  const env = { BACKTEST_OWNER_DATABASE_URL: url };
  const ok = ['--phase', 'grant-policies', '--database', 'endzone_empire', '--role', 'backtest_ro_x'];
  const swap = (flag, value) => ok.map((t, i) => (ok[i - 1] === flag ? value : t));

  return Promise.all(['--role', '--database'].map(async (flag) => {
    let error = null;
    await gate1.main(swap(flag, url), { env, out: { log: () => {} } }).catch((err) => { error = err; });
    assert.ok(error, `${flag}: expected a rejection`);
    for (const text of [error.message, error.stack || '']) {
      assert.equal(text.includes(OWNER_PW), false, `${flag}: the owner password leaked`);
      assert.equal(text.includes(url), false, `${flag}: the whole owner URL leaked`);
    }
  }));
});

test('--print-sql renders the policy phases, with an empty environment', async () => {
  for (const phase of gate1.OWNER_PHASES) {
    const lines = [];
    const code = await gate1.main(['--phase', phase, '--database', 'endzone_empire',
      '--role', 'backtest_ro_pit01', '--print-sql'], { env: {}, out: { log: (m) => lines.push(m) } });
    assert.equal(code, 0, `${phase} --print-sql must succeed with an empty environment`);
    const text = lines.join('\n');
    // The reviewer sees the real policy name and the real role, substituted.
    assert.match(text, /"backtest_ro_pit01_select"/);
    assert.match(text, /public\.player_season_stats/);
    assert.match(text, new RegExp(phase === 'grant-policies' ? 'CREATE POLICY' : 'DROP POLICY'));
  }
  // And the file map is the only route from a phase to a file.
  assert.deepEqual(Object.keys(gate1.PHASE_SQL_FILE).sort(), [...gate1.PHASES].sort());
});

test('the three files ask the SAME questions about tables, policies and dependencies', () => {
  // A verify that judged a policy by a different rule than the phase that
  // created it would bless something the grant phase would have refused, and a
  // drop aimed at a database the grant could not reach would remove policies
  // from the wrong cluster. Comparing the statements mechanically is the only
  // way that does not drift.
  const strip = (t) => sqlOnly(t).replace(/\s+/g, ' ').trim();
  const blocks = Object.fromEntries(SQL_FILES.map(
    (f) => [f, gate1.loadStatements(readSql(f), { label: f })]
  ));
  const same = (pairs, why) => {
    const rendered = pairs.map(([file, block]) => {
      const text = blocks[file].get(block);
      assert.ok(text, `${file} has no block ${block}`);
      return strip(text);
    });
    for (const one of rendered) assert.equal(one, rendered[0], why);
  };

  same([['grant-rls-policies.sql', 'policy_table_rls_state'],
    ['drop-rls-policies.sql', 'policy_table_rls_state'],
    ['verify-role.sql', 'verify_table_rls_state']].slice(0, 2),
  'the two policy phases must read the table state identically');
  same([['grant-rls-policies.sql', 'policy_table_policies'],
    ['drop-rls-policies.sql', 'policy_table_policies'],
    ['verify-role.sql', 'verify_table_policies']],
  'verify must judge a policy by exactly the statement the phases judge it by');
  same([['grant-rls-policies.sql', 'policy_preflight_context'],
    ['drop-rls-policies.sql', 'policy_preflight_context']],
  'the accident guard must be the same question in both policy phases');
  same([['grant-rls-policies.sql', 'policy_preflight_role_present'],
    ['drop-rls-policies.sql', 'policy_preflight_role_present']],
  'both phases must resolve the role the same way');
  same([['verify-role.sql', 'verify_no_ownership'],
    ['teardown-role.sql', 'teardown_check_ownership']],
  'verify and teardown must read the same dependencies, even though they decide differently');

  // verify_table_rls_state carries no ownership comparison, because verify runs
  // as the admin and reading the catalog needs no ownership. That is the ONE
  // intended difference, so it is pinned rather than left to drift.
  const verifyTables = sqlOnly(blocks['verify-role.sql'].get('verify_table_rls_state'));
  const grantTables = sqlOnly(blocks['grant-rls-policies.sql'].get('policy_table_rls_state'));
  assert.equal(/owner_is_connected_role/.test(verifyTables), false,
    'verify does not need ownership and must not assert it');
  assert.match(grantTables, /AS owner_is_connected_role/);
  for (const column of ['relrowsecurity', 'relforcerowsecurity', 'pg_get_userbyid']) {
    assert.ok(verifyTables.includes(column) && grantTables.includes(column),
      `both must read ${column}`);
  }
});

test('the policy SQL resolves identity from the catalog, not as constants', () => {
  // A scripted client returns whatever the fixture says, so the SQL could report
  // `true AS roles_are_exactly_the_role` and every JS-level test above would
  // still pass while the shape check became "any policy at all".
  for (const [file, block] of [
    ['grant-rls-policies.sql', 'policy_table_policies'],
    ['drop-rls-policies.sql', 'policy_table_policies'],
    ['verify-role.sql', 'verify_table_policies'],
  ]) {
    const sql = sqlOnly(gate1.loadStatements(readSql(file), { label: file }).get(block));
    // The role match is an OID ARRAY equality against the catalog, not a name.
    assert.match(sql,
      /\(p\.polroles = ARRAY\[\(SELECT oid FROM pg_roles WHERE rolname = :'role_name'\)\]::oid\[\]\)\s+AS roles_are_exactly_the_role/,
      `${block}: the role match must compare OID arrays`);
    assert.equal(/true\s+AS roles_are_exactly_the_role/.test(sql), false,
      `${block}: a constant true here would accept any policy`);
    assert.match(sql, /\(0::oid = ANY\(p\.polroles\)\)\s+AS applies_to_public/,
      `${block}: PUBLIC is oid 0 in polroles and must be tested for`);
    assert.equal(/false\s+AS applies_to_public/.test(sql), false);
    assert.match(sql, /\(pg_get_expr\(p\.polqual, p\.polrelid\) = 'true'\)\s+AS using_is_unconditional/);
    assert.match(sql, /\(p\.polwithcheck IS NULL\)\s+AS has_no_with_check/);
    assert.match(sql, /p\.polpermissive\s+AS policy_permissive/);
    assert.match(sql, /p\.polcmd\s+AS policy_command/);
    // pg_policy, not the pg_policies view: the view renders role NAMES.
    assert.match(sql, /FROM pg_policy p/);
    assert.equal(/FROM pg_policies/.test(sql), false);
    // And exactly the four granted tables, so a policy elsewhere cannot be read
    // as one of the kit's. EXACTLY, not "at least": an inclusion check here
    // passed with a fifth table injected into the list. ONE list, too - a
    // second one OR-ed on would widen the read past anything checked.
    assert.deepEqual(scopedTableLists(sql), [[...gate1.EXPECTED_TABLES].sort()],
      `${block}: must scope to EXACTLY the four granted tables, in exactly one IN-list`);
  }

  // The two policy phases authorize themselves on OWNERSHIP, and ownership must
  // be resolved from pg_class rather than reported as a constant: a scripted
  // client would return whatever the fixture said either way, and the phase
  // would then be authorized by the connection string it was handed.
  for (const file of ['grant-rls-policies.sql', 'drop-rls-policies.sql']) {
    const blocks = gate1.loadStatements(readSql(file), { label: file });
    const tables = sqlOnly(blocks.get('policy_table_rls_state'));
    assert.match(tables,
      /\(pg_get_userbyid\(c\.relowner\) = current_user\)\s+AS owner_is_connected_role/,
      `${file}: ownership must be compared against the catalog`);
    assert.equal(/true\s+AS owner_is_connected_role/.test(tables), false,
      `${file}: a constant true here would let any operator create policies`);
    assert.match(tables, /c\.relrowsecurity\s+AS row_security_enabled/);
    assert.match(tables, /c\.relforcerowsecurity\s+AS row_security_forced/);

    // The connected role is reported from the session, not asserted as a name.
    const context = sqlOnly(blocks.get('policy_preflight_context'));
    assert.match(context, /current_user\s+AS connected_role/,
      `${file}: the connected role must come from the session`);
    assert.match(context, /current_database\(\)\s+AS database_name/,
      `${file}: the accident guard must ask the server which database it is`);

    // And the role-existence preflight must actually filter on the role.
    const present = sqlOnly(blocks.get('policy_preflight_role_present'));
    assert.match(present, /FROM pg_roles\s+WHERE rolname = :'role_name';/,
      `${file}: the role preflight must resolve the role it was given`);
  }

  // The dependency blocks must resolve the policy for the CURRENT database only:
  // pg_policy OIDs are per-database and pg_shdepend spans the cluster, so
  // without the dbid test a policy in another database could collide with a
  // local OID and be waved through as one of ours.
  for (const [file, block] of [
    ['verify-role.sql', 'verify_no_ownership'],
    ['teardown-role.sql', 'teardown_check_ownership'],
  ]) {
    const sql = sqlOnly(gate1.loadStatements(readSql(file), { label: file }).get(block));
    assert.match(sql, /\(s\.classid = 'pg_policy'::regclass\s+AND s\.dbid = \(SELECT oid FROM pg_database WHERE datname = current_database\(\)\)\)\s+AS is_policy_dependency/,
      `${block}: is_policy_dependency must require the current database`);
    assert.match(sql, /LEFT JOIN pg_policy pol/,
      `${block}: an inner join would discard the unresolvable rows a fail-closed check exists to see`);
    assert.match(sql, /AND s\.deptype IN \('o', 'r'\)/);
    assert.equal(/true\s+AS is_policy_dependency/.test(sql), false);
  }
});

test('the PG fixture never sweeps an owner role whose REASSIGN failed', () => {
  // `dropOwnerRole` lives in backtestGate1Role.pg.test.js, which needs a
  // disposable Postgres and is a visible SKIP everywhere else, so the ordering
  // that keeps it safe cannot be proven by running it here. It is pinned as
  // STRUCTURE instead, because the failure it guards against is both
  // catastrophic and silent: that fixture deliberately makes a role the OWNER of
  // players, player_stats, player_season_stats and nfl_games, and a
  // `DROP OWNED BY` reached with the tables still owned would DELETE THEM from
  // the CI database. `REASSIGN OWNED BY` moves them off first; if it fails, the
  // sweep must not run, and the leftover role is somebody else's problem.
  const src = fs.readFileSync(path.join(__dirname, 'backtestGate1Role.pg.test.js'), 'utf8');
  const found = /async function dropOwnerRole\([^)]*\)\s*\{([\s\S]*?)\n {2}\}/.exec(src);
  assert.ok(found, 'dropOwnerRole must still exist in the PG lifecycle suite');
  const body = found[1];

  // The REASSIGN result is inspected. `.catch(() => {})` is the file's idiom for
  // cleanup that may fail harmlessly, and it is exactly wrong on this statement.
  assert.equal(/REASSIGN OWNED BY[^\n]*\)\s*\.catch\(/.test(body), false,
    'a swallowed REASSIGN is what let the sweep run over four still-owned tables');
  assert.match(body, /catch \(err\)/,
    'the REASSIGN failure must be reported, not discarded');
  // ...and the sweep is gated on it having succeeded.
  assert.match(body, /if \(reassigned\) \{\s*\n\s*await client\.query\(`DROP OWNED BY /,
    'DROP OWNED BY must be reachable only when the REASSIGN succeeded');
  assert.equal(/\n {6}await client\.query\(`DROP OWNED BY /.test(body), false,
    'an unguarded DROP OWNED BY at the top level of this helper deletes the fixture tables');

  // The sibling helper keeps its unconditional sweep on purpose: forceDrop runs
  // as the bootstrap superuser and has to clear arbitrary residue, including
  // grants the kit never made. That is safe ONLY because nothing that owns a
  // table is allowed to reach it - which is a routing property, asserted below,
  // not a property of the helper itself. Pinned so that "these two differ"
  // stays a decision rather than looking like drift.
  const other = /async function forceDrop\([^)]*\)\s*\{([\s\S]*?)\n {2}\}/.exec(src);
  assert.ok(other, 'forceDrop must still exist');
  assert.match(other[1], /await client\.query\(`DROP OWNED BY [^\n]*\)\.catch\(/,
    'forceDrop sweeps unconditionally, which is why an owner role must never reach it');
  assert.equal(/REASSIGN OWNED BY/.test(other[1]), false);

  // THE ROUTING. The before-hook sweeps every `backtest_ro_pgtest_%` role left
  // by a crashed run, and a leftover OWNER role is exactly what dropOwnerRole's
  // failed-REASSIGN path deliberately leaves behind. Handed to forceDrop, that
  // role's four still-owned tables would be deleted one run later - the same
  // catastrophe the gate above prevents, arriving through the cleanup path
  // instead of the teardown one.
  const hook = /test\.before\(async \(\) => \{([\s\S]*?)\n {2}\}\);/.exec(src);
  assert.ok(hook, 'the PG suite must still sweep leftovers in a before-hook');
  assert.match(hook[1],
    /if \(row\.rolname\.startsWith\(OWNER_ROLE_PREFIX\)\) await dropOwnerRole\(row\.rolname\);/,
    'an owner-prefixed leftover must be routed to the GATED helper');
  assert.match(hook[1], /else await forceDrop\(row\.rolname\);/,
    'and everything else, which owns nothing, to the unconditional one');
  assert.equal((hook[1].match(/forceDrop\(/g) || []).length, 1,
    'exactly one forceDrop call, and it is the else branch: a second one would be unrouted');

  // The prefix is DERIVED and shared, so the name a test mints and the name the
  // sweep routes on cannot drift apart, and so the hook's LIKE still finds it.
  assert.match(src, /const OWNER_ROLE_PREFIX = `\$\{ROLE_PREFIX\}own_`;/,
    'the owner prefix must be derived from ROLE_PREFIX, or the sweep LIKE stops matching it');
  assert.match(src, /const nextOwner = \(\) => gate1\.assertRoleName\(`\$\{OWNER_ROLE_PREFIX\}/,
    'owner roles must be MINTED from the same prefix the sweep routes on');
});

test('every catalog read is scoped to EXACTLY the four granted tables', () => {
  // The lists below were inclusion-checked only, and a fifth table injected into
  // all of them left the whole suite green. What that would buy an attacker, or
  // a careless edit, is a widened read surface with no error anywhere: the
  // policy blocks would report a foreign policy on a table the kit neither
  // grants nor describes, the RLS-state blocks would put that table into
  // verify's per-table report as though it were granted, and create's preflight
  // would insist it exist before any DDL ran.
  const reads = [
    ['create-role.sql', 'preflight_objects_present'],
    ['grant-rls-policies.sql', 'policy_table_rls_state'],
    ['grant-rls-policies.sql', 'policy_table_policies'],
    ['drop-rls-policies.sql', 'policy_table_rls_state'],
    ['drop-rls-policies.sql', 'policy_table_policies'],
    ['verify-role.sql', 'verify_table_rls_state'],
    ['verify-role.sql', 'verify_table_policies'],
  ];
  for (const [file, block] of reads) {
    const text = gate1.loadStatements(readSql(file), { label: file }).get(block);
    assert.ok(text, `${file} has no block ${block}`);
    // One list, holding exactly the four. A second `OR c.relname IN (...)`
    // appended to the same statement makes this a two-element array and fails.
    assert.deepEqual(scopedTableLists(sqlOnly(text)), [[...gate1.EXPECTED_TABLES].sort()],
      `${file}:${block} must scope to EXACTLY the four granted tables, in exactly one IN-list`);
  }

  // And no OTHER statement in the kit may carry a table list of its own: an
  // eighth catalog read scoped somewhere else would be covered by nothing above,
  // which is precisely the gap the list is enumerated to close.
  for (const file of SQL_FILES) {
    for (const [name, text] of gate1.loadStatements(readSql(file), { label: file })) {
      if (scopedTableLists(sqlOnly(text)).length === 0) continue;
      assert.ok(reads.some(([f, b]) => f === file && b === name),
        `${file}:${name} scopes a catalog read to a table list nothing checks`);
    }
  }
});

test('readSqlFile refuses anything but a plain .sql name in the kit directory', () => {
  assert.match(gate1.readSqlFile('create-role.sql'), /CREATE ROLE/);
  for (const bad of ['../../package.json', '/etc/passwd', 'create-role.sql\0', 'x.js',
    'sub/dir.sql', '..\\create-role.sql']) {
    assert.throws(() => gate1.readSqlFile(bad), /refusing to read/, `${bad} must be refused`);
  }
});
