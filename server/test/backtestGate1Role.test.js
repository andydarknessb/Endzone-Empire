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

const VALUES = {
  roleName: 'backtest_ro_pit01',
  databaseName: 'endzone_empire',
  validUntil: '2026-08-06T00:00:00Z',
  passwordVerifier: 'SCRAM-SHA-256$4096:abc$def:ghi',
  roleOid: '16471',
};

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
          // Exactly what a driver does: echo the statement it choked on.
          throw new Error(`syntax error at or near "x"\nSTATEMENT: ${sql}`);
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
        if (sql.includes("p.proname = 'fn_normalize_nfl_team'")) {
          return { rows: [{ schema_name: 'public', function_name: 'fn_normalize_nfl_team',
            identity_arguments: 'text' }] };
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
      'verify_no_ownership', 'verify_no_memberships']],
    ['teardown-role.sql', ['teardown_role_present', 'teardown_check_ownership',
      'teardown_check_memberships', 'teardown_terminate_sessions', 'teardown_revoke',
      'teardown_reset_settings', 'teardown_drop_owned', 'teardown_drop_role',
      'teardown_confirm_absent']],
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

test('ONLY the six allowlisted placeholders can reach a statement', () => {
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

  for (const file of ['create-role.sql', 'verify-role.sql', 'teardown-role.sql']) {
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
  for (const file of ['create-role.sql', 'verify-role.sql', 'teardown-role.sql']) {
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
  // DROP OWNED BY is the sweeper, but it must never be reached with objects
  // owned - the ordering is what makes it safe.
  assert.ok([...teardown.keys()].indexOf('teardown_check_ownership')
    < [...teardown.keys()].indexOf('teardown_drop_owned'),
  'the ownership check must come before DROP OWNED BY');
  assert.equal(/DROP\s+ROLE[^;]*CASCADE/i.test(sqlOnly([...teardown.values()].join('\n'))), false);
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
    'current_database()': [{ database_name: 'endzone_empire', admin_role: 'admin',
      admin_is_superuser: true, admin_can_create_role: true }],
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
    'aclexplode(p.proacl)': [{ schema_name: 'public', object_name: 'fn_normalize_nfl_team',
      identity_arguments: 'text', privilege_type: 'EXECUTE', is_grantable: false }],
    'aclexplode(n.nspacl)': [{ object_name: 'public', privilege_type: 'USAGE', is_grantable: false }],
    'aclexplode(d.datacl)': [{ object_name: 'endzone_empire', privilege_type: 'CONNECT',
      is_grantable: false }],
    'pg_default_acl': [],
    "deptype IN ('o', 'r')": [],
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
};

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

test('readSqlFile refuses anything but a plain .sql name in the kit directory', () => {
  assert.match(gate1.readSqlFile('create-role.sql'), /CREATE ROLE/);
  for (const bad of ['../../package.json', '/etc/passwd', 'create-role.sql\0', 'x.js',
    'sub/dir.sql', '..\\create-role.sql']) {
    assert.throws(() => gate1.readSqlFile(bad), /refusing to read/, `${bad} must be refused`);
  }
});
