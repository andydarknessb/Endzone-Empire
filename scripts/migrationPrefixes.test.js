const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MIGRATIONS_DIR,
  GRANDFATHERED_PREFIXES,
  parseMigrationPrefix,
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

test('parseMigrationPrefix: the leading digit run before the first underscore is the prefix', () => {
  assert.equal(
    parseMigrationPrefix('20260822000001_draft_timezone.js'),
    '20260822000001'
  );
});

test('parseMigrationPrefix: files that do not look like migrations yield null', () => {
  assert.equal(parseMigrationPrefix('README.md'), null);
  assert.equal(parseMigrationPrefix('helpers.js'), null);
  assert.equal(parseMigrationPrefix('_20260822000001_x.js'), null);
});

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
