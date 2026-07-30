/* eslint-disable no-console */
'use strict';

/**
 * The GATED entry point for Gate 1: creating, verifying and tearing down the
 * temporary read-only role that Gate 2's snapshot extraction runs as.
 *
 * WHERE THE ACTUAL AUTHORIZATION ARTIFACT LIVES
 *
 * Not here. The complete set of privilege mutations is in
 * `server/scripts/gate1/create-role.sql`, and its exact inverse is in
 * `teardown-role.sql`. This file reads those files and substitutes validated
 * identifiers and timestamps into their psql-style placeholders. It does not
 * assemble a privilege list, a role flag, a GRANT target or a REVOKE target in
 * JavaScript, and it cannot: `renderStatement` refuses any placeholder outside
 * a fixed allowlist of six names, so there is no route by which a value could
 * become a privilege. A reviewer approving Gate 1 reads the SQL.
 *
 * WHY NOT UNDER scripts/backtest/
 *
 * Same reason as `run-backtest-extraction.js`: nothing under `scripts/backtest/`
 * may reach a pool, a `server/services/*` module, or `process.env`, and that is
 * asserted by test over the whole tree. This needs a credential and a database
 * connection, so it lives out here with the other plugs.
 *
 * CREDENTIALS ARE ENVIRONMENT-ONLY, AND THERE ARE THREE OF THEM
 *
 *   BACKTEST_ADMIN_DATABASE_URL  the ADMIN connection. Creating a role needs
 *                                CREATEROLE or superuser, which is the most
 *                                dangerous credential in this whole project. No
 *                                fallback to DATABASE_URL or PG*: a shell that
 *                                happens to hold the application's credentials
 *                                must not be able to run this by accident, and
 *                                the application role should not be able to run
 *                                it at all.
 *   BACKTEST_OWNER_DATABASE_URL  the TABLE OWNER connection, used by the two
 *                                policy phases and by nothing else. CREATE
 *                                POLICY and DROP POLICY are gated on ownership
 *                                of the table, which CREATEROLE is not, so the
 *                                admin credential above CANNOT perform them.
 *                                Also no fallback to DATABASE_URL, even though
 *                                the owner is the application role: a phase that
 *                                mutates production row-visibility has to be
 *                                aimed deliberately, and every application shell
 *                                already has DATABASE_URL set.
 *   BACKTEST_RO_ROLE_PASSWORD    the password for the role being CREATED,
 *                                generated out of band by the operator.
 *
 * None of them may arrive on argv, where `ps`, /proc/<pid>/cmdline and shell
 * history can all read it.
 *
 * THE POLICY PHASES
 *
 * `--phase grant-policies` and `--phase drop-policies` exist because the four
 * SELECT grants were not sufficient: three of the four tables have row-level
 * security enabled with no policies, which is deny-all for every non-owner, so
 * the role read zero rows with every privilege correctly in place. See
 * `gate1/grant-rls-policies.sql` for the finding and for why BYPASSRLS is not
 * the answer.
 *
 * THE PASSWORD NEVER BECOMES SQL
 *
 * `CREATE ROLE x PASSWORD 'plaintext'` puts the plaintext into the server log
 * whenever `log_statement` is on, into `pg_stat_activity` while it runs, and
 * into any error that echoes the statement. Log retention typically outlives a
 * seven-day role by a wide margin, so the password would outlive the role.
 *
 * Instead the SCRAM-SHA-256 verifier is computed CLIENT-SIDE here (RFC 7677 /
 * RFC 5802) and only the verifier is sent. PostgreSQL stores a well-formed
 * verifier verbatim. The verifier is not the password and cannot be replayed as
 * one over the wire, but it is still key material, so it is redacted from every
 * line this file prints and from every error it throws, alongside the password
 * itself and the admin connection string.
 *
 * AUTHORIZATION. Running any phase of this against production is **Gate 1** of
 * three separate approvals, and requires the user's explicit approval at the
 * time. Nothing may run it automatically. See `server/scripts/gate1/README.md`
 * for the operator sequence.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const pg = require('pg');

const { sslForConnection } = require('../modules/dbSsl');

/** The ONE variable the admin credential may arrive in. No fallback, by design. */
const ADMIN_ENV_VAR = 'BACKTEST_ADMIN_DATABASE_URL';
/** The ONE variable the table-owner credential may arrive in. Same design. */
const OWNER_ENV_VAR = 'BACKTEST_OWNER_DATABASE_URL';
/** The ONE variable the new role's password may arrive in. */
const PASSWORD_ENV_VAR = 'BACKTEST_RO_ROLE_PASSWORD';

const SQL_DIR = path.join(__dirname, 'gate1');
const PHASES = Object.freeze(['create', 'verify', 'teardown', 'grant-policies', 'drop-policies']);
/**
 * The phases that connect as the TABLE OWNER instead of the admin. CREATE POLICY
 * and DROP POLICY require ownership of the table and nothing else does, so this
 * is also the complete list of phases the admin credential cannot run.
 */
const OWNER_PHASES = Object.freeze(['grant-policies', 'drop-policies']);
/** Which .sql file each phase reads. `readSqlFile` re-validates the name. */
const PHASE_SQL_FILE = Object.freeze({
  create: 'create-role.sql',
  verify: 'verify-role.sql',
  teardown: 'teardown-role.sql',
  'grant-policies': 'grant-rls-policies.sql',
  'drop-policies': 'drop-rls-policies.sql',
});

/**
 * The role name pattern. Narrow on purpose: the prefix makes every role this
 * kit can touch identifiable at a glance in `\du`, and the character class
 * leaves nothing that could survive quoting as anything but an identifier.
 */
const ROLE_PATTERN = /^backtest_ro_[a-z0-9_]{1,40}$/;
/**
 * The policy name is DERIVED from the role, never supplied: `<role>_select`. It
 * is not an operator input, so this pattern exists to catch a caller that built
 * one by hand rather than to sanitize argv.
 *
 * No separate truncation guard is needed. ROLE_PATTERN bounds a role at
 * `backtest_ro_` (12) plus at most 40 characters, and `_select` adds 7, so the
 * longest policy name this kit can produce is 59 - inside PostgreSQL's 63-byte
 * identifier limit, where a truncated name would make every later check target
 * the wrong policy. A test pins that arithmetic.
 */
const POLICY_NAME_SUFFIX = '_select';
const POLICY_PATTERN = /^backtest_ro_[a-z0-9_]{1,40}_select$/;
const DATABASE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
/** ISO-8601 with an EXPLICIT timezone. A naive timestamp means "whose clock?". */
const VALID_UNTIL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
/** A role that outlives the work it exists for is a permanent credential. */
const MAX_VALID_UNTIL_DAYS = 7;
/** Below this a generated password is not what "generated out of band" means. */
const MIN_PASSWORD_LENGTH = 24;
/** PostgreSQL's own default. Matching it keeps the verifier unsurprising. */
const SCRAM_ITERATIONS = 4096;
const SCRAM_SALT_BYTES = 16;

/**
 * What the role is allowed to hold, mirroring create-role.sql. These are
 * comparison targets for the enumeration checks, NOT inputs to any statement -
 * no value below is ever interpolated into SQL. `backtestGate1Role.test.js`
 * asserts that this list and the GRANT statements in create-role.sql name the
 * same four tables, so the two cannot drift apart silently.
 */
const EXPECTED_TABLES = Object.freeze(['nfl_games', 'player_season_stats', 'player_stats', 'players']);
/**
 * `args` is the ARGUMENT-TYPE signature, as `to_regprocedure` and `GRANT
 * EXECUTE ON FUNCTION` both spell it. It is used to build human-readable
 * messages, and it is deliberately NOT compared against
 * `pg_get_function_identity_arguments`, which renders parameter NAMES too: the
 * real function is `fn_normalize_nfl_team(raw_team text)`, whose identity
 * string is "raw_team text". A string comparison here was a live defect that
 * failed the preflight against a correct database. Resolution is by OID.
 */
const EXPECTED_FUNCTION = Object.freeze({ name: 'fn_normalize_nfl_team', args: 'text' });
/**
 * `pg_policy.polcmd` for a `FOR SELECT` policy. The catalog stores one
 * character: 'r' SELECT, 'a' INSERT, 'w' UPDATE, 'd' DELETE, '*' ALL. Compared
 * against the catalog value rather than a rendered command name, which is what
 * `pg_policies.cmd` would give.
 */
const EXPECTED_POLICY_COMMAND = 'r';

// ---------------------------------------------------------------------------
// Secrets: reading them, and keeping them out of everything
// ---------------------------------------------------------------------------

/**
 * Build a redactor over every secret this process holds. Applied to every line
 * printed and every error message raised, so that a secret cannot escape by way
 * of a driver error that happens to quote a statement, or a stack trace, or an
 * operator pasting output into a review.
 *
 * `redact.add(secret)` registers a secret discovered later - the SCRAM verifier
 * is derived part-way through a run, and must be redacted from that moment on.
 * This exists so that the redactor can be built at the very TOP of `main`, from
 * the environment alone, before a single argument is parsed. An earlier version
 * built it after argv validation, and a review demonstrated four separate
 * cleartext leaks: a password typed as a stray positional, and a password
 * mis-ordered into --role, --database or --valid-until, each echoed verbatim by
 * the very validation that rejected it. Nothing may run before the redactor.
 *
 * Secrets shorter than 8 characters are ignored: replacing a two-character
 * string everywhere would corrupt the output into uselessness, and anything
 * that short is not a credential this kit accepts.
 */
function makeRedactor(secrets = []) {
  const real = [];
  function redact(value) {
    let text = typeof value === 'string' ? value : String(value == null ? '' : value);
    for (const secret of real) text = text.split(secret).join('[REDACTED]');
    return text;
  }
  redact.add = (secret) => {
    if (typeof secret === 'string' && secret.length >= 8 && !real.includes(secret)) {
      real.push(secret);
      // Longest first, so a URL is replaced whole before the password inside it
      // turns it into a half-redacted fragment.
      real.sort((a, b) => b.length - a.length);
    }
    return redact;
  };
  for (const secret of secrets) redact.add(secret);
  return redact;
}

/**
 * Pure: an argument safe to put in an error message.
 *
 * Ported from `scripts/backtest/extract-snapshot.js`, where it was added after
 * the Phase-1 review for exactly this hazard. A parser that echoes whatever it
 * did not recognize will happily print a password somebody typed in the wrong
 * position into a terminal, a log, or a CI transcript. Recognized flag NAMES
 * are safe and useful to echo; anything else is described rather than quoted.
 *
 * This is the belt to the redactor's braces: the redactor only knows secrets it
 * has been told about, and a password typed on argv but never exported is a
 * secret nothing in the process has ever seen.
 */
function redactArgument(token) {
  const text = String(token == null ? '' : token);
  return /^--[a-z0-9-]+$/.test(text) ? text : `<redacted ${text.length}-character non-flag argument>`;
}

/** Extract the password from a connection URL so it is redacted on its own too. */
function passwordFromUrl(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return parsed.password ? decodeURIComponent(parsed.password) : null;
  } catch {
    return null;
  }
}

function readAdminCredential(env) {
  const value = env[ADMIN_ENV_VAR];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  const hasAppUrl = !!(env.DATABASE_URL || env.DATABASE_URL_RUNTIME || env.PGUSER || env.PGHOST);
  throw new Error(
    `${ADMIN_ENV_VAR} is not set. Gate 1 connects with a credential that can CREATE ROLE, and it `
    + 'is read from that one environment variable - never from the command line, where `ps` and '
    + 'shell history can read it.'
    + (hasAppUrl
      ? ' DATABASE_URL (or PG*) IS set in this environment and is deliberately NOT used as a '
        + 'fallback. That is the application role. If it can create roles, that is a finding in '
        + 'itself; either way, the privilege escalation path from "the app is running" to "a new '
        + 'login role exists" must not be one environment variable wide.'
      : '')
  );
}

/**
 * Read the TABLE OWNER credential, for the two policy phases.
 *
 * Separate from the admin credential because the two are genuinely different
 * authorities that neither implies nor substitutes for the other: CREATEROLE
 * cannot CREATE POLICY on a table it does not own, and the application role that
 * does own the tables cannot create a login role. Nothing about running one
 * phase should put the other's credential in the process.
 *
 * No fallback to DATABASE_URL, and the reason is different from the admin case.
 * There it is that the app credential must not be able to create roles. Here the
 * owner IS the app credential in production, so the argument is about intent
 * rather than privilege: every application shell already has DATABASE_URL set,
 * and a phase that changes what production rows a login role can see must be
 * something the operator exported on purpose.
 */
function readOwnerCredential(env) {
  const value = env[OWNER_ENV_VAR];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  throw new Error(
    `${OWNER_ENV_VAR} is not set. The policy phases connect as the OWNER of the four granted `
    + 'tables, because CREATE POLICY and DROP POLICY are gated on table ownership and the Gate 1 '
    + `admin credential (${ADMIN_ENV_VAR}) does not have it. It is read from that one environment `
    + 'variable, never from the command line, and there is deliberately NO fallback to DATABASE_URL '
    + 'or PG* even though the owner is the application role: this phase changes which production '
    + 'rows a login role can read, and it has to be aimed on purpose rather than picked up from '
    + 'whatever a shell happened to have exported.'
  );
}

/**
 * Read the password for the role being created.
 *
 * PRINTABLE ASCII IS REQUIRED, and this is a correctness constraint rather than
 * a policy one. SCRAM (RFC 7677) specifies that the password is SASLprep'd
 * before key derivation, and PostgreSQL applies SASLprep server-side when it
 * hashes a plaintext password. This file computes the verifier WITHOUT a
 * SASLprep implementation, which is exactly equivalent for printable ASCII and
 * NOT equivalent otherwise. A password containing, say, a non-breaking space
 * would produce a verifier here that the operator's own password could not
 * later authenticate against - a failure that would surface at Gate 2 as an
 * inexplicable authentication error. Refusing the input is the honest fix.
 */
function readRolePassword(env) {
  const value = env[PASSWORD_ENV_VAR];
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `${PASSWORD_ENV_VAR} is not set. Generate one out of band (for example `
      + '`openssl rand -base64 33`), export it, and do not pass it on the command line.'
    );
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `${PASSWORD_ENV_VAR} is ${value.length} characters; at least ${MIN_PASSWORD_LENGTH} are `
      + 'required. This is a production credential that will be typed into no prompt and '
      + 'remembered by no one, so there is no reason for it to be short.'
    );
  }
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw new Error(
      `${PASSWORD_ENV_VAR} must contain only printable ASCII with no spaces. The SCRAM verifier `
      + 'is computed here without a SASLprep implementation, which is equivalent to SASLprep for '
      + 'printable ASCII and only for printable ASCII; accepting anything else would silently '
      + 'produce a verifier the password cannot authenticate against. A leading or trailing space '
      + 'is usually a stray shell quote, and a newline is usually `echo` without -n.'
    );
  }
  return value;
}

/**
 * The SCRAM-SHA-256 verifier, per RFC 5802 section 3 and RFC 7677:
 *
 *   SaltedPassword = PBKDF2-HMAC-SHA256(password, salt, iterations, dkLen 32)
 *   ClientKey      = HMAC-SHA256(SaltedPassword, "Client Key")
 *   StoredKey      = SHA256(ClientKey)
 *   ServerKey      = HMAC-SHA256(SaltedPassword, "Server Key")
 *
 * stored by PostgreSQL as
 *
 *   SCRAM-SHA-256$<iterations>:<salt b64>$<StoredKey b64>:<ServerKey b64>
 *
 * `backtestGate1Role.test.js` pins this against the published RFC 7677 test
 * vector, by reconstructing that vector's ClientProof and ServerSignature from
 * the StoredKey and ServerKey this function derives. Both must match the
 * values printed in the RFC, which checks both keys rather than just re-running
 * the same arithmetic and agreeing with itself.
 */
function scramVerifier(password, { iterations = SCRAM_ITERATIONS, salt = null } = {}) {
  if (typeof password !== 'string' || password === '') throw new Error('a password is required');
  if (!Number.isInteger(iterations) || iterations < 4096) {
    throw new Error(`SCRAM iterations must be an integer of at least 4096, got ${iterations}`);
  }
  const saltBytes = salt || crypto.randomBytes(SCRAM_SALT_BYTES);
  const saltedPassword = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), saltBytes, iterations, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${saltBytes.toString('base64')}`
    + `$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Validation. Nothing reaches SQL that has not been through here.
// ---------------------------------------------------------------------------

function assertRoleName(value) {
  if (typeof value !== 'string' || !ROLE_PATTERN.test(value)) {
    throw new Error(
      `--role must match ${ROLE_PATTERN} (lowercase, the backtest_ro_ prefix, and nothing that `
      + `could survive quoting as anything but an identifier); got ${JSON.stringify(value)}`
    );
  }
  if (value.length > 63) {
    throw new Error(`--role is ${value.length} characters; PostgreSQL truncates identifiers at 63, `
      + 'and a truncated role name would make every later check target the wrong role');
  }
  return value;
}

/**
 * The policy name, which the runner DERIVES rather than accepts. `policyNameFor`
 * is the only producer, and this is the only thing that lets one reach a
 * statement, so a value that fails here means a caller assembled a policy name
 * by hand instead of deriving it from an already-validated role.
 */
function assertPolicyName(value, { label = 'policy name' } = {}) {
  if (typeof value !== 'string' || !POLICY_PATTERN.test(value)) {
    throw new Error(
      `${label}: expected a kit-owned policy name matching ${POLICY_PATTERN}; got `
      + `${JSON.stringify(value)}. The policy name is derived from --role as <role>${POLICY_NAME_SUFFIX} `
      + 'rather than supplied, so every policy this kit can create or drop belongs to exactly one '
      + 'role and is identifiable as the kit\'s at a glance.'
    );
  }
  return value;
}

/** The one producer of a policy name. Input must already be a validated role. */
function policyNameFor(roleName) {
  return assertPolicyName(`${assertRoleName(roleName)}${POLICY_NAME_SUFFIX}`);
}

function assertDatabaseName(value) {
  if (typeof value !== 'string' || !DATABASE_PATTERN.test(value)) {
    throw new Error(`--database must match ${DATABASE_PATTERN}; got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * A role OID, read back from the catalog and about to be substituted into the
 * teardown confirmation. It never comes from argv, but it is validated on the
 * same terms as everything else that reaches a statement: the allowlist in
 * `renderStatement` makes no distinction between a value an operator typed and
 * a value a query returned, and neither should this.
 */
function assertRoleOid(value, { label = 'role oid' } = {}) {
  const text = String(value == null ? '' : value);
  if (!/^[1-9]\d{0,9}$/.test(text)) {
    throw new Error(`${label}: expected a positive integer OID, got ${JSON.stringify(value)}`);
  }
  return text;
}

/**
 * The expiry. Bounded on BOTH sides: a past timestamp creates a role that
 * cannot log in (and would waste a production Gate on nothing), and an
 * unbounded future one creates a permanent credential wearing a temporary
 * credential's name, which is worse than an honestly permanent one because
 * nobody goes looking for it.
 */
function assertValidUntil(value, { now = new Date() } = {}) {
  if (typeof value !== 'string' || !VALID_UNTIL_PATTERN.test(value)) {
    throw new Error(
      '--valid-until must be an ISO-8601 timestamp with an explicit timezone, for example '
      + `2026-08-02T00:00:00Z; got ${JSON.stringify(value)}. A timestamp without a zone means `
      + "\"whose clock?\", and the answer would be the database server's, not the operator's."
    );
  }
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) throw new Error(`--valid-until is not a real date: ${JSON.stringify(value)}`);
  const ms = when.getTime() - now.getTime();
  if (ms <= 0) {
    throw new Error(
      `--valid-until (${value}) is not in the future. A role created already-expired cannot log `
      + 'in, so Gate 2 would fail and a production Gate would have been spent for nothing.'
    );
  }
  const maxMs = MAX_VALID_UNTIL_DAYS * 24 * 60 * 60 * 1000;
  if (ms > maxMs) {
    throw new Error(
      `--valid-until (${value}) is ${(ms / 86400000).toFixed(1)} days away; the maximum is `
      + `${MAX_VALID_UNTIL_DAYS}. The extraction is one run of a few minutes. Anything longer is a `
      + 'standing production read credential, which is the thing this whole kit exists to avoid.'
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Rendering: the ONLY path from a value to a statement
// ---------------------------------------------------------------------------

/** A quoted SQL identifier. Input is pattern-validated; this is the second lock. */
function quoteIdent(value) {
  if (typeof value !== 'string' || value === '' || /["\0]/.test(value)) {
    throw new Error(`refusing to quote ${JSON.stringify(value)} as an identifier`);
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * A quoted SQL string literal. Backslashes are REFUSED rather than escaped:
 * whether a backslash in a literal is an escape depends on
 * `standard_conforming_strings`, which is a server setting this file does not
 * control. Nothing it is asked to quote legitimately contains one.
 */
function quoteLiteral(value) {
  if (typeof value !== 'string' || value === '' || /[\\\0]/.test(value)) {
    throw new Error(`refusing to quote ${JSON.stringify(value)} as a literal`);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Split a .sql file into its named `-- @statement: name` blocks, in order. */
function loadStatements(sqlText, { label = 'sql' } = {}) {
  const blocks = new Map();
  const pattern = /^--[ \t]*@statement:[ \t]*([a-z0-9_]+)[ \t]*$/gm;
  const marks = [...sqlText.matchAll(pattern)];
  if (marks.length === 0) throw new Error(`${label}: no "-- @statement:" blocks found`);
  marks.forEach((mark, i) => {
    const name = mark[1];
    if (blocks.has(name)) throw new Error(`${label}: duplicate statement block ${JSON.stringify(name)}`);
    const start = mark.index + mark[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : sqlText.length;
    const body = sqlText.slice(start, end).trim();
    if (body === '') throw new Error(`${label}: statement block ${JSON.stringify(name)} is empty`);
    blocks.set(name, body);
  });
  return blocks;
}

/**
 * Substitute the psql-style placeholders, and ONLY those.
 *
 * `:'name'` takes a string literal, `:"name"` takes an identifier, and the name
 * must be on the fixed allowlist below. Every placeholder in the text is matched
 * by one regex and resolved through that allowlist, so an unrecognised one is an
 * error rather than text that survives into a statement - which is what stops a
 * future edit to a .sql file from introducing an unvalidated substitution point.
 */
function renderStatement(text, values, { label = 'statement' } = {}) {
  const allowed = new Map([
    ['role_name', { kind: 'literal', value: values.roleName }],
    ['role_ident', { kind: 'ident', value: values.roleName }],
    ['database_name', { kind: 'literal', value: values.databaseName }],
    ['database_ident', { kind: 'ident', value: values.databaseName }],
    ['valid_until', { kind: 'literal', value: values.validUntil }],
    ['password_verifier', { kind: 'literal', value: values.passwordVerifier }],
    ['role_oid', { kind: 'literal', value: values.roleOid }],
    // Derived from roleName by policyNameFor, never taken from argv. There is no
    // literal form: the policy name reaches SQL only as the identifier being
    // created or dropped, and the catalog reads match policies by comparing the
    // name in JavaScript rather than filtering on it in SQL.
    ['policy_ident', { kind: 'ident', value: values.policyName }],
  ]);
  return text.replace(/:(['"])([a-zA-Z_][a-zA-Z0-9_]*)\1/g, (whole, quote, name) => {
    const spec = allowed.get(name);
    const wantKind = quote === '"' ? 'ident' : 'literal';
    if (!spec) {
      throw new Error(
        `${label}: unknown placeholder ${whole}. Only ${[...allowed.keys()].join(', ')} may be `
        + 'substituted, so that no value can reach a statement without being validated first.'
      );
    }
    if (spec.kind !== wantKind) {
      throw new Error(
        `${label}: ${whole} is a ${wantKind} placeholder but ${name} is an ${spec.kind} value`
      );
    }
    if (spec.value == null) {
      throw new Error(`${label}: ${whole} is required by this phase but no value was supplied`);
    }
    // This is the ONE place a value becomes SQL text. The value is
    // pattern-validated before it ever arrives here (assertRoleName /
    // assertDatabaseName / assertValidUntil) or is a locally computed SCRAM
    // verifier, and is quoted by quoteIdent / quoteLiteral, both of which
    // REFUSE rather than escape anything that could break out. The
    // corresponding scanner suppression is on the sink in `runBlock`, which is
    // where a taint analysis reports.
    return wantKind === 'ident' ? quoteIdent(spec.value) : quoteLiteral(spec.value);
  });
}

function readSqlFile(name, { dir = SQL_DIR } = {}) {
  if (!/^[a-z0-9-]+\.sql$/.test(name)) throw new Error(`refusing to read ${JSON.stringify(name)}`);
  // `dir` defaults to a __dirname-derived constant and `name` is validated
  // against a literal pattern immediately above, so neither side of the join
  // can carry a traversal segment.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { phase: null, database: null, role: null, validUntil: null, printSql: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const take = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`);
      i += 1;
      return value;
    };
    if (token === '--phase') args.phase = take();
    else if (token === '--database') args.database = take();
    else if (token === '--role') args.role = take();
    else if (token === '--valid-until') args.validUntil = take();
    else if (token === '--print-sql') args.printSql = true;
    else rest.push(token);
  }
  if (rest.length > 0) {
    throw new Error(
      `unrecognised argument(s): ${rest.map(redactArgument).join(' ')}. If one of these was meant `
      + 'to be a password or a connection string, it must not be: both are read from the '
      + 'environment only.'
    );
  }
  return args;
}

// ---------------------------------------------------------------------------
// TLS. Same gate as the extraction runner, same reasoning, higher stakes.
// ---------------------------------------------------------------------------

/**
 * Refuse to run unless the connection this process will ACTUALLY open verifies
 * the server's certificate.
 *
 * The check is on the RESOLVED ssl config, not on whether a CA happens to be
 * configured: `dbSsl.sslForConnection` returns `false` - TLS off entirely - for
 * a localhost host or `PGSSLMODE=disable`, and `{ rejectUnauthorized: false }`
 * when no CA is set outside production. The realistic way to hit the first is
 * an SSH tunnel on localhost, where a CA-presence check would pass happily.
 *
 * The extraction runner makes this argument about reading the players and stats
 * history. Here the traffic is an admin credential and a password verifier, so
 * the same unverified connection would be a credential disclosure and, against
 * an active attacker, a role creation of someone else's choosing.
 */
function assertVerifiedTls(connectionString, { resolveSsl = sslForConnection, env = process.env } = {}) {
  let ssl;
  try {
    ssl = resolveSsl(connectionString);
  } catch (err) {
    throw new Error(`refusing to run Gate 1: the TLS configuration is invalid (${err.message})`);
  }
  if (ssl && ssl.rejectUnauthorized === true) return true;
  const how = ssl === false || ssl == null
    ? 'TLS is disabled entirely for this connection (a localhost/127.0.0.1 host, or PGSSLMODE=disable)'
    : `TLS is on but unverified (rejectUnauthorized=${JSON.stringify(ssl.rejectUnauthorized)})`;
  throw new Error(
    `refusing to run Gate 1: ${how}. This run carries an administrative credential and a password `
    + 'verifier, so the connection must verify the server certificate. Set DB_SSL_CA or '
    + 'DB_SSL_CA_PATH to the database CA, connect to the real database host rather than a '
    + `localhost tunnel, and do not set PGSSLMODE=disable. (NODE_ENV is `
    + `${JSON.stringify(env.NODE_ENV || null)}; dbSsl falls back to rejectUnauthorized:false `
    + 'whenever it is not "production" and no CA is configured.)'
  );
}

// ---------------------------------------------------------------------------
// The phases
// ---------------------------------------------------------------------------

/** Run one named block. Errors name the BLOCK, never the rendered statement. */
async function runBlock(client, blocks, name, values, { label }) {
  const text = blocks.get(name);
  if (text === undefined) throw new Error(`${label}: no statement block named ${JSON.stringify(name)}`);
  const rendered = renderStatement(text, values, { label: `${label}:${name}` });
  try {
    // The statement body is a reviewed .sql file from `gate1/`, read through
    // `readSqlFile`'s name allowlist. The only values substituted into it are
    // the six allowlisted placeholders, each pattern-validated on the way in
    // from argv and quoted by a helper that refuses anything it cannot quote
    // safely. There is no parameterized alternative to prefer: DDL cannot bind
    // identifiers, so `CREATE ROLE $1` and `GRANT ... TO $1` are not valid SQL.
    // nosemgrep: javascript.lang.security.audit.sqli.node-postgres-sqli.node-postgres-sqli
    return await client.query(rendered);
  } catch (err) {
    // Deliberately NOT including `rendered`: for create_role that string
    // contains the verifier.
    //
    // DETAIL and HINT are server-authored fields that never echo the statement,
    // and for the failure that matters most here they carry the entire payload:
    // DROP ROLE's refusal puts "role X cannot be dropped because some objects
    // depend on it" in the message and the actual list of blocking dependencies
    // in DETAIL. Without this, teardown's last fail-closed check would report
    // that something depends on the role while withholding what. `where` and
    // `internalQuery` are deliberately excluded - those CAN contain SQL text.
    //
    // Redaction is main()'s job: its catch wraps this whole message - including
    // anything DETAIL or HINT carried - at the CLI boundary. A caller that
    // bypasses main() gets this text raw.
    const extra = [
      err.detail ? `DETAIL: ${err.detail}` : null,
      err.hint ? `HINT: ${err.hint}` : null,
    ].filter(Boolean).join(' ');
    throw new Error(
      `${label}: statement ${name} failed: ${err.message}${extra ? ` ${extra}` : ''}`
    );
  }
}

function fail(message) { throw new Error(message); }

/** The accident guard: the server must report exactly the database named on argv. */
async function assertContext(client, blocks, values, { label }) {
  const res = await runBlock(client, blocks, 'preflight_context', values, { label });
  const row = res.rows[0] || {};
  if (row.database_name !== values.databaseName) {
    fail(
      `${label}: connected to database ${JSON.stringify(row.database_name)} but --database says `
      + `${JSON.stringify(values.databaseName)}. This is the accident guard between a correct `
      + 'command and the wrong connection string; nothing has been changed.'
    );
  }
  if (row.admin_is_superuser !== true && row.admin_can_create_role !== true) {
    fail(
      `${label}: the admin role ${JSON.stringify(row.admin_role)} has neither SUPERUSER nor `
      + 'CREATEROLE, so this run would fail part-way through. Nothing has been changed.'
    );
  }
  return row;
}

async function phaseCreate(client, values, { log, label = 'create' } = {}) {
  const blocks = loadStatements(readSqlFile('create-role.sql'), { label });
  const context = await assertContext(client, blocks, values, { label });
  log(`connected to ${context.database_name} as ${context.admin_role}`);

  const existing = await runBlock(client, blocks, 'preflight_role_absent', values, { label });
  if (existing.rows.length > 0) {
    fail(
      `${label}: role ${values.roleName} ALREADY EXISTS. It is never adopted: its flags, expiry, `
      + 'password and grants were set by something other than create-role.sql, so nothing that '
      + 'file says would describe it. Tear it down deliberately first, or pick a new --role. '
      + 'Nothing has been changed.'
    );
  }

  const objects = await runBlock(client, blocks, 'preflight_objects_present', values, { label });
  const found = new Map(objects.rows.map((r) => [r.object_name, r]));
  const missing = EXPECTED_TABLES.filter((t) => !found.has(t));
  if (missing.length > 0) {
    fail(`${label}: expected tables missing from public: ${missing.join(', ')}. Nothing has been changed.`);
  }
  const wrongKind = [...found.values()].filter((r) => r.object_kind !== 'r' && r.object_kind !== 'p');
  if (wrongKind.length > 0) {
    fail(
      `${label}: ${wrongKind.map((r) => `${r.object_name} is relkind ${r.object_kind}`).join(', ')}. `
      + 'Granting SELECT on a view can widen the read surface past the four tables. Nothing has '
      + 'been changed.'
    );
  }

  // Resolved by OID, never by string. See preflight_function_present: comparing
  // pg_get_function_identity_arguments against a literal signature is what
  // broke this preflight on its first CI run, because that rendering carries
  // the parameter name and the real function is fn_normalize_nfl_team(raw_team
  // text). The overload list below is for the error message only.
  const fn = (await runBlock(client, blocks, 'preflight_function_present', values, { label })).rows[0];
  if (!fn || fn.function_resolved !== true) {
    const overloads = (fn && fn.overloads_present) || [];
    fail(
      `${label}: public.${EXPECTED_FUNCTION.name}(${EXPECTED_FUNCTION.args}) did not resolve `
      + `(overloads present: ${overloads.length ? overloads.join(' | ') : 'none'}). Nothing has `
      + 'been changed.'
    );
  }
  log(`preflight passed: role absent, ${EXPECTED_TABLES.length} tables present, function present`);

  await client.query('BEGIN');
  try {
    for (const name of ['create_role', 'set_read_only', 'grant_connect', 'grant_usage',
      'grant_select', 'grant_execute']) {
      await runBlock(client, blocks, name, values, { label });
      log(`  applied ${name}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  log(`role ${values.roleName} created, valid until ${values.validUntil}`);
  return { created: true };
}

/** Format an enumeration row set for a message, one line each. */
const describeRows = (rows) => rows.map((r) => JSON.stringify(r)).join('\n    ');

/** The bootstrap superuser's OID is fixed by PostgreSQL (BOOTSTRAP_SUPERUSERID). */
const BOOTSTRAP_SUPERUSER_OID = 10;

/**
 * Is this membership row THE one PostgreSQL 16+ creates by itself when a
 * non-superuser CREATEROLE role creates another role?
 *
 * Identified structurally, never by naming a privileged role. "postgres is
 * allowed" would be an allowance any compromised or misconfigured `postgres`
 * could walk through; this is an allowance only the server's own
 * role-creation path can produce.
 *
 *   direction  'members' - somebody holds membership IN the new role. The other
 *              direction would give the new role somebody else's privileges,
 *              which is never expected and never tolerated.
 *   member     the role THIS CONNECTION is authenticated as. The implicit grant
 *              goes to the creator, and Gate 1 creates and verifies as the same
 *              identity, so anyone else holding it is a finding.
 *   grantor    the bootstrap superuser, by OID and with rolsuper true. The
 *              server records itself as grantor; a human GRANT records the
 *              human.
 *   admin      TRUE, as the server records it. A bare `GRANT role TO x`
 *              defaults to admin FALSE and is rejected; an explicit
 *              `WITH ADMIN OPTION` grant by the bootstrap superuser itself is
 *              indistinguishable from the implicit one in the catalog, and no
 *              attempt is made to tell them apart - producing that signature
 *              already requires bootstrap-superuser access.
 *   inherit    FALSE, and
 *   set        FALSE. Both come from `createrole_self_grant`, which is empty by
 *              default. A server configured otherwise mints the same
 *              relationship with the creator able to READ AS or BECOME this
 *              role, and that is a materially different grant: it must fail.
 */
function isImplicitCreatorAdminGrant(row) {
  if (!row || typeof row !== 'object') return false;
  return row.direction === 'members'
    && row.other_role_is_connected_role === true
    && Number(row.grantor_oid) === BOOTSTRAP_SUPERUSER_OID
    && row.grantor_is_bootstrap === true
    && row.grantor_is_superuser === true
    && row.admin_option === true
    && row.inherit_option === false
    && row.set_option === false;
}

/** One line describing the administrative relationship, for the run output. */
const describeCreatorAdminGrant = (row) => (
  `the PostgreSQL 16+ implicit creator-admin grant: ${row.other_role} holds ADMIN on this role `
  + `(granted by the bootstrap superuser ${row.grantor_name}, INHERIT false, SET false). `
  + 'It is created by the server when a non-superuser CREATEROLE role creates a role, it is what '
  + 'lets this connection administer and later drop the role, and it is NOT revoked by teardown - '
  + 'DROP ROLE removes it.'
);

// ---------------------------------------------------------------------------
// Row-level security: what the role would actually SEE
// ---------------------------------------------------------------------------

/**
 * Is this catalog row the policy `grant-rls-policies.sql` makes, exactly?
 *
 * Every field is load-bearing, and each one is a DIFFERENT policy that merely
 * resembles the kit's:
 *
 *   policy_name                 the derived `<role>_select`. This is the one
 *                               comparison that is a name rather than an OID,
 *                               because "is this the kit's policy" is a question
 *                               about the identity the kit chose. Everything the
 *                               name would otherwise have to be trusted for -
 *                               which role, which table - is checked separately.
 *   policy_permissive           TRUE. A RESTRICTIVE policy of the same name
 *                               would NARROW what the role reads rather than
 *                               widen it, silently, which is the failure mode
 *                               this whole amendment exists because of.
 *   policy_command              'r', the catalog's code for FOR SELECT. '*' (FOR
 *                               ALL) would also cover INSERT, UPDATE and DELETE;
 *                               the role holds no such privilege today, and a
 *                               policy must not be the thing standing between it
 *                               and one it is granted tomorrow.
 *   roles_are_exactly_the_role  computed in SQL as an OID ARRAY equality, so a
 *                               policy naming this role AND somebody else fails.
 *   applies_to_public           FALSE, checked independently of the array
 *                               comparison rather than inferred from it: a
 *                               policy reaching PUBLIC applies to every role in
 *                               the cluster, which is the widest thing a policy
 *                               can be and the one worth two checks.
 *   using_is_unconditional      the deparsed qualifier is exactly `true`. A row
 *                               predicate here would reshape Gate 2's snapshot
 *                               without appearing anywhere in the extraction.
 *   has_no_with_check           FOR SELECT takes no WITH CHECK, so a policy that
 *                               has one was not created by this file.
 */
function isExpectedKitPolicy(row, policyName) {
  if (!row || typeof row !== 'object') return false;
  return row.policy_name === policyName
    && row.policy_permissive === true
    && row.policy_command === EXPECTED_POLICY_COMMAND
    && row.roles_are_exactly_the_role === true
    && row.applies_to_public === false
    && row.using_is_unconditional === true
    && row.has_no_with_check === true;
}

/**
 * Decide what state the four granted tables are in, in ONE place, so that
 * verify, grant-policies and drop-policies cannot disagree about what "the
 * expected policy state" means. A verify that judged a policy by a different
 * rule than the phase that created it would bless something the grant phase
 * would have refused.
 *
 * `status` is one of:
 *
 *   absent    no kit policy exists. LEGITIMATE: it is the state between create
 *             and grant-policies, and the state drop-policies leaves behind.
 *   complete  all four exist, each in exactly the expected shape.
 *   partial   anything in between. The grant phase commits four policies or
 *             none, so this is not a state the kit can produce, and it is
 *             reported as a problem rather than repaired.
 *
 * `problems` is the fail-closed list. The policy phases abort on any entry;
 * verify reports each one. It is deliberately not fatal on its own for the
 * `absent` status, which is why `status` and `problems` are separate answers.
 */
function classifyPolicyState(tableRows, policyRows, { policyName }) {
  assertPolicyName(policyName, { label: 'policy state' });
  const problems = [];
  const tables = new Map((tableRows || []).map((r) => [r.table_name, r]));

  const missing = EXPECTED_TABLES.filter((t) => !tables.has(t));
  if (missing.length > 0) {
    problems.push(
      `expected tables missing from public: ${missing.join(', ')}. The kit's read surface is those `
      + 'four tables, so a missing one is a table whose row visibility nothing here describes.'
    );
  }
  // relkind is SELECTED by all three catalog blocks that feed this function, and
  // until now was never asserted on anywhere. 'r' is an ordinary table, which is
  // the only thing these four have ever been. A view is the case that matters: a
  // view carries no row-level security at all, so `relrowsecurity` on one is
  // false by construction and describeTableRlsState would print "RLS off, so the
  // SELECT grant is the whole story" for a relation that can read from anything
  // it selects from. create-role.sql's preflight already refuses to GRANT on a
  // non-table; this is the same refusal on the policy and verify paths, which
  // reach the catalog by name and would otherwise inherit whatever the name now
  // resolves to. Deliberately stricter than that preflight, which also tolerates
  // a partitioned table ('p'): none of these four is one, and admitting a
  // relkind whose policy semantics nobody here has checked is a decision for a
  // human. A row with no relkind at all fails the same way, closed.
  const wrongKind = [...tables.values()].filter((r) => r.table_kind !== 'r');
  if (wrongKind.length > 0) {
    problems.push(
      'not an ordinary table: '
      + `${wrongKind.map((r) => `${r.table_name} is relkind ${JSON.stringify(r.table_kind)}`).join(', ')}. `
      + 'Only relkind "r" is described by this kit. A view has no row-level security of its own, so '
      + 'its row visibility is whatever it selects from, and nothing here measures that.'
    );
  }
  const forced = [...tables.values()].filter((r) => r.row_security_forced === true);
  if (forced.length > 0) {
    problems.push(
      `FORCE ROW LEVEL SECURITY is on ${forced.map((r) => r.table_name).join(', ')}. FORCE applies `
      + 'row-level security to the table OWNER as well, which here is the application itself, so '
      + 'this is a fault in the database rather than in this role.'
    );
  }

  const rows = policyRows || [];
  const kit = rows.filter((r) => isExpectedKitPolicy(r, policyName));
  // A same-named policy of a different shape is called out separately from a
  // foreign one, because it is the dangerous case: it is the row that would be
  // adopted, or dropped, by anything matching on the name alone.
  const impostors = rows.filter(
    (r) => r && r.policy_name === policyName && !isExpectedKitPolicy(r, policyName)
  );
  const foreign = rows.filter((r) => !r || r.policy_name !== policyName);
  if (impostors.length > 0) {
    problems.push(
      `a policy named ${policyName} exists in a DIFFERENT shape from the one this kit creates:\n    `
      + `${describeRows(impostors)}\n    It is never adopted and never replaced: something other `
      + 'than grant-rls-policies.sql made it, so nothing in that file describes what it permits.'
    );
  }
  if (foreign.length > 0) {
    problems.push(
      `policies this kit did not create sit on the granted tables:\n    ${describeRows(foreign)}\n`
      + '    A RESTRICTIVE policy narrows what the role reads with no error anywhere, which would '
      + "shrink Gate 2's snapshot in silence."
    );
  }

  const covered = new Set(kit.map((r) => r.table_name));
  const uncovered = EXPECTED_TABLES.filter((t) => !covered.has(t));
  const status = kit.length === 0 ? 'absent' : (uncovered.length === 0 ? 'complete' : 'partial');
  if (status === 'partial') {
    problems.push(
      `the kit policies are a PARTIAL set: present on ${[...covered].sort().join(', ') || '(none)'}, `
      + `missing on ${uncovered.join(', ')}. The grant phase commits all four or none, so this is `
      + 'not a state it produced.'
    );
  }
  return { status, kit, impostors, foreign, uncovered, tables: [...tables.values()], problems };
}

/**
 * One line per granted table, and the only place the run output says out loud
 * what the role would actually read. Gate 1 previously reported five correct
 * privileges over a read surface that was empty on three of four tables.
 */
function describeTableRlsState(tableRows, { status }) {
  return (tableRows || []).map((r) => {
    const visibility = r.row_security_enabled !== true
      ? 'RLS off, so the SELECT grant is the whole story'
      : (status === 'complete'
        ? 'RLS on, and the kit policy admits the role'
        : 'RLS ON WITH NO KIT POLICY: the role reads ZERO rows here despite its SELECT grant');
    return `  ${r.table_name}: rowsecurity=${r.row_security_enabled}, `
      + `force=${r.row_security_forced}, owner=${r.table_owner} (${visibility})`;
  });
}

/**
 * Which row-security flags moved between two readings of the same block.
 *
 * Neither policy file contains an ALTER TABLE, so the answer must always be
 * "none". Checking it inside the transaction is what turns "this phase never
 * touches RLS itself" from a promise in a comment into a post-condition that
 * rolls back.
 */
function rlsFlagsChanged(before, after) {
  const snapshot = (rows) => new Map((rows || []).map(
    (r) => [r.table_name, `rowsecurity=${r.row_security_enabled}, force=${r.row_security_forced}`]
  ));
  const was = snapshot(before);
  const now = snapshot(after);
  const changed = [];
  for (const [name, state] of now) {
    if (was.get(name) !== state) changed.push(`${name}: ${was.get(name) || '(absent)'} -> ${state}`);
  }
  for (const [name, state] of was) {
    if (!now.has(name)) changed.push(`${name}: ${state} -> (absent)`);
  }
  return changed;
}

/**
 * The accident guard for the OWNER phases. Same question create-role.sql's
 * preflight_context asks, minus the CREATEROLE check: these phases need
 * ownership, not a role attribute, and ownership is resolved per table below.
 */
async function assertOwnerContext(client, blocks, values, { label }) {
  const row = (await runBlock(client, blocks, 'policy_preflight_context', values, { label })).rows[0] || {};
  if (row.database_name !== values.databaseName) {
    fail(
      `${label}: connected to database ${JSON.stringify(row.database_name)} but --database says `
      + `${JSON.stringify(values.databaseName)}. This is the accident guard between a correct `
      + 'command and the wrong connection string; nothing has been changed.'
    );
  }
  return row;
}

/**
 * Everything both policy phases check before either mutates anything. Shared so
 * that the drop cannot be aimed somewhere the grant could not, and so that both
 * abort on the same view of the world.
 */
async function policyPreflight(client, blocks, values, { label, log }) {
  // Validated BEFORE a single statement is issued. `classifyPolicyState` asserts
  // the same thing, but it does so three blocks later, and this phase must not
  // open a connection's worth of catalog reads against a value it is going to
  // refuse. It is also the value that becomes an IDENTIFIER in CREATE POLICY.
  const policyName = assertPolicyName(values.policyName, { label });
  const context = await assertOwnerContext(client, blocks, values, { label });
  log(`connected to ${context.database_name} as ${context.connected_role}`);

  const role = (await runBlock(client, blocks, 'policy_preflight_role_present', values, { label })).rows;
  if (role.length !== 1) {
    fail(
      `${label}: role ${values.roleName} does not exist. Every policy this phase manages names that `
      + 'role and nothing else, so there is nothing for one to admit and no way to tell an existing '
      + "policy's role array apart from a foreign one. Nothing has been changed."
    );
  }

  // OWNERSHIP is the authorization for the whole phase, resolved from pg_class
  // rather than assumed from the connection string.
  const tables = (await runBlock(client, blocks, 'policy_table_rls_state', values, { label })).rows;
  const notOwned = tables.filter((r) => r.owner_is_connected_role !== true);
  if (notOwned.length > 0) {
    fail(
      `${label}: ${JSON.stringify(context.connected_role)} does not own `
      + `${notOwned.map((r) => `${r.table_name} (owner ${r.table_owner})`).join(', ')}. CREATE POLICY `
      + `and DROP POLICY are gated on table ownership, which is why this phase reads ${OWNER_ENV_VAR} `
      + `and not ${ADMIN_ENV_VAR}. Nothing has been changed.`
    );
  }

  const policies = (await runBlock(client, blocks, 'policy_table_policies', values, { label })).rows;
  const state = classifyPolicyState(tables, policies, { policyName });
  for (const line of describeTableRlsState(tables, state)) log(line);
  if (state.problems.length > 0) {
    // Name the way out, the way the teardown abort names this phase. A PARTIAL
    // or FOREIGN set is a state this kit will not clear for itself - the drop
    // phase only removes policies it has already matched field by field against
    // the shape grant-rls-policies.sql creates - so the statements have to be
    // run by hand, and an abort that did not say where to get them reads as a
    // dead end. --print-sql renders them with the derived policy name already
    // substituted, connects to nothing and reads no credential.
    const residue = state.kit.length + state.impostors.length + state.foreign.length > 0;
    fail(
      `${label}: ABORTED. ${state.problems.length} problem(s) with the policy state of the granted `
      + `tables:\n  - ${state.problems.join('\n  - ')}\n`
      + (residue
        ? 'Clearing a PARTIAL or FOREIGN set is a manual step, as the TABLE OWNER. Print the exact '
          + 'DROP POLICY statements this kit would issue:\n'
          + '      node server/scripts/run-backtest-role.js --print-sql --phase drop-policies '
          + `--database ${values.databaseName} --role ${values.roleName}\n`
          + 'then run with psql, as the owner, only the ones you have decided to drop. A policy this '
          + 'kit did not create is not in that output and never will be: deleting it would destroy '
          + 'the evidence of whatever made it.\n'
        : '')
      + 'Nothing has been changed.'
    );
  }
  return { context, tables, policies, state, policyName };
}

/** Read both policy blocks back and classify, for an in-transaction post-condition. */
async function readPolicyState(client, blocks, values, { label, policyName }) {
  const tables = (await runBlock(client, blocks, 'policy_table_rls_state', values, { label })).rows;
  const policies = (await runBlock(client, blocks, 'policy_table_policies', values, { label })).rows;
  return { tables, state: classifyPolicyState(tables, policies, { policyName }) };
}

async function phaseGrantPolicies(client, values, { log, label = 'grant-policies' } = {}) {
  const blocks = loadStatements(readSqlFile(PHASE_SQL_FILE['grant-policies']), { label });
  const { tables, state, policyName } = await policyPreflight(client, blocks, values, { label, log });

  if (state.status === 'complete') {
    log(`the ${EXPECTED_TABLES.length} policies named ${policyName} are already present, in exactly `
      + 'the expected shape: nothing to do.');
    return { granted: false, noop: true };
  }

  await client.query('BEGIN');
  try {
    await runBlock(client, blocks, 'create_policies', values, { label });
    // The post-conditions run INSIDE the transaction, unlike create's, which
    // commits and then verifies. A policy is cheap to re-read and the whole
    // failure this amendment answers was a mutation that looked right and was
    // not, so a wrong result here leaves nothing behind to explain.
    const after = await readPolicyState(client, blocks, values, { label, policyName });
    if (after.state.problems.length > 0 || after.state.status !== 'complete') {
      fail(
        `${label}: the policies did not land as exactly ${EXPECTED_TABLES.length} kit policies `
        + `(status ${after.state.status}).`
        + `${after.state.problems.length > 0 ? `\n  - ${after.state.problems.join('\n  - ')}` : ''}\n`
        + 'Rolling back: nothing has been changed.'
      );
    }
    const moved = rlsFlagsChanged(tables, after.tables);
    if (moved.length > 0) {
      fail(
        `${label}: the row-security flags moved during this phase: ${moved.join('; ')}. This file `
        + 'contains no ALTER TABLE, so nothing in it can have done that. Rolling back.'
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  log(`${EXPECTED_TABLES.length} policies named ${policyName} created: PERMISSIVE, FOR SELECT, `
    + `TO ${values.roleName}, USING (true)`);
  return { granted: true, noop: false };
}

async function phaseDropPolicies(client, values, { log, label = 'drop-policies' } = {}) {
  const blocks = loadStatements(readSqlFile(PHASE_SQL_FILE['drop-policies']), { label });
  const { tables, state, policyName } = await policyPreflight(client, blocks, values, { label, log });

  if (state.status === 'absent') {
    log(`no policy named ${policyName} exists on the granted tables: nothing to drop.`);
    return { dropped: false, noop: true };
  }

  await client.query('BEGIN');
  try {
    // Reaching here means the preflight found all four, each already matched
    // field by field against the expected shape. `drop_policies` carries no
    // IF EXISTS, so a policy that vanished between the two statements is an
    // error rather than a shrug.
    await runBlock(client, blocks, 'drop_policies', values, { label });
    const after = await readPolicyState(client, blocks, values, { label, policyName });
    if (after.state.problems.length > 0 || after.state.status !== 'absent') {
      fail(
        `${label}: the policies are not absent after the drop (status ${after.state.status}).`
        + `${after.state.problems.length > 0 ? `\n  - ${after.state.problems.join('\n  - ')}` : ''}\n`
        + 'Rolling back: nothing has been dropped.'
      );
    }
    const moved = rlsFlagsChanged(tables, after.tables);
    if (moved.length > 0) {
      fail(
        `${label}: the row-security flags moved during this phase: ${moved.join('; ')}. Dropping a `
        + 'policy does not disable row-level security, and this file contains no ALTER TABLE. '
        + 'Rolling back.'
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  log(`${EXPECTED_TABLES.length} policies named ${policyName} dropped, and confirmed absent. `
    + 'The role can now be torn down.');
  return { dropped: true, noop: false };
}

async function phaseVerify(client, values, { log, label = 'verify' } = {}) {
  // Argument validation before any I/O. The policy name is derived rather than
  // supplied, so a value that fails here is a caller that built one by hand, and
  // reading nine catalog blocks before saying so would be work done on a
  // question this phase has already decided not to answer.
  const policyName = assertPolicyName(values.policyName, { label });
  const blocks = loadStatements(readSqlFile('verify-role.sql'), { label });
  // The accident guard applies here too, and not only for symmetry: verify is
  // meant to be run standalone days later, when the shell it runs in is not the
  // one that created the role. `has_database_privilege` on a database that does
  // not exist raises a bare Postgres error, and a bare error is exactly the
  // thing an operator reads as "the tooling is broken" rather than "you are
  // pointed at the wrong cluster".
  await assertContext(client, loadStatements(readSqlFile('create-role.sql'), { label }), values, { label });
  const problems = [];
  const note = (message) => problems.push(message);

  const flags = (await runBlock(client, blocks, 'verify_role_flags', values, { label })).rows[0];
  if (!flags) fail(`${label}: role ${values.roleName} does not exist`);
  const expectedFlags = {
    rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false,
    rolreplication: false, rolbypassrls: false, rolcanlogin: true, rolconnlimit: 1,
  };
  for (const [key, want] of Object.entries(expectedFlags)) {
    if (flags[key] !== want) note(`${key} is ${JSON.stringify(flags[key])}, expected ${JSON.stringify(want)}`);
  }
  if (flags.rolvaliduntil == null) note('rolvaliduntil is NULL: the role never expires');
  if (flags.valid_until_matches !== true) {
    note(`rolvaliduntil is ${JSON.stringify(flags.rolvaliduntil)}, which is not the supplied `
      + `--valid-until ${values.validUntil}`);
  }
  if (flags.valid_until_in_future !== true) note('rolvaliduntil is in the PAST: the role cannot log in');

  const settings = (await runBlock(client, blocks, 'verify_role_settings', values, { label })).rows;
  const clusterWide = settings.find((r) => Number(r.set_database_oid) === 0);
  const config = (clusterWide && clusterWide.set_config) || [];
  if (!config.includes('default_transaction_read_only=on')) {
    note(`default_transaction_read_only=on is not set for the role (setconfig: ${JSON.stringify(config)})`);
  }

  const priv = (await runBlock(client, blocks, 'verify_effective_privileges', values, { label })).rows[0];
  const mustBeTrue = ['db_connect', 'schema_usage', 'select_players', 'select_player_stats',
    'select_player_season_stats', 'select_nfl_games', 'execute_normalize'];
  const mustBeFalse = ['insert_players', 'update_players', 'delete_players', 'update_nfl_games',
    'schema_create'];
  for (const key of mustBeTrue) if (priv[key] !== true) note(`${key} is ${JSON.stringify(priv[key])}, expected true`);
  for (const key of mustBeFalse) if (priv[key] !== false) note(`${key} is ${JSON.stringify(priv[key])}, expected FALSE`);

  // The enumerations. These are what make the phase mean something.
  const relations = (await runBlock(client, blocks, 'verify_relation_acl_enumeration', values, { label })).rows;
  const relationKeys = relations.map((r) => `${r.schema_name}.${r.object_name}:${r.privilege_type}`).sort();
  const expectedRelationKeys = EXPECTED_TABLES.map((t) => `public.${t}:SELECT`).sort();
  if (JSON.stringify(relationKeys) !== JSON.stringify(expectedRelationKeys)) {
    note(
      `the role holds relation privileges other than exactly ${expectedRelationKeys.length} SELECTs.\n`
      + `  expected: ${expectedRelationKeys.join(', ')}\n`
      + `  actual:   ${relationKeys.join(', ') || '(none)'}\n    ${describeRows(relations)}`
    );
  }
  if (relations.some((r) => r.is_grantable === true)) {
    note('a relation privilege is GRANTABLE: the role could pass its read access to another role');
  }

  // Column grants do not appear in pg_class.relacl, so the relation
  // enumeration above cannot see them. Expected: none at all.
  const columns = (await runBlock(client, blocks, 'verify_column_acl_enumeration', values, { label })).rows;
  if (columns.length > 0) {
    note(
      'the role holds COLUMN-level privileges, which are invisible to the relation enumeration:\n'
      + `    ${describeRows(columns)}`
    );
  }

  // Matched on the OID-derived flag, never on the rendered signature: the
  // identity text carries the parameter name, so the real
  // fn_normalize_nfl_team(raw_team text) never string-equals 'text'. The
  // rendering is used only to describe what was found.
  const functions = (await runBlock(client, blocks, 'verify_function_acl_enumeration', values, { label })).rows;
  const describeFn = (r) => `${r.schema_name}.${r.object_name}(${r.identity_arguments}):${r.privilege_type}`;
  const wrongFunctions = functions.filter(
    (r) => r.is_expected_function !== true || r.privilege_type !== 'EXECUTE'
  );
  if (functions.length !== 1 || wrongFunctions.length > 0) {
    note(
      'function privileges are not exactly one EXECUTE on '
      + `public.${EXPECTED_FUNCTION.name}(${EXPECTED_FUNCTION.args}).\n`
      + `  actual: ${functions.map(describeFn).join(', ') || '(none)'}`
      + (wrongFunctions.length > 0
        ? `\n  not the expected overload: ${wrongFunctions.map(describeFn).join(', ')}`
        : '')
    );
  }

  const schemas = (await runBlock(client, blocks, 'verify_schema_acl_enumeration', values, { label })).rows;
  const schemaKeys = schemas.map((r) => `${r.object_name}:${r.privilege_type}`).sort();
  if (JSON.stringify(schemaKeys) !== JSON.stringify(['public:USAGE'])) {
    note(`schema privileges are not exactly public:USAGE.\n  actual: ${schemaKeys.join(', ') || '(none)'}`);
  }

  const databases = (await runBlock(client, blocks, 'verify_database_acl_enumeration', values, { label })).rows;
  const databaseKeys = databases.map((r) => `${r.object_name}:${r.privilege_type}`).sort();
  if (JSON.stringify(databaseKeys) !== JSON.stringify([`${values.databaseName}:CONNECT`])) {
    note(`database privileges are not exactly ${values.databaseName}:CONNECT.\n`
      + `  actual: ${databaseKeys.join(', ') || '(none)'}`);
  }

  const defaults = (await runBlock(client, blocks, 'verify_default_acl_enumeration', values, { label })).rows;
  if (defaults.length > 0) {
    note(`the role has DEFAULT privileges, which apply to objects created in future:\n    ${describeRows(defaults)}`);
  }

  // ROW-LEVEL SECURITY. Everything above answers "what is the role PERMITTED to
  // do"; this answers "what would it actually SEE", and the two came apart in
  // production: five correct privileges over a read surface that was empty on
  // three of the four tables, because those tables have RLS enabled and no
  // policy. The absence of this measurement is why that reached Gate 2.
  const rlsTables = (await runBlock(client, blocks, 'verify_table_rls_state', values, { label })).rows;
  const tablePolicies = (await runBlock(client, blocks, 'verify_table_policies', values, { label })).rows;
  const policyState = classifyPolicyState(rlsTables, tablePolicies, { policyName });
  for (const problem of policyState.problems) note(problem);
  for (const line of describeTableRlsState(rlsTables, policyState)) log(line);
  if (policyState.status === 'absent') {
    log(`  note: no policy named ${policyName} exists yet. That is the expected state between create `
      + 'and the grant-policies phase, and it is NOT a failure here - but on any table above with '
      + 'rowsecurity=true the role reads zero rows until that phase runs.');
  }

  const owned = (await runBlock(client, blocks, 'verify_no_ownership', values, { label })).rows;
  // The four deptype 'r' rows the kit's own policies produce are the intended
  // state after grant-policies, and only those. A row is tolerated when it
  // resolves to a policy IN THIS DATABASE whose OID is one classifyPolicyState
  // has already matched field by field against the expected shape - so the
  // allowance is anchored to policies this verify has itself just approved,
  // rather than to a name or a catalog class. Every ownership row still fails.
  const kitPolicyOids = new Set(policyState.kit.map((r) => String(r.policy_oid)));
  const unexpectedDependencies = owned.filter((r) => !(
    r.dependency_type === 'r'
    && r.is_policy_dependency === true
    && kitPolicyOids.has(String(r.object_oid))
  ));
  if (unexpectedDependencies.length > 0) {
    note('the role owns objects, or is named by an RLS policy this kit did not create:\n    '
      + `${describeRows(unexpectedDependencies)}`);
  }

  // Exactly one membership is tolerable, and only the one the server makes for
  // itself. Everything else is a finding, including a SECOND copy of the
  // allowed shape.
  const members = (await runBlock(client, blocks, 'verify_memberships', values, { label })).rows;
  const creatorAdmin = members.filter(isImplicitCreatorAdminGrant);
  const otherMemberships = members.filter((r) => !isImplicitCreatorAdminGrant(r));
  if (otherMemberships.length > 0) {
    note(
      'the role has role memberships beyond the implicit creator-admin grant:\n    '
      + `${describeRows(otherMemberships)}`
    );
  }
  if (creatorAdmin.length > 1) {
    note(`more than one creator-admin membership, which the server cannot produce:\n    ${describeRows(creatorAdmin)}`);
  }
  if (creatorAdmin.length === 1) log(`  allowed: ${describeCreatorAdminGrant(creatorAdmin[0])}`);

  if (problems.length > 0) {
    fail(`${label}: ${problems.length} problem(s) with role ${values.roleName}:\n  - `
      + problems.join('\n  - '));
  }
  log(`role ${values.roleName} verified: flags, expiry ${flags.rolvaliduntil.toISOString?.() || flags.rolvaliduntil}, `
    + 'read-only default, and EXACTLY the expected privileges');
  log('  note: PUBLIC grants (CONNECT, schema USAGE, function EXECUTE) apply to every role in the '
    + 'cluster and are NOT removed by this kit. No TABLE privilege is granted to PUBLIC here, '
    + 'which is what makes the four-table read surface real.');
  return { verified: true, flags };
}

async function phaseTeardown(client, values, { log, label = 'teardown' } = {}) {
  const blocks = loadStatements(readSqlFile('teardown-role.sql'), { label });
  const createBlocks = loadStatements(readSqlFile('create-role.sql'), { label });
  await assertContext(client, createBlocks, values, { label });

  const present = await runBlock(client, blocks, 'teardown_role_present', values, { label });
  if (present.rows.length === 0) {
    log(`role ${values.roleName} does not exist: nothing to tear down.`);
    return { tornDown: false, noop: true };
  }
  // Captured BEFORE anything is dropped, because the final confirmation cannot
  // look the role up once it is gone. See teardown_confirm_absent.
  const confirmValues = { ...values, roleOid: assertRoleOid(present.rows[0].role_oid, { label }) };

  const owned = (await runBlock(client, blocks, 'teardown_check_ownership', values, { label })).rows;
  if (owned.length > 0) {
    // A policy dependency gets its own sentence, because it is the one entry in
    // this list with a routine fix and a different operator: the policy phases
    // run as the table owner, so "run drop-policies first" is a step somebody
    // holding only the admin credential cannot even perform, and an abort that
    // did not say so would read as a dead end.
    const policyDeps = owned.filter(
      (r) => r.dependency_type === 'r' && r.is_policy_dependency === true
    );
    const named = policyDeps
      .filter((r) => r.policy_name)
      .map((r) => `${r.policy_schema}.${r.policy_table}: ${r.policy_name}`)
      .join(', ');
    fail(
      `${label}: ABORTED. Role ${values.roleName} owns objects or is named by an RLS policy:\n    `
      + `${describeRows(owned)}\n`
      + (policyDeps.length > 0
        ? `${policyDeps.length} of these are RLS POLICIES naming the role${named ? ` (${named})` : ''}. `
          + 'Run the drop-policies phase first, as the TABLE OWNER:\n'
          + '      node server/scripts/run-backtest-role.js --phase drop-policies '
          + `--database ${values.databaseName} --role ${values.roleName}\n`
          + 'DROP ROLE would refuse over them anyway - PostgreSQL raises SQLSTATE 2BP01 while any '
          + 'policy names the role - so this abort is that same refusal one statement earlier.\n'
        : '')
      + 'Nothing has been dropped. This kit never auto-drops owned objects: DROP OWNED BY would '
      + 'delete them, and a role that has come to own something in production is a fact a human '
      + 'needs to look at before anything is destroyed.'
    );
  }
  // The same structural allowance verify applies, and nothing else. The allowed
  // grant is deliberately NOT revoked: its grantor is the bootstrap superuser,
  // which this connection cannot modify, and it carries the ADMIN OPTION that
  // authorizes the DROP ROLE below. Dropping the role removes it.
  const members = (await runBlock(client, blocks, 'teardown_check_memberships', values, { label })).rows;
  const creatorAdmin = members.filter(isImplicitCreatorAdminGrant);
  const otherMemberships = members.filter((r) => !isImplicitCreatorAdminGrant(r));
  if (otherMemberships.length > 0 || creatorAdmin.length > 1) {
    fail(
      `${label}: ABORTED. Role ${values.roleName} has role memberships beyond the implicit `
      + `creator-admin grant:\n    ${describeRows(otherMemberships.concat(creatorAdmin.length > 1 ? creatorAdmin : []))}\n`
      + 'Dropping it would change what those roles can do. Nothing has been dropped.'
    );
  }
  if (creatorAdmin.length === 1) log(`  allowed: ${describeCreatorAdminGrant(creatorAdmin[0])}`);

  const killed = (await runBlock(client, blocks, 'teardown_terminate_sessions', values, { label })).rows;
  if (killed.length > 0) log(`  terminated ${killed.length} open session(s) for the role`);

  await client.query('BEGIN');
  try {
    // No `teardown_drop_owned`. A non-superuser CREATEROLE operator cannot run
    // DROP OWNED BY on a role it created - ADMIN OPTION is not the privileges
    // OF the role - and DROP ROLE's own dependency check is a better version of
    // what the sweeper was for. See the header of teardown-role.sql.
    for (const name of ['teardown_revoke', 'teardown_reset_settings', 'teardown_drop_role']) {
      await runBlock(client, blocks, name, values, { label });
      log(`  applied ${name}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }

  const after = (await runBlock(client, blocks, 'teardown_confirm_absent', confirmValues, { label })).rows[0];
  if (Number(after.role_rows) !== 0 || Number(after.shdepend_rows) !== 0 || Number(after.live_sessions) !== 0) {
    fail(`${label}: teardown reported success but the role is still visible: ${JSON.stringify(after)}`);
  }
  log(`role ${values.roleName} dropped, and confirmed absent`);
  return { tornDown: true, noop: false };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * `createPool` is injected ONLY so a test can prove the redaction chain end to
 * end: that the SCRAM verifier computed part-way through a run is registered
 * with the redactor, and that a driver error quoting the CREATE ROLE statement
 * - which contains that verifier - comes back redacted. There is no way to
 * demonstrate that without something that fails at query time, and the real
 * pool needs a database. It defaults to the real thing and no caller passes it.
 */
async function main(argv, {
  env = process.env, out = console,
  createPool = (config) => new pg.Pool(config),
} = {}) {
  // THE REDACTOR IS BUILT FIRST, from the environment alone, before argv is
  // parsed or a single value is validated. This ordering is the fix for a
  // demonstrated defect: with the redactor built after validation, a password
  // typed into the wrong position printed in cleartext four different ways -
  // as a stray positional, and mis-ordered into --role, --database or
  // --valid-until, each echoed verbatim by the message that rejected it. The
  // whole body below is inside the try, so there is no window in which an
  // error can escape unredacted.
  const redact = makeRedactor([
    env[PASSWORD_ENV_VAR],
    env[ADMIN_ENV_VAR],
    passwordFromUrl(env[ADMIN_ENV_VAR] || ''),
    // The owner credential is registered on exactly the same terms and at
    // exactly the same moment. It is a production write credential; the only
    // thing that makes it less alarming than the admin one is that it cannot
    // create roles, and that is not a reason to redact it any later.
    env[OWNER_ENV_VAR],
    passwordFromUrl(env[OWNER_ENV_VAR] || ''),
  ]);
  const log = (message) => out.log(redact(message));
  let pool = null;
  let client = null;

  try {
    const args = parseArgs(argv);
    if (!PHASES.includes(args.phase)) {
      throw new Error(`--phase must be one of ${PHASES.join(', ')}; got ${JSON.stringify(args.phase)}`);
    }
    const roleName = assertRoleName(args.role);
    const databaseName = assertDatabaseName(args.database);
    // Derived, never supplied. There is no --policy flag, and adding one would
    // make the set of policies this kit can touch depend on argv.
    const policyName = policyNameFor(roleName);
    // The expiry is what create asserts and verify compares against. Teardown
    // and the policy phases do not need it: the role is going away regardless of
    // when it would have, and a policy has no expiry of its own.
    const needsValidUntil = args.phase === 'create' || args.phase === 'verify';
    const validUntil = needsValidUntil ? assertValidUntil(args.validUntil) : null;

    if (args.printSql) {
      // Review mode. It connects to nothing and reads NO credential: a reviewer
      // asked to approve a production privilege change must be able to render
      // the exact SQL without holding the admin password, and requiring one
      // would either block the review or push people into exporting production
      // credentials they do not need. The verifier is a marker substituted in
      // place rather than a real one redacted after the fact, so no verifier is
      // ever derived on this path at all.
      // Both markers are self-describing rather than plausible-looking. The
      // verifier is key material that must never be rendered; the role OID does
      // not exist until teardown reads it back, and printing an invented number
      // would be worse than printing what it actually is.
      const values = { roleName, databaseName, validUntil: validUntil || '1970-01-01T00:00:00Z',
        passwordVerifier: 'SCRAM-SHA-256$[REDACTED]', roleOid: '<captured-before-the-drop>',
        policyName };
      const file = PHASE_SQL_FILE[args.phase];
      for (const [name, text] of loadStatements(readSqlFile(file), { label: file })) {
        out.log(`\n-- @statement: ${name}\n${renderStatement(text, values, { label: name })}`);
      }
      return 0;
    }

    const password = args.phase === 'create' ? readRolePassword(env) : null;
    const passwordVerifier = password ? scramVerifier(password) : null;
    redact.add(password).add(passwordVerifier);

    // ONE credential per phase, chosen by the phase and never by a fallback. The
    // policy phases need table ownership, which the admin credential does not
    // have; the other three need CREATEROLE, which the owner does not have.
    const usesOwner = OWNER_PHASES.includes(args.phase);
    const connectionString = usesOwner ? readOwnerCredential(env) : readAdminCredential(env);
    // Both readers trim, so the trimmed form can differ from the raw environment
    // value already registered. Register both.
    redact.add(connectionString).add(passwordFromUrl(connectionString));

    assertVerifiedTls(connectionString, { env });

    pool = createPool({
      connectionString,
      ssl: sslForConnection(connectionString),
      max: 1,
      application_name: `endzone-empire-gate1-${args.phase}`,
    });
    const values = { roleName, databaseName, validUntil, passwordVerifier, policyName };
    client = await pool.connect();
    if (args.phase === 'create') {
      await phaseCreate(client, values, { log });
      await phaseVerify(client, values, { log });
    } else if (args.phase === 'verify') {
      await phaseVerify(client, values, { log });
    } else if (args.phase === 'grant-policies') {
      await phaseGrantPolicies(client, values, { log });
    } else if (args.phase === 'drop-policies') {
      await phaseDropPolicies(client, values, { log });
    } else {
      await phaseTeardown(client, values, { log });
    }
    return 0;
  } catch (err) {
    // Re-throw REDACTED. A driver error can quote a statement, and for the
    // create phase that statement contains the verifier.
    const wrapped = new Error(redact(err.message));
    wrapped.stack = redact(err.stack || wrapped.stack);
    throw wrapped;
  } finally {
    if (client) client.release();
    if (pool) await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  main, parseArgs, readAdminCredential, readOwnerCredential, readRolePassword, scramVerifier,
  makeRedactor, redactArgument,
  assertRoleName, assertDatabaseName, assertValidUntil, assertRoleOid, assertPolicyName,
  policyNameFor, quoteIdent, quoteLiteral,
  isImplicitCreatorAdminGrant, BOOTSTRAP_SUPERUSER_OID,
  isExpectedKitPolicy, classifyPolicyState, rlsFlagsChanged,
  loadStatements, renderStatement, readSqlFile, assertVerifiedTls,
  phaseCreate, phaseVerify, phaseTeardown, phaseGrantPolicies, phaseDropPolicies,
  ADMIN_ENV_VAR, OWNER_ENV_VAR, PASSWORD_ENV_VAR, PHASES, OWNER_PHASES, PHASE_SQL_FILE,
  EXPECTED_TABLES, EXPECTED_FUNCTION, EXPECTED_POLICY_COMMAND, POLICY_NAME_SUFFIX,
  MAX_VALID_UNTIL_DAYS, MIN_PASSWORD_LENGTH, SCRAM_ITERATIONS,
};
