/**
 * Unit tests for the knex target resolver (#258).
 *
 * These exercise the REAL module that both knexfiles require, not a copy of
 * its logic: a test that reimplements the resolution proves nothing about the
 * file that runs on deploy. Every case passes an explicit `env` object and an
 * explicit `write` sink, so nothing here reads process.env, prints to the
 * console, or can be perturbed by a stray variable in the shell that runs it.
 *
 * The ordering of the cases mirrors the order the mechanisms matter in:
 * the printed line first (it is what a human actually reads before a write),
 * then the both-set disclosure (the actual defect from 2026-08-23), then the
 * refusal (the backstop for when nobody is reading).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPT_IN,
  resolveTarget,
  describeTarget,
  refusalMessage,
  announceTarget,
  connectionFor,
} = require('../modules/knexTarget');

const SECRET = 'hunter2-not-in-any-output';
const REMOTE_URL = `postgresql://postgres:${SECRET}@db.abcdefghijkl.supabase.co:5432/postgres?sslmode=require`;
const LOCAL_URL = `postgresql://postgres:${SECRET}@127.0.0.1:5434/endzone_local`;

/** Runs announceTarget against a fixed env, capturing output instead of stderr. */
function announce(env) {
  const lines = [];
  const target = announceTarget({ env, write: (line) => lines.push(line) });
  return { target, lines, output: lines.join('\n') };
}

/** Same, for the cases that are expected to throw. Returns what was printed too. */
function announceExpectingThrow(env) {
  const lines = [];
  let error = null;
  try {
    announceTarget({ env, write: (line) => lines.push(line) });
  } catch (err) {
    error = err;
  }
  return { error, lines, output: lines.join('\n') };
}

// --- The printed line -------------------------------------------------------

test('describes a loopback PG* target with host, port, database and the variables that supplied them', () => {
  const { target, output } = announce({
    PGHOST: '127.0.0.1',
    PGPORT: '5434',
    PGDATABASE: 'endzone_local',
    PGUSER: 'postgres',
    PGPASSWORD: SECRET,
  });

  assert.equal(target.via, 'pg');
  assert.equal(target.host, '127.0.0.1');
  assert.equal(target.port, 5434);
  assert.equal(target.database, 'endzone_local');
  assert.equal(target.loopback, true);

  assert.match(output, /host=127\.0\.0\.1/);
  assert.match(output, /port=5434/);
  assert.match(output, /database=endzone_local/);
  assert.match(output, /PGHOST/);
});

test('describes a URL target by naming the variable that supplied it', () => {
  const { target, output } = announce({ DATABASE_URL: REMOTE_URL, [OPT_IN]: '1' });

  assert.equal(target.via, 'url');
  assert.equal(target.source, 'DATABASE_URL');
  assert.equal(target.host, 'db.abcdefghijkl.supabase.co');
  assert.equal(target.port, 5432);
  assert.equal(target.database, 'postgres');

  assert.match(output, /host=db\.abcdefghijkl\.supabase\.co/);
  assert.match(output, /database=postgres/);
  assert.match(output, /from DATABASE_URL/);
});

test('prints the target BEFORE refusing, so the line is readable even on the failure path', () => {
  const { error, output } = announceExpectingThrow({ DATABASE_URL: REMOTE_URL });

  assert.ok(error, 'expected a refusal');
  assert.match(output, /host=db\.abcdefghijkl\.supabase\.co/);
});

test('never prints the password, on either path, whether it allows or refuses', () => {
  const allowedUrl = announce({ DATABASE_URL: LOCAL_URL });
  const refusedUrl = announceExpectingThrow({ DATABASE_URL: REMOTE_URL });
  const pg = announce({ PGHOST: 'localhost', PGPASSWORD: SECRET, PGUSER: 'postgres' });

  for (const [label, text] of [
    ['allowed URL output', allowedUrl.output],
    ['refused URL output', refusedUrl.output],
    ['refused URL message', refusedUrl.error.message],
    ['PG* output', pg.output],
  ]) {
    assert.ok(!text.includes(SECRET), `${label} leaked the password: ${text}`);
  }
});

test('the whole connection string never appears in the output either', () => {
  const { output } = announce({ DATABASE_URL: LOCAL_URL });
  assert.ok(!output.includes(LOCAL_URL));
});

// --- Precedence and the both-set disclosure ---------------------------------

test('a URL wins over the PG* block and the output says the PG* variables were ignored', () => {
  const { target, output } = announce({
    DATABASE_URL: REMOTE_URL,
    PGHOST: '127.0.0.1',
    PGPORT: '5434',
    PGDATABASE: 'endzone_local',
    PGUSER: 'postgres',
    PGPASSWORD: SECRET,
    [OPT_IN]: '1',
  });

  assert.equal(target.via, 'url');
  assert.deepEqual(target.ignored, ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']);

  // The winner AND the loser, both by name. Naming only the winner would still
  // leave someone believing their PG* override took effect.
  assert.match(output, /DATABASE_URL/);
  assert.match(output, /ignored/i);
  for (const name of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    assert.match(output, new RegExp(name));
  }
});

test('a single PG* variable is enough to be reported as ignored, and reads as one', () => {
  const { target, output } = announce({ DATABASE_URL: LOCAL_URL, PGHOST: '10.0.0.9' });

  assert.deepEqual(target.ignored, ['PGHOST']);
  assert.match(output, /ignored/i);
  assert.match(output, /PGHOST/);

  // Number agreement. A guard nobody trusts is a guard nobody reads, and
  // "PGHOST were set" is exactly the sort of seam that makes a message look
  // machine-assembled rather than meant.
  assert.match(output, /PGHOST was set and IGNORED/);
  assert.doesNotMatch(output, /\bwere set\b/);

  const refused = announceExpectingThrow({ DATABASE_URL: REMOTE_URL, PGHOST: '10.0.0.9' });
  assert.match(refused.error.message, /PGHOST was set and IGNORED/);
  assert.doesNotMatch(refused.error.message, /\bwere set\b/);
});

test('several ignored variables read as plural', () => {
  const { output } = announce({ DATABASE_URL: LOCAL_URL, PGHOST: '10.0.0.9', PGPORT: '5432' });
  assert.match(output, /PGHOST, PGPORT were set and IGNORED/);
  assert.doesNotMatch(output, /\bwas set\b/);
});

test('DATABASE_URL_MIGRATIONS beats DATABASE_URL_RUNTIME beats DATABASE_URL', () => {
  const migrations = resolveTarget({
    DATABASE_URL_MIGRATIONS: 'postgresql://u@a.example.com/one',
    DATABASE_URL_RUNTIME: 'postgresql://u@b.example.com/two',
    DATABASE_URL: 'postgresql://u@c.example.com/three',
  });
  assert.equal(migrations.source, 'DATABASE_URL_MIGRATIONS');
  assert.equal(migrations.host, 'a.example.com');
  assert.deepEqual(migrations.ignored, ['DATABASE_URL_RUNTIME', 'DATABASE_URL']);

  const runtime = resolveTarget({
    DATABASE_URL_RUNTIME: 'postgresql://u@b.example.com/two',
    DATABASE_URL: 'postgresql://u@c.example.com/three',
  });
  assert.equal(runtime.source, 'DATABASE_URL_RUNTIME');
  assert.deepEqual(runtime.ignored, ['DATABASE_URL']);

  const plain = resolveTarget({ DATABASE_URL: 'postgresql://u@c.example.com/three' });
  assert.equal(plain.source, 'DATABASE_URL');
  assert.deepEqual(plain.ignored, []);
});

test('the reason a variable lost matches WHY it lost, not a fixed sentence', () => {
  // This is the deploy's own shape: two DATABASE_URL* variables, no PG* at
  // all. Saying "a DATABASE_URL* always beats the PG* block" here would be
  // explaining a defeat that never happened, in the one output Cory reads to
  // confirm the deploy is pointed correctly.
  const deploy = announce({
    DATABASE_URL_MIGRATIONS: 'postgresql://u@a.example.com/one',
    DATABASE_URL_RUNTIME: 'postgresql://u@b.example.com/two',
    [OPT_IN]: '1',
  });
  assert.match(deploy.output, /DATABASE_URL_RUNTIME/);
  assert.doesNotMatch(deploy.output, /PG\*/);

  // PG* only: the PG* sentence is the right one, and nothing claims a
  // lower-priority URL variable lost.
  const pgLost = announce({
    DATABASE_URL: 'postgresql://u@a.example.com/one',
    PGHOST: '127.0.0.1',
    [OPT_IN]: '1',
  });
  assert.match(pgLost.output, /PG\* block/);
  assert.doesNotMatch(pgLost.output, /first one set wins/);

  // Both kinds lost: both reasons are given.
  const both = announce({
    DATABASE_URL_MIGRATIONS: 'postgresql://u@a.example.com/one',
    DATABASE_URL: 'postgresql://u@c.example.com/three',
    PGHOST: '127.0.0.1',
    [OPT_IN]: '1',
  });
  assert.match(both.output, /PG\* block/);
  assert.match(both.output, /first one set wins/);
});

test('an empty-string URL variable does not win (it is not a target)', () => {
  const target = resolveTarget({ DATABASE_URL_MIGRATIONS: '', PGHOST: '127.0.0.1' });
  assert.equal(target.via, 'pg');
  assert.equal(target.host, '127.0.0.1');
});

// --- The refusal ------------------------------------------------------------

test('a remote host without the opt-in throws, naming the host, the variable and the opt-in', () => {
  const { error } = announceExpectingThrow({ DATABASE_URL: REMOTE_URL });

  assert.ok(error, 'expected a refusal');
  assert.match(error.message, /db\.abcdefghijkl\.supabase\.co/);
  assert.match(error.message, /DATABASE_URL/);
  assert.match(error.message, new RegExp(OPT_IN));
});

test('a remote host refusal also names the ignored PG* block, which is how the incident happened', () => {
  const { error } = announceExpectingThrow({
    DATABASE_URL: REMOTE_URL,
    PGHOST: '127.0.0.1',
    PGPORT: '5434',
  });

  assert.match(error.message, /PGHOST/);
  assert.match(error.message, /PGPORT/);
});

test('a remote host with the opt-in proceeds, and says out loud that it was allowed', () => {
  const { target, output } = announce({ DATABASE_URL: REMOTE_URL, [OPT_IN]: '1' });

  assert.equal(target.loopback, false);
  assert.equal(target.allowedRemote, true);
  assert.match(output, new RegExp(`${OPT_IN}`));
});

test('the opt-in must be exactly "1"', () => {
  for (const value of ['0', 'true', 'yes', '', ' 1', 'TRUE']) {
    const { error } = announceExpectingThrow({ DATABASE_URL: REMOTE_URL, [OPT_IN]: value });
    assert.ok(error, `${OPT_IN}=${JSON.stringify(value)} should not have been accepted`);
  }
});

test('loopback proceeds without any opt-in, by every spelling of loopback', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    const target = resolveTarget({ PGHOST: host });
    assert.equal(target.loopback, true, `${host} should be loopback`);
    assert.doesNotThrow(() => announceTarget({ env: { PGHOST: host }, write: () => {} }));
  }

  assert.doesNotThrow(() => announceTarget({
    env: { DATABASE_URL: LOCAL_URL },
    write: () => {},
  }));
});

test('an empty env resolves to the loopback defaults and proceeds', () => {
  const { target } = announce({});
  assert.equal(target.via, 'pg');
  assert.equal(target.host, 'localhost');
  assert.equal(target.port, 5432);
  assert.equal(target.database, 'endzone_empire');
  assert.equal(target.loopback, true);
});

test('a non-loopback PG* host is refused too, not just a URL one', () => {
  const { error } = announceExpectingThrow({ PGHOST: 'db.abcdefghijkl.supabase.co' });
  assert.ok(error, 'expected a refusal');
  assert.match(error.message, /db\.abcdefghijkl\.supabase\.co/);
  assert.match(error.message, /PGHOST/);
});

test('a host-less connection string is refused, because pg resolves the host from PGHOST', () => {
  // Found by review, and it defeated BOTH mechanisms at once, which is why it
  // gets its own test rather than a line in another.
  //
  // `postgresql:///postgres` has no authority, so `new URL(...).hostname` is
  // the empty string. Treating that as loopback (dbSsl.js does, for its own
  // narrower purpose) made the guard allow it AND print `host=` with nothing
  // after it, while `pg` went on to take the host from PGHOST and connect to
  // a remote database. The printed line was blank exactly where it was meant
  // to be loudest.
  //
  // An empty host is not one of the three loopback spellings the issue names,
  // and it cannot be shown to be local, so it is refused like any other host
  // that cannot be proven local.
  const { error, output } = announceExpectingThrow({
    DATABASE_URL: 'postgresql:///postgres',
    PGHOST: 'db.evil.invalid',
  });

  assert.ok(error, 'a host-less connection string must not pass the guard');
  assert.match(error.message, new RegExp(OPT_IN));
  // And it must not claim a host it does not have.
  assert.doesNotMatch(output, /host= /);
  assert.doesNotMatch(output, /host=$/m);
});

test('an unparseable URL is refused rather than assumed local', () => {
  const { error, output } = announceExpectingThrow({ DATABASE_URL: 'not-a-url' });
  assert.ok(error, 'an unparseable target cannot be proven loopback, so it must refuse');
  assert.match(error.message, new RegExp(OPT_IN));
  assert.doesNotMatch(output, /host=not-a-url/);
});

// --- The connection handed to knex ------------------------------------------

test('a URL target becomes a connectionString connection, a PG* target a discrete one', () => {
  const urlConn = connectionFor(resolveTarget({ DATABASE_URL: LOCAL_URL }));
  assert.equal(urlConn.connectionString, LOCAL_URL);
  assert.equal(urlConn.ssl, false, 'sslForConnection returns false for loopback');

  const pgConn = connectionFor(resolveTarget({
    PGHOST: '127.0.0.1',
    PGPORT: '5434',
    PGDATABASE: 'endzone_local',
    PGUSER: 'postgres',
    PGPASSWORD: SECRET,
  }));
  assert.deepEqual(pgConn, {
    host: '127.0.0.1',
    port: 5434,
    database: 'endzone_local',
    user: 'postgres',
    password: SECRET,
  });
});

test('describeTarget and refusalMessage are pure: they return lines and never write', () => {
  const target = resolveTarget({ DATABASE_URL: REMOTE_URL, PGHOST: '127.0.0.1' });
  assert.ok(Array.isArray(describeTarget(target)));
  assert.equal(typeof refusalMessage(target), 'string');
});
