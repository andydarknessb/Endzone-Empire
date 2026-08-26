const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MIGRATIONS_DIR,
  GRANDFATHERED_PREFIXES,
  findDuplicatePrefixes,
  buildViolationMessage,
} = require('./migrationPrefixes');

// Guard for issue #251: every knex migration must carry a unique timestamp
// prefix. Knex orders migrations by whole filename, so two files sharing a
// prefix are ordered by the descriptive half of the name, which people
// rename freely on the assumption that it carries no meaning. A unique
// prefix keeps the order explicit and reviewable.
//
// The pure tests below exercise the logic against fixture filenames. The
// last test is the guard itself: it reads the real migrations directory.
// Do not read the presence of this file as proof on its own: it only bites
// on a pull request because the `guards` npm script (and the `guards` CI
// job that runs it) includes test:migration-prefixes.

test('findDuplicatePrefixes: distinct prefixes produce no violations', () => {
  const files = [
    '20260822000001_a.js',
    '20260822000002_b.js',
    '20260823000001_c.js',
  ];
  assert.deepEqual(findDuplicatePrefixes(files), []);
});

test('findDuplicatePrefixes: a seeded duplicate is reported with both filenames', () => {
  const files = [
    '20260901000001_add_thing.js',
    '20260901000001_add_other_thing.js',
    '20260901000002_unrelated.js',
  ];
  assert.deepEqual(findDuplicatePrefixes(files), [
    {
      prefix: '20260901000001',
      files: ['20260901000001_add_other_thing.js', '20260901000001_add_thing.js'],
    },
  ]);
});

test('findDuplicatePrefixes: three files on one prefix are one violation listing all three', () => {
  const files = ['20260901000001_c.js', '20260901000001_a.js', '20260901000001_b.js'];
  const [violation] = findDuplicatePrefixes(files);
  assert.equal(violation.prefix, '20260901000001');
  assert.deepEqual(violation.files, [
    '20260901000001_a.js',
    '20260901000001_b.js',
    '20260901000001_c.js',
  ]);
});

test('findDuplicatePrefixes: non-migration files in the directory are ignored', () => {
  const files = ['20260901000001_a.js', 'README.md', '.gitkeep', '20260901000002_b.js'];
  assert.deepEqual(findDuplicatePrefixes(files), []);
});

test('findDuplicatePrefixes: a grandfathered prefix is exempt only for its exact file set', () => {
  const grandfathered = {
    '20260901000001': ['20260901000001_a.js', '20260901000001_b.js'],
  };
  // The exact recorded pair passes.
  assert.deepEqual(
    findDuplicatePrefixes(['20260901000001_a.js', '20260901000001_b.js'], grandfathered),
    []
  );
  // A third file joining the grandfathered prefix is a fresh violation.
  assert.equal(
    findDuplicatePrefixes(
      ['20260901000001_a.js', '20260901000001_b.js', '20260901000001_c.js'],
      grandfathered
    ).length,
    1
  );
  // Renaming one member of the pair is also a violation: the exemption is
  // for the files as they were applied, not for the prefix in general.
  assert.equal(
    findDuplicatePrefixes(['20260901000001_a.js', '20260901000001_zz.js'], grandfathered).length,
    1
  );
});

test('buildViolationMessage: names the prefix, every file, and the knex ordering reason', () => {
  const message = buildViolationMessage([
    { prefix: '20260901000001', files: ['20260901000001_a.js', '20260901000001_b.js'] },
  ]);
  assert.match(message, /20260901000001/);
  assert.match(message, /20260901000001_a\.js/);
  assert.match(message, /20260901000001_b\.js/);
  assert.match(message, /#251/);
});

// The directory the guard reads is what the two knexfiles point knex at, not
// a path that happened to be right when the guard was written. Both knexfiles
// are read as TEXT rather than required: requiring either one runs
// resolveKnexConnection(), which announces a target on stderr and throws when
// it is not loopback, and a guard must not depend on a database target.
test('MIGRATIONS_DIR is the directory the root knexfile (the accident path) declares', () => {
  const repoRoot = path.join(__dirname, '..');
  const knexfile = fs.readFileSync(path.join(repoRoot, 'knexfile.js'), 'utf8');
  const match = /migrations:\s*\{\s*directory:\s*'([^']+)'/.exec(knexfile);
  assert.ok(match, 'could not find migrations.directory in knexfile.js');
  assert.equal(path.resolve(MIGRATIONS_DIR), path.resolve(repoRoot, match[1]));
});

test('MIGRATIONS_DIR is the directory server/knexfile.js (the deploy path) declares', () => {
  const serverDir = path.join(__dirname, '..', 'server');
  const knexfile = fs.readFileSync(path.join(serverDir, 'knexfile.js'), 'utf8');
  const match = /migrations:\s*\{\s*directory:\s*path\.join\(__dirname((?:,\s*'[^']+')+)\)/.exec(knexfile);
  assert.ok(match, 'could not find migrations.directory in server/knexfile.js');
  const segments = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.equal(path.resolve(MIGRATIONS_DIR), path.resolve(serverDir, ...segments));
});

test('MIGRATIONS_DIR exists and is the tracked server/db/migrations directory', () => {
  assert.ok(fs.existsSync(MIGRATIONS_DIR), MIGRATIONS_DIR + ' does not exist');
  assert.equal(path.basename(MIGRATIONS_DIR), 'migrations');
  assert.equal(path.basename(path.dirname(MIGRATIONS_DIR)), 'db');
});

test('GRANDFATHERED_PREFIXES: every recorded file still exists on disk', () => {
  // If one of these is ever renamed or removed, the entry is stale and the
  // exemption should be reconsidered rather than silently kept.
  for (const files of Object.values(GRANDFATHERED_PREFIXES)) {
    for (const file of files) {
      assert.ok(
        fs.existsSync(path.join(MIGRATIONS_DIR, file)),
        `grandfathered migration missing on disk: ${file}`
      );
    }
  }
});

test('guard: the real migrations directory has no duplicate timestamp prefixes beyond the grandfathered pair', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR);
  assert.ok(files.length > 0, `no files found in ${MIGRATIONS_DIR}`);
  const violations = findDuplicatePrefixes(files, GRANDFATHERED_PREFIXES);
  assert.deepEqual(violations, [], buildViolationMessage(violations));
});
