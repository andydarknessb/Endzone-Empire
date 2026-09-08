#!/usr/bin/env node
/**
 * Guard: every statement that inserts a Team row runs behind a League-row lock
 * taken in the same function (#1043, follow-up from #938 / #967 / PR #1032).
 *
 * WHY THIS EXISTS. A Draft act (server/services/draftAct.service.js) locks the
 * League row `FOR UPDATE`, then reads the Teams into a snapshot WITHOUT a
 * per-row lock, and act bodies (reset, undo) gate and delete per Team from that
 * snapshot. A Team created between the snapshot read and the wipe would be
 * neither gated nor wiped. Today that cannot happen, but only by an invariant
 * nobody had written down: the one production Team-insert (joinLeague in
 * server/services/leagueMembership.service.js) takes the League row `FOR
 * UPDATE` before its INSERT, so a join serializes behind the act's League lock
 * and the snapshot is complete for the act's whole transaction. #1043 makes
 * that invariant observable, so a future join path, a commissioner "add team"
 * path, or a refactor that demotes the membership lock turns something red
 * instead of silently reopening the gap.
 *
 * WHAT IS ASSERTED, and its operationalization. The domain invariant is "in the
 * same transaction". Statically, the checkable proxy is "in the same enclosing
 * function": the one Team-insert takes its own League lock in its own body
 * (joinLeague's docstring: the lock is a no-op when the caller's transaction
 * already holds it, but joinLeague takes it regardless), so a per-function rule
 * captures today's invariant exactly and is what a new insert site must satisfy
 * too. A future site that locks in a HELPER and inserts in the caller would be
 * reported here as unlocked - deliberately: that is a "make the lock visible"
 * prompt, not a false alarm, and it is the conservative direction for a guard
 * whose whole job is to refuse a silent gap.
 *
 * WHY SOURCE-DERIVED, NOT HAND-LISTED. The precedents are the identity-comparison
 * guard (scripts/check-identity-comparisons.js) and the envelope-conformance
 * guard: a guard that discovers its own inputs cannot be quietly bypassed by a
 * new site the author forgot to add to a list. But a source-derived guard fails
 * SILENTLY when its DISCOVERY breaks, not only when its assertion does - and the
 * discovery set here has size ONE, so a matcher a hair too narrow would empty
 * the set and leave the guard green forever while asserting nothing. The
 * red-tell (delete FOR UPDATE) exercises only the assertion; it never touches
 * the scan. So the guard's own tests prove the scan too: a non-emptiness floor,
 * and the known site named by path (server/test/teamInsertLockGuard.test.js).
 *
 * SCOPE. All non-test source under server/ - services AND routes AND modules,
 * not services alone (#1043 ruling): the threat model names a commissioner "add
 * team" path, and nothing stops such a path landing in a router, so scanning
 * services alone would be blind to one of the two futures this guard exists to
 * catch. server/test/ is excluded so fixture SQL in tests does not trip it.
 *
 * Comments are stripped first (check-color-literals.js's own stripper, which
 * keeps string and template-literal bodies verbatim so the SQL inside them is
 * still seen, and preserves line breaks so reported line numbers stay true), so
 * a Team-insert quoted in a comment is not counted, and a `FOR UPDATE` written
 * only in a comment does not satisfy the rule.
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./check-color-literals');

const REPO = path.join(__dirname, '..');
const EXTENSIONS = new Set(['.js', '.jsx']);

// A fixed source-tree allowlist, exactly as the identity-comparison guard does
// it: scan() refuses any other root so a caller cannot silently point it
// somewhere that finds nothing.
const SERVER_ROOTS = ['server'];
const ROOT_DIRECTORIES = Object.freeze({
  server: path.join(REPO, 'server'),
});

// A statement inserting a Team row. The table name and its opening paren need
// not be on one line, and either may be quoted or bare, so this stays a hair
// wider than the one shape in the tree today (#1043 ruling 2: a matcher a hair
// too narrow empties the discovery set and the guard goes vacuously green).
const TEAM_INSERT_SOURCE = 'INSERT\\s+INTO\\s+"?teams"?';
// Global, for matchAll (which copies lastIndex, so it stays reentrant). Never
// call `.test()` on this one - use a fresh non-global regex for that.
const TEAM_INSERT = new RegExp(TEAM_INSERT_SOURCE, 'gi');
const hasTeamInsert = (source) => new RegExp(TEAM_INSERT_SOURCE, 'i').test(source);

// A League-row lock: a `FROM "leagues" ... FOR UPDATE` within a single SQL
// string. `[^`]*?` keeps the two halves inside one template literal (no
// backtick between them), so a `FROM "leagues"` in one statement and a `FOR
// UPDATE` on some other table in a later statement cannot be mistaken for a
// leagues lock. Matches every real variant: the bare `WHERE "id" = $1 FOR
// UPDATE`, the commissionerPredicate form, and the `... AND "draft_status" =
// 'active' FOR UPDATE` reset form, single- or multi-line.
const LEAGUE_LOCK = /FROM\s+"leagues"[^`]*?FOR\s+UPDATE/i;

// Keywords whose `(...) {` is a control block, not a function body.
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // `entry.name` comes from fs.readdirSync of a fixed repo directory, not
    // from user or network input, so there is no traversal here.
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      // Exclude the test tree (fixture SQL is not production code) and the
      // usual non-source directories.
      if (entry.name === 'test' || entry.name === 'node_modules' || entry.name === 'build') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const toPosix = (rel) => rel.split(path.sep).join('/');
const lineOf = (source, index) => source.slice(0, index).split('\n').length;

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
const isIdentChar = (c) => c === '_' || c === '$' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/**
 * Is the `{` at `openIndex` the opening brace of a function BODY (a declaration,
 * a method, or an arrow), as opposed to a control block (`if`/`for`/...) or an
 * object/param literal? Operates on comment-stripped source.
 *
 * Scans only a small window backward from `openIndex` (never slices the whole
 * prefix): it is called once per closing brace, so a whole-prefix slice would
 * make the scan O(n^2) in a large file.
 */
function isFunctionBodyOpen(source, openIndex) {
  // The last non-whitespace char before the brace.
  let i = openIndex - 1;
  while (i >= 0 && isSpace(source[i])) i -= 1;
  if (i < 0) return false;
  // Arrow body: `... => {`.
  if (source[i] === '>' && i >= 1 && source[i - 1] === '=') return true;
  // A declaration/method body opens right after the parameter list's `)`.
  if (source[i] !== ')') return false;
  // Match that `)` back to its `(`.
  let depth = 0;
  for (; i >= 0; i -= 1) {
    const c = source[i];
    if (c === ')') depth += 1;
    else if (c === '(') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (i < 0) return false;
  // The identifier (if any) immediately before that `(` decides it: a control
  // keyword means a control block, anything else (a function/method name, or
  // `function`) means a body.
  let j = i - 1;
  while (j >= 0 && isSpace(source[j])) j -= 1;
  const end = j;
  while (j >= 0 && isIdentChar(source[j])) j -= 1;
  const keyword = source.slice(j + 1, end + 1);
  return !CONTROL_KEYWORDS.has(keyword);
}

/**
 * Ranges [{open, close}] of every function BODY in comment-stripped source,
 * found by brace matching. Template-literal `${...}` braces are balanced, so
 * they net out; the SQL and messages in this tree carry no stray braces.
 */
function functionBodyRanges(source) {
  const stack = [];
  const ranges = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{') stack.push(i);
    else if (c === '}') {
      const open = stack.pop();
      if (open === undefined) continue;
      if (isFunctionBodyOpen(source, open)) ranges.push({ open, close: i });
    }
  }
  return ranges;
}

/** The innermost function body containing `index`, or null if none does. */
function enclosingFunction(ranges, index) {
  let best = null;
  for (const range of ranges) {
    if (range.open < index && index < range.close) {
      if (!best || range.open > best.open) best = range;
    }
  }
  return best;
}

/**
 * Every Team-insert site in one file's source, as `{ line }`. Takes RAW source
 * and strips comments itself (the identity-comparison guard's lesson: a caller
 * that forgets to strip would have every commented-out insert reported as real
 * code, silently). This is the DISCOVERY half - what the guard's own tests pin a
 * floor and a named site against.
 */
function findTeamInserts(rawSource) {
  const source = stripComments(rawSource, '.js');
  const found = [];
  for (const match of source.matchAll(TEAM_INSERT)) {
    found.push({ line: lineOf(source, match.index) });
  }
  return found;
}

/**
 * Every Team-insert site NOT preceded by a League-row lock in the same
 * enclosing function, as `{ line }`. This is the RULE half. A site with no
 * enclosing function (top-level) is a violation: no lock can be proven for it.
 */
function unlockedTeamInserts(rawSource) {
  const source = stripComments(rawSource, '.js');
  // No insert, no function-body walk: most files have none, and building ranges
  // for them would be wasted work.
  if (!hasTeamInsert(source)) return [];
  const ranges = functionBodyRanges(source);
  const violations = [];
  for (const match of source.matchAll(TEAM_INSERT)) {
    const index = match.index;
    const fn = enclosingFunction(ranges, index);
    const scopeBeforeInsert = fn ? source.slice(fn.open, index) : '';
    if (!fn || !LEAGUE_LOCK.test(scopeBeforeInsert)) {
      violations.push({ line: lineOf(source, index) });
    }
  }
  return violations;
}

/**
 * Scan `roots` for Team-insert sites. Returns two maps keyed by repo-relative
 * posix path: `inserts` (every site, for the discovery floor) and `violations`
 * (unlocked sites, the rule). Refuses any root outside the fixed allowlist.
 */
function scan(roots) {
  const inserts = new Map();
  const violations = new Map();
  for (const root of roots) {
    const directory = ROOT_DIRECTORIES[root];
    if (!directory) throw new Error(`team-insert-lock scan root is not allowed: ${root}`);
    for (const file of walk(directory)) {
      const rel = toPosix(path.relative(REPO, file));
      const raw = fs.readFileSync(file, 'utf8');
      const found = findTeamInserts(raw);
      if (found.length) inserts.set(rel, found);
      const bad = unlockedTeamInserts(raw);
      if (bad.length) violations.set(rel, bad);
    }
  }
  return { inserts, violations };
}

/** Flattened `file:line` lists for both maps. */
function check(roots) {
  const { inserts, violations } = scan(roots);
  const insertSites = [];
  for (const [file, sites] of inserts) {
    for (const { line } of sites) insertSites.push(`${file}:${line}`);
  }
  const violationSites = [];
  for (const [file, sites] of violations) {
    for (const { line } of sites) violationSites.push(`${file}:${line}`);
  }
  return { insertSites, violationSites };
}

function main() {
  const { insertSites, violationSites } = check(SERVER_ROOTS);

  if (insertSites.length === 0) {
    console.error(
      '\n❌ The Team-insert scan found NOTHING under server/. That is not a pass: '
      + 'the discovery matcher has broken, and this guard would be vacuously green.\n'
      + 'Fix TEAM_INSERT in scripts/check-team-insert-lock.js.\n'
    );
    process.exit(1);
  }
  if (violationSites.length === 0) {
    console.log(
      `✅ All ${insertSites.length} Team-insert site(s) under server/ take a League row lock first.`
    );
    return;
  }
  console.error(
    `\n❌ ${violationSites.length} Team-insert(s) with no League row lock (SELECT ... FROM "leagues" `
    + '... FOR UPDATE) earlier in the same function:\n\n'
    + '  A Draft act reads the Teams into an unlocked snapshot and gates/deletes per Team\n'
    + '  from it (draftAct.service.js). A Team created without serializing behind the\n'
    + '  League lock could be neither gated nor wiped (#1043). Either lock the League row\n'
    + '  before the insert, or - if this insert genuinely needs no such serialization -\n'
    + '  bring the change to the reviewer with the argument for why.\n'
  );
  violationSites.forEach((v) => console.error(`  ${v}`));
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  SERVER_ROOTS,
  TEAM_INSERT,
  LEAGUE_LOCK,
  isFunctionBodyOpen,
  functionBodyRanges,
  enclosingFunction,
  findTeamInserts,
  unlockedTeamInserts,
  scan,
  check,
};
