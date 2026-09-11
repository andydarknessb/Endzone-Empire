const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCK_ALLOWED_FILES,
  INSERT_ALLOWED_FILE,
  analyze,
  check,
} = require('./check-hand-rolled-sync-run');

// Fixtures are `{ file, source }` pairs fed straight to `analyze()` - no disk
// needed - mirroring scripts/check-hand-rolled-transaction.js's own test
// shape. Each source is a minimal, syntactically valid JS module so the
// guard's babel parse never trips over the fixture itself.

test('a raw pg_advisory_xact_lock call in a file not on the allowlist fails, naming file:line', () => {
  const { findings } = analyze([
    {
      file: 'server/services/notAJob.service.js',
      source: "async function run(client) {\n  await client.query('SELECT pg_advisory_xact_lock($1)', [1]);\n}\nmodule.exports = { run };\n",
    },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'server/services/notAJob.service.js');
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].rule, /pg_advisory_xact_lock/);
});

test('the same text inside a comment passes - the guard matches code, not comments', () => {
  const { findings } = analyze([
    {
      file: 'server/services/adp.service.js',
      source: "// cannot form the cycle. It is the BLOCKING xact form (pg_advisory_xact_lock):\nfunction fetchAdp() {\n  return null;\n}\nmodule.exports = { fetchAdp };\n",
    },
  ]);
  assert.deepEqual(findings, []);
});

test('a pg_advisory_xact_lock call passes in each allowed file', () => {
  for (const file of LOCK_ALLOWED_FILES) {
    const { findings } = analyze([
      {
        file,
        source: "async function run(client) {\n  await client.query('SELECT pg_advisory_xact_lock($1)', [1]);\n}\nmodule.exports = { run };\n",
      },
    ]);
    assert.deepEqual(findings, [], `${file} should be allowed to call pg_advisory_xact_lock`);
  }
});

test('an allowed file with no call passes', () => {
  const { findings } = analyze([
    { file: 'server/services/sleeper.service.js', source: "function upsertSeasonStats() {\n  return null;\n}\nmodule.exports = { upsertSeasonStats };\n" },
  ]);
  assert.deepEqual(findings, []);
});

test('pg_try_advisory_xact_lock never matches, in any file', () => {
  const { findings } = analyze([
    {
      file: 'server/services/notAJob.service.js',
      source: "async function run(client) {\n  await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [1]);\n}\nmodule.exports = { run };\n",
    },
  ]);
  assert.deepEqual(findings, []);
});

test('an upper-case pg_advisory_xact_lock call in a disallowed file fails, naming file:line (PR #1255 review f1)', () => {
  const { findings } = analyze([
    {
      file: 'server/services/notAJob.service.js',
      source: "async function run(client) {\n  await client.query('SELECT PG_ADVISORY_XACT_LOCK($1)', [1]);\n}\nmodule.exports = { run };\n",
    },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'server/services/notAJob.service.js');
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].rule, /pg_advisory_xact_lock/);
});

test('an upper-case PG_TRY_ADVISORY_XACT_LOCK never matches, in any file (PR #1255 review f1)', () => {
  const { findings } = analyze([
    {
      file: 'server/services/notAJob.service.js',
      source: "async function run(client) {\n  await client.query('SELECT PG_TRY_ADVISORY_XACT_LOCK($1) AS locked', [1]);\n}\nmodule.exports = { run };\n",
    },
  ]);
  assert.deepEqual(findings, []);
});

test('INSERT INTO data_sync_runs passes in the one allowed writer', () => {
  const { findings } = analyze([
    {
      file: INSERT_ALLOWED_FILE,
      source: "async function recordDataSyncRun() {\n  return pool.query('INSERT INTO \"data_sync_runs\" (\"job\") VALUES ($1)', ['x']);\n}\nmodule.exports = { recordDataSyncRun };\n",
    },
  ]);
  assert.deepEqual(findings, []);
});

test('a raw data_sync_runs insert outside the one allowed writer fails, naming file:line', () => {
  const { findings } = analyze([
    {
      file: 'server/services/rogue.service.js',
      source: "async function writeRow() {\n  return pool.query('insert into data_sync_runs (job) values ($1)', ['x']);\n}\nmodule.exports = { writeRow };\n",
    },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'server/services/rogue.service.js');
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].rule, /data_sync_runs/);
});

test('a raw insert matches case-insensitively and whether the table name is quoted', () => {
  const { findings } = analyze([
    {
      file: 'server/services/rogue.service.js',
      source: "async function writeRow() {\n  return pool.query('INSERT INTO data_sync_runs (job) VALUES ($1)', ['x']);\n}\n",
    },
  ]);
  assert.equal(findings.length, 1);
});

test('the server test tree is never scanned', () => {
  const { findings } = analyze([
    {
      file: 'server/test/rogue.test.js',
      source: "test('x', async () => {\n  await client.query('SELECT pg_advisory_xact_lock($1)', [1]);\n});\n",
    },
  ]);
  assert.deepEqual(findings, []);
});

test('a *.test.js file outside server/test is never scanned either', () => {
  const { findings } = analyze([
    {
      file: 'scripts/ci/rogue.test.js',
      source: "test('x', async () => {\n  await client.query('SELECT pg_advisory_xact_lock($1)', [1]);\n});\n",
    },
  ]);
  assert.deepEqual(findings, []);
});

test('check() against the real tree finds nothing (post-#1206 deletion)', () => {
  const { findings } = check();
  assert.deepEqual(findings, [], JSON.stringify(findings));
});
