#!/usr/bin/env node
/**
 * Guard against a single-player Roster write landing outside the one module.
 *
 * Spec #2532 ruled that every write that adds or removes ONE player from a
 * roster goes through `server/services/rosterMove.service.js`, so the write-time
 * gate (#940) and the lineup-follows-the-roster rule (#197) cannot be skipped by
 * a new call site that copies a neighbor's INSERT. Four writes are deliberately
 * outside it - they rewrite whole rosters, so a per-player module call would be
 * wrong, not just slow. Nothing read that convention, which is the failure ADR
 * 0010 describes: a convention with no consumer is unaudited. This is the
 * consumer, and per that ADR it ships with the last migration (#2535).
 *
 * THE RULE: under `server/`, the only statements that write a single
 * `team_players` row live in `server/services/rosterMove.service.js`, and the
 * only other `team_players` writes are the four bulk sites named in ALLOWLIST.
 *
 * WHAT IS SCANNED: every `.js` file under `server/` except `server/test/**` and
 * `server/db/**`. Tests are out of scope (the issue says so: a fixture that
 * writes the table is the point, not a violation), and migrations are not
 * application code - a migration is the table's own history, not a roster move.
 * Reads are not scanned at all: only the two write forms below.
 *
 * WHAT COUNTS AS A HIT, and its blind spot: the SQL text
 * `INSERT INTO "team_players"` or `DELETE FROM "team_players"`, found by a
 * string scan of the source. A write built by concatenating the table name from
 * a variable would not be seen; no such site exists, and the alternative (an
 * AST pass matching string literals) sees exactly the same set, because the
 * statement is always written as a literal or a template with no interpolation
 * in its head. The issue prescribes the same sweep as its acceptance check
 * (`git grep` for these two strings), so the guard and the check agree by
 * construction.
 *
 * A NOTE ON COUNTING (ADR 0010's file-content collision): this script names the
 * two forbidden strings in the comments above. The scan reads `server/` only,
 * and this file lives under `scripts/`, so it never scans itself. An auditor
 * grepping the whole tree for them WILL find those examples here; exclude this
 * file from any such count, and say that you did.
 *
 * Run standalone: `npm run check:roster-move-writes`, which runs this script's
 * own `node --test` file first, the way `check:envelope-conformance` does, then
 * the scan over the real tree.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SCAN_ROOT = path.join(REPO, 'server');

// Repo-relative posix, matched exactly. Tests and migrations are out of scope -
// see the docblock.
const EXCLUDED_PREFIXES = Object.freeze(['server/test/', 'server/db/']);

// The module that owns the write. It may write both ways; that is its job.
const OWNER_FILE = 'server/services/rosterMove.service.js';

const WRITE_PATTERN = /(INSERT INTO "team_players"|DELETE FROM "team_players")/g;

/**
 * The four bulk writes that stay outside the module, and why each is bulk.
 *
 * Keyed by `file` with an expected `count`, NOT by line: line numbers churn and
 * an allowlist that needs re-deriving after every edit is one people stop
 * reading. The count is the whole second half of the rule - a fifth write
 * appearing in a file already listed is a new single-player site, and a bare
 * file-level exemption would wave it through.
 *
 * `rule` is what sanctions the entry; an empty rule fails the guard, because an
 * unexplained exception is the thing this guard exists to refuse.
 */
const ALLOWLIST = [
  {
    file: 'server/routes/draft.router.js',
    count: 1,
    rule:
      'Resetting a draft wipes the whole roster for the league in one statement, then '
      + 'the lineup rows with it (#94 story 13). A per-player module call would ask the '
      + 'gate 300 times for the same 16 answers and still delete the same rows.',
  },
  {
    file: 'server/services/commissioner.service.js',
    count: 2,
    rule:
      'Rollover prunes each roster to its keepers: one DELETE with the keeper pairs in '
      + 'NOT IN, plus the empty-keeper-list fallback that deletes the league roster. It '
      + 'runs inside the act that unfreezes the season, so gating it would gate the '
      + 'write that lifts the freeze.',
  },
  {
    file: 'server/services/draftStart.service.js',
    count: 1,
    rule:
      'Starting a draft seeds every team with its keepers in one INSERT ... SELECT over '
      + 'the keeper list, ahead of the first pick. There is no single player to move and '
      + 'no lineup row to place him in yet.',
  },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'build') continue;
      walk(full, out);
    } else if (path.extname(entry.name) === '.js') {
      out.push(full);
    }
  }
  return out;
}

const toPosix = (rel) => rel.split(path.sep).join('/');

/** Every write hit in one file's source, as `{ line, code }`. */
function findWrites(source) {
  const hits = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((text, index) => {
    for (const match of text.matchAll(WRITE_PATTERN)) {
      hits.push({ line: index + 1, code: match[1] });
    }
  });
  return hits;
}

/**
 * Analyse a set of `{ file, source }` records against an allowlist. Pure, so a
 * test can hand it fixture sources with no disk. Returns four finding lists:
 *   - unlisted: a hit in a file the allowlist does not name (and that is not
 *     the owner module or an excluded path)
 *   - overCount: a listed file writing more times than the entry says
 *   - stale: an allowlist entry matching fewer hits than it claims (or none)
 *   - ruleless: an allowlist entry with an empty rule
 */
function analyze(files, { allowlist = ALLOWLIST } = {}) {
  const ruleless = [];
  for (const entry of allowlist) {
    if (typeof entry.rule !== 'string' || entry.rule.trim().length === 0) {
      ruleless.push(`${entry.file}: allowlist entry has no rule`);
    }
  }

  const allowed = new Map();
  for (const entry of allowlist) {
    if (allowed.has(entry.file)) {
      ruleless.push(`${entry.file}: listed twice; one entry per file carries its count`);
    }
    allowed.set(entry.file, { entry, found: 0 });
  }

  const unlisted = [];
  for (const { file, source } of files) {
    if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    if (file === OWNER_FILE) continue;
    const hits = findWrites(source);
    const record = allowed.get(file);
    if (record) {
      record.found += hits.length;
    } else {
      for (const hit of hits) {
        unlisted.push(`${file}:${hit.line}: ${hit.code} outside the Roster move module`);
      }
    }
  }

  const overCount = [];
  const stale = [];
  for (const { entry, found } of allowed.values()) {
    if (found > entry.count) {
      overCount.push(
        `${entry.file}: ${found} Roster writes, allowlist says ${entry.count} - a new one belongs in rosterMove.service.js`
      );
    } else if (found < entry.count) {
      stale.push(`${entry.file}: allowlist says ${entry.count} Roster writes, found ${found}`);
    }
  }

  return { unlisted, overCount, stale, ruleless };
}

/** Analyse the real tree under server/. */
function check(options = {}) {
  const files = walk(SCAN_ROOT).map((abs) => ({
    file: toPosix(path.relative(REPO, abs)),
    source: fs.readFileSync(abs, 'utf8'),
  }));
  return analyze(files, options);
}

function main() {
  const { unlisted, overCount, stale, ruleless } = check();
  const clean = !unlisted.length && !overCount.length && !stale.length && !ruleless.length;
  if (clean) {
    console.log('✅ Every single-player Roster write goes through rosterMove.service.js, or is one of the four ruled bulk writes.');
    return;
  }
  if (unlisted.length) {
    console.error(
      `\n❌ ${unlisted.length} Roster write(s) outside the Roster move module.\n`
      + 'Call rosterMove.add / rosterMove.drop (server/services/rosterMove.service.js),\n'
      + 'or - if the write is genuinely bulk - add it to ALLOWLIST in\n'
      + 'scripts/check-roster-move-writes.js with the rule it implements.\n'
      + 'If you cannot name why it is bulk, that is the finding (ADR 0010).\n'
    );
    unlisted.forEach((v) => console.error(`  ${v}`));
  }
  if (overCount.length || stale.length) {
    const drift = [...overCount, ...stale];
    console.error(`\n❌ ${drift.length} allowlist entr(ies) no longer describe the code:\n`);
    drift.forEach((v) => console.error(`  ${v}`));
  }
  if (ruleless.length) {
    console.error(`\n❌ ${ruleless.length} allowlist entr(ies) with no rule. The rule is the entry's whole purpose.\n`);
    ruleless.forEach((v) => console.error(`  ${v}`));
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWLIST,
  EXCLUDED_PREFIXES,
  OWNER_FILE,
  findWrites,
  analyze,
  check,
};
