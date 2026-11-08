#!/usr/bin/env node
/**
 * Guard against a League row lock outside the League write module (ADR 0070).
 *
 * THE RULE: under `server/services`, `server/routes` and `server/modules`, the
 * only SQL that locks a `leagues` row, or advances its board version, lives in
 * `server/modules/leagueWrite.js`. Every other League write goes through
 * `leagueWrite` (or `lockLeague` inside a caller's own transaction), so the lock
 * mode, the lock order and the board-version advance cannot drift per caller.
 *
 * WHAT COUNTS AS A HIT: a SQL string, scanned as a whole (not line by line, since
 * a statement is often split across lines), that
 *   - carries `FOR UPDATE` or `FOR NO KEY UPDATE` with no `OF` clause while
 *     naming `"leagues"` (the lock lands on the League row), or
 *   - carries `FOR [NO KEY] UPDATE OF "leagues"`, or
 *   - writes `UPDATE "leagues"` with a `"board_version" = "board_version" + ...`.
 * A `FOR UPDATE OF "teams"` on a statement that also reads leagues is not a hit:
 * it locks only the Team row.
 *
 * ITS BLIND SPOT: a lock built by concatenating the SQL from unrelated pieces is
 * seen only if each literal carries the table name it needs. The codebase writes
 * these statements as literals, with `${...}` ternaries for the lock option,
 * which this scan reads with the literal, so the option's text counts too.
 *
 * WHAT IS SCANNED: every `.js` file under the three roots. Tests are not under
 * them (server/test is out of scope), and the owner module is exempt by name.
 *
 * ALLOWLIST: account deletion (one standing exception, ADR 0070 rule 5) plus one
 * entry per hand-written site a later ticket converts. Each entry names its
 * ticket. An entry whose count the tree no longer matches is stale and fails, so
 * whichever ticket converts a site also removes its entry.
 *
 * Run standalone: `npm run check:league-write-locks`, which runs this script's
 * own `node --test` file first, then the scan over the real tree.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

// Repo-relative posix roots the scan walks.
const SCAN_ROOTS = Object.freeze(['server/services', 'server/routes', 'server/modules']);

// The one module that takes a League row lock. It may do so; that is its job.
const OWNER_FILE = 'server/modules/leagueWrite.js';

// A SQL string or a quoted literal. Template literals may hold `${...}` with
// ternaries, so they are read whole; the scan keys on the text the literal holds.
const LITERAL = /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;

// `FOR UPDATE` or `FOR NO KEY UPDATE`, with the optional `OF <table>` that
// narrows which table the lock lands on.
// Keywords match in any case: SQL written lower-case locks the same row.
const ROW_LOCK = /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b(?:\s+OF\s+("?[\w]+"?))?/gi;
const LEAGUES_NAMED = /"leagues"/i;
const BOARD_ADVANCE = /\bUPDATE\s+"leagues"[\s\S]*?"board_version"\s*=\s*"board_version"\s*\+/i;

// Comments are blanked, newlines kept, so a backtick inside a comment cannot open a
// literal that swallows the real statement after it. Line numbers stay true.
function blankComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

/**
 * The allowlist of hand-written League locks the tree still holds.
 *
 * Keyed by `file` with an expected `count`, NOT by line: line numbers churn.
 * `rule` is what sanctions the entry (an empty rule fails the guard), and
 * `ticket` names the ticket that converts the site (`standing` for account
 * deletion, which stays outside for good).
 */
const ALLOWLIST = [
  {
    file: 'server/services/draftSchedule.service.js',
    count: 1,
    ticket: '#2694',
    rule:
      'The scheduled start re-reads its League row FOR NO KEY UPDATE before it hands the '
      + 'start to startDraft. Ticket 2694 moves the scheduled start onto the League write.',
  },
  {
    file: 'server/routes/draft.router.js',
    count: 4,
    ticket: '#2697',
    rule:
      'The order, clock, readiness and keepers routes advance the board version in their own '
      + 'SQL. Ticket 2697 moves each route onto the League write.',
  },
  {
    file: 'server/services/privacy.service.js',
    count: 1,
    ticket: 'standing',
    rule:
      'Account deletion settles one user\'s Teams across several Leagues in one '
      + 'transaction, locking those League rows itself in id order. One League write '
      + 'cannot hold several Leagues, so it stays outside (ADR 0070 rule 5).',
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

/** The 1-based line of a character offset in a source string. */
function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** A hit's label: the statement's own lock text, for the message. */
function labelOf(text) {
  if (BOARD_ADVANCE.test(text)) return 'advances the board version of a leagues row';
  return 'locks a leagues row';
}

/**
 * Every League lock or board advance in one file's source, as `{ line, code }`.
 * Pure: a test hands it a fixture string with no disk.
 */
function findLeagueLocks(rawSource) {
  const source = blankComments(rawSource);
  const hits = [];
  for (const literal of source.matchAll(LITERAL)) {
    const text = literal[0];
    const base = literal.index;

    for (const lock of text.matchAll(ROW_LOCK)) {
      const of = lock[1] ? lock[1].replace(/"/g, '') : null;
      const onLeagues = of === null ? LEAGUES_NAMED.test(text) : of === 'leagues';
      if (onLeagues) {
        hits.push({ line: lineOf(source, base + lock.index), code: lock[0].replace(/\s+/g, ' ').trim() });
      }
    }

    const advance = BOARD_ADVANCE.exec(text);
    if (advance) {
      hits.push({ line: lineOf(source, base + advance.index), code: labelOf(text) });
    }
  }
  return hits;
}

/**
 * Analyse a set of `{ file, source }` records against an allowlist. Pure, so a
 * test can hand it fixture sources with no disk. Returns four finding lists:
 *   - unlisted: a lock in a file the allowlist does not name (and that is not
 *     the owner module)
 *   - overCount: a listed file holding more locks than its entry says
 *   - stale: an entry matching fewer locks than it claims (or none)
 *   - ruleless: an entry with no rule or no ticket
 */
function analyze(files, { allowlist = ALLOWLIST } = {}) {
  const ruleless = [];
  const allowed = new Map();
  for (const entry of allowlist) {
    if (typeof entry.rule !== 'string' || entry.rule.trim().length === 0) {
      ruleless.push(`${entry.file}: allowlist entry has no rule`);
    }
    if (typeof entry.ticket !== 'string' || entry.ticket.trim().length === 0) {
      ruleless.push(`${entry.file}: allowlist entry names no ticket`);
    }
    if (allowed.has(entry.file)) {
      ruleless.push(`${entry.file}: listed twice; one entry per file carries its count`);
    }
    allowed.set(entry.file, { entry, found: 0 });
  }

  const unlisted = [];
  for (const { file, source } of files) {
    if (file === OWNER_FILE) continue;
    const hits = findLeagueLocks(source);
    const record = allowed.get(file);
    if (record) {
      record.found += hits.length;
    } else {
      for (const hit of hits) {
        unlisted.push(`${file}:${hit.line}: ${hit.code} outside the League write module`);
      }
    }
  }

  const overCount = [];
  const stale = [];
  for (const { entry, found } of allowed.values()) {
    if (found > entry.count) {
      overCount.push(
        `${entry.file}: ${found} League locks, allowlist says ${entry.count} - a new one belongs in leagueWrite.js`
      );
    } else if (found < entry.count) {
      stale.push(`${entry.file}: allowlist says ${entry.count} League locks, found ${found}`);
    }
  }

  return { unlisted, overCount, stale, ruleless };
}

/** Analyse the real tree under the scan roots. */
function check(options = {}) {
  const files = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walk(path.join(REPO, root))) {
      files.push({
        file: toPosix(path.relative(REPO, abs)),
        source: fs.readFileSync(abs, 'utf8'),
      });
    }
  }
  return analyze(files, options);
}

function main() {
  const { unlisted, overCount, stale, ruleless } = check();
  const clean = !unlisted.length && !overCount.length && !stale.length && !ruleless.length;
  if (clean) {
    console.log('✅ Every League row lock goes through server/modules/leagueWrite.js, or is one of the ruled allowlist entries.');
    return;
  }
  if (unlisted.length) {
    console.error(
      `\n❌ ${unlisted.length} League lock(s) outside the League write module.\n`
      + 'Call leagueWrite (server/modules/leagueWrite.js), or lockLeague inside a caller\'s\n'
      + 'own transaction. If the site must stay hand-written until a ticket converts it,\n'
      + 'add it to ALLOWLIST in scripts/check-league-write-locks.js with its rule and ticket.\n'
    );
    unlisted.forEach((v) => console.error(`  ${v}`));
  }
  if (overCount.length || stale.length) {
    const drift = [...overCount, ...stale];
    console.error(`\n❌ ${drift.length} allowlist entr(ies) no longer describe the code:\n`);
    drift.forEach((v) => console.error(`  ${v}`));
  }
  if (ruleless.length) {
    console.error(`\n❌ ${ruleless.length} allowlist entr(ies) with no rule or ticket.\n`);
    ruleless.forEach((v) => console.error(`  ${v}`));
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWLIST,
  OWNER_FILE,
  SCAN_ROOTS,
  findLeagueLocks,
  analyze,
  check,
};
