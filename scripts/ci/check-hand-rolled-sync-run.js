#!/usr/bin/env node
/**
 * Guard against a new hand-rolled Sync run skeleton landing silently (#1206,
 * ADR 0036, #1197 R5).
 *
 * `server/modules/syncRun.js`'s `runSyncJob` is the ONE place a feed sync's
 * shape is written: it takes the job's advisory lock (`SELECT
 * pg_advisory_xact_lock($1)`) inside each unit's own transaction and it is
 * the ONE writer of `data_sync_runs` (`recordDataSyncRun`). #1206 deleted the
 * last hand-rolled copies of that shape (`runInjurySync`, `recordAdpRun`,
 * the `services/dataSyncRuns.js` re-export); this guard is the consumer that
 * keeps a new one from growing back with nobody noticing (ADR 0010: a
 * convention with no consumer is unaudited), the same role
 * check-hand-rolled-transaction.js plays for a pooled transaction's close.
 *
 * TWO RULES, each read from the parsed source's string/template literals so
 * a match inside a COMMENT never counts (only code does):
 *
 *   1. `pg_advisory_xact_lock(` - the blocking, transaction-scoped advisory
 *      lock form a Sync run job takes - is allowed only in LOCK_ALLOWED_FILES
 *      below. `pg_try_advisory_xact_lock` (the try-and-skip form
 *      `withAdvisoryLock` uses, ADR 0033) does NOT match: the pattern
 *      anchors on `pg_advisory_xact_lock`, which is not a substring of the
 *      try form (`pg_TRY_advisory_xact_lock`).
 *   2. `INSERT INTO data_sync_runs` (case-insensitive, table name quoted or
 *      not) is allowed only in INSERT_ALLOWED_FILE - the one writer of the
 *      table.
 *
 * SCANNED: every non-test `.js`/`.jsx` file under `server/` and `scripts/`,
 * excluding the whole `server/test/` tree and this guard's own two files
 * (never scanned, so its docblock and fixtures above are never counted -
 * ADR 0010's file-content collision). `.sql` files are out of scope by
 * construction (the extension filter never reads them) - the migration that
 * created `data_sync_runs` and the weekly-trophy-engine SQL both stay
 * unaffected.
 *
 * ALLOWLIST ENTRIES, and why (#1206 lead ruling on the issue thread):
 *
 *   - `server/modules/syncRun.js` - the module itself.
 *   - `server/modules/advisoryLock.js` - `23003`/`23004`/`23005`'s direct
 *     callers (ADR 0033 Ruling 2 keeps this module outside `withTransaction`
 *     too).
 *   - `server/services/holdout.service.js` - takes
 *     `pg_advisory_xact_lock(hashtext($1))` inside its own transaction; not
 *     a Sync run.
 *   - `server/services/sleeper.service.js` - ruled on #1251 criterion 7:
 *     `upsertSeasonStats` takes a direct blocking
 *     `pg_advisory_xact_lock(23004)` inside its own transaction (#1251 landed
 *     the call) and is not a run either - it stays off `data_sync_runs` on
 *     purpose, since it does not go through `runSyncJob`. This entry was
 *     added pre-emptively while #1206 and #1251 were both in flight, before
 *     either merged, so whichever landed second would not go red on
 *     `guards`; #1251's own risk review confirmed the lock actually lands
 *     inside a `withTransaction` block rather than a bare `pool.query` (which
 *     would be transaction-scoped to that one implicit statement and release
 *     immediately, serializing nothing - the shape #1206's risk review had
 *     flagged as the thing to verify here).
 *
 * Run standalone: `npm run check:hand-rolled-sync-run`, which runs this
 * script's own `node --test` file first, then the scan over the real tree -
 * the same shape as `npm run check:hand-rolled-transaction`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const REPO = path.join(__dirname, '..', '..');
const EXTENSIONS = new Set(['.js', '.jsx']);

const SCAN_ROOTS = Object.freeze(['server', 'scripts']);
const ROOT_DIRECTORIES = Object.freeze({
  server: path.join(REPO, 'server'),
  scripts: path.join(REPO, 'scripts'),
});

// Whole-directory exclusions, repo-relative posix, matched as the path
// itself or any of its subpaths.
const EXCLUDED_DIR_PREFIXES = Object.freeze(['server/test']);

// This guard's own two files. Excluded so it never scans itself - the
// pg_advisory_xact_lock/data_sync_runs strings in the docblock above and the
// fixtures in its test file are never counted (ADR 0010's file-content
// collision, same note as check-hand-rolled-transaction.js).
const SELF_FILES = Object.freeze(new Set([
  'scripts/ci/check-hand-rolled-sync-run.js',
  'scripts/ci/check-hand-rolled-sync-run.test.js',
]));

const LOCK_ALLOWED_FILES = Object.freeze(new Set([
  'server/modules/syncRun.js',
  'server/modules/advisoryLock.js',
  'server/services/holdout.service.js',
  'server/services/sleeper.service.js',
]));

const INSERT_ALLOWED_FILE = 'server/modules/syncRun.js';

// Anchored on the FULL blocking-lock name so the try-and-skip form
// (pg_TRY_advisory_xact_lock) is never a substring match. Case-insensitive
// like INSERT_PATTERN below (PR #1255 review f1): Postgres identifiers are
// case-insensitive unless quoted, and a hand-rolled site is not guaranteed
// to write the call in lower case.
const LOCK_PATTERN = /\bpg_advisory_xact_lock\s*\(/i;
const INSERT_PATTERN = /insert\s+into\s+"?data_sync_runs"?\b/i;

const toPosix = (rel) => rel.split(path.sep).join('/');
const isTestFile = (rel) => /\.test\.(js|jsx)$/.test(rel);
const isExcludedDir = (rel) => EXCLUDED_DIR_PREFIXES.some(
  (prefix) => rel === prefix || rel.startsWith(`${prefix}/`)
);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // dir descends only from the two hardcoded SCAN_ROOTS (server, scripts);
    // entry.name comes from readdirSync over that fixed repo tree, never
    // from a request or attacker-controlled input - this is a CI/dev guard
    // with no request path (same note and same shape as the sibling walk in
    // check-hand-rolled-transaction.js and animationSafetyGuard.js).
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'build') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function parse(source, file) {
  try {
    return parser.parse(source, {
      sourceType: 'unambiguous',
      plugins: /\.jsx$/.test(file) ? ['jsx'] : [],
      errorRecovery: false,
    });
  } catch (err) {
    // A parse failure must be loud: a guard that silently skips a file it
    // cannot read certifies nothing about that file.
    throw new Error(`check-hand-rolled-sync-run: failed to parse ${file}: ${err.message}`);
  }
}

function eachNode(root, visit) {
  const recurse = (node) => {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range' || key === 'start' || key === 'end'
        || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments'
        || key === 'comments' || key === 'extra' || key === 'tokens') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) recurse(child);
      } else if (value && typeof value.type === 'string') {
        recurse(value);
      }
    }
  };
  recurse(root);
}

/**
 * Every literal string chunk in one file's source, as `{ text, line }`: a
 * plain StringLiteral, or each static quasi of a TemplateLiteral (scanned
 * regardless of whether the template also interpolates elsewhere, so a
 * multi-line SQL template with a trailing `${...}` placeholder still has its
 * literal SQL text checked). Comments are never visited by this AST walk -
 * they live on the node as leadingComments/trailingComments, not as literal
 * nodes of their own - so the same text inside a comment never matches
 * (criterion 3 of #1206).
 */
function literalChunks(source, file) {
  const ast = parse(source, file);
  const chunks = [];
  eachNode(ast, (node) => {
    if (node.type === 'StringLiteral') {
      chunks.push({ text: node.value, line: node.loc ? node.loc.start.line : 0 });
    } else if (node.type === 'TemplateLiteral') {
      for (const quasi of node.quasis) {
        // `cooked` is undefined for a quasi with an invalid escape sequence
        // (e.g. inside a String.raw tagged template); `raw` still carries
        // the literal source text in that case, so falling back to it keeps
        // a hand-rolled site from evading the scan through an unrelated
        // parse quirk (qa-reviewer, #1206 risk review).
        chunks.push({
          text: quasi.value.cooked ?? quasi.value.raw ?? '',
          line: quasi.loc ? quasi.loc.start.line : 0,
        });
      }
    }
  });
  return chunks;
}

/**
 * Analyse a set of `{ file, source }` records. Pure, so a test can hand it
 * fixture sources with no disk. Returns `{ findings }`: one entry per raw
 * `pg_advisory_xact_lock(` call outside LOCK_ALLOWED_FILES, or raw
 * `INSERT INTO data_sync_runs` outside INSERT_ALLOWED_FILE, each
 * `{ file, line, rule }`.
 */
function analyze(files) {
  const findings = [];
  for (const { file, source } of files) {
    if (isTestFile(file) || isExcludedDir(file) || SELF_FILES.has(file)) continue;
    for (const { text, line } of literalChunks(source, file)) {
      if (LOCK_PATTERN.test(text) && !LOCK_ALLOWED_FILES.has(file)) {
        findings.push({
          file,
          line,
          rule: `pg_advisory_xact_lock is only allowed in ${[...LOCK_ALLOWED_FILES].sort().join(', ')} (ADR 0036/#1206)`,
        });
      }
      if (INSERT_PATTERN.test(text) && file !== INSERT_ALLOWED_FILE) {
        findings.push({
          file,
          line,
          rule: `INSERT INTO data_sync_runs is only allowed in ${INSERT_ALLOWED_FILE}, the one writer of the table (ADR 0036)`,
        });
      }
    }
  }
  return { findings };
}

/** Read every scannable file under `roots` as `{ file, source }`. */
function readFiles(roots) {
  const files = [];
  for (const root of roots) {
    const directory = ROOT_DIRECTORIES[root];
    if (!directory) throw new Error(`hand-rolled-sync-run scan root is not allowed: ${root}`);
    for (const abs of walk(directory)) {
      const rel = toPosix(path.relative(REPO, abs));
      files.push({ file: rel, source: fs.readFileSync(abs, 'utf8') });
    }
  }
  return files;
}

/** Analyse the real tree under SCAN_ROOTS. */
function check(roots = SCAN_ROOTS) {
  return analyze(readFiles(roots));
}

function main() {
  const { findings } = check();
  if (findings.length === 0) {
    console.log('✅ pg_advisory_xact_lock and the data_sync_runs writer stay inside the Sync run contract (ADR 0036).');
    return;
  }
  console.error(
    `\n❌ ${findings.length} hand-rolled Sync run site(s) outside the contract.\n`
    + 'Route the lock and the run row through server/modules/syncRun.js\'s runSyncJob\n'
    + '(ADR 0036), or - if the site genuinely is not a Sync run - get it added to this\n'
    + "guard's allowlist with the rule it implements (scripts/ci/check-hand-rolled-sync-run.js).\n"
  );
  findings.forEach((f) => console.error(`  ${f.file}:${f.line}: ${f.rule}`));
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  SCAN_ROOTS,
  LOCK_ALLOWED_FILES,
  INSERT_ALLOWED_FILE,
  analyze,
  check,
};
