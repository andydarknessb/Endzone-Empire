'use strict';

// Guard logic for issue #251: knex migration timestamp prefixes must be
// unique. Knex orders migrations by whole filename, so two files that share
// a prefix are ordered by the descriptive half of the name. That half is
// the part people rename freely, precisely because it is assumed to carry
// no meaning, so a shared prefix turns a harmless rename into a silent
// reorder of two schema changes.
//
// This module is pure: it reasons about filename lists it is handed. The
// test file (scripts/migrationPrefixes.test.js) is what reads the real
// directory, and only the `guards` npm script (run by the `guards` CI job)
// makes it bite on a pull request.

const path = require('node:path');

// Mirrors migrations.directory in knexfile.js and server/knexfile.js; the test
// file reads both and fails if this path and theirs ever disagree.
const MIGRATIONS_DIR = path.join(__dirname, '..', 'server', 'db', 'migrations');

// The one duplicate that existed when this guard was written, kept exactly
// as it is. Both files are applied in every environment, and knex matches
// applied migrations by filename in `knex_migrations`, so renaming either
// one would make knex see a missing migration and a pending one, which is a
// maintainer action against the shared database that buys nothing: the two
// alter independent columns on `leagues` and are order-independent, and each
// file's header says so. The exemption is for this exact pair; a third file
// on the prefix, or a rename of either member, is a fresh violation.
const GRANDFATHERED_PREFIXES = Object.freeze({
  '20260822000001': Object.freeze([
    '20260822000001_draft_timezone.js',
    '20260822000001_fix_draft_rounds_at_start.js',
  ]),
});

const PREFIX_PATTERN = /^(\d+)_/;

function parseMigrationPrefix(filename) {
  const match = PREFIX_PATTERN.exec(filename);
  return match ? match[1] : null;
}

function sameFileSet(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((file, i) => file === sortedB[i]);
}

function findDuplicatePrefixes(filenames, grandfathered = {}) {
  const byPrefix = new Map();
  for (const filename of filenames) {
    const prefix = parseMigrationPrefix(filename);
    if (prefix === null) continue;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(filename);
  }

  const violations = [];
  for (const [prefix, files] of byPrefix) {
    if (files.length < 2) continue;
    const exempt = grandfathered[prefix];
    if (exempt && sameFileSet(exempt, files)) continue;
    violations.push({ prefix, files: [...files].sort() });
  }
  return violations.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
}

function buildViolationMessage(violations) {
  if (violations.length === 0) return '';
  const lines = [
    'Duplicate migration timestamp prefix (see issue #251).',
    'Knex orders migrations by filename, so files sharing a prefix are ordered',
    'by the rest of the name, which a rename can silently reorder. Give each',
    'new migration its own prefix.',
    '',
  ];
  for (const { prefix, files } of violations) {
    lines.push(`  ${prefix}:`);
    for (const file of files) lines.push(`    ${file}`);
  }
  return lines.join('\n');
}

module.exports = {
  MIGRATIONS_DIR,
  GRANDFATHERED_PREFIXES,
  findDuplicatePrefixes,
  buildViolationMessage,
};
